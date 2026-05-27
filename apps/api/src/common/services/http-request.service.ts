import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';

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

@Injectable()
export class HttpRequestService {
    private readonly logger = new Logger(HttpRequestService.name);

    constructor(private readonly httpService: HttpService) {}

    validateUrl(url: string): void {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw new BadRequestException(`Invalid URL: ${url.substring(0, 80)}`);
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new BadRequestException('URL must use http or https protocol');
        }
        const hostname = parsed.hostname.toLowerCase();
        const blocked = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|::1|fd|fe80)/;
        if (blocked.test(hostname)) {
            throw new BadRequestException('URL must not point to private/reserved IP ranges');
        }
    }

    async execute(config: HttpRequestConfig): Promise<HttpRequestResult> {
        this.validateUrl(config.url);
        const timeout = Math.min(config.timeoutMs || 10_000, 10_000);

        const response = await this.httpService.axiosRef.request({
            method: config.method,
            url: config.url,
            headers: config.headers || {},
            data: config.body,
            timeout,
            validateStatus: () => true,
        });

        return {
            statusCode: response.status,
            headers: response.headers as Record<string, string>,
            body: response.data,
        };
    }
}
