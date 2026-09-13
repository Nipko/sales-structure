import { ConnectionRefusedError, type ConnectionRefusalCode } from './connection-refusal';

/**
 * Whether a connection may still send, and whether its credential may still be
 * used — decided in ONE place because two resolvers were deciding it in none.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * Disconnecting a WhatsApp number deactivated `public.channel_accounts` and
 * revoked the tenant's credential. Neither resolver looked at either. They read
 * `tenant.whatsapp_channels` with no state test and took the newest
 * `system_user_token` with no test of `rotation_state` or `expires_at`, so a
 * disconnected number kept sending with a revoked token — and for five more
 * minutes after that, from a cache nobody cleared.
 *
 * Three authorities have to agree before an effect leaves:
 *
 *   1. the tenant's own channel row says `connected`;
 *   2. the global account row for that number is active;
 *   3. the credential is neither revoked, rotating, nor expired.
 *
 * Any of them saying no is a refusal with a code, never a fallback to another
 * number and never a "probably fine". Money and a customer's trust both leave
 * the building on the same request.
 *
 * ── WHY FAIL CLOSED ─────────────────────────────────────────────────────────
 *
 * An unknown state is refused, not allowed. A status this file has not heard of
 * is a status nobody reasoned about, and the failure modes are not symmetric: a
 * refusal is an operator seeing a code and reconnecting, while a wrong send is a
 * message from a business that thought it had disconnected, billed to a WABA
 * whose owner may have revoked our access on purpose.
 */

/** The only channel status that may put a message on somebody's phone. */
export const SENDABLE_CHANNEL_STATUS = 'connected';

/** Credential rotation states that may still sign a request. */
export const USABLE_ROTATION_STATES: ReadonlySet<string> = new Set(['active']);

export type UsabilityVerdict =
    | { readonly usable: true }
    | { readonly usable: false; readonly code: ConnectionRefusalCode; readonly detail: string };

const REFUSE = (code: ConnectionRefusalCode, detail: string): UsabilityVerdict =>
    Object.freeze({ usable: false as const, code, detail });
const ALLOW: UsabilityVerdict = Object.freeze({ usable: true as const });

/**
 * Is this connection in a state that may send?
 *
 * `accountActive` is the global `channel_accounts.is_active` for the same
 * number. It is passed rather than looked up here so the caller decides how to
 * read it — and `undefined` means "not consulted", which is NOT the same as
 * `false` and is the only value that does not refuse on its own.
 */
export function assessConnection(input: {
    readonly channelStatus?: string | null;
    readonly accountActive?: boolean | null;
}): UsabilityVerdict {
    const status = String(input.channelStatus ?? '').trim().toLowerCase();
    if (status !== SENDABLE_CHANNEL_STATUS) {
        return REFUSE('connection_disconnected',
            `channel_status=${status || 'unset'}`);
    }
    if (input.accountActive === false) {
        return REFUSE('connection_disconnected', 'channel_account_is_inactive');
    }
    return ALLOW;
}

/**
 * May this stored credential still be used?
 *
 * `rotating` is refused with the same code as `revoked`: a credential being
 * rotated is one whose replacement may already be live at Meta, and signing with
 * the outgoing half is how a send fails after the money is committed.
 */
export function assessCredential(input: {
    readonly rotationState?: string | null;
    readonly expiresAt?: Date | string | null;
    readonly now?: Date;
}): UsabilityVerdict {
    const state = String(input.rotationState ?? 'active').trim().toLowerCase();
    if (!USABLE_ROTATION_STATES.has(state)) {
        return REFUSE('credential_revoked', `rotation_state=${state || 'unset'}`);
    }
    if (input.expiresAt) {
        const expires = input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt);
        // An unparseable expiry is an expiry nobody can reason about.
        if (Number.isNaN(expires.getTime())) {
            return REFUSE('credential_revoked', 'expires_at_unreadable');
        }
        // `clock_timestamp()` semantics: the question is "is it expired NOW",
        // and a value frozen at the start of a long transaction answers it wrong.
        if (expires.getTime() <= (input.now ?? new Date()).getTime()) {
            return REFUSE('credential_expired', `expired_at=${expires.toISOString()}`);
        }
    }
    return ALLOW;
}

/** The same two questions, as a refusal a caller can let bubble. */
export function assertUsable(verdict: UsabilityVerdict, context: {
    readonly tenantId: string; readonly channelType: string; readonly requestedAccountId?: string | null;
}): void {
    if (verdict.usable) return;
    throw new ConnectionRefusedError(verdict.code, { ...context, detail: verdict.detail });
}

/**
 * The SQL predicate for "this row may send", for the paths that filter in the
 * database rather than in TypeScript.
 *
 * Written here so the filter and the assertion above can never disagree about
 * which rows are candidates — which matters most on the unnamed path, where a
 * disconnected sibling counting as a candidate would turn a tenant with one
 * usable number into `connection_ambiguous`.
 */
export function sendableChannelSql(alias = ''): string {
    const column = alias ? `${alias}.channel_status` : 'channel_status';
    return `COALESCE(lower(btrim(${column})), '') = '${SENDABLE_CHANNEL_STATUS}'`;
}
