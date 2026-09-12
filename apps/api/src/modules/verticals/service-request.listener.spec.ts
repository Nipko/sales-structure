import { ServiceRequestListener } from './service-request.listener';
import { OperationConfirmationService } from '../email-templates/operation-confirmation.service';

describe('ServiceRequestListener', () => {
    const schemaName = 'tenant_home_services';
    const requestId = '11111111-1111-4111-8111-111111111111';

    /**
     * The listener now carries TWO notices with one trigger: the internal
     * emergency alert to the tenant's own staff, and the customer's visit
     * confirmation that `tools.homeServices.emailConfirmations` governs. They
     * are independent by design, and these unit assertions keep them that way;
     * the confirmation's whole path — two agents, opposite switches, real
     * database — is pinned in `home-service-confirmation.postgres.spec.ts`.
     */
    const templates = () => ({ renderAndSend: jest.fn().mockResolvedValue(true) });

    /**
     * The real decision service over a fake prisma: the guards are production's
     * own, and only the transport is a double. Constructing the listener with a
     * bare stub here would test the stub.
     */
    const confirmations = (prisma: any, emailTemplates: any) =>
        new OperationConfirmationService(prisma, emailTemplates);

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
        const emailTemplates = templates();
        const listener = new ServiceRequestListener(
            prisma as any, emailService as any, confirmations(prisma, emailTemplates));

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
        // The row this fixture returns has no `status`, so it is not a
        // scheduled visit and there is nothing to confirm to the customer.
        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
    });

    it('raises no emergency alert for a non-emergency request', async () => {
        // It DOES read the request now — a scheduled visit is confirmable
        // whatever its urgency, and most of them are `normal`. What must not
        // happen is waking a human over a routine job.
        const prisma = {
            tenant: { findFirst: jest.fn().mockResolvedValue({ id: 'tenant-id', language: 'es-CO' }) },
            executeInTenantSchema: jest.fn().mockResolvedValue([{ status: 'pending' }]),
            user: { findMany: jest.fn() },
        };
        const emailService = { send: jest.fn() };
        const emailTemplates = templates();
        const listener = new ServiceRequestListener(
            prisma as any, emailService as any, confirmations(prisma, emailTemplates));

        await listener.onServiceRequestCreated({
            requestId,
            tenantSchemaName: schemaName,
            urgency: 'normal',
        });

        expect(prisma.user.findMany).not.toHaveBeenCalled();
        expect(emailService.send).not.toHaveBeenCalled();
        // `pending` is a request the business has not given a time to. The
        // template says "Visita Técnica Programada", so sending it here would
        // announce a visit nobody scheduled.
        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
    });

    it('confirms nothing when no active tenant owns the schema', async () => {
        // The predicate an isolated evaluation's cloned schema hits.
        //
        // The request row IS read first, and that is deliberate: whether there
        // is a visit to confirm at all lives in the row, and reading a cloned
        // schema costs nobody anything. What must not happen is the send, and
        // the ownership answer has to come from the database rather than from
        // the schema's name.
        const prisma = {
            tenant: { findFirst: jest.fn().mockResolvedValue(null) },
            executeInTenantSchema: jest.fn().mockResolvedValue([{
                status: 'scheduled', scheduled_date: '2026-10-01', scheduled_time: '15:00',
                contact_id: '33333333-3333-4333-8333-333333333333',
            }]),
            user: { findMany: jest.fn() },
        };
        const emailService = { send: jest.fn() };
        const emailTemplates = templates();
        const listener = new ServiceRequestListener(
            prisma as any, emailService as any, confirmations(prisma, emailTemplates));

        await listener.onServiceRequestCreated({
            requestId,
            tenantSchemaName: schemaName,
            urgency: 'normal',
        });

        expect(prisma.tenant.findFirst).toHaveBeenCalled();
        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
    });
});
