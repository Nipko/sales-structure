import { revisionHash } from '../evaluation-revision/evaluation-revision';
import type { RevisionQuery } from './agent-configuration-revision';

/**
 * ═══ WHO A MESSAGE A PERSON SENT IS SENT ON BEHALF OF ═══
 *
 * The durable lane knows two kinds of origin. `ServedAgentAuthority` answers
 * "which agent, at which version, under which configuration" for a REPLY.
 * `ProactivePolicyAuthority` answers "which scheduled behaviour, about which
 * domain row, at which revision" for a message nobody asked for.
 *
 * Neither describes a PERSON. An agent in the console pressing send, and a
 * tenant calling `POST /whatsapp/send-text` with their API credentials, are
 * both effects whose authority is a human being and a role — not a persona
 * version and not a policy. Those six call sites had no authority they could
 * honestly carry, which is why they were still on the legacy queue: the outbox
 * refuses a row without one, and inventing a `legacy` scope for them would have
 * been a lie that passed.
 *
 * ── WHAT CAN CHANGE UNDERNEATH IT ───────────────────────────────────────────
 *
 * Everything that decides whether this person may still speak for this business
 * on this connection:
 *
 *   · the account can be deactivated — somebody left, or was removed after
 *     sending something they should not have. A queued message going out
 *     afterwards is the one case an operator most specifically tried to stop;
 *   · the role can be reduced. An agent demoted out of sending rights has no
 *     more authority over a queued message than over a new one;
 *   · the user can be moved to another tenant, or removed from this one. Then
 *     the message would leave a business they no longer belong to;
 *   · the connection can stop being this tenant's.
 *
 * The first three are facts about the USER, and the revision hashes them. The
 * fourth is a fact about the CONNECTION, and it is read separately by
 * `connectionStillTheirs` — because the question is whether the connection is
 * still usable, not whether its row is byte-identical to the one seen at
 * prepare. For a while the docblock claimed all four and the code checked
 * three: nothing read `channel_accounts`, so a reply queued before a number
 * was disconnected or moved to another business was still admitted and sent.
 *
 * Both are revalidated inside the transaction that grants the lease — the same
 * rule the other two authorities follow, for the same reason: a check that
 * commits separately answers about a moment that has already passed, and the
 * window between it and the POST is where the revocation lands.
 *
 * ── WHY IT IS NOT "THE REQUEST WAS AUTHENTICATED" ───────────────────────────
 *
 * Because authentication happened at the edge, minutes or hours before the
 * message leaves, and it is not re-checkable later: a JWT proves who asked, not
 * who may still speak. The authority has to be a fact the admitting transaction
 * can READ, and a user row is exactly that.
 */

export const HUMAN_OPERATOR_POLICY_VERSION = 1;

/** Roles that may put a message on a customer's channel. Deny by default. */
export const SENDING_ROLES: readonly string[] = Object.freeze([
    'super_admin', 'tenant_admin', 'tenant_supervisor', 'tenant_agent',
]);

/**
 * How the effect was started by a person. Kept because the two are not the same
 * risk: a console send is a human looking at the thread, an API send is a
 * machine holding a tenant's key, and an operator reading a bill is entitled to
 * see which of the two spent the money.
 */
export type HumanOperatorSurface = 'agent_console' | 'tenant_api';

export type HumanOperatorAuthority = Readonly<{
    kind: 'human_operator';
    tenantId: string;
    schemaName: string;
    /** `public.users.id` — the real actor, never an impersonated one. */
    userId: string;
    surface: HumanOperatorSurface;
    /** The connection the effect leaves from, and therefore who pays. */
    channelType: string;
    channelAccountId: string;
    /**
     * The standing this effect was authorised under, recorded as evidence.
     *
     * NOT the gate: see `revalidateHumanOperator`. An audit of a disputed
     * message reads it to answer "what was this person at the moment they were
     * allowed to send it".
     */
    actorRevision: string;
    policyVersion: number;
}>;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const SURFACES: readonly HumanOperatorSurface[] = Object.freeze(['agent_console', 'tenant_api']);

export class HumanOperatorAuthorityError extends Error {
    readonly code: string;
    constructor(code: 'human_operator_invalid' | 'human_operator_revoked') {
        super(code);
        this.code = code;
        this.name = 'HumanOperatorAuthorityError';
    }
}

export function validHumanOperatorAuthority(
    value: unknown, schema: string, tenantId?: string,
): value is HumanOperatorAuthority {
    const scope = value as HumanOperatorAuthority;
    return !!scope && typeof scope === 'object'
        && scope.kind === 'human_operator'
        && /^[a-z][a-z0-9_]*$/.test(schema)
        && scope.schemaName === schema
        && UUID.test(scope.tenantId) && (!tenantId || scope.tenantId === tenantId)
        && UUID.test(scope.userId)
        && SURFACES.includes(scope.surface)
        && typeof scope.channelType === 'string' && /^[a-z_]{2,40}$/.test(scope.channelType)
        && typeof scope.channelAccountId === 'string'
        && !!scope.channelAccountId.trim() && scope.channelAccountId.length <= 300
        && HASH.test(scope.actorRevision)
        && Number.isInteger(scope.policyVersion) && scope.policyVersion > 0;
}

/**
 * The facts that decide whether this person may speak for this business.
 *
 * `null` means they may not — deactivated, gone, moved, or holding a role with
 * no sending rights. A caller that gets `null` prepares nothing, which is the
 * honest outcome: there is nobody to attribute the message to.
 *
 * A `super_admin` has no implicit tenant (platform mode), so their `tenant_id`
 * is deliberately not required to match; every other role must belong to the
 * tenant the message is leaving from, or the message is going out of a business
 * they were removed from.
 */
export async function humanOperatorRevision(
    query: RevisionQuery, tenantId: string, userId: string,
): Promise<string | null> {
    const [row] = await query<any[]>(
        // `FOR SHARE`, in the caller's transaction: the row must not change
        // between this check and the lease that authorises the POST.
        `SELECT id, role, is_active, tenant_id
           FROM public.users WHERE id = $1::uuid FOR SHARE`, [userId]);
    if (!row) return null;
    if (row.is_active !== true) return null;
    const role = String(row.role ?? '');
    if (!SENDING_ROLES.includes(role)) return null;
    if (role !== 'super_admin' && String(row.tenant_id ?? '') !== tenantId) return null;
    return revisionHash({
        role,
        isActive: true,
        // Normalised: a super_admin's null tenant and a tenant user's id are
        // both part of what "may this person send here" depends on.
        tenantId: row.tenant_id ?? null,
    });
}

/**
 * Is this connection still one this tenant may send from, right now?
 *
 * ── WHY THIS IS A SEPARATE READ AND NOT PART OF THE ACTOR HASH ──────────────
 *
 * The docblock at the top of this file lists four things that can change
 * underneath a queued human send, the fourth being "the connection can stop
 * being this tenant's", and then says the revision hashes exactly those. It
 * hashed three: nothing here read `channel_accounts` at all, so a reply queued
 * before a number was disconnected, deactivated or moved to another business
 * was still admitted and still sent. `AgentDispatchOutboxStore.admit` compares
 * the scope's channel against the ROW's binding, which proves the scope and the
 * row agree with each other — not that the connection is still this tenant's.
 *
 * It is a separate read rather than a fourth field in `revisionHash` for the
 * same reason the actor check is eligibility and not byte-equality: what
 * matters is whether the connection is STILL usable, not whether its row is
 * byte-identical to the one seen at prepare. A display name edited while the
 * reply sat in the queue must not drop a customer's message.
 *
 * `FOR SHARE` in the caller's transaction, like the other two, so the answer
 * cannot go stale between here and the lease that authorises the POST.
 */
async function connectionStillTheirs(
    query: RevisionQuery, tenantId: string, channelType: string, channelAccountId: string,
): Promise<boolean> {
    // ── NO ROW IS NOT THE SAME AS SOMEBODY ELSE'S ROW ───────────────────────
    //
    // The first version asked for this tenant's active row and read its absence
    // as "not theirs". `channel-token.service.ts:373-376` reasons about the same
    // table for the same question and says the opposite, correctly: "a tenant
    // provisioned before that table was populated has none, and reading absence
    // as `false` would disconnect them all at once". A revocation check that
    // revokes every legacy tenant is not a stricter check; it is an outage.
    //
    // So the query asks about the CONNECTION, not about this tenant's copy of
    // it, and the three answers stay distinct:
    //
    //   · a row owned by this tenant and active  → theirs, send;
    //   · a row that is inactive, or owned by somebody else → revoked, which is
    //     the case this function exists for;
    //   · no row at all → this connection predates the global table, so there is
    //     nothing here that says it was taken away. Allowed, deliberately: the
    //     other guards on the send path still apply, and `assessConnection`
    //     already treats the same absence the same way.
    const [row] = await query<any[]>(
        `SELECT tenant_id::text AS tenant_id, is_active
           FROM public.channel_accounts
          WHERE channel_type = $1 AND account_id = $2
          ORDER BY (tenant_id = $3::uuid) DESC, updated_at DESC NULLS LAST
          LIMIT 1
          FOR SHARE`,
        [channelType, channelAccountId, tenantId]);
    if (!row) return true;
    return String(row.tenant_id) === tenantId && row.is_active !== false;
}

/** Build one, or `undefined` when this person may not send from this connection. */
export async function humanOperatorAuthority(
    query: RevisionQuery, schema: string, input: {
        readonly tenantId: string;
        readonly userId: string;
        readonly surface: HumanOperatorSurface;
        readonly channelType: string;
        readonly channelAccountId: string;
    },
): Promise<HumanOperatorAuthority | undefined> {
    const actorRevision = await humanOperatorRevision(query, input.tenantId, input.userId);
    if (!actorRevision) return undefined;
    // Caught here as well as at admit. A scope that could never be revalidated
    // should not be minted: preparing a durable row against a connection this
    // tenant does not hold commits an effect whose only possible outcome is a
    // suppression, and the producer has already been told it was accepted.
    if (!await connectionStillTheirs(query, input.tenantId, input.channelType,
        input.channelAccountId)) {
        return undefined;
    }
    const scope: HumanOperatorAuthority = Object.freeze({
        kind: 'human_operator' as const,
        tenantId: input.tenantId,
        schemaName: schema,
        userId: input.userId,
        surface: input.surface,
        channelType: input.channelType,
        channelAccountId: input.channelAccountId,
        actorRevision,
        policyVersion: HUMAN_OPERATOR_POLICY_VERSION,
    });
    return validHumanOperatorAuthority(scope, schema, input.tenantId) ? scope : undefined;
}

/** What the revalidation decided. `revoked` is a suppression, not a failure. */
export type HumanOperatorRevalidation =
    | { readonly kind: 'current' }
    | { readonly kind: 'revoked'; readonly detail: string };

/**
 * May this person still send this, right now, in this transaction?
 *
 * MUST run in the same transaction that grants the lease.
 */
export async function revalidateHumanOperator(
    query: RevisionQuery, schema: string, scope: HumanOperatorAuthority,
): Promise<HumanOperatorRevalidation> {
    if (!validHumanOperatorAuthority(scope, schema)) {
        throw new HumanOperatorAuthorityError('human_operator_invalid');
    }
    const [tenant] = await query<any[]>(
        `SELECT id FROM public.tenants
          WHERE id = $1::uuid AND schema_name = $2 AND is_active = true FOR SHARE`,
        [scope.tenantId, schema]);
    if (!tenant) throw new HumanOperatorAuthorityError('human_operator_invalid');

    if (scope.policyVersion !== HUMAN_OPERATOR_POLICY_VERSION) {
        // What a human send is allowed to mean changed between preparing and
        // sending. The old effect is not covered by the new rule.
        return { kind: 'revoked', detail: `policy_version:${scope.policyVersion}` };
    }
    // ── ELIGIBILITY, NOT BYTE-EQUALITY ──────────────────────────────────────
    //
    // `humanOperatorRevision` answers `null` for every way the right to send
    // can be taken away: deactivated, moved to another business, or holding a
    // role that may not send. That is the question, and it is the whole
    // question.
    //
    // Comparing the hash as well looked stricter and was strictly worse. The
    // only case it adds is a move between two roles that BOTH may send — an
    // agent promoted to supervisor — and suppressing there would drop a
    // customer's reply because somebody got a promotion while it sat in the
    // queue. A revalidation that produces only false positives is not a
    // stricter check; it is a worse one.
    //
    // `actorRevision` stays on the scope as EVIDENCE: it records the standing
    // the effect was authorised under, which is what an audit of a message
    // somebody disputes needs to read. Evidence and gate are different jobs.
    const current = await humanOperatorRevision(query, scope.tenantId, scope.userId);
    if (!current) return { kind: 'revoked', detail: `user_may_not_send:${scope.userId}` };
    // The fourth thing the docblock promised. Disconnected, deleted, or moved
    // to another business: in the last case the message would leave from a
    // number that now belongs to somebody else's WABA, and be billed to them.
    if (!await connectionStillTheirs(query, scope.tenantId, scope.channelType,
        scope.channelAccountId)) {
        return {
            kind: 'revoked',
            detail: `connection_not_available:${scope.channelType}:${scope.channelAccountId}`,
        };
    }
    return { kind: 'current' };
}
