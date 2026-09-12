import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { WhatsappMessagingService } from '../whatsapp/services/whatsapp-messaging.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService, BROADCAST_QUEUE, BroadcastJobData } from './broadcast.service';
import { AbTestService } from './ab-test.service';
import { TenantNotificationSmsService } from '../sms-credits/tenant-notification-sms.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import {
    ProactiveDispatchService, effectIsDurable, producerMayAdvance,
} from '../channels/proactive-dispatch.service';

/** The job that closes a WhatsApp recipient once its effect has settled. */
export const BROADCAST_SETTLE_JOB = 'settle-whatsapp';

/** What makes one campaign message THIS campaign message. */
const originKeyFor = (campaignId: string, recipientId: string) =>
    `broadcast_message:${campaignId}:${recipientId}`;

@Processor(BROADCAST_QUEUE, {
    concurrency: 10,
    limiter: {
        max: 80,
        duration: 1000,
    },
})
export class BroadcastQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(BroadcastQueueProcessor.name);

    constructor(
        private readonly messagingService: WhatsappMessagingService,
        private readonly cryptoService: WhatsappCryptoService,
        private readonly emailService: EmailService,
        private readonly prisma: PrismaService,
        private readonly broadcastService: BroadcastService,
        private readonly abTestService: AbTestService,
        private readonly tenantSms: TenantNotificationSmsService,
        /**
         * The durable lane, which a campaign message could not use before.
         *
         * Every recipient went straight to `sendTemplate` on this worker's
         * stack: no row, no lease, no receipt of its own. A restart between the
         * decision and the POST lost the message or — because the job carries
         * no `jobId` — sent it twice, and nothing re-read the campaign, so
         * pressing pause stopped nothing that was already in flight. From
         * October each of those is a charge on the tenant's own WABA.
         */
        private readonly proactive: ProactiveDispatchService,
        /**
         * This processor's own queue, for the settling pass.
         *
         * The lane has no way to tell a domain that an effect arrived, and the
         * recipient's own status is inside the authority that guards it — see
         * `settleWhatsApp`. So the closing of a recipient is a second job on
         * this same queue rather than a write in the middle of the send.
         */
        @InjectQueue(BROADCAST_QUEUE) private readonly queue: Queue,
    ) {
        super();
    }

    async process(job: Job<BroadcastJobData>): Promise<string> {
        // ── THE SETTLING PASS COMES FIRST, AND BEFORE THE ENTITLEMENT GATE ──
        //
        // The message it closes has ALREADY been committed, and in most cases
        // already delivered and charged. Running it through a gate meant to
        // stop new spending would mark a delivered message failed because the
        // tenant's subscription lapsed in between.
        if (job.name === BROADCAST_SETTLE_JOB) return this.settleWhatsApp(job.data);

        const { channel, schemaName, campaignId, recipientId } = job.data;

        this.logger.debug(
            `Processing broadcast job ${job.id}: campaign=${campaignId} channel=${channel} attempt=${job.attemptsMade + 1}`,
        );

        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, job.data.tenantId, 'write');
        if (!entitlement.allowed) {
            if (entitlement.restrictionLevel === 'unavailable') {
                throw new Error(`subscription_entitlement_unavailable:${entitlement.error ?? 'unknown'}`);
            }
            const reason = entitlement.error ?? 'subscription_restricted';
            this.logger.warn(
                `Broadcast dropped (${reason}): campaign=${campaignId} recipient=${recipientId}`,
            );
            await this.markFailed(schemaName, campaignId, recipientId, job.data.variantId, reason);
            return `skipped:${reason}`;
        }

        // ── WHATSAPP IS ITS OWN SHAPE NOW: COMMIT, THEN CLOSE LATER ─────────
        if (channel === 'whatsapp') return this.dispatchWhatsApp(job);

        // --- SEND: the ONLY step allowed to trigger a BullMQ retry ---
        let messageId: string;
        try {
            messageId = channel === 'sms'
                ? await this.sendSMS(job.data)
                : await this.sendEmail(job.data);
        } catch (error: any) {
            const errorMessage = error?.message || 'Unknown error';

            // Out-of-credits is permanent for this recipient — mark failed and DO NOT
            // retry (a retry just re-checks the empty balance; no send, no charge).
            if (errorMessage === 'INSUFFICIENT_SMS_CREDITS' || errorMessage === 'SMS_DISABLED') {
                const reason = errorMessage === 'SMS_DISABLED' ? 'sms_disabled' : 'insufficient_sms_credits';
                this.logger.warn(`Broadcast SMS dropped (${reason}): campaign=${campaignId} recipient=${recipientId}`);
                await this.markFailed(schemaName, campaignId, recipientId, job.data.variantId, reason);
                return `skipped:${reason}`;
            }

            this.logger.error(`Broadcast failed: campaign=${campaignId} channel=${channel} attempt=${job.attemptsMade + 1}/3 error=${errorMessage}`);
            if (job.attemptsMade + 1 >= (job.opts?.attempts || 3)) {
                await this.markFailed(schemaName, campaignId, recipientId, job.data.variantId, errorMessage);
            }
            throw error; // let BullMQ retry the SEND only
        }

        // --- BOOKKEEPING: must NEVER re-trigger the send ---
        // The message is already delivered (and, for SMS, already charged). A failure
        // here must not re-queue the job — otherwise the customer gets a duplicate
        // message and the tenant is double-charged. So we log and swallow.
        try {
            await this.markSent(schemaName, campaignId, recipientId, job.data.variantId, messageId);
        } catch (bookErr: any) {
            this.logger.error(`Broadcast post-send bookkeeping failed (message ${messageId} already delivered): ${bookErr?.message || bookErr}`);
        }

        this.logger.log(`Broadcast sent: campaign=${campaignId} channel=${channel} messageId=${messageId}`);
        return messageId;
    }

    /** Mark a recipient failed + update A/B stats + check campaign completion. */
    private async markFailed(schemaName: string, campaignId: string, recipientId: string, variantId: string | undefined, reason: string): Promise<void> {
        await this.broadcastService.updateRecipientStatus(schemaName, recipientId, 'failed', reason);
        if (variantId) {
            try { await this.abTestService.updateVariantStats(schemaName, variantId, 'failed'); } catch { /* tables may not exist */ }
        }
        await this.broadcastService.checkCampaignCompletion(schemaName, campaignId);
    }

    /** Mark a recipient sent + update A/B stats + check campaign completion. */
    private async markSent(schemaName: string, campaignId: string, recipientId: string,
        variantId: string | undefined, messageId: string): Promise<void> {
        await this.broadcastService.updateRecipientStatus(schemaName, recipientId, 'sent', undefined, messageId);
        if (variantId) {
            try { await this.abTestService.updateVariantStats(schemaName, variantId, 'sent'); } catch { /* tables may not exist */ }
        }
        await this.broadcastService.checkCampaignCompletion(schemaName, campaignId);
    }

    /**
     * ═══ ONE CAMPAIGN MESSAGE, COMMITTED BEFORE IT IS SENT ═══
     *
     * The origin is the campaign and the recipient, so a BullMQ retry after an
     * ambiguous timeout finds the row the first attempt committed instead of
     * sending a second message. The authority is read from `campaign_recipients`
     * — with the CAMPAIGN's own status inside it — and revalidated inside the
     * transaction that grants the lease, which is what finally makes pressing
     * pause stop the messages that were already queued.
     */
    private async dispatchWhatsApp(job: Job<BroadcastJobData>): Promise<string> {
        const data = job.data;
        const { schemaName, campaignId, recipientId } = data;
        const sender = String(data.channelAccountId ?? '').trim();
        if (!sender) {
            // Refused rather than resolved. A durable row names the account it
            // will be billed to before the processor picks it up, and letting
            // the resolver choose put the tenant's OLDEST connection on every
            // message of the campaign — a property of row order, not of any
            // decision. Retrying cannot help; the campaign has to name one.
            await this.markFailed(schemaName, campaignId, recipientId, data.variantId,
                'connection_unnamed');
            return 'skipped:connection_unnamed';
        }
        const contactId = String(data.contactId ?? '').trim();
        if (!contactId) {
            await this.markFailed(schemaName, campaignId, recipientId, data.variantId,
                'recipient_without_contact');
            return 'skipped:recipient_without_contact';
        }

        const conversationId = await this.proactive.conversationFor(schemaName, {
            contactId, channelType: 'whatsapp', channelAccountId: sender,
        });
        if (!conversationId) throw new Error('broadcast_without_conversation');

        const operationalScope = await this.proactive.policyAuthority(schemaName, {
            tenantId: data.tenantId, producer: 'broadcast_message', channelType: 'whatsapp',
            channelAccountId: sender, entityId: recipientId,
        });
        if (!operationalScope) {
            // The recipient is no longer owed a message: already sent or
            // failed, or the campaign is paused, cancelled or finished. The row
            // is left exactly as it is — a paused campaign is one somebody
            // means to resume, and marking its recipients failed would destroy
            // that.
            this.logger.log(`Broadcast recipient ${recipientId} no longer owed a message — suppressed`);
            return 'skipped:suppressed';
        }

        const result = await this.proactive.send(data.tenantId, {
            originKey: originKeyFor(campaignId, recipientId),
            conversationId: String(conversationId),
            contactId,
            channelType: 'whatsapp',
            channelAccountId: sender,
            recipient: data.phone,
            items: [{ kind: 'template', payload: {
                templateName: data.templateName,
                language: data.templateLanguage,
                components: data.templateComponents,
            } }],
            operationalScope,
        });
        if (!producerMayAdvance(result)) {
            const reason = 'reason' in result ? result.reason : result.kind;
            if (job.attemptsMade + 1 >= (job.opts?.attempts || 3)) {
                await this.markFailed(schemaName, campaignId, recipientId, data.variantId, reason);
            }
            throw new Error(`broadcast_not_dispatched:${result.kind}:${reason}`);
        }
        if (!effectIsDurable(result)) {
            // ── THE RECIPIENT IS NOT OWED A MESSAGE, BUT THE CAMPAIGN IS
            //    OWED A CONCLUSION ──────────────────────────────────────────
            //
            // `producerMayAdvance` was true, so there is nothing to retry: the
            // lane suppressed this effect on a decision that stands — a
            // ceiling, a duplicate, an effect already resolved. What it does
            // NOT mean is that the row can be left where it is. The pre-send
            // gate above leaves a recipient untouched because the campaign may
            // be resumed; here the campaign is running and this person will
            // never receive the message.
            //
            // This used to `return` bare. The recipient stayed `queued` for
            // ever, `checkCampaignCompletion` was never called for it, and a
            // campaign of a thousand people sat at 999 done with nothing
            // saying why.
            //
            // And NO settle pass is scheduled: it reads the outbox row this
            // recipient produced, a suppressed effect produced none, and twenty
            // attempts against a row that will never exist would end by marking
            // the recipient a second time.
            const suppressed = 'reason' in result ? String(result.reason) : result.kind;
            await this.markFailed(schemaName, campaignId, recipientId, data.variantId,
                `suppressed:${suppressed}`);
            return 'skipped:suppressed';
        }

        // ── AND THE RECIPIENT IS *NOT* MARKED SENT HERE ─────────────────────
        //
        // `campaign_recipients.status` is inside the authority that guards this
        // very row: the policy reads anything other than pending/queued as "no
        // message is owed". Marking it `sent` now would make the effect it
        // describes GONE at admission, and the campaign would report a message
        // the customer never received — the precise defect this lane exists to
        // remove, reintroduced by the bookkeeping.
        //
        // So the recipient is closed by a pass that runs after the effect has
        // actually settled.
        await this.queue.add(BROADCAST_SETTLE_JOB, data, {
            jobId: `bcast-settle-${campaignId}-${recipientId}`,
            delay: 15_000,
            attempts: 20,
            backoff: { type: 'fixed', delay: 30_000 },
            removeOnComplete: 100,
            removeOnFail: 500,
        });
        return `dispatch:${result.kind}`;
    }

    /**
     * Close one recipient against what the lane actually did with its effect.
     *
     * The states divide three ways and each one means something different to a
     * campaign's report:
     *
     *   · `sent` / `stored` — it arrived. The recipient is sent, and the
     *     provider's own id goes with it so a status webhook can settle the
     *     money against the same message.
     *   · `suppressed` — the policy refused it between preparing and sending
     *     (the campaign was paused, the recipient was already closed). Failed,
     *     with the reason, because nothing will ever deliver it.
     *   · anything else — it has not finished. The job retries; the outbox is
     *     the only record that matters and it is still working.
     */
    private async settleWhatsApp(data: BroadcastJobData): Promise<string> {
        const { schemaName, campaignId, recipientId } = data;
        const originId = ProactiveDispatchService.originId(originKeyFor(campaignId, recipientId));
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT state, receipt, error_code FROM agent_dispatch_outbox
              WHERE inbound_message_id = $1::uuid ORDER BY item_index LIMIT 1`,
            [originId],
        );
        const row = rows?.[0];
        // No row at all is not "nothing happened": a purge or an erasure can
        // remove it, and so can a settling pass that started before the commit
        // was visible. Retrying is the only honest answer, and the job's own
        // attempt count is what bounds it.
        if (!row) throw new Error(`broadcast_effect_missing:${recipientId}`);

        if (['sent', 'stored'].includes(String(row.state))) {
            await this.markSent(schemaName, campaignId, recipientId, data.variantId,
                String(row.receipt ?? ''));
            return `settled:sent:${recipientId}`;
        }
        if (String(row.state) === 'suppressed') {
            await this.markFailed(schemaName, campaignId, recipientId, data.variantId,
                String(row.error_code ?? 'suppressed').slice(0, 200));
            return `settled:suppressed:${recipientId}`;
        }
        if (String(row.state) === 'reconciliation_required') {
            // A person has to say whether this arrived. Neither `sent` nor
            // `failed` is a thing this process may claim, so the recipient is
            // left as it is and the job stops asking.
            this.logger.warn(`Broadcast recipient ${recipientId} awaits reconciliation`);
            return `settled:reconciliation_required:${recipientId}`;
        }
        throw new Error(`broadcast_effect_in_flight:${row.state}:${recipientId}`);
    }

    private async sendEmail(data: BroadcastJobData): Promise<string> {
        if (!data.email) throw new Error('No email address for recipient');
        if (!data.emailSubject) throw new Error('No email subject configured');

        const sent = await this.emailService.send({
            to: data.email,
            subject: data.emailSubject,
            html: data.emailHtml || undefined,
            text: data.emailText || data.emailSubject,
        });

        if (!sent) throw new Error('Email delivery failed — SMTP not configured or transport error');
        return `email-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }

    private async sendSMS(data: BroadcastJobData): Promise<string> {
        if (!data.phone) throw new Error('No phone number for SMS recipient');
        if (!data.smsBody) throw new Error('No SMS body configured');

        // Reseller model: broadcast SMS is delivered via the PLATFORM Twilio sender
        // and charged to the tenant's prepaid SMS credit balance (1 credit/segment),
        // NOT the tenant's own Twilio. `ref` is stable per recipient for audit.
        const res = await this.tenantSms.send(data.tenantId, data.phone, data.smsBody, {
            reason: 'broadcast',
            ref: `bcast:${data.campaignId}:${data.recipientId}`,
            metadata: { campaignId: data.campaignId },
        });
        if (res.sent) return res.sid || '';
        // Both are permanent for this message — surfaced as non-retryable in process().
        if (res.reason === 'insufficient_credits') throw new Error('INSUFFICIENT_SMS_CREDITS');
        if (res.reason === 'monetization_disabled') throw new Error('SMS_DISABLED');
        if (res.reason === 'platform_sms_unconfigured') throw new Error('SMS de plataforma no configurado');
        throw new Error(`Twilio SMS error: ${res.error || res.reason}`);
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<BroadcastJobData>, error: Error) {
        this.logger.error({ msg: 'Broadcast job failed', jobId: job.id, campaignId: job.data.campaignId, channel: job.data.channel, error: error.message });
        // Out-of-credits is an expected business condition, not an incident — keep it out of Sentry.
        if (error.message === 'INSUFFICIENT_SMS_CREDITS') return;
        // Nor is "the effect has not settled yet": the settling pass is SUPPOSED
        // to keep asking, and every ask would otherwise raise an incident.
        if (error.message.startsWith('broadcast_effect_in_flight')) return;
        Sentry.captureException(error, { tags: { queue: 'broadcast-messages', campaignId: job.data.campaignId, channel: job.data.channel }, extra: { jobId: job.id } });
    }
}
