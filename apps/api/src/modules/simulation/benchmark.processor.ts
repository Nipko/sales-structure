import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BENCHMARK_QUEUE, BenchmarkService, type BenchmarkJob } from './benchmark.service';

/** One subject, one pass over the frozen corpus. */
@Processor(BENCHMARK_QUEUE, { concurrency: 1 })
export class BenchmarkProcessor extends WorkerHost {
    constructor(private readonly benchmark: BenchmarkService) { super(); }
    process(job: Job<BenchmarkJob>): Promise<any> { return this.benchmark.process(job.data); }
}
