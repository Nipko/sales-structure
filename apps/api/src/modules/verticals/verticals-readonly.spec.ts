import { VerticalsService } from './verticals.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';

it('resolves the same fenced vertical without repairing settings or writing the cache during preview', async () => {
    const settings = { subType: 'hotel' };
    const prisma: any = { tenant: { findUnique: jest.fn().mockResolvedValue({ industry: 'turismo', settings }) }, $executeRawUnsafe: jest.fn() };
    const redis: any = { getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn(), del: jest.fn() };
    const service: any = new VerticalsService(prisma, redis, {} as any);
    service.persistVerticalConfigRepairCas = jest.fn().mockResolvedValue(true);
    const readonly = await service.getVerticalConfig('tenant', 0, AGENT_TEST_EXECUTION_CONTEXT);
    expect(readonly.industry).toBe('turismo');
    expect(service.persistVerticalConfigRepairCas).not.toHaveBeenCalled();
    expect(redis.setJson).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(settings).toEqual({ subType: 'hotel' });
    expect(await service.getVerticalConfig('tenant')).toEqual(readonly);
    expect(service.persistVerticalConfigRepairCas).toHaveBeenCalledTimes(1);
});
