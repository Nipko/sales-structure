import { EmailTemplatesService } from './email-templates.service';

describe('email template test delivery', () => {
    it('renders once and admits the exact snapshot without calling SMTP inline', async () => {
        const prisma = {
            executeInTenantSchema: jest.fn().mockResolvedValue([{
                name: 'Acme', logo_url: null, phone: null, email: 'reply@acme.test',
                address: null, website: null,
            }]),
            $queryRaw: jest.fn().mockResolvedValue([{ name: 'Acme', settings: {} }]),
        };
        const email = { send: jest.fn(), getSenderAddress: jest.fn().mockReturnValue('mail@parallly.test') };
        const notifications = { sendEmailTemplateTest: jest.fn().mockResolvedValue('notification:sent') };
        const service = new EmailTemplatesService(prisma as any, email as any, notifications as any);
        jest.spyOn(service, 'getById').mockResolvedValue({
            id: '22222222-2222-4222-8222-222222222222', name: 'Confirmation', slug: 'custom',
            subject: 'Hello {{company_name}}', bodyHtml: '<p>{{company_name}}</p>', bodyJson: {},
            variables: ['company_name'], isActive: true, language: 'en', createdAt: '', updatedAt: '',
        });

        await expect(service.sendTest('tenant_acme', '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222', 'owner@example.test', 'request_12345678'))
            .resolves.toBe(true);
        expect(email.send).not.toHaveBeenCalled();
        expect(notifications.sendEmailTemplateTest).toHaveBeenCalledWith(expect.objectContaining({
            subject: '[TEST] Hello Acme', html: '<p>Acme</p>', to: 'owner@example.test',
            requestKey: 'request_12345678',
        }));
    });
});
