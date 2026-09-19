import { ChannelManagementController } from './channel-management.controller';

/**
 * The connect paths the channel controller owns (Instagram, Messenger,
 * Telegram, the generic connect) must record a connection exactly as Embedded
 * Signup does (`recordChannelConnected`): the first-connection instant, the
 * default agent assigned, and the stage moved forward — but only a STORED stage.
 *
 * A tenant with no stored stage predates the stage contract, which reads that
 * as "already active". Creating `channel_connected` for it put a two-year-old
 * account below `live`, and its next reply then stamped `firstReplyAt`
 * ("activated today") through `recordFirstReply`, which stamps exactly the
 * tenants whose stage is below `live`.
 */
const tenantId = '11111111-1111-4111-8111-111111111111';

function harness(settings: Record<string, unknown>) {
    const settingsWrites: Array<Record<string, unknown>> = [];
    const tx = {
        $queryRawUnsafe: jest.fn(async () => [{ settings }]),
        $executeRawUnsafe: jest.fn(async (_sql: string, _id: string, json: string) => {
            settingsWrites.push(JSON.parse(json));
            return 1;
        }),
    };
    const prisma = {
        tenant: { updateMany: jest.fn(async () => ({ count: 1 })) },
        getTenantSchemaName: jest.fn(async () => 'tenant_acme'),
        executeInTenantSchema: jest.fn(async () => [{ id: 'agent-1' }]),
        $transaction: jest.fn(async (work: any) => work(tx)),
    };
    const controller: any = Object.create(ChannelManagementController.prototype);
    Object.assign(controller, { prisma, logger: { warn: jest.fn(), log: jest.fn() } });
    return { controller, prisma, tx, settingsWrites };
}

describe('ChannelManagementController.markFirstChannelConnected', () => {
    it.each(['instagram', 'messenger', 'telegram'])(
        'never creates a stage for a tenant created before the stage contract (%s)',
        async (channelType) => {
            const { controller, prisma, tx } = harness({ language: 'es' });

            await controller.markFirstChannelConnected(tenantId, channelType);

            // The connection itself is still recorded and the agent still assigned.
            expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
                where: { id: tenantId, firstChannelConnectedAt: null },
                data: { firstChannelConnectedAt: expect.any(Date) },
            });
            expect(prisma.executeInTenantSchema).toHaveBeenCalled();
            // …and no stage is written where none was stored.
            expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
        },
    );

    it('treats a value that is not a stage as no stage at all', async () => {
        const { controller, tx } = harness({ onboardingStage: 'onboarding' });

        await controller.markFirstChannelConnected(tenantId, 'instagram');

        expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('still advances a stored stage to channel_connected, keeping the other settings', async () => {
        const { controller, settingsWrites } = harness({ onboardingStage: 'agent_reviewed', language: 'es' });

        await controller.markFirstChannelConnected(tenantId, 'telegram');

        expect(settingsWrites).toEqual([{ onboardingStage: 'channel_connected', language: 'es' }]);
    });

    it.each(['channel_connected', 'live', 'completed'])('never moves %p backwards, and writes nothing', async (stage) => {
        const { controller, tx } = harness({ onboardingStage: stage });

        await controller.markFirstChannelConnected(tenantId, 'messenger');

        expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    });
});
