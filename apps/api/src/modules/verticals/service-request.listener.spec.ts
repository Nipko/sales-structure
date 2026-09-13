import { ServiceRequestListener } from './service-request.listener';
import { OperationConfirmationService } from '../email-templates/operation-confirmation.service';

describe('ServiceRequestListener', () => {
    const schemaName = 'tenant_home_services';
    const requestId = '11111111-1111-4111-8111-111111111111';

    const templates = () => ({ renderAndSend: jest.fn().mockResolvedValue(true) });

    /**
     * The real decision service over a fake prisma: the guards are production's
     * own, and only the transport is a double. Constructing the listener with a
     * bare stub here would test the stub.
     */
    const confirmations = (prisma: any, emailTemplates: any) =>
        new OperationConfirmationService(prisma, emailTemplates);

    it('does not attempt an internal alert after the request transaction', async () => {
        const prisma = {
            tenant: { findFirst: jest.fn().mockResolvedValue({ id: 'tenant-id', language: 'es-CO' }) },
            executeInTenantSchema: jest.fn().mockResolvedValue([{ status: 'pending' }]),
        };
        const emailTemplates = templates();
        const listener = new ServiceRequestListener(
            prisma as any, confirmations(prisma, emailTemplates));

        await listener.onServiceRequestCreated({
            requestId,
            tenantSchemaName: schemaName,
            urgency: 'emergencia',
        });

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
        const emailTemplates = templates();
        const listener = new ServiceRequestListener(
            prisma as any, confirmations(prisma, emailTemplates));

        await listener.onServiceRequestCreated({
            requestId,
            tenantSchemaName: schemaName,
            urgency: 'normal',
        });

        expect(prisma.tenant.findFirst).toHaveBeenCalled();
        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
    });
});
