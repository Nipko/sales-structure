import { classifyFlowFailure, FlowSendFailed } from './flow-fallback';

/**
 * ═══ A FAILED FLOW MAY ONLY BECOME A SECOND MESSAGE ON PROOF ═══
 *
 * The defect these tests fix: `catch (e) { fall back to text }` swallowed every
 * error equally. A 400 for an unpublished flow and a ten-second timeout took the
 * same branch — and on a timeout the Flow may well have been delivered, so the
 * fallback put a second message on the customer's phone and a second charge on
 * the business's account, under one reservation that can only settle once.
 *
 * Every case below is written as "what does this failure PROVE", because that
 * is the only question that may authorise a second POST.
 */

const answered = (status: number, body: unknown) =>
    new FlowSendFailed('flow failed', { status, body });

const metaError = (code: number, subcode?: number) => ({
    error: { code, message: 'nope', ...(subcode ? { error_subcode: subcode } : {}) },
});

describe('a Flow that came back refused', () => {
    it('may fall back when Meta conclusively rejected it', () => {
        // An unpublished or malformed flow: Meta answered, named the problem,
        // and issued no receipt. Nothing was delivered.
        const verdict = classifyFlowFailure(answered(400, metaError(100)));
        expect({ kind: verdict.kind, mayFallBack: verdict.mayFallBack })
            .toEqual({ kind: 'rejected', mayFallBack: true });
    });

    it('does not fall back on a timeout', () => {
        // The case that produced two POSTs. Ten seconds of silence says nothing
        // about whether Meta queued the Flow.
        const timeout = new FlowSendFailed('aborted',
            { cause: Object.assign(new Error('t'), { name: 'TimeoutError' }) });
        expect(classifyFlowFailure(timeout))
            .toEqual({ kind: 'indeterminate', errorCode: 'flow_provider_timeout', mayFallBack: false });
    });

    it('does not fall back on an error that carries no evidence at all', () => {
        // A bare `Error(message)` is what the adapter used to throw. Read as a
        // rejection it authorises a duplicate; read as indeterminate it costs an
        // operator one lookup.
        const verdict = classifyFlowFailure(new Error('Flow message failed'));
        expect(verdict.mayFallBack).toBe(false);
        expect(verdict.errorCode).toContain('flow_transport_failure');
    });

    it('does not fall back on a 5xx that carries no Graph error', () => {
        // An answered 5xx with no error envelope does not show the provider did
        // nothing. Exactly the rule the durable lane already applies.
        expect(classifyFlowFailure(answered(500, {})).mayFallBack).toBe(false);
    });

    it('defers to the shared classifier on a 5xx that DOES carry one', () => {
        // Deliberately NOT a second opinion. Graph answers with an error
        // envelope only when it did not create the object, so the shared
        // classifier reads that as a refusal whatever the status line says —
        // and a rule invented here would eventually disagree with the durable
        // lane about the same answer, which is how one failure comes to be
        // handled two ways.
        expect(classifyFlowFailure(answered(503, metaError(1))).mayFallBack).toBe(true);
    });

    it('does not fall back on a rate limit', () => {
        // "Not now" is not "never". The effect will be retried as itself, and a
        // fallback here would make the customer's second message a third.
        const verdict = classifyFlowFailure(answered(429, metaError(80007)));
        expect(verdict.mayFallBack).toBe(false);
        expect(verdict.errorCode).toContain('retryable');
    });

    it('does not fall back when the body could not even be read', () => {
        // HTML from an edge, a cut stream. No provider contract applies.
        expect(classifyFlowFailure(answered(502, '<html>gateway</html>')).mayFallBack).toBe(false);
        expect(classifyFlowFailure(answered(400, null)).mayFallBack).toBe(false);
    });

    it('does not fall back when Meta actually accepted it', () => {
        // A receipt in the body of a "failure" means the Flow went out. Sending
        // text as well would be the duplicate, not the recovery.
        const verdict = classifyFlowFailure(
            answered(200, { messages: [{ id: 'wamid.ACCEPTED' }] }));
        expect(verdict).toEqual({
            kind: 'indeterminate', errorCode: 'flow_accepted_after_all', mayFallBack: false,
        });
    });

    it('carries the provider code forward so a refusal can be diagnosed', () => {
        const verdict = classifyFlowFailure(answered(400, metaError(131009)));
        expect(verdict.errorCode).toContain('131009');
    });
});

describe('what the rule is, stated once', () => {
    it('never authorises a second POST without a conclusive rejection', () => {
        // The invariant, over every shape above: `mayFallBack` implies `rejected`.
        const failures = [
            answered(400, metaError(100)),
            answered(500, {}),
            answered(429, metaError(80007)),
            answered(502, '<html>'),
            answered(200, { messages: [{ id: 'x' }] }),
            new Error('bare'),
            new FlowSendFailed('t', { cause: Object.assign(new Error('t'), { name: 'AbortError' }) }),
        ];
        for (const failure of failures) {
            const verdict = classifyFlowFailure(failure);
            expect({ mayFallBack: verdict.mayFallBack, kind: verdict.kind })
                .toEqual({ mayFallBack: verdict.kind === 'rejected', kind: verdict.kind });
        }
    });
});
