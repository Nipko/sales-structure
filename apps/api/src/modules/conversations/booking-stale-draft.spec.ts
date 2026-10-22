import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { BOOKING_PROPOSAL_TTL_MS, restoreBookingMission } from './booking-state-continuity';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Production 2026-10-22 (tenant "Salon QA Citas", Telegram, image f33f4b22). The customer had no appointment: a draft for
 * «Corte y estilo» had been left at «¿cuál es su correo?» in the morning. Hours later:
 *  - «hay espacio el lunes a las 10 para manicure?» → «Sí, hay cupo el lunes 26 de octubre a las 10:00 para Corte y estilo.
 *    ¿Desea cambiar su cita de Corte y estilo al lunes 26 de octubre a las 10:00?» (wrong service, and a draft called «su cita»);
 *  - «puedo ir el viernes en la tarde a cortarme el pelo?» → «¿Desea cambiar su cita de Corte y estilo al viernes…?».
 * Three causes: the continuity window was measured from `savedAt`, which every turn rewrites, so a draft nobody touched for
 * hours stayed live while the conversation went on; once dormant, any question carrying a day or an hour resumed it; and
 * «manicure» was not recognised as «Manicure y pedicure» because only full service names were read at the late steps.
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const CORTE = { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45, price: 40000, currency: 'COP', priceStatus: 'confirmed' as const };
const COLOR = { id: 'svc-color', name: 'Color y tratamiento', durationMinutes: 120, price: 0, currency: 'COP', priceStatus: 'quote' as const };
const MANI = { id: 'svc-mani', name: 'Manicure y pedicure', durationMinutes: 60, price: 0, currency: 'COP', priceStatus: 'quote' as const };
const services = [CORTE, COLOR, MANI];
const today = '2026-10-22';
const FRIDAY = '2026-10-23';
const SATURDAY = '2026-10-24';
const MONDAY = '2026-10-26';
const THURSDAY = '2026-10-29';
const upcoming = [
    { date: FRIDAY, weekday: 'viernes' }, { date: SATURDAY, weekday: 'sabado' }, { date: '2026-10-25', weekday: 'domingo' },
    { date: MONDAY, weekday: 'lunes' }, { date: '2026-10-27', weekday: 'martes' }, { date: '2026-10-28', weekday: 'miercoles' },
    { date: THURSDAY, weekday: 'jueves' },
];
const MANICURE_QUESTION = 'hay espacio el lunes a las 10 para manicure?';
const HAIRCUT_QUESTION = 'puedo ir el viernes en la tarde a cortarme el pelo?';

const slot = (time: string, endTime = '23:59') => ({ time, endTime });

function harness(catalog = services) {
    const execute = jest.fn(async (_s: string, _t: string, _c: string, name: string, args: any) => {
        if (name === 'list_services') return { services: catalog };
        if (name === 'check_availability') {
            const slots = [slot('09:00'), slot('10:00'), slot('14:00'), slot('16:00')];
            return { available: true, slots: args.time ? slots.filter(s => s.time === args.time).concat(slots) : slots };
        }
        return { success: true, appointment: { id: 'apt-1', status: 'confirmed' } };
    });
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: async () => JSON.stringify(catalog), set: async () => {}, del: async () => {} } as any,
        { execute } as any,
    );
    const interpreter = new IntentInterpreterService({ execute: jest.fn(async () => ({ content: '{}' })) } as any);
    const turn = async (text: string, state: BookingState, lang = 'es') => {
        const names = catalog.map(s => s.name);
        const intent = await interpreter.interpret(text, state.step, names, today, upcoming);
        return engine.process('schema', 'tenant', 'contact', intent, text, state, {}, today, lang,
            { authority, conversationId: 'conversation' });
    };
    const availabilityCalls = () => execute.mock.calls.filter(call => call[3] === 'check_availability').map(call => call[4]);
    const writes = () => execute.mock.calls.filter(call => call[3] === 'create_appointment');
    return { turn, availabilityCalls, writes };
}

/** The morning draft, as it sat in the conversation metadata: at the e-mail step, for Corte y estilo. */
const morningDraft = (extra: Partial<BookingState> = {}): BookingState => ({
    missionId: 'm-morning', step: 'ask_email', serviceId: CORTE.id, serviceName: CORTE.name, date: THURSDAY, time: '16:00',
    slots: [slot('16:00', '16:45')], customerName: 'Joaquin Sosa', customerPhone: '7915652977', services, ...extra,
});
const NOW = Date.parse('2026-10-22T14:43:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const draftCore = (state: BookingState) => ({
    serviceId: state.serviceId, date: state.date, time: state.time, step: state.step,
    customerName: state.customerName, customerEmail: state.customerEmail,
});

describe('the continuity window is measured from the last turn the booking moved, not from the last write', () => {
    it('a draft untouched for hours is dormant even though the conversation kept rewriting savedAt', () => {
        // The conversation was active five minutes ago (savedAt), but the draft last moved six hours ago.
        const restored = restoreBookingMission(morningDraft({ progressedAt: ago(6 * 60) }), ago(5), NOW);
        expect(restored.requiresRevalidation).toBe(true);
        expect(restored.state.step).toBe('ask_date');
        expect(restored.state.resumeOffer).toBe('pending');
        expect(restored.state.time).toBeUndefined();
        expect(restored.state.dormantSince).toBe(ago(6 * 60));
    });

    it('a draft that moved within the window stays live as it was', () => {
        const restored = restoreBookingMission(morningDraft({ progressedAt: ago(10) }), ago(1), NOW);
        expect(restored.requiresRevalidation).toBe(false);
        expect(draftCore(restored.state)).toEqual(draftCore(morningDraft()));
        expect(restored.state.resumeOffer).toBeUndefined();
    });

    it('a state saved before the stamp existed keeps the old rule (age of the last write)', () => {
        expect(restoreBookingMission(morningDraft(), ago(10), NOW).state.step).toBe('ask_email');
        expect(restoreBookingMission(morningDraft(), ago(BOOKING_PROPOSAL_TTL_MS / 60_000 + 1), NOW).state.resumeOffer).toBe('pending');
    });

    it('the engine stamps a turn that moves the draft, and not a turn the model answers about something else', async () => {
        const { turn } = harness();
        const live = morningDraft({ progressedAt: ago(20) });
        const moved = await turn('mi correo es joaquin@example.com', structuredClone(live));
        expect(moved.state.customerEmail).toBe('joaquin@example.com');
        expect(Date.parse(moved.state.progressedAt!)).toBeGreaterThan(Date.parse(live.progressedAt!));
        const aside = await turn('¿a qué hora abren el sábado?', structuredClone(live));
        expect(aside.handled).toBe(false);
        expect(aside.state.progressedAt).toBe(live.progressedAt);
    });
});

describe('a stale draft is not resumed by a question: the question is answered as a new one', () => {
    const stale = () => restoreBookingMission(morningDraft({ progressedAt: ago(5 * 60) }), ago(4), NOW).state;

    it(`«${MANICURE_QUESTION}» checks Manicure y pedicure and offers no change of «su cita»`, async () => {
        const { turn, availabilityCalls, writes } = harness();
        const result = await turn(MANICURE_QUESTION, stale());
        expect(availabilityCalls()).toContainEqual(expect.objectContaining({ serviceId: MANI.id, date: MONDAY }));
        expect(availabilityCalls().some(args => args.serviceId === CORTE.id)).toBe(false);
        expect(result.text ?? '').not.toMatch(/su cita|cita en curso|Desea cambiar|Desea pasar|Corte y estilo/i);
        expect(result.state.pendingSwitch).toBeUndefined();
        // The morning draft is gone: nothing of it is carried into the new question.
        expect(result.state.serviceId === CORTE.id).toBe(false);
        expect(result.state.missionId).not.toBe('m-morning');
        expect(result.state.resumeOffer).toBeUndefined();
        expect(writes()).toHaveLength(0);
    });

    it(`«${HAIRCUT_QUESTION}» is a new question about a haircut, not a change of the old draft`, async () => {
        const { turn, writes } = harness();
        const result = await turn(HAIRCUT_QUESTION, stale());
        expect(result.text ?? '').not.toMatch(/su cita|cita en curso|Desea cambiar|Desea pasar/i);
        expect(result.state.pendingSwitch).toBeUndefined();
        expect(result.state.missionId).not.toBe('m-morning');
        expect(result.state.step).not.toBe('ask_email');
        expect(writes()).toHaveLength(0);
    });

    it('a question with a day does not write that day into the old draft (the 13:55 turn that revived it)', async () => {
        const { turn } = harness();
        const result = await turn('tienen citas el jueves después de las 4?', stale());
        expect(result.state.missionId).not.toBe('m-morning');
        expect(result.state.customerEmail).toBeUndefined();
        expect(result.text ?? '').not.toMatch(/correo/i);
    });

    it('a STATEMENT with booking data still resumes the dormant draft (unchanged behaviour)', async () => {
        const { turn } = harness();
        const result = await turn('quiero el jueves a las 16:00', stale());
        expect(result.state.missionId).toBe('m-morning');
        expect(result.state.serviceId).toBe(CORTE.id);
    });
});

describe('a live draft and a question about another service named by one word of it', () => {
    const live = () => morningDraft({ progressedAt: ago(5) });

    it(`«${MANICURE_QUESTION}» offers the switch to Manicure y pedicure; the draft is not touched and is not called «su cita»`, async () => {
        const { turn, availabilityCalls, writes } = harness();
        const open = live();
        const result = await turn(MANICURE_QUESTION, structuredClone(open));
        expect(result.handled).toBe(true);
        expect(availabilityCalls()).toContainEqual({ date: MONDAY, serviceId: MANI.id, time: '10:00' });
        expect(result.text).toContain('para Manicure y pedicure');
        expect(result.text).toContain('¿Desea cambiar la cita en curso de Corte y estilo (todavía sin confirmar) por Manicure y pedicure');
        expect(result.text).not.toMatch(/su cita/i);
        expect(result.state.pendingSwitch).toMatchObject({ serviceId: MANI.id, date: MONDAY, time: '10:00' });
        expect(draftCore(result.state)).toEqual(draftCore(open));
        expect(writes()).toHaveLength(0);
    });

    it.each([
        ['en', 'is there room on monday at 10 for manicure?', /the Corte y estilo appointment in progress \(not confirmed yet\) to Manicure y pedicure/, /your/i],
        ['pt', 'tem vaga na segunda às 10 para manicure?', /o agendamento em andamento de Corte y estilo \(ainda sem confirmação\) por Manicure y pedicure/, /seu agendamento/i],
        ['fr', 'avez-vous de la place lundi à 10h pour une manicure ?', /le rendez-vous en cours pour Corte y estilo \(pas encore confirmé\) par Manicure y pedicure/, /votre rendez-vous/i],
    ])('%s: the same offer, worded as a draft', async (lang, text, offer, possessive) => {
        const { turn } = harness();
        const result = await turn(text, live(), lang);
        expect(result.state.pendingSwitch).toMatchObject({ serviceId: MANI.id });
        expect(result.text).toMatch(offer);
        expect(result.text).not.toMatch(possessive);
    });

    it('the draft\'s own service named by a word, on another day, is offered as a change of the draft in progress', async () => {
        const { turn } = harness();
        const result = await turn('hay cupo el lunes a las 10 para corte?', live());
        expect(result.text).toContain('¿Desea pasar la cita en curso de Corte y estilo (todavía sin confirmar) al');
        expect(result.state.pendingSwitch).toMatchObject({ serviceId: CORTE.id, date: MONDAY, time: '10:00' });
    });

    it('a word shared by two services names neither of them', async () => {
        const catalog = [
            { id: 'svc-dama', name: 'Corte dama', durationMinutes: 45, price: 30000, currency: 'COP', priceStatus: 'confirmed' as const },
            { id: 'svc-caballero', name: 'Corte caballero', durationMinutes: 30, price: 20000, currency: 'COP', priceStatus: 'confirmed' as const },
            MANI,
        ];
        const { turn } = harness(catalog);
        const open: BookingState = { ...morningDraft({ progressedAt: ago(5) }), serviceId: MANI.id, serviceName: MANI.name, services: catalog };
        const result = await turn('hay cupo el lunes a las 10 para corte?', open);
        expect(result.state.pendingSwitch?.serviceId ?? MANI.id).toBe(MANI.id);
        expect(result.text ?? '').not.toMatch(/Corte dama|Corte caballero/);
    });

    it('a word of a service in a question that is not about booking it is not a service', async () => {
        const { turn } = harness();
        const result = await turn('¿de qué color es la fachada del local?', live());
        expect(result.state.pendingSwitch).toBeUndefined();
        expect(result.text ?? '').not.toMatch(/Color y tratamiento/);
    });
});
