/**
 * Channel credential health — the ONE definition of "this connection can
 * actually send".
 *
 * It used to live twice: inline in `agent-quality.service.ts` (where a missing
 * `whatsapp_credentials` row counted as `missing` = failure) and inline in
 * `channel-management.controller.ts` (where the same absence returned
 * `unknown`, which the Canales page hides). So Salud de agentes raised a
 * critical action while Canales showed the channel green, and the person had
 * no way to see what the alert meant.
 *
 * Pure functions, no DI: both the quality service and the channels controller
 * feed it the same facts and get the same answer.
 */

export type ChannelCredentialHealth =
    | 'ok'
    | 'expiring'
    | 'unknown'
    | 'missing'
    | 'error'
    | 'revoked'
    | 'expired';

/** Per-channel row in `whatsapp_credentials.credential_type` (tenant-wide token). */
export const CREDENTIAL_TYPE_BY_CHANNEL: Record<string, string> = {
    whatsapp: 'system_user_token',
    instagram: 'instagram_token',
    messenger: 'messenger_token',
    telegram: 'telegram_token',
};

/** Placeholders written by older flows that never held a usable token. */
export const NON_TOKEN_PLACEHOLDERS = new Set(['', 'encrypted_ref', 'credential_ref']);

/** A credential is "about to break" a week before it expires. */
export const EXPIRY_WARNING_MS = 7 * 86_400_000;

/** Worst-first ranking. `ok` is the only value that means "nothing to do". */
const HEALTH_RANK: Record<ChannelCredentialHealth, number> = {
    ok: 0,
    expiring: 1,
    unknown: 2,
    missing: 3,
    error: 4,
    revoked: 5,
    expired: 6,
};

export interface ChannelCredentialRecord {
    rotationState?: string | null;
    expiresAt?: Date | string | null;
}

export interface ResolveCredentialHealthInput {
    channelType: string;
    /** `channel_accounts.access_token` holds a real value (see `hasRealToken`). */
    hasAccountToken: boolean;
    /** `channel_accounts.metadata`; only `tokenExpiresAt` is read (Instagram). */
    metadata?: Record<string, unknown> | null;
    /** Newest row of this channel's credential type, or null when there is none. */
    latestCredential: ChannelCredentialRecord | null;
    /** False when the credential table could not be read at all. */
    lookupAvailable: boolean;
    /** `whatsapp_channels.access_token_ref` holds a real value for this account. */
    hasLegacyWhatsAppToken: boolean;
    now?: number;
}

/** True when a stored token column holds a usable value and not a placeholder. */
export function hasRealToken(value: unknown): boolean {
    return typeof value === 'string' && !NON_TOKEN_PLACEHOLDERS.has(value.trim());
}

/** `expiresAt` alone: unreadable or absent dates are `unknown`, never `ok`. */
export function expiryHealth(
    value: Date | string | null | undefined,
    now: number = Date.now(),
): ChannelCredentialHealth {
    if (!value) return 'unknown';
    const expiresAt = new Date(value as Date | string).getTime();
    if (!Number.isFinite(expiresAt)) return 'unknown';
    const remaining = expiresAt - now;
    if (remaining < 0) return 'expired';
    if (remaining <= EXPIRY_WARNING_MS) return 'expiring';
    return 'ok';
}

/**
 * Health of a stored credential row. `missing` (no row, and we could read the
 * table) is a real failure; `unknown` (we could not read it) is not — claiming
 * a failure we did not observe is how the banner started lying.
 */
export function credentialRecordHealth(
    credential: ChannelCredentialRecord | null,
    lookupAvailable: boolean,
    now: number = Date.now(),
): ChannelCredentialHealth {
    if (!lookupAvailable) return 'unknown';
    if (!credential) return 'missing';
    if (credential.rotationState === 'error') return 'error';
    if (credential.rotationState === 'revoked') return 'revoked';
    if (credential.rotationState && credential.rotationState !== 'active') return 'unknown';
    return credential.expiresAt ? expiryHealth(credential.expiresAt, now) : 'ok';
}

/**
 * Health of ONE connected account.
 *
 * - `web_widget` carries no credential: it is healthy while it is active.
 * - WhatsApp reads the tenant-wide `system_user_token`, and a legacy per-number
 *   `whatsapp_channels.access_token_ref` rescues it (those numbers predate the
 *   system-user rollout and do send).
 * - Instagram with a per-account token expires by `metadata.tokenExpiresAt`.
 * - Any other channel with its own account token is healthy; without one it
 *   falls back to its per-type credential.
 */
export function resolveCredentialHealth(input: ResolveCredentialHealthInput): ChannelCredentialHealth {
    const now = input.now ?? Date.now();
    const channelType = input.channelType;

    if (channelType === 'web_widget') return 'ok';

    if (channelType === 'whatsapp') {
        const health = credentialRecordHealth(input.latestCredential, input.lookupAvailable, now);
        if ((health === 'missing' || health === 'unknown') && input.hasLegacyWhatsAppToken) return 'ok';
        return health;
    }

    if (channelType === 'instagram' && input.hasAccountToken) {
        const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
        return expiryHealth((metadata as Record<string, any>).tokenExpiresAt, now);
    }

    if (input.hasAccountToken) return 'ok';

    if (!CREDENTIAL_TYPE_BY_CHANNEL[channelType]) return 'unknown';
    return credentialRecordHealth(input.latestCredential, input.lookupAvailable, now);
}

/** The connection cannot send. This is what may raise a critical action. */
export function isCredentialFailure(health: ChannelCredentialHealth): boolean {
    return health === 'missing' || health === 'error' || health === 'revoked' || health === 'expired';
}

/** The connection still sends, but it is about to stop or we cannot confirm it. */
export function isCredentialWarning(health: ChannelCredentialHealth): boolean {
    return health === 'unknown' || health === 'expiring';
}

/**
 * Worst value of a set. An empty set is `missing`: "no account at all" is not
 * healthy. One expired account must never be hidden behind a healthy sibling.
 */
export function worstCredentialHealth(values: readonly ChannelCredentialHealth[]): ChannelCredentialHealth {
    let worst: ChannelCredentialHealth | null = null;
    for (const value of values) {
        if (worst === null || HEALTH_RANK[value] > HEALTH_RANK[worst]) worst = value;
    }
    return worst ?? 'missing';
}
