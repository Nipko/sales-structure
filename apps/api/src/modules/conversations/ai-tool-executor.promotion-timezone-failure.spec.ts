import { AIToolExecutorService } from './ai-tool-executor.service';

describe('promotion timezone failures remain failed reads', () => {
    it.each(['unavailable', 'invalid'])('does not claim no promotions when timezone is %s', async kind => {
        const executor = Object.create(AIToolExecutorService.prototype) as any;
        executor.getTenantTimezone = kind === 'unavailable'
            ? jest.fn().mockRejectedValue(new Error('synthetic internal timezone failure'))
            : jest.fn().mockResolvedValue('Synthetic/Invalid');
        executor.restaurantsService = { listPromotions: jest.fn().mockResolvedValue([{ title: 'Synthetic offer' }]) };
        executor.logger = { error: jest.fn() };
        const result = await executor.getPromotions('tenant_synthetic');
        expect(result.error).toBeDefined();
        expect(result.promotions).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('No active promotions');
        expect(JSON.stringify(result)).not.toContain('synthetic internal timezone failure');
        expect(JSON.stringify(result)).not.toContain('Synthetic/Invalid');
        expect(executor.getTenantTimezone).toHaveBeenCalledTimes(1);
    });
});
