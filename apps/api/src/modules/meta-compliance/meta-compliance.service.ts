import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';

const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

export type DeletionStatus = 'received' | 'processing' | 'completed' | 'rejected';

export interface DeletionRecord {
    code: string;
    source: 'meta_callback' | 'user_request';
    fbUserId?: string;
    email?: string;
    requestedAt: string;
    processedAt?: string;
    status: DeletionStatus;
    notes?: string;
}

@Injectable()
export class MetaComplianceService {
    private readonly logger = new Logger(MetaComplianceService.name);
    private readonly appSecret: string;
    private readonly publicBaseUrl: string;
    private readonly notifyEmail: string;

    constructor(
        private readonly config: ConfigService,
        private readonly redis: RedisService,
        private readonly email: EmailService,
    ) {
        this.appSecret = this.config.get<string>('META_APP_SECRET') || '';
        this.publicBaseUrl =
            this.config.get<string>('PUBLIC_LANDING_URL') || 'https://parallly-chat.cloud';
        this.notifyEmail =
            this.config.get<string>('COMPLIANCE_NOTIFY_EMAIL') || 'cloud.manager@parallext.com';
    }

    /**
     * Parse + verify Meta `signed_request` (HMAC-SHA256 base64url).
     * https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
     */
    parseSignedRequest(signedRequest: string): { user_id: string; algorithm: string; issued_at: number } {
        if (!signedRequest || !signedRequest.includes('.')) {
            throw new BadRequestException('Invalid signed_request format');
        }
        if (!this.appSecret) {
            throw new BadRequestException('META_APP_SECRET not configured');
        }

        const [encodedSig, payload] = signedRequest.split('.', 2);
        const expectedSig = crypto
            .createHmac('sha256', this.appSecret)
            .update(payload)
            .digest();

        const sigBuf = Buffer.from(this.base64UrlNormalize(encodedSig), 'base64');
        if (sigBuf.length !== expectedSig.length || !crypto.timingSafeEqual(sigBuf, expectedSig)) {
            throw new BadRequestException('Invalid signed_request signature');
        }

        const data = JSON.parse(
            Buffer.from(this.base64UrlNormalize(payload), 'base64').toString('utf8'),
        );
        if (data.algorithm !== 'HMAC-SHA256') {
            throw new BadRequestException(`Unsupported algorithm: ${data.algorithm}`);
        }
        if (!data.user_id) {
            throw new BadRequestException('Missing user_id in signed_request');
        }
        return data;
    }

    /**
     * Meta calls this when a Facebook user revokes our app. We acknowledge and
     * queue the deletion. The actual data-deletion job runs async (we don't yet
     * link tenant accounts to fb user_ids — once we do, this is where the
     * cascade happens).
     */
    async handleMetaCallback(signedRequest: string): Promise<{ url: string; confirmation_code: string }> {
        const data = this.parseSignedRequest(signedRequest);
        const code = this.generateCode();

        const record: DeletionRecord = {
            code,
            source: 'meta_callback',
            fbUserId: String(data.user_id),
            requestedAt: new Date().toISOString(),
            status: 'received',
        };
        await this.persist(record);

        this.logger.log(`Meta deletion callback received for fb_user_id=${data.user_id} → code=${code}`);

        // Notify compliance inbox so a human can complete the cascade
        this.email
            .send({
                to: this.notifyEmail,
                subject: `[Parallly] Meta data deletion callback — ${code}`,
                html: `<p>Meta requested deletion of fb_user_id <strong>${this.escape(String(data.user_id))}</strong>.</p>
                       <p>Tracking code: <code>${code}</code></p>
                       <p>Status URL: ${this.publicBaseUrl}/data-deletion/status?code=${code}</p>`,
            })
            .catch((e) => this.logger.warn(`Compliance email failed: ${e.message}`));

        return {
            url: `${this.publicBaseUrl}/data-deletion/status?code=${code}`,
            confirmation_code: code,
        };
    }

    /**
     * Public form: a person asks for deletion of their Parallly account and
     * associated data. The compliance operator verifies identity by email
     * before processing within SLA (30 days GDPR / 15 days LGPD).
     */
    async submitUserRequest(input: { email: string; description?: string }): Promise<{ confirmation_code: string }> {
        const email = (input.email || '').trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new BadRequestException('Valid email is required');
        }

        // Do not put PII in the Redis key. This limit complements the controller's
        // per-IP guard and prevents repeated requests targeting the same account.
        const emailHash = crypto.createHash('sha256').update(email).digest('hex');
        const emailCount = await this.redis.incrementRateLimit(
            `ratelimit:meta-deletion:email:${emailHash}`,
            24 * 60 * 60,
        );
        if (emailCount > 2) {
            throw new HttpException(
                'Too many deletion requests for this account. Please try again later.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const code = this.generateCode();
        const record: DeletionRecord = {
            code,
            source: 'user_request',
            email,
            requestedAt: new Date().toISOString(),
            status: 'received',
            notes: input.description?.slice(0, 1000),
        };
        await this.persist(record);

        this.logger.log(`User deletion request submitted email_hash=${emailHash.slice(0, 12)} → code=${code}`);

        this.email
            .send({
                to: this.notifyEmail,
                subject: `[Parallly] Account and data deletion request — ${code}`,
                html: `<p>A user requested deletion of a Parallly account and its associated data.</p>
                       <ul>
                         <li>Email: <strong>${this.escape(email)}</strong></li>
                         <li>Description: ${this.escape(input.description || '—')}</li>
                         <li>Code: <code>${code}</code></li>
                       </ul>
                       <p>Verify the requester's identity and authority before processing the deletion.</p>
                       <p>Process without undue delay, normally within 30 days unless applicable law requires a different period.</p>`,
            })
            .catch((e) => this.logger.warn(`Compliance email failed: ${e.message}`));

        return { confirmation_code: code };
    }

    async getStatus(code: string): Promise<DeletionRecord | null> {
        if (!code || !/^[a-f0-9-]{8,64}$/i.test(code)) return null;
        const raw = await this.redis.get(`meta:deletion:${code}`);
        if (!raw) return null;
        try {
            return this.toPublicRecord(JSON.parse(raw) as DeletionRecord);
        } catch {
            return null;
        }
    }

    async updateStatus(
        code: string,
        status: 'processing' | 'completed' | 'rejected' | undefined,
        notes?: string,
    ): Promise<DeletionRecord> {
        if (!code || !/^[a-f0-9-]{8,64}$/i.test(code)) {
            throw new BadRequestException('Invalid confirmation code');
        }
        if (status !== 'processing' && status !== 'completed' && status !== 'rejected') {
            throw new BadRequestException('Invalid deletion status');
        }

        const raw = await this.redis.get(`meta:deletion:${code}`);
        if (!raw) throw new NotFoundException('Deletion request not found');

        let record: DeletionRecord;
        try {
            record = JSON.parse(raw) as DeletionRecord;
        } catch {
            throw new NotFoundException('Deletion request not found');
        }

        const allowed: Record<DeletionStatus, DeletionStatus[]> = {
            received: ['processing', 'rejected'],
            processing: ['completed', 'rejected'],
            completed: [],
            rejected: [],
        };
        if (record.status !== status && !allowed[record.status]?.includes(status)) {
            throw new BadRequestException(`Invalid status transition: ${record.status} -> ${status}`);
        }

        const statusChanged = record.status !== status;
        record.status = status;
        if (notes?.trim()) record.notes = notes.trim().slice(0, 1000);
        if (statusChanged && (status === 'completed' || status === 'rejected')) {
            record.processedAt = new Date().toISOString();
        }
        await this.persist(record);
        this.logger.log(`Deletion request ${code} marked ${status}`);
        return this.toPublicRecord(record);
    }

    // ── helpers ─────────────────────────────────────────────────────

    private async persist(record: DeletionRecord) {
        await this.redis.set(
            `meta:deletion:${record.code}`,
            JSON.stringify(record),
            TTL_SECONDS,
        );
    }

    private generateCode(): string {
        return crypto.randomUUID();
    }

    private toPublicRecord(record: DeletionRecord): DeletionRecord {
        // Never expose email, fbUserId, or internal notes through public/admin responses.
        return {
            code: record.code,
            source: record.source,
            requestedAt: record.requestedAt,
            processedAt: record.processedAt,
            status: record.status,
        };
    }

    private base64UrlNormalize(input: string): string {
        return input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
    }

    private escape(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }
}
