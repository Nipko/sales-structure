/**
 * ═══ THE BILLING TIME ZONE OF EACH WHATSAPP NUMBER ═══
 *
 * From 1 October 2026 Meta charges every service message, and the rate date and
 * the free monthly allowance are both counted in the WhatsApp account's own time
 * zone. The spend admission (apps/api, `WhatsappSpendService.authorize`) reads
 * `channel_accounts.waba_timezone` for the sending number and nothing else: with
 * no zone it refuses every chargeable send as `timezone_missing`, the dispatch
 * lane retries for about fifty minutes and then suppresses the reply.
 *
 * Meta only hands back a NUMERIC time zone id, and the platform refuses to map
 * it from memory, so a person has to confirm the zone once per business
 * account. The one writer is `POST /channels/whatsapp/connection/billing-timezone`
 * (WhatsappController, super_admin/tenant_admin, verified email), which also
 * carries the zone to sibling numbers of the same account that report the same
 * Meta id and answers which ones in `alsoApplied`.
 *
 * The read is `GET /channels/whatsapp/connection/billing-readiness`. Both routes
 * are served by WhatsappController: unlike `/status` and `/config`, no generic
 * `channels/:channelType/...` route matches them (checked against the real
 * router order, and pinned statically in the spec).
 *
 * Everything the screen decides lives here, as pure functions, so the rules
 * below are tested rather than restated in JSX:
 *  - "set" means the number HOLDS a zone the server recognises. A zone the
 *    reading merely infers from a sibling (`inherited`) is not what sending
 *    reads, so that number is still blocked and only gets a better suggestion;
 *  - a reading that failed is "unknown", never "set";
 *  - the suggestion is a starting value. Nothing here submits anything, and a
 *    request can only be built from a zone somebody picked from the list.
 */

export const BILLING_TIME_ZONE_ENDPOINT = "/channels/whatsapp/connection/billing-timezone";
export const BILLING_READINESS_ENDPOINT = "/channels/whatsapp/connection/billing-readiness";

/** Where most tenants' numbers are. A suggestion to confirm, never a default. */
export const SUGGESTED_BILLING_TIME_ZONE = "America/Bogota";

export type BillingZoneResolution = "known" | "inherited" | "unmapped" | "contradictory" | "unrecognized";

export interface BillingZoneNumber {
  /** Meta's phone number id (`channel_accounts.account_id`). */
  phoneNumberId: string;
  /** The zone the number itself holds — the only one sending reads. */
  zone: string | null;
  resolution: BillingZoneResolution;
  /** For `inherited`: the zone another number of the same account holds. */
  resolvedZone: string | null;
  /** For `contradictory`: the zones siblings disagree on. */
  candidateZones: string[];
  displayPhoneNumber: string | null;
}

export interface BillingZoneContradiction {
  wabaId: string;
  zones: string[];
  numbers: string[];
}

export interface BillingZoneReadiness {
  numbers: BillingZoneNumber[];
  contradictions: BillingZoneContradiction[];
}

export type BillingZoneState =
  | { kind: "set"; zone: string; conflictingZones: string[] }
  | {
      kind: "missing";
      /** A starting value for the picker. The person still has to confirm it. */
      suggestion: string | null;
      suggestionSource: "same_account" | "common" | null;
      conflictingZones: string[];
    }
  | { kind: "unknown" };

export type BillingZoneAccess = "form" | "ask_admin" | "verify_email";

export type BillingTimeZoneRequest =
  | { ok: true; body: { phoneNumberId: string; timeZone: string } }
  | { ok: false; reason: "number_missing" | "zone_missing" | "zone_not_in_list" };

export type BillingZoneSaveOutcome =
  | { kind: "saved"; timeZone: string; alsoApplied: string[] }
  | { kind: "invalid_zone" }
  | { kind: "verify_email" }
  | { kind: "not_allowed" }
  | { kind: "number_not_found" }
  | { kind: "failed" };

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((entry): entry is string => entry !== null) : [];
}

const RESOLUTIONS: readonly BillingZoneResolution[] = ["known", "inherited", "unmapped", "contradictory"];

/**
 * The readiness body, or null when there is no readable answer.
 *
 * Null and an empty list mean different things on screen: an empty list is a
 * tenant with no numbers, null is "we could not ask" — and the loader turns
 * every failure into null with `.catch(() => null)`.
 */
export function readBillingZoneReadiness(payload: unknown): BillingZoneReadiness | null {
  if (!isRecord(payload) || payload.success === false) return null;
  const data = isRecord(payload.data) ? payload.data : payload;
  if (!Array.isArray(data.numbers)) return null;

  const numbers: BillingZoneNumber[] = [];
  for (const entry of data.numbers) {
    if (!isRecord(entry)) continue;
    const phoneNumberId = text(entry.channelAccountId);
    if (!phoneNumberId) continue;
    const resolution = isRecord(entry.resolution) ? entry.resolution : {};
    const kind = RESOLUTIONS.find((candidate) => candidate === resolution.kind) ?? "unrecognized";
    const metadata = isRecord(entry.metadata) ? entry.metadata : {};
    numbers.push({
      phoneNumberId,
      zone: text(entry.zone),
      resolution: kind,
      resolvedZone: kind === "inherited" ? text(resolution.zone) : null,
      candidateZones: kind === "contradictory" ? texts(resolution.zones) : [],
      displayPhoneNumber: text(metadata.displayPhoneNumber),
    });
  }

  const contradictions: BillingZoneContradiction[] = [];
  for (const entry of Array.isArray(data.contradictions) ? data.contradictions : []) {
    if (!isRecord(entry)) continue;
    contradictions.push({ wabaId: text(entry.wabaId) ?? "", zones: texts(entry.zones), numbers: texts(entry.numbers) });
  }
  return { numbers, contradictions };
}

/** Whether one connected number can price a message, as far as its zone goes. */
export function billingZoneStateFor(phoneNumberId: string, readiness: BillingZoneReadiness | null): BillingZoneState {
  const id = phoneNumberId.trim();
  if (!readiness || !id) return { kind: "unknown" };
  const number = readiness.numbers.find((candidate) => candidate.phoneNumberId === id);
  if (!number) return { kind: "unknown" };

  // `known` is only answered for a zone the server's runtime can format with.
  // A body without a recognisable resolution still carries the column itself.
  if (number.zone && (number.resolution === "known" || number.resolution === "unrecognized")) {
    const conflict = readiness.contradictions.find((entry) => entry.numbers.includes(id));
    return { kind: "set", zone: number.zone, conflictingZones: conflict && conflict.zones.length > 1 ? conflict.zones : [] };
  }

  if (number.resolution === "contradictory") {
    return { kind: "missing", suggestion: null, suggestionSource: null, conflictingZones: number.candidateZones };
  }
  if (number.resolution === "inherited" && number.resolvedZone) {
    return { kind: "missing", suggestion: number.resolvedZone, suggestionSource: "same_account", conflictingZones: [] };
  }
  return { kind: "missing", suggestion: SUGGESTED_BILLING_TIME_ZONE, suggestionSource: "common", conflictingZones: [] };
}

/**
 * Who gets the form.
 *
 * The endpoint accepts super_admin and tenant_admin, and a tenant_admin only
 * with a verified email (super_admin always passes that guard). An explicit
 * `emailVerified: false` gets "verify first" instead of a button that refuses
 * after being pressed; an ABSENT field is an old session, not an unverified one.
 */
export function billingZoneAccess(
  user: { role?: string | null; emailVerified?: boolean } | null | undefined,
): BillingZoneAccess {
  if (user?.role === "super_admin") return "form";
  if (user?.role === "tenant_admin") return user.emailVerified === false ? "verify_email" : "form";
  return "ask_admin";
}

/** The exact body the endpoint reads, from a zone somebody picked from `options`. */
export function buildBillingTimeZoneRequest(
  phoneNumberId: string,
  timeZone: string,
  options: readonly string[],
): BillingTimeZoneRequest {
  const id = phoneNumberId.trim();
  const zone = timeZone.trim();
  if (!id) return { ok: false, reason: "number_missing" };
  if (!zone) return { ok: false, reason: "zone_missing" };
  if (!options.includes(zone)) return { ok: false, reason: "zone_not_in_list" };
  return { ok: true, body: { phoneNumberId: id, timeZone: zone } };
}

/**
 * What happened to a save, from the `apiPost` envelope.
 *
 * Decided by status and error code, never by the server's prose: the 400 text
 * is written for support, and a 403 from the role guard and one from the email
 * guard need different answers for the person reading them.
 */
export function readBillingZoneSaveOutcome(
  envelope: unknown,
  request: { phoneNumberId: string; timeZone: string },
): BillingZoneSaveOutcome {
  if (!isRecord(envelope)) return { kind: "failed" };
  if (envelope.success === true) {
    const data = isRecord(envelope.data) ? envelope.data : {};
    const alsoApplied = [...new Set(texts(data.alsoApplied))].filter((id) => id !== request.phoneNumberId);
    return { kind: "saved", timeZone: text(data.timeZone) ?? request.timeZone, alsoApplied };
  }
  switch (envelope.httpStatus) {
    case 400:
      return { kind: "invalid_zone" };
    case 403:
      return envelope.errorCode === "email_not_verified" ? { kind: "verify_email" } : { kind: "not_allowed" };
    case 404:
      return { kind: "number_not_found" };
    default:
      return { kind: "failed" };
  }
}

/** Used only when the browser cannot list its own zones. */
const FALLBACK_TIME_ZONES: readonly string[] = [
  "America/Bogota", "America/Mexico_City", "America/Lima", "America/Guayaquil", "America/Caracas",
  "America/Santiago", "America/Argentina/Buenos_Aires", "America/Sao_Paulo", "America/Montevideo",
  "America/Asuncion", "America/La_Paz", "America/Panama", "America/Costa_Rica", "America/Guatemala",
  "America/El_Salvador", "America/Tegucigalpa", "America/Managua", "America/Santo_Domingo",
  "America/Puerto_Rico", "America/Havana", "America/Tijuana", "America/Cancun", "America/New_York",
  "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/Madrid", "Europe/Lisbon",
  "Europe/London", "Europe/Paris", "UTC",
];

function supportedTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf !== "function") throw new Error("unsupported");
  return intl.supportedValuesOf("timeZone");
}

/** Every zone the picker offers: American zones first, the suggestion always present. */
export function billingTimeZoneOptions(list: () => readonly string[] = supportedTimeZones): string[] {
  let zones: readonly string[];
  try {
    zones = list();
    if (!zones.length) zones = FALLBACK_TIME_ZONES;
  } catch {
    zones = FALLBACK_TIME_ZONES;
  }
  const unique = [...new Set([...zones, SUGGESTED_BILLING_TIME_ZONE].map((zone) => zone.trim()).filter(Boolean))];
  const american = unique.filter((zone) => zone.startsWith("America/")).sort();
  const rest = unique.filter((zone) => !zone.startsWith("America/")).sort();
  return [...american, ...rest];
}

/** Search aids for the zones people in the market look for by country or local spelling. */
const SEARCH_ALIASES: Readonly<Record<string, string>> = {
  "America/Bogota": "colombia bogotá",
  "America/Mexico_City": "méxico ciudad de méxico cdmx",
  "America/Lima": "perú",
  "America/Guayaquil": "ecuador quito",
  "America/Caracas": "venezuela",
  "America/Santiago": "chile",
  "America/Argentina/Buenos_Aires": "argentina",
  "America/Sao_Paulo": "brasil brazil são paulo",
  "America/Montevideo": "uruguay",
  "America/Asuncion": "paraguay asunción",
  "America/La_Paz": "bolivia",
  "America/Panama": "panamá",
  "America/Costa_Rica": "san josé",
  "America/Guatemala": "guatemala",
  "America/El_Salvador": "san salvador",
  "America/Tegucigalpa": "honduras",
  "America/Managua": "nicaragua",
  "America/Santo_Domingo": "república dominicana",
  "America/Havana": "cuba la habana",
  "America/New_York": "nueva york estados unidos miami",
  "Europe/Madrid": "españa spain",
  "Europe/Lisbon": "portugal lisboa",
  "Europe/Paris": "francia france",
};

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The zones matching what somebody typed. Every word has to appear, accents and
 * underscores do not matter, and the zone already chosen stays in the result so
 * filtering never silently changes the selection.
 */
export function filterTimeZones(options: readonly string[], query: string, selected?: string | null): string[] {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (!words.length) return [...options];
  const found = options.filter((zone) => {
    const haystack = normalizeSearch(`${zone} ${SEARCH_ALIASES[zone] ?? ""}`);
    return words.every((word) => haystack.includes(word));
  });
  if (selected && options.includes(selected) && !found.includes(selected)) return [selected, ...found];
  return found;
}

/** `UTC-05:00` for a zone right now, or "" when the runtime cannot say. */
export function timeZoneOffsetLabel(zone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((entry) => entry.type === "timeZoneName")?.value;
    if (!part) return "";
    return part === "GMT" ? "UTC" : part.replace(/^GMT/, "UTC");
  } catch {
    return "";
  }
}

/** How the page names a number: its display number, else what the reading knows, else the id. */
export function billingZoneNumberLabel(
  phoneNumberId: string,
  rows: readonly unknown[],
  readiness: BillingZoneReadiness | null,
): string {
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const metadata = isRecord(row.metadata) ? row.metadata : {};
    const ids = [row.phone_number_id, metadata.phoneNumberId, row.accountId].map(text);
    if (!ids.includes(phoneNumberId)) continue;
    const label = text(row.display_phone_number) ?? text(metadata.displayPhoneNumber);
    if (label) return label;
    break;
  }
  return readiness?.numbers.find((number) => number.phoneNumberId === phoneNumberId)?.displayPhoneNumber ?? phoneNumberId;
}
