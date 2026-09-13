import { revisionHash } from '../evaluation-revision/evaluation-revision';
import type { RevisionQuery } from './agent-configuration-revision';

/**
 * ═══ WHO A MESSAGE NOBODY ASKED FOR IS SENT ON BEHALF OF ═══
 *
 * `ServedAgentAuthority` answers this for a REPLY: an agent persona, at a
 * version, with a hash of the configuration that produced it, revalidated
 * inside the transaction that commits the effect. That is what stops a reply
 * going out under a persona somebody edited while it sat in a queue.
 *
 * A reminder has no agent. It was scheduled by a POLICY — "remind people
 * twenty-four hours before their appointment" — and what can change under it is
 * not a persona but the APPOINTMENT: cancelled, rescheduled, moved to another
 * number. The queue lane had nothing to express that, so the reminders passed
 * an object with no `kind` and no hash, the store answered
 * `dispatch_authority_required`, and the migration would have failed at the
 * first real row.
 *
 * ── WHY A REVISION AND NOT A TIMESTAMP ──────────────────────────────────────
 *
 * Because the question at POST time is not "is this appointment still there"
 * but "is it still the appointment this message describes". A row that moved
 * from Tuesday to Thursday still exists; sending "your appointment is tomorrow
 * at 3" about it is worse than sending nothing. The revision hashes exactly the
 * fields the message depends on, so a change to any of them makes the prepared
 * effect stale and the processor suppresses it rather than delivering a
 * sentence that is now false.
 *
 * ── AND WHY THE POLICY HAS A VERSION OF ITS OWN ─────────────────────────────
 *
 * The same reason the persona does. "Remind at 24h" and "remind at 24h and 2h"
 * are different policies; an effect prepared under one must not be delivered
 * as though it belonged to the other, because the business changed its mind in
 * between and the second reminder it is now about to receive was never
 * authorised by anybody.
 */
export const PROACTIVE_POLICY_VERSION = 1;

export type ProactivePolicyAuthority = Readonly<{
    kind: 'proactive_policy';
    tenantId: string;
    schemaName: string;
    /** Which scheduled behaviour this is. Matches a `PROACTIVE_POLICIES` key. */
    producer: string;
    /** The connection the effect will leave from, and therefore who pays. */
    channelType: string;
    channelAccountId: string;
    /** The domain row the message is about. */
    entityId: string;
    /** A hash of the fields the message depends on, taken when it was prepared. */
    entityRevision: string;
    policyVersion: number;
}>;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

export class ProactivePolicyAuthorityError extends Error {
    readonly code: string;
    constructor(code: 'proactive_policy_invalid' | 'proactive_entity_changed'
        | 'proactive_entity_gone' | 'proactive_policy_unknown') {
        super(code);
        this.code = code;
        this.name = 'ProactivePolicyAuthorityError';
    }
}

/**
 * How to read the current revision of the thing a policy is about.
 *
 * One entry per producer, and the registry is deliberately closed: a producer
 * that is not here cannot obtain an authority, so a new scheduled behaviour has
 * to say what makes its effect stale before it can send anything. The
 * alternative — an open map with a permissive default — is how a cancelled
 * appointment gets a reminder.
 *
 * `null` means the entity is GONE (deleted, or no longer in a state that
 * justifies the message), which suppresses the effect rather than failing it.
 */
export interface ProactivePolicy {
    readonly producer: string;
    /** What this policy sends, for the operator reading a suppression. */
    readonly describes: string;
    revision(query: RevisionQuery, schema: string, entityId: string): Promise<string | null>;
}

/** The decisive fields of an appointment, hashed. */
const appointmentRevision = async (
    query: RevisionQuery, _schema: string, entityId: string,
): Promise<string | null> => {
    const [row] = await query<any[]>(
        // `FOR SHARE`, in the caller's transaction: the row must not change
        // between this check and the lease that authorises the POST.
        `SELECT id, status, start_at, service_name, contact_id, conversation_id
           FROM appointments WHERE id = $1::uuid FOR SHARE`, [entityId]);
    if (!row) return null;
    // A cancelled or completed appointment justifies no reminder. Returning
    // `null` suppresses the prepared effect, which is the difference between
    // "do not send this" and "this failed".
    if (!['pending', 'confirmed'].includes(String(row.status))) return null;
    return revisionHash({
        status: row.status,
        // The instant is what the sentence is about. Normalised to an ISO
        // string so a driver returning a Date and a driver returning a string
        // do not produce two different revisions for one unchanged row.
        startAt: row.start_at ? new Date(row.start_at).toISOString() : null,
        serviceName: row.service_name ?? null,
        contactId: row.contact_id ?? null,
        conversationId: row.conversation_id ?? null,
    });
};

/**
 * A CANCELLATION notice is the one message about an appointment that exists
 * precisely because the appointment is cancelled.
 *
 * `appointmentRevision` returns `null` for any status outside `pending` and
 * `confirmed`, which is right for a reminder — there is nothing to remind
 * somebody of — and exactly wrong here. `AppointmentsService.cancel` commits
 * `status='cancelled'` BEFORE it emits, so a cancellation notice asking that
 * policy for an authority is told the entity no longer justifies the message,
 * the lane reads that as "suppress and advance", and the customer is never told
 * their appointment was cancelled. That is not de-duplicating a message; it is
 * deleting one.
 *
 * So the accepted status is inverted, and `status` stays inside the hash: an
 * appointment re-confirmed between preparing the notice and sending it makes
 * the prepared notice STALE, because "your appointment was cancelled" is false
 * about a booking that is back on.
 */
const cancelledAppointmentRevision = async (
    query: RevisionQuery, _schema: string, entityId: string,
): Promise<string | null> => {
    const [row] = await query<any[]>(
        `SELECT id, status, start_at, service_name, contact_id, conversation_id
           FROM appointments WHERE id = $1::uuid FOR SHARE`, [entityId]);
    if (!row) return null;
    // Only a cancelled appointment justifies a cancellation notice.
    if (String(row.status) !== 'cancelled') return null;
    return revisionHash({
        status: row.status,
        startAt: row.start_at ? new Date(row.start_at).toISOString() : null,
        serviceName: row.service_name ?? null,
        contactId: row.contact_id ?? null,
        conversationId: row.conversation_id ?? null,
    });
};

/**
 * A drip step is about the ENROLMENT, not about the sequence.
 *
 * Somebody who left the sequence, finished it, or was moved to another step by
 * a reply that arrived while the step sat in the queue must not receive step 3
 * of a journey they are no longer on. `current_step` is part of the revision
 * precisely so an advanced enrolment makes the prepared step stale rather than
 * delivering the wrong one.
 */
const dripEnrolmentRevision = async (
    query: RevisionQuery, _schema: string, entityId: string,
): Promise<string | null> => {
    const [row] = await query<any[]>(
        `SELECT id, sequence_id, status, current_step, contact_id, conversation_id
           FROM drip_enrollments WHERE id = $1::uuid FOR SHARE`, [entityId]);
    if (!row) return null;
    // Stopped, completed or paused: the journey is over and its next step is
    // not owed. Suppressed, not failed.
    if (String(row.status) !== 'active') return null;
    return revisionHash({
        status: row.status,
        sequenceId: row.sequence_id ?? null,
        currentStep: Number(row.current_step ?? 0),
        contactId: row.contact_id ?? null,
        conversationId: row.conversation_id ?? null,
    });
};

/**
 * A nurturing nudge is about the CONVERSATION.
 *
 * Its whole premise is "they went quiet", and the one thing that must stop it
 * is the customer answering. The attempt counter and the thread's status both
 * live on the conversation, and so does the time of the last inbound message,
 * so the revision is taken there: a reply between preparing the nudge and
 * sending it makes the prepared effect stale. A nudge asking whether anybody is
 * still there, arriving a minute after somebody wrote, is the most irritating
 * thing this lane can do — and it is billed.
 */
const nurturedConversationRevision = async (
    query: RevisionQuery, _schema: string, entityId: string,
): Promise<string | null> => {
    const [row] = await query<any[]>(
        `SELECT c.id, c.status, c.contact_id, c.channel_type, c.channel_account_id,
                COALESCE(c.metadata->>'nurturing_last_attempt', '0') AS attempt,
                (SELECT MAX(m.created_at) FROM messages m
                  WHERE m.conversation_id = c.id AND m.direction = 'inbound') AS last_inbound
           FROM conversations c WHERE c.id = $1::uuid FOR SHARE`, [entityId]);
    if (!row) return null;
    // A thread somebody closed, or one already handed to a person, is not a
    // thread to nudge.
    if (['resolved', 'archived', 'with_human'].includes(String(row.status ?? ''))) return null;
    return revisionHash({
        status: row.status ?? null,
        contactId: row.contact_id ?? null,
        channelType: row.channel_type ?? null,
        channelAccountId: row.channel_account_id ?? null,
        attempt: String(row.attempt ?? '0'),
        lastInbound: row.last_inbound ? new Date(row.last_inbound).toISOString() : null,
    });
};

/**
 * A campaign message is about ONE recipient row, and about the campaign above
 * it.
 *
 * A paused or cancelled campaign whose queued messages keep going out is the
 * worst thing this lane can do, because it is the one an operator explicitly
 * tried to prevent: they pressed pause and the messages carried on, each one
 * billed. So the campaign's own status is inside the recipient's revision, and
 * a recipient already sent or failed is GONE rather than stale.
 */
const campaignRecipientRevision = async (
    query: RevisionQuery, _schema: string, entityId: string,
): Promise<string | null> => {
    const [row] = await query<any[]>(
        `SELECT r.id, r.status, r.contact_id, r.campaign_id,
                c.status AS campaign_status, c.wa_template_name
           FROM campaign_recipients r
           LEFT JOIN campaigns c ON c.id = r.campaign_id
          WHERE r.id = $1::uuid
          -- Locked with OF r rather than with a bare FOR SHARE: PostgreSQL
          -- refuses to lock the nullable side of an outer join, and the
          -- recipient is the row that must not move between this check and
          -- the lease. The campaign above it is read, not locked: one paused
          -- a microsecond later is caught by the next admission, and locking
          -- the campaign row from inside one recipient's lease would
          -- serialise every message in it.
          FOR SHARE OF r`, [entityId]);
    if (!row) return null;
    // Only a recipient still waiting is owed a message, and only while the
    // campaign is running.
    if (!['pending', 'queued'].includes(String(row.status ?? ''))) return null;
    // ── A CAMPAIGN THAT IS GONE IS NOT A CAMPAIGN THAT IS RUNNING ───────────
    //
    // This used to refuse only a status it could NAME, so the NULL the LEFT
    // JOIN produces for a DELETED campaign was read as permission. Pausing a
    // campaign stopped its queued messages and deleting it did not — the
    // stronger action having the weaker effect, which is the worst way round.
    //
    // `campaign_recipients.campaign_id` is NOT NULL with no cascade, so the
    // recipients outlive the campaign and nothing is left that says who
    // authorised them. An allowlist answers both cases with one rule.
    if (!['active', 'draft'].includes(String(row.campaign_status ?? ''))) return null;
    return revisionHash({
        status: row.status,
        campaignId: row.campaign_id ?? null,
        campaignStatus: row.campaign_status ?? null,
        templateName: row.wa_template_name ?? null,
        contactId: row.contact_id ?? null,
    });
};

/**
 * A rule action is about the RULE.
 *
 * A rule somebody switched off between the trigger firing and the message
 * leaving must send nothing: switching it off is the operator saying stop. The
 * actions are hashed too, so editing which template a rule sends does not let
 * the old one go out under the new rule's authority.
 */
const automationRuleRevision = async (
    query: RevisionQuery, _schema: string, entityId: string,
): Promise<string | null> => {
    const [row] = await query<any[]>(
        `SELECT id, active, trigger_type, actions_json, conditions_json
           FROM automation_rules WHERE id = $1::uuid FOR SHARE`, [entityId]);
    if (!row) return null;
    if (row.active !== true) return null;
    return revisionHash({
        triggerType: row.trigger_type ?? null,
        actions: row.actions_json ?? null,
        conditions: row.conditions_json ?? null,
    });
};

/**
 * A recall is about the CONTACT, and specifically about their cooldown.
 *
 * `next_recall_at` is what stops the same person being recalled every day. It
 * is inside the revision so a recall that already went out — moving the clock
 * forward — makes any second prepared recall stale, instead of a duplicate the
 * customer reads as spam and the business pays for twice.
 */
const recallContactRevision = async (
    query: RevisionQuery, _schema: string, entityId: string,
): Promise<string | null> => {
    const [row] = await query<any[]>(
        `SELECT id, phone, next_recall_at, last_contact_at
           FROM contacts WHERE id = $1::uuid FOR SHARE`, [entityId]);
    if (!row) return null;
    // No number, nothing to send to.
    if (!String(row.phone ?? '').trim()) return null;
    return revisionHash({
        phone: row.phone,
        nextRecallAt: row.next_recall_at ? new Date(row.next_recall_at).toISOString() : null,
        lastContactAt: row.last_contact_at ? new Date(row.last_contact_at).toISOString() : null,
    });
};

/**
 * ═══ THE CLOSED REGISTRY ═══
 *
 * A producer that is not here cannot obtain an authority, and therefore cannot
 * put a row on the durable lane at all. That is deliberate: the price of a new
 * scheduled behaviour is saying, IN CODE, what makes its message untrue. The
 * alternative — an open map with a permissive default — is how a cancelled
 * appointment gets a reminder and a paused campaign keeps sending.
 */
export const PROACTIVE_POLICIES: Readonly<Record<string, ProactivePolicy>> = Object.freeze({
    appointment_reminder: Object.freeze({
        producer: 'appointment_reminder',
        describes: 'un recordatorio de turno',
        revision: appointmentRevision,
    }),
    attendance_check: Object.freeze({
        producer: 'attendance_check',
        describes: 'una confirmación de asistencia',
        revision: appointmentRevision,
    }),
    appointment_notification: Object.freeze({
        producer: 'appointment_notification',
        describes: 'un aviso sobre un turno',
        revision: appointmentRevision,
    }),
    appointment_cancellation: Object.freeze({
        producer: 'appointment_cancellation',
        describes: 'el aviso de que un turno se canceló',
        revision: cancelledAppointmentRevision,
    }),
    drip_step: Object.freeze({
        producer: 'drip_step',
        describes: 'un paso de una secuencia de goteo',
        revision: dripEnrolmentRevision,
    }),
    nurturing_followup: Object.freeze({
        producer: 'nurturing_followup',
        describes: 'un seguimiento a una conversación sin respuesta',
        revision: nurturedConversationRevision,
    }),
    broadcast_message: Object.freeze({
        producer: 'broadcast_message',
        describes: 'un mensaje de campaña',
        revision: campaignRecipientRevision,
    }),
    automation_rule_action: Object.freeze({
        producer: 'automation_rule_action',
        describes: 'una acción de una regla de automatización',
        revision: automationRuleRevision,
    }),
    recall_reminder: Object.freeze({
        producer: 'recall_reminder',
        describes: 'un mensaje de reactivación',
        revision: recallContactRevision,
    }),
});

export function validProactivePolicyAuthority(
    value: unknown, schema: string, tenantId?: string,
): value is ProactivePolicyAuthority {
    const scope = value as ProactivePolicyAuthority;
    return !!scope && typeof scope === 'object'
        && scope.kind === 'proactive_policy'
        && /^[a-z][a-z0-9_]*$/.test(schema)
        && scope.schemaName === schema
        && UUID.test(scope.tenantId) && (!tenantId || scope.tenantId === tenantId)
        && typeof scope.producer === 'string' && !!PROACTIVE_POLICIES[scope.producer]
        && typeof scope.channelType === 'string' && /^[a-z_]{2,40}$/.test(scope.channelType)
        && typeof scope.channelAccountId === 'string'
        && !!scope.channelAccountId.trim() && scope.channelAccountId.length <= 300
        && UUID.test(scope.entityId)
        && HASH.test(scope.entityRevision)
        && Number.isInteger(scope.policyVersion) && scope.policyVersion > 0;
}

/** Build one, or `undefined` when the caller cannot name every part of it. */
export async function proactivePolicyAuthority(
    query: RevisionQuery, schema: string, input: {
        readonly tenantId: string;
        readonly producer: string;
        readonly channelType: string;
        readonly channelAccountId: string;
        readonly entityId: string;
    },
): Promise<ProactivePolicyAuthority | undefined> {
    const policy = PROACTIVE_POLICIES[input.producer];
    if (!policy) return undefined;
    const entityRevision = await policy.revision(query, schema, input.entityId);
    if (!entityRevision) return undefined;
    const scope: ProactivePolicyAuthority = Object.freeze({
        kind: 'proactive_policy' as const,
        tenantId: input.tenantId,
        schemaName: schema,
        producer: input.producer,
        channelType: input.channelType,
        channelAccountId: input.channelAccountId,
        entityId: input.entityId,
        entityRevision,
        policyVersion: PROACTIVE_POLICY_VERSION,
    });
    return validProactivePolicyAuthority(scope, schema, input.tenantId) ? scope : undefined;
}

/** What the revalidation decided. `stale` and `gone` are both suppressions. */
export type ProactiveRevalidation =
    | { readonly kind: 'current' }
    | { readonly kind: 'stale'; readonly detail: string }
    | { readonly kind: 'gone'; readonly detail: string };

/**
 * Is this prepared effect still the effect the policy authorised?
 *
 * MUST run in the same transaction that grants the lease. A check that
 * commits separately answers about a moment that has already passed, and the
 * window between it and the POST is exactly where a cancellation lands.
 */
export async function revalidateProactivePolicy(
    query: RevisionQuery, schema: string, scope: ProactivePolicyAuthority,
): Promise<ProactiveRevalidation> {
    if (!validProactivePolicyAuthority(scope, schema)) {
        throw new ProactivePolicyAuthorityError('proactive_policy_invalid');
    }
    const [tenant] = await query<any[]>(
        `SELECT id FROM public.tenants
          WHERE id = $1::uuid AND schema_name = $2 AND is_active = true FOR SHARE`,
        [scope.tenantId, schema]);
    if (!tenant) throw new ProactivePolicyAuthorityError('proactive_policy_invalid');

    if (scope.policyVersion !== PROACTIVE_POLICY_VERSION) {
        // The business changed what this behaviour does between preparing and
        // sending. Delivering the old effect would send something nobody
        // currently authorises.
        return { kind: 'stale', detail: `policy_version:${scope.policyVersion}` };
    }
    const policy = PROACTIVE_POLICIES[scope.producer];
    if (!policy) throw new ProactivePolicyAuthorityError('proactive_policy_unknown');

    const current = await policy.revision(query, schema, scope.entityId);
    if (!current) return { kind: 'gone', detail: `${scope.producer}:${scope.entityId}` };
    if (current !== scope.entityRevision) {
        return { kind: 'stale', detail: `${scope.producer}:${scope.entityId}` };
    }
    return { kind: 'current' };
}
