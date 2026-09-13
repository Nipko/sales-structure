import { Injectable, Logger } from '@nestjs/common';
import { HttpRequestService } from '../../../common/services/http-request.service';
import { interpolate } from '../utils/variable-interpolator';
import { extractFromResponse } from '../utils/response-extractor';

export type AutomationHttpOutcome = 'accepted' | 'rejected' | 'unknown';

export interface AutomationHttpResult extends Record<string, any> {
    outcome: AutomationHttpOutcome;
    statusCode: number | null;
    idempotencyKey: string;
    error?: string;
}

@Injectable()
export class HttpRequestHandler {
    private readonly logger = new Logger(HttpRequestHandler.name);

    constructor(private readonly httpRequestService: HttpRequestService) {}

    async execute(
        schemaName: string,
        config: any,
        eventPayload: any,
        execution: { idempotencyKey: string },
    ): Promise<AutomationHttpResult> {
        const context = this.buildContext(eventPayload);

        const url = interpolate(config.url, context) as string;
        const configuredHeaders = config.headers
            ? (interpolate(config.headers, context) as Record<string, string>)
            : {};
        // The job identity is owned by the platform. Header names are case
        // insensitive, so remove every tenant-supplied spelling before adding
        // the stable value that survives BullMQ retries.
        const headers = Object.fromEntries(Object.entries(configuredHeaders)
            .filter(([name]) => name.toLowerCase() !== 'idempotency-key'));
        headers['Idempotency-Key'] = execution.idempotencyKey;
        const body = config.body ? interpolate(config.body, context) : undefined;

        const method = (config.method || 'POST').toUpperCase();
        const timeoutMs = Math.min(config.timeout_ms || 10_000, 10_000);
        const safeToRepeat = ['GET', 'HEAD', 'OPTIONS'].includes(method);
        // A remote service is not required to honour Idempotency-Key. Retrying
        // a mutating request after losing its answer can therefore create a
        // second order, payment or CRM record. Reads may keep the configured
        // retry policy; writes get one attempt and an explicit unknown state.
        const retryCount = safeToRepeat ? Math.min(config.retry_count || 0, 3) : 0;

        // Invalid/unsafe destinations fail before the attempt begins and stay
        // ordinary errors. Once execute() starts, lack of an answer is an
        // uncertain external outcome and must not be retried as a refusal.
        this.httpRequestService.validateUrl(url);

        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= retryCount; attempt++) {
            try {
                const result = await this.httpRequestService.execute({
                    method: method as any,
                    url,
                    headers,
                    body,
                    timeoutMs,
                });

                this.logger.log(
                    `HTTP ${method} ${url} -> ${result.statusCode} (attempt ${attempt + 1})`,
                );

                let extracted: Record<string, any> = {};
                if (config.response_mapping && result.body && typeof result.body === 'object') {
                    extracted = extractFromResponse(result.body, config.response_mapping);
                }

                return {
                    ...extracted,
                    outcome: result.statusCode >= 200 && result.statusCode < 300
                        ? 'accepted'
                        : 'rejected',
                    statusCode: result.statusCode,
                    idempotencyKey: execution.idempotencyKey,
                };
            } catch (err: any) {
                lastError = err;
                this.logger.warn(
                    `HTTP request failed (attempt ${attempt + 1}/${retryCount + 1}): ${err.message}`,
                );
                if (attempt < retryCount) {
                    await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
                }
            }
        }

        return {
            outcome: 'unknown',
            statusCode: null,
            idempotencyKey: execution.idempotencyKey,
            error: lastError?.message || 'HTTP request failed',
        };
    }

    private buildContext(payload: any): Record<string, any> {
        return {
            contact: {
                name: payload.name || payload.contactName || '',
                phone: payload.phone || payload.contactPhone || '',
                email: payload.email || payload.contactEmail || '',
                tags: payload.tags || [],
                ...(payload.contact || {}),
            },
            deal: {
                id: payload.dealId || '',
                stage: payload.stage || '',
                value: payload.dealValue || payload.value || 0,
                ...(payload.deal || {}),
            },
            conversation: {
                id: payload.conversationId || '',
                channel: payload.channel || payload.channelType || '',
                ...(payload.conversation || {}),
            },
            lead: {
                id: payload.leadId || '',
                score: payload.leadScore || 0,
                source: payload.source || '',
                ...(payload.lead || {}),
            },
            trigger: {
                event_type: payload.eventType || payload.event_type || '',
                timestamp: new Date().toISOString(),
            },
        };
    }
}
