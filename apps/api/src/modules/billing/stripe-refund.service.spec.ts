import { randomUUID } from 'crypto';
import { StripeRefundService } from './stripe-refund.service';
import { BillingEventType } from './types/billing-event.enum';

export function refundFixture() {
    const payment: any = { id: randomUUID(), subscriptionId: randomUUID(), tenantId: randomUUID(), provider: 'stripe',
        providerPaymentId: 'in_paid', amountCents: 10000, currency: 'USD', status: 'succeeded', metadata: { railEnvironment: 'sandbox' } };
    const operations = new Map<string, any>();
    const remote: any[] = [];
    const ledger = new Map<string, any>();
    const audits: any[] = [];
    const copy = <T>(value: T): T => structuredClone(value);
    const matches = (row: any, where: any): boolean => !where || Object.entries(where).every(([key, value]: any) => {
        if (key === 'OR') return value.some((v: any) => matches(row, v));
        if (key === 'status' && value?.in) return value.in.includes(row[key]);
        if (value && typeof value === 'object' && ('lt' in value || 'lte' in value)) return row[key] != null && new Date(row[key]).getTime() <= new Date(value.lt ?? value.lte).getTime();
        return row[key] === value || (value === null && row[key] == null);
    });
    const update = (row: any, data: any) => { for (const [key, value] of Object.entries(data)) row[key] = (value as any)?.increment ? (row[key] ?? 0) + (value as any).increment : copy(value); };
    const find = (args: any) => {
        const row = operations.get(args.where.id);
        return row ? { ...copy(row), ...(args.include?.payment ? { payment: copy(payment) } : {}) } : null;
    };
    let transactionTail = Promise.resolve();
    const prisma: any = {
        billingRefundOperation: {
            findUnique: jest.fn(async (args: any) => find(args)),
            findUniqueOrThrow: jest.fn(async (args: any) => { const row = find(args); if (!row) throw new Error('not_found'); return row; }),
            findFirst: jest.fn(async (args: any) => copy([...operations.values()].find(row => matches(row, args.where)) ?? null)),
            findMany: jest.fn(async (args: any) => [...operations.values()].filter(row => matches(row, args?.where)).slice(0, args?.take ?? Infinity).map(copy)),
            create: jest.fn(async ({ data }: any) => { const row = { status: 'reserved', createdAt: new Date(), nextCheckAt: new Date(), attempts: 0,
                firstSubmittedAt: null, providerRefundId: null, processingToken: null, processingUntil: null, ...copy(data) }; operations.set(data.id, row); return copy(row); }),
            update: jest.fn(async ({ where, data }: any) => { const row = operations.get(where.id); update(row, data); return copy(row); }),
            updateMany: jest.fn(async ({ where, data }: any) => { const rows = [...operations.values()].filter(row => matches(row, where)); rows.forEach(row => update(row, data)); return { count: rows.length }; }),
        },
        billingPayment: {
            findUnique: jest.fn(async ({ where }: any) => where.id === payment.id ? copy(payment) : null),
            findUniqueOrThrow: jest.fn(async () => copy(payment)),
            findFirst: jest.fn(async ({ where }: any) => where.providerPaymentId === payment.providerPaymentId ? copy(payment) : null),
            update: jest.fn(async ({ data }: any) => { update(payment, data); return copy(payment); }),
        },
        billingEvent: {
            findUnique: jest.fn(async ({ where }: any) => ledger.get(where.provider_providerEventId.providerEventId) ?? null),
            create: jest.fn(async ({ data }: any) => { ledger.set(data.providerEventId, copy(data)); return data; }),
        },
        auditLog: { create: jest.fn(async ({ data }: any) => { audits.push(data); return data; }) },
        $queryRawUnsafe: jest.fn(async () => [{ id: payment.id }]),
        $executeRawUnsafe: jest.fn(async () => 1),
        $transaction: jest.fn((fn: any) => {
            const current = transactionTail.then(() => fn(prisma));
            transactionTail = current.then(() => undefined, () => undefined);
            return current;
        }),
    };
    const snapshot = () => ({ paymentIntentId: 'pi_paid', amountPaidCents: 10000, currency: 'USD', livemode: false,
        refunds: copy(remote), succeededAmountCents: remote.filter(r => r.status === 'succeeded').reduce((sum, r) => sum + r.amountCents, 0) });
    const create = async (_id: string, amount: number, context: any) => {
        let refund = remote.find(r => r.operationId === context.operationId);
        if (!refund) { refund = { id: `re_${context.operationId}`, operationId: context.operationId, amountCents: amount,
            currency: 'USD', paymentIntentId: 'pi_paid', livemode: false, status: 'succeeded' }; remote.push(refund); }
        return copy(refund);
    };
    const adapter: any = { getRefundSnapshot: jest.fn(async () => snapshot()), refundPayment: jest.fn(create) };
    const events: any = { emit: jest.fn() };
    const service = new StripeRefundService(prisma, adapter, events);
    const input = (extra: any = {}) => ({ paymentId: payment.id, requestId: randomUUID(), amountCents: 1000, ...extra });
    const event = (id = randomUUID()) => ({ provider: 'stripe' as const, providerEventId: id, providerPaymentId: payment.providerPaymentId,
        type: BillingEventType.PAYMENT_REFUNDED, occurredAt: new Date(), rawPayload: { type: 'refund.updated' } });
    return { service, prisma, adapter, events, operations, remote, payment, ledger, audits, input, event, create, snapshot };
}

describe('durable Stripe refunds', () => {
    it('requires a caller identity before admitting any refund', async () => {
        const f = refundFixture();
        await expect(f.service.refundPayment({ paymentId: f.payment.id, amountCents: 1000 })).rejects.toMatchObject({ response: { error: 'invalid_refund_request_id' } });
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recovers a lost accepted response without another POST or another partial refund', async () => {
        const f = refundFixture(); const input = f.input();
        f.adapter.refundPayment.mockImplementationOnce(async (...args: any[]) => { await (f.create as any)(...args); throw { type: 'StripeConnectionError' }; });
        expect((await f.service.refundPayment(input)).status).toBe('pending');
        expect(f.payment.metadata.refundedAmountCents).toBeUndefined();
        await expect(f.service.refundPayment(f.input())).rejects.toMatchObject({ response: { error: 'refund_in_progress' } });
        expect((await f.service.refundPayment(input)).status).toBe('succeeded');
        expect(f.adapter.refundPayment).toHaveBeenCalledTimes(1);
        expect(f.payment.metadata.refundedAmountCents).toBe(1000);
        expect(f.events.emit).toHaveBeenCalledTimes(1);
    });

    it('replays an unreceived POST with the same key and exact explicit amount', async () => {
        const f = refundFixture(); const input = f.input({ amountCents: undefined });
        f.adapter.refundPayment.mockRejectedValueOnce({ type: 'StripeConnectionError' });
        await f.service.refundPayment(input);
        await f.service.refundPayment(input);
        expect(f.adapter.refundPayment.mock.calls[0]).toEqual(f.adapter.refundPayment.mock.calls[1]);
        expect(f.adapter.refundPayment.mock.calls[0][1]).toBe(10000);
        // Replay is resolved before rejecting an already fully refunded payment.
        expect((await f.service.refundPayment(input)).status).toBe('succeeded');
        expect(f.adapter.refundPayment).toHaveBeenCalledTimes(2);
    });

    it('keeps a pending/requires_action refund reserved and never issues its credit early', async () => {
        const f = refundFixture(); const input = f.input();
        f.adapter.refundPayment.mockImplementationOnce(async (...args: any[]) => { const r = await (f.create as any)(...args); f.remote[0].status = 'requires_action'; return { ...r, status: 'requires_action' }; });
        expect((await f.service.refundPayment(input)).status).toBe('pending');
        expect(f.payment.metadata.refundedAmountCents).toBeUndefined();
        expect(f.events.emit).not.toHaveBeenCalled();
        f.remote[0].status = 'succeeded';
        f.operations.get(input.requestId).nextCheckAt = new Date(0);
        expect(await f.service.reconcilePending()).toMatchObject({ finalized: 1 });
        expect(f.adapter.refundPayment).toHaveBeenCalledTimes(1);
    });

    it('does not mistake a post-acceptance confirmation 401 for a rejected refund', async () => {
        const f = refundFixture(); const input = f.input();
        f.adapter.getRefundSnapshot.mockImplementationOnce(async () => f.snapshot()).mockRejectedValueOnce({ type: 'StripeAuthenticationError', statusCode: 401 });
        expect((await f.service.refundPayment(input)).status).toBe('pending');
        expect(f.operations.get(input.requestId).status).not.toBe('failed');
        expect((await f.service.refundPayment(input)).status).toBe('succeeded');
        expect(f.adapter.refundPayment).toHaveBeenCalledTimes(1);
    });

    it('releases a confirmed rejected initial request, but not 4xx after an older ambiguous request', async () => {
        const f = refundFixture(); const first = f.input();
        f.adapter.refundPayment.mockRejectedValueOnce({ type: 'StripePermissionError', statusCode: 403 });
        expect((await f.service.refundPayment(first)).status).toBe('failed');
        const second = f.input();
        f.adapter.refundPayment.mockRejectedValueOnce({ type: 'StripeConnectionError' });
        await f.service.refundPayment(second);
        f.adapter.refundPayment.mockRejectedValueOnce({ type: 'StripeAuthenticationError', statusCode: 401 });
        expect((await f.service.refundPayment(second)).status).toBe('pending');
    });

    it('allows a fresh intent only after canonical failed/canceled, without accounting the failure', async () => {
        const f = refundFixture(); const input = f.input();
        f.adapter.refundPayment.mockImplementationOnce(async (...args: any[]) => { const r = await (f.create as any)(...args); f.remote[0].status = 'failed'; return { ...r, status: 'failed' }; });
        expect((await f.service.refundPayment(input)).status).toBe('failed');
        expect(f.payment.metadata.refundedAmountCents).toBeUndefined();
        expect((await f.service.refundPayment(f.input())).status).toBe('succeeded');
        expect(f.payment.metadata.refundedAmountCents).toBe(1000);
    });

    it('stops POST retries before Stripe can prune the idempotency key and supports explicit absence review', async () => {
        const f = refundFixture(); const input = f.input();
        f.adapter.refundPayment.mockRejectedValueOnce({ type: 'StripeConnectionError' });
        await f.service.refundPayment(input);
        f.operations.get(input.requestId).firstSubmittedAt = new Date(Date.now() - 24 * 3600_000);
        expect((await f.service.refundPayment(input)).status).toBe('needs_review');
        expect(f.adapter.refundPayment).toHaveBeenCalledTimes(1);
        expect((await f.service.resolve({ paymentId: f.payment.id, operationId: input.requestId, confirmNotCreated: true,
            reason: 'Stripe support confirmed that no refund was created' })).status).toBe('failed');
        expect(f.audits.some(a => a.action === 'stripe_refund_manually_resolved')).toBe(true);
        expect(f.adapter.refundPayment).toHaveBeenCalledTimes(1);
    });

    it('finds an accepted operation after 24h using metadata, without replaying the expired key', async () => {
        const f = refundFixture(); const input = f.input();
        f.adapter.refundPayment.mockImplementationOnce(async (...args: any[]) => { await (f.create as any)(...args); throw new Error('lost'); });
        await f.service.refundPayment(input);
        f.operations.get(input.requestId).firstSubmittedAt = new Date(0);
        expect((await f.service.refundPayment(input)).status).toBe('succeeded');
        expect(f.adapter.refundPayment).toHaveBeenCalledTimes(1);
    });

    it('rejects reuse for a different amount and stale balances before remote mutation', async () => {
        const f = refundFixture(); const input = f.input();
        await f.service.refundPayment(input);
        await expect(f.service.refundPayment({ ...input, amountCents: 2000 })).rejects.toMatchObject({ response: { error: 'refund_request_conflict' } });
        await expect(f.service.refundPayment(f.input({ expectedRefundedAmountCents: 0 }))).rejects.toMatchObject({ response: { error: 'refund_balance_changed' } });
        expect(f.adapter.refundPayment).toHaveBeenCalledTimes(1);
    });

    it('blocks legacy ambiguous payment fences rather than generating a new operation', async () => {
        const f = refundFixture(); f.payment.metadata.refundPendingTotalCents = 1000;
        await expect(f.service.refundPayment(f.input())).rejects.toMatchObject({ response: { error: 'refund_in_progress' } });
        expect(f.adapter.refundPayment).not.toHaveBeenCalled();
    });

    it('re-reads under the payment lock and preserves success after an older pre-lock pending snapshot', async () => {
        const f = refundFixture(); const input = f.input();
        await f.service.refundPayment(input);
        const old = f.snapshot(); old.refunds[0].status = 'pending'; old.succeededAmountCents = 0;
        // Force processing of a previously claimed request whose initial read is stale.
        f.operations.get(input.requestId).status = 'pending';
        f.adapter.getRefundSnapshot.mockResolvedValueOnce(old);
        expect((await f.service.refundPayment(input)).status).toBe('succeeded');
        expect(f.payment.metadata.stripeRefundNeedsReview).toBeUndefined();
        expect(f.payment.metadata.refundedAmountCents).toBe(1000);
        expect(f.events.emit).toHaveBeenCalledTimes(1);
    });

    it('flags a canonical late bank failure without lowering accounting or issuing another refund', async () => {
        const f = refundFixture(); const input = f.input();
        await f.service.refundPayment(input);
        f.remote[0].status = 'failed';
        await f.service.handleEvent(f.event());
        expect((await f.service.refundPayment(input)).status).toBe('needs_review');
        expect(f.payment.metadata.refundedAmountCents).toBe(1000);
        expect(f.events.emit).toHaveBeenCalledTimes(1);
        expect(f.adapter.refundPayment).toHaveBeenCalledTimes(1);
    });

    it('deduplicates canonical webhook accounting and rejects missing/unmatched payment identity', async () => {
        const f = refundFixture(); const input = f.input();
        await f.create('in_paid', 1000, { operationId: input.requestId });
        const event = f.event();
        await f.service.handleEvent(event);
        expect(await f.service.handleEvent(event)).toMatchObject({ processed: false, reason: 'duplicate' });
        expect(f.events.emit).toHaveBeenCalledTimes(1);
        await expect(f.service.handleEvent({ ...event, providerPaymentId: undefined })).rejects.toMatchObject({ response: { error: 'stripe_refund_payment_missing' } });
        await expect(f.service.handleEvent({ ...event, providerPaymentId: 'in_other' })).rejects.toMatchObject({ response: { error: 'stripe_refund_payment_pending' } });
    });

    it('checks currency, amount and environment before submitting any refund', async () => {
        const f = refundFixture();
        f.adapter.getRefundSnapshot.mockResolvedValue({ ...f.snapshot(), livemode: true });
        expect((await f.service.refundPayment(f.input())).status).toBe('pending');
        expect(f.adapter.refundPayment).not.toHaveBeenCalled();
    });
});
