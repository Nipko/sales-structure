import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../quality/agent-quality-events';

const tenantId = '11111111-1111-4111-8111-111111111111';

/**
 * The bridge the `whatsapp` service calls once Embedded Signup commits.
 *
 * Embedded Signup writes `channel_accounts` in that service, so none of the
 * API's connect paths ran for it: the default agent (born with no channels)
 * was never assigned to WhatsApp, `channel_assignment` stayed a critical
 * failure and the setup card kept asking to "asignar un canal" — the 14-sep
 * recording. What is pinned here is that the bridge now records the
 * connection, reads "connected" instead of trusting the caller, does it before
 * the quality event, and never fails the call because of it.
 *
 * The real `recordChannelConnected` runs (not a mock): the double answers the
 * three writes it makes, so the assertions read what reached the database.
 */
function harness(options: {
    liveAccount?: boolean;
    findThrows?: boolean;
    bindThrows?: boolean;
    settingsThrows?: boolean;
    settings?: Record<string, unknown>;
} = {}) {
    const order: string[] = [];
    const settingsWrites: Array<Record<string, unknown>> = [];
    const tx = {
        $queryRawUnsafe: jest.fn(async () => {
            if (options.settingsThrows) throw new Error('lock timeout');
            return [{ settings: options.settings ?? { onboardingStage: 'agent_reviewed' } }];
        }),
        $executeRawUnsafe: jest.fn(async (_sql: string, _id: string, json: string) => {
            order.push('stage');
            settingsWrites.push(JSON.parse(json));
            return 1;
        }),
    };
    const prisma: any = {
        channelAccount: {
            findFirst: jest.fn(async () => {
                order.push('read');
                if (options.findThrows) throw new Error('pgbouncer unavailable');
                return options.liveAccount === false ? null : { id: 'row-1' };
            }),
        },
        tenant: {
            updateMany: jest.fn(async () => {
                order.push('first');
                return { count: 1 };
            }),
        },
        getTenantSchemaName: jest.fn(async () => 'tenant_acme'),
        executeInTenantSchema: jest.fn(async (_schema: string, _sql: string, params: any[]) => {
            order.push(`bind:${params[0]}`);
            if (options.bindThrows) throw new Error('pgbouncer unavailable');
            return [{ id: 'agent-1' }];
        }),
        $transaction: jest.fn(async (work: any) => work(tx)),
    };
    const events = { emit: jest.fn(() => { order.push('emit'); return true; }) };
    const controller = new InternalController(prisma, {} as any, {} as any, events as any, {} as any);
    (controller as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { controller, prisma, events, order, settingsWrites };
}

const internal = { user: { isInternalService: true } };

describe('internal agent-quality-channel-updated (Embedded Signup bridge)', () => {
    it('records the WhatsApp connection, then emits the quality event', async () => {
        const { controller, prisma, events, order, settingsWrites } = harness();

        await expect(controller.agentQualityChannelUpdated(internal, {
            tenantId, channelType: 'whatsapp', accountId: '15550001111',
        })).resolves.toEqual({ accepted: true });

        // Read → first connection → assignment → stage, and only THEN the event,
        // so the reconcile it triggers sees the assignment.
        expect(order).toEqual(['read', 'first', 'bind:whatsapp', 'stage', 'emit']);
        expect(prisma.channelAccount.findFirst).toHaveBeenCalledWith({
            where: { tenantId, channelType: 'whatsapp', isActive: true, accountId: '15550001111' },
            select: { id: true },
        });
        expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
            where: { id: tenantId, firstChannelConnectedAt: null },
            data: { firstChannelConnectedAt: expect.any(Date) },
        });
        expect(settingsWrites).toEqual([{ onboardingStage: 'channel_connected' }]);
        expect(events.emit).toHaveBeenCalledWith(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
            tenantId, source: 'channel_credential',
        });
    });

    it('treats a body with only the tenant id (an older whatsapp build) as WhatsApp', async () => {
        const { controller, prisma, order } = harness();

        await controller.agentQualityChannelUpdated(internal, { tenantId });

        expect(prisma.channelAccount.findFirst).toHaveBeenCalledWith({
            where: { tenantId, channelType: 'whatsapp', isActive: true },
            select: { id: true },
        });
        expect(order).toContain('bind:whatsapp');
    });

    it('records nothing when no WhatsApp connection is actually live, and still answers', async () => {
        const { controller, prisma, events } = harness({ liveAccount: false });

        await expect(controller.agentQualityChannelUpdated(internal, { tenantId, channelType: 'whatsapp' }))
            .resolves.toEqual({ accepted: true });

        expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(events.emit).toHaveBeenCalled();
    });

    it('does not record a channel type this bridge does not carry', async () => {
        const { controller, prisma } = harness();

        await controller.agentQualityChannelUpdated(internal, { tenantId, channelType: 'instagram' });

        expect(prisma.channelAccount.findFirst).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it.each([
        ['the connection read fails', { findThrows: true }],
        ['the assignment fails', { bindThrows: true }],
        ['the stage write fails', { settingsThrows: true }],
    ])('never fails the call when %s', async (_label, options) => {
        const { controller, events } = harness(options);

        await expect(controller.agentQualityChannelUpdated(internal, { tenantId, channelType: 'whatsapp' }))
            .resolves.toEqual({ accepted: true });
        expect(events.emit).toHaveBeenCalledTimes(1);
    });

    it('keeps refusing a caller that is not the internal service, before touching anything', async () => {
        const { controller, prisma } = harness();

        await expect(controller.agentQualityChannelUpdated({ user: {} }, { tenantId }))
            .rejects.toBeInstanceOf(ForbiddenException);
        await expect(controller.agentQualityChannelUpdated(internal, { tenantId: 'not-a-uuid' }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.channelAccount.findFirst).not.toHaveBeenCalled();
    });
});
