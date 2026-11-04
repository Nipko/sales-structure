import { ReadinessScheduler } from './readiness.scheduler';

describe('ReadinessScheduler', () => {
    const build = (evaluateTenant: jest.Mock) => {
        const prisma: any = { tenant: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }, { id: 't3' }]) } };
        const cronLock: any = { runExclusive: jest.fn((_name: string, _ttl: number, fn: () => Promise<unknown>) => fn()) };
        return { prisma, cronLock, scheduler: new ReadinessScheduler(prisma, { evaluateTenant } as any, cronLock) };
    };

    it('evalúa cada tenant activo con trigger «scheduled»', async () => {
        const evaluateTenant = jest.fn().mockResolvedValue({});
        const { prisma, scheduler } = build(evaluateTenant);
        await expect(scheduler.evaluateAll()).resolves.toEqual({ evaluated: 3, failed: 0 });
        expect(prisma.tenant.findMany).toHaveBeenCalledWith({ where: { isActive: true }, select: { id: true } });
        expect(evaluateTenant.mock.calls).toEqual([['t1', 'scheduled'], ['t2', 'scheduled'], ['t3', 'scheduled']]);
    });

    it('un tenant que falla no detiene a los demás', async () => {
        const evaluateTenant = jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('sin esquema')).mockResolvedValueOnce({});
        const { scheduler } = build(evaluateTenant);
        await expect(scheduler.evaluateAll()).resolves.toEqual({ evaluated: 2, failed: 1 });
    });

    it('el cron corre con candado para no evaluar dos veces en paralelo', async () => {
        const { cronLock, scheduler } = build(jest.fn().mockResolvedValue({}));
        await scheduler.evaluateAllCron();
        expect(cronLock.runExclusive).toHaveBeenCalledWith('readiness.evaluateAll', 1800, expect.any(Function));
    });
});
