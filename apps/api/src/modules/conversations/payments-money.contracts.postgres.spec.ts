import { buildWorld, isolationUrl, SAY_YES, type World } from './__fixtures__/n3-money-identity.harness';
import { PaymentOperationService } from './payment-operation.service';
import { discountToolsForRuntime, paymentToolsForRuntime } from './payment-tool-registration';
import { APPLY_DISCOUNT_TOOL } from './tools/ecommerce-tools';

/**
 * CORE-PAY-01..07 on a real PostgreSQL schema. Real: AIToolExecutorService.execute,
 * ToolExecutionControlService (ledger, confirmation token, approval tickets),
 * PaymentOperationService, ChatIdentityService. Simulated: payment provider, SMTP, SMS.
 * Oracles are table rows, provider call counters and returned error codes.
 */
(isolationUrl ? describe : describe.skip)('N3 money contracts (CORE-PAY-01..07)', () => {
    jest.setTimeout(120_000);
    let w: World;

    beforeAll(async () => {
        w = await buildWorld('pay');
        await (w.controls as any).ensureControlTables(w.schema);
        await (w.payments as any).ensureTable(w.schema);
    });
    afterAll(async () => { await w?.destroy(); });
    beforeEach(() => { w.plan.customerPayments = true; w.sim.reset(); w.sim.payables.clear(); });

    const count = async (table: string, where = 'TRUE', params: any[] = []) =>
        Number((await w.q(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`, params))[0].n);
    const providerEffects = () => w.sim.calls.applyDiscount.length + w.sim.calls.createPaymentLink.length + w.sim.calls.refundPayment.length;
    const moneyRowsExecuting = () => count('payment_operation_ledger', `status IN ('processing','succeeded')`);

    /** Verified contact + conversation + a first inbound. */
    async function customer(opts: { verified?: boolean; email?: string | null; phone?: string | null } = {}) {
        const contactId = await w.newContact(opts.email === undefined && opts.phone === undefined ? {} : { email: opts.email, phone: opts.phone });
        const conversationId = await w.newConversation(contactId);
        await w.inbound(conversationId, 'Hola, quiero un descuento');
        if (opts.verified) await w.verify(conversationId, contactId);
        return { contactId, conversationId };
    }
    const ledgerFor = async (conversationId: string, tool: string) =>
        (await w.q(`SELECT * FROM tool_execution_ledger WHERE conversation_id=$1::uuid AND tool_name=$2 ORDER BY created_at DESC LIMIT 1`, [conversationId, tool]))[0];
    const tickets = (conversationId: string) =>
        w.q(`SELECT * FROM tool_approval_tickets WHERE conversation_id=$1::uuid ORDER BY created_at`, [conversationId]);

    /** challenge -> explicit yes -> approval ticket pending. Returns the three results. */
    async function toAwaitingApproval(c: { contactId: string; conversationId: string }, tool: string, args: any, opts: any = {}, yes = SAY_YES) {
        const challenge = await w.run(c.contactId, c.conversationId, tool, args, opts);
        await w.inbound(c.conversationId, yes);
        const afterYes = await w.run(c.contactId, c.conversationId, tool, args, opts);
        return { challenge, afterYes };
    }
    async function approve(conversationId: string) {
        const [ticket] = await tickets(conversationId);
        await w.controls.decideApprovalTicket({ tenantId: w.tenantId, ticketId: ticket.id, actorId: '99999999-9999-4999-8999-999999999999', decision: 'approved' });
        return ticket;
    }

    describe('CORE-PAY-01 apply_discount needs identity, confirmation and human approval', () => {
        const args = { percent: 10, reason: 'Prueba QA' };
        const opts = { maxDiscountPercent: 15 };

        it('(a) an unverified chat gets identity_verification_required and nothing is attempted', async () => {
            const c = await customer({ verified: false });
            const executingBefore = await moneyRowsExecuting();
            const result = await w.run(c.contactId, c.conversationId, 'apply_discount', args, opts);
            expect(result).toMatchObject({ error: 'identity_verification_required', needsVerification: true });
            expect(w.sim.calls.applyDiscount).toHaveLength(0);
            expect(await ledgerFor(c.conversationId, 'apply_discount')).toBeUndefined();
            expect(await moneyRowsExecuting()).toBe(executingBefore);
        });

        it('(b) a verified chat that did not confirm gets confirmation_required', async () => {
            const c = await customer({ verified: true });
            const result = await w.run(c.contactId, c.conversationId, 'apply_discount', args, opts);
            expect(result).toMatchObject({ error: 'confirmation_required' });
            expect((await ledgerFor(c.conversationId, 'apply_discount')).status).toBe('awaiting_confirmation');
            expect(await tickets(c.conversationId)).toHaveLength(0);
            expect(w.sim.calls.applyDiscount).toHaveLength(0);
        });

        it('(c) confirmed without an approval ticket stays awaiting_approval with a pending ticket', async () => {
            const c = await customer({ verified: true });
            const { afterYes } = await toAwaitingApproval(c, 'apply_discount', args, opts);
            expect(afterYes).toMatchObject({ error: 'approval_required' });
            expect((await ledgerFor(c.conversationId, 'apply_discount')).status).toBe('awaiting_approval');
            const rows = await tickets(c.conversationId);
            expect(rows).toHaveLength(1);
            expect(rows[0].status).toBe('pending');
            expect(w.sim.calls.applyDiscount).toHaveLength(0);
            expect(await moneyRowsExecuting()).toBe(0);
        });

        it('(d) an approved ticket is void when a new inbound arrives before execution', async () => {
            const c = await customer({ verified: true });
            await toAwaitingApproval(c, 'apply_discount', args, opts);
            await approve(c.conversationId);
            await w.inbound(c.conversationId, 'Por cierto, mejor dame 25%');
            const result = await w.run(c.contactId, c.conversationId, 'apply_discount', args, opts);
            expect(result).toMatchObject({ error: 'approval_stale_due_to_new_inbound' });
            expect(w.sim.calls.applyDiscount).toHaveLength(0);
            expect(await count('payment_operation_ledger', `execution_ledger_id=$1::uuid`, [(await ledgerFor(c.conversationId, 'apply_discount')).id])).toBe(0);
        });

        it('(e) positive control: verified + confirmed + approved executes exactly once with the ledger id as idempotency key', async () => {
            const c = await customer({ verified: true });
            await toAwaitingApproval(c, 'apply_discount', args, opts);
            await approve(c.conversationId);
            const result = await w.run(c.contactId, c.conversationId, 'apply_discount', args, opts);
            expect(result).toMatchObject({ success: true, percent: 10, reconciled: true });
            expect(w.sim.calls.applyDiscount).toHaveLength(1);
            const [op] = await w.q(`SELECT * FROM payment_operation_ledger WHERE operation_kind='discount' AND status='succeeded' ORDER BY created_at DESC LIMIT 1`);
            expect(w.sim.calls.applyDiscount[0]).toMatchObject({ percent: 10, idempotencyKey: op.id, contactId: c.contactId });
            // a replay in the same conversation never re-executes
            const replay = await w.run(c.contactId, c.conversationId, 'apply_discount', args, opts);
            expect(replay).toMatchObject({ idempotentReplay: true });
            expect(w.sim.calls.applyDiscount).toHaveLength(1);
        });
    });

    describe('CORE-PAY-02 discount ceiling (never above 30, never above the business cap)', () => {
        const direct = (percent: unknown, max?: number) =>
            w.payments.applyDiscount(w.schema, w.tenantId, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
                { percent, reason: 'qa' }, max);

        it.each([[0, 15], [-5, 15], [31, 15], [31, undefined], [16, 15], [Number.NaN, 15], [13, 12.5]])(
            'rejects percent=%p with max=%p as invalid_discount, ceiling=min(30,max), provider untouched', async (percent, max) => {
                const ledgerRowsBefore = await count("payment_operation_ledger");
                const result = await direct(percent, max);
                expect(result).toMatchObject({ error: 'invalid_discount', maxPercent: Math.min(30, Math.floor(max ?? 30)) });
                expect(w.sim.calls.applyDiscount).toHaveLength(0);
                expect(await count('payment_operation_ledger')).toBe(ledgerRowsBefore);
            });

        it.each([0, -1, -50])('max=%p disables discounts and forces handoff', async max => {
            const result = await direct(10, max);
            expect(result).toMatchObject({ error: 'discounts_disabled', shouldHandoff: true });
            expect(w.sim.calls.applyDiscount).toHaveLength(0);
        });

        it('rounds 3.4 to 3 through the real approval flow and sends exactly 3 to the provider', async () => {
            const c = await customer({ verified: true });
            const a = { percent: 3.4, reason: 'qa' }, o = { maxDiscountPercent: 15 };
            await toAwaitingApproval(c, 'apply_discount', a, o);
            await approve(c.conversationId);
            expect(await w.run(c.contactId, c.conversationId, 'apply_discount', a, o)).toMatchObject({ success: true, percent: 3 });
            expect(w.sim.calls.applyDiscount.map(x => x.percent)).toEqual([3]);
        });

        it('fails closed: with neither a verified scope nor a ceiling nothing bounds the grant, so no discount', async () => {
            const c = await customer({ verified: true });
            const result = await w.run(c.contactId, c.conversationId, 'apply_discount', { percent: 30, reason: 'qa' }, {});
            expect(result).toMatchObject({ error: 'discounts_disabled', shouldHandoff: true });
            expect((await tickets(c.conversationId)).length).toBe(0);
            expect(w.sim.calls.applyDiscount).toEqual([]);
        });
    });

    describe('CORE-PAY-03 no capable provider: tool not published, invocation escalates without inventing a code', () => {
        const cfg = { canApplyDiscount: true, maxDiscountPercent: 10 };
        const cap = (discountsAvailable: boolean) => ({ planEnabled: true, configured: true, ready: true, statusAvailable: true, discountsAvailable });

        it('publishes apply_discount only when the provider can apply discounts', () => {
            expect(discountToolsForRuntime(cfg, cap(false))).toEqual([]);
            expect(discountToolsForRuntime(cfg, cap(true))).toEqual([APPLY_DISCOUNT_TOOL]);
            expect(discountToolsForRuntime({ ...cfg, maxDiscountPercent: 0 }, cap(true))).toEqual([]);
        });

        it('with provider=null the confirmed+approved call ends handoff_required with no code', async () => {
            const noProvider = new PaymentOperationService(w.prisma, undefined, { isFeatureEnabled: async () => true } as any);
            const original = (w.executor as any).paymentOperations;
            (w.executor as any).paymentOperations = noProvider;
            try {
                const c = await customer({ verified: true });
                const a = { percent: 5, reason: 'qa' }, o = { maxDiscountPercent: 10 };
                await toAwaitingApproval(c, 'apply_discount', a, o);
                await approve(c.conversationId);
                const result = await w.run(c.contactId, c.conversationId, 'apply_discount', a, o);
                expect(result).toMatchObject({ error: 'payment_provider_unavailable', shouldHandoff: true });
                expect(JSON.stringify(result)).not.toMatch(/"code"/);
                const [op] = await w.q(`SELECT status FROM payment_operation_ledger ORDER BY created_at DESC LIMIT 1`);
                expect(op.status).toBe('handoff_required');
                expect(providerEffects()).toBe(0);
            } finally { (w.executor as any).paymentOperations = original; }
        });
    });

    describe('CORE-PAY-04 / 05 create_payment_link', () => {
        const OWN = 'order:own-49900';
        let scope: any;
        beforeEach(async () => { scope = await w.scope(); });
        const payable = (contactId: string, over: any = {}) =>
            w.sim.payables.set(OWN, { contactId, amountCents: 49900, currency: 'COP', description: 'Pedido de prueba', paymentStatus: 'pending', ...over });
        const link = (c: any, args: any = { payableReference: OWN }) =>
            w.run(c.contactId, c.conversationId, 'create_payment_link', args, { operationalScope: scope });

        it('(a)(b) rejects another contact\'s payable and an invented reference', async () => {
            const owner = await customer({ verified: true });
            payable(owner.contactId);
            const stranger = await customer({ verified: true });
            expect(await link(stranger)).toMatchObject({ error: 'payment_ownership_unverified' });
            expect(await link(stranger, { payableReference: 'order:invented' })).toMatchObject({ error: 'payment_ownership_unverified' });
            expect(w.sim.calls.createPaymentLink).toHaveLength(0);
            expect(await ledgerFor(stranger.conversationId, 'create_payment_link')).toBeUndefined();
        });

        it('(c) refuses when the plan has no customerPayments', async () => {
            const c = await customer({ verified: true });
            payable(c.contactId);
            w.plan.customerPayments = false;
            expect(await link(c)).toMatchObject({ error: 'customer_payments_not_in_plan' });
            expect(w.sim.calls.createPaymentLink).toHaveLength(0);
        });

        it('(d) refuses and escalates when there is no provider', async () => {
            const c = await customer({ verified: true });
            payable(c.contactId);
            const original = (w.executor as any).paymentOperations;
            (w.executor as any).paymentOperations = new PaymentOperationService(w.prisma, undefined, { isFeatureEnabled: async () => true } as any);
            try {
                expect(await link(c)).toMatchObject({ error: 'payment_provider_unavailable', shouldHandoff: true });
            } finally { (w.executor as any).paymentOperations = original; }
            expect(w.sim.calls.createPaymentLink).toHaveLength(0);
        });

        it('(e) the amount comes from the server: an injected amountCents:1 changes neither the challenge nor the args hash', async () => {
            const honest = await customer({ verified: true });
            const forged = { contactId: honest.contactId, conversationId: await w.newConversation(honest.contactId) };
            await w.inbound(forged.conversationId, 'Quiero pagar');
            payable(honest.contactId);
            const first = await link(honest);
            const second = await link(forged, { payableReference: OWN, amountCents: 1, currency: 'USD' });
            for (const result of [first, second]) {
                expect(result).toMatchObject({ error: 'confirmation_required', payment: { amountCents: 49900, currency: 'COP' } });
            }
            const hashes = await w.q(`SELECT DISTINCT args_hash FROM tool_execution_ledger
                WHERE tool_name='create_payment_link' AND conversation_id IN ($1::uuid,$2::uuid)`, [honest.conversationId, forged.conversationId]);
            expect(hashes).toHaveLength(1);
            expect(w.sim.calls.createPaymentLink).toHaveLength(0);
        });

        it('(05 a-c) no link before confirming; one link after "sí"; a retry replays the same operation', async () => {
            const c = await customer({ verified: true });
            payable(c.contactId);
            const challenge = await link(c);
            expect(challenge).toMatchObject({ error: 'confirmation_required' });
            expect(challenge.confirmationSummary).toEqual(expect.stringContaining('por Pedido de prueba'));
            expect(w.sim.calls.createPaymentLink).toHaveLength(0);

            await w.inbound(c.conversationId, 'Sí, pago');
            const created = await link(c);
            expect(created).toMatchObject({ linkCreated: true, paid: false, paymentStatus: 'pending', amountCents: 49900 });
            expect(created.paymentLink).toMatch(/^https:\/\//);
            expect(w.sim.calls.createPaymentLink).toHaveLength(1);
            const [op] = await w.q(`SELECT * FROM payment_operation_ledger WHERE operation_kind='payment_link'`);
            expect(w.sim.calls.createPaymentLink[0].idempotencyKey).toBe(op.id);
            expect(op.status).toBe('succeeded');

            const retry = await link(c);
            expect(retry).toMatchObject({ operationId: created.operationId, idempotentReplay: true });
            expect(w.sim.calls.createPaymentLink).toHaveLength(1);
            expect(await count('payment_operation_ledger', `operation_kind='payment_link'`)).toBe(1);
        });

        it('(05 d) if the order total changes between challenge and "sí", no link is created at the old price', async () => {
            const c = await customer({ verified: true });
            payable(c.contactId);
            expect(await link(c)).toMatchObject({ error: 'confirmation_required' });
            payable(c.contactId, { amountCents: 79900 });
            await w.inbound(c.conversationId, 'Sí, pago');
            const result = await link(c);
            expect(result.linkCreated).toBeUndefined();
            expect(result).toMatchObject({ error: 'confirmation_required', payment: { amountCents: 79900 } });
            expect(w.sim.calls.createPaymentLink).toHaveLength(0);
        });
    });

    describe('CORE-PAY-06 get_payment_status trusts the provider, not the customer', () => {
        const REF = 'order:status-1';
        const status = async (c: any, args: any = { payableReference: REF }) => w.run(c.contactId, c.conversationId, 'get_payment_status', args);
        const seed = (contactId: string, paymentStatus: any) =>
            w.sim.payables.set(REF, { contactId, amountCents: 1000, currency: 'COP', description: 'Pedido', paymentStatus });

        it('paid===true only for the provider status "paid", even if the customer says they paid', async () => {
            const c = await customer({ verified: true });
            await w.inbound(c.conversationId, 'Ya pagué, te lo juro, mira el comprobante');
            const ledgerBefore = await count('tool_execution_ledger');
            seed(c.contactId, 'pending');
            expect(await status(c)).toMatchObject({ found: true, paymentStatus: 'pending', paid: false });
            seed(c.contactId, 'paid');
            expect(await status(c)).toMatchObject({ found: true, paymentStatus: 'paid', paid: true });
            expect(await count('tool_execution_ledger')).toBe(ledgerBefore);
        });

        it.each(['ambiguous', 'requires_review'])('%s requires review and handoff, never paid', async paymentStatus => {
            const c = await customer({ verified: true });
            seed(c.contactId, paymentStatus);
            expect(await status(c)).toMatchObject({ found: true, paid: false, requiresReview: true, shouldHandoff: true });
        });

        it('provider error, missing provider and another contact\'s reference never claim payment', async () => {
            const c = await customer({ verified: true });
            seed(c.contactId, 'paid');
            w.sim.state.statusMode = 'throw';
            expect(await status(c)).toMatchObject({ error: 'payment_status_unavailable', found: false, shouldHandoff: true });
            w.sim.state.statusMode = 'normal';
            const stranger = await customer({ verified: true });
            const foreign = await status(stranger);
            expect(foreign).toMatchObject({ found: false, error: 'payment_not_found' });
            expect(foreign.paid).toBeUndefined();
            const original = (w.executor as any).paymentOperations;
            (w.executor as any).paymentOperations = new PaymentOperationService(w.prisma, undefined, { isFeatureEnabled: async () => true } as any);
            try {
                expect(await status(c)).toMatchObject({ error: 'payment_status_unavailable', shouldHandoff: true });
            } finally { (w.executor as any).paymentOperations = original; }
        });
    });

    describe('CORE-PAY-07 refund_payment is impossible without full A4 and is not published', () => {
        const refund = { paymentReference: 'pay:1', currency: 'COP', reason: 'Producto defectuoso' };

        it('requires identity, then confirmation, then a human ticket; the provider is never called', async () => {
            const unverified = await customer({ verified: false });
            expect(await w.run(unverified.contactId, unverified.conversationId, 'refund_payment', refund))
                .toMatchObject({ error: 'identity_verification_required' });

            const c = await customer({ verified: true });
            expect(await w.run(c.contactId, c.conversationId, 'refund_payment', refund)).toMatchObject({ error: 'confirmation_required' });
            await w.inbound(c.conversationId, SAY_YES);
            expect(await w.run(c.contactId, c.conversationId, 'refund_payment', refund)).toMatchObject({ error: 'approval_required' });
            expect((await ledgerFor(c.conversationId, 'refund_payment')).status).toBe('awaiting_approval');
            expect(w.sim.calls.refundPayment).toHaveLength(0);
        });

        it.each([
            ['negative amount', { ...refund, amountCents: -5 }],
            ['missing reason', { paymentReference: 'pay:1', currency: 'COP' }],
        ])('even fully approved, %s is rejected as invalid_refund_request', async (_name, args) => {
            const c = await customer({ verified: true });
            await toAwaitingApproval(c, 'refund_payment', args);
            await approve(c.conversationId);
            expect(await w.run(c.contactId, c.conversationId, 'refund_payment', args)).toMatchObject({ error: 'invalid_refund_request' });
            expect(w.sim.calls.refundPayment).toHaveLength(0);
        });

        it('paymentToolsForRuntime never publishes refund_payment', () => {
            const capability = { planEnabled: true, configured: true, ready: true, statusAvailable: true, discountsAvailable: true };
            const names = paymentToolsForRuntime({ enabled: true, canCreateLinks: true }, capability).map(t => t.name);
            expect(names).toEqual(expect.arrayContaining(['create_payment_link', 'get_payment_status']));
            expect(names).not.toContain('refund_payment');
        });
    });
});
