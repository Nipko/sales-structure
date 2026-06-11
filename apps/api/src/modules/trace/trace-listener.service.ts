import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TraceService, LlmTurnEvent } from './trace.service';

/**
 * Persists per-turn LLM trace events (T1.7). Runs in the API process where the
 * conversation pipeline emits 'llm.turn'. Writes are best-effort and async.
 */
@Injectable()
export class TraceListenerService {
    constructor(private readonly trace: TraceService) {}

    @OnEvent('llm.turn')
    async handleTurn(event: LlmTurnEvent) {
        await this.trace.record(event);
    }

    /** Step-by-step turn trace (WS5 #1), emitted at the end of generateResponse. */
    @OnEvent('llm.turn.steps')
    async handleTurnSteps(evt: {
        tenantId: string;
        conversationId: string;
        messageId?: string | null;
        totalDurationMs: number;
        stepCount: number;
        steps: any[];
    }) {
        await this.trace.recordTurn(evt);
    }
}
