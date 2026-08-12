import { createHash, timingSafeEqual } from 'node:crypto';
import {
    BadRequestException,
    HttpException,
    HttpStatus,
    Injectable,
    Logger,
    PayloadTooLargeException,
    ServiceUnavailableException,
    UnsupportedMediaTypeException,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';

const DEFAULT_HEADER_NAME = 'x-email-webhook-secret';
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_GLOBAL_RATE_LIMIT = 600;
const DEFAULT_RECIPIENT_RATE_LIMIT = 120;
const RATE_WINDOW_SECONDS = 60;

const FIELD_LIMITS = Object.freeze({
    from: 2_048,
    sender: 2_048,
    to: 8_192,
    cc: 8_192,
    subject: 998,
    text: 250_000,
    html: 750_000,
    headers: 128_000,
    'message-id': 2_048,
});

export type SafeEmailWebhookPayload = Record<string, unknown>;

interface RequestLike {
    headers?: Record<string, string | string[] | undefined>;
}

/**
 * Security boundary for the managed inbound-email adapter.
 *
 * This is intentionally independent from tenant authentication: a provider or
 * trusted reverse proxy authenticates with one platform-level secret, then the
 * controller resolves the recipient to a tenant. If the secret is absent from
 * the runtime configuration, the endpoint fails closed.
 */
@Injectable()
export class EmailWebhookSecurityService {
    private readonly logger = new Logger(EmailWebhookSecurityService.name);
    private readonly headerName: string;
    private readonly maxBodyBytes: number;
    private readonly globalRateLimit: number;
    private readonly recipientRateLimit: number;

    constructor(
        private readonly config: ConfigService,
        private readonly redis: RedisService,
    ) {
        this.headerName = (
            this.config.get<string>('EMAIL_INBOUND_WEBHOOK_HEADER')
            || DEFAULT_HEADER_NAME
        ).trim().toLowerCase();
        this.maxBodyBytes = this.readBoundedInteger(
            'EMAIL_INBOUND_MAX_BODY_BYTES',
            DEFAULT_MAX_BODY_BYTES,
            16_384,
            10_485_760,
        );
        this.globalRateLimit = this.readBoundedInteger(
            'EMAIL_INBOUND_RATE_LIMIT_PER_MINUTE',
            DEFAULT_GLOBAL_RATE_LIMIT,
            1,
            100_000,
        );
        this.recipientRateLimit = this.readBoundedInteger(
            'EMAIL_INBOUND_RECIPIENT_RATE_LIMIT_PER_MINUTE',
            DEFAULT_RECIPIENT_RATE_LIMIT,
            1,
            10_000,
        );
    }

    /** Authenticate, bound and reduce a request before any tenant lookup. */
    async protect(request: RequestLike, body: unknown): Promise<SafeEmailWebhookPayload> {
        this.assertAuthenticated(request);
        this.assertJsonContentType(request);
        this.assertDeclaredLength(request);
        const payload = this.sanitizePayload(body);
        await this.assertWithinRateLimit(this.extractRecipient(payload));
        return payload;
    }

    private assertJsonContentType(request: RequestLike): void {
        const contentType = this.readHeader(request, 'content-type');
        const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
        if (mediaType !== 'application/json') {
            throw new UnsupportedMediaTypeException(
                'Inbound email accepts authenticated JSON only',
            );
        }
    }

    private assertAuthenticated(request: RequestLike): void {
        if (!/^[a-z0-9-]{1,64}$/.test(this.headerName)) {
            this.logger.error('EMAIL_INBOUND_WEBHOOK_HEADER is invalid; inbound email is disabled');
            throw new ServiceUnavailableException('Inbound email webhook is not configured');
        }

        const expected = this.config.get<string>('EMAIL_INBOUND_WEBHOOK_SECRET');
        if (!expected || expected.trim().length < 32) {
            this.logger.error('EMAIL_INBOUND_WEBHOOK_SECRET is missing or too short; inbound email is disabled');
            throw new ServiceUnavailableException('Inbound email webhook is not configured');
        }

        const supplied = this.readHeader(request, this.headerName);
        if (!supplied || supplied.length > 512 || !this.constantTimeEqual(expected, supplied)) {
            throw new UnauthorizedException('Invalid inbound email webhook credentials');
        }
    }

    private assertDeclaredLength(request: RequestLike): void {
        const rawLength = this.readHeader(request, 'content-length');
        if (!rawLength) return;
        if (!/^\d+$/.test(rawLength)) {
            throw new BadRequestException('Invalid Content-Length');
        }
        if (Number(rawLength) > this.maxBodyBytes) {
            throw new PayloadTooLargeException('Inbound email payload is too large');
        }
    }

    private sanitizePayload(body: unknown): SafeEmailWebhookPayload {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new BadRequestException('Inbound email payload must be an object');
        }

        const source = body as Record<string, unknown>;
        if (Object.keys(source).length > 64) {
            throw new BadRequestException('Inbound email payload has too many fields');
        }

        let serialized: string;
        try {
            serialized = JSON.stringify(source);
        } catch {
            throw new BadRequestException('Inbound email payload is not serializable');
        }
        if (Buffer.byteLength(serialized, 'utf8') > this.maxBodyBytes) {
            throw new PayloadTooLargeException('Inbound email payload is too large');
        }

        const safe: SafeEmailWebhookPayload = {};
        this.copyShortField(source, safe, 'from', FIELD_LIMITS.from);
        this.copyShortField(source, safe, 'sender', FIELD_LIMITS.sender);
        this.copyAddressField(source, safe, 'cc', FIELD_LIMITS.cc);
        this.copyShortField(source, safe, 'subject', FIELD_LIMITS.subject);
        this.copyLongField(source, safe, 'text', FIELD_LIMITS.text);
        this.copyLongField(source, safe, 'html', FIELD_LIMITS.html);
        this.copyLongField(source, safe, 'headers', FIELD_LIMITS.headers);
        this.copyShortField(source, safe, 'message-id', FIELD_LIMITS['message-id']);

        if (typeof safe.headers === 'string') {
            this.assertEmbeddedHeaderLength(safe.headers, 'Message-ID', 2_048);
            this.assertEmbeddedHeaderLength(safe.headers, 'In-Reply-To', 2_048);
            this.assertEmbeddedHeaderLength(safe.headers, 'References', 16_384);
        }

        // Routing trusts only the authenticated SMTP envelope, never the
        // display-level `to` header. Multiple envelope recipients are rejected
        // so one delivery can never be routed into a tenant while exposing a
        // BCC recipient belonging to another tenant.
        if (source.envelope === undefined) {
            throw new BadRequestException('Authenticated email envelope is required');
        }
        const envelope = this.normalizeEnvelope(source.envelope);
        safe.envelope = envelope;
        // Keep the adapter metadata consistent with the routing decision. Any
        // caller-supplied body.to is deliberately overwritten.
        safe.to = envelope.to[0];

        if (source.attachments !== undefined) {
            const count = typeof source.attachments === 'number'
                ? source.attachments
                : Number.parseInt(String(source.attachments), 10);
            if (!Number.isSafeInteger(count) || count < 0 || count > 10) {
                throw new BadRequestException('Invalid email attachment count');
            }
            // Attachment blobs are deliberately not forwarded. The current
            // managed adapter records only the count and processes text/HTML.
            safe.attachments = String(count);
        }

        return safe;
    }

    private copyShortField(
        source: Record<string, unknown>,
        target: SafeEmailWebhookPayload,
        key: keyof typeof FIELD_LIMITS,
        maxLength: number,
    ): void {
        const value = source[key];
        if (value === undefined || value === null) return;
        if (typeof value !== 'string' || value.length > maxLength || /[\r\n\0]/.test(value)) {
            throw new BadRequestException(`Invalid email field: ${key}`);
        }
        target[key] = value;
    }

    private copyAddressField(
        source: Record<string, unknown>,
        target: SafeEmailWebhookPayload,
        key: 'to' | 'cc',
        maxLength: number,
    ): void {
        const value = source[key];
        if (value === undefined || value === null) return;
        if (Array.isArray(value) && value.length > 50) {
            throw new BadRequestException(`Invalid email field: ${key}`);
        }
        const normalized = Array.isArray(value)
            ? value.map(item => {
                if (typeof item !== 'string') {
                    throw new BadRequestException(`Invalid email field: ${key}`);
                }
                return item;
            }).join(', ')
            : value;
        if (typeof normalized !== 'string' || normalized.length > maxLength || /[\r\n\0]/.test(normalized)) {
            throw new BadRequestException(`Invalid email field: ${key}`);
        }
        target[key] = normalized;
    }

    private copyLongField(
        source: Record<string, unknown>,
        target: SafeEmailWebhookPayload,
        key: 'text' | 'html' | 'headers',
        maxLength: number,
    ): void {
        const value = source[key];
        if (value === undefined || value === null) return;
        if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
            throw new BadRequestException(`Invalid email field: ${key}`);
        }
        target[key] = value;
    }

    private normalizeEnvelope(value: unknown): { to: [string]; from?: string } {
        let parsed = value;
        if (typeof parsed === 'string') {
            if (parsed.length > 16_384) {
                throw new BadRequestException('Email envelope is too large');
            }
            try {
                parsed = JSON.parse(parsed);
            } catch {
                throw new BadRequestException('Invalid email envelope');
            }
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new BadRequestException('Invalid email envelope');
        }

        const envelope = parsed as Record<string, unknown>;
        if (envelope.to === undefined) {
            throw new BadRequestException('Email envelope recipient is required');
        }
        const recipients = Array.isArray(envelope.to) ? envelope.to : [envelope.to];
        if (recipients.length !== 1 || typeof recipients[0] !== 'string') {
            throw new BadRequestException('Email envelope must contain exactly one recipient');
        }
        const recipient = this.normalizeEmailAddress(recipients[0]);
        const result: { to: [string]; from?: string } = { to: [recipient] };
        if (envelope.from !== undefined) {
            if (typeof envelope.from !== 'string') {
                throw new BadRequestException('Invalid email envelope sender');
            }
            result.from = this.normalizeEmailAddress(envelope.from);
        }
        return result;
    }

    private async assertWithinRateLimit(recipient: string): Promise<void> {
        const bucket = Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1_000));
        const rules = [
            {
                key: `email:webhook:rl:global:${bucket}`,
                limit: this.globalRateLimit,
            },
        ];
        if (recipient) {
            rules.push({
                key: `email:webhook:rl:recipient:${this.digest(recipient)}:${bucket}`,
                limit: this.recipientRateLimit,
            });
        }

        const counts = await Promise.all(
            rules.map(rule => this.redis.incrementRateLimit(rule.key, RATE_WINDOW_SECONDS * 2)),
        );
        if (counts.some((count, index) => count > rules[index].limit)) {
            throw new HttpException(
                {
                    statusCode: HttpStatus.TOO_MANY_REQUESTS,
                    message: 'Inbound email webhook rate limit exceeded',
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
    }

    private extractRecipient(payload: SafeEmailWebhookPayload): string {
        const envelope = payload.envelope as { to?: string[] } | undefined;
        return envelope?.to?.[0] || '';
    }

    private normalizeEmailAddress(raw: string): string {
        if (!raw || raw.length > 2_048 || /[\r\n\0]/.test(raw)) {
            throw new BadRequestException('Invalid email envelope address');
        }
        const matches = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi);
        if (!matches || matches.length !== 1 || matches[0].length > 254) {
            throw new BadRequestException('Invalid email envelope address');
        }
        return matches[0].toLowerCase();
    }

    private assertEmbeddedHeaderLength(headers: string, name: string, maxLength: number): void {
        const match = headers.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'));
        if (match?.[1] && match[1].trim().length > maxLength) {
            throw new BadRequestException(`Invalid email header: ${name}`);
        }
    }

    private readHeader(request: RequestLike, name: string): string {
        const value = request.headers?.[name.toLowerCase()];
        return typeof value === 'string' ? value : '';
    }

    private constantTimeEqual(expected: string, supplied: string): boolean {
        // Hash both values first so timingSafeEqual always receives equal-size
        // buffers and does not expose the configured secret length.
        const a = createHash('sha256').update(expected, 'utf8').digest();
        const b = createHash('sha256').update(supplied, 'utf8').digest();
        return timingSafeEqual(a, b);
    }

    private digest(value: string): string {
        return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24);
    }

    private readBoundedInteger(name: string, fallback: number, min: number, max: number): number {
        const raw = this.config.get<string | number>(name);
        if (raw === undefined || raw === null || raw === '') return fallback;
        const value = Number(raw);
        return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
    }
}
