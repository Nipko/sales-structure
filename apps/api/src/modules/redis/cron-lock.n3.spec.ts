import { CronLockService } from './cron-lock.service';

/**
 * N3 · crons with lock — the contract of `CronLockService`, the one thing that stops every
 * `@Cron` from running twice (the API and the worker load the same AppModule).
 *
 *   exclusive   of two simultaneous callers of one cron name, exactly one runs the body;
 *   per name    different crons do not block each other;
 *   not released  the lock is NOT released when the body ends, so a twin that starts late
 *               (after the first one finished) is still refused until the TTL expires;
 *   TTL         the TTL handed to Redis is the one the cron declared;
 *   fail-open   when Redis does not answer, the body runs (a missed reminder is worse
 *               than a duplicated one) and the failure is not thrown.
 * Redis is a double with SET NX semantics.
 */
describe('N3 crons with lock: CronLockService', () => {
    const build = (over: { fail?: boolean } = {}) => {
        const held = new Map<string, number>();
        const acquireLock = jest.fn(async (key: string, ttl: number) => {
            if (over.fail) throw new Error('redis_down');
            if (held.has(key)) return false;
            held.set(key, ttl);
            return true;
        });
        return { service: new CronLockService({ acquireLock } as any), acquireLock, held };
    };

    it('runs the body in exactly one of two simultaneous callers', async () => {
        const { service } = build();
        const body = jest.fn(async () => { await new Promise(r => setTimeout(r, 20)); });
        await Promise.all([service.runExclusive('appointment-reminders.send24hReminders', 300, body),
            service.runExclusive('appointment-reminders.send24hReminders', 300, body)]);
        expect(body).toHaveBeenCalledTimes(1);
    });

    it('does not let one cron block another', async () => {
        const { service } = build();
        const a = jest.fn(async () => undefined), b = jest.fn(async () => undefined);
        await service.runExclusive('recall.processRecalls', 3600, a);
        await service.runExclusive('broadcast.launchScheduledCampaigns', 45, b);
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('keeps the lock after the body finished: a late twin is refused', async () => {
        const { service } = build();
        const body = jest.fn(async () => undefined);
        await service.runExclusive('dispatch-recovery.recoverPending', 110, body);
        await service.runExclusive('dispatch-recovery.recoverPending', 110, body);
        expect(body).toHaveBeenCalledTimes(1);
    });

    it('asks Redis for the TTL the cron declared, under a key that names the cron', async () => {
        const { service, acquireLock } = build();
        await service.runExclusive('recall.processRecalls', 3600, async () => undefined);
        expect(acquireLock).toHaveBeenCalledWith('lock:cron:recall.processRecalls', 3600);
    });

    it('fails open: with Redis down the body still runs and nothing is thrown', async () => {
        const { service } = build({ fail: true });
        const body = jest.fn(async () => undefined);
        await expect(service.runExclusive('recall.processRecalls', 3600, body)).resolves.toBeUndefined();
        expect(body).toHaveBeenCalledTimes(1);
    });

    it('propagates a failure of the body itself (it is not swallowed as a lock error)', async () => {
        const { service } = build();
        await expect(service.runExclusive('x.y', 30, async () => { throw new Error('body_failed'); })).rejects.toThrow('body_failed');
    });
});
