import { BadRequestException } from '@nestjs/common';
import { AutomationService } from './automation.service';

describe('AutomationService runtime contract', () => {
    it('rejects a trigger that has no runtime producer', async () => {
        const prisma = { executeInTenantSchema: jest.fn() };
        const service = new AutomationService(prisma as any);

        await expect(service.createRule('tenant_schema', {
            tenant_id: '11111111-1111-4111-8111-111111111111',
            trigger_type: 'event_that_never_fires',
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('serializes total-count quota enforcement and insert in one tenant transaction', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ count: 3 }])
            .mockResolvedValueOnce([{ id: 'rule-1' }]);
        const prisma = {
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        const enforce = jest.fn().mockResolvedValue(undefined);
        const service = new AutomationService(prisma as any);

        await expect(service.createRuleWithinQuota('tenant_schema', {
            tenant_id: '11111111-1111-4111-8111-111111111111',
            name: 'Rule',
            trigger_type: 'new_message',
            conditions_json: [],
            actions_json: [],
        }, enforce)).resolves.toEqual({ id: 'rule-1' });

        expect(enforce).toHaveBeenCalledWith(3);
        expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
        expect(query.mock.calls[1][0]).toContain('COUNT(*)');
        expect(query.mock.calls[2][0]).toContain('INSERT INTO automation_rules');
    });

    it('checks the active quota before reactivating a legacy inactive rule', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: 'rule-1', active: false }])
            .mockResolvedValueOnce([{ count: 5 }])
            .mockResolvedValueOnce([{ id: 'rule-1', active: true }]);
        const prisma = {
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        const enforce = jest.fn().mockResolvedValue(undefined);
        const service = new AutomationService(prisma as any);

        await service.toggleRuleWithinQuota('tenant_schema', 'rule-1', true, enforce);

        expect(enforce).toHaveBeenCalledWith(5);
        expect(query.mock.calls[3][1]).toEqual(['rule-1', true]);
    });
});
