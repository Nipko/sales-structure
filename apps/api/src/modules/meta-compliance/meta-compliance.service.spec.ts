import { BadRequestException } from '@nestjs/common';
import { MetaComplianceService } from './meta-compliance.service';

describe('MetaComplianceService request validation', () => {
    const redis = { incrementRateLimit: jest.fn() };
    const prisma = { $transaction: jest.fn(), $queryRawUnsafe: jest.fn() };
    const notifications = { deliver: jest.fn() };
    const cronLock = { runExclusive: jest.fn() };
    const config = { get: jest.fn((key: string) => ({
        META_APP_SECRET: 'test-secret', PUBLIC_LANDING_URL: 'https://parallly-chat.cloud',
        COMPLIANCE_NOTIFY_EMAIL: 'compliance@example.com',
    } as Record<string, string>)[key]) };
    let service: MetaComplianceService;

    beforeEach(() => {
        jest.clearAllMocks();
        redis.incrementRateLimit.mockResolvedValue(1);
        service = new MetaComplianceService(config as any, redis as any, prisma as any,
            notifications as any, cronLock as any);
    });

    it('rejects malformed signed requests before writing anything', () => {
        expect(() => service.parseSignedRequest('broken')).toThrow(BadRequestException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('limits repeated requests aimed at one account before database admission', async () => {
        redis.incrementRateLimit.mockResolvedValueOnce(3);
        await expect(service.submitUserRequest({ email: 'agent@example.com' })).rejects.toMatchObject({ status: 429 });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(notifications.deliver).not.toHaveBeenCalled();
    });

    it('rejects an invalid email before rate limiting or admission', async () => {
        await expect(service.submitUserRequest({ email: 'invalid' })).rejects.toBeInstanceOf(BadRequestException);
        expect(redis.incrementRateLimit).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
