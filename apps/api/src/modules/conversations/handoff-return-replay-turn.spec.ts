import {
    isBareConsent, returnAskOf, returnNoteTask, returnReplayTurn, staleConsentReply,
} from './handoff-return-replay-turn';
import { PromptAssemblerService } from './prompt-assembler.service';

describe('returnReplayTurn: server state AND marker, never the message alone', () => {
    const handoff = { startedAt: '2026-10-05T20:00:00Z', returnedToAi: true, returnReplayFor: '2026-10-05T20:00:00Z' };
    const marked = { metadata: { handoffReturnReplay: true } };

    it('is a replay when the marker meets the claim for this episode', () => {
        expect(returnReplayTurn({ metadata: { handoff } }, marked)).toEqual({ startedAt: handoff.startedAt });
    });
    it('is not one without the marker (a redelivery, or an ordinary new message)', () => {
        expect(returnReplayTurn({ metadata: { handoff } }, { metadata: {} })).toBeNull();
        expect(returnReplayTurn({ metadata: { handoff } }, undefined)).toBeNull();
    });
    it('is not one when the claim belongs to another episode, or there is none, or it was never returned', () => {
        expect(returnReplayTurn({ metadata: { handoff: { ...handoff, returnReplayFor: '2026-01-01T00:00:00Z' } } }, marked)).toBeNull();
        expect(returnReplayTurn({ metadata: { handoff: { ...handoff, returnReplayFor: undefined } } }, marked)).toBeNull();
        expect(returnReplayTurn({ metadata: { handoff: { ...handoff, returnedToAi: false } } }, marked)).toBeNull();
        expect(returnReplayTurn({ metadata: {} }, marked)).toBeNull();
    });
    it('a marker that is not literally true counts for nothing', () => {
        expect(returnReplayTurn({ metadata: { handoff } }, { metadata: { handoffReturnReplay: 'true' } })).toBeNull();
    });
});

describe('returnAskOf', () => {
    it.each([
        ['human_request', 'person'], ['customer_accepted_human_offer', 'person'], ['complaint', 'complaint'],
        ['discount_request', 'discount'], ['custom_trigger:garantía', 'other'],
        ['vip', null], ['max_failed_attempts', null], [null, null],
    ])('%s -> %s', (reason, ask) => expect(returnAskOf(reason as any)).toBe(ask));
});

describe('isBareConsent: a stale yes is not consent', () => {
    it.each(['sí', 'si', 'dale', 'ok', 'sí\ndale', 'yes', 'claro, de acuerdo'])('%s', text => {
        expect(isBareConsent(text)).toBe(true);
    });
    it.each(['', '¿hay alguien?', 'sí, pero cuánto cuesta', 'necesito hablar con un asesor\nsí', 'quiero ver precios'])('%s', text => {
        expect(isBareConsent(text)).toBe(false);
    });
});

describe('what the customer is told', () => {
    it('asks again, in the customer language, with usted', () => {
        expect(staleConsentReply('es', false)).toContain('¿podría indicarme de nuevo qué necesita?');
        expect(staleConsentReply('en', false)).toContain('could you tell me again what you need');
        expect(staleConsentReply('pt', false)).toContain('poderia me dizer novamente');
        expect(staleConsentReply('fr', false)).toContain('pourriez-vous');
        expect(staleConsentReply('xx', false)).toBe(staleConsentReply('es', false));
    });
    it('says the request was left only when it was', () => {
        expect(staleConsentReply('es', true)).toContain('Dejé su solicitud anotada');
        expect(staleConsentReply('es', false)).not.toContain('Dejé su solicitud');
    });
    it('writes the team follow-up with a bounded excerpt', () => {
        const note = returnNoteTask('person', `quiero un asesor ${'x'.repeat(900)}`);
        expect(note.title).toBe('Cliente pidió hablar con una persona y nadie respondió');
        expect(note.description.length).toBeLessThan(520);
    });
});

describe('the prompt tells the model about the wait', () => {
    const service = new PromptAssemblerService({ buildSystemPrompt: jest.fn(() => '<persona/>') } as any);
    const render = (handoffReturn: unknown) => service.assemble({ tools: {} } as any, {
        language: 'es', timezone: 'America/Bogota', now: '2026-10-05T20:00:00.000Z',
        upcomingDays: [], businessHoursStatus: 'open', handoffReturn,
    } as any);

    it('carries what was asked and whether the request was left, as data', () => {
        expect(render({ ask: 'person', noteLeft: true })).toContain('<handoff_return asked="person" request_left_for_team="true" />');
        expect(render({ ask: null, noteLeft: false })).toContain('<handoff_return asked="none" request_left_for_team="false" />');
    });
    it('is absent on an ordinary turn', () => {
        expect(render(undefined)).not.toContain('<handoff_return');
    });
    it('the contract says what to do with it: acknowledge, never transfer again, never read a bare yes as consent', () => {
        const prompt = render({ ask: 'complaint', noteLeft: false });
        expect(prompt).toContain('25c. HANDOFF RETURN');
        expect(prompt).toContain('do not offer to transfer them again');
        expect(prompt).toContain('Never treat a bare yes or confirmation as consent');
    });
});
