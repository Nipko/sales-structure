export interface EmbeddedSignupSessionData {
  business_id?: string;
  waba_id?: string;
  phone_number_id?: string;
}

export interface EmbeddedSignupEvent {
  event: string;
  data: Record<string, unknown>;
  session: EmbeddedSignupSessionData;
}

export const EMBEDDED_SIGNUP_FINISH_EVENTS = new Set([
  "FINISH",
  "FINISH_ONLY_WABA",
  "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
]);

export function buildEmbeddedSignupLoginOptions(
  configId: string,
  solutionId: string,
  mode: "standard" | "coexistence",
) {
  return {
    config_id: configId,
    response_type: "code",
    override_default_response_type: true,
    extras: {
      setup: {
        ...(solutionId ? { solutionID: solutionId } : {}),
      },
      ...(mode === "coexistence" ? {
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
      } : {}),
      version: "v4",
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function extractEmbeddedSignupSessionData(value: unknown): EmbeddedSignupSessionData {
  if (!isRecord(value)) return {};

  return {
    business_id: optionalId(value.business_id),
    waba_id: optionalId(value.waba_id),
    phone_number_id: optionalId(value.phone_number_id),
  };
}

export function parseEmbeddedSignupEvent(value: unknown): EmbeddedSignupEvent | null {
  let parsed = value;

  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!isRecord(parsed) || parsed.type !== "WA_EMBEDDED_SIGNUP" || typeof parsed.event !== "string") {
    return null;
  }

  const data = isRecord(parsed.data) ? parsed.data : {};
  return {
    event: parsed.event,
    data,
    session: extractEmbeddedSignupSessionData(data),
  };
}

/** What Meta posted as the end of the current launch, when it was not a FINISH. */
export type EmbeddedSignupTerminalEvent = "cancel" | "error" | null;

export interface AuthorizationCodeContext {
  /**
   * Codes this page already offered to the server or refused as leftovers. A
   * Meta code is single-use: once exchanged it can only come back as "This
   * authorization code has been used", and one that surfaced in a cancelled
   * launch never stood for an authorization in the first place.
   */
  handledCodes: ReadonlySet<string>;
  /** CANCEL/ERROR that Meta posted for the current launch, if any. */
  terminalEvent: EmbeddedSignupTerminalEvent;
  /** Whether Meta posted a FINISH* event for the current launch. */
  finishSeen: boolean;
}

export type AuthorizationCodeDecision =
  | { action: "submit"; code: string }
  | { action: "no_code" }
  | { action: "already_submitted"; code: string }
  | { action: "after_terminal_event"; code: string };

/**
 * Whether an `authResponse.code` handed to the FB.login callback is a NEW
 * authorization worth sending to the server.
 *
 * The Facebook SDK keeps the last `authResponse` in memory and hands it to a
 * later FB.login callback when the popup closes without finishing. That stale
 * code reached `/onboarding/start` in production, Meta answered "This
 * authorization code has been used", and the person saw a connection failure
 * when all they had done was close the window. Two signals give it away:
 *  - the page already handled that exact code (the SDK memory is per page, so
 *    the caller's memory must be per page too, not per component instance);
 *  - Meta posted CANCEL/ERROR for this launch and never a FINISH: nobody
 *    authorized anything, so any code in the callback is left over.
 *
 * Pure on purpose; `admitAuthorizationCode` is the one caller that records.
 */
export function decideAuthorizationCode(
  code: unknown,
  context: AuthorizationCodeContext,
): AuthorizationCodeDecision {
  if (typeof code !== "string" || !code.trim()) return { action: "no_code" };
  if (context.handledCodes.has(code)) return { action: "already_submitted", code };
  if (context.terminalEvent !== null && !context.finishSeen) {
    return { action: "after_terminal_event", code };
  }
  return { action: "submit", code };
}

/**
 * Decide on a code AND remember it, in one step, before anything is sent.
 *
 * `decideAuthorizationCode` only protects the server if the caller records
 * what it decided: forgetting to add a submitted code lets the SDK's next
 * re-delivery of that same code reach `/onboarding/start` again. Keeping the
 * two apart in the component is how that gap stayed untested, so the screen
 * calls this instead of deciding and recording by hand.
 *
 * Every code that is handled is recorded, not only the one sent: a code
 * refused as leftovers after a CANCEL never stood for an authorization, and
 * must stay refused if the SDK hands it over again on a later, clean launch.
 * `no_code` records nothing because there is nothing to record.
 *
 * `memory` must outlive the component instance (see `handledAuthorizationCodes`
 * in WhatsAppEmbeddedSignup.tsx): the SDK memory it guards is per page.
 */
export function admitAuthorizationCode(
  code: unknown,
  memory: Set<string>,
  context: Omit<AuthorizationCodeContext, "handledCodes">,
): AuthorizationCodeDecision {
  const decision = decideAuthorizationCode(code, { ...context, handledCodes: memory });
  if (decision.action !== "no_code") memory.add(decision.code);
  return decision;
}

export function getEmbeddedSignupErrorDetails(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const directCandidates = [value.error_message, value.error_description, value.message];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return isRecord(value.error) ? getEmbeddedSignupErrorDetails(value.error) : null;
}
