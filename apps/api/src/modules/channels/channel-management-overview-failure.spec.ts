import { ChannelManagementController } from './channel-management.controller';

describe('channel overview read authority', () => {
    it('does not recommend assigning an agent when assignment state is unreadable', async () => {
        const controller: any = Object.create(ChannelManagementController.prototype);
        const account = {
            id: 'row-1', channelType: 'whatsapp', accountId: 'phone-1',
            displayName: 'Ventas', isActive: true, metadata: {}, accessToken: 'token',
        };
        Object.assign(controller, {
            logger: { warn: jest.fn() },
            prisma: {
                channelAccount: { findMany: jest.fn().mockResolvedValue([account]) },
                tenant: { findUnique: jest.fn().mockResolvedValue({ schemaName: 'tenant_demo' }) },
                whatsappCredential: { findMany: jest.fn().mockResolvedValue([]) },
                $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('widget store unavailable')),
                executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                    if (sql.includes('ALTER TABLE')) return [];
                    if (sql.includes('FROM agent_personas')) throw new Error('connection reset');
                    if (sql.includes('FROM whatsapp_channels')) return [];
                    return [];
                }),
            },
        });

        const result = await controller.getOverview({ user: { tenantId: 'tenant-1' } });
        expect(result.data[0]).toMatchObject({
            accountId: 'phone-1',
            assignedAgent: null,
            assignmentStatus: 'unknown',
            needsAssignment: false,
        });
        expect(result.degraded).toEqual(['web_widget', 'agent_assignments']);
    });
});
