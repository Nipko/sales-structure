import { PlatformNotificationOutboxService } from './platform-notification-outbox.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = '22222222-2222-4222-8222-222222222222';

describe('durable email-template test admission', () => {
    function build() {
        const rows = new Map<string, any>();
        const tx = {
            $executeRawUnsafe: jest.fn(async (_sql: string, eventKey: string, templateId: string,
                tenantId: string, email: string, payload: string) => {
                if (!rows.has(eventKey)) rows.set(eventKey, {
                    id: '33333333-3333-4333-8333-333333333333', entity_id: templateId,
                    tenant_id: tenantId, recipient_email: email, payload: JSON.parse(payload),
                });
                return 1;
            }),
            $queryRawUnsafe: jest.fn(async (_sql: string, eventKey: string) => [rows.get(eventKey)]),
        };
        const prisma = { $transaction: (fn: any) => fn(tx) };
        const service = new PlatformNotificationOutboxService(prisma as any, {} as any, {} as any, {} as any);
        jest.spyOn(service, 'deliver').mockResolvedValue('notification:sent');
        return { service, rows };
    }

    const input = {
        tenantId: TENANT, templateId: TEMPLATE, requestKey: 'request_12345678',
        to: 'Owner@Example.test', subject: '[TEST] Confirmation', html: '<p>Preview</p>',
    };

    it('reuses one admitted effect when the browser repeats the same request', async () => {
        const { service, rows } = build();
        await expect(service.sendEmailTemplateTest(input)).resolves.toBe('notification:sent');
        await expect(service.sendEmailTemplateTest(input)).resolves.toBe('notification:sent');
        expect(rows.size).toBe(1);
        expect(service.deliver).toHaveBeenCalledTimes(2);
        expect([...rows.values()][0].payload).toEqual(expect.objectContaining({
            fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), html: '<p>Preview</p>',
        }));
    });

    it('refuses to reuse a request key for different rendered content', async () => {
        const { service } = build();
        await service.sendEmailTemplateTest(input);
        await expect(service.sendEmailTemplateTest({ ...input, html: '<p>Changed</p>' }))
            .rejects.toThrow('email_template_test_request_key_conflict');
        expect(service.deliver).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid identity before writing authority', async () => {
        const { service, rows } = build();
        await expect(service.sendEmailTemplateTest({ ...input, requestKey: 'short' }))
            .rejects.toThrow('email_template_test_invalid');
        expect(rows.size).toBe(0);
    });
});
