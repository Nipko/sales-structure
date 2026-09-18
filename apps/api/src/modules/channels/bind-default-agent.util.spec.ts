import { applyChannelConnectedStage, bindDefaultAgentToChannel, recordChannelConnected } from './bind-default-agent.util';

const tenantId = '11111111-1111-4111-8111-111111111111';

/**
 * A Prisma double that answers the three writes the way PostgreSQL would for
 * the parts that matter here.
 *
 * `agent_personas.channels` is `TEXT[] DEFAULT '{}'` and `version` is
 * `INTEGER DEFAULT 1`, both nullable, with no trigger and no unique index on
 * either (tenant-schema.sql). There is no constraint for a double to fail to
 * enforce, so pinning the statement's guards is what pins the behaviour. The
 * settings write goes through `mutateTenantSettingsAtomic`, whose own spec pins
 * the row lock; here the transaction is modelled so the transformer runs
 * against real stored settings and the written JSON can be read back.
 */
function harness(options: {
    schema?: string | null;
    updated?: Array<{ id: string }>;
    bindThrows?: boolean;
    firstThrows?: boolean;
    settings?: Record<string, unknown>;
    settingsThrows?: boolean;
} = {}) {
    const order: string[] = [];
    const settingsWrites: Array<Record<string, unknown>> = [];
    const tx = {
        $queryRawUnsafe: jest.fn(async (_sql: string, _id: string) => {
            if (options.settingsThrows) throw new Error('lock timeout');
            return [{ settings: options.settings ?? {} }];
        }),
        $executeRawUnsafe: jest.fn(async (_sql: string, _id: string, json: string) => {
            order.push('stage');
            settingsWrites.push(JSON.parse(json));
            return 1;
        }),
    };
    const prisma: any = {
        getTenantSchemaName: jest.fn(async () => (options.schema === undefined ? 'tenant_acme' : options.schema)),
        executeInTenantSchema: jest.fn(async () => {
            order.push('bind');
            if (options.bindThrows) throw new Error('pgbouncer unavailable');
            return options.updated ?? [{ id: 'agent-1' }];
        }),
        tenant: {
            updateMany: jest.fn(async () => {
                order.push('first');
                if (options.firstThrows) throw new Error('db unavailable');
                return { count: 1 };
            }),
        },
        $transaction: jest.fn(async (work: any) => work(tx)),
    };
    return { prisma, tx, order, settingsWrites };
}

describe('bindDefaultAgentToChannel', () => {
    it.each(['sms', 'email', 'whatsapp_business', ''])('never assigns %p, which is not a certified self-service channel', async (type) => {
        const { prisma } = harness();

        await expect(bindDefaultAgentToChannel(prisma, tenantId, type)).resolves.toBe(false);

        expect(prisma.getTenantSchemaName).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('assigns the default agent only when it is the one active agent and not already assigned', async () => {
        const { prisma } = harness();

        await expect(bindDefaultAgentToChannel(prisma, tenantId, 'whatsapp')).resolves.toBe(true);

        const [schema, sql, params] = prisma.executeInTenantSchema.mock.calls[0];
        expect(schema).toBe('tenant_acme');
        expect(params).toEqual(['whatsapp']);
        const flat = String(sql).replace(/\s+/g, ' ');
        expect(flat).toContain('UPDATE agent_personas');
        expect(flat).toContain("array_append(COALESCE(channels, '{}'::text[]), $1)");
        expect(flat).toContain('version = COALESCE(version, 0) + 1');
        expect(flat).toContain('WHERE is_default = true AND is_active = true');
        // Idempotent: a reconnection does not append the type twice.
        expect(flat).toContain("NOT ($1 = ANY(COALESCE(channels, '{}'::text[])))");
        // With several agents the assignment is a business decision.
        expect(flat).toContain('(SELECT COUNT(*) FROM agent_personas WHERE is_active = true) = 1');
        expect(flat).toContain('RETURNING id');
    });

    it('reports false when no row changed (already assigned, several agents, no default)', async () => {
        const { prisma } = harness({ updated: [] });

        await expect(bindDefaultAgentToChannel(prisma, tenantId, 'web_widget')).resolves.toBe(false);
    });

    it('does nothing for a tenant without a schema', async () => {
        const { prisma } = harness({ schema: null });

        await expect(bindDefaultAgentToChannel(prisma, tenantId, 'whatsapp')).resolves.toBe(false);
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('never throws: a failed assignment must not break a connection that already happened', async () => {
        const { prisma } = harness({ bindThrows: true });

        await expect(bindDefaultAgentToChannel(prisma, tenantId, 'whatsapp')).resolves.toBe(false);
    });
});

describe('recordChannelConnected', () => {
    it('records the first connection, assigns the agent and advances the stage, in that order', async () => {
        const { prisma, order, settingsWrites } = harness({ settings: { onboardingStage: 'agent_reviewed', language: 'es' } });

        await expect(recordChannelConnected(prisma, tenantId, 'whatsapp')).resolves.toEqual({ bound: true });

        expect(order).toEqual(['first', 'bind', 'stage']);
        // Only the FIRST connection of the tenant's life writes the instant.
        expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
            where: { id: tenantId, firstChannelConnectedAt: null },
            data: { firstChannelConnectedAt: expect.any(Date) },
        });
        expect(prisma.executeInTenantSchema.mock.calls[0][2]).toEqual(['whatsapp']);
        // The rest of the settings snapshot survives: the write is a branch
        // change under the row lock, not a replacement.
        expect(settingsWrites).toEqual([{ onboardingStage: 'channel_connected', language: 'es' }]);
    });

    it('reads the settings under the row lock', async () => {
        const { prisma, tx } = harness({ settings: { onboardingStage: 'account_created' } });

        await recordChannelConnected(prisma, tenantId, 'whatsapp');

        expect(tx.$queryRawUnsafe.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    });

    it('ends a "connect later" decision, because a real connection is what it was waiting for', async () => {
        const { prisma, settingsWrites } = harness({ settings: { onboardingStage: 'channel_deferred' } });

        await recordChannelConnected(prisma, tenantId, 'whatsapp');

        expect(settingsWrites).toEqual([{ onboardingStage: 'channel_connected' }]);
    });

    it.each(['channel_connected', 'live', 'completed'])('never moves a tenant already at %p backwards, and writes nothing', async (stage) => {
        const { prisma, tx } = harness({ settings: { onboardingStage: stage } });

        await recordChannelConnected(prisma, tenantId, 'whatsapp');

        expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('keeps going when one step fails, and never throws', async () => {
        const { prisma, order } = harness({ firstThrows: true, bindThrows: true, settingsThrows: true });

        await expect(recordChannelConnected(prisma, tenantId, 'whatsapp')).resolves.toEqual({ bound: false });

        // The first step failing did not skip the assignment.
        expect(order).toEqual(['first', 'bind']);
        expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('still records the connection of a type it will not assign', async () => {
        const { prisma, settingsWrites } = harness({ settings: { onboardingStage: 'agent_reviewed' } });

        await expect(recordChannelConnected(prisma, tenantId, 'sms')).resolves.toEqual({ bound: false });

        expect(prisma.tenant.updateMany).toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(settingsWrites).toEqual([{ onboardingStage: 'channel_connected' }]);
    });

    /**
     * A tenant created before the stage contract has no stored stage, and the
     * contract reads that as "already active". Writing `channel_connected`
     * here handed it a stage for the first time — and the next reply then
     * stamped `firstReplyAt` ("activated today") on an account two years old,
     * because `recordFirstReply` stamps exactly the tenants that have a stage
     * below `live`. No stage is created where none was stored.
     */
    it.each([
        ['no stage at all', { language: 'es' }],
        ['a value that is not a stage', { onboardingStage: 'onboarding', language: 'es' }],
    ])('never creates a stage for a tenant created before the contract (%s)', async (_label, settings) => {
        const { prisma, tx, order } = harness({ settings });

        await expect(recordChannelConnected(prisma, tenantId, 'whatsapp')).resolves.toEqual({ bound: true });

        // The connection itself is still recorded and the agent still assigned.
        expect(order).toEqual(['first', 'bind']);
        expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('dates the first connection with the instant it is given, for a repair that runs later', async () => {
        const { prisma } = harness({ settings: { onboardingStage: 'agent_reviewed' } });
        const connectedAt = new Date('2026-09-14T15:04:00.000Z');

        await recordChannelConnected(prisma, tenantId, 'whatsapp', { connectedAt });

        expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
            where: { id: tenantId, firstChannelConnectedAt: null },
            data: { firstChannelConnectedAt: connectedAt },
        });
    });
});

describe('applyChannelConnectedStage', () => {
    it('advances a stored stage monotonically and returns the SAME object when nothing moves', () => {
        const reviewed = { onboardingStage: 'agent_reviewed', language: 'es' };
        expect(applyChannelConnectedStage(reviewed)).toEqual({ onboardingStage: 'channel_connected', language: 'es' });
        for (const stage of ['channel_connected', 'live', 'completed']) {
            const current = { onboardingStage: stage };
            expect(applyChannelConnectedStage(current)).toBe(current);
        }
    });

    it('returns the same object for a tenant with no stored stage', () => {
        const legacy = { language: 'es' };
        expect(applyChannelConnectedStage(legacy)).toBe(legacy);
    });
});
