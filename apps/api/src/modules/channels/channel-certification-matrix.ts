import { CERTIFIED_SELF_SERVICE_CHANNELS, rollUpOperationalState,
    type AgentOperationalState, type ChannelType } from '@parallext/shared';

/**
 * What each channel can actually do, and how far that has been shown.
 *
 * The directive's rule for this one is a prohibition rather than a target: *no
 * certifiques alcance inexistente.* Email has an internal inbound adapter and
 * an admin screen that calls tenant routes which do not exist; SMS is a
 * one-way notification product bought in credits. Both have appeared in
 * capability lists next to WhatsApp, and a list is exactly where scope that
 * does not exist gets certified by adjacency.
 *
 * So the matrix is built the other way round: a channel outside
 * `CERTIFIED_SELF_SERVICE_CHANNELS` cannot report a conversational capability
 * at all, whatever anyone declares about it, and the declaration for the ones
 * inside it is checked against the runtime where the runtime can answer.
 *
 * Derived where derivable, declared where not, and the spec feeds the derived
 * half from the real gateway and the real registries — so a declaration that
 * drifts from the code fails a test instead of shipping as a claim.
 */

export const CHANNEL_CAPABILITIES = [
    'inbound',
    'outbound_text',
    'outbound_media',
    'payment_link',
    'flow',
    'delivery_receipt',
    'read_receipt',
    'durable_dispatch',
    'token_lifecycle',
    'reconnect',
    'rate_limits',
    'handoff',
    'multi_account',
    'privacy_erasure',
    'agent_per_connection',
] as const;
export type ChannelCapability = (typeof CHANNEL_CAPABILITIES)[number];

/** Why a capability is where it is, in the words of the thing that decided. */
export type CapabilityBasis =
    /** The runtime answered: an adapter, a registry, a transport. */
    | 'derived'
    /** Written down here and pinned by a test that resolves its evidence. */
    | 'declared'
    /** Outside this channel's product scope. Never a gap, never a certificate. */
    | 'out_of_scope';

/**
 * A run that happened, not a place to go and look.
 *
 * `evidence` is prose — a file, a constant, a sentence — and prose cannot say
 * WHEN something was checked or against WHICH version. A capability certified by
 * a file path is certified by the existence of a file. This is the other thing:
 * an executed suite or a pilot, with the revision it ran against and the moment
 * it ran, so a reader can tell a current proof from a stale one and a dashboard
 * can link to it.
 */
export interface ChannelCapabilityProof {
    /** A suite that ran here, or a pilot that happened with a provider. */
    readonly kind: 'suite' | 'pilot';
    /** The spec, runbook or run id a reader can open. */
    readonly source: string;
    /** The revision of that source when the proof was recorded. */
    readonly revision: string;
    /** When it was recorded. ISO-8601. */
    readonly recordedAt: string;
}

export interface ChannelCapabilityCell {
    readonly capability: ChannelCapability;
    readonly state: AgentOperationalState;
    readonly basis: CapabilityBasis;
    /** A file, a constant, a pilot — whatever a reader has to go and look at. */
    readonly evidence: string;
    /**
     * The executed proof, when there is one. `null` is the honest answer for
     * everything today: nothing in this repository records one yet, and a cell
     * without a proof is never certified — which is the point.
     */
    readonly proof: ChannelCapabilityProof | null;
}

export interface ChannelCertification {
    readonly channelType: string;
    readonly selfService: boolean;
    /** What this channel is for, when it is not a conversational surface. */
    readonly retainedScope: string | null;
    readonly state: AgentOperationalState;
    readonly capabilities: readonly ChannelCapabilityCell[];
    /** Nothing implements it yet. */
    readonly pending: readonly ChannelCapability[];
    /**
     * Implemented and DECLARED, never operated. This list is the one that used
     * to be invisible: `pending` holds only the cells in state `pending`, so a
     * row whose every declared capability sat at `prepared` looked complete. A
     * declaration is a claim about the code, not a report of it working.
     */
    readonly untested: readonly ChannelCapability[];
    /** Operating, but with no executed proof recorded against it. */
    readonly unproven: readonly ChannelCapability[];
    /** Every in-scope capability is operating AND carries a current proof. */
    readonly certified: boolean;
}

export interface ChannelCertificationInput {
    /** Channels whose adapter implements `StrictDispatchTransport`. */
    readonly strictTransports: readonly string[];
    /** Channels with a producer feeding the shared delivery-status writer. */
    readonly deliveryStatusProducers: readonly string[];
    /** Channels whose read receipts reach that writer. */
    readonly readStatusProducers: readonly string[];
    /** Channels the durable dispatch switch will actually create a batch for. */
    readonly durableDispatchChannels: readonly string[];
    /**
     * Channels whose outbound is admitted locally instead of handed to a
     * provider. The Web Chat widget is the whole list: there is no third party
     * to accept the message, so the admission IS the delivery and a missing
     * strict transport there is the design, not a gap.
     */
    readonly localAdmissionChannels: readonly string[];
    /** Channels with an inbound path into the turn. */
    readonly inboundChannels: readonly string[];
}

/**
 * Retained surfaces and what they really are.
 *
 * Written as prose because the honest answer is a sentence, not a tick: the
 * failure mode being prevented is a column of green ticks that reads as
 * "supported" for something nobody can configure.
 */
const RETAINED_SCOPE: Readonly<Record<string, string>> = Object.freeze({
    email: 'Internal inbound adapter only. `/admin/channels/email` calls tenant '
        + 'configuration routes that do not exist, so there is no self-service connection to certify.',
    sms: 'One-way notification bought in credits. Never a conversational surface; '
        + 'the conversational adapter is retained as legacy and is not offered.',
});

/**
 * What is claimed for a self-service channel and where to look.
 *
 * `null` means the channel does not offer it at all — a WhatsApp Flow has no
 * Telegram equivalent, and pretending otherwise is the same error as certifying
 * email. Anything here is checked by the spec against the runtime input, which
 * is what stops it from becoming a wish list.
 */
const DECLARED: Readonly<Record<string, Partial<Record<ChannelCapability, string | null>>>> = Object.freeze({
    whatsapp: Object.freeze({
        outbound_media: 'whatsapp.adapter.ts strictBody: image/document/audio/video, caption as its own item',
        payment_link: 'dispatch-items.ts emits payment links before media',
        flow: 'whatsapp.adapter.ts strictBody interactive/flow; produced by conversations.service.ts',
        token_lifecycle: 'whatsapp-token-health.service.ts + channel-credential-health',
        reconnect: 'Embedded Signup in apps/whatsapp; coexistence documented in docs/coexistence-manual.md',
        rate_limits: 'outbound-queue.service.ts per-plan priority; TenantThrottleService',
        multi_account: 'channel_accounts.access_token per account; docs/multi-channel-per-type-implementation-2026-07.md',
    }),
    instagram: Object.freeze({
        outbound_media: 'instagram.adapter.ts refuses documents (unsupported_media_type:document)',
        payment_link: 'sent as text through the strict transport',
        flow: null,
        token_lifecycle: 'instagram-token-refresh.service.ts daily refresh within 30 days of expiry',
        reconnect: 'OAuth popup + callback under apps/dashboard/src/app/admin/channels/instagram',
        rate_limits: 'outbound-queue.service.ts',
        multi_account: 'channel_accounts per account',
    }),
    messenger: Object.freeze({
        outbound_media: 'messenger.adapter.ts strict transport',
        payment_link: 'sent as text through the strict transport',
        flow: null,
        token_lifecycle: 'channel-credential-health messenger_token',
        reconnect: 'FB SDK token exchange in channel-management.controller.ts',
        rate_limits: 'outbound-queue.service.ts',
        multi_account: 'channel_accounts per account',
    }),
    telegram: Object.freeze({
        outbound_media: 'telegram.adapter.ts sendStrict, media call carries no caption field',
        payment_link: 'sent as text through the strict transport',
        flow: null,
        token_lifecycle: 'channel-credential-health telegram_token',
        reconnect: 'bot token re-entry in channel-management.controller.ts',
        rate_limits: 'outbound-queue.service.ts',
        multi_account: 'channel_accounts per account',
    }),
    web_widget: Object.freeze({
        outbound_media: 'widget.adapter.ts approved effect delivery',
        payment_link: 'approved effect delivery, admitted locally',
        flow: null,
        // The widget has no provider to ask, so there is nobody to receive a
        // receipt from: the admission IS the delivery.
        delivery_receipt: 'widget-agent-reply.store.ts local admission receipt',
        read_receipt: null,
        token_lifecycle: null,
        reconnect: 'embed script; no credential to expire',
        rate_limits: 'outbound-queue.service.ts + widget admission',
        multi_account: 'widget_configs per site',
    }),
});

/** Claimed for every self-service channel, with one place that decides each. */
const UNIVERSAL: Readonly<Partial<Record<ChannelCapability, string>>> = Object.freeze({
    handoff: 'handoff.service.ts with one effect row per destination (agent_handoff_effects)',
    privacy_erasure: 'compliance.service.ts reaches outbox, turn ledger, widget replies and memory',
    agent_per_connection: 'persona.getPersonaForChannel(tenantId, channelType, accountId)',
});

function cell(capability: ChannelCapability, state: AgentOperationalState,
    basis: CapabilityBasis, evidence: string,
    proof: ChannelCapabilityProof | null = null): ChannelCapabilityCell {
    return Object.freeze({ capability, state, basis, evidence, proof });
}

export function buildChannelCertificationMatrix(input: ChannelCertificationInput): readonly ChannelCertification[] {
    const selfService = new Set<string>(CERTIFIED_SELF_SERVICE_CHANNELS as readonly string[]);
    const channels: string[] = [...CERTIFIED_SELF_SERVICE_CHANNELS, ...Object.keys(RETAINED_SCOPE)].sort();

    return Object.freeze(channels.map(channelType => {
        const retainedScope = RETAINED_SCOPE[channelType] ?? null;
        if (!selfService.has(channelType)) {
            // Out of scope is not a gap and not a certificate. It reports one
            // sentence and no capability at all, so nothing can be read off a
            // row of ticks that were never claimed.
            return Object.freeze({
                channelType, selfService: false, retainedScope,
                state: 'pending' as AgentOperationalState,
                capabilities: Object.freeze(CHANNEL_CAPABILITIES.map(capability =>
                    cell(capability, 'pending', 'out_of_scope', retainedScope ?? 'not a self-service channel'))),
                pending: Object.freeze([]),
                untested: Object.freeze([]),
                unproven: Object.freeze([]),
                // Out of scope is not certified either. Nothing was claimed, so
                // nothing is granted.
                certified: false,
            });
        }

        const declared = DECLARED[channelType] ?? {};
        const capabilities: ChannelCapabilityCell[] = [];
        const add = (capability: ChannelCapability, derived: boolean, evidence: string) => {
            capabilities.push(cell(capability, derived ? 'operating' : 'pending', 'derived', evidence));
        };

        add('inbound', input.inboundChannels.includes(channelType),
            'channel gateway adapter registry');
        const localAdmission = input.localAdmissionChannels.includes(channelType);
        add('outbound_text', input.strictTransports.includes(channelType) || localAdmission,
            localAdmission ? 'local admission; no provider to accept the message'
                : 'StrictDispatchTransport on the channel adapter');
        add('durable_dispatch', input.durableDispatchChannels.includes(channelType) || localAdmission,
            localAdmission ? 'widget agent reply store admits and records in one transaction'
                : 'DispatchRolloutService migrated-channel registry');
        add('delivery_receipt', input.deliveryStatusProducers.includes(channelType),
            'producer feeding applyDispatchProviderStatus');
        add('read_receipt', input.readStatusProducers.includes(channelType),
            'producer feeding applyDispatchProviderStatus');

        for (const capability of ['outbound_media', 'payment_link', 'flow', 'token_lifecycle',
            'reconnect', 'rate_limits', 'multi_account'] as const) {
            const evidence = declared[capability];
            if (evidence === null) {
                capabilities.push(cell(capability, 'pending', 'out_of_scope',
                    `${channelType} does not offer this`));
                continue;
            }
            capabilities.push(cell(capability, evidence ? 'prepared' : 'pending', 'declared',
                evidence ?? 'nothing declared'));
        }
        for (const [capability, evidence] of Object.entries(UNIVERSAL)) {
            capabilities.push(cell(capability as ChannelCapability, 'prepared', 'declared', evidence));
        }

        const ordered = CHANNEL_CAPABILITIES
            .map(capability => capabilities.find(entry => entry.capability === capability)!)
            .filter(Boolean);
        // Out-of-scope cells do not drag the channel down: a Telegram without
        // Flow is not a Telegram with a gap.
        const inScope = ordered.filter(entry => entry.basis !== 'out_of_scope');
        const pending = inScope.filter(entry => entry.state === 'pending');
        const untested = inScope.filter(entry => entry.state === 'prepared');
        const unproven = inScope.filter(entry => entry.state === 'operating' && !entry.proof);
        return Object.freeze({
            channelType, selfService: true, retainedScope: null,
            state: rollUpOperationalState(inScope.map(entry => entry.state)),
            capabilities: Object.freeze(ordered),
            pending: Object.freeze(pending.map(entry => entry.capability)),
            untested: Object.freeze(untested.map(entry => entry.capability)),
            unproven: Object.freeze(unproven.map(entry => entry.capability)),
            // Three conditions, all of them required. Anything less is a claim.
            certified: inScope.length > 0 && !pending.length && !untested.length && !unproven.length,
        });
    }));
}

/**
 * Four different questions, which `complete` used to answer as if they were one.
 *
 * It counted a row with nothing in state `pending`, and a merely DECLARED
 * capability is not `pending` — it is `prepared`. So a channel whose media,
 * payment link, flow, token lifecycle, reconnect, rate limits, multi-account,
 * handoff, privacy erasure and agent-per-connection had never been operated
 * counted as complete on the strength of five derived cells. The row's own state
 * said `prepared` at the same time, which is how the disagreement was visible
 * and still not caught.
 */
export interface ChannelCertificationSummary {
    readonly channels: number;
    readonly selfService: number;
    readonly retained: number;
    /** Nothing left unimplemented in scope. Says nothing about it working. */
    readonly implemented: number;
    /** Every in-scope capability observed working. Still not a certificate. */
    readonly operating: number;
    /** Operating AND proven by an executed run. The only one that certifies. */
    readonly certified: number;
    readonly pendingByCapability: Readonly<Record<string, readonly string[]>>;
    /** Declared but never operated — the work a test closes, not code. */
    readonly untestedByCapability: Readonly<Record<string, readonly string[]>>;
    /** Operating with no run recorded against it. */
    readonly unprovenByCapability: Readonly<Record<string, readonly string[]>>;
}

export function summariseChannelCertification(
    rows: readonly ChannelCertification[] = [],
): ChannelCertificationSummary {
    const byCapability = (pick: (row: ChannelCertification) => readonly ChannelCapability[]) => {
        const index: Record<string, string[]> = {};
        for (const row of rows.filter(entry => entry.selfService)) {
            for (const capability of pick(row)) (index[capability] ??= []).push(row.channelType);
        }
        return Object.freeze(Object.fromEntries(
            Object.entries(index).map(([key, value]) => [key, Object.freeze(value.sort())])));
    };
    const selfService = rows.filter(row => row.selfService);
    return Object.freeze({
        channels: rows.length,
        selfService: selfService.length,
        retained: rows.filter(row => !row.selfService).length,
        implemented: selfService.filter(row => !row.pending.length).length,
        operating: selfService.filter(row => !row.pending.length && !row.untested.length).length,
        certified: selfService.filter(row => row.certified).length,
        pendingByCapability: byCapability(row => row.pending),
        untestedByCapability: byCapability(row => row.untested),
        unprovenByCapability: byCapability(row => row.unproven),
    });
}

export type { ChannelType };
