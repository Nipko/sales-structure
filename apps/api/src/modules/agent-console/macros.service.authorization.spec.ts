import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MacrosService } from './macros.service';

describe('MacrosService assignment authorization', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const actorId = '33333333-3333-4333-8333-333333333333';
    const targetId = '44444444-4444-4444-8444-444444444444';

    function makeHarness(actorRole: string, activeTargets: Array<{ id: string }> = []) {
        const prisma = {
            user: { findMany: jest.fn().mockResolvedValue(activeTargets) },
            executeInTenantSchema: jest.fn()
                .mockResolvedValueOnce([{
                    id: '55555555-5555-4555-8555-555555555555',
                    name: 'Assign',
                    actions_json: [{ type: 'assign', value: targetId }],
                }]),
        };
        const redis = { get: jest.fn().mockResolvedValue('tenant_acme') };
        const service = new MacrosService(prisma as any, redis as any);
        const execute = () => service.executeMacro(
            tenantId,
            '55555555-5555-4555-8555-555555555555',
            conversationId,
            actorId,
            actorRole,
        );
        return { prisma, execute };
    }

    it('prevents an agent from reassigning through a macro', async () => {
        const h = makeHarness('tenant_agent');

        await expect(h.execute()).rejects.toBeInstanceOf(ForbiddenException);

        expect(h.prisma.user.findMany).not.toHaveBeenCalled();
        expect(h.prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
    });

    it('rejects a macro target that is not an active member of the tenant', async () => {
        const h = makeHarness('tenant_supervisor');

        await expect(h.execute()).rejects.toBeInstanceOf(BadRequestException);

        expect(h.prisma.user.findMany).toHaveBeenCalledWith({
            where: {
                id: { in: [targetId] },
                tenantId,
                isActive: true,
                role: { in: ['tenant_admin', 'tenant_supervisor', 'tenant_agent'] },
            },
            select: { id: true },
        });
        expect(h.prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
    });

    it('marks assignment macros as human intervention before changing ownership', async () => {
        const queries: string[] = [];
        const prisma = {
            user: { findMany: jest.fn().mockResolvedValue([{ id: targetId }]) },
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                queries.push(sql);
                if (sql.includes('FROM macros')) return [{
                    id: '55555555-5555-4555-8555-555555555555',
                    name: 'Assign',
                    actions_json: [{ type: 'assign', value: targetId }],
                }];
                if (sql.includes('SELECT contact_id')) return [{ contact_id: null }];
                return [];
            }),
        };
        const service = new MacrosService(prisma as any, { get: jest.fn().mockResolvedValue('tenant_acme') } as any);

        await service.executeMacro(tenantId, '55555555-5555-4555-8555-555555555555', conversationId, actorId, 'tenant_supervisor');

        const assignment = queries.find((sql) => sql.includes('SET assigned_to'))!;
        expect(assignment).toContain("status = 'with_human'");
        expect(assignment).toContain('was_handed_off = true');
        expect(assignment).not.toContain('agent_attribution_conflicted');
    });

    it('marks canned macro replies as human intervention before inserting outbound text', async () => {
        const queries: string[] = [];
        const prisma = {
            user: { findMany: jest.fn() },
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                queries.push(sql);
                if (sql.includes('FROM macros')) return [{
                    id: '55555555-5555-4555-8555-555555555555',
                    name: 'Reply',
                    actions_json: [{ type: 'send_canned', value: 'hello' }],
                }];
                if (sql.includes('SELECT contact_id')) return [{ contact_id: null }];
                if (sql.includes('FROM canned_responses')) return [{ content: 'Hola' }];
                return [];
            }),
        };
        const service = new MacrosService(prisma as any, { get: jest.fn().mockResolvedValue('tenant_acme') } as any);

        await service.executeMacro(tenantId, '55555555-5555-4555-8555-555555555555', conversationId, actorId, 'tenant_agent');

        const humanTouch = queries.find((sql) => sql.includes('SET was_handed_off = true'))!;
        const touchIndex = queries.indexOf(humanTouch);
        const messageIndex = queries.findIndex((sql) => sql.includes('INSERT INTO messages'));
        expect(humanTouch).not.toContain('agent_attribution_conflicted');
        expect(touchIndex).toBeGreaterThanOrEqual(0);
        expect(messageIndex).toBeGreaterThan(touchIndex);
    });
});
