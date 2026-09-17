import {
  META_CONNECT_ERROR,
  isMetaConnectErrorCode,
  isRetryableMetaConnectError,
  type MetaConnectChannel,
  type MetaConnectErrorCode,
} from "@parallext/shared";

/**
 * A failed Instagram/Messenger connection, turned into ONE thing to do.
 *
 * In the recording the owner hit Meta's wall and the screen printed Meta's own
 * sentence back at her — "la ventana se cerró antes de terminar" — with nothing
 * to press. The rule for this wave is the opposite: the provider's prose never
 * reaches the screen, and every failure ends in exactly one action.
 *
 * The API names WHAT happened with a stable code (`@parallext/shared`'s
 * `meta-connect-errors`); this module decides WHAT TO DO about it, which is a
 * dashboard question: which card to render, and whether the one action is a
 * retry, a link, or nothing at all. Anything that is not a code we know —
 * including the raw `message` of an unmapped 500 — becomes `generic` rather
 * than being shown.
 *
 * Lives outside the two page components so it can be tested without a DOM or
 * the ESM-only `next-intl` chain they pull in.
 */

export type ConnectChannel = MetaConnectChannel;

/**
 * Failures that never reach the API: the window did not open, the connector did
 * not load, the pop-up came back without an authorization. They share the card
 * shape on purpose — a person cannot tell which side of the wire failed, and
 * should not have to.
 */
export const CLIENT_CONNECT_ERROR_CODES = [
  "popup_blocked",
  "sdk_not_loaded",
  "config_missing",
  "session_mismatch",
  "already_used",
  "timeout",
  // Refused before Meta is ever called, by a guard on our own side. They are
  // not Meta codes, but they arrive on the same wire and they are the two the
  // person can actually fix — telling her to "try again" is the loop this
  // whole wave exists to kill.
  "email_not_verified",
  "channel_not_available",
] as const;

export type ClientConnectErrorCode = typeof CLIENT_CONNECT_ERROR_CODES[number];

export type ConnectErrorCode = MetaConnectErrorCode | ClientConnectErrorCode;

export interface ChannelConnectFailure {
  /** i18n key under `channels.<channel>.errors`. Always renders `.title`/`.action`. */
  key: string;
  /** Whether the ONE action is "open the window again". */
  retryable: boolean;
  /** Set when the one action lives on another screen. */
  href?: string;
  hrefLabelKey?: string;
}

const CLIENT_CODES = new Set<string>(CLIENT_CONNECT_ERROR_CODES);

export function isClientConnectErrorCode(value: unknown): value is ClientConnectErrorCode {
  return typeof value === "string" && CLIENT_CODES.has(value);
}

export function isConnectErrorCode(value: unknown): value is ConnectErrorCode {
  return isMetaConnectErrorCode(value) || isClientConnectErrorCode(value);
}

/**
 * Code → card, per channel.
 *
 * Deliberately NOT exhaustive over the shared union. Instagram connects through
 * Instagram Business Login: there is no Facebook page in that flow, so `NO_PAGE`
 * and `NOT_PAGE_ADMIN` would be an instruction nobody there can follow, and they
 * fall through to `generic`. Messenger is the mirror image for the two
 * Instagram-account codes. A card naming something the person cannot act on is
 * worse than a generic one.
 */
const CARD_KEY_BY_CODE: Record<ConnectChannel, Partial<Record<ConnectErrorCode, string>>> = {
  instagram: {
    [META_CONNECT_ERROR.ACCOUNT_NOT_PROFESSIONAL]: "accountNotProfessional",
    [META_CONNECT_ERROR.NO_INSTAGRAM_BUSINESS_ACCOUNT]: "noInstagramBusinessAccount",
    [META_CONNECT_ERROR.PERMISSIONS_MISSING]: "permissionsMissing",
    [META_CONNECT_ERROR.WINDOW_CANCELLED]: "windowCancelled",
    [META_CONNECT_ERROR.TOKEN_EXCHANGE_FAILED]: "tokenExchangeFailed",
    [META_CONNECT_ERROR.PLAN_LIMIT]: "planLimit",
    [META_CONNECT_ERROR.UNAVAILABLE]: "unavailable",
    popup_blocked: "popupBlocked",
    session_mismatch: "sessionMismatch",
    already_used: "alreadyUsed",
    timeout: "timeout",
    email_not_verified: "emailNotVerified",
    channel_not_available: "channelNotAvailable",
  },
  messenger: {
    [META_CONNECT_ERROR.NO_PAGE]: "noPage",
    [META_CONNECT_ERROR.NOT_PAGE_ADMIN]: "notPageAdmin",
    [META_CONNECT_ERROR.PERMISSIONS_MISSING]: "permissionsMissing",
    [META_CONNECT_ERROR.WINDOW_CANCELLED]: "windowCancelled",
    [META_CONNECT_ERROR.TOKEN_EXCHANGE_FAILED]: "tokenExchangeFailed",
    [META_CONNECT_ERROR.PLAN_LIMIT]: "planLimit",
    [META_CONNECT_ERROR.UNAVAILABLE]: "unavailable",
    popup_blocked: "popupBlocked",
    sdk_not_loaded: "sdkNotLoaded",
    config_missing: "configMissing",
    email_not_verified: "emailNotVerified",
    channel_not_available: "channelNotAvailable",
  },
};

/**
 * Whether retrying is the fix, for the failures the API never sees.
 *
 * The shared `isRetryableMetaConnectError` answers this for every code that
 * comes off the wire, and it is asked rather than mirrored — two lists would
 * drift, and the drift would show up as a retry button in front of a wall.
 * These six are the client's own, so they need their own answer: `already_used`
 * and `timeout` ask the person to LOOK first, because the connection may have
 * landed, and a retry button beside that sentence contradicts it;
 * `config_missing` is ours to fix.
 */
const RETRYABLE_CLIENT_CODES = new Set<string>(["popup_blocked", "sdk_not_loaded", "session_mismatch"]);

/** The cards that send the person somewhere else instead of retrying. */
const HREF_BY_CARD_KEY: Record<string, { href: string; hrefLabelKey: string }> = {
  planLimit: { href: "/admin/settings/billing", hrefLabelKey: "goToBilling" },
  channelNotAvailable: { href: "/admin/settings/billing", hrefLabelKey: "goToBilling" },
  emailNotVerified: { href: "/verify-email", hrefLabelKey: "goToVerifyEmail" },
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The code, and ONLY a code.
 *
 * `apiPost` puts the service's stable code in `errorCode` for a non-2xx and
 * leaves it in `error` for a 200 body that says `success: false` — but on a
 * non-2xx it also puts the server's PROSE in `error`. Membership in the union
 * is what separates the two, so prose can never be mistaken for a code and
 * printed as one.
 */
export function readConnectErrorCode(body: unknown): ConnectErrorCode | null {
  if (!isRecord(body)) return null;
  for (const candidate of [body.errorCode, body.error, body.code]) {
    if (isConnectErrorCode(candidate)) return candidate;
  }
  if (isRecord(body.message)) return readConnectErrorCode(body.message);
  return null;
}

/**
 * The service's own verdict on retrying, when it survives the trip.
 *
 * It often does not: `apiPost` rebuilds the envelope for a non-2xx and keeps
 * only `errorCode`, so most failures arrive here without it and fall back to
 * the shared predicate — which is the same rule the server applied.
 */
export function readConnectRetryable(body: unknown): boolean | null {
  if (!isRecord(body)) return null;
  if (typeof body.retryable === "boolean") return body.retryable;
  if (isRecord(body.message)) return readConnectRetryable(body.message);
  return null;
}

/**
 * The evidence the API attaches (scope names, page counts). For the console and
 * for support, never for the screen: it is jargon at best, and the place where
 * Meta's own wording would leak if it ever did.
 */
export function readConnectEvidence(body: unknown): unknown {
  if (!isRecord(body)) return undefined;
  if (body.evidence !== undefined) return body.evidence;
  if (isRecord(body.message)) return readConnectEvidence(body.message);
  return undefined;
}

/**
 * Every card key a channel can render, `generic` included.
 *
 * Exported so the copy contract can be taken from the mapping instead of from a
 * list pasted into a spec — a list would stop noticing the day a new code is
 * mapped without its four translations.
 */
export function connectCardKeys(channel: ConnectChannel): string[] {
  return Array.from(new Set([...Object.values(CARD_KEY_BY_CODE[channel]), "generic"])).sort();
}

function defaultRetryable(code: unknown, cardKey: string): boolean {
  if (cardKey === "generic") return true;
  if (isClientConnectErrorCode(code)) return RETRYABLE_CLIENT_CODES.has(code);
  return typeof code === "string" && isRetryableMetaConnectError(code);
}

/** Card for a code we already hold (a client failure, or one off the wire). */
export function connectFailureForCode(
  channel: ConnectChannel,
  code: unknown,
  serverRetryable: boolean | null = null,
): ChannelConnectFailure {
  const key = (isConnectErrorCode(code) ? CARD_KEY_BY_CODE[channel][code] : undefined) ?? "generic";
  return {
    key,
    retryable: serverRetryable ?? defaultRetryable(code, key),
    ...(HREF_BY_CARD_KEY[key] ?? {}),
  };
}

/** Card for a failed connect response body. */
export function mapConnectFailure(channel: ConnectChannel, body: unknown): ChannelConnectFailure {
  return connectFailureForCode(channel, readConnectErrorCode(body), readConnectRetryable(body));
}
