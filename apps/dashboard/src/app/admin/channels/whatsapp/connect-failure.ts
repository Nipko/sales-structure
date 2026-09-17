/**
 * A failure the person can act on: what happened, and the one thing to do next.
 *
 * Until now every one of these arrived as raw Spanish prose from the WhatsApp
 * service — untranslated for three of our four locales, and with no next step
 * attached. The service already emits stable codes; this maps them.
 *
 * Lives outside `WhatsAppEmbeddedSignup.tsx` so it can be tested without a DOM
 * or the ESM-only `next-intl` chain the component pulls in.
 */
export interface ConnectFailure {
  /** i18n key under `channels.whatsapp.errors`. */
  key: string;
  /** Server prose, kept as a detail line when it adds something. */
  detail?: string;
  /** Where the fix lives, when it is another screen. */
  href?: string;
  hrefLabelKey?: string;
  /** Show the Retry button, which opens a NEW Meta window. */
  retryable: boolean;
}

/** Service code → i18n key. Both prefixed and bare forms are seen in the wild. */
const ERROR_KEY_BY_CODE: Record<string, string> = {
  WA_ES_DUPLICATE_CUSTOMER_BINDING: "onboardingInProgress",
  // The two coverage codes are only ever about ANOTHER number that is already
  // connected: its card says to disconnect that one or call support.
  WHATSAPP_TOKEN_COVERAGE_REQUIRED: "tokenCoverage",
  WHATSAPP_TOKEN_MISSING_WABA_SCOPE: "tokenCoverage",
  // Meta left out the number being connected. Nothing to disconnect: the fix is
  // a new Meta window where the person picks that number, so it gets its own
  // card with Retry. Without this entry the 409 fell through to
  // "onboardingInProgress", which is not what happened either.
  WHATSAPP_TOKEN_TARGET_NOT_GRANTED: "tokenTargetNotGranted",
  PLAN_LIMIT_REACHED: "planLimit",
  CHANNEL_ACCESS_DENIED: "channelNotInPlan",
  CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE: "entitlementUnavailable",
  WA_ES_CONFIG_INVALID: "invalidConfig",
  WA_ES_PHONE_REGISTRATION_FAILED: "phoneRegistration",
  WA_ES_PERMISSIONS_INSUFFICIENT: "permissions",
  WA_ES_COEXISTENCE_NOT_ACKNOWLEDGED: "coexistenceNotAcknowledged",
  WA_ES_CODE_EXPIRED: "codeExpired",
  WA_ES_RATE_LIMITED: "rateLimited",
  WA_ES_TENANT_NOT_FOUND: "invalidConfig",
};

const RETRYABLE_ERROR_KEYS = new Set([
  "network",
  "onboardingInProgress",
  "entitlementUnavailable",
  "rateLimited",
  "codeExpired",
  // Its text asks for a new Meta window, so the button must be there even when
  // the body arrives without `retryable` (e.g. wrapped under `message`).
  "tokenTargetNotGranted",
  "popupBlocked",
  "generic",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readServerErrorCode(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const direct = body.code ?? body.errorCode;
  if (typeof direct === "string" && direct) return direct.toUpperCase();
  // Nest wraps the thrown object under `message` for some exception filters.
  if (isRecord(body.message)) return readServerErrorCode(body.message);
  return null;
}

/**
 * Lo ÚNICO del servidor que se le puede mostrar a una persona.
 *
 * `userMessage` es el campo que el servicio escribe pensado para leerse; el
 * resto no. `message` en un 500 sin mapear de Nest vale literalmente "Internal
 * server error", y así salía impreso bajo la tarjeta ámbar, en inglés, en las
 * cuatro configuraciones de idioma.
 */
export function readServerUserMessage(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const direct = body.userMessage;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (isRecord(body.message)) return readServerUserMessage(body.message);
  return undefined;
}

/** Prosa técnica del servidor: sirve para la consola, nunca para la pantalla. */
export function readServerDiagnostics(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  for (const candidate of [body.message, body.error]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  if (isRecord(body.message)) return readServerDiagnostics(body.message);
  return undefined;
}

export function readOnboardingId(body: unknown): string | null {
  if (!isRecord(body)) return null;
  for (const key of ["onboardingId", "id", "existingOnboardingId"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (isRecord(body.message)) return readOnboardingId(body.message);
  return null;
}

/** Map a failed `/onboarding/start` into something with a next step. */
export function mapConnectFailure(status: number, body: unknown): ConnectFailure {
  const code = readServerErrorCode(body);
  const key = (code && ERROR_KEY_BY_CODE[code])
    || (status === 409 ? "onboardingInProgress" : null)
    || (status === 402 || status === 403 ? "channelNotInPlan" : null)
    || "generic";
  const serverRetryable = isRecord(body) && typeof body.retryable === "boolean" ? body.retryable : null;

  return {
    key,
    detail: readServerUserMessage(body),
    href: key === "planLimit" ? "/admin/settings/billing" : undefined,
    hrefLabelKey: key === "planLimit" ? "goToBilling" : undefined,
    retryable: serverRetryable ?? RETRYABLE_ERROR_KEYS.has(key),
  };
}
