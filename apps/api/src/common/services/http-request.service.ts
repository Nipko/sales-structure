import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import {
    parseSafeHttpsUrl,
    prepareSafeHttpsTarget,
    safeAxiosOptions,
} from '../utils/safe-outbound-url.util';

export interface HttpRequestConfig {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    url: string;
    headers?: Record<string, string>;
    body?: any;
    timeoutMs?: number;
}

export interface HttpRequestResult {
    statusCode: number;
    headers: Record<string, string>;
    body: any;
}

const FORBIDDEN_OUTBOUND_HEADERS = new Set([
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'upgrade',
    'proxy-authorization',
    'proxy-connection',
    'forwarded',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-forwarded-port',
    'x-original-url',
    'x-rewrite-url',
]);

@Injectable()
export class HttpRequestService {
    private readonly logger = new Logger(HttpRequestService.name);

    constructor(private readonly httpService: HttpService) {}

    validateUrl(url: string): void {
        try {
            parseSafeHttpsUrl(url, 'solicitud HTTP');
        } catch (error) {
            if (error instanceof BadRequestException) throw error;
            throw new BadRequestException(`Invalid URL: ${String(url).substring(0, 80)}`);
        }
    }

    private validateHeaders(headers: Record<string, string>): Record<string, string> {
        for (const name of Object.keys(headers)) {
            if (FORBIDDEN_OUTBOUND_HEADERS.has(name.toLowerCase())) {
                throw new BadRequestException(`Outbound header is not allowed: ${name}`);
            }
        }
        return headers;
    }

    async execute(config: HttpRequestConfig): Promise<HttpRequestResult> {
        this.validateUrl(config.url);
        const timeout = Math.min(config.timeoutMs || 10_000, 10_000);
        const headers = this.validateHeaders(config.headers || {});
        const target = await prepareSafeHttpsTarget(config.url, 'solicitud HTTP');

        const response = await this.httpService.axiosRef.request({
            ...safeAxiosOptions(target, timeout),
            method: config.method,
            url: target.url.toString(),
            headers,
            data: config.body,
            validateStatus: () => true,
        });

        return {
            statusCode: response.status,
            headers: response.headers as Record<string, string>,
            body: response.data,
        };
    }
}
