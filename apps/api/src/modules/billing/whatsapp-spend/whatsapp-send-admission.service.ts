import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PROVIDER_BILLED_CHANNELS } from '@parallext/shared';
import { WhatsappSpendService, type SpendAuthorizeResult } from './whatsapp-spend.service';
import type { SpendDisposition, SpendPressure } from './spend-ledger';
import { resolveRepetitionPolicy, type RepetitionPolicy } from './spend-repetition';
import { describeBlock, spendBlock, type SpendBlock } from './spend-diagnosis';
import { AccountPauseStore } from '../../channels/account-pause-store';
import { describePause } from '../../channels/account-send-pause';

/**
 * ═══ THE ONE GATE EVERY CHARGEABLE WHATSAPP MESSAGE PASSES ═══
 *
 * The census found thirty-eight call sites that can put a message on a
 * customer's phone, twenty-six of them outside any durable lane. Rewriting
 * twenty-six producers is a migration; giving them one boundary is a gate — and
 * the gate belongs at the SINKS, because there are three of those and they are
 * the only places a WhatsApp request actually leaves the process:
 *
 *   · the durable dispatch transport, in `OutboundQueueProcessor`;
 *   · the legacy channel gateway, in the same processor;
 *   · `WhatsappMessagingService`, the inline REST surface.
 *
 * A producer that does not pass through one of those cannot send at all, so
 * "every chargeable send is authorised" is a property of the code rather than a
 * list somebody maintains.
 *
 * ── WHY THE DEFAULT IS `observe` ────────────────────────────────────────────
 *
 * No tenant has a billing time zone yet, no rate card is bound to an account,
 * and no ceiling has been configured by anybody. Shipping this as `enforce`
 * would stop every message on the platform the moment it deployed — a limit
 * nobody asked for, applied to everybody, on the strength of data that does not
 * exist.
 *
 * So the gate RECORDS by default: it reserves, it counts, it writes the
 * diagnosis, and it lets the message through. Turning it to `enforce` is a
 * deliberate commercial decision, per tenant, taken by somebody who has looked
 * at what `observe` recorded. The boundary is structural from day one; the
 * refusal is opt-in.
 */
export type SpendEnforcement = 'observe' | 'enforce';

export interface AdmissionConnection {
    readonly tenantId: string;
    readonly channelType: string;
    readonly channelAccountId: string;
    readonly channelAddress?: string | null;
    readonly payerWabaId?: string | null;
    readonly payerBusinessId?: string | null;
    readonly credentialId?: string | null;
    readonly credentialSource?: 'channel_account' | 'tenant_credential' | 'system_user' | null;
}

export interface AdmissionRequest {
    readonly schema: string;
    readonly connection: AdmissionConnection;
    /** A contact id or a hashed address. NEVER the raw phone number. */
    readonly recipientRef: string;
    readonly contactId?: string | null;
    /** `service`, `marketing`, `utility`, `authentication`. */
    readonly category?: string | null;
    /** The campaign, broadcast or automation this belongs to, when there is one. */
    readonly taskId?: string | null;
    /** Which producer asked. Part of the effect key, so it must be stable. */
    readonly producer: string;
    /**
     * Did WE start this exchange, or did the customer?
     *
     * Declared by the producer, never inferred from the message: deciding from
     * a body that a person asking for help is a marketing blast is exactly the
     * invented intent this whole layer is supposed to avoid. It is what the
     * soft stop reads — a budget nearly spent pauses the campaigns and keeps
     * answering the people who wrote in — so getting it wrong either silences
     * customers or lets a broadcast run to the ceiling.
     *
     * Omitted means `proactive`: the reading that spends less.
     */
    readonly disposition?: SpendDisposition;
    readonly ordinal?: number;
    /** What is being sent, as a digest. The content itself never travels. */
    readonly contentDigest: string;
    readonly deliveries?: number;
    readonly admissionReason: string;
    readonly binding?: {
        inboundMessageId?: string | null; batchId?: string | null;
        dispatchItemId?: string | null; itemIndex?: number | null;
    };
}

export interface Admission {
    /** May the caller perform the remote request? */
    readonly permitted: boolean;
    /** Present whenever a reservation exists, including an adopted one. */
    readonly effectKey: string;
    readonly reservationId?: string | null;
    /** Why it would have been refused, whether or not it was. */
    readonly block?: SpendBlock | null;
    readonly enforcement: SpendEnforcement;
    /**
     * How full the fullest ceiling is now. Carried on a PERMITTED admission too:
     * a warning only emitted on refusal arrives after the thing it was meant to
     * warn about.
     */
    readonly pressure?: SpendPressure;
    /** True when this channel is not billed by a provider at all. */
    readonly notBilled?: boolean;
}

@Injectable()
export class WhatsappSendAdmissionService {
    private readonly logger = new Logger(WhatsappSendAdmissionService.name);

    /**
     * Per-tenant enforcement, cached briefly.
     *
     * Sixty seconds: long enough that the busiest path is not a settings read,
     * short enough that turning enforcement on takes effect while the person who
     * turned it on is still watching.
     */
    private readonly modeCache = new Map<string, { mode: SpendEnforcement; until: number }>();
    private readonly MODE_TTL_MS = 60_000;

    constructor(
        private readonly prisma: PrismaService,
        private readonly spend: WhatsappSpendService,
        // Optional for the same reason the whole gate is: a deployment that has
        // not wired it must still send. When it IS wired, a number Meta refuses
        // to bill stops trying.
        @Optional() private readonly pauses?: AccountPauseStore,
    ) {}

    /**
     * Authorise one remote effect, or say exactly why not.
     *
     * Never throws for a money reason: a caller in the middle of a send path
     * gets a verdict, not an exception. It DOES let an infrastructure error
     * propagate, because "the database is unreachable" is not a spending
     * decision and must not be silently read as permission.
     */
    async admit(request: AdmissionRequest): Promise<Admission> {
        const channel = String(request.connection.channelType || '').toLowerCase();
        const effectKey = this.spend.effectKey({
            tenantId: request.connection.tenantId,
            channelAccountId: request.connection.channelAccountId,
            recipientRef: request.recipientRef,
            category: request.category || 'service',
            producer: request.producer,
            ordinal: request.ordinal ?? 0,
            contentDigest: request.contentDigest,
        });

        // Instagram, Messenger, Telegram and the widget are not billed by their
        // provider per message. Counting them would invent a cost, and a number
        // that is not real is worse than no number.
        if (!PROVIDER_BILLED_CHANNELS.includes(channel as any)) {
            return Object.freeze({ permitted: true, effectKey, enforcement: 'observe' as const, notBilled: true });
        }

        const enforcement = await this.enforcementFor(request.connection.tenantId);

        // ── Is Meta refusing to bill this number at all? ────────────────────
        //
        // Checked BEFORE pricing and before any reservation, because the answer
        // is not "this message costs too much" but "no message from this number
        // can be delivered until a person adds a card in Meta". Retrying is
        // pointless — every attempt is identical — so the refusal is returned
        // regardless of enforcement mode. `observe` exists to avoid stopping
        // messages that WOULD have gone out; these would not.
        const pause = await this.pauses?.current(
            request.connection.tenantId, request.connection.channelAccountId).catch(() => null);
        if (pause && !pause.clearedAt) {
            return Object.freeze({
                permitted: false, effectKey, enforcement,
                block: spendBlock('account_paused', describePause(pause)),
            });
        }

        const account = await this.accountFacts(request.connection.tenantId, request.connection.channelAccountId);

        const result: SpendAuthorizeResult = await this.spend.authorize(request.schema, {
            effectKey,
            identity: {
                tenantId: request.connection.tenantId,
                channelType: channel,
                channelAccountId: request.connection.channelAccountId,
                channelAddress: request.connection.channelAddress ?? account.address,
                payerKind: request.connection.payerWabaId ? 'business_direct' : 'unknown',
                payerWabaId: request.connection.payerWabaId ?? account.wabaId,
                payerBusinessId: request.connection.payerBusinessId ?? account.businessId,
                credentialId: request.connection.credentialId || 'unknown',
                credentialSource: request.connection.credentialSource || 'system_user',
                recipientScope: 'customer',
                recipientRef: request.recipientRef,
                category: request.category || 'service',
                market: account.market,
                currency: account.currency,
            },
            binding: request.binding,
            contactId: request.contactId,
            taskId: request.taskId,
            deliveries: Math.max(1, request.deliveries ?? 1),
            wabaTimeZone: account.timeZone,
            admissionReason: request.admissionReason,
            disposition: request.disposition,
            // The digest travels on its own as well as inside the effect key:
            // the key hashes the producer too, so it recognises a retry of ONE
            // effect and not the same sentence arriving by another road.
            contentDigest: request.contentDigest,
            repetition: await this.repetitionFor(request.connection.tenantId),
            // In observe mode an unknown rate must not stop the recording: the
            // point of observing is to find out how many effects have no price.
            allowUnknownCost: enforcement === 'observe',
        });

        if (result.outcome !== 'blocked') {
            if (result.pressure === 'warning' || result.pressure === 'soft_stop') {
                // Said once per admission rather than once per period: a ceiling
                // that fills over an afternoon should be visible all afternoon,
                // not in one line somebody scrolled past at 14:03.
                this.logger.warn(`[Spend] ${result.pressure} on ${request.producer} `
                    + `for account ${request.connection.channelAccountId}`);
            }
            return Object.freeze({
                permitted: true, effectKey, reservationId: result.reservation.id, enforcement,
                pressure: result.pressure,
            });
        }

        // Blocked. In `observe` the message still goes; the diagnosis is the
        // product, and an operator sees what enforcement WOULD have stopped.
        const line = describeBlock(result.block);
        if (enforcement === 'enforce') {
            this.logger.warn(`[Spend] refused ${request.producer}: ${line}`);
            return Object.freeze({ permitted: false, effectKey, block: result.block, enforcement });
        }
        this.logger.log(`[Spend] would refuse ${request.producer} under enforcement: ${line}`);
        return Object.freeze({ permitted: true, effectKey, block: result.block, enforcement });
    }

    /**
     * The same verdict, for a caller that only knows the schema.
     *
     * `WhatsappMessagingService` is schema-first: it never receives a tenant id
     * because every one of its queries is already scoped by the schema name.
     * Rather than thread a tenant id through five public methods and their
     * callers, the mapping is resolved here — it is one row, it never changes
     * for the life of a tenant, and it is cached for that reason.
     *
     * Returns `null` when the schema belongs to no tenant, which is not a
     * spending decision: the caller proceeds, and the send is simply unmetered.
     * A message stopped because a lookup came back empty would be a silence
     * caused by the meter rather than by a budget.
     */
    async admitBySchema(schema: string, request: Omit<AdmissionRequest, 'schema' | 'connection'> & {
        readonly channelType: string;
        readonly channelAccountId: string;
        readonly channelAddress?: string | null;
    }): Promise<Admission | null> {
        const tenantId = await this.tenantForSchema(schema);
        if (!tenantId) return null;
        const { channelType, channelAccountId, channelAddress, ...rest } = request;
        return this.admit({
            ...rest, schema,
            connection: { tenantId, channelType, channelAccountId, channelAddress },
        });
    }

    /** Schema → tenant. Immutable for the life of a tenant, so cached for good. */
    private readonly schemaTenants = new Map<string, string | null>();

    async tenantForSchema(schema: string): Promise<string | null> {
        if (this.schemaTenants.has(schema)) return this.schemaTenants.get(schema) ?? null;
        let tenantId: string | null = null;
        try {
            const tenant = await this.prisma.tenant.findFirst({
                where: { schemaName: schema }, select: { id: true },
            });
            tenantId = tenant?.id ?? null;
        } catch (error: any) {
            // Not cached: an unreachable database is a transient condition, and
            // remembering "no tenant" from it would unmeter the schema forever.
            this.logger.warn(`[Spend] tenant unresolved for ${schema}: ${error?.message}`);
            return null;
        }
        this.schemaTenants.set(schema, tenantId);
        return tenantId;
    }

    /** What the provider said, recorded against the reservation this admitted. */
    async record(schema: string, admission: Admission, outcome: {
        readonly kind: 'delivered_priced' | 'delivered_unpriced' | 'rejected' | 'timeout';
        readonly providerMessageId?: string | null;
        readonly chargedMinor?: number | null;
        readonly errorCode?: string | null;
    }): Promise<void> {
        if (!admission.reservationId) return;
        try {
            await this.spend.recordOutcome(schema, admission.effectKey, outcome);
        } catch (error: any) {
            // Never fatal to a send that already happened: the lease sweeper
            // turns an unrecorded outcome into visible exposure, which is the
            // honest state, and throwing here would retry a delivered message.
            this.logger.error(`[Spend] outcome not recorded for ${admission.effectKey.slice(0, 12)}: `
                + `${error?.message}. The lease will surface it as exposure.`);
        }
    }

    /**
     * The facts about an account that pricing needs, none of which it may guess.
     *
     * Every one of them is nullable on purpose. A missing time zone is a block
     * with a name and a one-field fix; a defaulted time zone is a wrong rate
     * date nobody ever notices.
     */
    private async accountFacts(tenantId: string, channelAccountId: string): Promise<{
        timeZone: string | null; currency: string | null; market: string | null;
        wabaId: string | null; businessId: string | null; address: string | null;
    }> {
        try {
            const account = await this.prisma.channelAccount.findFirst({
                where: { tenantId, channelType: 'whatsapp', accountId: channelAccountId },
                select: { wabaTimezone: true, metadata: true, displayName: true },
            });
            const metadata = (account?.metadata ?? {}) as Record<string, any>;
            return {
                timeZone: account?.wabaTimezone ?? null,
                currency: metadata.billingCurrency ?? null,
                market: metadata.billingMarket ?? null,
                wabaId: metadata.wabaId ?? null,
                businessId: metadata.businessId ?? null,
                address: account?.displayName ?? null,
            };
        } catch (error: any) {
            this.logger.warn(`[Spend] account facts unreadable for ${channelAccountId}: ${error?.message}`);
            return { timeZone: null, currency: null, market: null, wabaId: null, businessId: null, address: null };
        }
    }

    /**
     * How often a tenant is willing to say the same thing twice.
     *
     * Cached beside the enforcement mode and for the same reason: the busiest
     * path in the platform must not be two settings reads, and sixty seconds is
     * short enough that a change takes effect while the person who made it is
     * still looking at the screen.
     */
    private readonly repetitionCache = new Map<string, { policy: RepetitionPolicy; until: number }>();

    private async repetitionFor(tenantId: string): Promise<RepetitionPolicy> {
        const cached = this.repetitionCache.get(tenantId);
        if (cached && cached.until > Date.now()) return cached.policy;
        let configured: unknown;
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId }, select: { settings: true },
            });
            configured = (tenant?.settings as any)?.whatsappSpend?.repetition;
        } catch (error: any) {
            // Unreadable settings mean the tenant configured nothing, which
            // resolves to the shipped default. Failing closed here would stop a
            // platform because one row could not be read.
            this.logger.warn(`[Spend] repetition policy unreadable for ${tenantId}: ${error?.message}`);
        }
        const policy = resolveRepetitionPolicy(configured);
        this.repetitionCache.set(tenantId, { policy, until: Date.now() + this.MODE_TTL_MS });
        return policy;
    }

    private async enforcementFor(tenantId: string): Promise<SpendEnforcement> {
        const cached = this.modeCache.get(tenantId);
        if (cached && cached.until > Date.now()) return cached.mode;
        let mode: SpendEnforcement = 'observe';
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId }, select: { settings: true },
            });
            const configured = (tenant?.settings as any)?.whatsappSpend?.enforcement;
            if (configured === 'enforce') mode = 'enforce';
        } catch (error: any) {
            // Unreadable settings mean the tenant never opted in, which is the
            // same as not having opted in. Failing closed here would stop a
            // platform because one row could not be read.
            this.logger.warn(`[Spend] enforcement unreadable for ${tenantId}: ${error?.message}`);
        }
        this.modeCache.set(tenantId, { mode, until: Date.now() + this.MODE_TTL_MS });
        return mode;
    }
}
