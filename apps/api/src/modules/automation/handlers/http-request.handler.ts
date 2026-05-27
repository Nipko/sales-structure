import { Injectable, Logger } from '@nestjs/common';
import { HttpRequestService } from '../../../common/services/http-request.service';
import { interpolate } from '../utils/variable-interpolator';
import { extractFromResponse } from '../utils/response-extractor';

@Injectable()
export class HttpRequestHandler {
    private readonly logger = new Logger(HttpRequestHandler.name);

    constructor(private readonly httpRequestService: HttpRequestService) {}

    async execute(
        schemaName: string,
        config: any,
        eventPayload: any,
    ): Promise<Record<string, any>> {
        const context = this.buildContext(eventPayload);

        const url = interpolate(config.url, context) as string;
        const headers = config.headers
            ? (interpolate(config.headers, context) as Record<string, string>)
            : {};
        const body = config.body ? interpolate(config.body, context) : undefined;

        const method = (config.method || 'POST').toUpperCase();
        const timeoutMs = Math.min(config.timeout_ms || 10_000, 10_000);
        const retryCount = Math.min(config.retry_count || 0, 3);

        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= retryCount; attempt++) {
            try {
                this.httpRequestService.validateUrl(url);
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
                    statusCode: result.statusCode,
                    ...extracted,
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

        throw lastError || new Error('HTTP request failed');
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
