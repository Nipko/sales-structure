import { AIToolExecutorService } from './ai-tool-executor.service';

describe('promotion schedule compatibility and malformed types', () => {
    afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
    function harness(hours: unknown, days: unknown = []) {
        const e = Object.create(AIToolExecutorService.prototype) as any;
        e.getTenantTimezone = jest.fn().mockResolvedValue('America/Bogota');
        e.restaurantsService = { listPromotions: jest.fn().mockResolvedValue([{
            title: 'Synthetic offer', discount_type: 'percent', discount_value: 10,
            applicable_hours: hours, applicable_days: days,
        }]) };
        e.logger = { error: jest.fn() };
        return e;
    }
    it.each([
        ['start inclusive', '2026-10-21T17:00:00Z', 1],
        ['end inclusive', '2026-10-21T18:00:00Z', 1],
        ['outside', '2026-10-21T18:01:00Z', 0],
    ])('preserves %s for a valid local window', async (_label, instant, count) => {
        jest.useFakeTimers().setSystemTime(new Date(instant));
        const result = await harness('12:00-13:00', ['wed']).getPromotions('tenant_synthetic');
        expect(result.error).toBeUndefined();
        expect(result.promotions).toHaveLength(count);
    });
    it.each([
        ['unknown weekday', null, ['funday']],
        ['numeric hours', 0, []],
        ['object hours', { start: '12:00', end: '13:00' }, []],
    ])('rejects %s without presenting an unrestricted offer', async (_label, hours, days) => {
        const result = await harness(hours, days).getPromotions('tenant_synthetic');
        expect(result.error).toBeDefined();
        expect(result.promotions).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('Synthetic offer');
    });
});
