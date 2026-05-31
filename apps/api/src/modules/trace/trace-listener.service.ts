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
}
