import { ForbiddenException, HttpException } from '@nestjs/common';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { CopilotRateLimitService } from './copilot-rate-limit.service';

describe('conversation Copilot authorization and cost limits', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const actorId = '33333333-3333-4333-8333-333333333333';
    const otherId = '44444444-4444-4444-8444-444444444444';

    function makeService(assignedTo: string | null, counts: number[] = [1, 1, 1, 1]) {
        const prisma = {
            getTenantSchemaName: jest.fn().mockResolvedValue('tenant_acme'),
            executeInTenantSchema: jest.fn().mockImplementation(async (_schema: string, sql: string) => {
                if (sql.includes('SELECT assigned_to')) return [{ assigned_to: assignedTo }];
                return [];
            }),
        };
        const redis = {
            incrementRateLimit: jest.fn()
                .mockResolvedValueOnce(counts[0])
                .mockResolvedValueOnce(counts[1])
                .mockResolvedValueOnce(counts[2])
                .mockResolvedValueOnce(counts[3]),
            tenantKey: jest.fn((_t: string, key: string) => key),
            getJson: jest.fn().mockResolvedValue(null),
        };
        const llm = { execute: jest.fn() };
        const service = new CopilotService(
            {} as any,
            prisma as any,
            redis as any,
            llm as any,
            {} as any,
            {} as any,
            {} as any,
            new CopilotRateLimitService(redis as any),
        );
        return { service, prisma, redis, llm };
    }

    it('rejects a peer-owned conversation before consuming quota or reading messages', async () => {
        const h = makeService(otherId);

        await expect(h.service.getSuggestions(
            tenantId, conversationId, actorId, 'tenant_agent',
        )).rejects.toBeInstanceOf(ForbiddenException);

        expect(h.redis.incrementRateLimit).not.toHaveBeenCalled();
        expect(h.prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        expect(h.llm.execute).not.toHaveBeenCalled();
    });

    it('returns 429 before LLM generation after ownership succeeds', async () => {
        const h = makeService(actorId, [21, 1, 1, 1]);

        await expect(h.service.getSummary(
            tenantId, conversationId, actorId, 'tenant_agent',
        )).rejects.toBeInstanceOf(HttpException);

        expect(h.llm.execute).not.toHaveBeenCalled();
    });

    it('HTTP endpoints derive actor identity and role for every contextual operation', async () => {
        const copilot = {
            getSuggestions: jest.fn().mockResolvedValue([]),
            getSummary: jest.fn().mockResolvedValue({}),
            detectIntent: jest.fn().mockResolvedValue({}),
            rewriteReply: jest.fn().mockResolvedValue({ text: 'x' }),
            getContextualHelp: jest.fn().mockResolvedValue({ answer: 'x', sources: [] }),
        };
        const controller = new CopilotController(copilot as any);
        const req = { user: { id: actorId, role: 'tenant_agent' } };

        await controller.getSuggestions(tenantId, conversationId, req);
        await controller.getSummary(tenantId, conversationId, req);
        await controller.detectIntent(tenantId, conversationId, req);
        await controller.rewriteReply(tenantId, conversationId, { draft: 'x', tone: 'friendly' }, req);
        await controller.askCopilot(tenantId, conversationId, { query: 'q' }, req);

        expect(copilot.getSuggestions).toHaveBeenCalledWith(tenantId, conversationId, actorId, 'tenant_agent');
        expect(copilot.getSummary).toHaveBeenCalledWith(tenantId, conversationId, actorId, 'tenant_agent');
        expect(copilot.detectIntent).toHaveBeenCalledWith(tenantId, conversationId, actorId, 'tenant_agent');
        expect(copilot.rewriteReply).toHaveBeenCalledWith(
            tenantId, 'x', 'friendly', conversationId, actorId, 'tenant_agent',
        );
        expect(copilot.getContextualHelp).toHaveBeenCalledWith(
            tenantId, conversationId, 'q', actorId, 'tenant_agent',
        );
    });
});
