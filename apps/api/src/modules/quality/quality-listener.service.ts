import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { QualityService } from './quality.service';

/**
 * Listens for conversation resolution and enqueues a QA scoring job.
 * Runs in the API process (where the event is emitted); the worker picks up the job.
 */
@Injectable()
export class QualityListenerService {
    private readonly logger = new Logger(QualityListenerService.name);

    constructor(private readonly quality: QualityService) {}

    @OnEvent('conversation.resolved')
    async handleResolved(payload: { tenantId: string; conversationId: string }) {
        if (!payload?.tenantId || !payload?.conversationId) return;
        try {
            await this.quality.enqueue(payload.tenantId, payload.conversationId);
        } catch (error: any) {
            // EventEmitter listeners run in the request process. Queue outages
            // must be observable, but must not turn a successfully resolved
            // customer conversation into an HTTP/WS failure for the agent.
            this.logger.error(
                `Could not schedule quality scoring for ${payload.conversationId}: ${error?.message || error}`,
            );
        }
    }
}
