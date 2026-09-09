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

export interface ChannelCapabilityCell {
    readonly capability: ChannelCapability;
    readonly state: AgentOperationalState;
    readonly basis: CapabilityBasis;
    /** A file, a constant, a pilot — whatever a reader has to go and look at. */
    readonly evidence: string;
}

export interface ChannelCertification {
    readonly channelType: string;
    readonly selfService: boolean;
    /** What this channel is for, when it is not a conversational surface. */
    readonly retainedScope: string | null;
    readonly state: AgentOperationalState;
    readonly capabilities: readonly ChannelCapabilityCell[];
    /** Capabilities still waiting on something. Empty is the only clean answer. */
    readonly pending: readonly ChannelCapability[];
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
    basis: CapabilityBasis, evidence: string): ChannelCapabilityCell {
    return Object.freeze({ capability, state, basis, evidence });
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
        return Object.freeze({
            channelType, selfService: true, retainedScope: null,
            state: rollUpOperationalState(inScope.map(entry => entry.state)),
            capabilities: Object.freeze(ordered),
            pending: Object.freeze(inScope.filter(entry => entry.state === 'pending').map(entry => entry.capability)),
        });
    }));
}

export interface ChannelCertificationSummary {
    readonly channels: number;
    readonly selfService: number;
    readonly retained: number;
    /** Self-service channels with nothing pending in scope. */
    readonly complete: number;
    readonly pendingByCapability: Readonly<Record<string, readonly string[]>>;
}

export function summariseChannelCertification(
    rows: readonly ChannelCertification[] = [],
): ChannelCertificationSummary {
    const pendingByCapability: Record<string, string[]> = {};
    for (const row of rows.filter(entry => entry.selfService)) {
        for (const capability of row.pending) {
            (pendingByCapability[capability] ??= []).push(row.channelType);
        }
    }
    return Object.freeze({
        channels: rows.length,
        selfService: rows.filter(row => row.selfService).length,
        retained: rows.filter(row => !row.selfService).length,
        complete: rows.filter(row => row.selfService && !row.pending.length).length,
        pendingByCapability: Object.freeze(Object.fromEntries(
            Object.entries(pendingByCapability).map(([key, value]) => [key, Object.freeze(value.sort())]))),
    });
}

export type { ChannelType };
