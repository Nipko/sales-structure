import type { TurnKnowledgeContract } from '@parallext/business-spec';
import { projectAvailableService } from '../../appointments/service-price-status';
import { promptHoursStatus, regularHoursConfirmed } from '../informational-hours';
import { authoritativeNumbers, repairReply, templateItemIds, turnEvidence, withoutTemplateItems } from './evidence-verifier';
import { factTokenId, moneySlot, renderReplyFacts } from './fact-renderer';
import { FACT_TTL_MS, type VerifiedFact } from './facts-ledger';

/**
 * E2v: defectos de honestidad de la respuesta medidos en el ensayo E2v (7 tenants, 3 intentos por caso).
 * 1. La reparación del verificador dejaba respuestas incoherentes (solo el precio, solo «¿le gustaría reservarla?», o el
 *    «no consta» aunque lo preguntado constara).
 * 2. Los servicios de la plantilla del alta respaldaban «ofrecemos consulta general, consulta especializada…».
 * 3. El horario sembrado decía «está cerrada ahora».
 * 4. Una disponibilidad en el hueco de un total: «150.000 COP por noche, sumando disponible en total».
 */
const contract = (over: Partial<TurnKnowledgeContract> = {}, offers: Partial<TurnKnowledgeContract['offers']> = { handoff: { available: true } }): TurnKnowledgeContract => ({
    schema: 'business-spec/turn-contract@1' as any, specVersion: '1', verdict: 'limitado' as any, resultHash: 'h',
    facts: [
        { id: 'CORE.IDENTITY.NAME', topic: 'nombre', state: 'confirmed', source: 'value', value: { display_name: 'Salón QA' } },
        { id: 'CORE.IDENTITY.DESCRIPTION', topic: 'descripción', state: 'confirmed', source: 'value',
            value: { short: 'Salón de belleza de prueba: cortes, color y manicure para adultos', audience: ['B2C'] } },
    ],
    unknown: [
        { id: 'CORE.HOURS.REGULAR', topic: 'horario', state: 'seeded', code: 'NC+AV', never: [] },
        { id: 'OBJ.LODGING_BOOKING.AVAILABILITY_SOURCE', topic: 'disponibilidad', state: 'absent', code: 'NC+AV', never: [] },
        { id: 'CORE.OFFER.ITEMS', topic: 'catálogo', state: 'seeded', code: 'NC+AV', never: [] },
    ],
    never: [],
    offers: { pendingQuestion: false, handoff: { available: false }, writes: {}, ...offers },
    ...over,
});
const claim = (sentence: string, requirementId: string | null = null) => ({ sentence, kind: 'claim' as const, requirementId });

describe('E2v · 1. la reparación dice lo que no consta del tema preguntado', () => {
    it('hotel C15: la frase quitada respondía la disponibilidad → aviso de la disponibilidad del sábado en su lugar, sin la pregunta de venta', () => {
        const reply = 'La habitación está disponible el sábado. El precio por esa noche es 150.000 COP. ¿Le gustaría que le ayude a reservarla?';
        const r = repairReply(reply, [claim('La habitación está disponible el sábado.')], contract(), 'es',
            { customerMessage: '¿Tienen disponibilidad de Spark QA Habitacion 20261018T113247Z para el sábado?' });
        expect(r.reply).toBe('No tengo confirmada la disponibilidad para el sábado; si quiere, le paso con una persona del equipo para confirmarlo. '
            + 'El precio por esa noche es 150.000 COP.');
        expect(r.noticeAdded).toBe(true);
    });

    it('citas C15: una negación de horarios quitada deja el aviso del tema, no «¿qué tal otro día?» (que la repetía)', () => {
        const r = repairReply('No hay horarios disponibles el 2026-11-07. ¿Qué tal si intentamos con otro día?',
            [{ sentence: 'No hay horarios disponibles el 2026-11-07.', kind: 'denial', requirementId: 'OBJ.APPOINTMENT.AVAILABILITY_SOURCE' }],
            contract(), 'es', { customerMessage: '¿Tienen disponibilidad de Color y tratamiento para el sábado?' });
        expect(r.reply).toBe('No tengo confirmada la disponibilidad para el sábado; si quiere, le paso con una persona del equipo para confirmarlo.');
    });

    it('el aviso del tema respeta lo que ofrece el contrato y el idioma; una fecha o un rango del cliente va en el aviso', () => {
        const cases: Array<[string, Partial<TurnKnowledgeContract['offers']>, string, string]> = [
            ['¿Tienen la habitación disponible del 12 al 15?', { pendingQuestion: true }, 'es', 'No tengo confirmada la disponibilidad del 12 al 15; si quiere, lo consulto con el equipo y le aviso.'],
            ['¿Tienen cupo el 8 de diciembre?', {}, 'es', 'No tengo confirmada la disponibilidad para el 8 de diciembre.'],
            ['Is the room available on Saturday?', { handoff: { available: true } }, 'en', "I don't have the availability confirmed; if you like, I can connect you with someone from the team to confirm it."],
        ];
        for (const [message, offers, language, expected] of cases) {
            const r = repairReply('Sí, hay disponibilidad.', [claim('Sí, hay disponibilidad.')], contract({}, offers), language, { customerMessage: message });
            expect(r.reply).toBe(expected);
        }
    });

    it('citas C01: lo preguntado (qué hacen) consta y lo que queda lo dice → se quita lo otro sin agregar «no consta»', () => {
        const reply = '¡Hola! Soy Luna, su asistente virtual de belleza y estilo. El parqueadero para clientes es gratis. ¿Le gustaría conocer nuestros servicios?';
        const r = repairReply(reply, [claim('El parqueadero para clientes es gratis.')], contract(), 'es', { customerMessage: 'Hola, ¿a qué se dedican?' });
        expect(r.reply).toBe('¡Hola! Soy Luna, su asistente virtual de belleza y estilo. ¿Le gustaría conocer nuestros servicios?');
        expect(r.noticeAdded).toBe(false);
    });

    it('dental C01: si lo quitado era la respuesta a «qué hacen» y la descripción consta, va la descripción confirmada', () => {
        const reply = '¡Hola! Somos una clínica que ofrece consulta general, consulta especializada y control.';
        const r = repairReply(reply, [claim('Somos una clínica que ofrece consulta general, consulta especializada y control.')], contract(), 'es',
            { customerMessage: '¿Qué es exactamente lo que hacen?' });
        expect(r.reply).toBe('¡Hola! Salón de belleza de prueba: cortes, color y manicure para adultos.');
        expect(r.noticeAdded).toBe(false);
    });

    it('nunca deja solo una pregunta de venta, un cierre o una frase que enlaza con lo quitado', () => {
        const upsell = repairReply('Hay disponibilidad el sábado. ¿Le gustaría reservar?', [claim('Hay disponibilidad el sábado.', 'OBJ.LODGING_BOOKING.AVAILABILITY_SOURCE')],
            contract(), 'es', { customerMessage: 'Hola' });
        expect(upsell.reply).toBe('No tengo ese dato confirmado; si quiere, le paso con una persona del equipo para confirmarlo.');
        const dangling = repairReply('Su reserva está confirmada. Así puedo revisar mejor el estado de su reserva.', [claim('Su reserva está confirmada.')],
            contract(), 'es', { customerMessage: '¿En qué va mi pedido o mi reserva?' });
        expect(dangling.reply).toBe('No tengo ese dato confirmado; si quiere, le paso con una persona del equipo para confirmarlo.');
        expect(dangling.removed).toHaveLength(2);
        // Una pregunta que pide un dato del cliente se conserva.
        const clarifying = repairReply('Hay disponibilidad. ¿Para cuántas personas sería?', [claim('Hay disponibilidad.')], contract(), 'es',
            { customerMessage: '¿Tienen disponibilidad?' });
        expect(clarifying.reply).toBe('No tengo confirmada la disponibilidad; si quiere, le paso con una persona del equipo para confirmarlo. ¿Para cuántas personas sería?');
    });

    it('sin mensaje del cliente y con contenido que queda, el aviso es el genérico de siempre', () => {
        const r = repairReply('Tiene 2 habitaciones. No tiene parqueadero. ¿Le ayudo?', [{ sentence: 'No tiene parqueadero.', kind: 'denial', requirementId: null }], contract(), 'es');
        expect(r.reply).toBe('Tiene 2 habitaciones. No tengo ese dato confirmado; si quiere, le paso con una persona del equipo para confirmarlo. ¿Le ayudo?');
    });
});

describe('E2v · 2. un ítem de plantilla no es evidencia', () => {
    const seeded = { id: 's1', name: 'Consulta general', durationMinutes: 30, price: 50000, priceStatus: 'example', contentStatus: 'seeded' };
    const real = { id: 's2', name: 'Blanqueamiento', durationMinutes: 60, price: 300000, priceStatus: 'confirmed' };

    it('list_services → projectAvailableService conserva la marca de plantilla, y solo esa', () => {
        expect(projectAvailableService({ ...seeded, priceStatus: 'example' })).toMatchObject({ contentStatus: 'seeded', price: undefined });
        expect(projectAvailableService({ ...real, priceStatus: 'confirmed' })).not.toHaveProperty('contentStatus');
        expect(projectAvailableService({ ...real, priceStatus: 'confirmed', contentStatus: 'confirmed' })).not.toHaveProperty('contentStatus');
    });

    it('turnEvidence deja fuera los servicios, ítems del catálogo y registros leídos de plantilla', () => {
        const at = new Date('2026-11-01T10:00:00Z');
        const evidence = turnEvidence({
            services: [seeded, real],
            catalog: [{ id: 'p1', title: 'Kit QA', contentStatus: 'example' }, { id: 'p2', title: 'Crema real' }],
            reads: [{ name: 'list_services', result: { services: [seeded, real], at } }],
        }).join('\n');
        expect(evidence).not.toContain('Consulta general');
        expect(evidence).not.toContain('Kit QA');
        expect(evidence).toContain('Blanqueamiento');
        expect(evidence).toContain('Crema real');
        expect(evidence).toContain('2026-11-01T10:00:00.000Z');
        expect(authoritativeNumbers({ services: [seeded, real] }).has(30)).toBe(false);
    });

    it('un Decimal o un Date se dejan tal cual; los ids de plantilla se encuentran en cualquier fuente', () => {
        class Decimal { constructor(private readonly v: string) {} toJSON() { return this.v; } }
        expect(JSON.stringify(withoutTemplateItems({ price: new Decimal('150000') }))).toBe('{"price":"150000"}');
        expect([...templateItemIds([seeded, real], { result: { services: [{ id: 9, contentStatus: 'example' }] } })]).toEqual(['s1', '9']);
    });
});

describe('E2v · 3. el estado abierto/cerrado necesita el horario habitual confirmado', () => {
    const agenda = { informational: true, source: 'appointment_availability', schedule: { sunday: { enabled: false } } };
    const sunday = new Date('2026-11-08T15:00:00Z');

    it('sin CORE.HOURS.REGULAR confirmado no hay «cerrado» ni «abierto», venga de la agenda o del horario configurado', () => {
        expect(promptHoursStatus('open', false, agenda, 'America/Bogota', sunday)).toBe('closed');
        expect(promptHoursStatus('open', false, agenda, 'America/Bogota', sunday, false)).toBe('unknown');
        expect(promptHoursStatus('closed', true, null, 'America/Bogota', sunday, false)).toBe('unknown');
        expect(promptHoursStatus('closed', true, null, 'America/Bogota', sunday, true)).toBe('closed');
    });

    it('regularHoursConfirmed lee el contrato: sin contrato no decide', () => {
        expect(regularHoursConfirmed(null)).toBeUndefined();
        expect(regularHoursConfirmed(contract())).toBe(false);
        expect(regularHoursConfirmed({ facts: [{ id: 'CORE.HOURS.REGULAR' }] })).toBe(true);
    });
});

describe('E2v · 4. una disponibilidad en el hueco de un monto o un total no se dice', () => {
    const NOW = new Date('2026-11-07T15:00:00.000Z');
    const ROOM = { type: 'room', id: 'r1', name: 'Spark QA Habitacion' };
    const make = (kind: VerifiedFact['kind'], field: string, value: VerifiedFact['value'], extra: Partial<VerifiedFact> = {}): VerifiedFact => ({
        v: 1, kind, subject: ROOM, field, value, source: { tool: 'test_read' }, observedAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + FACT_TTL_MS[kind]).toISOString(), ...extra,
    });
    const price = make('money', 'nightPrice', 150000, { currency: 'COP', priceStatus: 'confirmed' });
    const available = make('availability', 'available', true);
    const tok = (kind: string, f: VerifiedFact) => `⟦${kind}:${factTokenId(f)}⟧`;
    const render = (reply: string) => renderReplyFacts({ reply, facts: [price, available], now: NOW, language: 'es', locale: 'es-CO',
        customerText: '¿Tienen Spark QA Habitacion disponible del 12 al 15?' });

    it('hotel P05-5: «sumando ⟦avail⟧ en total» pasa a la plantilla segura del precio', () => {
        const out = render(`El precio total por las tres noches es ${tok('fact', price)} por noche, sumando ${tok('avail', available)} en total. ¿Le ayudo a reservar?`);
        expect(out.text).not.toContain('disponible');
        expect(out.text).toContain('150.000 COP');
        expect(out.fallbacks).toEqual([{ reason: 'wrong_token_kind' }]);
        expect(render(`El total es ${tok('fact', available)}.`).text).not.toContain('disponible');
    });

    it('fuera de un hueco de dinero la disponibilidad se dice como siempre', () => {
        expect(render(`La habitación está ${tok('avail', available)}. Cuesta ${tok('fact', price)} por noche.`).text)
            .toBe('La habitación está disponible. Cuesta 150.000 COP por noche.');
        expect(moneySlot('Precio y disponibilidad:', '')).toBe(false);
        expect(moneySlot('sumando un total de', '.')).toBe(true);
        expect(moneySlot('La habitación está', ' para esas fechas.')).toBe(false);
    });
});
