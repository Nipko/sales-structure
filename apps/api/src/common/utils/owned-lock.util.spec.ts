import { LockOwnershipLostError, OwnedLockLease } from './owned-lock.util';

describe('OwnedLockLease', () => {
    const logger: any = { error: jest.fn() };

    beforeEach(() => logger.error.mockClear());

    it('fails closed on a negative compare-and-renew and stays fenced', async () => {
        const redis: any = {
            renewLockToken: jest.fn()
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false),
        };
        const lease = new OwnedLockLease(redis, 'lock:test', 'token', 120, logger, 'test lease');

        await expect(lease.assertOwned()).resolves.toBeUndefined();
        await expect(lease.assertOwned()).rejects.toBeInstanceOf(LockOwnershipLostError);
        await expect(lease.assertOwned()).rejects.toBeInstanceOf(LockOwnershipLostError);
        expect(redis.renewLockToken).toHaveBeenCalledTimes(2);
        expect(lease.hasLostOwnership()).toBe(true);
    });

    it('treats a Redis renewal error as loss because ownership cannot be proven', async () => {
        const redis: any = {
            renewLockToken: jest.fn().mockRejectedValue(new Error('redis unavailable')),
        };
        const lease = new OwnedLockLease(redis, 'lock:test', 'token', 120, logger, 'test lease');

        await expect(lease.assertOwned()).rejects.toMatchObject({
            code: 'lock_ownership_lost',
            cause: expect.objectContaining({ message: 'redis unavailable' }),
        });
        expect(lease.hasLostOwnership()).toBe(true);
    });

    it('heartbeats at one third of the TTL and stops cleanly', async () => {
        jest.useFakeTimers();
        try {
            const redis: any = { renewLockToken: jest.fn().mockResolvedValue(true) };
            const lease = new OwnedLockLease(redis, 'lock:test', 'token', 120, logger, 'test lease');

            lease.start();
            await jest.advanceTimersByTimeAsync(40_000);
            expect(redis.renewLockToken).toHaveBeenCalledWith('lock:test', 'token', 120);
            lease.stop();
            await jest.advanceTimersByTimeAsync(80_000);
            expect(redis.renewLockToken).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });
});
