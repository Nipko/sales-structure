import { EventEmitter2 } from '@nestjs/event-emitter';
import { buildWorld, isolationUrl, SAY_YES, type World } from './__fixtures__/n3-money-identity.harness';
import { DRAFT_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { ToolApprovalWorkflowService } from './tool-approval-workflow.service';

/**
 * CORE-PAY-02 (was P-D1) - business ceiling on discounts survives every path.
 *
 * Promise: apply_discount never grants more than the tenant's `upsell.maxDiscountPercent`.
 *
 * It used to be lost on approval resume: tool-approval-workflow.service.ts called
 * executor.execute(..., { authority, operationalScope, channelType }) with no
 * `maxDiscountPercent`, so the ceiling fell back to the platform 30. The ceiling is now
 * resolved on the server from the stored agent configuration named by the verified scope, inside
 * the executor, so no caller can omit it. These cases run the REAL ToolApprovalWorkflowService.
 */
(isolationUrl ? describe : describe.skip)('N3 CORE-PAY-02: discount cap on every path incl. approval resume', () => {
    jest.setTimeout(120_000);
    let w: World;
    let workflow: ToolApprovalWorkflowService;
    const ACCOUNT = 'acct-cap';
    const ACTOR = '99999999-9999-4999-8999-999999999999';

    beforeAll(async () => {
        w = await buildWorld('cap');
        await (w.controls as any).ensureControlTables(w.schema);
        await (w.payments as any).ensureTable(w.schema);
        await w.q(`UPDATE agent_personas SET config_json='{"upsell":{"maxDiscountPercent":15}}'::jsonb,
            channel_bindings=ARRAY['whatsapp:${ACCOUNT}'],is_active=true WHERE id=$1::uuid`, [w.agentId]);
        // Only the global tenant precheck is simulated; the context transaction, routing and ledger are real.
        Object.defineProperty(w.prisma, 'tenant', { value: { findUnique: async ({ where }: any) =>
            where.id === w.tenantId ? { schemaName: w.schema, isActive: true, industry: 'retail', settings: {}, operatingCountry: null } : null } });
        workflow = new ToolApprovalWorkflowService(w.prisma, w.controls, w.executor, new EventEmitter2(), {} as any,
            { resolve: async () => ({ status: { status: 'ok' }, authority: authorityFor('apply_discount') }) } as any, {} as any);
    });
    afterAll(async () => { await w?.destroy(); });
    beforeEach(() => w.sim.reset());

    async function customer() {
        const contactId = await w.newContact();
        const conversationId = await w.newConversation(contactId);
        await w.q('UPDATE conversations SET channel_account_id=$2 WHERE id=$1::uuid', [conversationId, ACCOUNT]);
        await w.inbound(conversationId, 'Dame 25% de descuento');
        await w.verify(conversationId, contactId);
        return { contactId, conversationId };
    }
    const tickets = (conversationId: string) => w.q('SELECT id FROM tool_approval_tickets WHERE conversation_id=$1::uuid', [conversationId]);
    const args = { percent: 25, reason: 'cliente insiste' };

    it('LLM-loop caller (opts cap 15): a 25% request is refused before confirmation, approval or provider', async () => {
        const c = await customer();
        const result = await w.run(c.contactId, c.conversationId, 'apply_discount', args,
            { maxDiscountPercent: 15, operationalScope: await w.scope() });
        expect(result).toMatchObject({ error: 'invalid_discount', maxPercent: 15 });
        expect({ tickets: (await tickets(c.conversationId)).length, granted: w.sim.calls.applyDiscount.length }).toEqual({ tickets: 0, granted: 0 });
    });

    it('a caller that OMITS the cap is still bound by the stored agent configuration (server-side)', async () => {
        const c = await customer();
        const result = await w.run(c.contactId, c.conversationId, 'apply_discount', args, { operationalScope: await w.scope() });
        expect(result).toMatchObject({ error: 'invalid_discount', maxPercent: 15 });
        expect({ tickets: (await tickets(c.conversationId)).length, granted: w.sim.calls.applyDiscount.length }).toEqual({ tickets: 0, granted: 0 });
    });

    it('a ticket created before the pre-check existed is still refused when the real workflow resumes it', async () => {
        const c = await customer();
        const scope = await w.scope();
        const resolver = jest.spyOn(w.executor as any, 'resolveDiscountCeiling').mockResolvedValue({ ok: true, max: undefined });
        try {
            expect(await w.run(c.contactId, c.conversationId, 'apply_discount', args, { operationalScope: scope })).toMatchObject({ error: 'confirmation_required' });
            await w.inbound(c.conversationId, SAY_YES);
            expect(await w.run(c.contactId, c.conversationId, 'apply_discount', args, { operationalScope: scope })).toMatchObject({ error: 'approval_required' });
        } finally { resolver.mockRestore(); }
        const [ticket] = await tickets(c.conversationId);

        const decided: any = await workflow.decide({ tenantId: w.tenantId, ticketId: ticket.id, actorId: ACTOR, decision: 'approved' });

        expect(decided.resume.result).toMatchObject({ error: 'invalid_discount', maxPercent: 15 });
        expect(w.sim.calls.applyDiscount).toEqual([]);
    });

    it('draft mode refuses an out-of-ceiling discount before it becomes a proposal', async () => {
        const c = await customer();
        const result = await w.run(c.contactId, c.conversationId, 'apply_discount', args,
            { executionContext: DRAFT_EXECUTION_CONTEXT, draftScope: { agentId: w.agentId, agentVersion: 1 }, maxDiscountPercent: 15, operationalScope: await w.scope() });
        expect(result).toMatchObject({ error: 'invalid_discount', maxPercent: 15 });
        expect((await w.q('SELECT id FROM tool_execution_ledger WHERE conversation_id=$1::uuid', [c.conversationId])).length).toBe(0);
    });

    it('control: a 10% discount within the cap still flows through approval and is granted once', async () => {
        const c = await customer();
        const scope = await w.scope();
        const ok = { percent: 10, reason: 'fidelidad' };
        expect(await w.run(c.contactId, c.conversationId, 'apply_discount', ok, { operationalScope: scope })).toMatchObject({ error: 'confirmation_required' });
        await w.inbound(c.conversationId, SAY_YES);
        expect(await w.run(c.contactId, c.conversationId, 'apply_discount', ok, { operationalScope: scope })).toMatchObject({ error: 'approval_required' });
        const [ticket] = await tickets(c.conversationId);
        const decided: any = await workflow.decide({ tenantId: w.tenantId, ticketId: ticket.id, actorId: ACTOR, decision: 'approved' });
        expect(decided.resume.result).not.toHaveProperty('error');
        expect(w.sim.calls.applyDiscount.map(call => call.percent)).toEqual([10]);
    });
});
