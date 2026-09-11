import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { replaceTenantSettingsBranch } from '../../common/utils/tenant-settings-branch.util';
import { ProactiveSendConnection } from '../channels/proactive-connection';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { recallDefaultMessage, recallNameFallback, normaliseRecallLang } from './recall-i18n';
import { CronLockService } from '../redis/cron-lock.service';
import {
    ProactiveDispatchService, effectIsDurable, producerMayAdvance,
} from '../channels/proactive-dispatch.service';

/**
 * The cooldown this pass took, and the one it took it from.
 *
 * `previous` is the cycle boundary that made this contact due, and it is what
 * the origin is derived from: a retry of the SAME cycle derives the same origin
 * and collides on the row that already exists, while the next cycle — ninety
 * days later, off a different boundary — gets a row of its own.
 */
interface RecallClaim {
    readonly previous: string | null;
    readonly claimed: string;
}

/**
 * Recall Service — daily cron that re-engages contacts whose last appointment
 * is older than the tenant-configured threshold (e.g. dental cleanings every
 * 6 months, gym membership lapse, aesthetic series follow-up).
 *
 * Per-tenant config lives at tenant.settings.recallConfig:
 *   {
 *     enabled: boolean,
 *     daysThreshold: number,   // e.g. 180 for semi-annual dental
 *     message: string,         // template body, supports {name} and {months}
 *     cooldownDays: number,    // backoff before re-prompting (default 90)
 *   }
 *
 * Marks contacts.next_recall_at = NOW() + cooldownDays after sending so
 * the same contact doesn't get hit every day until they reply.
 */
@Injectable()
export class RecallService {
    private readonly logger = new Logger(RecallService.name);

    constructor(
        private readonly prisma: PrismaService,
        /**
         * Which number the reactivation leaves from — and therefore who pays.
         *
         * This used to be `ChannelTokenService.getChannelToken(tenantId, type)`
         * with no account named, wrapped in a catch that logged and returned 0.
         * On a tenant with two numbers that is `connection_ambiguous`, so the
         * whole sweep silently did nothing, every day, with one warning line in
         * a container log. The resolver refuses the same choice, but it raises a
         * task in the product the business actually looks at.
         */
        private readonly connections: ProactiveSendConnection,
        private readonly throttle: TenantThrottleService,
        private readonly cronLock: CronLockService,
        /**
         * The durable lane.
         *
         * A recall left through `outbound_queue`, whose only record is Redis,
         * and the cooldown was written straight afterwards whatever happened —
         * so a restart between the two either lost the message for ninety days
         * or, when the cooldown write was what got lost, sent "hace tiempo que
         * no nos vemos" again the next morning. A second one of those is the
         * message a customer reads as spam, and it is billed.
         */
        private readonly proactive: ProactiveDispatchService,
    ) {}

    /** Daily at 9am — local server time. */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 9 * * *')
    async processRecallsCron() {
        await this.cronLock.runExclusive('recall.processRecalls', 3600, () => this.processRecalls());
    }

    async processRecalls(): Promise<void> {
        this.logger.log('[Cron] Processing recall messages...');

        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name, settings FROM tenants WHERE is_active = true
            `;

            let totalSent = 0;
            for (const tenant of tenants || []) {
                const config = (tenant.settings as any)?.recallConfig;
                if (!config?.enabled) continue;

                const recallEnabled = await this.throttle.isFeatureEnabled(tenant.id, 'recall');
                if (!recallEnabled) continue;

                const sent = await this.processForTenant(tenant.id, tenant.schema_name, config);
                totalSent += sent;
            }
            this.logger.log(`[Cron] Recall sweep complete: ${totalSent} messages sent`);
        } catch (e: any) {
            this.logger.error(`[Cron] Recall sweep failed: ${e.message}`);
        }
    }

    /** Public entry point so the dashboard can trigger a manual run for testing. */
    async processForTenant(
        tenantId: string,
        schemaName: string,
        config: { daysThreshold: number; message?: string; cooldownDays?: number; channelType?: string },
    ): Promise<number> {
        const daysThreshold = config.daysThreshold || 180;
        const cooldownDays = config.cooldownDays || 90;
        const channelType = config.channelType || 'whatsapp';

        // Find contacts whose last appointment is older than the threshold AND
        // either have never been recalled OR their cooldown has expired. We
        // also require a phone number — recall via WhatsApp is the only flow
        // we ship today.
        let dueContacts: any[];
        try {
            dueContacts = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, name, phone, last_appointment_at, next_recall_at
                 FROM contacts
                 WHERE phone IS NOT NULL
                   AND last_appointment_at IS NOT NULL
                   AND last_appointment_at < clock_timestamp() - ($1::int * INTERVAL '1 day')
                   -- clock_timestamp(), not NOW(): NOW() freezes at BEGIN, and
                   -- "has this cooldown expired" asked of a frozen clock
                   -- answers about a moment that has already passed.
                   AND (next_recall_at IS NULL OR next_recall_at <= clock_timestamp())
                 LIMIT 100`,
                [daysThreshold],
            );
        } catch (e: any) {
            this.logger.warn(`Failed to query recall contacts for ${tenantId}: ${e.message}`);
            return 0;
        }

        if (!dueContacts?.length) return 0;
        this.logger.log(`Tenant ${tenantId}: ${dueContacts.length} contact(s) due for recall`);

        // Resolve tenant language once per batch as a shared fallback. Individual
        // contacts may have their own detectedLanguage resolved inside the loop.
        const tenantLang = await this.getTenantLanguage(tenantId);

        let sent = 0;
        for (const c of dueContacts) {
            try {
                sent += await this.recallOne(tenantId, schemaName, c, {
                    channelType, cooldownDays, tenantLang, message: config.message,
                }) ? 1 : 0;
            } catch (e: any) {
                this.logger.warn(`Recall failed for contact ${c.id}: ${e.message}`);
            }
        }

        return sent;
    }

    /**
     * ═══ ONE RECALL, AND WHY THE COOLDOWN MOVES FIRST ═══
     *
     * `contacts.next_recall_at` is this producer's business state: it is what
     * stops the same person being asked to come back every single morning. The
     * general rule on this lane is that business state is written only AFTER a
     * durable effect exists — and here the correct order is the opposite one,
     * for a reason that is specific to this producer and worth stating.
     *
     * ── THE ORDER, AND WHY IT IS THIS ONE ───────────────────────────────────
     *
     * `next_recall_at` is INSIDE the recall's revision (see
     * `recallContactRevision`). So if the effect were prepared first, its
     * revision would describe the contact as they were BEFORE the cooldown
     * moved; moving it immediately afterwards would make that row stale, and
     * the admission would suppress it. Not sometimes — every time. Every recall
     * on the platform would be prepared and then thrown away, and nobody would
     * ever receive one.
     *
     * Moving the cooldown first makes the revision describe the contact as they
     * will still be when the lease is granted, and the same write doubles as the
     * CLAIM that stops two passes preparing two recalls: the second one finds
     * the contact no longer due and walks away.
     *
     * ── AND WHAT THAT COSTS, AND HOW IT IS PAID ─────────────────────────────
     *
     * A cooldown that moved without an effect behind it is ninety days of
     * silence for a customer who was owed a message. So a result that is not
     * durable and not a suppression puts the previous value back, and the next
     * pass tries again from the same cycle boundary — deriving the same origin,
     * so even a retry after a commit nobody observed finds the existing row
     * rather than sending a second message.
     *
     * A crash BETWEEN the claim and the prepare is the one case nothing can
     * repair: that contact loses this cycle. It is the honest price of the
     * ordering, and it costs one missed message rather than one duplicate.
     */
    private async recallOne(tenantId: string, schemaName: string, contact: any, input: {
        readonly channelType: string;
        readonly cooldownDays: number;
        readonly tenantLang: string;
        readonly message?: string;
    }): Promise<boolean> {
        const contactId = String(contact.id);
        // The number this person last spoke to the business on, when there is
        // one. Named rather than inherited: from October Meta bills the account
        // the message leaves from, and a reactivation arriving from a number the
        // customer has never seen reads as a message from a stranger.
        const preferred = await this.preferredAccount(schemaName, contactId, input.channelType);
        let credentials: { accessToken: string; accountId: string } | null;
        try {
            credentials = await this.connections.resolve({
                tenantId, schemaName, channelType: input.channelType,
                channelAccountId: preferred,
                purpose: 'los mensajes de reactivación',
            });
        } catch (e: any) {
            // Infrastructure, not a choice anybody got wrong. Nothing is claimed
            // and nothing is lost: tomorrow's pass finds the same contact due.
            this.logger.warn(`[Recall] no ${input.channelType} connection for ${tenantId} `
                + `right now: ${e?.message}`);
            return false;
        }
        if (!credentials?.accountId) return false;
        const channelAccountId = String(credentials.accountId);

        // THE CLAIM. Also the cooldown — see the block comment above.
        const claim = await this.claimCooldown(schemaName, contactId, input.cooldownDays);
        if (!claim) return false;

        let result;
        try {
            const conversationId = await this.proactive.conversationFor(schemaName, {
                contactId, channelType: input.channelType, channelAccountId,
            });
            if (!conversationId) {
                // No thread means no history row, and no history row means the
                // effect has no receipt and no way back. `deferred`, because a
                // thread that could not be opened now may open tomorrow.
                result = { kind: 'deferred' as const, reason: 'no_conversation' };
            } else {
                const operationalScope = await this.proactive.policyAuthority(schemaName, {
                    tenantId, producer: 'recall_reminder', channelType: input.channelType,
                    channelAccountId, entityId: contactId,
                });
                result = operationalScope
                    ? await this.proactive.send(tenantId, {
                        // The cycle boundary that made them due, NOT the one this
                        // pass just wrote: a retry of the same cycle must derive
                        // the same origin, and the next cycle a different one.
                        originKey: `recall_reminder:${contactId}:${claim.previous ?? 'first'}`,
                        conversationId: String(conversationId),
                        contactId,
                        channelType: input.channelType, channelAccountId,
                        recipient: String(contact.phone ?? ''),
                        items: [{ kind: 'text' as const, payload: {
                            text: await this.composeRecall(schemaName, contact, input),
                        } }],
                        operationalScope,
                    })
                    // No phone, or no contact any more. Nothing is owed, so the
                    // cooldown stays where it is rather than retrying daily.
                    : { kind: 'suppressed' as const, reason: 'entity_no_longer_eligible' };
            }
        } catch (e: any) {
            result = { kind: 'deferred' as const, reason: String(e?.message ?? e).slice(0, 200) };
        }

        if (!producerMayAdvance(result)) {
            // Put the boundary back. Leaving it moved would buy ninety days of
            // silence with a message that never left.
            await this.releaseCooldown(schemaName, contactId, claim);
            this.logger.warn(`[Recall] ${contactId} was ${result.kind} `
                + `(${(result as any).reason ?? ''}) — the cooldown was released`);
            return false;
        }
        this.logger.log(`[Recall] ${result.kind} the reactivation for ${contactId}`);
        return effectIsDurable(result);
    }

    /** The words, in the language this person has actually been writing in. */
    private async composeRecall(schemaName: string, contact: any, input: {
        readonly tenantLang: string; readonly message?: string;
    }): Promise<string> {
        const monthsAgo = Math.round(
            (Date.now() - new Date(contact.last_appointment_at).getTime())
            / (1000 * 60 * 60 * 24 * 30));
        const lang = await this.getContactLanguage(schemaName, String(contact.id), input.tenantLang);
        const firstName = contact.name?.split(' ')?.[0] || recallNameFallback(lang);
        const template = input.message ? input.message : recallDefaultMessage(lang);
        return template
            .replace(/\{name\}/g, firstName)
            .replace(/\{months\}/g, String(monthsAgo));
    }

    /**
     * Take this cycle, or find that somebody else already did.
     *
     * `FOR UPDATE` is the whole mutual exclusion: two passes asking at the same
     * moment queue on the row, and the loser reads the winner's value and sees
     * the contact is no longer due. Without it both read "due", both send, and
     * the customer gets the same "we miss you" twice in one morning.
     */
    private async claimCooldown(schemaName: string, contactId: string,
        cooldownDays: number): Promise<RecallClaim | null> {
        return this.prisma.transactionInTenantSchema(schemaName, async query => {
            const [row] = await query<any[]>(
                // `::text`, and NOT a Date. `next_recall_at` is a naive
                // TIMESTAMP with MICROSECOND precision, and a JavaScript Date
                // has milliseconds — so a value read as a Date and written back
                // loses the last three digits, the guarded release never matches
                // its own row, and the cooldown is never given back. The text
                // form round-trips exactly, and doubles as a stable origin key.
                `SELECT next_recall_at::text AS previous,
                        (next_recall_at IS NULL OR next_recall_at <= clock_timestamp()) AS due
                   FROM contacts WHERE id = $1::uuid FOR UPDATE`, [contactId]);
            if (!row || row.due !== true) return null;
            const [claimed] = await query<any[]>(
                `UPDATE contacts
                    SET next_recall_at = clock_timestamp() + ($2::int * INTERVAL '1 day')
                  WHERE id = $1::uuid
                  RETURNING next_recall_at::text AS claimed`, [contactId, cooldownDays]);
            return {
                previous: row.previous ? String(row.previous) : null,
                claimed: String(claimed?.claimed ?? ''),
            };
        }).catch((e: any) => {
            this.logger.warn(`[Recall] could not claim the cooldown for ${contactId}: ${e?.message}`);
            return null;
        });
    }

    /**
     * Give the cycle back, but only if it is still ours.
     *
     * Guarded on the claimed value: an unguarded write would stomp whatever
     * somebody else did to this contact in between — a completed appointment
     * clearing the cooldown, an operator editing it — and hand them a recall
     * the business had already decided against.
     */
    private async releaseCooldown(schemaName: string, contactId: string,
        claim: RecallClaim): Promise<void> {
        try {
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE contacts SET next_recall_at = $2::timestamp
                  WHERE id = $1::uuid AND next_recall_at = $3::timestamp`,
                [contactId, claim.previous, claim.claimed]);
        } catch (e: any) {
            this.logger.warn(`[Recall] could not release the cooldown for ${contactId}: ${e?.message}`);
        }
    }

    /**
     * The connection this person last spoke to the business on.
     *
     * A live thread only: an account read off a conversation somebody closed
     * months ago is no better evidence of "the number they know" than no
     * evidence at all, and the resolver's refusal is the honest answer when
     * there is a real choice to make.
     */
    private async preferredAccount(schemaName: string, contactId: string,
        channelType: string): Promise<string | null> {
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT channel_account_id FROM conversations
                  WHERE contact_id = $1::uuid AND channel_type = $2
                    AND COALESCE(status, 'active') NOT IN ('resolved', 'archived')
                    AND channel_account_id IS NOT NULL AND channel_account_id <> ''
                  ORDER BY updated_at DESC LIMIT 1`,
                [contactId, channelType]);
            return rows?.[0]?.channel_account_id ? String(rows[0].channel_account_id) : null;
        } catch {
            return null;
        }
    }

    /**
     * Resolve the language to use for a specific contact.
     *
     * Priority:
     *  1. `conversation.metadata.detectedLanguage` — the language the customer has
     *     actually been writing in (persisted per-turn by conversations.service.ts).
     *  2. `tenantLang` — the tenant's configured language (already resolved by caller).
     *
     * Returns a normalised 2-char code (es/en/pt/fr).
     */
    private async getContactLanguage(
        schemaName: string,
        contactId: string,
        tenantLang: string,
    ): Promise<string> {
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT metadata FROM conversations
                 WHERE contact_id = $1::uuid
                 ORDER BY updated_at DESC
                 LIMIT 1`,
                [contactId],
            );
            const detected = rows?.[0]?.metadata?.detectedLanguage as string | undefined;
            if (detected) return normaliseRecallLang(detected);
        } catch {
            // non-critical — fall through to tenant language
        }
        return normaliseRecallLang(tenantLang);
    }

    /**
     * Tenant's configured language as a short code (es/en/pt/fr), falling back
     * to 'es'. `tenant.language` may be stored as a full locale (e.g. 'es-CO').
     */
    private async getTenantLanguage(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { language: true },
            });
            return normaliseRecallLang((tenant?.language || 'es').split('-')[0]);
        } catch {
            return 'es';
        }
    }

    // ── Tenant config CRUD (used by the dashboard) ────────────────

    async getConfig(tenantId: string): Promise<any> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        return (tenant?.settings as any)?.recallConfig || {
            enabled: false,
            daysThreshold: 180,
            cooldownDays: 90,
            channelType: 'whatsapp',
            // Empty string means "use the system default" (multi-language, resolved at send time).
            // The dashboard should show a placeholder hint with the es default for reference.
            message: '',
        };
    }

    async setConfig(tenantId: string, config: any): Promise<any> {
        const recallConfig = {
            enabled: !!config.enabled,
            daysThreshold: Math.max(1, parseInt(config.daysThreshold || 180, 10)),
            cooldownDays: Math.max(1, parseInt(config.cooldownDays || 90, 10)),
            channelType: config.channelType || 'whatsapp',
            message: config.message || '',
        };
        await replaceTenantSettingsBranch(this.prisma, tenantId, 'recallConfig', recallConfig);
        return recallConfig;
    }

    /** Manual trigger for "Send recall now" button in the dashboard. */
    async runNow(tenantId: string): Promise<{ sent: number }> {
        const config = await this.getConfig(tenantId);
        if (!config.enabled) return { sent: 0 };
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        if (!tenant?.schemaName) return { sent: 0 };
        const sent = await this.processForTenant(tenantId, tenant.schemaName, config);
        return { sent };
    }
}
