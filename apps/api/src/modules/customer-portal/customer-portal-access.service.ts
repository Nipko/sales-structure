import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { EmailService } from '../email/email.service';
import { SmsSenderService } from '../sms-notifications/sms-sender.service';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import { cpmsg } from './customer-portal-i18n';

type PortalChannel = 'email' | 'sms';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Durable authority for customer-portal access codes and their delivery. */
@Injectable()
export class CustomerPortalAccessService {
    private readonly logger = new Logger(CustomerPortalAccessService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly email: EmailService,
        private readonly sms: SmsSenderService,
        private readonly regionalProfile: RegionalProfileService,
        private readonly cronLock: CronLockService,
    ) {}

    @Cron('47 * * * * *')
    async recoverCron(): Promise<void> {
        await this.cronLock.runExclusive('customer-portal.access.recover', 40,
            () => this.processDue(), { prefer: 'worker' });
    }

    async issue(
        tenantId: string,
        schema: string,
        channel: PortalChannel,
        identifier: string,
        language: string,
    ): Promise<string | null> {
        const recipient = identifier.trim();
        const digest = this.digest(channel, recipient);
        const code = randomInt(100000, 1000000).toString();
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
                [`portal:${tenantId}:${channel}:${digest}`]);
            const contacts: any[] = channel === 'email'
                ? await query(`SELECT id FROM contacts
                    WHERE LOWER(email)=LOWER($1) AND is_active=true LIMIT 1`, [recipient])
                : await query(`SELECT id FROM contacts
                    WHERE phone=$1 AND is_active=true LIMIT 1`, [recipient]);
            if (!contacts[0]) return null;

            const recent: any[] = await query(`SELECT id
                FROM public.customer_portal_access_challenges
                WHERE tenant_id=$1::uuid AND channel=$2 AND recipient_digest=$3
                  AND consumed_at IS NULL AND superseded_at IS NULL
                  AND expires_at>NOW() AND created_at>NOW()-INTERVAL '60 seconds'
                LIMIT 1 FOR UPDATE`, [tenantId, channel, digest]);
            if (recent[0]) return recent[0].id;

            await query(`UPDATE public.customer_portal_access_challenges
                SET superseded_at=NOW(),updated_at=NOW(),
                    state=CASE WHEN state IN ('pending','failed','claimed') THEN 'suppressed' ELSE state END,
                    lease_token=CASE WHEN state IN ('pending','failed','claimed') THEN NULL ELSE lease_token END,
                    lease_expires_at=CASE WHEN state IN ('pending','failed','claimed') THEN NULL ELSE lease_expires_at END,
                    error_code='portal_challenge_superseded'
                WHERE tenant_id=$1::uuid AND channel=$2 AND recipient_digest=$3
                  AND consumed_at IS NULL AND superseded_at IS NULL`, [tenantId, channel, digest]);
            const inserted: any[] = await query(`INSERT INTO public.customer_portal_access_challenges
                (tenant_id,contact_id,channel,recipient,recipient_digest,code,language,expires_at)
                VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,NOW()+INTERVAL '10 minutes')
                RETURNING id`, [tenantId, contacts[0].id, channel, recipient, digest, code, language]);
            return inserted[0].id;
        });
    }

    async verify(tenantId: string, channel: PortalChannel, identifier: string, suppliedCode: string): Promise<string> {
        const digest = this.digest(channel, identifier.trim());
        const outcome = await this.prisma.$transaction(async (tx: any) => {
            const rows = await tx.$queryRawUnsafe(`SELECT *
                FROM customer_portal_access_challenges
                WHERE tenant_id=$1::uuid AND channel=$2 AND recipient_digest=$3
                  AND consumed_at IS NULL AND superseded_at IS NULL
                ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, tenantId, channel, digest);
            const row = rows[0];
            if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
                if (row) await tx.$executeRawUnsafe(`UPDATE customer_portal_access_challenges
                    SET superseded_at=NOW(),state=CASE WHEN state IN ('pending','failed','claimed') THEN 'suppressed' ELSE state END,
                        lease_token=CASE WHEN state IN ('pending','failed','claimed') THEN NULL ELSE lease_token END,
                        lease_expires_at=CASE WHEN state IN ('pending','failed','claimed') THEN NULL ELSE lease_expires_at END,
                        error_code='portal_challenge_expired',updated_at=NOW()
                    WHERE id=$1::uuid`, row.id);
                return { state: 'expired' };
            }
            if (Number(row.verify_attempts) >= 5) return { state: 'too_many' };
            const expected = Buffer.from(String(row.code));
            const supplied = Buffer.from(suppliedCode);
            const matches = expected.length === supplied.length && timingSafeEqual(expected, supplied);
            if (!matches) {
                const attempts = Number(row.verify_attempts) + 1;
                await tx.$executeRawUnsafe(`UPDATE customer_portal_access_challenges
                    SET verify_attempts=$2,
                        superseded_at=CASE WHEN $2>=5 THEN NOW() ELSE superseded_at END,
                        error_code=CASE WHEN $2>=5 THEN 'portal_too_many_attempts' ELSE error_code END,
                        updated_at=NOW() WHERE id=$1::uuid`, row.id, attempts);
                return { state: attempts >= 5 ? 'too_many' : 'invalid' };
            }
            await tx.$executeRawUnsafe(`UPDATE customer_portal_access_challenges
                SET consumed_at=NOW(),updated_at=NOW() WHERE id=$1::uuid`, row.id);
            return { state: 'accepted', contactId: row.contact_id };
        }, { isolationLevel: 'Serializable' as any });
        if (outcome.state === 'accepted') return outcome.contactId;
        if (outcome.state === 'too_many') throw new UnauthorizedException('portal_too_many_attempts');
        if (outcome.state === 'invalid') throw new UnauthorizedException('portal_invalid_code');
        throw new UnauthorizedException('portal_code_expired');
    }

    async processDue(limit = 100): Promise<number> {
        const bounded = Math.min(Math.max(Number(limit) || 1, 1), 100);
        await this.prisma.$executeRawUnsafe(`UPDATE customer_portal_access_challenges
            SET state='failed',lease_token=NULL,lease_expires_at=NULL,
                error_code='portal_claim_expired',next_attempt_at=NOW(),updated_at=NOW()
            WHERE state='claimed' AND lease_expires_at<=NOW()`);
        await this.prisma.$executeRawUnsafe(`UPDATE customer_portal_access_challenges
            SET state='reconciliation_required',lease_token=NULL,lease_expires_at=NULL,
                error_code='portal_send_outcome_unknown',updated_at=NOW()
            WHERE state='sending' AND lease_expires_at<=NOW()`);
        await this.prisma.$executeRawUnsafe(`UPDATE customer_portal_access_challenges
            SET state='suppressed',lease_token=NULL,lease_expires_at=NULL,
                superseded_at=COALESCE(superseded_at,NOW()),error_code='portal_challenge_expired',updated_at=NOW()
            WHERE expires_at<=NOW() AND consumed_at IS NULL AND superseded_at IS NULL
              AND state IN ('pending','failed','claimed')`);
        const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id
            FROM customer_portal_access_challenges
            WHERE state IN ('pending','failed') AND delivery_attempts<5
              AND next_attempt_at<=NOW() AND expires_at>NOW()
              AND consumed_at IS NULL AND superseded_at IS NULL
            ORDER BY created_at,id LIMIT ${bounded}`);
        for (const row of rows) {
            try { await this.deliver(row.id); }
            catch (error: any) { this.logger.warn(`Portal access delivery ${row.id} failed: ${error?.message}`); }
        }
        return rows.length;
    }

    async deliver(id: string): Promise<string> {
        if (!UUID.test(id)) throw new Error('portal_challenge_invalid_id');
        const tenants = await this.prisma.$queryRawUnsafe<any[]>(`SELECT t.id,t.schema_name,t.is_active
            FROM tenants t JOIN customer_portal_access_challenges c ON c.tenant_id=t.id
            WHERE c.id=$1::uuid AND t.is_active=true LIMIT 1`, id);
        const tenant = tenants[0] ? {
            id: tenants[0].id, schemaName: tenants[0].schema_name, isActive: tenants[0].is_active,
        } : null;
        if (!tenant) return 'portal:missing';
        const lease = randomUUID();
        const claim = await this.prisma.transactionInTenantSchema(tenant.schemaName, async query => {
            const rows: any[] = await query(`SELECT c.* FROM public.customer_portal_access_challenges c
                JOIN public.tenants t ON t.id=c.tenant_id AND t.is_active=true
                WHERE c.id=$1::uuid FOR UPDATE`, [id]);
            const row = rows[0];
            if (!row) return { state: 'missing' };
            if (!['pending', 'failed'].includes(row.state) || Number(row.delivery_attempts) >= 5) {
                return { state: row.state };
            }
            if (row.consumed_at || row.superseded_at || new Date(row.expires_at).getTime() <= Date.now()) {
                await query(`UPDATE public.customer_portal_access_challenges
                    SET state='suppressed',lease_token=NULL,lease_expires_at=NULL,
                        superseded_at=COALESCE(superseded_at,NOW()),error_code='portal_challenge_unavailable',updated_at=NOW()
                    WHERE id=$1::uuid`, [id]);
                return { state: 'suppressed' };
            }
            const contacts: any[] = row.channel === 'email'
                ? await query(`SELECT 1 FROM contacts WHERE id=$1::uuid AND is_active=true
                    AND LOWER(email)=LOWER($2) LIMIT 1`, [row.contact_id, row.recipient])
                : await query(`SELECT 1 FROM contacts WHERE id=$1::uuid AND is_active=true
                    AND phone=$2 LIMIT 1`, [row.contact_id, row.recipient]);
            if (!contacts[0]) {
                await query(`UPDATE public.customer_portal_access_challenges
                    SET state='suppressed',error_code='portal_recipient_unavailable',updated_at=NOW()
                    WHERE id=$1::uuid`, [id]);
                return { state: 'suppressed' };
            }
            await query(`UPDATE public.customer_portal_access_challenges
                SET state='claimed',delivery_attempts=delivery_attempts+1,
                    lease_token=$2::uuid,lease_expires_at=NOW()+INTERVAL '90 seconds',
                    error_code=NULL,updated_at=NOW() WHERE id=$1::uuid`, [id, lease]);
            return { state: 'claimed', row };
        });
        if (claim.state !== 'claimed') return `portal:${claim.state}`;

        const row = claim.row;
        const message = cpmsg(row.language, 'auth.codeMessage').replace('{code}', row.code);
        let send: () => Promise<string>;
        try {
            if (row.channel === 'sms') {
                const region = await this.regionalProfile.phoneRegionFor(row.tenant_id);
                const to = normalizePhoneE164(row.recipient, region) || row.recipient;
                send = await this.sms.prepareBoundedSend(row.tenant_id, to, message);
            } else {
                send = this.email.prepareBoundedSend({
                    to: row.recipient,
                    subject: cpmsg(row.language, 'auth.codeSubject'),
                    html: `<p style="font-size:16px;font-family:sans-serif">${message}</p>`,
                });
            }
        } catch (error: any) {
            await this.failBeforeSend(id, lease, error?.message || 'portal_preflight_failed');
            throw error;
        }

        const started = await this.prisma.$executeRawUnsafe(`UPDATE customer_portal_access_challenges
            SET state='sending',started_at=NOW(),updated_at=NOW()
            WHERE id=$1::uuid AND state='claimed' AND lease_token=$2::uuid AND lease_expires_at>NOW()`, id, lease);
        if (Number(started) !== 1) return 'portal:lease_lost';
        try {
            const receipt = await send();
            if (!receipt) throw new Error('portal_provider_no_receipt');
            const settled = await this.prisma.$executeRawUnsafe(`UPDATE customer_portal_access_challenges
                SET state='sent',provider_reference=$3,sent_at=NOW(),error_code=NULL,
                    lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
                WHERE id=$1::uuid AND state='sending' AND lease_token=$2::uuid`, id, lease, String(receipt).slice(0, 512));
            return Number(settled) === 1 ? 'portal:sent' : 'portal:lease_lost';
        } catch (error: any) {
            await this.prisma.$executeRawUnsafe(`UPDATE customer_portal_access_challenges
                SET state='reconciliation_required',error_code='portal_send_outcome_unknown',
                    lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
                WHERE id=$1::uuid AND state='sending' AND lease_token=$2::uuid`, id, lease);
            throw error;
        }
    }

    private async failBeforeSend(id: string, lease: string, reason: string): Promise<void> {
        await this.prisma.$executeRawUnsafe(`UPDATE customer_portal_access_challenges
            SET state='failed',error_code=$3,lease_token=NULL,lease_expires_at=NULL,
                next_attempt_at=NOW()+INTERVAL '30 seconds',updated_at=NOW()
            WHERE id=$1::uuid AND state='claimed' AND lease_token=$2::uuid`,
        id, lease, String(reason).slice(0, 160));
    }

    private digest(channel: PortalChannel, recipient: string): string {
        const canonical = channel === 'email' ? recipient.toLowerCase() : recipient;
        return createHash('sha256').update(`${channel}\0${canonical}`).digest('hex');
    }
}
