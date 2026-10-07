import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { hasExplicitBookingRequest, isInformationalDetour } from './informational-detour';
import { projectBookingStateForPrompt, restoreBookingMission, TENTATIVE_BOOKING_BLOCKED_TOOLS } from './booking-state-continuity';
import { PromptAssemblerService } from './prompt-assembler.service';
import { containsBookingOffer } from './booking-offer';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Production evidence (tenant "Salon QA Citas", Telegram): the customer asked
 * "cuanto dura color y tratamiento?" and never asked to book. The engine read the
 * service name as a service selection, opened a mission, and a later turn made the
 * model say "tengo una reserva pendiente para corte y estilo".
 *
 * A message that names a service still opens the flow (no booking is lost). When it carries no
 * booking act (explicit request, date/time) the mission is TENTATIVE: the engine stays silent,
 * the model never sees a pending booking, and it expires unless the customer takes a booking act.
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const services = [
    { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45, price: 40000, currency: 'COP', priceStatus: 'example' as const },
    { id: 'svc-color', name: 'Color y tratamiento', durationMinutes: 120, price: 120000, currency: 'COP', priceStatus: 'example' as const },
    { id: 'svc-mani', name: 'Manicure y pedicure', durationMinutes: 60, price: 50000, currency: 'COP', priceStatus: 'example' as const },
];
const today = '2026-10-05';
const upcoming = [{ date: '2026-10-10', weekday: 'sabado' }];
const T0 = Date.parse('2026-10-05T12:00:00Z');
const MIN = 60_000;

function harness(llmIntent: Record<string, unknown> = {}, opts: { productionNames?: boolean; catalog?: any[] } = {}) {
    const catalog = opts.catalog ?? services;
    let llmNext: Record<string, unknown> = {};
    const execute = jest.fn(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'check_availability') return { available: true, slots: [{ time: '16:00', endTime: '18:00' }] };
        if (name === 'list_services') return { services: catalog };
        return { success: true };
    });
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: async () => JSON.stringify(catalog), set: async () => {} } as any,
        { execute } as any,
    );
    const llm = jest.fn(async () => ({ content: JSON.stringify({
        intent: 'unknown', serviceMentioned: null, dateMentioned: null, timeMentioned: null, isConfirmation: false,
        isNegation: false, nameProvided: null, emailProvided: null, questionTopic: null, language: 'es', ...llmIntent, ...llmNext,
    }) }));
    const interpreter = new IntentInterpreterService({ execute: llm } as any);
    const turn = async (text: string, state: BookingState, llmOverride: Record<string, unknown> = {}) => {
        llmNext = llmOverride;
        // In production a fresh (idle) state carries no service names: the interpreter only knows them mid-mission.
        const names = opts.productionNames && (!state.step || state.step === 'idle') ? [] : catalog.map(s => s.name);
        const intent = await interpreter.interpret(text, state.step, names, today, upcoming);
        const result = await engine.process('schema', 'tenant', 'contact', intent, text, state, {}, today, 'es',
            { authority, conversationId: 'conversation' });
        return { intent, result };
    };
    return { turn };
}

/** What the next turn loads: the state saved at T0, restored `minutes` later. */
const restoredAfter = (state: BookingState, minutes: number): BookingState => {
    const savedAt = new Date(T0).toISOString();
    return restoreBookingMission({ ...state, savedAt }, savedAt, T0 + minutes * MIN).state;
};

describe('an explicit booking request is a real mission and the engine speaks, even phrased as a question', () => {
    it.each([
        '¿Me agendas color y tratamiento?',
        '¿Puedo pedir una cita para color y tratamiento? ¿cuánto dura?',
        'Agendar color y tratamiento, ¿cuánto dura?',
        "I'd like to book color y tratamiento, how long does it take?",
        'agendame porfa color y tratamiento, cuánto dura?',
        'Quisiera color y tratamiento, ¿cuánto cuesta?',
        'Quero fazer color y tratamiento, quanto custa?',
        'Je voudrais color y tratamiento, combien ça coûte ?',
        'Can I get color y tratamiento? how much is it?',
        '¿Tienen cupo para color y tratamiento? ¿cuánto dura?',
        '¿Me dan turno para color y tratamiento? ¿cuánto demora?',
        'me regala una cita para color y tratamiento? cuánto cuesta?',
        'me anotas para color y tratamiento? cuánto dura?',
        '¿Me pueden hacer color y tratamiento? ¿cuánto cuesta?',
        'can you fit me in for color y tratamiento? how long does it take?',
        'dá pra marcar color y tratamiento? quanto custa?',
        'Quiero reservar color y tratamiento, ¿cuánto dura?',
        'Quiero agendar color y tratamiento',
        'Necesito agendar color y tratamiento',
        'color y tratamiento por favor',
        'Se puede hacer color y tratamiento',
        '¿Tienen disponibilidad para el sábado para color y tratamiento?',
        'anótame para color y tratamiento',
        '¿tienen cupo a las 16:00 para color y tratamiento? ¿cuánto dura?',
        'Hola, quiero reservar un color y tratamiento mañana. ¿Cuánto cuesta?',
    ])('"%s"', async text => {
        const { turn } = harness();
        const { result } = await turn(text, { step: 'idle' });
        expect(result.handled).toBe(true);
        expect(result.text).toBeTruthy();
        expect(result.state).toMatchObject({ serviceId: 'svc-color' });
        expect(result.state.step).not.toBe('idle');
        expect(result.state.origin).toBeUndefined();
    });

    it('also hands the voice the duration and the formatted price as a plain sentence', async () => {
        const confirmed = services.map(svc => ({ ...svc, priceStatus: 'confirmed' as const }));
        const { turn } = harness({}, { catalog: confirmed });
        const { result } = await turn('Quiero reservar color y tratamiento, ¿cuánto dura y cuánto cuesta?', { step: 'idle' });
        expect(result.text).toContain('Color y tratamiento lasts 120 minutes');
        expect(result.text).not.toMatch(/[[\]]|120000/);
        expect(result.text).toMatch(/120[.,]000/);
    });

    it('is not fooled by questions ABOUT booking', () => {
        for (const text of [
            '¿Necesito cita previa para color y tratamiento?', '¿Cuánto cuesta sacar una cita para color y tratamiento?',
            '¿Hay que reservar para color y tratamiento o puedo llegar?', "What's your schedule for color y tratamiento?",
            '¿Cuánto tiempo necesito para color y tratamiento?', 'Necesito saber cuánto dura color y tratamiento',
            'Quisiera info sobre color y tratamiento',
        ]) expect([text, hasExplicitBookingRequest(text)]).toEqual([text, false]);
    });
});

describe('a mission opened without a booking act is tentative and silent', () => {
    const tentativeOpenings = [
        '¿Cuánto dura color y tratamiento?',
        '¿Cuánto cuesta color y tratamiento?',
        '¿Cuánto tiempo necesito para color y tratamiento?',
        'Necesito saber cuánto dura color y tratamiento',
        '¿Cuánto dura la cita de color y tratamiento?',
        '¿Cuánto dura el turno de color y tratamiento?',
        '¿Cuánto cuesta la cita de color y tratamiento?',
        '¿Hay que reservar para color y tratamiento o puedo llegar?',
        '¿Necesito cita previa para color y tratamiento?',
        '¿Cuánto cuesta sacar una cita para color y tratamiento?',
        '¿Qué incluye color y tratamiento?',
        '¿Color y tratamiento sirve para cabello teñido?',
        '¿Puedo pagar color y tratamiento con tarjeta?',
        "What's your schedule for color y tratamiento?",
        'Hola, para color y tratamiento cuánto tiempo necesito?',
        'info de color y tratamiento',
        'precio color y tratamiento',
        'color y tratamiento precio',
        'quisiera info sobre color y tratamiento',
        'me interesa color y tratamiento',
        'Color y tratamiento',
        '¿Tienen disponible color y tratamiento?',
        '¿Está disponible color y tratamiento los domingos?',
        '¿Está disponible el estacionamiento para color y tratamiento?',
        '¿Se puede hacer color y tratamiento? ¿cuánto demora?',
        '¿Y color y tratamiento se puede hacer con el cabello largo?',
    ];

    it.each(tentativeOpenings)('"%s" opens nothing the engine speaks for and nothing pending', async text => {
        const { turn } = harness();
        const { result } = await turn(text, { step: 'idle' });
        expect(result.handled).toBe(false);
        expect(result.text).toBeUndefined();
        if (result.state.step !== 'idle') expect(result.state.origin).toBe('question');
        expect(projectBookingStateForPrompt(restoredAfter(result.state, 5))).toBeUndefined();
        expect(restoredAfter(result.state, 31)).toEqual({ step: 'idle' });
    });

    it.each(['gracias', 'muchas gracias', 'chao', 'hola', 'ok gracias', 'perfecto, gracias', 'ok', 'thanks'])(
        'question, then "%s": still tentative and silent, and 31 minutes later nothing is offered back', async reply => {
            const { turn } = harness();
            const first = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
            const second = await turn(reply, first.result.state);
            expect(second.result.handled).toBe(false);
            expect(second.result.text).toBeUndefined();
            expect(second.result.state.origin).toBe('question');
            const later = restoredAfter(second.result.state, 31);
            expect(later).toEqual({ step: 'idle' });
            const third = await turn('hola', later);
            expect(third.result.text ?? '').not.toMatch(/a medio agendar|reserva/i);
        });

    it('"¿qué servicios tienen?" then "gracias" does not leave a mission behind', async () => {
        const { turn } = harness();
        const list = await turn('¿Qué servicios tienen?', { step: 'idle' });
        expect(list.result.handled).toBe(true);
        expect(list.result.state.origin).toBe('question');
        const thanks = await turn('gracias', list.result.state);
        expect(thanks.result.handled).toBe(false);
        expect(restoredAfter(thanks.result.state, 31)).toEqual({ step: 'idle' });
    });

    it.each(['no gracias', 'no', 'ahora no', 'no thanks'])('question, then "%s": the interest is dropped', async reply => {
        const { turn } = harness();
        const first = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        const second = await turn(reply, first.result.state);
        expect(second.result.handled).toBe(false);
        expect(second.result.state).toEqual({ step: 'idle' });
    });

    it.each(['sí', 'dale', 'yes please', 'sim', 'oui', 'sí, el sábado', 'sí gracias', 'claro'])(
        'question, then "%s": the booking act makes it real and the engine asks for the rest', async reply => {
            const { turn } = harness();
            const first = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
            const second = await turn(reply, first.result.state);
            expect(second.result.handled).toBe(true);
            expect(second.result.text).toBeTruthy();
            expect(second.result.state).toMatchObject({ serviceId: 'svc-color' });
            expect(second.result.state.origin).toBeUndefined();
        });

    it('a service picked from the list is a booking act', async () => {
        const { turn } = harness();
        const list = await turn('¿Qué servicios tienen?', { step: 'idle' });
        const pick = await turn('Color y tratamiento', list.result.state);
        expect(pick.result.handled).toBe(true);
        expect(pick.result.state).toMatchObject({ serviceId: 'svc-color', step: 'ask_date' });
        expect(pick.result.state.origin).toBeUndefined();
    });

    it('a date makes it real and then it has the normal dormant treatment', async () => {
        const { turn } = harness();
        const first = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        const second = await turn('el sábado', first.result.state);
        expect(second.result.handled).toBe(true);
        expect(second.result.state.origin).toBeUndefined();
        const dormant = restoredAfter(second.result.state, 31);
        expect(dormant).toMatchObject({ serviceId: 'svc-color', resumeOffer: 'pending' });
        expect(projectBookingStateForPrompt(dormant)).toBeUndefined();
        const offer = await turn('quiero retomar mi cita', dormant);
        expect(offer.result.handled).toBe(true);
        expect(offer.result.text).toMatch(/a medio agendar/i);
    });

    it('C14 then C25: a later question about another service never mentions a pending booking', async () => {
        const { turn } = harness();
        const c14 = await turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        const restored = restoredAfter(c14.result.state, 31);
        expect(projectBookingStateForPrompt(restored)).toBeUndefined();
        const c25 = await turn('¿Cuánto dura corte y estilo y tienen cupo el sábado a las 16:00?', restored);
        expect(c25.result.text ?? '').not.toMatch(/reserva|a medio agendar|pendiente/i);
    });

    it('the model cannot write bookings while the mission is only an interest', () => {
        expect(TENTATIVE_BOOKING_BLOCKED_TOOLS.has('create_appointment')).toBe(true);
    });
});

describe('acts inside a tentative mission', () => {
    const tentative = async () => {
        const h = harness();
        const first = await h.turn('¿Cuánto dura color y tratamiento?', { step: 'idle' });
        expect(first.result.state.origin).toBe('question');
        return { ...h, state: first.result.state };
    };

    it.each(['Color y tratamiento', 'anótame', 'apúntame', 'color y tratamiento por favor', 'se puede hacer color y tratamiento'])(
        '"%s" makes it real', async reply => {
            const h = await tentative();
            const { result } = await h.turn(reply, h.state);
            expect(result.handled).toBe(true);
            expect(result.state.origin).toBeUndefined();
        });

    it.each(['¿Qué incluye color y tratamiento?', '¿Color y tratamiento sirve para cabello teñido?', '¿Y color y tratamiento se puede hacer con el cabello largo?'])(
        'the question "%s" about the service keeps it tentative and silent', async reply => {
            const h = await tentative();
            const { result } = await h.turn(reply, h.state);
            expect(result.handled).toBe(false);
            expect(result.state.origin).toBe('question');
        });

    it('keeps the "Me interesa" opening tentative (documented: interest, not a request)', async () => {
        const { turn } = harness();
        const { result } = await turn('Me interesa color y tratamiento, ¿cuánto cuesta?', { step: 'idle' });
        expect(result.handled).toBe(false);
        expect(result.state.origin).toBe('question');
    });

    it.each(['ok', 'perfecto', 'listo', 'vale', 'ok gracias', 'perfecto, gracias'])(
        '"%s" accepts the booking offer only right after the model made one', async reply => {
            const h = await tentative();
            const silent = await h.turn(reply, h.state);
            expect(silent.result.handled).toBe(false);
            expect(silent.result.state.origin).toBe('question');
            const offered = { ...h.state, offeredBookingAt: new Date().toISOString() };
            const accepted = await h.turn(reply, offered);
            expect(accepted.result.handled).toBe(true);
            expect(accepted.result.state.origin).toBeUndefined();
        });

    it('a lone "gracias" after the offer is not an acceptance, and a stale offer does not count', async () => {
        const h = await tentative();
        const thanks = await h.turn('gracias', { ...h.state, offeredBookingAt: new Date().toISOString() });
        expect(thanks.result.handled).toBe(false);
        const stale = await h.turn('ok', { ...h.state, offeredBookingAt: new Date(Date.now() - 20 * MIN).toISOString() });
        expect(stale.result.handled).toBe(false);
    });

    it('the offer is consumed by the next turn', async () => {
        const h = await tentative();
        const first = await h.turn('hola', { ...h.state, offeredBookingAt: new Date().toISOString() });
        expect(first.result.state.offeredBookingAt).toBeUndefined();
    });

    it.each([
        '¿Le gustaría agendar una cita para ese servicio?',
        '¿Desea que le reserve esa cita?',
        'Would you like to book it?',
        'Gostaria de agendar?',
        'Voulez-vous réserver ?',
    ])('detects the model offering to book: "%s"', reply => {
        expect(containsBookingOffer(reply)).toBe(true);
    });

    it.each(['El servicio dura 120 minutos.', 'Cuesta 120.000 pesos. ¿Algo más?', 'Quedó reservado para el sábado.'])(
        'does not take "%s" for an offer', reply => {
            expect(containsBookingOffer(reply)).toBe(false);
        });

    it('"Solo consulto" keeps an availability question with a date and time tentative', async () => {
        const { turn } = harness();
        const { result } = await turn('Hola, ¿mañana a las 4 hay espacio para manicure y pedicure? Solo consulto', { step: 'idle' },
            { intent: 'ask_availability', dateMentioned: '2026-10-06', timeMentioned: '16:00', serviceMentioned: 'Manicure y pedicure' });
        expect(result.handled).toBe(false);
        if (result.state.step !== 'idle') expect(result.state.origin).toBe('question');
        expect(restoredAfter(result.state, 31)).toEqual({ step: 'idle' });
    });

    it('"Solo consulto" at idle is left to the model: the engine neither answers with slots nor opens a mission', async () => {
        const { turn } = harness();
        const { result } = await turn('¿Tienen cupo mañana a las 4 para color y tratamiento? Solo consulto', { step: 'idle' },
            { intent: 'ask_availability', dateMentioned: '2026-10-06', timeMentioned: '16:00', serviceMentioned: 'Color y tratamiento' });
        expect(result.handled).toBe(false);
        expect(result.text).toBeUndefined();
        expect(result.state).toEqual({ step: 'idle' });
    });
});

describe('production sequence N21 -> N22 -> C13 -> C14 -> C25 (same Telegram chat)', () => {
    const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '' } as any);
    const projectedBlock = (state: BookingState, minutes: number): string => {
        const projected = projectBookingStateForPrompt(restoredAfter(state, minutes));
        const layer: string = (assembler as any).buildTurnLayer({ language: 'es', timezone: 'America/Bogota', bookingState: projected });
        return layer.match(/<booking_state[\s\S]*?<\/booking_state>/)?.[0] ?? '';
    };

    it('after N21 (a live draft for corte y estilo) the later turns never call it a reservation and C25 only OFFERS the other service', async () => {
        const h = harness({}, { productionNames: true });
        // What N21 left behind: a live (6 minutes old) mission with a date and a time, services in state.
        let state: BookingState = {
            missionId: 'm-n21', step: 'show_slots', serviceId: 'svc-corte', serviceName: 'Corte y estilo', date: '2026-10-10',
            time: '16:00', slots: [{ time: '16:00', endTime: '16:45' }], services,
        };
        const steps: Array<[string, Record<string, unknown>, string]> = [
            ['Hola, ¿mañana a las 4 hay espacio para manicure y pedicure? Solo consulto',
                { intent: 'ask_availability', serviceMentioned: 'Manicure y pedicure', dateMentioned: '2026-10-06', timeMentioned: '16:00' }, 'svc-corte'],
            ['¿Cuánto dura el corte y estilo?', { intent: 'general_question', serviceMentioned: 'Corte y estilo' }, 'svc-corte'],
            ['¿Cuánto demora el servicio de color y tratamiento?', { intent: 'general_question', serviceMentioned: 'Color y tratamiento' }, 'svc-corte'],
            ['¿Cuánto dura color y tratamiento y tienen cupo el sábado a las 16:00?',
                { intent: 'ask_availability', serviceMentioned: 'Color y tratamiento', dateMentioned: '2026-10-10', timeMentioned: '16:00' }, 'svc-corte'],
            // The customer answers the offer: only now does the draft move.
            ['sí', { intent: 'confirm', isConfirmation: true }, 'svc-color'],
        ];
        expect(projectedBlock(state, 6)).toContain('status="draft"');
        for (const [text, llm, expectedService] of steps) {
            const out = await h.turn(text, state, llm);
            state = out.result.state;
            expect([text, state.serviceId]).toEqual([text, expectedService]);
            const block = projectedBlock(state, 6);
            expect(block).toContain('status="draft"');
            expect(block).toContain('confirmed="false"');
            expect(block).not.toMatch(/reserva|pendiente|pending/i);
        }
    });

    it('"Solo consulto" about another service leaves the open draft exactly as it was', async () => {
        const h = harness({}, { productionNames: true });
        const open: BookingState = {
            missionId: 'm-n21', step: 'show_slots', serviceId: 'svc-corte', serviceName: 'Corte y estilo', date: '2026-10-10',
            time: '16:00', slots: [{ time: '16:00', endTime: '16:45' }], services,
        };
        const { result } = await h.turn('¿mañana a las 4 hay espacio para manicure y pedicure? Solo consulto', open,
            { intent: 'ask_availability', serviceMentioned: 'Manicure y pedicure', dateMentioned: '2026-10-06', timeMentioned: '16:00' });
        expect(result.handled).toBe(false);
        expect(result.state).toEqual(open);
    });

    it('renders a projected mission as an unconfirmed draft, and only a booked one as confirmed', () => {
        const render = (step: string): string => (assembler as any).buildTurnLayer({
            language: 'es', timezone: 'America/Bogota',
            bookingState: { step, service: { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45 }, date: '2026-10-10', slot: '16:00' },
        });
        expect(render('show_slots')).toContain('<booking_state status="draft" confirmed="false">');
        expect(render('confirm')).toContain('status="draft"');
        expect(render('booked')).toContain('<booking_state status="booked" confirmed="true">');
    });

    it('the booking-draft rule tells the model to answer first and never to call it a reservation', () => {
        const prompt: string = (assembler as any).assemble({ industry: 'salon' } as any, { language: 'es', timezone: 'America/Bogota', now: '2026-10-06T12:00:00.000Z', upcomingDays: [], businessHoursStatus: 'open' } as any);
        expect(prompt).toContain('UNCONFIRMED DRAFT');
        expect(prompt).toMatch(/Never call it a pending reservation/);
    });
});

describe('a duration question riding with the answer to the current step', () => {
    it('at show_services the named service is still selected', async () => {
        const { turn } = harness();
        const { intent, result } = await turn('Color y tratamiento, ¿cuánto dura?', { step: 'show_services', missionId: 'm1', services });
        expect(intent.intent).toBe('select_service');
        expect(result.handled).toBe(true);
        expect(result.state).toMatchObject({ serviceId: 'svc-color', step: 'ask_date' });
    });

    it('at show_services "¿Está disponible X?" still selects the service', async () => {
        const { turn } = harness();
        const { result } = await turn('¿Está disponible color y tratamiento?', { step: 'show_services', missionId: 'm1', services });
        expect(result.handled).toBe(true);
        expect(result.state).toMatchObject({ serviceId: 'svc-color' });
    });

    it('at show_slots the named time is still selected', async () => {
        const { turn } = harness({ intent: 'select_time', timeMentioned: '16:00' });
        const open: BookingState = {
            missionId: 'm1', step: 'show_slots', serviceId: 'svc-color', serviceName: 'Color y tratamiento', date: '2026-10-10',
            slots: [{ time: '15:00', endTime: '17:00' }, { time: '16:00', endTime: '18:00' }], services,
        };
        const { result } = await turn('a las 16:00, ¿cuánto dura?', open);
        expect(result.handled).toBe(true);
        expect(result.state.time).toBe('16:00');
    });

    it('a pure duration question mid-mission at another step still goes to the model', () => {
        expect(isInformationalDetour('¿Cuánto dura color y tratamiento?', { serviceMentioned: 'Color y tratamiento' }, 'ask_date')).toBe(true);
    });

    it('keeps a time next to a duration question with the engine', () => {
        expect(isInformationalDetour('¿cuánto dura color y tratamiento a las 16:00?', { timeMentioned: '16:00' })).toBe(false);
    });
});

describe('a dormant mission is not shown to the model as a pending reservation', () => {
    const now = Date.parse('2026-10-05T12:00:00Z');
    const saved: BookingState = { missionId: 'm1', step: 'show_slots', serviceId: 'svc-corte', serviceName: 'Corte y estilo', date: '2026-10-10', services };

    it('omits a dormant mission (awaiting a resume decision) from the turn context', () => {
        const restored = restoreBookingMission(saved, '2026-10-05T10:00:00Z', now).state;
        expect(restored.resumeOffer).toBe('pending');
        expect(projectBookingStateForPrompt(restored)).toBeUndefined();
    });

    it('keeps projecting a mission the customer is actively working on', () => {
        const live = restoreBookingMission(saved, '2026-10-05T11:50:00Z', now).state;
        expect(projectBookingStateForPrompt(live)).toMatchObject({
            step: 'show_slots', service: { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45 }, date: '2026-10-10',
        });
    });

    it('never projects a tentative mission, even while live', () => {
        const live = restoreBookingMission({ ...saved, origin: 'question' }, '2026-10-05T11:50:00Z', now).state;
        expect(projectBookingStateForPrompt(live)).toBeUndefined();
    });

    it('projects nothing at idle', () => {
        expect(projectBookingStateForPrompt({ step: 'idle' })).toBeUndefined();
    });
});
