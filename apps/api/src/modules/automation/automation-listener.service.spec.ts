import { AutomationListenerService } from './automation-listener.service';

describe('AutomationListenerService event bridges', () => {
    function build() {
        const prisma = {
            getTenantSchemaName: jest.fn().mockResolvedValue('tenant_schema'),
            executeInTenantSchema: jest.fn(),
        };
        const persona = { getActivePersona: jest.fn().mockResolvedValue({ hours: { schedule: {} } }) };
        const throttle = { isLimited: jest.fn(), getPriority: jest.fn() };
        const queue = { add: jest.fn() };
        const service = new AutomationListenerService(prisma as any, persona as any, throttle as any, queue as any);
        jest.spyOn(service, 'runRulesForTrigger').mockResolvedValue(undefined);
        return { service, prisma, persona };
    }

    it('maps message.inbound to new_message and provides phone plus business-hours state', async () => {
        const { service, prisma } = build();
        prisma.executeInTenantSchema.mockResolvedValue([{ phone: '+573001112233' }]);
        jest.spyOn(service as any, 'isWithinBusinessHours').mockReturnValue(false);

        await service.handleMessageInbound({
            tenantId: 'tenant-1',
            conversationId: '11111111-1111-4111-8111-111111111111',
            contactId: '22222222-2222-4222-8222-222222222222',
        });

        expect(service.runRulesForTrigger).toHaveBeenCalledWith(
            'new_message',
            'tenant-1',
            'tenant_schema',
            'conversation',
            '11111111-1111-4111-8111-111111111111',
            expect.objectContaining({
                phone: '+573001112233',
                businessHoursStatus: 'closed',
                eventType: 'new_message',
            }),
        );
    });

    it('resolves the phone through the conversation, not through the channel contact id', async () => {
        // El `contactId` de message.inbound es el identificador DEL CANAL (el user id
        // de Telegram, p.ej. "860048121"), no el UUID de contacts. Consultarlo con
        // ::uuid reventaba con 22P02 y, como el error se atrapa, las automatizaciones
        // dejaban de correr en silencio en cada mensaje entrante.
        const { service, prisma } = build();
        prisma.executeInTenantSchema.mockResolvedValue([{ phone: '+573001112233' }]);
        jest.spyOn(service as any, 'isWithinBusinessHours').mockReturnValue(true);

        await service.handleMessageInbound({
            tenantId: 'tenant-1',
            conversationId: '11111111-1111-4111-8111-111111111111',
            contactId: '860048121', // id de Telegram: no es UUID
        });

        const [, sql, params] = prisma.executeInTenantSchema.mock.calls[0];
        expect(sql).toContain('FROM conversations');
        expect(params).toEqual(['11111111-1111-4111-8111-111111111111']);
        // Lo que rompia: el id externo llegando a un parametro casteado a ::uuid.
        expect(params).not.toContain('860048121');

        expect(service.runRulesForTrigger).toHaveBeenCalledWith(
            'new_message', 'tenant-1', 'tenant_schema', 'conversation',
            '11111111-1111-4111-8111-111111111111',
            expect.objectContaining({ phone: '+573001112233' }),
        );
    });

    it('maps a pipeline stage event only through one exact deal correlation', async () => {
        const { service, prisma } = build();
        prisma.executeInTenantSchema.mockResolvedValue([{
            lead_id: '33333333-3333-4333-8333-333333333333',
            contact_id: '22222222-2222-4222-8222-222222222222',
            phone: '+573001112233',
        }]);

        await service.handlePipelineStageChanged({
            tenantId: 'tenant-1',
            dealId: '44444444-4444-4444-8444-444444444444',
            toStageSlug: 'calificado',
        });

        expect(service.runRulesForTrigger).toHaveBeenCalledWith(
            'stage_changed',
            'tenant-1',
            'tenant_schema',
            'deal',
            '44444444-4444-4444-8444-444444444444',
            expect.objectContaining({
                stage: 'calificado',
                leadId: '33333333-3333-4333-8333-333333333333',
                phone: '+573001112233',
            }),
        );
    });

    it('fails closed when a deal has ambiguous opportunity correlation', async () => {
        const { service, prisma } = build();
        prisma.executeInTenantSchema.mockResolvedValue([{ lead_id: 'a' }, { lead_id: 'b' }]);

        await service.handlePipelineStageChanged({ tenantId: 'tenant-1', dealId: 'deal-1' });

        expect(service.runRulesForTrigger).not.toHaveBeenCalled();
    });

    it('maps the canonical assignment event without guessing a lead', async () => {
        const { service } = build();

        await service.handleConversationAssigned({
            tenantId: 'tenant-1',
            schemaName: 'tenant_schema',
            conversationId: '11111111-1111-4111-8111-111111111111',
            agentId: '55555555-5555-4555-8555-555555555555',
        });

        expect(service.runRulesForTrigger).toHaveBeenCalledWith(
            'conversation_assigned',
            'tenant-1',
            'tenant_schema',
            'conversation',
            '11111111-1111-4111-8111-111111111111',
            expect.objectContaining({
                assignedTo: '55555555-5555-4555-8555-555555555555',
                eventType: 'conversation_assigned',
            }),
        );
    });
});
