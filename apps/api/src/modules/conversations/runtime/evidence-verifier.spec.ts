import type { TurnKnowledgeContract } from '@parallext/business-spec';
import { authoritativeNumbers, departureBacked, dropBackedViolations, evidenceVerifierRequest, EVIDENCE_VERIFIER_MODEL, explicitUnavailable, parseEvidenceVerdict, readDepartures, repairReply, sentenceNumbers, splitSentences, turnEvidence, unknownNotice } from './evidence-verifier';

const contract = (offers: Partial<TurnKnowledgeContract['offers']> = {}): TurnKnowledgeContract => ({
    schema: 'business-spec/turn-contract@1' as any, specVersion: '1', verdict: 'limitado' as any, resultHash: 'h',
    facts: [{ id: 'CORE.IDENTITY.NAME', topic: 'nombre', state: 'confirmed', source: 'value', value: { display_name: 'Clínica QA' } }],
    unknown: [
        { id: 'CORE.HOURS.REGULAR', topic: 'horario', state: 'seeded', code: 'NC+AV', never: ['asumir horario estándar'] },
        { id: 'OBJ.APPOINTMENT.AVAILABILITY_SOURCE', topic: 'disponibilidad', state: 'absent', code: 'NC+AV', never: [] },
    ],
    never: [],
    offers: { pendingQuestion: false, handoff: { available: false }, writes: {}, ...offers },
});

describe('EvidenceVerifier (D1b)', () => {
    it('la solicitud lleva lo que no consta, los hechos y la evidencia, con otro modelo que el juez del ensayo', () => {
        const req = evidenceVerifierRequest({ customerMessage: '¿Abren el sábado?', reply: 'Sí, abrimos de 8 a 13.', contract: contract(), evidence: ['{"slots":[]}'] });
        expect(req).toMatchObject({ task: 'classify', model: EVIDENCE_VERIFIER_MODEL, temperature: 0, jsonMode: true });
        expect(EVIDENCE_VERIFIER_MODEL).not.toBe('deepseek-chat');
        const payload = JSON.parse(req.messages[0].content);
        expect(payload.unknown.map((u: any) => u.id)).toEqual(['CORE.HOURS.REGULAR', 'OBJ.APPOINTMENT.AVAILABILITY_SOURCE']);
        expect(payload.facts[0].id).toBe('CORE.IDENTITY.NAME');
        expect(payload.evidence).toContain('slots');
    });

    it('solo acepta frases que están en la respuesta; JSON inválido es «sin veredicto»', () => {
        const reply = 'Abrimos de lunes a viernes de 8 a 18. ¿Le agendo una cita?';
        const v = parseEvidenceVerdict(JSON.stringify({ violations: [
            { sentence: 'Abrimos de lunes a viernes de 8 a 18.', kind: 'claim', requirementId: 'CORE.HOURS.REGULAR' },
            { sentence: 'Una frase inventada por el clasificador.', kind: 'claim' },
        ] }), reply);
        expect(v?.violations).toEqual([{ sentence: 'Abrimos de lunes a viernes de 8 a 18.', kind: 'claim', requirementId: 'CORE.HOURS.REGULAR' }]);
        expect(parseEvidenceVerdict('no es json', reply)).toBeNull();
        expect(parseEvidenceVerdict('{"violations": "x"}', reply)).toBeNull();
        expect(parseEvidenceVerdict('{"violations": []}', reply)).toEqual({ violations: [] });
    });

    it('repara: quita la frase sin respaldo, agrega el aviso una vez y deja la pregunta final al final', () => {
        const reply = 'Nuestro horario es de lunes a viernes de 8 a 18. No hay disponibilidad el sábado. ¿Le gustaría otra fecha?';
        const violations = [
            { sentence: 'Nuestro horario es de lunes a viernes de 8 a 18.', kind: 'claim' as const, requirementId: 'CORE.HOURS.REGULAR' },
            { sentence: 'No hay disponibilidad el sábado.', kind: 'denial' as const, requirementId: 'OBJ.APPOINTMENT.AVAILABILITY_SOURCE' },
        ];
        const r = repairReply(reply, violations, contract({ pendingQuestion: true }), 'es');
        expect(r.removed).toHaveLength(2);
        expect(r.reply).toBe('No tengo ese dato confirmado; si quiere, lo consulto con el equipo y le aviso. ¿Le gustaría otra fecha?');
    });

    it('sin violaciones o sin coincidencias, la respuesta sale igual', () => {
        const reply = 'Somos Clínica QA.';
        expect(repairReply(reply, [], contract(), 'es')).toEqual({ reply, removed: [], noticeAdded: false });
        expect(repairReply(reply, [{ sentence: 'Otra cosa.', kind: 'claim', requirementId: null }], contract(), 'es').reply).toBe(reply);
    });

    it('el aviso nunca ofrece lo que el negocio no tiene definido, y sale en el idioma del turno', () => {
        expect(unknownNotice(contract({ pendingQuestion: true }), 'es')).toContain('lo consulto con el equipo');
        expect(unknownNotice(contract({ handoff: { available: true } }), 'en')).toContain('connect you with someone');
        expect(unknownNotice(contract(), 'pt-BR')).toBe('Não tenho essa informação confirmada.');
        expect(unknownNotice(contract(), 'de')).toBe('No tengo ese dato confirmado.');
    });

    it('D1c: la evidencia lleva lo que el agente vio como autoridad, con los hechos y el catálogo primero', () => {
        const evidence = turnEvidence({
            facts: [{ subject: { id: 'p1', name: 'apartment en Spark QA Ciudad' }, field: 'price', value: 250000, currency: 'EUR' }],
            catalog: [{ id: 'p1', title: 'apartment en Spark QA Ciudad', price: 250000 }],
            services: [{ id: 's1', name: 'Visita guiada', durationMinutes: 60 }],
            reads: [{ name: 'get_property_details', result: { address: 'Calle 1' } }],
            knowledge: [{ q: 'horario' }],
            business: { name: 'Inmobiliaria QA' },
        });
        expect(evidence.map(e => e.split(':')[0])).toEqual(['facts', 'catalog', 'services', 'get_property_details', 'knowledge', 'business']);
        expect(evidence[0]).toBe('facts: apartment en Spark QA Ciudad · price = 250000 EUR');
        expect(turnEvidence({})).toEqual([]);
        const req = evidenceVerifierRequest({ customerMessage: '¿Precio?', reply: 'Cuesta 250.000 EUR.', contract: contract(), evidence });
        expect(JSON.parse(req.messages[0].content).evidence).toContain('250000');
        expect(req.systemPrompt).toContain('está respaldado aunque el tema esté en unknown');
    });

    it('D1d: cifras de las fuentes autoritativas; un precio de ejemplo no cuenta y el conocimiento tampoco', () => {
        const nums = authoritativeNumbers({
            reads: [{ result: { listings: [{ price: 250000, priceStatus: 'confirmed', parkingSpots: 0 }] } }],
            services: [{ name: 'Visita guiada', durationMinutes: 60, price: 90000, priceStatus: 'example' }],
            facts: [{ subject: { id: 't1' }, field: 'price', value: 125 }],
        });
        expect([...nums].sort((a, b) => a - b)).toEqual([0, 60, 125, 250000]);
        expect(sentenceNumbers('El total sería 750.000 EUR (3 × 250.000 EUR), abre 8:00.')).toEqual([750000, 3, 250000]);
    });

    it('D1d: descarta lo comprobable sin modelo — precio confirmado, total, «por confirmar» — y deja horarios y negaciones', () => {
        const nums = new Set([250000, 60]);
        const v = (sentence: string, kind: 'claim' | 'denial' = 'claim') => ({ sentence, kind, requirementId: null });
        const { kept, dropped } = dropBackedViolations([
            v('El precio confirmado es de 250.000 EUR.'),
            v('Para 3 apartamentos, el total sería 750.000 EUR (3 × 250.000 EUR).'),
            v('Visita guiada — precio por confirmar'),
            v('Abrimos de lunes a viernes de 08:00 a 18:00.'),
            v('El precio es 90.000 COP.'),
            v('No cuenta con parqueadero.', 'denial'),
            v('Cuenta con 2 habitaciones.'),
        ], nums);
        expect(dropped.map(d => d.sentence)).toEqual([
            'El precio confirmado es de 250.000 EUR.', 'Para 3 apartamentos, el total sería 750.000 EUR (3 × 250.000 EUR).', 'Visita guiada — precio por confirmar']);
        expect(kept).toHaveLength(4);
    });

    it('D1e: los dígitos de un nombre o código no bloquean el respaldo; «no tenemos información registrada» es cautela', () => {
        expect(sentenceNumbers('El Spark QA Plato 20261018T110518Z cuesta 13.500 COP.')).toEqual([13500]);
        expect(sentenceNumbers('El Galaxy S24 vale 3.200.000, el modelo 2024.')).toEqual([3200000, 2024]);
        const v = (sentence: string, kind: 'claim' | 'denial' = 'claim') => ({ sentence, kind, requirementId: null });
        const { kept, dropped } = dropBackedViolations([
            v('El Spark QA Plato 20261018T110518Z cuesta 13.500 COP.'),
            v('no tenemos información registrada sobre alérgenos para este plato', 'denial'),
            v('El Galaxy S24 cuesta 99.000 COP.'),
        ], new Set([13500]));
        expect(dropped).toHaveLength(2);
        expect(kept.map(k => k.sentence)).toEqual(['El Galaxy S24 cuesta 99.000 COP.']);
    });

    it('D1j: un 0 o false no respalda una negación; de una frase mixta queda lo respaldado', () => {
        const v = (sentence: string, kind: 'claim' | 'denial' = 'denial') => ({ sentence, kind, requirementId: null });
        const reply = 'El precio por noche es 150.000 COP y no tiene costo de limpieza. No se aceptan mascotas. '
            + 'Tiene 2 habitaciones, 80 m² de área y no cuenta con parqueadero. No hay cargo de limpieza (0 COP). ¿Le ayudo?';
        const { kept, dropped } = dropBackedViolations([
            v('El precio por noche es 150.000 COP y no tiene costo de limpieza.', 'claim'),
            v('No se aceptan mascotas.'),
            v('Tiene 2 habitaciones, 80 m² de área y no cuenta con parqueadero.'),
            v('No hay cargo de limpieza (0 COP).'),
        ], new Set([150000, 0, 80]), { reply });
        expect(dropped).toEqual([]);
        expect(kept.map(k => k.keep)).toEqual(['El precio por noche es 150.000 COP.', undefined, 'Tiene 2 habitaciones, 80 m² de área.', undefined]);
        const r = repairReply(reply, kept, contract(), 'es');
        expect(r.reply).toBe('El precio por noche es 150.000 COP. Tiene 2 habitaciones, 80 m² de área. No tengo ese dato confirmado. ¿Le ayudo?');
    });

    it('D1g: en una frase de cupos o stock, una cifra chica se respalda si está tal cual en los datos', () => {
        const v = (sentence: string) => ({ sentence, kind: 'claim' as const, requirementId: null });
        const { kept, dropped } = dropBackedViolations([
            v('Sí, para el sábado quedan 10 cupos disponibles.'),
            v('Tenemos 2 unidades en stock.'),
            v('Quedan 4 cupos.'),
            v('El tour dura 4 horas.'),
            v('Quedan 10 cupos a 125 EUR por persona.'),
        ], new Set([10, 2, 125]));
        expect(dropped.map(d => d.sentence)).toEqual([
            'Sí, para el sábado quedan 10 cupos disponibles.', 'Tenemos 2 unidades en stock.', 'Quedan 10 cupos a 125 EUR por persona.']);
        expect(kept.map(k => k.sentence)).toEqual(['Quedan 4 cupos.', 'El tour dura 4 horas.']);
    });

    it('D1i: una cifra que dijo el cliente no se comprueba; un trozo marcado se lee en su frase entera', () => {
        const v = (sentence: string) => ({ sentence, kind: 'claim' as const, requirementId: null });
        const reply = 'Actualmente tenemos en stock solo 2 unidades del Audífono QA Aurora, por lo que no sería posible pedir 3. '
            + 'El Tour QA Aurora 20261014 tiene un precio confirmado de 129.000 COP por persona. Quedan 5 cupos para 3 personas.';
        const { kept, dropped } = dropBackedViolations([
            v('no sería posible pedir 3'),
            v('El Tour QA Aurora 20261014 tiene un precio confirmado de 129.000 COP por persona.'),
            v('Quedan 5 cupos para 3 personas.'),
        ], new Set([2, 129000]), { reply, customerMessage: 'Si pido 3 del Tour QA Aurora 20261014, ¿cuánto sería?' });
        expect(dropped.map(d => d.sentence)).toEqual(['no sería posible pedir 3', 'El Tour QA Aurora 20261014 tiene un precio confirmado de 129.000 COP por persona.']);
        expect(kept.map(k => k.sentence)).toEqual(['Quedan 5 cupos para 3 personas.']);
    });

    it('D1d: un encabezado de lista sin ítems no queda colgado; una cifra al final de frase se conserva', () => {
        const reply = 'Estos son nuestros servicios:\n\n1. Asesoría legal gratuita incluida. El precio es 250.000.';
        const r = repairReply(reply, [{ sentence: 'Asesoría legal gratuita incluida.', kind: 'claim', requirementId: null }], contract(), 'es');
        expect(r.reply).toBe('El precio es 250.000. No tengo ese dato confirmado.');
    });

    it('D1m: una lectura «available: false» con motivo respalda «no hay salida ese día»; un 0 o false suelto no', () => {
        const reply = 'El paquete Spark QA Tour no tiene disponibilidad para el sábado 7 de noviembre de 2026, ya que no hay salida programada para esa fecha. ¿Le muestro otras fechas?';
        const v = [{ sentence: 'no hay salida programada para esa fecha', kind: 'denial' as const, requirementId: 'OBJ.TOUR_BOOKING.AVAILABILITY_SOURCE' }];
        const read = [{ result: { available: false, seatsLeft: 0, reason: 'no_departure_on_date' } }];
        expect(explicitUnavailable(read)).toBe(true);
        expect(explicitUnavailable([{ result: { available: false, seatsLeft: 0 } }])).toBe(false);
        expect(explicitUnavailable([{ result: { available: false, seatsLeft: 'unlimited', reason: 'party_size_required' } }])).toBe(false);
        expect(explicitUnavailable([{ result: { available: false, seatsLeft: 3, reason: 'not_enough_seats' } }])).toBe(true);
        expect(explicitUnavailable([{ result: { cleaningFee: 0, parking: false } }])).toBe(false);
        expect(dropBackedViolations(v, new Set(), { reply, explicitUnavailable: true }).dropped).toHaveLength(1);
        expect(dropBackedViolations(v, new Set(), { reply, explicitUnavailable: false }).kept).toHaveLength(1);
        // una negación de otro tema no se respalda por esa lectura
        const fee = [{ sentence: 'No hay cargo por cancelación.', kind: 'denial' as const, requirementId: null }];
        expect(dropBackedViolations(fee, new Set(), { reply: 'No hay cargo por cancelación.', explicitUnavailable: true }).kept).toHaveLength(1);
        expect(evidenceVerifierRequest({ customerMessage: 'x', reply: 'y', contract: contract(), evidence: [] }).systemPrompt).toContain('no_departure_on_date');
    });

    it('D1n: la fecha, hora y cupos de una salida leída en el turno respaldan la afirmación', () => {
        const reads = [{ result: { available: false, seatsLeft: 0, reason: 'no_departure_on_date',
            nextDepartures: [{ date: '2026-12-15T00:00:00.000Z', time: '1970-01-01T09:00:00.000Z', seatsLeft: 10 }] } }];
        const departures = readDepartures(reads);
        expect(departures).toEqual([{ year: 2026, month: 12, day: 15, time: '9:00', seats: 10 }]);
        // D1p (E2m): en el turno la lectura lleva los Date de Prisma, no el texto ISO
        expect(readDepartures([{ result: { nextDepartures: [{ date: new Date('2026-12-15T00:00:00.000Z'), time: new Date('1970-01-01T09:00:00.000Z'), seatsLeft: 10 }] } }]))
            .toEqual(departures);
        const claim = 'La próxima salida disponible es el 15 de diciembre de 2026 a las 9:00 a.m., con 10 cupos disponibles.';
        expect(departureBacked(claim, departures)).toBe(true);
        expect(departureBacked('The next departure is on December 15 at 09:00 with 10 seats left.', departures)).toBe(true);
        expect(departureBacked('A próxima saída é 15/12, com 10 vagas.', departures)).toBe(true);
        // otra cifra, otra hora u otra fecha: no
        expect(departureBacked('La próxima salida es el 15 de diciembre a las 9:00, con 12 cupos.', departures)).toBe(false);
        expect(departureBacked('La próxima salida es el 15 de diciembre a las 10:00, con 10 cupos.', departures)).toBe(false);
        expect(departureBacked('La próxima salida es el 16 de diciembre, con 10 cupos.', departures)).toBe(false);
        expect(departureBacked('El 15 de diciembre cuesta 125 EUR.', departures)).toBe(false);
        const v = [{ sentence: claim, kind: 'claim' as const, requirementId: 'OBJ.TOUR_BOOKING.AVAILABILITY_SOURCE' }];
        expect(dropBackedViolations(v, new Set([10]), { reply: claim, departures }).dropped).toHaveLength(1);
        expect(dropBackedViolations(v, new Set([10]), { reply: claim }).kept).toHaveLength(1);
    });

    it('parte frases por . ! ? … con cierres', () => {
        expect(splitSentences('Hola. ¿Qué tal? Bien… «Listo.» Fin')).toEqual(['Hola.', '¿Qué tal?', 'Bien…', '«Listo.»', 'Fin']);
    });
});
