import { InboundFailedRedriveService } from './inbound-failed-redrive.service';

function failedJob(input: {
    id: string;
    finishedOn: number;
    redriveCount?: number;
    retryError?: Error;
}) {
    const job: any = {
        id: input.id,
        finishedOn: input.finishedOn,
        data: {
            msg: { tenantId: `tenant-${input.id}` },
            enqueuedAt: input.finishedOn - 1_000,
            redriveCount: input.redriveCount,
        },
        updateData: jest.fn(async (next) => { job.data = next; }),
        retry: input.retryError
            ? jest.fn().mockRejectedValue(input.retryError)
            : jest.fn().mockResolvedValue(undefined),
    };
    return job;
}

describe('InboundFailedRedriveService', () => {
    const now = 1_800_000_000_000;

    it('retries an old failed message and records a bounded rescue count', async () => {
        const job = failedJob({ id: 'one', finishedOn: now - 120_000 });
        const queue = { getFailed: jest.fn().mockResolvedValue([job]) };
        const service = new InboundFailedRedriveService(queue as any, {} as any);

        await expect(service.redriveFailedJobs(now)).resolves.toEqual({
            inspected: 1, retried: 1, exhausted: 0, tooRecent: 0, errors: 0,
        });
        expect(job.updateData).toHaveBeenCalledWith(expect.objectContaining({
            redriveCount: 1,
            lastRedrivenAt: now,
        }));
        expect(job.retry).toHaveBeenCalledWith('failed');
    });

    it('does not race a job that only just entered the failed set', async () => {
        const job = failedJob({ id: 'recent', finishedOn: now - 5_000 });
        const service = new InboundFailedRedriveService(
            { getFailed: jest.fn().mockResolvedValue([job]) } as any,
            {} as any,
        );

        expect(await service.redriveFailedJobs(now)).toMatchObject({ tooRecent: 1, retried: 0 });
        expect(job.retry).not.toHaveBeenCalled();
    });

    it('leaves an exhausted deterministic failure visible instead of looping', async () => {
        const job = failedJob({ id: 'exhausted', finishedOn: now - 120_000, redriveCount: 2 });
        const service = new InboundFailedRedriveService(
            { getFailed: jest.fn().mockResolvedValue([job]) } as any,
            {} as any,
        );

        expect(await service.redriveFailedJobs(now)).toMatchObject({ exhausted: 1, retried: 0 });
        expect(job.updateData).not.toHaveBeenCalled();
        expect(job.retry).not.toHaveBeenCalled();
    });

    it('runs once across API and worker through the distributed cron lock', async () => {
        const cronLock = { runExclusive: jest.fn().mockResolvedValue(undefined) };
        const service = new InboundFailedRedriveService({} as any, cronLock as any);

        await service.redriveCron();

        expect(cronLock.runExclusive).toHaveBeenCalledWith(
            'inbound.failedRedrive',
            240,
            expect.any(Function),
            { prefer: 'worker' },
        );
    });
});
