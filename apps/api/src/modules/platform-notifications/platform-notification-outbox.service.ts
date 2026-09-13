import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CronLockService } from '../redis/cron-lock.service';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
    under_review: 'En revisión', planned: 'Planeada', in_progress: 'En desarrollo',
    shipped: 'Lanzada', declined: 'Rechazada', open: 'Abierta',
});

const htmlEscape = (value: unknown): string => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

/**
 * Durable delivery for notifications owned by the platform database.
 *
 * `claimed` proves that no provider request has started. `sending` means a
 * request may have left the process. Recovery can therefore retry an expired
 * claim, while an expired send waits for reconciliation instead of producing a
 * duplicate email.
 */
@Injectable()
export class PlatformNotificationOutboxService {
    private readonly logger = new Logger(PlatformNotificationOutboxService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly email: EmailService,
        private readonly config: ConfigService,
        private readonly cronLock: CronLockService,
    ) {}

    @Cron('37 * * * * *')
    async recoverCron(): Promise<void> {
        await this.cronLock.runExclusive('platform-notifications.recover', 40,
            () => this.processDue(), { prefer: 'worker' });
    }

    async processDue(limit = 100): Promise<number> {
        const bounded = Math.min(Math.max(Number(limit) || 1, 1), 100);
        await this.prisma.$executeRawUnsafe(`UPDATE platform_notification_outbox
            SET state='failed',lease_token=NULL,lease_expires_at=NULL,
                error_code='notification_claim_expired',next_attempt_at=NOW(),updated_at=NOW()
            WHERE state='claimed' AND lease_expires_at<=NOW()`);
        await this.prisma.$executeRawUnsafe(`UPDATE platform_notification_outbox
            SET state='reconciliation_required',lease_token=NULL,lease_expires_at=NULL,
                error_code='notification_send_outcome_unknown',updated_at=NOW()
            WHERE state='sending' AND lease_expires_at<=NOW()`);
        const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id
            FROM platform_notification_outbox
            WHERE state IN ('pending','failed') AND attempts<5 AND next_attempt_at<=NOW()
            ORDER BY created_at,id LIMIT ${bounded}`);
        for (const row of rows) {
            try { await this.deliver(row.id); }
            catch (error: any) { this.logger.warn(`Platform notification ${row.id} failed: ${error?.message}`); }
        }
        return rows.length;
    }

    async deliver(id: string): Promise<string> {
        if (!UUID.test(id)) throw new Error('platform_notification_invalid_id');
        const lease = randomUUID();
        const claim = await this.prisma.$transaction(async (tx: any) => {
            const rows = await tx.$queryRawUnsafe(`SELECT o.*,u.email,u.first_name
                FROM platform_notification_outbox o
                JOIN users u ON u.id=o.recipient_user_id
                WHERE o.id=$1::uuid FOR UPDATE OF o,u`, id);
            const row = rows[0];
            if (!row) return { state: 'missing' };
            if (!['pending', 'failed'].includes(row.state) || Number(row.attempts) >= 5) {
                return { state: row.state };
            }
            const active = await tx.$queryRawUnsafe(`SELECT 1
                FROM feature_requests fr
                JOIN feature_request_subscribers s ON s.request_id=fr.id
                WHERE fr.id=$1::uuid AND s.user_id=$2::uuid
                  AND EXISTS(SELECT 1 FROM users u WHERE u.id=s.user_id AND u.is_active=true AND u.email IS NOT NULL)
                LIMIT 1`, row.entity_id, row.recipient_user_id);
            if (!active[0]) {
                await tx.$executeRawUnsafe(`UPDATE platform_notification_outbox
                    SET state='suppressed',error_code='notification_recipient_unavailable',
                        completed_at=NOW(),updated_at=NOW()
                    WHERE id=$1::uuid`, id);
                return { state: 'suppressed' };
            }
            await tx.$executeRawUnsafe(`UPDATE platform_notification_outbox
                SET state='claimed',attempts=attempts+1,lease_token=$2::uuid,
                    lease_expires_at=NOW()+INTERVAL '90 seconds',error_code=NULL,updated_at=NOW()
                WHERE id=$1::uuid`, id, lease);
            return { state: 'claimed', row: { ...row, email: String(row.email).trim().toLowerCase() } };
        });
        if (claim.state !== 'claimed') return `notification:${claim.state}`;

        let send: () => Promise<string>;
        try {
            send = this.email.prepareBoundedSend(this.render(claim.row));
        } catch (error: any) {
            await this.failBeforeSend(id, lease, error?.message || 'notification_preflight_failed');
            throw error;
        }

        const started = await this.prisma.$executeRawUnsafe(`UPDATE platform_notification_outbox
            SET state='sending',started_at=NOW(),updated_at=NOW()
            WHERE id=$1::uuid AND state='claimed' AND lease_token=$2::uuid
              AND lease_expires_at>NOW()`, id, lease);
        if (Number(started) !== 1) return 'notification:lease_lost';

        try {
            const receipt = await send();
            if (!receipt) throw new Error('notification_provider_no_receipt');
            const settled = await this.prisma.$executeRawUnsafe(`UPDATE platform_notification_outbox
                SET state='sent',provider_reference=$3,error_code=NULL,
                    lease_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
                WHERE id=$1::uuid AND state='sending' AND lease_token=$2::uuid`,
            id, lease, String(receipt).slice(0, 512));
            return Number(settled) === 1 ? 'notification:sent' : 'notification:lease_lost';
        } catch (error: any) {
            await this.prisma.$executeRawUnsafe(`UPDATE platform_notification_outbox
                SET state='reconciliation_required',error_code='notification_send_outcome_unknown',
                    lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
                WHERE id=$1::uuid AND state='sending' AND lease_token=$2::uuid`, id, lease);
            throw error;
        }
    }

    private async failBeforeSend(id: string, lease: string, reason: string): Promise<void> {
        await this.prisma.$executeRawUnsafe(`UPDATE platform_notification_outbox
            SET state='failed',error_code=$3,lease_token=NULL,lease_expires_at=NULL,
                next_attempt_at=NOW()+INTERVAL '30 seconds',updated_at=NOW()
            WHERE id=$1::uuid AND state='claimed' AND lease_token=$2::uuid`,
        id, lease, String(reason).slice(0, 160));
    }

    private render(row: any): { to: string; subject: string; html: string } {
        const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
        const title = String(payload.title || '').replace(/[\r\n]/g, ' ').trim().slice(0, 240);
        const status = String(payload.status || '').trim();
        if (!title || !STATUS_LABELS[status] || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
            throw new Error('notification_payload_invalid');
        }
        const label = STATUS_LABELS[status];
        const declinedReason = String(payload.declinedReason || '').trim().slice(0, 2000);
        const declined = status === 'declined' && declinedReason
            ? `<p style="margin:16px 0;color:#666">${htmlEscape(declinedReason)}</p>` : '';
        const url = `${this.config.get<string>('DASHBOARD_URL', 'https://admin.parallly-chat.cloud')}/admin/feature-requests`;
        return {
            to: row.email,
            subject: `[Parallly] "${title}" — ${label}`,
            html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222">
                <h2 style="font-size:18px;margin:0 0 8px">Tu sugerencia cambió de estado</h2>
                <p style="margin:0 0 16px">"<strong>${htmlEscape(title)}</strong>" ahora está marcada como <strong>${label}</strong>.</p>
                ${declined}
                <a href="${htmlEscape(url)}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Ver sugerencia</a>
                <p style="font-size:12px;color:#999;margin-top:24px">Recibes este email porque votaste o comentaste esta sugerencia.</p>
            </div>`,
        };
    }
}
