import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformNotificationOutboxService } from '../platform-notifications/platform-notification-outbox.service';
import { CronLockService } from '../redis/cron-lock.service';

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
        private readonly prisma: PrismaService,
        private readonly notifications: PlatformNotificationOutboxService,
        private readonly cronLock: CronLockService,
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
        const admitted = await this.admit(record,
            `meta:${data.user_id}:${Number(data.issued_at) || 0}`);

        this.logger.log(`Meta deletion callback received for fb_user_id=${data.user_id} → code=${admitted.code}`);

        void this.notifications.deliver(admitted.noticeId)
            .catch(e => this.logger.warn(`Compliance email deferred: ${e?.message}`));

        return {
            url: `${this.publicBaseUrl}/data-deletion/status?code=${admitted.code}`,
            confirmation_code: admitted.code,
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
        const minute = Math.floor(Date.now() / 60_000);
        const admitted = await this.admit(record, `user:${emailHash}:${minute}`);

        this.logger.log(`User deletion request submitted email_hash=${emailHash.slice(0, 12)} → code=${admitted.code}`);

        void this.notifications.deliver(admitted.noticeId)
            .catch(e => this.logger.warn(`Compliance email deferred: ${e?.message}`));

        return { confirmation_code: admitted.code };
    }

    async getStatus(code: string): Promise<DeletionRecord | null> {
        if (!code || !/^[a-f0-9-]{8,64}$/i.test(code)) return null;
        const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT code::text,source,fb_user_id,email,
            requested_at,processed_at,status,notes FROM meta_compliance_requests
            WHERE code=$1::uuid AND retention_until>NOW() LIMIT 1`, code);
        return rows[0] ? this.toPublicRecord(this.fromRow(rows[0])) : null;
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

        const record = await this.prisma.$transaction(async (tx: any) => {
            const rows = await tx.$queryRawUnsafe(`SELECT * FROM meta_compliance_requests
                WHERE code=$1::uuid AND retention_until>NOW() FOR UPDATE`, code);
            if (!rows[0]) throw new NotFoundException('Deletion request not found');
            const current = this.fromRow(rows[0]);
            const allowed: Record<DeletionStatus, DeletionStatus[]> = {
                received: ['processing', 'rejected'], processing: ['completed', 'rejected'],
                completed: [], rejected: [],
            };
            if (current.status !== status && !allowed[current.status]?.includes(status)) {
                throw new BadRequestException(`Invalid status transition: ${current.status} -> ${status}`);
            }
            const changed = current.status !== status;
            const updated = await tx.$queryRawUnsafe(`UPDATE meta_compliance_requests
                SET status=$2,notes=CASE WHEN $3<>'' THEN $3 ELSE notes END,
                    processed_at=CASE WHEN $4 AND $2 IN ('completed','rejected') THEN NOW() ELSE processed_at END,
                    updated_at=NOW() WHERE code=$1::uuid RETURNING *`,
            code, status, notes?.trim().slice(0, 1000) || '', changed);
            return this.fromRow(updated[0]);
        }, { isolationLevel: 'Serializable' as any });
        this.logger.log(`Deletion request ${code} marked ${status}`);
        return this.toPublicRecord(record);
    }

    // ── helpers ─────────────────────────────────────────────────────

    @Cron('11 4 * * *')
    async purgeExpired(): Promise<void> {
        await this.cronLock.runExclusive('meta-compliance.retention', 300, async () => {
            await this.prisma.$transaction(async (tx: any) => {
                await tx.$executeRawUnsafe(`DELETE FROM platform_notification_outbox
                    WHERE kind='meta_compliance.request_email' AND entity_id IN
                        (SELECT code FROM meta_compliance_requests WHERE retention_until<=NOW())`);
                await tx.$executeRawUnsafe('DELETE FROM meta_compliance_requests WHERE retention_until<=NOW()');
            });
        }, { prefer: 'worker' });
    }

    private async admit(record: DeletionRecord, requestKey: string): Promise<{ code: string; noticeId: string }> {
        return this.prisma.$transaction(async (tx: any) => {
            const rows = await tx.$queryRawUnsafe(`INSERT INTO meta_compliance_requests
                (code,request_key,source,fb_user_id,email,requested_at,status,notes)
                VALUES($1::uuid,$2,$3,$4,$5,$6::timestamptz,$7,$8)
                ON CONFLICT(request_key) DO UPDATE SET updated_at=meta_compliance_requests.updated_at
                RETURNING *`, record.code, requestKey, record.source, record.fbUserId || null,
            record.email || null, record.requestedAt, record.status, record.notes || null);
            const canonical = this.fromRow(rows[0]);
            const notices = await tx.$queryRawUnsafe(`INSERT INTO platform_notification_outbox
                (event_key,kind,entity_id,recipient_user_id,tenant_id,recipient_email,payload)
                VALUES($1,'meta_compliance.request_email',$2::uuid,NULL,NULL,$3,'{}'::jsonb)
                ON CONFLICT(event_key) DO UPDATE SET updated_at=platform_notification_outbox.updated_at
                RETURNING id`, `meta-compliance:${canonical.code}`, canonical.code, this.notifyEmail);
            return { code: canonical.code, noticeId: notices[0].id };
        }, { isolationLevel: 'Serializable' as any });
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

    private fromRow(row: any): DeletionRecord {
        return {
            code: String(row.code), source: row.source,
            fbUserId: row.fb_user_id || undefined, email: row.email || undefined,
            requestedAt: new Date(row.requested_at).toISOString(),
            processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : undefined,
            status: row.status, notes: row.notes || undefined,
        };
    }

    private base64UrlNormalize(input: string): string {
        return input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
    }

}
