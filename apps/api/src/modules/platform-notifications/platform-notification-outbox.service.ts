import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CronLockService } from '../redis/cron-lock.service';
import { invitationEmail, passwordResetEmail, twoFactorEmail, verificationEmail,
    welcomeTeamMemberEmail } from '../email/email-layouts';
import { emsg } from '../email/email-i18n';

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
            const rows = await tx.$queryRawUnsafe(`SELECT o.*,u.email AS user_email,u.first_name
                FROM platform_notification_outbox o
                LEFT JOIN users u ON u.id=o.recipient_user_id
                WHERE o.id=$1::uuid FOR UPDATE OF o`, id);
            const row = rows[0];
            if (!row) return { state: 'missing' };
            if (!['pending', 'failed'].includes(row.state) || Number(row.attempts) >= 5) {
                return { state: row.state };
            }
            let canonical: any = null;
            let available: any = null;
            if (row.kind === 'feature_request.status_changed') {
                available = (await tx.$queryRawUnsafe(`SELECT 1
                    FROM feature_requests fr
                    JOIN feature_request_subscribers s ON s.request_id=fr.id
                    WHERE fr.id=$1::uuid AND s.user_id=$2::uuid
                      AND EXISTS(SELECT 1 FROM users u WHERE u.id=s.user_id AND u.is_active=true AND u.email IS NOT NULL)
                    LIMIT 1`, row.entity_id, row.recipient_user_id))[0];
            } else if (row.kind === 'billing.lifecycle_email') {
                available = (await tx.$queryRawUnsafe(
                    'SELECT 1 FROM tenants WHERE id=$1::uuid LIMIT 1', row.tenant_id))[0];
            } else if (row.kind === 'invitation.invite_email' && Number.isInteger(Number(row.payload?.revision))) {
                canonical = (await tx.$queryRawUnsafe(`SELECT i.email,i.token,i.role,i.expires_at,
                        t.name AS tenant_name,t.settings,t.language,
                        NULLIF(TRIM(CONCAT(COALESCE(inviter.first_name,''),' ',COALESCE(inviter.last_name,''))), '') AS inviter_name,
                        inviter.email AS inviter_email
                    FROM tenant_invitations i
                    JOIN tenants t ON t.id=i.tenant_id AND t.is_active=true
                    LEFT JOIN users inviter ON inviter.id::text=i.invited_by_user_id
                    WHERE i.id=$1::uuid AND i.tenant_id=$2::uuid
                      AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>NOW()
                      AND i.notification_revision=$3 AND LOWER(i.email)=LOWER($4)
                    LIMIT 1`, row.entity_id, row.tenant_id, Number(row.payload.revision), row.recipient_email))[0];
                available = canonical;
            } else if (row.kind === 'invitation.welcome_email' && typeof row.payload?.acceptedUserId === 'string') {
                canonical = (await tx.$queryRawUnsafe(`SELECT u.email,u.first_name,i.role,
                        t.name AS tenant_name,t.language
                    FROM tenant_invitations i
                    JOIN tenants t ON t.id=i.tenant_id AND t.is_active=true
                    JOIN users u ON u.id::text=i.accepted_user_id AND u.is_active=true
                    WHERE i.id=$1::uuid AND i.tenant_id=$2::uuid
                      AND i.accepted_at IS NOT NULL AND i.revoked_at IS NULL
                      AND LOWER(u.email)=LOWER($3) AND u.id::text=$4
                    LIMIT 1`, row.entity_id, row.tenant_id, row.recipient_email,
                row.payload.acceptedUserId))[0];
                available = canonical;
            } else if (row.kind === 'auth.access_code_email') {
                canonical = (await tx.$queryRawUnsafe(`SELECT u.email,u.first_name,
                        u.email_verify_code,u.email_verify_expires,u.email_challenge_revision,
                        u.two_factor_email_code,u.two_factor_email_expires,u.two_factor_email_revision,
                        COALESCE(t.language,'es') AS language
                    FROM users u LEFT JOIN tenants t ON t.id=u.tenant_id
                    WHERE u.id=$1::uuid AND u.is_active=true AND LOWER(u.email)=LOWER($2)
                    LIMIT 1`, row.entity_id, row.user_email))[0];
                const purpose = String(row.payload?.purpose || '');
                const revision = Number(row.payload?.revision);
                const twoFactor = purpose === 'two_factor';
                const code = twoFactor ? canonical?.two_factor_email_code : canonical?.email_verify_code;
                const expires = new Date(twoFactor ? canonical?.two_factor_email_expires : canonical?.email_verify_expires);
                const currentRevision = Number(twoFactor
                    ? canonical?.two_factor_email_revision : canonical?.email_challenge_revision);
                available = canonical && ['email_verification', 'password_reset', 'two_factor'].includes(purpose)
                    && Number.isInteger(revision) && revision === currentRevision && code
                    && Number.isFinite(expires.getTime()) && expires.getTime() > Date.now();
                if (available) canonical = { ...canonical, purpose, code };
            } else if (row.kind === 'auth.security_notice_email') {
                available = (await tx.$queryRawUnsafe(`SELECT 1 FROM users
                    WHERE id=$1::uuid AND is_active=true AND LOWER(email)=LOWER($2) LIMIT 1`,
                row.recipient_user_id, row.user_email))[0];
            } else if (row.kind === 'meta_compliance.request_email') {
                canonical = (await tx.$queryRawUnsafe(`SELECT code::text,source,fb_user_id,email,
                        requested_at,notes FROM meta_compliance_requests
                    WHERE code=$1::uuid AND retention_until>NOW() LIMIT 1`, row.entity_id))[0];
                available = canonical && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.recipient_email || ''));
            }
            if (!available) {
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
            const email = row.kind === 'meta_compliance.request_email'
                ? row.recipient_email : canonical?.email ?? row.recipient_email ?? row.user_email;
            return { state: 'claimed', row: { ...row, canonical, email: String(email ?? '').trim().toLowerCase() } };
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
        if (row.kind === 'meta_compliance.request_email') {
            const request = row.canonical;
            if (!request || !UUID.test(String(request.code))
                || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
                throw new Error('notification_payload_invalid');
            }
            const code = htmlEscape(request.code);
            const base = this.config.get<string>('PUBLIC_LANDING_URL', 'https://parallly-chat.cloud');
            const status = `${String(base).replace(/\/$/, '')}/data-deletion/status?code=${request.code}`;
            if (request.source === 'meta_callback') {
                return {
                    to: row.email,
                    subject: `[Parallly] Meta data deletion callback — ${request.code}`,
                    html: `<p>Meta requested deletion of fb_user_id <strong>${htmlEscape(request.fb_user_id)}</strong>.</p>
                        <p>Tracking code: <code>${code}</code></p><p>Status URL: ${htmlEscape(status)}</p>`,
                };
            }
            if (request.source !== 'user_request') throw new Error('notification_payload_invalid');
            return {
                to: row.email,
                subject: `[Parallly] Account and data deletion request — ${request.code}`,
                html: `<p>A user requested deletion of a Parallly account and its associated data.</p>
                    <ul><li>Email: <strong>${htmlEscape(request.email)}</strong></li>
                    <li>Description: ${htmlEscape(request.notes || '—')}</li><li>Code: <code>${code}</code></li></ul>
                    <p>Verify the requester's identity and authority before processing the deletion.</p>
                    <p>Process without undue delay, normally within 30 days unless applicable law requires a different period.</p>`,
            };
        }
        if (row.kind === 'auth.access_code_email') {
            const challenge = row.canonical;
            if (!challenge || !/^\d{6}$/.test(challenge.code)
                || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
                throw new Error('notification_payload_invalid');
            }
            const lang = String(challenge.language || 'es');
            const templates: Record<string, { subject: string; html: string }> = {
                email_verification: {
                    subject: 'Tu codigo de verificacion — Parallly',
                    html: verificationEmail(challenge.first_name, challenge.code, lang),
                },
                password_reset: {
                    subject: 'Restablece tu contrasena — Parallly',
                    html: passwordResetEmail(challenge.first_name, challenge.code, lang),
                },
                two_factor: {
                    subject: 'Tu codigo de autenticacion — Parallly',
                    html: twoFactorEmail(challenge.first_name, challenge.code, lang),
                },
            };
            const rendered = templates[challenge.purpose];
            if (!rendered) throw new Error('notification_payload_invalid');
            return { to: row.email, ...rendered };
        }
        if (row.kind === 'invitation.invite_email') {
            const invitation = row.canonical;
            if (!invitation || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
                throw new Error('notification_payload_invalid');
            }
            const lang = String(invitation.language || 'es');
            const dashboardUrl = this.config.get<string>('DASHBOARD_URL', 'https://admin.parallly-chat.cloud');
            const localeTag = lang.length >= 5 ? lang : `${lang.substring(0, 2)}-CO`;
            const expiresAt = new Date(invitation.expires_at);
            if (!Number.isFinite(expiresAt.getTime())) throw new Error('notification_payload_invalid');
            const settings = invitation.settings && typeof invitation.settings === 'object' ? invitation.settings : {};
            return {
                to: row.email,
                subject: emsg(lang, 'invitation.subject', { tenant: invitation.tenant_name || 'Parallly' }),
                html: invitationEmail({
                    inviterName: invitation.inviter_name || invitation.inviter_email || null,
                    tenantName: invitation.tenant_name || 'Parallly',
                    tenantLogoUrl: settings.logoUrl ?? null,
                    roleLabel: this.roleLabel(invitation.role, lang),
                    acceptUrl: `${dashboardUrl}/accept-invite/${invitation.token}`,
                    expiresText: expiresAt.toLocaleDateString(localeTag, { day: 'numeric', month: 'long', year: 'numeric' }),
                }, lang),
            };
        }
        if (row.kind === 'invitation.welcome_email') {
            const invitation = row.canonical;
            if (!invitation || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
                throw new Error('notification_payload_invalid');
            }
            const lang = String(invitation.language || 'es');
            return {
                to: row.email,
                subject: emsg(lang, 'teamWelcome.subject', { tenant: invitation.tenant_name || 'Parallly' }),
                html: welcomeTeamMemberEmail(invitation.first_name || '', invitation.tenant_name || 'Parallly',
                    this.roleLabel(invitation.role, lang), lang),
            };
        }
        if (row.kind === 'billing.lifecycle_email' || row.kind === 'auth.security_notice_email') {
            const subject = String(payload.subject || '').replace(/[\r\n]/g, ' ').trim().slice(0, 240);
            const html = String(payload.html || '');
            if (!subject || !html || html.length > 250_000
                || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
                throw new Error('notification_payload_invalid');
            }
            return { to: row.email, subject, html };
        }
        if (row.kind !== 'feature_request.status_changed') {
            throw new Error('notification_kind_unsupported');
        }
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

    private roleLabel(role: string, lang: string): string {
        const language = lang.substring(0, 2);
        const labels: Record<string, Record<string, string>> = {
            tenant_admin: { es: 'Administrador', en: 'Administrator', pt: 'Administrador', fr: 'Administrateur' },
            tenant_supervisor: { es: 'Supervisor', en: 'Supervisor', pt: 'Supervisor', fr: 'Superviseur' },
            tenant_agent: { es: 'Agente', en: 'Agent', pt: 'Agente', fr: 'Agent' },
        };
        return labels[role]?.[language] || labels[role]?.es || role;
    }
}
