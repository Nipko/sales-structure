import { awaitAutomaticFaqLookup, awaitToolWithSafeTimeout, canDetachToolAfterTimeout } from './tool-timeout-policy';
import { getToolPolicy, type ToolPolicy } from './tool-policy-registry';

const policy = (overrides: Partial<ToolPolicy> = {}): ToolPolicy => ({
    effect: 'read',
    dataClassification: 'public',
    assurance: 'A0',
    assuranceEnforcement: 'none',
    ownership: 'tenant_scope',
    idempotency: 'not_applicable',
    externalEffect: 'none',
    downstreamEffects: [],
    confirmation: 'not_required',
    humanApproval: 'not_required',
    agentTestAllowed: false,
    origin: 'core',
    commitsBusiness: false,
    ...overrides,
});

describe('tool timeout policy', () => {
    afterEach(() => jest.useRealTimers());

    it('allows a deadline only for an explicitly side-effect-free read', () => {
        expect(canDetachToolAfterTimeout(policy())).toBe(true);
        expect(canDetachToolAfterTimeout(undefined)).toBe(false);
        expect(canDetachToolAfterTimeout(policy({ effect: 'write', commitsBusiness: true }))).toBe(false);
        expect(canDetachToolAfterTimeout(policy({ externalEffect: 'provider_write' }))).toBe(false);
        expect(canDetachToolAfterTimeout(policy({ externalEffect: 'channel_write' }))).toBe(false);
    });

    it('does not report a writer timeout while its commit can still finish', async () => {
        jest.useFakeTimers();
        let commit: (() => void) | undefined;
        const operation = new Promise<string>(resolve => {
            commit = () => resolve('committed');
        });
        const result = awaitToolWithSafeTimeout(
            operation,
            25,
            'create_reservation',
            policy({ effect: 'write', commitsBusiness: true, idempotency: 'central_ledger' }),
        );

        await jest.advanceTimersByTimeAsync(30);
        let settled = false;
        void result.finally(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        commit!();
        await expect(result).resolves.toBe('committed');
    });

    it('rejects a stalled read at the deadline', async () => {
        jest.useFakeTimers();
        const result = awaitToolWithSafeTimeout(
            new Promise<string>(() => undefined),
            25,
            'search_faqs',
            policy(),
        );
        const assertion = expect(result).rejects.toThrow('search_faqs timed out after 25ms');
        await jest.advanceTimersByTimeAsync(25);
        await assertion;
    });

    it('limits the audited automatic FAQ read while retaining the real manual writer policy', async () => {
        jest.useFakeTimers();
        expect(getToolPolicy('search_faqs')).toMatchObject({ effect: 'conditional_write', idempotency: 'central_ledger' });
        const result = awaitAutomaticFaqLookup(new Promise(() => undefined), 25, { mode: 'live', persistence: 'disabled' });
        const assertion = expect(result).rejects.toThrow('automatic_search_faqs timed out after 25ms');
        await jest.advanceTimersByTimeAsync(25);
        await assertion;
        expect(getToolPolicy('search_faqs')).toMatchObject({ effect: 'conditional_write', idempotency: 'central_ledger' });
    });

    it('cannot detach a FAQ lookup that could record views or a ledger', () => {
        const operation = new Promise(() => undefined);
        expect(awaitAutomaticFaqLookup(operation, 25, { mode: 'live', persistence: 'enabled' })).toBe(operation);
    });
});
