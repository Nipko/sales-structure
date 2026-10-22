import { of } from 'rxjs';
import { WhatsappMessagingService } from './whatsapp-messaging.service';
import { permissiveSpendGate, resolvingChannelToken }
    from '../../channels/__fixtures__/spend-gate-double';
import { resolveMessageCategory } from '../../billing/whatsapp-spend/message-category';

/**
 * The REST surface used to tell the money gate that EVERY non-template send was
 * inside the 24-hour customer service window. A free-form message to someone
 * who last wrote in March was therefore admitted and priced as a `service`
 * reply — and then refused by Meta. The window is a fact about the thread, so
 * it is read; unknown fails closed for free-form sends; templates are untouched.
 */
describe('REST sends read the real service window', () => {
    function harness(windowRead: () => Promise<any[]>) {
        const spendGate = permissiveSpendGate();
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, _params?: any[]) => {
            if (/AS open/.test(sql)) return windowRead();
            return [];
        });
        const service = new WhatsappMessagingService(
            { executeInTenantSchema } as any,
            { post: jest.fn(() => of({ data: { messages: [{ id: 'wamid.REST' }] } })) } as any,
            { getValidAccessToken: jest.fn(async () => ({
                accessToken: 'token', phoneNumberId: 'phone-1', channelId: 'ch-1', wabaId: 'waba-1',
            })) } as any,
            spendGate,
            resolvingChannelToken(),
        );
        return { service, spendGate, executeInTenantSchema };
    }

    const windowSql = (h: ReturnType<typeof harness>) =>
        h.executeInTenantSchema.mock.calls.find(([, sql]) => /AS open/.test(String(sql)));

    it('passes true only when an inbound message from this recipient is inside the window', async () => {
        const h = harness(async () => [{ open: true }]);
        await h.service.sendTextMessage('tenant_acme', '+573001112233', 'hola');

        expect(h.spendGate.admit.mock.calls[0][0].insideServiceWindow).toBe(true);
        // Scoped to this business number and this recipient, digits only.
        const [, sql, params] = windowSql(h)!;
        expect(sql).toContain("m.direction = 'inbound'");
        expect(sql).toContain('c.channel_account_id = $1');
        expect(params).toEqual(['phone-1', '573001112233']);
    });

    it('passes false when the window has closed, so the send is not priced as a service reply', async () => {
        const h = harness(async () => [{ open: false }]);
        await h.service.sendTextMessage('tenant_acme', '+573001112233', 'hola');
        const request = h.spendGate.admit.mock.calls[0][0];
        expect(request.insideServiceWindow).toBe(false);
        expect(resolveMessageCategory({ isTemplate: false, insideServiceWindow: request.insideServiceWindow }))
            .toMatchObject({ kind: 'unknown', reason: 'proactive_without_template' });
    });

    it('passes false when the recipient never wrote at all', async () => {
        const h = harness(async () => [{ open: null }]);
        await h.service.sendTextMessage('tenant_acme', '+573001112233', 'hola');
        expect(h.spendGate.admit.mock.calls[0][0].insideServiceWindow).toBe(false);
    });

    it('fails closed when the window cannot be read', async () => {
        const h = harness(async () => { throw new Error('pool exhausted'); });
        await h.service.sendTextMessage('tenant_acme', '+573001112233', 'hola');
        expect(h.spendGate.admit.mock.calls[0][0].insideServiceWindow).toBe(false);
    });

    it('does not read or claim a window for a template send', async () => {
        const h = harness(async () => [{ open: false }]);
        await h.service.sendTemplate('tenant_acme', '+573001112233', 'recordatorio', 'es', []);
        expect(h.spendGate.admit.mock.calls[0][0].insideServiceWindow).toBeUndefined();
        expect(windowSql(h)).toBeUndefined();
    });
});
