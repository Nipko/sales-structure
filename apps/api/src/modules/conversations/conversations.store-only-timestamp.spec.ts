import { ConversationsService, storeOnlyOccurredAt } from './conversations.service';

/**
 * Coexistence backfill must keep the provider's own timestamp. Stored at NOW(),
 * a six-month-old inbound looks like it arrived a minute ago, and every 24-hour
 * service-window read (`MAX(created_at)` of inbound messages) opens the window
 * for a thread that closed long ago.
 */
describe('store-only coexistence messages keep when they happened', () => {
    describe('storeOnlyOccurredAt', () => {
        it('reads a Date and the ISO string a BullMQ job turns it into', () => {
            const at = new Date('2026-04-02T10:00:00.000Z');
            expect(storeOnlyOccurredAt(at)).toBe('2026-04-02T10:00:00.000Z');
            expect(storeOnlyOccurredAt(JSON.parse(JSON.stringify(at)))).toBe('2026-04-02T10:00:00.000Z');
        });

        it.each([undefined, null, '', 'not a date', 0, Number.NaN, new Date(Number.NaN)])(
            'answers null for an unreadable timestamp (%p) instead of inventing one',
            (value) => expect(storeOnlyOccurredAt(value)).toBeNull(),
        );
    });

    function harness() {
        const executeInTenantSchema = jest.fn().mockResolvedValue([]);
        const service = Object.create(ConversationsService.prototype) as ConversationsService;
        Object.assign(service as any, {
            redis: {
                acquireLockToken: jest.fn().mockResolvedValue('token'),
                releaseLockToken: jest.fn().mockResolvedValue(undefined),
            },
            resolveConversation: jest.fn().mockResolvedValue({ conversation: { id: 'c0000000-0000-4000-8000-000000000001' } }),
            tenantSchema: jest.fn().mockResolvedValue('tenant_x'),
            prisma: { executeInTenantSchema },
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
        });
        return { service, executeInTenantSchema };
    }

    const message = (timestamp: unknown, direction: 'inbound' | 'outbound') => ({
        id: 'hist-1',
        tenantId: '11111111-1111-4111-8111-111111111111',
        contactId: '573001112233',
        channelType: 'whatsapp',
        channelAccountId: 'pnid',
        direction,
        timestamp,
        content: { type: 'text', text: 'hola' },
        metadata: { source: 'historical' },
    }) as any;

    it('writes the provider timestamp as created_at, clamped to NOW()', async () => {
        const { service, executeInTenantSchema } = harness();
        // As it arrives off the queue: a string, not a Date.
        await (service as any).storeOnlyMessage(message('2026-04-02T10:00:00.000Z', 'inbound'), 'historical');

        const [, sql, params] = executeInTenantSchema.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO messages \([^)]*created_at\)/);
        expect(sql).toContain('COALESCE(LEAST($6::timestamptz, NOW()), NOW())');
        expect(params[1]).toBe('inbound');
        expect(params[5]).toBe('2026-04-02T10:00:00.000Z');
    });

    it('falls back to NOW() (a null parameter) when the provider sent no usable timestamp', async () => {
        const { service, executeInTenantSchema } = harness();
        await (service as any).storeOnlyMessage(message(undefined, 'outbound'), 'waba_echo');
        const [, , params] = executeInTenantSchema.mock.calls[0];
        expect(params[1]).toBe('outbound');
        expect(params[5]).toBeNull();
    });
});
