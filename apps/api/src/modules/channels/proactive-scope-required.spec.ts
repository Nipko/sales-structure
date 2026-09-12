import { ProactiveDispatchService } from './proactive-dispatch.service';

/**
 * ═══ AN EMPTY OBJECT IS TRUTHY, AND IT IS NOT AN AUTHORITY ═══
 *
 * `send` guarded with `if (!input.operationalScope)`, so `{}` — or any object a
 * producer built when its own authority lookup came back empty — walked
 * straight through. The row was then committed, published and leased, and
 * `admit` refused it with `dispatch_authority_required` every single time, for
 * ever: an effect that can only fail, discovered hours later for a scheduled
 * message, with a diagnosis that reads like a permission problem rather than a
 * producer bug.
 *
 * The three kinds are the closed set the outbox accepts, so the entrance can
 * ask the cheap half of the question — "did the producer bring one at all" —
 * and leave the full validation to the transaction that grants the lease and
 * can read the rows the scope refers to.
 *
 * These cases never reach a database: the refusal has to happen BEFORE the row
 * exists, so a test that needed one would be testing the wrong end.
 */
describe('the authority a proactive effect is sent under', () => {
    /** No store, no queue: nothing below the guard may be reached. */
    const service = () => new ProactiveDispatchService(
        { executeInTenantSchema: async () => { throw new Error('must not reach the database'); } } as any,
        { prepare: async () => { throw new Error('must not prepare a row'); } } as any,
        { enqueueDispatch: async () => { throw new Error('must not publish'); } } as any,
    );

    const send = (operationalScope: unknown) => service().send('t-1', {
        originKey: 'probe:1',
        conversationId: '00000000-0000-4000-8000-000000000001',
        contactId: '00000000-0000-4000-8000-000000000002',
        channelType: 'whatsapp',
        channelAccountId: '15550001111',
        recipient: '+573001112233',
        items: [{ kind: 'text', payload: { body: 'hola' } }],
        operationalScope,
    } as any);

    it.each([
        ['nothing at all', undefined],
        ['null', null],
        ['an empty object a lookup returned', {}],
        ['an object with no kind', { tenantId: 't-1', schemaName: 'tenant_x' }],
        ['a kind nobody defined', { kind: 'legacy' }],
        ['a kind that is not a string', { kind: 7 }],
    ])('refuses %s before any row exists', async (_case, scope) => {
        await expect(send(scope)).resolves.toEqual({
            kind: 'suppressed', reason: 'policy_authority_unavailable',
        });
    });

    it.each(['served_agent', 'proactive_policy', 'human_operator'])(
        'lets a %s scope through to the machinery that can really check it', async kind => {
            // Past the entrance, the stubs throw and the service turns that
            // into `deferred` — which is the assertion: whatever refused this
            // was the machinery below, not the guard, and the real validation
            // lives where it can read the rows the scope names. `suppressed`
            // here would mean the entrance had rejected a valid kind.
            await expect(send({ kind })).resolves.toEqual({
                kind: 'deferred', reason: expect.stringContaining('must not'),
            });
        });
});
