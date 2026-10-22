import { AIToolExecutorService } from './ai-tool-executor.service';

describe('restaurant promotion schedule follows the tenant clock', () => {
    afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
    it.each([
        ['PROMOTZ_A_NEWYORK', 'America/New_York', '2026-10-22T03:00:00Z', ['wed'], null, true],
        ['PROMOTZ_A_TOKYO', 'Asia/Tokyo', '2026-10-21T19:00:00Z', ['thu'], null, true],
        ['PROMOTZ_A_LOSANGELES', 'America/Los_Angeles', '2026-10-21T13:00:00Z', [], '06:00-07:00', true],
        ['PROMOTZ_B_BOGOTA', 'America/Bogota', '2026-10-21T23:00:00Z', [], '22:00-23:59', false],
        ['PROMOTZ_B_PARIS', 'Europe/Paris', '2026-10-21T18:00:00Z', [], '19:00-21:00', true],
        ['PROMOTZ_B_KOLKATA', 'Asia/Kolkata', '2026-10-21T18:30:00Z', ['thu'], null, true],
    ])('%s filters the stored schedule using %s', async (_id, zone, instant, days, hours, included) => {
        jest.useFakeTimers().setSystemTime(new Date(instant as string));
        // Reproduce a UTC server independently of this test machine's timezone.
        jest.spyOn(Date.prototype, 'getDay').mockImplementation(function (this: Date) { return this.getUTCDay(); });
        jest.spyOn(Date.prototype, 'getHours').mockImplementation(function (this: Date) { return this.getUTCHours(); });
        jest.spyOn(Date.prototype, 'getMinutes').mockImplementation(function (this: Date) { return this.getUTCMinutes(); });
        const executor = Object.create(AIToolExecutorService.prototype) as any;
        executor.getTenantTimezone = jest.fn().mockResolvedValue(zone);
        executor.restaurantsService = { listPromotions: jest.fn().mockResolvedValue([{
            title: 'Synthetic scheduled offer', description: 'Synthetic QA only', discount_type: 'percent',
            discount_value: 10, applicable_days: days, applicable_hours: hours,
        }]) };
        executor.logger = { error: jest.fn(), warn: jest.fn() };
        const result = await executor.getPromotions('tenant_synthetic');
        expect(result.error).toBeUndefined();
        expect(result.promotions).toHaveLength(included ? 1 : 0);
        expect(executor.restaurantsService.listPromotions).toHaveBeenCalledWith('tenant_synthetic', true);
        expect(executor.getTenantTimezone).toHaveBeenCalledWith('tenant_synthetic');
    });
});
