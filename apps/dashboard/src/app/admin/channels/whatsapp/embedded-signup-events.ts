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

export function getEmbeddedSignupErrorDetails(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const directCandidates = [value.error_message, value.error_description, value.message];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return isRecord(value.error) ? getEmbeddedSignupErrorDetails(value.error) : null;
}
