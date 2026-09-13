import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { TenantNotificationSmsService } from '../sms-credits/tenant-notification-sms.service';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { CronLockService } from '../redis/cron-lock.service';

const MAX_ATTEMPTS = 5;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type StartResult =
    | { status: 'sent'; via: 'email' | 'sms'; hint: string }
    | { status: 'pending' }
    | { status: 'no_channel' }
    | { status: 'already_verified' };

/** Durable out-of-band identity step-up for sensitive agent tools. */
@Injectable()
export class ChatIdentityService {
    private readonly logger = new Logger(ChatIdentityService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly email: EmailService,
        private readonly sms: TenantNotificationSmsService,
        @Optional() private readonly regionalProfile?: RegionalProfileService,
        @Optional() private readonly cronLock?: CronLockService,
    ) {}

    @Cron('11 * * * * *')
    async recoverCron(): Promise<void> {
        const work = () => this.processDue();
        if (this.cronLock) await this.cronLock.runExclusive('chat-identity.recover', 40, work, { prefer: 'worker' });
        else await work();
    }

    async isVerified(conversationId: string, contactId?: string): Promise<boolean> {
        if (!UUID.test(conversationId)) return false;
        try {
            const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT contact_id
                FROM chat_identity_challenges
                WHERE conversation_id=$1::uuid AND verified_expires_at>NOW()
                  AND superseded_at IS NULL
                ORDER BY verified_at DESC LIMIT 1`, conversationId);
            if (!rows[0]) return false;
            return contactId ? String(rows[0].contact_id) === contactId : true;
        } catch { return false; }
    }

    async startVerification(
        tenantId: string,
        schemaName: string,
        contactId: string,
        conversationId: string,
        conversationChannel: string,
    ): Promise<StartResult> {
        if (![tenantId, contactId, conversationId].every(value => UUID.test(value))) return { status: 'no_channel' };
        if (await this.isVerified(conversationId, contactId)) return { status: 'already_verified' };
        const region = this.regionalProfile
            ? await this.regionalProfile.phoneRegionFor(tenantId).catch(() => null)
            : null;
        const code = String(randomInt(100000, 1_000_000));

        const admitted = await this.prisma.transactionInTenantSchema(schemaName, async query => {
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
                [`chat-identity:${tenantId}:${conversationId}`]);
            const contacts: any[] = await query(`SELECT email,phone,phone_normalized,is_active
                FROM contacts WHERE id=$1::uuid LIMIT 1`, [contactId]);
            const contact = contacts[0];
            if (!contact || contact.is_active === false) return { state: 'no_channel' };

            const email = String(contact.email || '').trim();
            const phone = contact.phone_normalized
                || normalizePhoneE164(contact.phone || '', region) || contact.phone;
            const channel: 'email' | 'sms' | null = email ? 'email'
                : phone && conversationChannel !== 'sms' ? 'sms' : null;
            const recipient = channel === 'email' ? email : channel === 'sms' ? String(phone) : '';
            if (!channel || !recipient) return { state: 'no_channel' };

            const recent: any[] = await query(`SELECT id,state,channel,hint
                FROM public.chat_identity_challenges
                WHERE tenant_id=$1::uuid AND conversation_id=$2::uuid AND contact_id=$3::uuid
                  AND recipient_digest=$4 AND expires_at>NOW()
                  AND consumed_at IS NULL AND superseded_at IS NULL
                ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [tenantId, conversationId, contactId, this.digest(channel, recipient)]);
            if (recent[0]) return recent[0];

            const inFlight: any[] = await query(`SELECT id,state,channel,hint
                FROM public.chat_identity_challenges
                WHERE tenant_id=$1::uuid AND conversation_id=$2::uuid
                  AND state IN ('claimed','sending','reconciliation_required')
                  AND consumed_at IS NULL AND superseded_at IS NULL
                ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [tenantId, conversationId]);
            if (inFlight[0]) return inFlight[0];

            await query(`UPDATE public.chat_identity_challenges
                SET superseded_at=NOW(),updated_at=NOW(),code=NULL,
                    state=CASE WHEN state IN ('pending','failed','claimed') THEN 'suppressed' ELSE state END,
                    lease_token=CASE WHEN state IN ('pending','failed','claimed') THEN NULL ELSE lease_token END,
                    lease_expires_at=CASE WHEN state IN ('pending','failed','claimed') THEN NULL ELSE lease_expires_at END,
                    error_code='identity_challenge_superseded'
                WHERE tenant_id=$1::uuid AND conversation_id=$2::uuid
                  AND consumed_at IS NULL AND superseded_at IS NULL`, [tenantId, conversationId]);
            const hint = channel === 'email' ? this.maskEmail(recipient) : this.maskPhone(recipient);
            const rows: any[] = await query(`INSERT INTO public.chat_identity_challenges
                (tenant_id,contact_id,conversation_id,channel,recipient,recipient_digest,hint,code,expires_at)
                VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,NOW()+INTERVAL '10 minutes')
                RETURNING id,state,channel,hint`,
            [tenantId, contactId, conversationId, channel, recipient,
                this.digest(channel, recipient), hint, code]);
            return rows[0];
        }).catch(error => {
            this.logger.warn(`Identity challenge admission failed: ${error?.message}`);
            return { state: 'pending' };
        });

        if (admitted.state === 'no_channel') return { status: 'no_channel' };
        if (admitted.state === 'sent') return { status: 'sent', via: admitted.channel, hint: admitted.hint };
        if (!['pending', 'failed'].includes(admitted.state)) return { status: 'pending' };
        const outcome = await this.deliver(admitted.id).catch(() => 'identity:pending');
        return outcome === 'identity:sent'
            ? { status: 'sent', via: admitted.channel, hint: admitted.hint }
            : { status: 'pending' };
    }

    async verifyCode(conversationId: string, code: string): Promise<{ ok: boolean; reason?: 'expired' | 'wrong' | 'too_many' }> {
        if (!UUID.test(conversationId)) return { ok: false, reason: 'expired' };
        const result = await this.prisma.$transaction(async (tx: any) => {
            const rows = await tx.$queryRawUnsafe(`SELECT * FROM chat_identity_challenges
                WHERE conversation_id=$1::uuid AND consumed_at IS NULL AND superseded_at IS NULL
                ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, conversationId);
            const row = rows[0];
            if (!row || !row.code || new Date(row.expires_at).getTime() <= Date.now()) {
                if (row) await tx.$executeRawUnsafe(`UPDATE chat_identity_challenges SET state=CASE
                    WHEN state IN ('pending','failed','claimed') THEN 'suppressed' ELSE state END,
                    lease_token=CASE WHEN state IN ('pending','failed','claimed') THEN NULL ELSE lease_token END,
                    lease_expires_at=CASE WHEN state IN ('pending','failed','claimed') THEN NULL ELSE lease_expires_at END,
                    superseded_at=NOW(),code=NULL,error_code='identity_challenge_expired',updated_at=NOW()
                    WHERE id=$1::uuid`, row.id);
                return { state: 'expired' };
            }
            if (Number(row.verify_attempts) >= MAX_ATTEMPTS) return { state: 'too_many' };
            const expected = Buffer.from(String(row.code));
            const supplied = Buffer.from(String(code).trim());
            const matches = expected.length === supplied.length && timingSafeEqual(expected, supplied);
            if (!matches) {
                const attempts = Number(row.verify_attempts) + 1;
                await tx.$executeRawUnsafe(`UPDATE chat_identity_challenges SET verify_attempts=$2,
                    superseded_at=CASE WHEN $2>=${MAX_ATTEMPTS} THEN NOW() ELSE superseded_at END,
                    code=CASE WHEN $2>=${MAX_ATTEMPTS} THEN NULL ELSE code END,
                    error_code=CASE WHEN $2>=${MAX_ATTEMPTS} THEN 'identity_too_many_attempts' ELSE error_code END,
                    updated_at=NOW() WHERE id=$1::uuid`, row.id, attempts);
                return { state: attempts >= MAX_ATTEMPTS ? 'too_many' : 'wrong' };
            }
            await tx.$executeRawUnsafe(`UPDATE chat_identity_challenges
                SET consumed_at=NOW(),verified_at=NOW(),verified_expires_at=NOW()+INTERVAL '30 minutes',
                    code=NULL,updated_at=NOW() WHERE id=$1::uuid`, row.id);
            return { state: 'accepted' };
        }, { isolationLevel: 'Serializable' as any }).catch(() => ({ state: 'expired' }));
        if (result.state === 'accepted') {
            this.logger.log(`Identidad verificada en la conversación ${conversationId}`);
            return { ok: true };
        }
        return { ok: false, reason: result.state as 'expired' | 'wrong' | 'too_many' };
    }

    async processDue(limit = 100): Promise<number> {
        const bounded = Math.min(Math.max(Number(limit) || 1, 1), 100);
        await this.prisma.$executeRawUnsafe(`UPDATE chat_identity_challenges SET state='failed',
            lease_token=NULL,lease_expires_at=NULL,error_code='identity_claim_expired',
            next_attempt_at=NOW(),updated_at=NOW()
            WHERE state='claimed' AND lease_expires_at<=NOW()`);
        await this.prisma.$executeRawUnsafe(`UPDATE chat_identity_challenges SET state='reconciliation_required',
            lease_token=NULL,lease_expires_at=NULL,error_code='identity_send_outcome_unknown',updated_at=NOW()
            WHERE state='sending' AND lease_expires_at<=NOW()`);
        await this.prisma.$executeRawUnsafe(`UPDATE chat_identity_challenges SET state='suppressed',
            lease_token=NULL,lease_expires_at=NULL,superseded_at=NOW(),code=NULL,
            error_code='identity_challenge_expired',updated_at=NOW()
            WHERE expires_at<=NOW() AND consumed_at IS NULL AND superseded_at IS NULL
              AND state IN ('pending','failed','claimed')`);
        const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id FROM chat_identity_challenges
            WHERE state IN ('pending','failed') AND delivery_attempts<${MAX_ATTEMPTS}
              AND next_attempt_at<=NOW() AND expires_at>NOW()
              AND consumed_at IS NULL AND superseded_at IS NULL
            ORDER BY created_at,id LIMIT ${bounded}`);
        for (const row of rows) await this.deliver(row.id).catch(() => undefined);
        return rows.length;
    }

    async deliver(id: string): Promise<string> {
        if (!UUID.test(id)) return 'identity:missing';
        const tenants = await this.prisma.$queryRawUnsafe<any[]>(`SELECT t.id,t.schema_name
            FROM tenants t JOIN chat_identity_challenges c ON c.tenant_id=t.id
            WHERE c.id=$1::uuid AND t.is_active=true LIMIT 1`, id);
        if (!tenants[0]) return 'identity:missing';
        const lease = randomUUID();
        const claim = await this.prisma.transactionInTenantSchema(tenants[0].schema_name, async query => {
            const rows: any[] = await query(`SELECT c.* FROM public.chat_identity_challenges c
                JOIN public.tenants t ON t.id=c.tenant_id AND t.is_active=true
                WHERE c.id=$1::uuid FOR UPDATE`, [id]);
            const row = rows[0];
            if (!row || !['pending','failed'].includes(row.state) || Number(row.delivery_attempts)>=MAX_ATTEMPTS)
                return { state: row?.state || 'missing' };
            if (!row.code || row.consumed_at || row.superseded_at || new Date(row.expires_at).getTime()<=Date.now()) {
                await query(`UPDATE public.chat_identity_challenges SET state='suppressed',code=NULL,
                    superseded_at=COALESCE(superseded_at,NOW()),error_code='identity_challenge_unavailable',updated_at=NOW()
                    WHERE id=$1::uuid`, [id]);
                return { state: 'suppressed' };
            }
            const contacts: any[] = row.channel === 'email'
                ? await query(`SELECT 1 FROM contacts WHERE id=$1::uuid AND is_active=true
                    AND LOWER(email)=LOWER($2) LIMIT 1`, [row.contact_id,row.recipient])
                : await query(`SELECT 1 FROM contacts WHERE id=$1::uuid AND is_active=true
                    AND (phone_normalized=$2 OR phone=$2) LIMIT 1`, [row.contact_id,row.recipient]);
            if (!contacts[0]) {
                await query(`UPDATE public.chat_identity_challenges SET state='suppressed',code=NULL,
                    superseded_at=NOW(),error_code='identity_recipient_unavailable',updated_at=NOW()
                    WHERE id=$1::uuid`, [id]);
                return { state: 'suppressed' };
            }
            await query(`UPDATE public.chat_identity_challenges SET state='claimed',
                delivery_attempts=delivery_attempts+1,lease_token=$2::uuid,
                lease_expires_at=NOW()+INTERVAL '90 seconds',error_code=NULL,updated_at=NOW()
                WHERE id=$1::uuid`, [id,lease]);
            return { state: 'claimed',row };
        });
        if (claim.state!=='claimed') return `identity:${claim.state}`;

        const body = `Tu código de verificación es ${claim.row.code}. Vence en 10 minutos. Si no lo pediste, ignorá este mensaje.`;
        let emailSend: (()=>Promise<string>) | null = null;
        if (claim.row.channel==='email') {
            try {
                emailSend=this.email.prepareBoundedSend({to:claim.row.recipient,subject:'Código de verificación',
                    html:`<p style="font-size:16px;font-family:sans-serif">${body}</p>`});
            } catch (error:any) {
                await this.failBeforeSend(id,lease,error?.message||'identity_email_preflight_failed');
                return 'identity:pending';
            }
        }
        const began=await this.prisma.$executeRawUnsafe(`UPDATE chat_identity_challenges SET state='sending',
            started_at=NOW(),updated_at=NOW() WHERE id=$1::uuid AND state='claimed'
              AND lease_token=$2::uuid AND lease_expires_at>NOW()`,id,lease);
        if(Number(began)!==1)return 'identity:lease_lost';
        try {
            let receipt:string|undefined;
            if(emailSend) receipt=await emailSend();
            else {
                const res=await this.sms.send(claim.row.tenant_id,claim.row.recipient,body,
                    {reason:'identity_verification',ref:`identity:${id}`});
                if(!res.sent) {
                    if(res.reason==='send_failed')throw new Error('identity_sms_outcome_unknown');
                    const state=res.reason==='opted_out'?'suppressed':'failed';
                    await this.prisma.$executeRawUnsafe(`UPDATE chat_identity_challenges SET state=$3,
                        error_code=$4,lease_token=NULL,lease_expires_at=NULL,
                        next_attempt_at=CASE WHEN $3='failed' THEN NOW()+INTERVAL '30 seconds' ELSE next_attempt_at END,
                        superseded_at=CASE WHEN $3='suppressed' THEN NOW() ELSE superseded_at END,
                        code=CASE WHEN $3='suppressed' THEN NULL ELSE code END,updated_at=NOW()
                        WHERE id=$1::uuid AND state='sending' AND lease_token=$2::uuid`,id,lease,state,
                    `identity_sms_${res.reason||'refused'}`);
                    return 'identity:pending';
                }
                receipt=res.sid;
            }
            if(!receipt)throw new Error('identity_provider_no_receipt');
            const settled=await this.prisma.$executeRawUnsafe(`UPDATE chat_identity_challenges SET state='sent',
                provider_reference=$3,sent_at=NOW(),lease_token=NULL,lease_expires_at=NULL,error_code=NULL,updated_at=NOW()
                WHERE id=$1::uuid AND state='sending' AND lease_token=$2::uuid`,id,lease,String(receipt).slice(0,512));
            return Number(settled)===1?'identity:sent':'identity:lease_lost';
        } catch {
            await this.prisma.$executeRawUnsafe(`UPDATE chat_identity_challenges
                SET state='reconciliation_required',error_code='identity_send_outcome_unknown',
                    lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
                WHERE id=$1::uuid AND state='sending' AND lease_token=$2::uuid`,id,lease);
            return 'identity:pending';
        }
    }

    private async failBeforeSend(id:string,lease:string,reason:string):Promise<void>{
        await this.prisma.$executeRawUnsafe(`UPDATE chat_identity_challenges SET state='failed',
            error_code=$3,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NOW()+INTERVAL '30 seconds',updated_at=NOW()
            WHERE id=$1::uuid AND state='claimed' AND lease_token=$2::uuid`,id,lease,String(reason).slice(0,160));
    }

    private digest(channel:'email'|'sms',recipient:string):string{
        return createHash('sha256').update(`${channel}\0${channel==='email'?recipient.toLowerCase():recipient}`).digest('hex');
    }
    private maskEmail(email:string):string{const [user,domain]=String(email).split('@');return domain?`${user.slice(0,1)}***@${domain}`:'***';}
    private maskPhone(phone:string):string{return `****${String(phone).slice(-4)}`;}
}
