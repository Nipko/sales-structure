import { ServiceRequestListener } from './service-request.listener';

describe('ServiceRequestListener', () => {
    const schemaName = 'tenant_home_services';
    const requestId = '11111111-1111-4111-8111-111111111111';

    it('escapes customer-controlled request fields before composing emergency HTML', async () => {
        const prisma = {
            tenant: {
                findFirst: jest.fn().mockResolvedValue({ id: 'tenant-id', name: 'Servicios ACME' }),
            },
            executeInTenantSchema: jest.fn().mockResolvedValue([{
                service_type: '<img src=x onerror=alert(1)>',
                customer_name: '<b>Ana & Luis</b>',
                customer_phone: '"/><script>phone()</script>',
                address: '<svg onload=evil()>',
                city: 'Bogotá & Cía',
                issue_description: '<script>alert("x")</script>',
            }]),
            user: {
                findMany: jest.fn().mockResolvedValue([{ email: 'owner@example.com' }]),
            },
        };
        const emailService = { send: jest.fn().mockResolvedValue(undefined) };
        const listener = new ServiceRequestListener(prisma as any, emailService as any);

        await listener.onServiceRequestCreated({
            requestId,
            tenantSchemaName: schemaName,
            urgency: 'emergencia',
        });

        expect(emailService.send).toHaveBeenCalledTimes(1);
        const html = emailService.send.mock.calls[0][0].html as string;
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).toContain('&lt;b&gt;Ana &amp; Luis&lt;/b&gt;');
        expect(html).toContain('&quot;/&gt;&lt;script&gt;phone()&lt;/script&gt;');
        expect(html).toContain('&lt;svg onload=evil()&gt;, Bogotá &amp; Cía');
        expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img');
        expect(html).not.toContain('<svg');
    });

    it('does no database or email work for non-emergency requests', async () => {
        const prisma = {
            tenant: { findFirst: jest.fn() },
            executeInTenantSchema: jest.fn(),
            user: { findMany: jest.fn() },
        };
        const emailService = { send: jest.fn() };
        const listener = new ServiceRequestListener(prisma as any, emailService as any);

        await listener.onServiceRequestCreated({
            requestId,
            tenantSchemaName: schemaName,
            urgency: 'normal',
        });

        expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
        expect(emailService.send).not.toHaveBeenCalled();
    });
});

