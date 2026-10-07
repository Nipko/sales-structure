import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    budgetExhaustedReplayText, isBareConsent, isPureHandoffTool, removeHumanOfferSentences, replayAsk, returnAskOf,
    returnNoteTask, returnReplayTurn, rewriteReplayPromise, sanitizeReplayReply, staleConsentReply, toolsForReplay,
} from './handoff-return-replay-turn';
import { promisesHumanHandoff } from '../../common/utils/outcome-claim.util';
import { TOOL_POLICY_REGISTRY } from './tool-policy-registry';
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
    it('says when the request is the one that started the handoff, not a waiting text', () => {
        expect(render({ ask: 'person', noteLeft: true, fromEpisode: true }))
            .toContain('<handoff_return asked="person" request_left_for_team="true" origin="handoff_request" />');
    });
    it('the contract forbids offering a person again, even to confirm a missing fact', () => {
        const prompt = render({ ask: 'person', noteLeft: true, fromEpisode: true });
        expect(prompt).toContain('never offer, ask about or suggest connecting them with someone from the team');
        expect(prompt).toContain('if you lack a fact, say you do not have it confirmed');
    });
    it('the contract says what to do with it: acknowledge, never transfer again, never read a bare yes as consent', () => {
        const prompt = render({ ask: 'complaint', noteLeft: false });
        expect(prompt).toContain('25c. HANDOFF RETURN');
        expect(prompt).toContain('do not offer to transfer them again');
        expect(prompt).toContain('Never treat a bare yes or confirmation as consent');
    });
});

/**
 * The agent's own promise of a transfer must never be honoured on the replay: the team was not
 * available, and `agent_promised_handoff` would put the conversation back in the queue for
 * another ten minutes. Rule 25c leads the model to talk about the team, so these are exactly the
 * sentences it will produce.
 */
describe('rewriteReplayPromise: the replay never promises a transfer', () => {
    const PROMISES = [
        'Nuestro equipo se pondrá en contacto con usted.',
        'Un asesor se comunicará con usted en breve.',
        'El equipo lo contactará cuando esté disponible.',
        'The team will contact you as soon as possible.',
    ];

    it.each(PROMISES)('the real detector reads «%s» as a promise (so the rewrite is needed)', sentence => {
        expect(promisesHumanHandoff(sentence)).toBe(true);
    });

    it.each(PROMISES)('«%s»: gone when nothing was left for the team', sentence => {
        const reply = `Atendemos de lunes a viernes de 9 a 18. ${sentence}`;
        const out = rewriteReplayPromise(reply, sentence.startsWith('The') ? 'en' : 'es', false);
        expect(promisesHumanHandoff(out)).toBe(false);
        expect(out).toContain('Atendemos de lunes a viernes de 9 a 18.');
        expect(out).not.toMatch(/contacte|comunicar|pondr|will contact/i);
    });

    it.each(PROMISES)('«%s»: replaced by one true sentence when the request WAS left, with no time promised', sentence => {
        const lang = sentence.startsWith('The') ? 'en' : 'es';
        const out = rewriteReplayPromise(`Le ayudo con eso. ${sentence}`, lang, true);
        expect(promisesHumanHandoff(out)).toBe(false);
        expect(out).toContain(lang === 'en' ? 'I have left your request noted' : 'Dejé su solicitud anotada');
        expect(out).not.toMatch(/\d+ ?(minutos|min|horas|hours)/i);
    });

    it('a reply that was only the promise becomes «the team is not available, I help meanwhile», or the note', () => {
        expect(rewriteReplayPromise('Un asesor se comunicará con usted.', 'es', false))
            .toBe('En este momento el equipo no está disponible; con gusto le ayudo mientras tanto.');
        expect(rewriteReplayPromise('The team will contact you.', 'en', false)).toContain('The team is not available right now');
        // nothing at all left of the reply, in every language the agent speaks
        expect(rewriteReplayPromise('', 'pt', false)).toContain('a equipe não está disponível');
        expect(rewriteReplayPromise('', 'fr', false)).toContain("L'équipe n'est pas disponible");
        expect(rewriteReplayPromise('', 'xx', false)).toContain('el equipo no está disponible');
        expect(rewriteReplayPromise('Un asesor se comunicará con usted.', 'es', true)).toBe(staleConsentReply('es', true).split(' Ha pasado')[0]);
    });

    it('the sentences the turn adds are not themselves promises', () => {
        for (const lang of ['es', 'en', 'pt', 'fr']) {
            expect(promisesHumanHandoff(staleConsentReply(lang, true))).toBe(false);
        }
    });
});

describe('which tools the replay turn offers', () => {
    const offered = (names: string[]) => toolsForReplay(names.map(name => ({ function: { name } }))).map(t => t.function!.name);

    it('keeps the tools that only MAY end in a handoff: what they do first is the answer', () => {
        const mayHandOff = ['create_payment_link', 'refund_payment', 'check_policy_status', 'list_my_claims',
            'triage_pet_emergency', 'file_claim', 'create_service_request', 'search_faqs'];
        expect(offered(mayHandOff)).toEqual(mayHandOff);
    });
    it('withholds a tool whose only effect is handing the conversation over, in either tool shape', () => {
        expect(offered(['search_faqs', 'request_human', 'escalate_to_human'])).toEqual(['search_faqs']);
        expect(toolsForReplay([{ name: 'handoff_to_human' }, { name: 'get_policy' }]).map(t => t.name)).toEqual(['get_policy']);
        expect(isPureHandoffTool('request_human')).toBe(true);
        expect(isPureHandoffTool('create_payment_link')).toBe(false);
        expect(isPureHandoffTool(undefined)).toBe(false);
    });
    it('no registered tool is a pure handoff tool today (handoffs go through the paths the replay turn disables)', () => {
        const registered = Object.keys(TOOL_POLICY_REGISTRY).filter(name => isPureHandoffTool(name));
        expect(registered).toEqual([]);
    });
});

describe('the budget text on a replay', () => {
    it('promises nobody was told: the replay never transfers', () => {
        for (const lang of ['es', 'en', 'pt', 'fr']) {
            expect(budgetExhaustedReplayText(lang)).not.toMatch(/aviso|let(ting)? someone|avisando|préviens|pr[ée]viens/i);
        }
        expect(budgetExhaustedReplayText('es')).toContain('Le pedimos que vuelva a escribirnos más tarde');
    });
});

/**
 * `generateResponse` is too large to drive in a unit test, so the wiring that keeps the replay out
 * of the queue is pinned the way the opt-out suppression is: by what the live code says and in
 * which order.
 */
describe('generateResponse keeps the replay out of the queue (wiring)', () => {
    const source = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
    const generate = source.slice(source.indexOf('private async generateResponse('));

    it('no human handoff is allowed on a replay turn', () => {
        expect(generate).toMatch(/const allowHumanHandoff = !session && !draftMode && !handoffReturn\b/);
    });
    it('only a pure handoff tool is withheld on a replay turn', () => {
        expect(generate).toContain('if (handoffReturn) tools = toolsForReplay(tools);');
    });
    it('the budget-exhausted path does not transfer on a replay, and says so truthfully', () => {
        expect(generate).toContain('if (!session && !handoffReturn) {');
        expect(generate).toContain('handoffReturn ? budgetExhaustedReplayText(userLanguage) : budgetExhaustedText(userLanguage)');
    });
    it('an engine or procedure that wanted a handoff does not say «transferring» or «unavailable» next to the return notice', () => {
        expect(generate).not.toMatch(/(?<!if \(!handoffReturn\) )engineProducedText = handoffText\(userLanguage\)\.unavailable/);
        expect(generate).not.toMatch(/if \(!engineProducedText\) engineProducedText = handoffText\(userLanguage\)\.transferring/);
    });
    it('the stalled-ask route does not hand a replay to a person', () => {
        expect(source).toContain('if (decision.route && !replayTurn) {');
    });
    it('a transfer promise is rewritten before, and instead of, being honoured', () => {
        const rewrite = generate.indexOf('if (handoffReturn && !draftMode && promisesHumanHandoff(finalResponse))');
        const honour = generate.indexOf("'agent_promised_handoff'");
        expect(rewrite).toBeGreaterThan(0);
        expect(rewrite).toBeLessThan(honour);
        expect(generate.slice(rewrite, honour)).toContain('rewriteReplayPromise(finalResponse');
    });
    it('a write that asked for a transfer after the fact does not queue the conversation again', () => {
        expect(generate).toContain('if (postToolHandoff && !draftMode && !handoffReturn)');
    });
});

describe('the request that STARTED the handoff counts', () => {
    it('is the ask when the waiting texts carry none', () => {
        expect(replayAsk(null, { reason: 'human_request' })).toEqual({ ask: 'person', fromEpisode: true });
        expect(replayAsk(null, { reason: 'complaint' })).toEqual({ ask: 'complaint', fromEpisode: true });
        expect(replayAsk(null, { reason: 'discount_request' })).toEqual({ ask: 'discount', fromEpisode: true });
        expect(replayAsk(null, { reason: 'customer_accepted_human_offer' })).toEqual({ ask: 'person', fromEpisode: true });
        expect(replayAsk(null, { reason: 'custom_trigger:garantía' })).toEqual({ ask: 'other', fromEpisode: true });
    });
    it('a promised handoff counts as a request for a person: it only happens when the customer asked or accepted', () => {
        expect(replayAsk(null, { reason: 'agent_promised_handoff' })).toEqual({ ask: 'person', fromEpisode: true });
        expect(returnAskOf('agent_promised_handoff')).toBe('person');
    });
    it('does not override what the waiting texts asked', () => {
        expect(replayAsk('complaint', { reason: 'human_request' })).toEqual({ ask: 'complaint', fromEpisode: false });
    });
    it('is nothing for a handoff the customer did not ask for', () => {
        for (const reason of ['vip', 'max_failed_attempts', 'llm_budget_exhausted', undefined, null, 42]) {
            expect(replayAsk(null, { reason })).toEqual({ ask: null, fromEpisode: false });
        }
        expect(replayAsk(null, undefined)).toEqual({ ask: null, fromEpisode: false });
    });
    it('the follow-up says it is the original request', () => {
        const note = returnNoteTask('person', 'necesito hablar con una persona', true);
        expect(note.title).toBe('Cliente pidió hablar con una persona y nadie respondió');
        expect(note.description).toContain('necesito hablar con una persona');
        expect(note.description).toContain('atención humana');
    });
});

describe('the replay never offers a person either', () => {
    const PRODUCTION = 'No tengo el horario de atención configurado. ¿Quiere que le pase con alguien del equipo para que le confirme?';

    it('removes the offer from the exact production reply', () => {
        expect(removeHumanOfferSentences(PRODUCTION)).toBe('No tengo el horario de atención configurado.');
    });
    it.each([
        'Atendemos de 9 a 18. ¿Quiere que le pase con alguien del equipo?',
        'Atendemos de 9 a 18. Would you like me to ask someone from the team to confirm it?',
        'Atendemos de 9 a 18. Quer que eu peça a alguém da equipe para confirmar?',
        "Atendemos de 9 a 18. Souhaitez-vous que je demande à quelqu'un de l'équipe de la confirmer ?",
        'Atendemos de 9 a 18. ¿Desea hablar con un asesor?',
    ])('sanitizeReplayReply drops the offer in «%s»', reply => {
        const out = sanitizeReplayReply(reply, 'es', false);
        expect(out).toBe('Atendemos de 9 a 18.');
    });
    it('adds the true note instead when the request was left, and the unavailable line when nothing is left', () => {
        expect(sanitizeReplayReply(PRODUCTION, 'es', true)).toBe(
            'No tengo el horario de atención configurado.\n\nDejé su solicitud anotada para que el equipo la vea y le contacte cuando esté disponible.');
        expect(sanitizeReplayReply('¿Quiere que le pase con alguien del equipo?', 'es', false))
            .toBe('En este momento el equipo no está disponible; con gusto le ayudo mientras tanto.');
    });
    it('leaves an ordinary answer untouched, including handing over a THING', () => {
        const ordinary = 'Atendemos de lunes a viernes de 9 a 18. ¿Le paso el menú del equipo?';
        expect(sanitizeReplayReply(ordinary, 'es', true)).toBe(ordinary);
        expect(sanitizeReplayReply('Con gusto le ayudo.', 'es', false)).toBe('Con gusto le ayudo.');
    });
    it('still rewrites a promise of a transfer', () => {
        expect(promisesHumanHandoff(sanitizeReplayReply('Un asesor se comunicará con usted.', 'es', false))).toBe(false);
    });
});

/**
 * The promise detector also catches staff «will attend you» phrasing. That is an ANSWER about the
 * service (who serves the customer, when), not a transfer: on a replay it must stay exactly as the
 * model wrote it. Only a sentence that names a transfer, a connection or a contact by a person, or
 * offers one, is taken out.
 */
describe('the replay sanitiser keeps what is an answer', () => {
    const SERVICE_ANSWERS: Array<[string, string]> = [
        ['es', 'Nuestro equipo de estilistas le atenderá con gusto el sábado de 9 a 6.'],
        ['es', 'Un especialista lo atenderá en su cita del martes.'],
        ['en', 'Our team of stylists will be with you on Saturday.'],
    ];

    it.each(SERVICE_ANSWERS)('keeps «%s» «%s» verbatim, with or without a note to leave', (lang, text) => {
        expect(promisesHumanHandoff(text)).toBe(true); // the detector does catch it: this is the regression
        expect(sanitizeReplayReply(text, lang, false)).toBe(text);
        expect(sanitizeReplayReply(text, lang, true)).toBe(text);
        expect(rewriteReplayPromise(text, lang, true)).toBe(text);
    });

    it('keeps it inside a longer answer, and still removes the contact promise next to it', () => {
        const reply = 'Nuestro equipo de estilistas le atenderá el sábado de 9 a 6. Un asesor se comunicará con usted.';
        expect(sanitizeReplayReply(reply, 'es', false)).toBe('Nuestro equipo de estilistas le atenderá el sábado de 9 a 6.');
    });

    it.each([
        'Un asesor se comunicará con usted.',
        'Nuestro equipo se pondrá en contacto con usted.',
        'El equipo lo contactará cuando esté disponible.',
        'The team will contact you as soon as possible.',
        'Le paso con nuestro equipo especializado.',
        "I'll transfer you to an agent from our team.",
        '¿Quiere que le pase con alguien del equipo?',
        'Si quiere, le paso con un asesor.',
    ])('still removes «%s»', sentence => {
        const out = sanitizeReplayReply(`Atendemos de lunes a viernes. ${sentence}`, 'es', false);
        expect(out).toBe('Atendemos de lunes a viernes.');
    });

    it('keeps the figure a dropped sentence carried', () => {
        expect(sanitizeReplayReply('Su cita es el martes a las 3, un asesor se comunicará con usted.', 'es', false))
            .toBe('Su cita es el martes a las 3.');
    });
});
