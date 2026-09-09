import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CERTIFICATION_QUEUE } from './certification-contract';
import { CertificationService, type CertificationJob } from './certification.service';

/**
 * One worker, one batch. Concurrency is 1 per process on purpose: parallelism
 * comes from publishing several jobs, each of which leases its own cases, so
 * scaling out is adding workers rather than sharing a connection pool between
 * conversations that each take minutes.
 */
@Processor(CERTIFICATION_QUEUE, { concurrency: 1 })
export class CertificationProcessor extends WorkerHost {
    constructor(private readonly certification: CertificationService) { super(); }
    process(job: Job<CertificationJob>): Promise<any> { return this.certification.process(job.data); }
}
