import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AGENT_RELEASE_QUEUE } from './agent-release-contract';
import { AgentReleaseService, type AgentReleaseJob } from './agent-release.service';

@Processor(AGENT_RELEASE_QUEUE,{concurrency:1})
export class AgentReleaseProcessor extends WorkerHost {
    constructor(private readonly releases:AgentReleaseService){super();}
    process(job:Job<AgentReleaseJob>):Promise<any>{return this.releases.process(job.data);}
}
