import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Production 2026-10-07: after «¿Tienen cupo el domingo a las 10?» (no availability) the customer said «no» and the
 * reply read «Su cita … sigue confirmada» although the draft had no e-mail and nothing was booked. What the engine
 * says about an open draft is draft vocabulary: «en curso», never «confirmada».
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const CORTE = { id: 'svc-corte', name: 'Corte y estilo', durationMinutes: 45, price: 40000, currency: 'COP', priceStatus: 'confirmed' as const };
const today = '2026-10-05';
const upcoming = [{ date: '2026-10-10', weekday: 'sabado' }, { date: '2026-10-11', weekday: 'domingo' }];

function harness(sundayFull: boolean) {
    const execute = jest.fn(async (_s: string, _t: string, _c: string, name: string, args: any) => {
        if (name === 'list_services') return { services: [CORTE] };
        if (name === 'check_availability') {
            return args.date === '2026-10-11' && sundayFull ? { available: false, slots: [] }
                : { available: true, slots: [{ time: '16:00', endTime: '16:45' }, { time: '10:00', endTime: '10:45' }] };
        }
        return { success: true };
    });
    const engine = new BookingEngineService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        { get: async () => JSON.stringify([CORTE]), set: async () => {}, del: async () => {} } as any,
        { execute } as any,
    );
    const interpreter = new IntentInterpreterService({ execute: jest.fn(async () => ({ content: '{}' })) } as any);
    return async (text: string, state: BookingState, lang: string) => {
        const intent = await interpreter.interpret(text, state.step, [CORTE.name], today, upcoming);
        return engine.process('schema', 'tenant', 'contact', intent, text, state, {}, today, lang, { authority, conversationId: 'c' });
    };
}

const draft = (): BookingState => ({
    missionId: 'm', step: 'ask_email', serviceId: CORTE.id, serviceName: CORTE.name, date: '2026-10-10', time: '16:00',
    slots: [{ time: '16:00', endTime: '16:45' }], customerName: 'Joaquin Sosa', services: [CORTE],
});

/** "confirmada" / "confirmed" / "confirmé" … is allowed only when negated ("sin confirmar", "not confirmed yet"). */
const claimsConfirmed = (text: string) => /(?<!sin |not |ainda sem |sem |pas encore |non )\bconfirm\w*/i.test(text);
const DRAFT_WORD: Record<string, RegExp> = { es: /en curso/i, en: /in progress/i, pt: /em andamento/i, fr: /en cours/i };

describe.each(['es', 'en', 'pt', 'fr'])('%s: an open draft is never called confirmed', lang => {
    it('after a question with no availability, the engine says the draft stays in progress', async () => {
        const turn = harness(true);
        const { text, state } = await turn('¿Tienen cupo el domingo a las 10 para corte y estilo?', draft(), lang);
        expect(text).toMatch(DRAFT_WORD[lang]);
        expect(claimsConfirmed(text ?? '')).toBe(false);
        expect(state.serviceId).toBe(CORTE.id);
    });

    it('after "no" to an offered change, the engine keeps the draft in progress', async () => {
        const turn = harness(false);
        const offered = await turn('¿Tienen cupo el domingo a las 10 para corte y estilo?', draft(), lang);
        expect(offered.state.pendingSwitch).toBeTruthy();
        const { text } = await turn('no', offered.state, lang);
        expect(text).toMatch(DRAFT_WORD[lang]);
        expect(claimsConfirmed(text ?? '')).toBe(false);
    });
});
