/**
 * Canonical failure codes for connecting an Instagram or a Messenger account.
 *
 * Why this exists: until now both handlers answered a failed connection with
 * prose — sometimes Meta's own prose, forwarded verbatim. In the recorded
 * 48-minute session the owner hit that wall and had nothing to do next. The
 * rule for this wave is that every failure ends in an action the person can
 * take, and Meta's text is never shown; so the server names WHAT happened with
 * a stable code and the dashboard owns WHAT TO DO about it.
 *
 * Deliberately no human message lives here. The copy belongs in the dashboard's
 * i18n (es/en/pt/fr), where it can be written for the person and translated;
 * a message frozen in a shared package would only be shown in one language and
 * would drift from the action next to it.
 *
 * Shape mirrors `apps/whatsapp/src/common/enums/onboarding-error.enum.ts`: a
 * set of codes, a set of the ones that a retry can fix, and one predicate that
 * both sides ask instead of each keeping its own list.
 */

/** The two Meta surfaces a tenant connects by itself. */
export type MetaConnectChannel = 'instagram' | 'messenger';

export const META_CONNECT_ERROR = {
    /** The Instagram account behind the login is a personal one, not professional. */
    ACCOUNT_NOT_PROFESSIONAL: 'meta_connect_account_not_professional',
    /** The Facebook account manages no page at all. */
    NO_PAGE: 'meta_connect_no_page',
    /**
     * The person is not an administrator of the page they chose, or the page
     * came back without the tasks / without a page token we need to operate it.
     */
    NOT_PAGE_ADMIN: 'meta_connect_not_page_admin',
    /**
     * The scopes we need were declined or never granted. Carries the names as
     * evidence so the dashboard can say exactly which switch to turn on.
     */
    PERMISSIONS_MISSING: 'meta_connect_permissions_missing',
    /** There is no professional Instagram account attached to what was authorized. */
    NO_INSTAGRAM_BUSINESS_ACCOUNT: 'meta_connect_no_instagram_business_account',
    /** Meta's window was closed, or it came back with no authorization code. */
    WINDOW_CANCELLED: 'meta_connect_window_cancelled',
    /** Meta refused the authorization code or the token we sent it. */
    TOKEN_EXCHANGE_FAILED: 'meta_connect_token_exchange_failed',
    /**
     * The plan's per-type account limit is reached.
     *
     * This one keeps the platform-wide literal `plan_limit_reached` on purpose:
     * `TenantThrottleService.enforceChannelAccountLimit` already throws it for
     * every channel, and the panel already recognises it. Renaming it here
     * would have split one product rule into two codes for the same wall.
     */
    PLAN_LIMIT: 'plan_limit_reached',
    /** Anything we could not classify. Trying again is a legitimate next step. */
    UNAVAILABLE: 'meta_connect_unavailable',
} as const;

export type MetaConnectErrorCode = (typeof META_CONNECT_ERROR)[keyof typeof META_CONNECT_ERROR];

export const META_CONNECT_ERROR_CODES: readonly MetaConnectErrorCode[] =
    Object.freeze(Object.values(META_CONNECT_ERROR) as MetaConnectErrorCode[]);

/**
 * Failures where opening Meta's window again IS the next step: nothing about
 * the account has to change first, so offering "try again" is honest.
 *
 * Everything else is a wall that a retry repeats: a personal account stays
 * personal, an account with no page still has no page, someone who is not an
 * administrator does not become one, and the plan does not grow by
 * re-authorizing. Showing "retry" there is sending the person to do the same
 * thing six times, which is what the recording captured.
 */
const RETRYABLE_META_CONNECT_ERRORS: ReadonlySet<string> = new Set<string>([
    META_CONNECT_ERROR.PERMISSIONS_MISSING,
    META_CONNECT_ERROR.WINDOW_CANCELLED,
    META_CONNECT_ERROR.TOKEN_EXCHANGE_FAILED,
    META_CONNECT_ERROR.UNAVAILABLE,
]);

/**
 * Whether the dashboard should offer to relaunch Meta's window for this code.
 * Unknown codes are treated as walls, not as retries: inventing a retry button
 * for something we do not understand is how a person ends up looping.
 */
export function isRetryableMetaConnectError(code: string): boolean {
    return RETRYABLE_META_CONNECT_ERRORS.has(code);
}

export function isMetaConnectErrorCode(code: unknown): code is MetaConnectErrorCode {
    return typeof code === 'string' && (META_CONNECT_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Facts about the failure, never sentences. Only things the person's own
 * account produced — scope names, counts — so the dashboard can name them in
 * its own copy. Meta's `error.message` / `error_description` never travels
 * here: it is logged on the server for support and stops there.
 */
export interface MetaConnectErrorEvidence {
    /** Scopes we need that the token does not carry. */
    missingScopes?: string[];
    /** Scopes the person explicitly declined in Meta's dialog. */
    declinedScopes?: string[];
    /** `account_type` as Meta reported it (e.g. `PERSONAL`). */
    accountType?: string;
    /** How many pages the account manages, when that is the point. */
    pageCount?: number;
    /** Pages skipped because Meta returned them without a page token. */
    pagesWithoutToken?: number;
    /** Page names left unconnected because the plan's limit was reached. */
    skippedPages?: string[];
    /** The plan's per-type limit; `null` when unlimited. */
    limit?: number | null;
}

/** The body both Meta connect handlers answer a failure with. */
export interface MetaConnectErrorBody {
    error: MetaConnectErrorCode;
    channel: MetaConnectChannel;
    retryable: boolean;
    evidence?: MetaConnectErrorEvidence;
    /**
     * Neutral fallback for surfaces that have not mapped the code yet. Never
     * Meta's text. The dashboard is expected to render its own copy from
     * `error` and ignore this.
     */
    message?: string;
}
