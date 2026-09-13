/**
 * Every producer of an external effect, and what is actually true about each.
 *
 * The durable outbox, the approval effects table, the operational notice outbox
 * and the handoff effects table each hold six properties for the traffic that
 * passes through them: who authorised the attempt, what stops a second one, what
 * came back, what happens when nothing came back, what erasure removes, and what
 * brings a lost attempt back. Several producers were migrated onto those rails.
 * Most were not — and there was no single place saying which is which, so
 * "every external producer is covered" was a claim nobody could check and a
 * producer added next month joined the uncovered set in silence.
 *
 * This file is that place. Two rules make it worth having:
 *
 *   - It records what is true TODAY, never what is planned. `none` with a
 *     reason is the most useful cell in the table; an inventory that flatters
 *     the code is worse than no inventory, because it converts an unknown gap
 *     into a false assurance.
 *   - It is checked. `external-effect-inventory.spec.ts` derives the set of
 *     message producers mechanically from the source tree — every file that
 *     reaches an egress primitive must be claimed here — so a new producer
 *     fails a test instead of shipping uninventoried. The half that cannot be
 *     derived (third-party writes, each speaking its own SDK) is declared, and
 *     the spec says so out loud and pins every entry to a file and a symbol.
 *
 * It is deliberately not a scorecard. Nothing here decides whether a producer
 * may run; the code that runs is the authority, and this describes it.
 */

/** The six questions a producer of an external effect has to be able to answer. */
export const EFFECT_PROPERTIES = [
    /** What grants ONE concrete attempt, and commits before the request goes out. */
    'authority',
    /** What stops the same effect from happening twice. */
    'idempotency',
    /** What the provider gave back, and where it is kept. */
    'receipt',
    /** What happens when no answer arrives and the effect may or may not have occurred. */
    'uncertainOutcome',
    /** What a right-to-erasure request removes from this producer's records. */
    'erasure',
    /** What brings back an effect whose job was lost or never published. */
    'recovery',
] as const;
export type EffectProperty = (typeof EFFECT_PROPERTIES)[number];

/**
 * How well one property is held.
 *
 * `partial` is not a polite `durable`. It means a mechanism exists and a named
 * case escapes it — a dedupe that degrades under load, a receipt kept for one
 * of two transports, a recovery that republishes but cannot tell a lost attempt
 * from a completed one. The note has to say which case.
 */
export const COVERAGE_LEVELS = ['durable', 'partial', 'none', 'not_applicable'] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

/**
 * `not_applicable` exists because `none` was answering two opposite questions.
 *
 * For `erasure` it meant both "this producer holds personal data and nothing
 * erases it" — a gap — and "this operation carries no contact data at all", for
 * a token rotation or a template creation. Those rows were then SUMMED, so the
 * October erasure counter rose when somebody added a producer that could not
 * possibly need erasing, and an operator reading it could not tell which half
 * of the number was work.
 *
 * A producer may only claim `not_applicable` when its `reach.personalData` is
 * false, and the spec enforces that pairing. It is a statement about the
 * effect's content, not about the effort anybody has spent on it.
 */
export const isGap = (coverage: EffectCoverage): boolean =>
    coverage.level === 'none' || coverage.level === 'partial';

/** A property that genuinely has nothing to answer, as opposed to answering badly. */
export const isNotApplicable = (coverage: EffectCoverage): boolean =>
    coverage.level === 'not_applicable';

/**
 * The exit doors. A producer's lane is what decides most of its six answers, so
 * the lane is named rather than repeated per entry.
 */
export const EGRESS_LANES = [
    /** `agent_dispatch_outbox` row → `outbound-messages` job `dispatch`. */
    'dispatch_outbox',
    /** `tool_approval_effects` row → `outbound-messages` job `approved-effect`. */
    'approved_effect',
    /** `operational_notice_outbox` row → `outbound-messages` job `operationalNotice`. */
    'operational_notice',
    /** `agent_handoff_effects` row per destination, admitted and settled in place. */
    'handoff_effects',
    /** `OutboundQueueService.enqueue` → `outbound-messages` job `send`. Redis is the record. */
    'outbound_queue',
    /** A module's own BullMQ queue, with its own retry policy and no shared record. */
    'domain_queue',
    /** No queue and no row: an HTTP call on the request, cron or listener path. */
    'inline',
] as const;
export type EgressLane = (typeof EGRESS_LANES)[number];

export const PRODUCER_STATUSES = [
    /** Reachable in production today. */
    'live',
    /** Built and reachable only behind a switch that is off by default. */
    'pilot_gated',
    /** Wired, but a runtime kill switch refuses every attempt as things stand. */
    'off',
    /** Retained code for a product decision that was reversed. Not offered. */
    'legacy',
    /** Runs, but never reaches a customer: staff, operators, or our own systems. */
    'internal_only',
] as const;
export type ProducerStatus = (typeof PRODUCER_STATUSES)[number];

/**
 * Where an entry's facts come from.
 *
 * `census` entries are pinned to a mechanical sweep of the source tree: the spec
 * derives the set of files that reach a messaging egress primitive and fails if
 * one is unclaimed. `declared` entries cannot be derived — a Google Calendar
 * write and a Wompi charge share no primitive to sweep for — so they are hand
 * written, and the spec pins each to a file and a symbol that must still exist.
 */
export const PRODUCER_DERIVATIONS = ['census', 'declared'] as const;
export type ProducerDerivation = (typeof PRODUCER_DERIVATIONS)[number];

/**
 * ═══ WHAT KIND OF EFFECT THIS IS ═══
 *
 * The October rows M1 and M5 are about WhatsApp: what Meta can bill the
 * tenant's WABA for, and what a right-to-erasure request has to reach. They
 * used to select their producers with a regular expression over the `source`
 * and `egress` STRINGS:
 *
 *     /whatsapp|instagram|messenger|telegram|dispatch|outbound|channel|notice/i
 *
 * which is a question about spelling. It swept in twenty-seven producers, and
 * nine of them are not messages to a customer at all: internal platform alerts,
 * coupon alerts, the email channel's inbound reply, the retired conversational
 * SMS adapter, connecting and testing a channel, creating a WhatsApp template,
 * writing the business profile, and rotating a token. It simultaneously MISSED
 * producers that do reach a customer because their file happened not to contain
 * one of those words.
 *
 * So a counter about customer messages was moved by a calendar integration's
 * file name, and closing the row would have required work on things the row was
 * never about. This replaces the spelling question with a declared, exhaustive
 * classification that the type system requires of every producer.
 */
export const EFFECT_CLASSES = [
    /** Reaches a person who is the TENANT'S CUSTOMER, in a conversation or a notice. */
    'customer_message',
    /** Reaches a person who works for the tenant: an agent, an owner, staff. */
    'operator_notification',
    /** Reaches US — the platform's own operators. Never a tenant, never a customer. */
    'platform_notification',
    /** Publishes where anybody can read it, under the tenant's name. */
    'public_content',
    /** Configures an account or an asset at a provider. Sends nobody a message. */
    'provider_configuration',
    /** Mints, rotates or revokes a credential. Carries no message and no contact. */
    'credential_lifecycle',
    /** Moves money or writes a fiscal record. */
    'commercial_write',
    /** Reads or writes a system the tenant connected: calendar, CRM, commerce, webhook. */
    'domain_integration',
] as const;
export type EffectClass = (typeof EFFECT_CLASSES)[number];

/** Who is on the other end. Separate from the class: a class can have one audience. */
export const EFFECT_AUDIENCES = [
    'contact', 'tenant_operator', 'platform_operator', 'provider', 'public',
] as const;
export type EffectAudience = (typeof EFFECT_AUDIENCES)[number];

/**
 * The transports an effect can actually leave on.
 *
 * Declared rather than inferred, because the same producer reaches different
 * channels depending on the connection — and it is the presence of `whatsapp`
 * that decides whether Meta can charge for the delivery.
 */
export const EFFECT_CHANNELS = [
    'whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget',
    'email', 'sms', 'push', 'slack', 'webhook', 'provider_api', 'none',
] as const;
export type EffectChannel = (typeof EFFECT_CHANNELS)[number];

export interface EffectReach {
    readonly class: EffectClass;
    readonly audience: EffectAudience;
    /** Every channel this producer can leave on. `none` for a pure API call. */
    readonly channels: readonly EffectChannel[];
    /**
     * Does what leaves carry data about an identified person?
     *
     * Decides whether `erasure: not_applicable` is honest. A token rotation
     * carries none; a booking confirmation carries a name, a phone and a time.
     */
    readonly personalData: boolean;
}

/**
 * Can Meta bill the tenant's WABA for this delivery?
 *
 * DERIVED, not declared, so it cannot drift from the channel list. From 1 Oct
 * 2026 Meta charges per delivered WhatsApp service message; Instagram and
 * Messenger remain free, which is why reaching them is not enough.
 */
export const META_BILLED_CHANNELS: readonly string[] = Object.freeze(['whatsapp']);

export const metaBillsDelivery = (reach: EffectReach): boolean =>
    reach.channels.some(channel => META_BILLED_CHANNELS.includes(channel));

/**
 * Does Meta bill a delivery on this channel?
 *
 * For callers that hold a channel and not a reach — a lane deciding whether
 * an inline POST is allowed to cost the tenant money. It reads the SAME list,
 * so "which channel costs money" cannot be answered two ways.
 */
export const metaBillsChannel = (channelType: string): boolean =>
    META_BILLED_CHANNELS.includes(channelType);

/**
 * The producers the October WhatsApp rows are actually about.
 *
 * A message to the tenant's customer that can leave over WhatsApp. Everything
 * else keeps its own contract and its own counter — excluded from M1/M5, never
 * dropped from the inventory.
 */
export const isMetaBillableCustomerMessage = (producer: ExternalEffectProducer): boolean =>
    producer.reach.class === 'customer_message' && metaBillsDelivery(producer.reach);

export interface EffectCoverage {
    readonly level: CoverageLevel;
    /** What is actually true. For `none`, why — never what is planned instead. */
    readonly note: string;
}

export interface ExternalEffectProducer {
    readonly id: string;
    /** What reaches the outside world, and who receives it. */
    readonly effect: string;
    readonly lane: EgressLane;
    readonly status: ProducerStatus;
    readonly derivation: ProducerDerivation;
    /** Path under `apps/api/src/`. The spec resolves it. */
    readonly source: string;
    /** A symbol the spec looks for inside `source`, so a rename fails here too. */
    readonly symbol: string;
    /** Where the effect actually leaves the process, for a reader to go and look. */
    readonly egress: string;
    /**
     * What kind of effect this is, who receives it and on what.
     *
     * REQUIRED, so a producer cannot be added without being classified and
     * cannot quietly fall into or out of a counter. The spec pins each field:
     * changing a lane, a channel, a class or the personal-data answer turns the
     * closure red rather than moving a number silently.
     */
    readonly reach: EffectReach;
    readonly properties: Readonly<Record<EffectProperty, EffectCoverage>>;
}

const cover = (level: CoverageLevel, note: string): EffectCoverage => Object.freeze({ level, note });
const durable = (note: string) => cover('durable', note);
const partial = (note: string) => cover('partial', note);
const none = (note: string) => cover('none', note);
/** Only legitimate where `reach.personalData` is false. The spec enforces it. */
const notApplicable = (note: string) => cover('not_applicable', note);

function producer(entry: Omit<ExternalEffectProducer, 'properties'> & {
    properties: Record<EffectProperty, EffectCoverage>;
}): ExternalEffectProducer {
    return Object.freeze({ ...entry, properties: Object.freeze({ ...entry.properties }) });
}

// ---------------------------------------------------------------------------
// The rails. Written once because a lane decides most of what its traffic can
// answer, and repeating the sentences per producer is how they drift apart.
// ---------------------------------------------------------------------------

/** `agent_dispatch_outbox`: the row is the record, the lease is the permission. */
const DISPATCH_OUTBOX_PROPERTIES: Record<EffectProperty, EffectCoverage> = {
    authority: durable('`admitDispatch` grants ONE attempt on the caller transaction, '
        + 'increments `attempts` and commits before the provider is called'),
    idempotency: durable('UNIQUE (inbound_message_id, item_index); a terminal row is never re-admitted; '
        + 'the BullMQ job id is deterministic and the row survives losing it'),
    receipt: durable('`settleDispatch` stores the provider id in `agent_dispatch_outbox.receipt`; '
        + 'provider status webhooks resolve back through it into `messages.status`'),
    uncertainOutcome: durable('a lapsed lease becomes `reconciliation_required` and never available again; '
        + '`resolveDispatchReconciliation` demands a named actor and written evidence'),
    erasure: durable('`redactDispatchOutbox` clears payload, recipient and binding on the '
        + 'caller privacy transaction; the row identity survives so a recovered job still stops'),
    recovery: durable('`DispatchRecoveryService.recoverPending` republishes pending rows every two '
        + 'minutes and retires lapsed permissions'),
};

/** `tool_approval_effects`: the same shape, for what a person approved. */
const APPROVED_EFFECT_PROPERTIES: Record<EffectProperty, EffectCoverage> = {
    authority: durable('a 120s `lease_token` claimed before provider work, plus '
        + '`assertServedAgentConnectionAuthority` and a `revisionHash` of the approval scope'),
    idempotency: durable('deterministic job id `approval-effect-{ticketId}-{effectId}`, `attempts < 5`, '
        + 'terminal states short-circuit, and the widget copy carries `dedupeId approval:{effectId}`'),
    receipt: durable('a provider id is required — `approval_effect_provider_no_receipt` refuses to '
        + 'record `sent` without one'),
    uncertainOutcome: durable('an attempt that started and then failed settles '
        + '`reconciliation_required`, never retried; only a preflight failure retries'),
    erasure: durable('every load excludes contacts in `customer_memory_erasure`, and the whole '
        + 'delivery runs under the shared `agent-privacy:{schema}` fence'),
    recovery: durable('`ToolApprovalEffectsService.recoverTenant` retires expired leases and '
        + 're-schedules eligible effects'),
};

/** `operational_notice_outbox`: enqueued inside the business transaction. */
const OPERATIONAL_NOTICE_PROPERTIES: Record<EffectProperty, EffectCoverage> = {
    authority: durable('a 120s lease claimed before the send, in the transaction that reads the '
        + 'canonical rows the notice describes'),
    idempotency: durable('UNIQUE `event_key` = kind:entityId:revision, written in the SAME transaction '
        + 'as the payment confirmation or waitlist promotion that justifies it'),
    receipt: durable('`provider_reference` on the notice row'),
    uncertainOutcome: durable('a lapsed lease becomes `reconciliation_required`; '
        + '`OperationalNoticeReviewService` records a person\'s decision and cannot resend'),
    erasure: durable('`eraseOperationalContactNotices`; `operationalContactWasErased` is re-checked '
        + 'before hydrating a notice'),
    recovery: durable('`OperationalNoticeService.recoverCron` every minute'),
};

/** `agent_handoff_effects`: one row per destination of one transfer. */
const HANDOFF_EFFECT_PROPERTIES: Record<EffectProperty, EffectCoverage> = {
    authority: durable('`admitHandoffEffect` grants one attempt per (receipt, destination) and '
        + 'commits before the destination is touched'),
    idempotency: durable('UNIQUE (receipt_id, destination); a resumed transfer cannot re-announce '
        + 'itself to the destinations that already accepted'),
    receipt: partial('the row stores whatever the destination returned — an agent id, an SMTP id. '
        + 'For the five announcement destinations that is the event emitter completing, not the '
        + 'provider accepting: the listener\'s own POST has no receipt of its own'),
    uncertainOutcome: durable('a lapsed lease becomes `unknown` and waits for a person; it never '
        + 'becomes available again'),
    erasure: durable('the table stores a destination and a receipt, never contact data, so there is '
        + 'nothing about the customer to erase'),
    recovery: durable('`expireHandoffEffectLeases`, and `executeHandoffOnce` resumes an interrupted '
        + 'transfer phase by phase'),
};

/**
 * `OutboundQueueService.enqueue`: the path most producers still take.
 *
 * Redis is the whole record. The job carries the recipient and the words; a
 * lost acknowledgement makes two jobs; the only thing between a re-run job and a
 * second delivery is a marker written AFTER the provider answered. Producers on
 * this lane inherit these answers and then differ only in whether they pass a
 * `dedupeId`, which is why that one property is stated per producer.
 */
const OUTBOUND_QUEUE_PROPERTIES: Omit<Record<EffectProperty, EffectCoverage>, 'idempotency'> = {
    authority: none('no admission and no attempt record. Entitlement and rate limit are re-checked in '
        + 'the worker, but nothing durable says an attempt was permitted, so a re-run cannot tell '
        + 'that one already happened'),
    receipt: partial('the provider id lives only in the Redis marker `outbound:sent:{jobId}` for 24h '
        + 'and in the worker log. No row holds it, so a provider status webhook has nothing to match'),
    uncertainOutcome: none('`ChannelGatewayService.sendMessage` catches everything and returns null, so a '
        + 'timeout after the provider acted is indistinguishable from a rejection — and BullMQ retries it'),
    erasure: none('a queued job is a Redis payload outside the tenant schema. GDPR erasure redacts '
        + '`messages` and the durable outbox; it cannot reach a job already holding the words'),
    recovery: partial('BullMQ retries three times with exponential backoff. If the job is evicted or the '
        + 'enqueue never committed there is nothing to recover from — no row records the intent'),
};

const queued = (idempotency: EffectCoverage): Record<EffectProperty, EffectCoverage> =>
    ({ ...OUTBOUND_QUEUE_PROPERTIES, idempotency });

/** Every answer is "nothing". Used where that is genuinely the whole truth. */
const uncovered = (reason: string): Record<EffectProperty, EffectCoverage> => ({
    authority: none(reason),
    idempotency: none(reason),
    receipt: none(reason),
    uncertainOutcome: none(reason),
    erasure: none(reason),
    recovery: none(reason),
});

/**
 * The same five gaps, for an effect that carries no data about a person.
 *
 * `uncovered` answered `erasure: none` for every producer, which reads as
 * "personal data with nothing to erase it" -- and the October counter summed
 * those rows together with the real ones. A token rotation and a template
 * creation have nothing to erase; saying so is not a lower standard, it is a
 * different question. Only legitimate where `reach.personalData` is false, and
 * the spec fails if the two disagree.
 */
const uncoveredWithoutPersonalData = (reason: string): Record<EffectProperty, EffectCoverage> => ({
    ...uncovered(reason),
    erasure: notApplicable('nothing personal leaves here: ' + reason),
});

const INLINE_EMAIL = '`EmailService.send` returns a boolean, swallows the SMTP error and discards '
    + '`info.messageId` (email.service.ts)';

// ---------------------------------------------------------------------------
// The inventory.
// ---------------------------------------------------------------------------

export const EXTERNAL_EFFECT_PRODUCERS: readonly ExternalEffectProducer[] = Object.freeze([

    // -- The model's own reply -------------------------------------------------

    producer({
        id: 'agent.reply.durable',
        effect: 'The AI turn\'s reply to the customer — text bubbles, media with captions, the '
            + 'canonical payment link and a WhatsApp Flow, one outbox row per remote effect',
        lane: 'dispatch_outbox',
        // The only production lane for an AI reply. Provider certification is
        // still a release gate, but it cannot reopen an undurable fallback.
        status: 'live',
        derivation: 'census',
        source: 'modules/conversations/conversations.service.ts',
        symbol: 'dispatchReplyThroughOutbox',
        egress: 'OutboundQueueProcessor.processDispatch → StrictDispatchTransport.sendStrict',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram'],
        },
        properties: DISPATCH_OUTBOX_PROPERTIES,
    }),

    // -- People -----------------------------------------------------------------

    producer({
        id: 'human.agent.reply',
        effect: 'A human agent\'s reply typed in the console or the mobile inbox, on a channel that '
            + 'HAS a strict transport — WhatsApp, Instagram, Messenger, Telegram',
        lane: 'dispatch_outbox',
        status: 'live',
        derivation: 'census',
        source: 'modules/agent-console/agent-console.service.ts',
        symbol: 'replyThroughOutbox',
        egress: 'ProactiveDispatchService.send commits an `agent_dispatch_outbox` row, which the '
            + 'outbound processor leases and sends through the strict transport — REST '
            + 'POST /agent-console/conversation/:tenantId/:conversationId/message and the WebSocket '
            + 'event `conversation:send`',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram'],
        },
        properties: {
            authority: durable('`human_operator`, minted by `operatorAuthority` and revalidated inside '
                + 'the lease transaction: the person must still be active, still hold a sending role, '
                + 'still belong to this tenant, and the connection must still be this tenant\'s and '
                + 'live'),
            idempotency: durable('`originKey` is `agent_console:<conversation>:<press>`, and every '
                + 'shipped console supplies one opaque key per press. The dashboard reuses it for its '
                + 'failed-send retry; the mobile offline outbox persists the same key and passes it '
                + 'on both the first request and every replay, so a request whose answer never arrived '
                + 'adopts the row that already exists instead of sending another billed message'),
            receipt: durable('the committed row carries the provider message id the transport '
                + 'returned, and the `messages` row is settled from the same outcome'),
            uncertainOutcome: durable('a strict transport distinguishes refused from unconfirmed, and '
                + 'an unconfirmed attempt leaves the row in a state no second POST is authorised from'),
            erasure: durable('contact erasure invokes `redactDispatchOutbox` in the same tenant '
                + 'transaction that writes the tombstone; it clears recipient, payload, connection '
                + 'binding and learning footprint immediately, whether the row is pending, leased or '
                + 'settled, while the paired `messages` row is redacted too'),
            recovery: durable('the row survives a restart and is retried from its own payload rather '
                + 'than from a person typing it again'),
        },
    }),

    producer({
        id: 'human.agent.reply.widget',
        effect: 'The same human reply when the conversation is a Web Chat widget session',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/agent-console/agent-console.service.ts',
        symbol: 'widgetMessages',
        egress: 'WidgetMessageStore.persist — a local admission, with no provider to accept it',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['web_widget'],
        },
        properties: {
            authority: durable('the widget has no third party: persisting the row IS the delivery, '
                + 'committed in one transaction'),
            idempotency: partial('`WidgetMessageStore` takes a `dedupeId`, but this caller passes '
                + '`agent: + randomUUID()`, which is unique per call — it dedupes a retry of the store, '
                + 'never a repeat of the human action'),
            receipt: durable('the stored message id is the receipt; there is no provider id to want'),
            uncertainOutcome: durable('no remote boundary, so no uncertain outcome exists'),
            erasure: durable('`redactWidgetAgentReplies` and `eraseWidgetContactSessions` are reached '
                + 'by `ComplianceService.eraseContactData`'),
            recovery: durable('the commit either happened or it did not; the caller sees the error'),
        },
    }),

    producer({
        id: 'human.approval.effect',
        effect: 'An effect a person approved before it could run — a payment link, media, or a handoff '
            + 'produced by a tool that required approval',
        lane: 'approved_effect',
        status: 'live',
        derivation: 'census',
        source: 'modules/conversations/tool-approval-effects.service.ts',
        symbol: 'ToolApprovalEffectsService',
        egress: 'OutboundQueueService.enqueueApprovedEffect → OutboundQueueProcessor → '
            + 'ChannelGatewayService.sendMessage, or WidgetMessageStore for the widget',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: APPROVED_EFFECT_PROPERTIES,
    }),

    producer({
        id: 'human.whatsapp.manual_send',
        effect: 'A tenant admin or agent sending a WhatsApp template, text, interactive message, media '
            + 'or location straight from the dashboard',
        lane: 'dispatch_outbox',
        status: 'live',
        derivation: 'census',
        source: 'modules/whatsapp/whatsapp.controller.ts',
        symbol: 'dispatchRest',
        egress: 'OutboundQueueProcessor.processDispatch -> StrictDispatchTransport.sendStrict, through the durable row `dispatchRest` commits'
            + 'WhatsApp route, sharing nothing with the outbound queue',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp'],
        },
        properties: DISPATCH_OUTBOX_PROPERTIES,
    }),

    producer({
        id: 'human.channel.connection_test',
        effect: 'The test message a tenant sends to itself when connecting a Telegram bot or an SMS '
            + 'number, to prove the credential works',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/channels/channel-management.controller.ts',
        symbol: 'sendTextMessage',
        egress: 'TelegramAdapter.sendTextMessage / SmsAdapter.sendTextMessage, called directly',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: false,
            channels: ['telegram', 'sms'],
        },
        properties: uncoveredWithoutPersonalData('a connection test is one deliberate message to the operator who asked '
            + 'for it. It is inline on purpose and carries no record — repeating it is what the button '
            + 'is for, and there is no customer on the other end'),
    }),

    producer({
        id: 'human.email_template.test_send',
        effect: 'The "send a test" button on a tenant\'s email templates, and every rendered template '
            + 'send other producers reach through it',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/email-templates/email-templates.service.ts',
        symbol: 'renderAndPrepare',
        egress: 'EmailService.send, or the bounded transport `renderAndPrepare` returns',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: false,
            channels: ['email'],
        },
        properties: {
            authority: partial('`renderAndPrepare` returns an attempt the CALLER may fence — the handoff '
                + 'does exactly that. `renderAndSend` and `sendTest` do not, and send inline'),
            idempotency: none('none of its own; whatever the caller brings'),
            receipt: partial('the bounded transport returns the SMTP id to the caller, and the handoff '
                + 'stores it. `renderAndSend` and `sendTest` return a boolean'),
            uncertainOutcome: partial('`sendBoundedSmtp` has a 25s deadline and throws a classified '
                + 'error, which is what lets the handoff record `unknown`. The boolean path cannot '
                + 'distinguish an unconfigured transport from a server that accepted and died'),
            erasure: notApplicable('nothing records what was sent to whom'),
            recovery: none('no record of the attempt, so a rendered template lost to an SMTP outage is '
                + 'never sent and nobody is told'),
        },
    }),

    // -- Handoff ----------------------------------------------------------------

    producer({
        id: 'handoff.fanout',
        effect: 'A transfer to a human, announced to seven destinations: assignment, cache, inbox '
            + 'socket, CRM note, tenant webhooks, web/native push, Slack, agent SMS and agent email',
        lane: 'handoff_effects',
        status: 'live',
        derivation: 'census',
        source: 'modules/handoff/handoff.service.ts',
        symbol: 'executeHandoff',
        egress: 'one `agent_handoff_effects` row per destination; the five announcement destinations '
            + 'fan out through `eventEmitter.emitAsync(handoff.escalated.{destination})`',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['email', 'sms', 'push', 'slack'],
        },
        properties: HANDOFF_EFFECT_PROPERTIES,
    }),

    producer({
        id: 'handoff.sla_escalation.email',
        effect: 'The email telling a supervisor that a handed-off conversation has waited past its SLA',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/agent-console/agent-availability.service.ts',
        symbol: 'AgentAvailabilityService',
        egress: 'EmailService.send, from the `*/2 * * * *` escalation cron, not awaited',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['email'],
        },
        properties: {
            authority: none('fire and forget from a cron; nothing records that an attempt was made'),
            idempotency: partial('an `escalated` flag on `conversations.metadata.handoff` is set before '
                + 'the send, so the cron does not re-escalate. It says the escalation happened, not '
                + 'that the email did'),
            receipt: none(INLINE_EMAIL),
            uncertainOutcome: none('the boolean cannot distinguish a refusal from an accepted message '
                + 'whose acknowledgement was lost'),
            erasure: none('nothing records what was sent'),
            recovery: none('the flag suppresses a second attempt, so a failed escalation is never retried'),
        },
    }),

    producer({
        id: 'handoff.agent_sms',
        effect: 'An SMS to the assigned agent, or to the tenant\'s admins, when a conversation escalates',
        lane: 'inline',
        // The platform SMS kill switch (`platform_settings` key `sms.platform_enabled`) defaults
        // to false and fails closed, so nothing here reaches a carrier as things stand.
        status: 'off',
        derivation: 'census',
        source: 'modules/sms-notifications/sms-notification-listener.service.ts',
        symbol: 'onHandoff',
        egress: 'SmsSenderService.sendToNumber → SmsAdapter.sendTextMessage (the tenant\'s own Twilio)',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['sms'],
        },
        properties: {
            authority: partial('the handoff effect row for destination `sms` admits the ANNOUNCEMENT '
                + 'once. It says the listener ran, not that a carrier accepted anything'),
            idempotency: partial('same row: the transfer cannot re-announce, but the listener loops over '
                + 'several phones and a partial failure inside that loop has no identity of its own'),
            receipt: none('`SmsSenderService.sendToNumber` returns a boolean and never throws; the '
                + 'Twilio sid is discarded'),
            uncertainOutcome: none('the listener catches everything and warns, so the handoff effect row '
                + 'settles `accepted` whether or not a message went out'),
            erasure: none('nothing records the recipient or the text'),
            recovery: none('a swallowed failure is settled as success, so there is nothing to recover'),
        },
    }),

    producer({
        id: 'handoff.slack',
        effect: 'A Slack post to the tenant\'s incoming webhook on escalation, and on a new appointment',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/slack/slack-listener.service.ts',
        symbol: 'SlackListenerService',
        egress: 'SlackService.notify → axios POST to the pinned hooks.slack.com target',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['slack'],
        },
        properties: {
            authority: partial('the handoff effect row for destination `slack` admits the announcement '
                + 'once. The `appointment.created` listener has no row at all'),
            idempotency: partial('same row on the handoff path; nothing on the appointment path'),
            receipt: none('Slack\'s response is discarded'),
            uncertainOutcome: partial('the POST throws, so a handoff announcement settles `rejected` or '
                + '`unknown` correctly. The appointment path has nowhere to record either'),
            erasure: none('the message text is composed from the contact name and is not recorded here'),
            recovery: none('no retry and no record: a Slack post lost to a network blip is simply not '
                + 'made, and nobody is told'),
        },
    }),

    producer({
        id: 'handoff.push',
        effect: 'Web Push and Expo native push to agents — escalation, new inbound message, SLA '
            + 'escalation, new appointment, new and cancelled food orders, photo session requests',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/push/push-listener.service.ts',
        symbol: 'PushListenerService',
        egress: 'PushService.sendToUser / sendToTenantRole → the Expo push API and the isolated '
            + 'web-push worker',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['push'],
        },
        properties: {
            authority: partial('the handoff effect row admits the `push` announcement once. The other '
                + 'six events have no row'),
            idempotency: partial('a notification `tag` collapses duplicates in the OS tray, which is a '
                + 'display convenience, not a send guard'),
            receipt: none('the Expo ticket ids are read only to delete dead tokens; nothing is stored'),
            uncertainOutcome: none('every send is `.catch(() => {})`, so a failure and a success are '
                + 'the same outcome to the caller'),
            erasure: none('the payload names a contact and is not recorded, so there is nothing to erase '
                + 'and no way to prove there was not'),
            recovery: none('every failure is swallowed by the catch, so nothing is left to recover '
                + 'from and nothing says a notification was missed'),
        },
    }),

    producer({
        id: 'tenant.outbound_webhooks',
        effect: 'The tenant\'s own HTTPS endpoints, called with a signed payload on handoff and other '
            + 'subscribed events',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/webhooks/webhooks.service.ts',
        symbol: 'deliverWithRetry',
        egress: 'HMAC-signed POST to the tenant endpoint, after SSRF validation pins the target',
        reach: {
            class: 'domain_integration', audience: 'provider', personalData: true,
            channels: ['webhook'],
        },
        properties: {
            authority: partial('the handoff effect row admits the `webhooks` announcement once; the '
                + 'fan-out itself is fire and forget'),
            idempotency: partial('all three transport attempts reuse X-Webhook-Delivery, so a receiver '
                + 'can deduplicate a timeout retry; a later domain-event replay has no durable key'),
            receipt: durable('every attempt is written to the deliveries log with status and a slice of '
                + 'the response — the best receipt of any webhook path here'),
            uncertainOutcome: partial('a timeout is logged as a failed attempt and retried, which is the '
                + 'right default for a webhook but is recorded as failure rather than as uncertainty'),
            erasure: partial('the deliveries log holds the payload that named the contact and is not in '
                + 'the GDPR erasure fan-out'),
            recovery: partial('dispatch waits for all endpoints and each gets three attempts with '
                + 'linear backoff. Nothing survives a process restart mid-fan-out'),
        },
    }),

    producer({
        id: 'public_api.webhook_subscriptions',
        effect: 'Zapier-style hook subscriptions created through the public API',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/public-api/webhook-subscription.service.ts',
        symbol: 'WebhookSubscriptionService',
        egress: 'a single HMAC-signed POST to the subscriber URL, from an unawaited promise',
        reach: {
            class: 'domain_integration', audience: 'provider', personalData: true,
            channels: ['webhook'],
        },
        properties: {
            authority: none('the dispatch is an unawaited promise from the event path; no row records '
                + 'that an attempt was permitted or made'),
            idempotency: partial('each call carries X-Hook-Delivery and dispatch waits for its fan-out; '
                + 'the public hook still has no durable domain-event key across process replay'),
            receipt: partial('only `last_triggered_at` on the subscription is updated; the response '
                + 'status and body are discarded'),
            uncertainOutcome: none('a timeout and a refusal are the same to the caller, and neither is '
                + 'written down anywhere the tenant can see'),
            erasure: none('the payload can name a contact and is not recorded, so erasure has nothing '
                + 'to reach and no way to show that it did not'),
            recovery: none('a single attempt with no retry: an event lost to a restart is lost for good'),
        },
    }),

    // -- Scheduled and event-driven messages to customers -----------------------

    // ── A CUSTOMER EMAIL THE SWEEP COULD NOT SEE ──────────────────────
    //
    // The inventory's own sweep required a row from any file importing
    // `email/email.service`. A tenant-template email goes out through
    // `EmailTemplatesService.renderAndSend`, which imports none of that —
    // so this producer matched no pattern and was under no obligation to
    // appear here at all. It was sending a guest a name, dates and a price
    // with no inventory row, which is the one thing this file exists to
    // make impossible.
    

    // ── A CUSTOMER EMAIL THE SWEEP COULD NOT SEE ──────────────────────
    //
    // The inventory's own sweep required a row from any file importing
    // `email/email.service`. A tenant-template email goes out through
    // `EmailTemplatesService.renderAndSend`, which imports none of that —
    // so this producer matched no pattern and was under no obligation to
    // appear here at all. It was sending a guest a name, dates and a price
    // with no inventory row, which is the one thing this file exists to
    // make impossible.
producer({
        id: 'tours.booking_confirmation',
        effect: 'The email to a guest confirming a tour booking: package, departure date and time, party size and total price',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/tours/tours.service.ts',
        symbol: 'createBooking',
        egress: 'EmailTemplatesService.renderAndSend renders `tour_booking_confirmation` and hands it to '
            + 'SMTP on the caller\'s stack, after the booking transaction has committed',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            // Email only. Nothing here reaches a messaging channel, so Meta
            // bills none of it — which is why it is outside M1/M5 and still
            // a customer message carrying personal data.
            channels: ['email'],
        },
        properties: {
            authority: partial('the owner\'s `tours.emailConfirmations` switch, resolved from '
                + 'the THREAD the booking arrived on rather than from whichever active agent an '
                + 'unordered `LIMIT 1` returned, and suppressed entirely inside an isolated '
                + 'evaluation (`sandboxNamespace`) so a synthetic run cannot email a real guest. '
                + 'It is `partial` and not `durable` because no economic admission exists on this '
                + 'road: nothing bills us per delivered email, so there is no reservation to take '
                + 'and no ceiling to refuse against'),
            idempotency: partial('the booking INSERT is the only guard: one committed booking sends one email. A caller that retries after a lost acknowledgement commits a second booking and sends a second email, because nothing keys the send to anything a retry would recompute'),
            receipt: none('`renderAndSend` answers with a boolean. No provider id is kept, so '
                + 'nothing can later say which message this was or whether it arrived'),
            uncertainOutcome: none('one boolean cannot separate "the provider refused" from "no '
                + 'answer arrived". A timeout is recorded the same way as a rejection, which is '
                + 'as failed'),
            erasure: none('the body carries the guest\'s name, dates and price, and no erasure '
                + 'reaches it: once SMTP has it, it is in a mailbox this platform cannot touch, '
                + 'and this producer keeps no copy to clear either. NOT `not_applicable` — that '
                + 'level is a statement about the CONTENT, and personal data left the building. '
                + 'The booking row it derives from is erased by its own vertical\'s fan-out, '
                + 'which is a different row from the message'),
            recovery: none('fire-and-forget inside a `try` that warns. A crash between the '
                + 'commit and the send loses the confirmation with no row anywhere saying it was '
                + 'owed'),
        },
    }),

    producer({
        id: 'vacation_rental.booking_confirmation',
        effect: 'The email to a guest confirming a stay: property, check-in and check-out, nights, total price and the check-in instructions',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/vacation-rental/properties.service.ts',
        symbol: 'createBooking',
        egress: 'EmailTemplatesService.renderAndSend renders `property_booking_confirmation` and hands it to '
            + 'SMTP on the caller\'s stack, after the booking transaction has committed',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            // Email only. Nothing here reaches a messaging channel, so Meta
            // bills none of it — which is why it is outside M1/M5 and still
            // a customer message carrying personal data.
            channels: ['email'],
        },
        properties: {
            authority: partial('the owner\'s `properties.emailConfirmations` switch, resolved from '
                + 'the THREAD the booking arrived on rather than from whichever active agent an '
                + 'unordered `LIMIT 1` returned, and suppressed entirely inside an isolated '
                + 'evaluation (`sandboxNamespace`) so a synthetic run cannot email a real guest. '
                + 'It is `partial` and not `durable` because no economic admission exists on this '
                + 'road: nothing bills us per delivered email, so there is no reservation to take '
                + 'and no ceiling to refuse against'),
            idempotency: partial('the booking INSERT is the only guard: one committed booking sends one email. A caller that retries after a lost acknowledgement commits a second booking and sends a second email, because nothing keys the send to anything a retry would recompute'),
            receipt: none('`renderAndSend` answers with a boolean. No provider id is kept, so '
                + 'nothing can later say which message this was or whether it arrived'),
            uncertainOutcome: none('one boolean cannot separate "the provider refused" from "no '
                + 'answer arrived". A timeout is recorded the same way as a rejection, which is '
                + 'as failed'),
            erasure: none('the body carries the guest\'s name, dates and price, and no erasure '
                + 'reaches it: once SMTP has it, it is in a mailbox this platform cannot touch, '
                + 'and this producer keeps no copy to clear either. NOT `not_applicable` — that '
                + 'level is a statement about the CONTENT, and personal data left the building. '
                + 'The booking row it derives from is erased by its own vertical\'s fan-out, '
                + 'which is a different row from the message'),
            recovery: none('fire-and-forget inside a `try` that warns. A crash between the '
                + 'commit and the send loses the confirmation with no row anywhere saying it was '
                + 'owed'),
        },
    }),

    // ── A CUSTOMER EMAIL THE SWEEP COULD NOT SEE ──────────────────────
    //
    // The inventory's own sweep required a row from any file importing
    // `email/email.service`. A tenant-template email goes out through
    // `EmailTemplatesService.renderAndSend`, which imports none of that —
    // so this producer matched no pattern and was under no obligation to
    // appear here at all. It was sending a guest a name, dates and a price
    // with no inventory row, which is the one thing this file exists to
    // make impossible.
    producer({
        id: 'orders.catalog_confirmation',
        effect: 'The email to a customer when a catalog order they placed is confirmed by the business',
        lane: 'inline',
        status: 'live',
        // Declared, and the distinction is mechanical rather than editorial:
        // a `census` entry is one the spec's own sweep pins, and this file no
        // longer contains an egress primitive to pin — it hands the five-step
        // decision and the send to `OperationConfirmationService`, the shared
        // road. The two booking confirmations above still call the transport
        // themselves, so they remain `census`. Claiming `census` here was
        // refused by the check that asks whether the sweep earned it, which
        // is the check doing its job: the row is real, its provenance was not.
        derivation: 'declared',
        source: 'modules/orders/catalog-order-confirmation.ts',
        symbol: 'CatalogOrderConfirmations',
        egress: 'EmailTemplatesService.renderAndSend renders `order_confirmation` and hands it to '
            + 'SMTP on the caller\'s stack, after the booking transaction has committed',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            // Email only. Nothing here reaches a messaging channel, so Meta
            // bills none of it — which is why it is outside M1/M5 and still
            // a customer message carrying personal data.
            channels: ['email'],
        },
        properties: {
            authority: partial('the owner\'s `orders.emailConfirmations` switch, resolved from '
                + 'the THREAD the booking arrived on rather than from whichever active agent an '
                + 'unordered `LIMIT 1` returned, and suppressed entirely inside an isolated '
                + 'evaluation (`sandboxNamespace`) so a synthetic run cannot email a real guest. '
                + 'It is `partial` and not `durable` because no economic admission exists on this '
                + 'road: nothing bills us per delivered email, so there is no reservation to take '
                + 'and no ceiling to refuse against'),
            idempotency: partial('keyed to the `pending → confirmed` TRANSITION and not to the order: an order already confirmed produces nothing on a replay, and a later move to `paid` produces nothing either, so one order yields at most one receipt'),
            receipt: none('`renderAndSend` answers with a boolean. No provider id is kept, so '
                + 'nothing can later say which message this was or whether it arrived'),
            uncertainOutcome: none('one boolean cannot separate "the provider refused" from "no '
                + 'answer arrived". A timeout is recorded the same way as a rejection, which is '
                + 'as failed'),
            erasure: none('the body carries the guest\'s name, dates and price, and no erasure '
                + 'reaches it: once SMTP has it, it is in a mailbox this platform cannot touch, '
                + 'and this producer keeps no copy to clear either. NOT `not_applicable` — that '
                + 'level is a statement about the CONTENT, and personal data left the building. '
                + 'The booking row it derives from is erased by its own vertical\'s fan-out, '
                + 'which is a different row from the message'),
            recovery: none('fire-and-forget inside a `try` that warns. A crash between the '
                + 'commit and the send loses the confirmation with no row anywhere saying it was '
                + 'owed'),
        },
    }),

    // One file, two lanes, and splitting the entry is the honest way to say so:
    // the confirmation was migrated and the cancellation could not be. The
    // second entry says why.
    producer({
        id: 'appointments.booking_confirmation',
        effect: 'The message to a customer when their appointment is confirmed',
        // Moved off `outbound_queue`. The sweep still finds an egress primitive
        // in this file, but it belongs to the cancellation below rather than to
        // this producer — which is why this one is `declared`.
        lane: 'dispatch_outbox',
        status: 'live',
        derivation: 'declared',
        source: 'modules/appointments/appointment-notifications.service.ts',
        symbol: 'dispatchConfirmation',
        egress: 'ProactiveDispatchService.send commits an `agent_dispatch_outbox` row with a `text` '
            + 'item; the outbound processor performs the channel call. The email copy still goes '
            + 'through EmailTemplatesService.renderAndSend inline',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: {
            authority: durable('the processor admits the row through the spend gate before the POST, '
                + 'under a `proactive_policy` authority read from the appointment row'),
            idempotency: durable('the origin is derived from the appointment id, so a replayed '
                + '`appointment.created` collides on the row that already exists instead of '
                + 'confirming the customer a second time'),
            receipt: durable('the outbox row carries the provider id and the history row it wrote in '
                + 'the same transaction'),
            uncertainOutcome: durable('a timeout leaves the row admitted with its lease; the lease '
                + 'sweep moves it to reconciliation rather than sending again'),
            erasure: durable('the outbox payload is cleared by the GDPR fan-out like every other '
                + 'dispatch row'),
            recovery: durable('the recovery pass republishes any row nothing ever published — the '
                + 'case a fire-and-forget event could not survive at all'),
        },
    }),

    producer({
        id: 'appointments.cancellation_notice',
        effect: 'The message to a customer when their appointment is cancelled',
        // Moved off `outbound_queue` once the registry gained a policy that
        // could authorise it. Nothing in this file reaches the plain queue any
        // more, so neither entry is `census`.
        lane: 'dispatch_outbox',
        status: 'live',
        derivation: 'declared',
        source: 'modules/appointments/appointment-notifications.service.ts',
        symbol: 'dispatchCancellation',
        egress: 'ProactiveDispatchService.send commits an `agent_dispatch_outbox` row with a `text` '
            + 'item; the outbound processor performs the channel call. The email copy still goes '
            + 'through EmailTemplatesService.renderAndSend inline',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: {
            authority: durable('the processor admits the row through the spend gate before the POST, '
                + 'under an `appointment_cancellation` authority — a policy of its own, because the '
                + 'confirmation\'s answers null for a cancelled appointment and would have suppressed '
                + 'every notice on the platform'),
            idempotency: durable('the origin is derived from the appointment id, so a replayed '
                + '`appointment.cancelled` collides on the row that already exists. It cannot '
                + 'collide with the confirmation\'s, which carries its own suffix'),
            receipt: durable('the outbox row carries the provider id and the history row it wrote in '
                + 'the same transaction'),
            uncertainOutcome: durable('a timeout leaves the row admitted with its lease; the lease '
                + 'sweep moves it to reconciliation rather than sending again'),
            erasure: durable('the outbox payload is cleared by the GDPR fan-out like every other '
                + 'dispatch row'),
            recovery: durable('the recovery pass republishes any row nothing ever published — the '
                + 'case a fire-and-forget event could not survive at all'),
        },
    }),

    producer({
        id: 'appointments.reminders',
        effect: '24h and 2h appointment reminders, the attendance check and the no-show follow-up, on '
            + 'WhatsApp and by email',
        // Moved off `inline`. The two WhatsApp reminders commit a durable row
        // and the processor sends it; the sweep no longer finds an egress
        // primitive in this file because there is no longer one to find, which
        // is why the derivation is `declared` rather than `census`.
        lane: 'dispatch_outbox',
        status: 'live',
        derivation: 'declared',
        source: 'modules/appointments/appointment-reminders.service.ts',
        symbol: 'AppointmentRemindersService',
        egress: 'ProactiveDispatchService.send commits an `agent_dispatch_outbox` row with a '
            + '`template` item; the outbound processor performs the Graph call. The email copy '
            + 'still goes through EmailTemplatesService.renderAndSend inline',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: {
            authority: durable('the processor admits the row through the spend gate before the POST, so '
                + 'the ceiling, the payer and the transmission right are all settled before Meta is '
                + 'called'),
            idempotency: durable('the origin is derived from the appointment and WHICH reminder, so a '
                + 'second pass before the flag is written finds the same row and publishes nothing '
                + 'new. The flag stopped being the only thing standing between one reminder and two'),
            receipt: durable('the outbox row carries the provider id and the history row it wrote in the '
                + 'same transaction'),
            uncertainOutcome: durable('a timeout leaves the row admitted with its lease; the lease sweep '
                + 'moves it to reconciliation rather than sending again'),
            erasure: durable('the outbox payload is cleared by the GDPR fan-out like every other '
                + 'dispatch row'),
            recovery: durable('the recovery pass republishes any row nothing ever published, which is '
                + 'exactly the case the cron flag could not tell from a completed one'),
        },
    }),

    producer({
        id: 'appointments.payment_notice',
        effect: 'The message telling a customer their appointment payment was confirmed, or that it is '
            + 'under review',
        lane: 'operational_notice',
        status: 'live',
        derivation: 'census',
        source: 'modules/appointments/appointment-payment.listener.ts',
        symbol: 'enqueueOperationalNotice',
        egress: 'operational_notice_outbox row written in the payment transaction',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: OPERATIONAL_NOTICE_PROPERTIES,
    }),

    producer({
        id: 'gyms.waitlist_promoted',
        effect: 'The message telling a member a class waitlist spot opened for them',
        lane: 'operational_notice',
        status: 'live',
        derivation: 'census',
        source: 'modules/gyms/gyms.service.ts',
        symbol: 'enqueueOperationalNotice',
        egress: 'operational_notice_outbox row written in the promotion transaction',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: OPERATIONAL_NOTICE_PROPERTIES,
    }),

    producer({
        id: 'education.waitlist',
        effect: 'The message telling a student they were promoted from a course waitlist, or that their '
            + 'place needs review',
        lane: 'operational_notice',
        status: 'live',
        derivation: 'census',
        source: 'modules/education/education-enrollment-commands.ts',
        symbol: 'enqueueOperationalNotice',
        egress: 'operational_notice_outbox row written in the enrolment transaction',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: OPERATIONAL_NOTICE_PROPERTIES,
    }),

    producer({
        id: 'payments.outcome_notice',
        effect: 'The message telling a customer their payment went through, sent on the provider '
            + 'webhook — or an email instead when the WhatsApp 24h window has closed',
        lane: 'dispatch_outbox',
        status: 'live',
        derivation: 'census',
        source: 'modules/conversations/payment-outcome-notifier.service.ts',
        symbol: 'notifyCustomer',
        egress: 'ProactiveDispatchService.send commits an `agent_dispatch_outbox` row with the '
            + 'payment operation as its identity and the latest inbound as its reactive cause; '
            + 'EmailService.send remains the non-Meta fallback outside the WhatsApp window',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: DISPATCH_OUTBOX_PROPERTIES,
    }),

    producer({
        id: 'automation.nurturing',
        effect: 'Nurturing follow-ups: the second and third attempt at a quiet conversation, stale '
            + 'conversation nudges and abandoned booking recovery',
        // Moved off the legacy queue. The sweep no longer finds an egress
        // primitive in this file because there is no longer one to find, which
        // is why the derivation is `declared` rather than `census`.
        lane: 'dispatch_outbox',
        status: 'live',
        derivation: 'declared',
        source: 'modules/automation/nurturing.service.ts',
        symbol: 'NurturingService',
        egress: 'ProactiveDispatchService.send commits an `agent_dispatch_outbox` row; the outbound '
            + 'processor performs the Graph call',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: {
            authority: durable('the `nurturing_followup` policy is revalidated inside the transaction '
                + 'that grants the lease, and its revision carries the time of the last INBOUND '
                + 'message — so a customer answering between preparing the nudge and sending it '
                + 'suppresses it. "¿Seguís ahí?" one minute after somebody wrote is the thing this '
                + 'producer most needed stopping'),
            idempotency: durable('the origin is derived from the conversation and which attempt this '
                + 'is, so a second cron pass finds the same row. `hasNurturingSentToday` stopped '
                + 'being the only thing between one nudge and two'),
            receipt: durable('the outbox row carries the provider id and the history row written in '
                + 'the same transaction'),
            uncertainOutcome: durable('a timeout leaves the row admitted with its lease; the sweep '
                + 'moves it to reconciliation rather than sending again'),
            erasure: durable('the outbox payload is cleared by the GDPR fan-out like every other '
                + 'dispatch row'),
            recovery: durable('the recovery pass republishes any row nothing ever published'),
        },
    }),

    producer({
        id: 'automation.drip_sequence',
        effect: 'Each step of a drip sequence a contact was enrolled in, by hand or by segment',
        // Both branches moved: the text steps off the legacy queue and the
        // template steps off the inline Graph call. One lane now, and the sweep
        // finds no egress primitive here any more.
        lane: 'dispatch_outbox',
        status: 'live',
        derivation: 'declared',
        source: 'modules/automation/drip-sequence.service.ts',
        symbol: 'DripSequenceService',
        egress: 'ProactiveDispatchService.send commits an `agent_dispatch_outbox` row with a `text` '
            + 'or `template` item; the outbound processor performs the Graph call',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: {
            authority: durable('the `drip_step` policy is revalidated inside the lease transaction. '
                + 'An enrolment that stopped, completed or was paused is GONE, so the next step of '
                + 'a journey somebody left is suppressed rather than sent'),
            idempotency: durable('the origin is derived from the enrolment and the step, so a second '
                + 'pass finds the same row and publishes nothing new'),
            receipt: durable('the outbox row carries the provider id and the history row written in '
                + 'the same transaction'),
            uncertainOutcome: durable('a timeout leaves the row admitted with its lease; the sweep '
                + 'moves it to reconciliation rather than sending again'),
            erasure: durable('the outbox payload is cleared by the GDPR fan-out like every other '
                + 'dispatch row'),
            recovery: durable('the recovery pass republishes any row nothing ever published'),
        },
    }),

    producer({
        id: 'automation.rule_template',
        effect: 'The WhatsApp template an automation rule sends when its trigger and conditions match',
        // Moved off the inline Graph call inside the `automation-jobs` queue.
        // The job still schedules the work; what it schedules now commits a row
        // before anything is sent.
        lane: 'dispatch_outbox',
        status: 'live',
        derivation: 'declared',
        source: 'modules/automation/automation-jobs.processor.ts',
        symbol: 'handleSendTemplate',
        egress: 'ProactiveDispatchService.send commits an `agent_dispatch_outbox` row with a '
            + '`template` item; the outbound processor performs the Graph call',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: {
            authority: durable('the `automation_rule_action` policy is revalidated inside the lease '
                + 'transaction. A rule somebody switched off between the trigger firing and the '
                + 'message leaving sends nothing, and its actions are hashed so editing which '
                + 'template it sends does not let the old one go out under the new rule'),
            idempotency: durable('the origin is derived from the rule execution, so a retried job '
                + 'finds the same row. The retry used to send the template again — and did, because '
                + 'every terminal write of this processor was throwing on a JSONB cast'),
            receipt: durable('the outbox row carries the provider id and the history row written in '
                + 'the same transaction'),
            uncertainOutcome: durable('a timeout leaves the row admitted with its lease; the sweep '
                + 'moves it to reconciliation rather than sending again'),
            erasure: durable('the outbox payload is cleared by the GDPR fan-out like every other '
                + 'dispatch row'),
            recovery: durable('the recovery pass republishes any row nothing ever published'),
        },
    }),

    producer({
        id: 'recall.win_back',
        effect: 'The win-back message to a contact who went quiet, from the daily recall cron or from an '
            + 'operator pressing "run now"',
        // Moved off `outbound_queue`. The sweep no longer finds an egress
        // primitive in this file because there is no longer one to find, which
        // is why the derivation is `declared` rather than `census`.
        lane: 'dispatch_outbox',
        status: 'live',
        derivation: 'declared',
        source: 'modules/recall/recall.service.ts',
        symbol: 'RecallService',
        egress: 'ProactiveDispatchService.send commits an `agent_dispatch_outbox` row with a `text` '
            + 'item; the outbound processor performs the channel call',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        },
        properties: {
            authority: durable('the processor admits the row through the spend gate before the POST, '
                + 'under a `recall_reminder` authority read from the contact row'),
            idempotency: durable('the cooldown is CLAIMED before the effect is prepared, so the cron '
                + 'and the manual trigger cannot both take the same cycle, and the origin is derived '
                + 'from the cooldown boundary that made the contact due — so a retry of that cycle '
                + 'finds the same row instead of sending a second win-back'),
            receipt: durable('the outbox row carries the provider id and the history row it wrote in '
                + 'the same transaction'),
            uncertainOutcome: durable('a timeout leaves the row admitted with its lease; the lease '
                + 'sweep moves it to reconciliation rather than sending again'),
            erasure: durable('the outbox payload is cleared by the GDPR fan-out like every other '
                + 'dispatch row'),
            recovery: durable('the recovery pass republishes any row nothing ever published, and a '
                + 'result that left nothing durable releases the claimed cooldown so the next sweep '
                + 'retries from the same boundary'),
        },
    }),

    producer({
        id: 'broadcast.campaign',
        effect: 'Every message of a campaign a tenant launched — WhatsApp template, email or SMS, one '
            + 'job per recipient',
        lane: 'dispatch_outbox',
        status: 'live',
        derivation: 'census',
        source: 'modules/broadcast/broadcast-queue.processor.ts',
        symbol: 'dispatchWhatsApp',
        egress: 'ProactiveDispatchService.send -> `agent_dispatch_outbox`; the email and SMS branches keep their own domain queue'
            + 'TenantNotificationSmsService.send from the `broadcast-messages` queue',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['whatsapp', 'email', 'sms'],
        },
        properties: DISPATCH_OUTBOX_PROPERTIES,
    }),

    producer({
        id: 'verticals.service_request',
        effect: 'The email alerting a home-services tenant to an emergency service request',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/verticals/service-request.listener.ts',
        symbol: 'ServiceRequestListener',
        egress: 'EmailService.send, fire and forget per recipient',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['email'],
        },
        properties: uncovered('an un-awaited `EmailService.send` per recipient, from an event listener. '
            + 'Nothing records the attempt, the result or the recipient'),
    }),

    // -- Identity and account email -------------------------------------------

    producer({
        id: 'auth.transactional_email',
        effect: 'Password setup and reset, email verification, the 2FA code, the new trusted device '
            + 'notice and the password-changed notice',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/auth/auth.service.ts',
        symbol: 'sendVerificationEmail',
        egress: 'EmailService.send inline, some of it not awaited',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['email'],
        },
        properties: {
            authority: none('inline in the request; nothing records an attempt'),
            idempotency: partial('the CODE is idempotent — it lives in `users.email_verify_code` or in '
                + 'Redis and only the latest one works. The EMAIL is not: asking twice sends twice'),
            receipt: none(INLINE_EMAIL),
            uncertainOutcome: none('the boolean collapses a refusal and a lost acknowledgement'),
            erasure: none('nothing records what was sent'),
            recovery: none('the user pressing "resend" is the whole recovery mechanism'),
        },
    }),

    producer({
        id: 'auth.two_factor_sms',
        effect: 'The 2FA code by SMS through the platform Twilio account',
        lane: 'inline',
        // The platform SMS kill switch defaults to false and fails closed.
        status: 'off',
        derivation: 'declared',
        source: 'modules/auth/platform-sms.service.ts',
        symbol: 'PlatformSmsService',
        egress: 'a direct Twilio REST call',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['sms'],
        },
        properties: {
            authority: none('the Twilio call happens inline inside the login request; nothing records '
                + 'that an attempt was permitted'),
            idempotency: partial('the code itself is single-use; the SMS is not deduped'),
            receipt: none('the Twilio sid is discarded'),
            uncertainOutcome: none('no distinction between refusal and lost answer'),
            erasure: none('nothing records the number or the body'),
            recovery: none('nothing records the attempt; the user pressing "send again" is the whole '
                + 'recovery mechanism'),
        },
    }),

    producer({
        id: 'customer_portal.access_code',
        effect: 'The six-digit magic-link code emailed or texted to a customer opening the portal',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/customer-portal/customer-portal.service.ts',
        symbol: 'dispatchCode',
        egress: 'EmailService.send, or the SMS adapter for the phone branch',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['email', 'sms'],
        },
        properties: {
            authority: none('inline in the public request'),
            idempotency: partial('the code lives in Redis for ten minutes with a five-attempt lock, so '
                + 'only one code is valid. Requesting again sends again'),
            receipt: none(INLINE_EMAIL),
            uncertainOutcome: none('the boolean collapses a refusal and a lost answer'),
            erasure: none('nothing records the delivery'),
            recovery: none('the customer requests another code'),
        },
    }),

    producer({
        id: 'identity.verification_code',
        effect: 'The out-of-band code sent to a customer\'s email or phone to prove who they are before '
            + 'the agent will act on their account',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/conversations/chat-identity.service.ts',
        symbol: 'startVerification',
        egress: 'EmailService.send, or TenantNotificationSmsService.send for the SMS fallback',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['email', 'sms'],
        },
        properties: {
            authority: partial('a Redis send lock is acquired before the attempt and FAILS CLOSED, which '
                + 'is the closest thing to an admission on any inline path here'),
            idempotency: partial('that same lock is what stops a second code going out; it is a lease in '
                + 'Redis, not a durable row'),
            receipt: none('the Twilio sid is returned and dropped; the email path returns a boolean'),
            uncertainOutcome: none('a lost answer is a refusal as far as the caller can tell'),
            erasure: none('nothing records the destination or the code'),
            recovery: none('the customer asks for another code'),
        },
    }),

    producer({
        id: 'invitations.user_invite',
        effect: 'The invitation email to a new team member, and the welcome email when they accept',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/invitations/invitations.service.ts',
        symbol: 'sendInvitationEmail',
        egress: 'EmailService.send',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['email'],
        },
        properties: uncovered('inline `EmailService.send`; the invitation token in the database is what '
            + 'the recipient needs, and re-sending is a deliberate button'),
    }),

    // -- Money and compliance --------------------------------------------------

    producer({
        id: 'billing.lifecycle_email',
        effect: 'Trial ending, trial ended, payment failed, soft lock, expiry and payment succeeded '
            + 'emails to the tenant',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/billing/billing-email.service.ts',
        symbol: 'BillingEmailService',
        egress: 'EmailService.send from billing event listeners',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['email'],
        },
        properties: {
            authority: none('inline from an event listener'),
            idempotency: partial('the EVENT is deduped upstream — `billing_events` is unique on '
                + '(provider, providerEventId), and the day-three soft lock has a Redis dedupe flag. '
                + 'Nothing dedupes the email itself'),
            receipt: none(INLINE_EMAIL),
            uncertainOutcome: none('the boolean collapses the two cases'),
            erasure: none('a tenant billing email is not personal data under the contact erasure path, '
                + 'and nothing records it either way'),
            recovery: none('no record of the attempt, so a lifecycle email lost to an SMTP outage is '
                + 'never sent and the tenant learns about the lock from the product instead'),
        },
    }),

    producer({
        id: 'fiscal.invoice_email',
        effect: 'The DIAN electronic invoice and its signed XML, emailed to the tenant',
        lane: 'domain_queue',
        status: 'live',
        derivation: 'census',
        source: 'modules/fiscal/fiscal-email.service.ts',
        symbol: 'FiscalEmailService',
        egress: 'EmailService.send from the `fiscal-invoice` queue',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['email'],
        },
        properties: {
            authority: none('no admission; the queue job is the only trace'),
            idempotency: partial('an `ok` flag on the invoice row records that the email was attempted, '
                + 'so the processor does not resend. The queue add itself has no identity'),
            receipt: partial('the boolean is written to the invoice row — enough to say "we tried", not '
                + 'enough to say the server accepted it'),
            uncertainOutcome: none('a lost answer is written as a failure'),
            erasure: none('fiscal records are retained by law and are deliberately outside erasure'),
            recovery: partial('the queue retries; the flag stops a duplicate'),
        },
    }),

    producer({
        id: 'meta_compliance.data_request',
        effect: 'The email answering a Meta data deletion or data access callback',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/meta-compliance/meta-compliance.service.ts',
        symbol: 'MetaComplianceService',
        egress: 'EmailService.send, not awaited',
        reach: {
            class: 'provider_configuration', audience: 'provider', personalData: true,
            channels: ['provider_api'],
        },
        properties: {
            authority: none('inline from the callback handler'),
            idempotency: partial('the confirmation code Meta is given is persisted, so the STATUS page '
                + 'is stable. The email is not deduped'),
            receipt: none(INLINE_EMAIL),
            uncertainOutcome: none('the boolean collapses the two cases'),
            erasure: none('this producer exists to serve an erasure request; the email itself is not '
                + 'recorded'),
            recovery: none('no record of the attempt: an unsent compliance answer leaves the status '
                + 'page saying the request was handled'),
        },
    }),

    // -- Reports, alerts and the platform's own operations ---------------------

    producer({
        id: 'analytics.scheduled_reports',
        effect: 'The weekly and monthly analytics report emailed to a tenant',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/analytics/scheduled-reports.service.ts',
        symbol: 'generateAndSendReport',
        egress: 'EmailService.send from two crons, after `canDeliverCustomerOutput` revalidates '
            + 'entitlement',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['email'],
        },
        properties: {
            authority: partial('entitlement is revalidated immediately before the send, which is a gate '
                + 'rather than an admission: nothing records that an attempt happened'),
            idempotency: partial('`last_sent_at` is updated after the loop, so a crash mid-loop re-sends '
                + 'to everyone already served'),
            receipt: none(INLINE_EMAIL),
            uncertainOutcome: none('the boolean collapses the two cases'),
            erasure: none('the report aggregates the tenant\'s own data; nothing records the send'),
            recovery: none('the next scheduled run, which is a week or a month away'),
        },
    }),

    producer({
        id: 'analytics.threshold_alerts',
        effect: 'The email a tenant gets when a metric crosses a threshold they configured',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/analytics/alerts.service.ts',
        symbol: 'fireAlert',
        egress: 'EmailService.send from the `*/15 * * * *` cron',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['email'],
        },
        properties: {
            authority: none('the send happens inline inside the cron tick; nothing records that an '
                + 'attempt was permitted'),
            idempotency: partial('an `alert_history` row and `last_triggered_at` are written BEFORE the '
                + 'send, so a failure is never retried — the safe direction for an alert, and the '
                + 'reason a failed alert is silently lost'),
            receipt: none(INLINE_EMAIL),
            uncertainOutcome: none('the boolean collapses the two cases'),
            erasure: none('tenant metrics, not contact data'),
            recovery: none('the history row suppresses a second attempt'),
        },
    }),

    producer({
        id: 'ops.platform_alerts',
        effect: 'Platform incident alerts to the operators — email, Telegram and SMS — from the Ops '
            + 'Center monitor',
        lane: 'inline',
        status: 'internal_only',
        derivation: 'census',
        source: 'modules/health/platform-monitor.service.ts',
        symbol: 'PlatformMonitorService',
        egress: 'EmailService.send, TelegramAlertService.send and SmsAlertService.send, from ten crons',
        reach: {
            class: 'platform_notification', audience: 'platform_operator', personalData: false,
            channels: ['email', 'sms', 'slack'],
        },
        properties: {
            authority: none('the send happens inline inside the cron tick; nothing records that an '
                + 'attempt was permitted'),
            idempotency: partial('a Redis `alert:cooldown:{key}` set-if-absent holds for an hour. It '
                + 'FAILS OPEN: a Redis outage removes the cooldown and every check re-alerts'),
            receipt: partial('an incident row is written through `IncidentService.record`. That is our '
                + 'own record of the condition, not a provider id for the alert'),
            uncertainOutcome: none('all three transports report a boolean or nothing'),
            erasure: notApplicable('no customer data reaches an operator alert'),
            recovery: none('the next cron pass re-evaluates the condition, which is the recovery an '
                + 'alert actually wants'),
        },
    }),

    producer({
        id: 'ops.coupon_alerts',
        effect: 'A Telegram message to the owner every time a coupon is issued, redeemed or revoked',
        lane: 'inline',
        status: 'internal_only',
        derivation: 'census',
        source: 'modules/health/coupon-alert.listener.ts',
        symbol: 'CouponAlertListener',
        egress: 'TelegramAlertService.send',
        reach: {
            class: 'platform_notification', audience: 'platform_operator', personalData: false,
            channels: ['email'],
        },
        properties: uncoveredWithoutPersonalData('no cooldown and no dedupe, and it deliberately bypasses the alert-config '
            + 'channel switch: the owner wants every coupon event, and a repeat is cheaper than a miss'),
    }),

    producer({
        id: 'feature_requests.status_email',
        effect: 'The email telling subscribers that a feature request they follow changed status',
        lane: 'inline',
        status: 'live',
        derivation: 'census',
        source: 'modules/feature-requests/feature-requests.service.ts',
        symbol: 'notifySubscribersStatus',
        egress: 'EmailService.send in a sequential loop',
        reach: {
            class: 'operator_notification', audience: 'tenant_operator', personalData: true,
            channels: ['email'],
        },
        properties: uncovered('a sequential inline loop of `EmailService.send`. A failure part-way '
            + 'through leaves some subscribers told and some not, with no record of which'),
    }),

    // -- Retained surfaces -----------------------------------------------------

    producer({
        id: 'channel.email.inbound_reply',
        effect: 'A reply on the email channel adapter',
        lane: 'outbound_queue',
        // `/admin/channels/email` calls tenant configuration routes that do not exist, so no
        // tenant can connect this. It stays registered as an internal inbound adapter.
        status: 'internal_only',
        derivation: 'declared',
        source: 'modules/channels/email/email.adapter.ts',
        symbol: 'EmailAdapter',
        egress: 'EmailChannelService, through the same outbound queue as every other channel',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['email'],
        },
        properties: queued(none('whatever the caller passes; no producer configures this channel today')),
    }),

    producer({
        id: 'channel.sms.conversational',
        effect: 'A conversational SMS reply through the tenant\'s own Twilio account',
        lane: 'outbound_queue',
        // Retained code for a reversed decision: SMS is a one-way notification product bought in
        // credits. The conversational adapter is not offered, and the platform kill switch is off.
        status: 'legacy',
        derivation: 'declared',
        source: 'modules/channels/sms/sms.adapter.ts',
        symbol: 'SmsAdapter',
        egress: 'Twilio REST; the outbound worker diverts text SMS to the metered reseller sender '
            + 'before this can be reached, and drops MMS outright',
        reach: {
            class: 'customer_message', audience: 'contact', personalData: true,
            channels: ['sms'],
        },
        properties: queued(none('the worker\'s SMS branch never reaches this adapter for text, so the '
            + 'legacy path has no live producer to dedupe')),
    }),

    // -----------------------------------------------------------------------
    // Third-party writes.
    //
    // Not a message to a customer, but still an effect at somebody else's
    // system that cannot be taken back. These cannot be swept for: a Google
    // Calendar insert, a Wompi charge and a HubSpot upsert share no primitive.
    // They are declared, and the spec pins each to a file and a symbol.
    // -----------------------------------------------------------------------

    producer({
        id: 'calendar.event_write',
        effect: 'Creating, updating and deleting the calendar event behind an appointment, in the '
            + 'tenant\'s Google Calendar or Microsoft 365',
        lane: 'domain_queue',
        status: 'live',
        derivation: 'declared',
        source: 'modules/appointments/calendar-sync-outbox.service.ts',
        symbol: 'CalendarSyncOutboxService',
        egress: 'CalendarIntegrationService.createEventForIntegration → `cal.events.insert`, or the '
            + 'Microsoft Graph `/me/events` POST',
        // The completion review assumed calendar writes were uncovered. They are not:
        // this is the second best-covered producer in the system after the dispatch outbox.
        reach: {
            class: 'domain_integration', audience: 'provider', personalData: true,
            channels: ['provider_api'],
        },
        properties: {
            authority: durable('a 90s lease per row, claimed before the request; the row is enqueued in '
                + 'the SAME transaction as the appointment it describes'),
            idempotency: durable('a caller-supplied event id derived from (appointment, revision, '
                + 'operation) for Google, and Graph\'s own `transactionId` for Microsoft — so a repeat '
                + 'is refused by the provider, not just by us. A 409 recovers the existing event'),
            receipt: durable('`provider_event_id` written back on the row'),
            uncertainOutcome: durable('a lapsed lease becomes `reconciliation_required`; a dedicated '
                + '`17 */15 * * * *` reconcile pass separates those from retryable rows'),
            erasure: partial('the row references the appointment, whose customer fields GDPR erasure '
                + 'anonymises. The event already written at Google keeps the name until the appointment '
                + 'update propagates'),
            recovery: durable('`processAllTenants` every minute re-claims anything the queue lost'),
        },
    }),

    producer({
        id: 'calendar.legacy_update',
        effect: 'The legacy by-userId calendar update wrapper, still exported beside the outbox path',
        lane: 'inline',
        status: 'legacy',
        derivation: 'declared',
        source: 'modules/appointments/calendar-integration.service.ts',
        symbol: 'updateEvent',
        egress: 'a direct `cal.events.patch` / Graph PATCH, with no outbox row',
        reach: {
            class: 'domain_integration', audience: 'provider', personalData: true,
            channels: ['provider_api'],
        },
        properties: uncovered('the file\'s own comment marks it a legacy wrapper. It writes to the '
            + 'provider with no lease, no idempotency key and no row, which is exactly what the outbox '
            + 'beside it exists to replace'),
    }),

    producer({
        id: 'payments.tenant_payment_link',
        effect: 'A payment link created at the TENANT\'S own Wompi or MercadoPago account so their '
            + 'customer can pay — created mid-conversation by a tool call, or from public booking',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/tenant-payments/tenant-payments.service.ts',
        symbol: 'createPaymentLink',
        egress: 'TenantWompiClient.createAndVerifyPaymentLink, or a MercadoPago checkout preference',
        reach: {
            class: 'commercial_write', audience: 'provider', personalData: true,
            channels: ['provider_api'],
        },
        properties: {
            authority: partial('`assertCustomerPaymentsEntitled` gates it and the intent row is written '
                + 'first, but the POST happens inline inside the AI turn — there is no lease that '
                + 'commits before the request'),
            idempotency: partial('MercadoPago gets a real `X-Idempotency-Key` plus a Redis and a durable '
                + 'lookup. Wompi accepts no such header, so correlation rests on `sku = intentId` and a '
                + 'read-back after creation'),
            receipt: durable('the provider link id is stored on the intent, and the canonical link — '
                + 'never a URL the model typed — is what any later message may carry'),
            uncertainOutcome: partial('`recoverWompiIntentFromProvider` and `findTransactionByPaymentLink` '
                + 'can find a link created by an attempt whose answer was lost. Nothing marks the intent '
                + 'as uncertain in the meantime, so the turn simply fails and the customer is told nothing'),
            erasure: partial('the intent row is tenant data holding an amount and a reference; it is not '
                + 'in the contact erasure fan-out'),
            recovery: partial('the recovery lookups exist and are called from the payment paths, not '
                + 'from a sweep — nothing walks stale intents on a schedule'),
        },
    }),

    producer({
        id: 'billing.recurring_charge',
        effect: 'Charging a tenant\'s saved card for their subscription renewal, at Wompi',
        lane: 'domain_queue',
        status: 'live',
        derivation: 'declared',
        source: 'modules/billing/recurring/processors/renewal-charge.processor.ts',
        symbol: 'RenewalChargeProcessor',
        egress: 'WompiAdapter.charge → POST /transactions',
        reach: {
            class: 'commercial_write', audience: 'provider', personalData: true,
            channels: ['provider_api'],
        },
        properties: {
            authority: durable('`markProviderPostStarted` takes a database lease and commits before the '
                + 'POST, so a crash cannot look like an attempt that never happened'),
            idempotency: partial('Wompi offers no idempotency header — the adapter says so in its own '
                + 'comment. A unique `reference` plus the lease is the whole guard, and `attempts: 1` '
                + 'means BullMQ never retries a charge on its own'),
            receipt: durable('`providerTxnId` on the charge attempt row'),
            uncertainOutcome: durable('`markIndeterminate` freezes an ambiguous charge instead of '
                + 'retrying it; a 4xx is never retried'),
            erasure: none('billing records are retained for accounting and are outside contact erasure '
                + 'by design'),
            recovery: durable('the scheduler and the polling pass re-evaluate frozen attempts against '
                + 'the provider'),
        },
    }),

    producer({
        id: 'billing.card_and_void',
        effect: 'Registering a tenant\'s saved payment source, voiding one, voiding a charge, and the '
            + 'self-serve checkout link',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/billing/adapters/wompi.adapter.ts',
        symbol: 'createPaymentSource',
        egress: 'POST /payment_sources, PUT /payment_sources/:id/void, POST /transactions/:id/void, '
            + 'POST /payment_links',
        reach: {
            class: 'commercial_write', audience: 'provider', personalData: true,
            channels: ['provider_api'],
        },
        properties: {
            authority: none('called inline from the billing service; no lease commits before the request'),
            idempotency: partial('the voids are naturally idempotent and the checkout link carries a '
                + '`sku` derived from the reference. Creating a payment source has no key at all'),
            receipt: durable('the provider ids are stored on the payment source and the checkout rows'),
            uncertainOutcome: none('a lost answer to `createPaymentSource` leaves a source registered at '
                + 'Wompi that we have no row for'),
            erasure: none('billing records are retained for accounting and sit outside contact '
                + 'erasure by design'),
            recovery: none('no sweep looks for a source or a link created by an attempt whose answer '
                + 'was lost'),
        },
    }),

    producer({
        id: 'billing.stripe',
        effect: 'The international rail: Stripe customers, subscriptions, prices and refunds',
        lane: 'inline',
        // `PaymentRoutingService` returns `stripe: false` and there is no STRIPE_SECRET_KEY,
        // so no country routes here today.
        status: 'off',
        derivation: 'declared',
        source: 'modules/billing/adapters/stripe.adapter.ts',
        symbol: 'StripeAdapter',
        egress: 'the Stripe SDK: customers.create, subscriptions.create/update/cancel, refunds.create',
        reach: {
            class: 'commercial_write', audience: 'provider', personalData: true,
            channels: ['provider_api'],
        },
        properties: uncovered('no `idempotencyKey` is passed on any Stripe call, which is the one thing '
            + 'that API gives away for free. It is dormant, so nothing has been charged twice — but the '
            + 'gap is in the code, not in the configuration'),
    }),

    producer({
        id: 'fiscal.invoice_issue',
        effect: 'Issuing a Colombian electronic invoice or credit note at DIAN through Factus, and '
            + 'burning a fiscal consecutive number',
        lane: 'domain_queue',
        status: 'live',
        derivation: 'declared',
        source: 'modules/fiscal/adapters/factus.adapter.ts',
        symbol: 'FactusAdapter',
        egress: 'POST /v2/bills/validate and /v2/credit-notes/validate',
        reach: {
            class: 'commercial_write', audience: 'provider', personalData: true,
            channels: ['provider_api'],
        },
        properties: {
            authority: durable('the queue processor short-circuits when the invoice is already issued, '
                + 'and issuance is refused for a sandbox rail, a zero amount or our own tenant'),
            idempotency: durable('`reference_code` is the key: on collision `reconcileByReference` '
                + 'recovers the validated CUFE rather than issuing a second one'),
            receipt: durable('`providerRef`, `invoiceNumber` and the CUFE are all persisted'),
            uncertainOutcome: durable('a collision is resolved by asking DIAN what exists; an '
                + 'unvalidated bill is deleted and re-posted, and a validated one is adopted'),
            erasure: none('a DIAN invoice is a legal record and is deliberately retained; the tenant '
                + 'purge keeps fiscal rows on purpose'),
            recovery: durable('`fiscal-invoice` queue retries plus a `17,47 * * * *` poller'),
        },
    }),

    producer({
        id: 'automation.http_request',
        effect: 'An arbitrary HTTP request a tenant configured as an automation action — any method, '
            + 'any allowed host, with data from the conversation',
        lane: 'domain_queue',
        status: 'live',
        derivation: 'declared',
        source: 'modules/automation/handlers/http-request.handler.ts',
        symbol: 'HttpRequestHandler',
        egress: 'HttpRequestService.execute, SSRF-guarded and capped at 10 seconds',
        reach: {
            class: 'domain_integration', audience: 'provider', personalData: true,
            channels: ['webhook'],
        },
        properties: {
            authority: partial('the exact action position is re-read from the active rule before quota '
                + 'or transport; unlike send_template outbox admission, an edit can still race the '
                + 'gap between that read and an arbitrary receiver call'),
            idempotency: partial('every attempt carries the stable BullMQ job identity as '
                + 'Idempotency-Key and mutating methods have no internal retry; an arbitrary receiver '
                + 'is not required to honour that header'),
            receipt: partial('the HTTP status and mapped response fields are merged into the exact '
                + 'action slot in automation_executions.result_json without concurrent last-writer '
                + 'loss; persistence after an accepted call can still fail'),
            uncertainOutcome: durable('a mutating request with no answer is persisted as '
                + 'reconciliation_required and completes its BullMQ job without another POST'),
            erasure: none('the request body may carry contact data and is not recorded, so erasure has '
                + 'nothing to reach in PostgreSQL; completed BullMQ payload retention is still outside '
                + 'the contact-erasure transaction'),
            recovery: partial('BullMQ retains the stable job and retries preflight failures; an '
                + 'uncertain mutating request deliberately waits for human reconciliation instead of '
                + 'being sent again'),
        },
    }),

    producer({
        id: 'mcp.remote_tool_call',
        effect: 'Calling a tool on a tenant\'s remote MCP server during an AI turn, which may write at '
            + 'whatever that server fronts',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/mcp/mcp-client.service.ts',
        symbol: 'callRemoteTool',
        egress: 'a JSON-RPC `tools/call` POST to the tenant\'s server',
        reach: {
            class: 'domain_integration', audience: 'provider', personalData: true,
            channels: ['provider_api'],
        },
        properties: {
            authority: partial('a stored, definition-hash-pinned human approval is required for any '
                + 'tool declared `write`, `payment` or `irreversible`. That authorises the KIND of '
                + 'call, not one concrete attempt'),
            idempotency: none('no request id the remote server could dedupe on'),
            receipt: none('the tool result feeds the turn and is not kept as a reference'),
            uncertainOutcome: none('a timeout inside a turn is indistinguishable from a refusal, and '
                + 'the model is told the tool failed'),
            erasure: none('arguments may carry contact data and are not recorded here'),
            recovery: none('none, deliberately: a remote write nobody can describe must not be repeated '
                + 'blindly'),
        },
    }),

    producer({
        id: 'external_crm.sync',
        effect: 'Pushing contacts, deals and activity notes into a tenant\'s HubSpot or Pipedrive',
        lane: 'domain_queue',
        status: 'live',
        derivation: 'declared',
        source: 'modules/external-crm/external-crm.service.ts',
        symbol: 'enqueueForAllConnections',
        egress: 'HubSpotAdapter / PipedriveAdapter POSTs, from the external CRM queue with three attempts',
        reach: {
            class: 'domain_integration', audience: 'provider', personalData: true,
            channels: ['provider_api'],
        },
        properties: {
            authority: none('no admission row; the queue job is the only trace'),
            idempotency: partial('a BullMQ job id when the caller supplies a dedupe key, and HubSpot\'s '
                + 'contact `batch/upsert` is idempotent on email. Deal and note creation is a plain '
                + 'POST with three attempts, so a retry duplicates a deal; Pipedrive does '
                + 'search-then-create, which races with itself'),
            receipt: partial('`persistLink` stores the remote contact and deal ids, and '
                + '`crm_note_receipts` stores the note id the adapter returns — it used to be assigned to a '
                + 'local variable and dropped. Still partial: a note pushed before that table existed left '
                + 'no id behind and cannot be addressed now'),
            uncertainOutcome: partial('a timeout on a push is retried, which is what duplicates the deal. A '
                + 'RETRACTION is strict instead: accepted, rejected or unknown, and `unknown` stays visible '
                + 'until somebody re-asks rather than being retried into a silent success'),
            erasure: partial('the contact row pushed to the tenant\'s CRM is still outside our reach and the '
                + 'link row is not cleared. The handoff NOTE is reached: the erasure marks its receipt for '
                + 'retraction in its own transaction and `retractPendingCrmNotes` deletes it through the '
                + 'same connection gate every other CRM effect uses'),
            recovery: partial('BullMQ retries; nothing republishes a lost job'),
        },
    }),

    producer({
        id: 'reviews.gbp_reply',
        effect: 'Publishing a reply under a Google Business Profile review, publicly and under the '
            + 'tenant\'s name',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/reviews/reviews.service.ts',
        symbol: 'postReply',
        egress: 'PUT https://mybusiness.googleapis.com/v4/{review}/reply',
        reach: {
            class: 'public_content', audience: 'public', personalData: true,
            channels: ['provider_api'],
        },
        properties: {
            authority: partial('a tenant opt-in flag. With `autoReply` on, a `30 */6 * * *` cron posts '
                + 'model-written text publicly with no human between the model and the customer'),
            idempotency: durable('a PUT on a fixed review name replaces the reply rather than adding '
                + 'one, so a repeat is harmless'),
            receipt: partial('`reply_status = posted` on our row; Google returns no id to keep'),
            uncertainOutcome: partial('the idempotent PUT makes a retry safe, so the missing '
                + 'distinction costs nothing here'),
            erasure: none('a published reply is public and outside erasure'),
            recovery: partial('the next cron pass finds it still unreplied'),
        },
    }),

    producer({
        id: 'meta.channel_management',
        effect: 'Subscribing and unsubscribing a Facebook page or Instagram account to our webhooks, '
            + 'exchanging OAuth codes for tokens, and setting or clearing a Telegram webhook',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/channels/channel-management.controller.ts',
        symbol: 'messengerOAuthConnect',
        egress: 'POST/DELETE {id}/subscribed_apps, the Instagram and Messenger token exchanges, and '
            + 'Telegram setWebhook/deleteWebhook',
        reach: {
            class: 'provider_configuration', audience: 'provider', personalData: false,
            channels: ['provider_api'],
        },
        properties: {
            authority: none('inline in the connect or disconnect request'),
            idempotency: partial('subscribing and unsubscribing are naturally idempotent at Meta. A '
                + 'token exchange is not: an authorization code is single use, so a lost answer burns it'),
            receipt: partial('the exchanged token is encrypted and stored, which is the only receipt '
                + 'that matters here'),
            uncertainOutcome: none('a lost answer to a token exchange leaves a connection the operator '
                + 'must restart from the beginning, with no record of what happened'),
            erasure: notApplicable('connection metadata, not contact data'),
            recovery: none('the operator presses connect again'),
        },
    }),

    producer({
        id: 'whatsapp.template_management',
        effect: 'Creating a WhatsApp message template in the tenant\'s WABA, and seeding the default set',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/whatsapp/services/whatsapp-template.service.ts',
        symbol: 'createTemplate',
        egress: 'POST {wabaId}/message_templates',
        reach: {
            class: 'provider_configuration', audience: 'provider', personalData: false,
            channels: ['provider_api'],
        },
        properties: {
            authority: none('the Graph POST happens inline inside the HTTP request; nothing records '
                + 'that an attempt was permitted'),
            idempotency: partial('Meta refuses a duplicate template name with a 400, which is a guard '
                + 'we get rather than one we built'),
            receipt: durable('the template id is persisted and polled until Meta approves or rejects it'),
            uncertainOutcome: none('a lost answer surfaces as a failure; the next attempt collides on '
                + 'the name and looks like a different error'),
            erasure: notApplicable('template content is tenant copy, not contact data'),
            recovery: partial('`pollPendingTemplates` reconciles approval state, not creation'),
        },
    }),

    producer({
        id: 'whatsapp.business_profile',
        effect: 'Writing the tenant\'s WhatsApp business profile and uploading or deleting its profile '
            + 'photo at Meta',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/whatsapp/services/whatsapp-connection.service.ts',
        symbol: 'uploadProfilePhoto',
        egress: 'POST {phoneNumberId}/whatsapp_business_profile, and a three-call resumable upload chain',
        reach: {
            class: 'provider_configuration', audience: 'provider', personalData: false,
            channels: ['provider_api'],
        },
        properties: {
            authority: none('the Graph calls happen inline inside the HTTP request; nothing records '
                + 'that an attempt was permitted'),
            idempotency: partial('the profile write is an overwrite. The photo upload is three chained '
                + 'calls with no key, so a failure part-way leaves an orphan upload session at Meta'),
            receipt: none('the upload handle is used and discarded'),
            uncertainOutcome: none('a lost answer mid-chain is indistinguishable from a refusal'),
            erasure: notApplicable('tenant branding, not contact data'),
            recovery: none('nothing records the attempt; the operator noticing the wrong photo and '
                + 'uploading again is the whole recovery mechanism'),
        },
    }),

    producer({
        id: 'channels.token_refresh',
        effect: 'Minting a fresh long-lived Instagram token at Meta before the current one expires',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/channels/instagram-token-refresh.service.ts',
        symbol: 'InstagramTokenRefreshService',
        egress: 'GET graph.instagram.com/refresh_access_token — a read-shaped call that mints new '
            + 'remote state',
        reach: {
            class: 'credential_lifecycle', audience: 'provider', personalData: false,
            channels: ['provider_api'],
        },
        properties: {
            authority: none('inline from the daily `0 6 * * *` cron'),
            idempotency: partial('refreshing twice is harmless: each call returns a valid token and the '
                + 'newest one is stored'),
            receipt: durable('the new token is encrypted and persisted, which is the whole point'),
            uncertainOutcome: partial('a lost answer leaves the old token in place and the next daily '
                + 'pass tries again, while the window is still 30 days wide'),
            erasure: notApplicable('a credential, not contact data'),
            recovery: durable('the daily cron is the recovery'),
        },
    }),

    producer({
        id: 'offboarding.external_revocation',
        effect: 'Revoking a leaving tenant\'s channel subscriptions and webhooks at Meta, Telegram and '
            + 'Twilio during offboarding and purge',
        lane: 'inline',
        status: 'live',
        derivation: 'declared',
        source: 'modules/offboarding/offboarding.service.ts',
        symbol: 'disconnectAllChannels',
        egress: 'the same subscribed_apps and webhook deletions as the connect flow, bounded by '
            + '`fetchWithDeadline`',
        reach: {
            class: 'credential_lifecycle', audience: 'provider', personalData: false,
            channels: ['provider_api'],
        },
        properties: {
            authority: none('inline in the offboarding pipeline'),
            idempotency: durable('every revocation is a delete: repeating it is a no-op, and a shared '
                + 'system user token is deliberately never revoked'),
            receipt: partial('per-account failures are collected and reported rather than swallowed'),
            uncertainOutcome: partial('a bounded deadline turns a hang into a recorded failure the '
                + 'operator can see, which is more than most inline paths do'),
            erasure: notApplicable('this producer serves erasure; the calls themselves are not recorded'),
            recovery: none('the operator re-runs the step'),
        },
    }),

    producer({
        id: 'integrations.outbox_scaffolding',
        effect: 'A general integration outbox with leases, idempotency keys and an external id written '
            + 'back — for adapters that do not exist',
        lane: 'domain_queue',
        // `IntegrationOutboxWorker.register` is called only from spec files. Zero adapters are
        // registered at runtime, so the worker claims work it can never perform.
        status: 'off',
        derivation: 'declared',
        source: 'modules/integrations/integration-outbox.worker.ts',
        symbol: 'IntegrationOutboxWorker',
        egress: 'nothing today: `adapter.write` has no registered adapter to call',
        reach: {
            class: 'domain_integration', audience: 'provider', personalData: true,
            channels: ['provider_api'],
        },
        properties: uncovered('the mechanism is real and correct, and no producer reaches it. It is in '
            + 'this inventory so that a future adapter registration is a deliberate act rather than a '
            + 'quiet arrival of a whole new external effect'),
    }),

    producer({
        id: 'integrations.commerce_readonly',
        effect: 'Shopify, WooCommerce, Hostaway, Toast, Mindbody and Cliniko — mirrored into tenant '
            + 'tables and never written to',
        lane: 'inline',
        status: 'internal_only',
        derivation: 'declared',
        source: 'modules/vertical-integrations/vertical-integrations.service.ts',
        symbol: 'VerticalIntegrationsService',
        egress: 'GETs only, apart from the Toast and Hostaway authentication POSTs that mint a token '
            + 'and persist nothing',
        // Recorded as an entry rather than omitted: "we never write there" is a fact worth
        // pinning, because the day a booking push is added it must not arrive unnoticed.
        reach: {
            class: 'domain_integration', audience: 'provider', personalData: false,
            channels: ['provider_api'],
        },
        properties: uncoveredWithoutPersonalData('there is no external effect to cover. No booking is created at Mindbody '
            + 'or Cliniko, no order is pushed to Shopify, and no reservation or availability is sent '
            + 'back to an OTA — the iCal path is import-only. The authentication POSTs mint a '
            + 'short-lived token and are safe to repeat'),
    }),
]);

// ---------------------------------------------------------------------------
// The road, not the traffic.
//
// Both sweeps in the spec catch these — one holds an egress primitive, the other
// a third-party host — but none of them decides that an effect should happen.
// They are listed with a reason rather than filtered out by a pattern, because a
// file that stops being a road has to be noticed by somebody.
// ---------------------------------------------------------------------------

export const NON_PRODUCER_KINDS = [
    /** Wiring, registries, workers and recovery passes. Carries out, never decides. */
    'road',
    /** Speaks to a provider on a producer's behalf. Its properties belong to its callers. */
    'transport',
    /** Only reads. A GET changes nothing at the other end. */
    'read_only',
    /** Mints or refreshes a credential. Remote state, but nothing a customer sees. */
    'credential',
] as const;
export type NonProducerKind = (typeof NON_PRODUCER_KINDS)[number];

export interface EgressInfrastructure {
    readonly source: string;
    readonly kind: NonProducerKind;
    readonly reason: string;
}

export const EGRESS_INFRASTRUCTURE: readonly EgressInfrastructure[] = Object.freeze([
    // -- The shared road -----------------------------------------------------
    { source: 'modules/channels/channel-gateway.service.ts', kind: 'road',
        reason: 'the adapter registry and the router. It performs sends on behalf of callers and '
            + 'originates none' },
    { source: 'modules/channels/outbound-queue.processor.ts', kind: 'road',
        reason: 'the worker for all four lanes of the shared queue. It carries out what a producer '
            + 'already committed' },
    { source: 'modules/channels/dispatch-recovery.service.ts', kind: 'road',
        reason: 'republishes outbox rows and retires lapsed permissions. It creates no new effect' },
    { source: 'modules/channels/proactive-dispatch.service.ts', kind: 'road',
        reason: 'the durable entrance for an effect nobody asked for: it commits the outbox row and '
            + 'publishes it. Every decision about whether the message may be sent belongs to the '
            + 'processor that picks the row up, so this originates nothing of its own' },
    { source: 'modules/channels/channels.module.ts', kind: 'road', reason: 'dependency injection wiring' },
    // ── THE SHARED CUSTOMER-RECEIPT SENDER ──────────────────────────
    //
    // Nine `emailConfirmations` controls needed the same five-step decision —
    // does an active tenant own this schema, is there an address, is the
    // switch on for the agent that SERVED the operation, what language, and
    // did the transport take it — and writing it nine times had already
    // drifted twice. It lives here once and reports WHICH of the five
    // refusals happened instead of returning a boolean.
    //
    // A road and not a producer: it decides nothing about WHICH operation
    // deserves a receipt. Each caller does, and each caller is inventoried
    // as the producer of its own.
    { source: 'modules/email-templates/operation-confirmation.service.ts', kind: 'road',
        reason: 'performs the customer receipt on behalf of a vertical writer and originates '
            + 'none of its own: the caller names the families whose switch governs it' },
    { source: 'modules/health/health.module.ts', kind: 'road', reason: 'dependency injection wiring' },
    { source: 'modules/sms-credits/sms-credits.module.ts', kind: 'road', reason: 'dependency injection wiring' },
    { source: 'modules/sms-notifications/sms-notifications.module.ts', kind: 'road',
        reason: 'dependency injection wiring' },
    { source: 'modules/operational-notices/operational-notice-outbox.ts', kind: 'road',
        reason: 'the outbox primitive its three producers write through' },
    { source: 'modules/operational-notices/operational-notice.service.ts', kind: 'road',
        reason: 'the deliverer for the operational_notice lane, holding the properties its producers '
            + 'inherit' },
    { source: 'modules/billing/adapters/wompi-config.service.ts', kind: 'road',
        reason: 'resolves the Wompi base URL and keys; it makes no call of its own' },

    // -- Transports ----------------------------------------------------------
    { source: 'modules/sms-notifications/sms-sender.service.ts', kind: 'transport',
        reason: 'the SMS wrapper behind the notification listeners. Its producer is `handoff.agent_sms`' },
    { source: 'modules/channels/whatsapp/whatsapp.adapter.ts', kind: 'transport',
        reason: 'the WhatsApp strict transport. Its producers are the dispatch outbox and the queue' },
    { source: 'modules/channels/instagram/instagram.adapter.ts', kind: 'transport',
        reason: 'the Instagram strict transport' },
    { source: 'modules/channels/messenger/messenger.adapter.ts', kind: 'transport',
        reason: 'the Messenger strict transport' },
    { source: 'modules/channels/telegram/telegram.adapter.ts', kind: 'transport',
        reason: 'the Telegram strict transport' },
    { source: 'modules/whatsapp/services/whatsapp-messaging.service.ts', kind: 'transport',
        reason: 'the SECOND WhatsApp route — a direct Graph POST used by the manual endpoints, '
            + 'broadcast, reminders, automation rules and drip steps, each inventoried separately' },
    { source: 'modules/sms-credits/tenant-notification-sms.service.ts', kind: 'transport',
        reason: 'the metered reseller SMS sender: platform Twilio, tenant credits, atomic ledger' },
    { source: 'modules/health/sms-alert.service.ts', kind: 'transport',
        reason: 'the operator SMS alert transport, behind `ops.platform_alerts`' },
    { source: 'modules/health/telegram-alert.service.ts', kind: 'transport',
        reason: 'the operator Telegram alert transport, behind `ops.platform_alerts` and '
            + '`ops.coupon_alerts`' },
    { source: 'modules/push/push.service.ts', kind: 'transport',
        reason: 'Expo and Web Push delivery, behind `handoff.push`' },
    { source: 'modules/slack/slack.service.ts', kind: 'transport',
        reason: 'the Slack webhook POST, behind `handoff.slack`' },
    { source: 'modules/tenant-payments/tenant-wompi.client.ts', kind: 'transport',
        reason: 'the tenant Wompi client, behind `payments.tenant_payment_link`' },
    { source: 'modules/external-crm/adapters/hubspot.adapter.ts', kind: 'transport',
        reason: 'the HubSpot client, behind `external_crm.sync`' },
    { source: 'modules/external-crm/adapters/pipedrive.adapter.ts', kind: 'transport',
        reason: 'the Pipedrive client, behind `external_crm.sync`' },

    // -- Reads ---------------------------------------------------------------
    { source: 'modules/channels/channels.controller.ts', kind: 'read_only',
        reason: 'looks up a contact\'s display name and profile photo on the inbound path' },
    { source: 'modules/channels/whatsapp-token-health.service.ts', kind: 'read_only',
        reason: '`debug_token` only; it reports expiry and changes nothing' },
    { source: 'modules/media-processing/media-download.service.ts', kind: 'read_only',
        reason: 'downloads the customer\'s own audio and images from the provider CDNs' },
    { source: 'modules/tenant-payments/tenant-payments-webhook.service.ts', kind: 'read_only',
        reason: 'verifies a webhook by reading the payment back from the provider' },

    // -- Credentials ---------------------------------------------------------
    { source: 'modules/auth/microsoft-auth.service.ts', kind: 'credential',
        reason: 'the Microsoft sign-in code exchange and a profile photo read. It grants us a session, '
            + 'not an effect anyone receives' },
    { source: 'modules/channel-manager/channel-manager.service.ts', kind: 'credential',
        reason: 'Hostaway is read-only: listings, reservations and availability are pulled in and never '
            + 'pushed back. The one POST mints an access token and persists nothing' },
]);

// ---------------------------------------------------------------------------
// Reading the inventory.
// ---------------------------------------------------------------------------

export interface ExternalEffectSummary {
    readonly producers: number;
    readonly byLane: Readonly<Record<string, number>>;
    readonly byStatus: Readonly<Record<string, number>>;
    /** Producer ids with at least one `none`, which is the list worth reading. */
    readonly uncovered: readonly string[];
    /** Property → the producers that hold nothing at all for it. */
    readonly gapsByProperty: Readonly<Record<string, readonly string[]>>;
}

export function producersMissing(property: EffectProperty,
    rows: readonly ExternalEffectProducer[] = EXTERNAL_EFFECT_PRODUCERS): readonly ExternalEffectProducer[] {
    return Object.freeze(rows.filter(row => row.properties[property].level === 'none'));
}

export function summariseExternalEffects(
    rows: readonly ExternalEffectProducer[] = EXTERNAL_EFFECT_PRODUCERS): ExternalEffectSummary {
    const count = (pick: (row: ExternalEffectProducer) => string) => {
        const totals: Record<string, number> = {};
        for (const row of rows) totals[pick(row)] = (totals[pick(row)] ?? 0) + 1;
        return Object.freeze(totals);
    };
    return Object.freeze({
        producers: rows.length,
        byLane: count(row => row.lane),
        byStatus: count(row => row.status),
        uncovered: Object.freeze(rows
            .filter(row => EFFECT_PROPERTIES.some(property => row.properties[property].level === 'none'))
            .map(row => row.id).sort()),
        gapsByProperty: Object.freeze(Object.fromEntries(EFFECT_PROPERTIES.map(property =>
            [property, Object.freeze(producersMissing(property, rows).map(row => row.id).sort())]))),
    });
}
