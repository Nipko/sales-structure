/**
 * ═══ WHAT THE SIGNUP OF EACH CONNECTED NUMBER LEFT OPEN ═══
 *
 * Embedded Signup can finish with warnings that stop every reply — Meta did
 * not confirm the webhook subscription, or did not register the number — and
 * the WhatsApp service persists them on the onboarding row
 * (`whatsapp_onboardings.exchange_payload` → `warnings`). The dashboard only
 * ever saw them in the answer to the signup it had just run: the wizard's last
 * screen and Canales → WhatsApp said nothing about a number connected earlier,
 * or after a reload, and the owner of a number that cannot answer read
 * "Conectado".
 *
 * So `GET /channels/whatsapp/status` carries, per connected number, what the
 * latest completed signup OF THAT CONNECTION left open:
 *
 *   · tenant-scoped twice — only this tenant's onboarding rows, and only for
 *     the numbers this tenant has active;
 *   · the latest completed signup of the number (a later clean signup clears
 *     an earlier warning);
 *   · only while it still describes the connection: a number reconnected by
 *     hand afterwards (`metadata.source = 'manual_connect'`), or now on another
 *     WABA than the signup's, is not the connection that signup made, and its
 *     warnings are not said about it;
 *   · only codes both sides know (`WHATSAPP_SIGNUP_WARNING_CODES`), never the
 *     row's free text — and never the token that shares that JSON column: the
 *     query selects `exchange_payload->'warnings'` and nothing else from it.
 *
 * A read that fails answers `null` for every number ("we could not read it"),
 * never `[]` ("nothing is open"), so a screen can tell the two apart.
 */

import {
    whatsAppSignupWarningCodes,
    type WhatsAppSignupWarningCode,
} from '@parallext/shared';

/** What one number's latest signup left open, as the status endpoint answers it. */
export interface NumberSignupWarnings {
    /** Known codes, in the order the signup wrote them. `[]` = nothing open, or no signup made this connection. */
    readonly codes: WhatsAppSignupWarningCode[];
    /** When that signup completed, when one describes this connection. */
    readonly recordedAt: string | null;
}

/** The latest completed onboarding row of one number, as the query returns it. */
export interface LatestSignupRow {
    readonly phone_number_id: string;
    readonly waba_id: string | null;
    readonly warnings: unknown;
    readonly completed_at: Date | string | null;
}

export interface ConnectedAccountRef {
    readonly accountId: string;
    readonly metadata: unknown;
}

const NONE: NumberSignupWarnings = Object.freeze({ codes: [], recordedAt: null });

function text(value: unknown): string | null {
    const trimmed = String(value ?? '').trim();
    return trimmed ? trimmed : null;
}

function isoOf(value: Date | string | null): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Whether a recorded signup is the connection the account row describes now. */
export function signupDescribesConnection(account: ConnectedAccountRef, signup: LatestSignupRow): boolean {
    const metadata = (account.metadata && typeof account.metadata === 'object'
        ? account.metadata : {}) as Record<string, unknown>;
    // The manual path wrote this row after (or without) any signup.
    if (text(metadata.source) === 'manual_connect') return false;
    const accountWaba = text(metadata.wabaId);
    const signupWaba = text(signup.waba_id);
    return !(accountWaba && signupWaba && accountWaba !== signupWaba);
}

/** What the status endpoint says about one connected number. Pure. */
export function signupWarningsForAccount(
    account: ConnectedAccountRef,
    latest: LatestSignupRow | undefined,
): NumberSignupWarnings {
    if (!latest || !signupDescribesConnection(account, latest)) return NONE;
    return { codes: whatsAppSignupWarningCodes(latest.warnings), recordedAt: isoOf(latest.completed_at) };
}

/**
 * The latest completed signup of every listed number of this tenant, one row
 * per number. `tenant_id` is TEXT on this table; comparing its text to the
 * parameter cast through uuid keeps the parameter validated and the index
 * usable either way.
 */
export const LATEST_SIGNUP_WARNINGS_SQL = `
    SELECT DISTINCT ON (phone_number_id)
           phone_number_id, waba_id, exchange_payload->'warnings' AS warnings, completed_at
      FROM public.whatsapp_onboardings
     WHERE tenant_id::text = $1::uuid::text
       AND phone_number_id = ANY($2::text[])
       AND status IN ('COMPLETED', 'COMPLETED_WITH_WARNINGS')
     ORDER BY phone_number_id, completed_at DESC NULLS LAST, created_at DESC`;

interface RawQuery {
    $queryRawUnsafe(query: string, ...values: any[]): Promise<unknown>;
}

/**
 * Per connected number, what its signup left open; `null` when it could not be
 * read. Never throws: the status it decorates must answer either way.
 */
export async function readSignupWarnings(
    prisma: RawQuery,
    tenantId: string,
    accounts: readonly ConnectedAccountRef[],
    onError?: (error: unknown) => void,
): Promise<Map<string, NumberSignupWarnings> | null> {
    const ids = [...new Set(accounts.map(account => text(account.accountId)).filter((id): id is string => !!id))];
    const result = new Map<string, NumberSignupWarnings>();
    if (ids.length === 0) return result;
    let rows: LatestSignupRow[];
    try {
        rows = (await prisma.$queryRawUnsafe(LATEST_SIGNUP_WARNINGS_SQL, tenantId, ids)) as LatestSignupRow[];
    } catch (error) {
        onError?.(error);
        return null;
    }
    const latest = new Map((Array.isArray(rows) ? rows : []).map(row => [String(row.phone_number_id), row]));
    for (const account of accounts) {
        const id = text(account.accountId);
        if (id) result.set(id, signupWarningsForAccount(account, latest.get(id)));
    }
    return result;
}
