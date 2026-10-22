import { AIToolExecutorService } from './ai-tool-executor.service';

describe('malformed stored promotion schedules are not unrestricted offers', () => {
    afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
    it.each([
        ['PROMOBAD_A_TEXT', 'anytime', []],
        ['PROMOBAD_A_HOUR', '99:00-99:59', []],
        ['PROMOBAD_A_MINUTE', '08:99-23:99', []],
        ['PROMOBAD_B_NAN', '08:xx-23:00', []],
        ['PROMOBAD_B_EXTRA', '00:00-23:59-12:00', []],
        ['PROMOBAD_B_DAYS', null, 'wed'],
    ])('%s returns a failed read for hours=%s days=%s', async (_id, hours, days) => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-21T17:00:00Z'));
        const executor = Object.create(AIToolExecutorService.prototype) as any;
        executor.getTenantTimezone = jest.fn().mockResolvedValue('America/Bogota');
        executor.restaurantsService = { listPromotions: jest.fn().mockResolvedValue([{
            title: 'Synthetic restricted offer', description: 'Synthetic QA only', discount_type: 'percent',
            discount_value: 10, applicable_days: days, applicable_hours: hours,
        }]) };
        executor.logger = { error: jest.fn() };
        const result = await executor.getPromotions('tenant_synthetic');
        expect(result.error).toBeDefined();
        expect(result.promotions).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('No active promotions');
        expect(JSON.stringify(result)).not.toContain('Synthetic restricted offer');
        expect(executor.restaurantsService.listPromotions).toHaveBeenCalledTimes(1);
    });
});
