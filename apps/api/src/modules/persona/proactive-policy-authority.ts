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
