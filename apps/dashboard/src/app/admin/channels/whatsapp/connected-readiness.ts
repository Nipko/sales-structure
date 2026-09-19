/**
 * ═══ WHEN "CONECTADO" MAY SAY "TU AGENTE YA RESPONDE" ═══
 *
 * A number that finished Embedded Signup is connected. Whether the agent can
 * ANSWER on it is a different question, and two facts outside the connection
 * decide it:
 *
 *  1. The billing time zone (`channel_accounts.waba_timezone`). An account can
 *     be born without one, and while it is missing the spend admission refuses
 *     every chargeable send — in observe and in enforce mode alike — so every
 *     reply is retried and then dropped. `billing-time-zone.ts` owns what "set"
 *     means; this file only consumes it.
 *  2. The payment method on the WhatsApp Business Account. From 1 October 2026
 *     Meta stops delivering service messages from a WABA with no payment
 *     method (docs/whatsapp-meta-pricing-2026-10.md §2), and a 131042 refusal
 *     stops them already. The reading is `GET /whatsapp/spend/funding-readiness`.
 *
 * And a third fact the signup itself reports: Embedded Signup can finish with
 * `warnings`, two of which mean messages do not flow at all (see
 * `SIGNUP_WARNINGS_STOPPING_REPLIES`).
 *
 * The 14-sep-2026 recording ended with "¡Conectado! … Tu agente ya responde ahí"
 * over a number whose zone nobody had confirmed. The rule this file encodes is
 * the negative one: the screen claims the agent answers only when the zone is
 * SET, the signup left nothing open that stops messages, and nothing known
 * stops Meta from delivering. A reading we could not take is never read as
 * healthy — and never as the worst case either.
 *
 * Pure functions only, so the rule is pinned by tests instead of JSX.
 */

import { normalizeTimezone } from "@parallext/shared";
import type { BillingZoneReadiness, BillingZoneState } from "./billing-time-zone";

/** What the wizard knows about a number it has just connected. */
export interface WhatsAppConnectedPayload {
    displayPhoneNumber?: string;
    /** Meta's phone number id, when the signup answer carried it. */
    phoneNumberId?: string;
    warnings?: string[];
}

/** Where a business adds the payment method. The same page the channel panel links. */
export const META_PAYMENT_METHOD_URL = "https://business.facebook.com/wa/manage/home/";

/**
 * From this instant a WABA with no payment method stops delivering service
 * messages. Meta counts it at midnight in the WABA's own zone, which in this
 * market is 3 to 6 hours after UTC midnight: switching at UTC midnight moves
 * the copy a few hours early, never late.
 */
export const META_SERVICE_CHARGES_FROM = Date.UTC(2026, 9, 1);

export type FundingState = "not_checked" | "attached" | "absent" | "restricted" | "unknown";

const FUNDING_STATES: readonly FundingState[] = ["not_checked", "attached", "absent", "restricted", "unknown"];

/** One number's funding, as the readiness endpoint reported it. */
export type FundingReading =
    | { kind: "read"; state: FundingState; checkedAt: string | null }
    /** The call failed, or the answer does not list this number. */
    | { kind: "unreadable" };

/** What the payment method means for the agent's replies. */
export type PaymentVerdict =
    | "checking"
    /** Meta reports a method attached. Not solvency — only "this is not what is missing". */
    | "ready"
    /** Nobody established it: never checked, Meta did not say, or we could not ask. */
    | "unestablished"
    /** Meta answered that there is none. */
    | "missing"
    /** Meta refused to charge the account (131042): replies are not delivered now. */
    | "restricted";

export type ConnectedHeadline =
    | "checking"
    | "ready"
    | "needs_zone"
    | "zone_unknown"
    | "needs_payment"
    | "payment_restricted"
    /** Zone and payment are fine, but the signup left open something that stops messages. */
    | "signup_pending";

export type ConnectedPending =
    | "billing_zone"
    | "payment_method"
    /** The number is not registered with the Cloud API yet: nothing can be sent from it. */
    | "phone_registration"
    /** Meta did not confirm our webhook subscription: customers' messages do not reach the agent. */
    | "webhook_subscription";

/**
 * The Embedded Signup warnings that mean the agent cannot answer, and what each
 * leaves pending. The signup answers `warnings` (the codes of
 * `WHATSAPP_ONBOARDING_WARNING_CODES` in apps/whatsapp onboarding.service.ts,
 * plus the ones `KNOWN_WHATSAPP_WARNINGS` translates):
 *
 * - `webhook_subscription_failed` — `POST /{waba}/subscribed_apps` did not
 *   answer success, so Meta may not send us the account's webhooks: the
 *   customer's message never reaches the agent, and nothing is answered.
 * - `phone_registration_deferred` — the number's Cloud API registration is
 *   still pending on Meta's side; an unregistered number cannot send.
 *
 * Deliberately absent, because a reply still goes out:
 * - `business_not_verified` — the business answers, with Meta's daily cap on
 *   conversations until it is verified.
 * - `template_sync_failed` — only templates are missing, which a reply inside
 *   the customer's 24-hour window does not use.
 *
 * Listed in the order the owner reads them on the last screen.
 */
export const SIGNUP_WARNINGS_STOPPING_REPLIES: ReadonlyArray<readonly [warning: string, pending: ConnectedPending]> = [
    ["phone_registration_deferred", "phone_registration"],
    ["webhook_subscription_failed", "webhook_subscription"],
];

const SIGNUP_PENDING: ReadonlySet<ConnectedPending> = new Set(SIGNUP_WARNINGS_STOPPING_REPLIES.map(([, pending]) => pending));

/** Whether this pending item comes from the signup (fixed with Meta or support), not from the zone or the card. */
export function isSignupPending(pending: ConnectedPending): boolean {
    return SIGNUP_PENDING.has(pending);
}

/** What the signup's warnings leave pending, once each, in reading order. Anything else changes nothing. */
export function signupBlockers(warnings: readonly unknown[] | null | undefined): ConnectedPending[] {
    if (!Array.isArray(warnings) || warnings.length === 0) return [];
    return SIGNUP_WARNINGS_STOPPING_REPLIES
        .filter(([warning]) => warnings.includes(warning))
        .map(([, pending]) => pending);
}

export interface ConnectedReadiness {
    headline: ConnectedHeadline;
    /** The only condition under which the screen may say the agent answers. */
    answering: boolean;
    /** What is known to be left for the owner, in the order she should do it. */
    pending: ConnectedPending[];
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function digitsOf(value: unknown): string {
    return typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
}

/**
 * The funding of one number from the `apiGet` envelope.
 *
 * A state the client does not recognise is `unknown`, never a guess; a number
 * missing from the answer is `unreadable`, because "not in the list" says
 * nothing about its card.
 */
export function readFundingFor(payload: unknown, phoneNumberId: string | null): FundingReading {
    const id = phoneNumberId?.trim();
    if (!id || !isRecord(payload) || payload.success === false) return { kind: "unreadable" };
    const data = isRecord(payload.data) ? payload.data : payload;
    if (!Array.isArray(data.numbers)) return { kind: "unreadable" };
    const entry = data.numbers.find((candidate: unknown) => isRecord(candidate) && text(candidate.channelAccountId) === id);
    if (!isRecord(entry)) return { kind: "unreadable" };
    const state = FUNDING_STATES.find((candidate) => candidate === entry.state) ?? "unknown";
    return { kind: "read", state, checkedAt: text(entry.checkedAt) };
}

export function paymentVerdict(reading: FundingReading | undefined): PaymentVerdict {
    if (!reading) return "checking";
    if (reading.kind === "unreadable") return "unestablished";
    switch (reading.state) {
        case "attached": return "ready";
        case "absent": return "missing";
        case "restricted": return "restricted";
        default: return "unestablished";
    }
}

/** Whether Meta already stops delivering replies from an account with no payment method. */
export function paymentRequiredNow(now: number): boolean {
    return now >= META_SERVICE_CHARGES_FROM;
}

/**
 * The one decision: what the connected state says at the top, and whether it
 * may claim the agent answers.
 *
 * - `zone` undefined is "still reading" — nothing is claimed while we look.
 * - The zone comes first: while it is missing NOTHING is delivered, whatever
 *   the payment method says, and one step at a time is how the owner gets
 *   through it.
 * - A payment method that nobody could establish is not a finding before
 *   1 October — today replies are delivered without one — but from that date
 *   the most common "unknown" is an account with no card (see the KNOWN GAP in
 *   apps/api/src/modules/channels/whatsapp-funding-readiness.ts), so the claim
 *   stops there too.
 * - A signup warning that stops messages (`signupBlockers`) is known from the
 *   signup answer itself, so it is pending from the first render; it replaces
 *   only the claim, and the zone and the card keep their own headlines.
 */
export function connectedReadiness(input: {
    zone: BillingZoneState | undefined;
    payment: PaymentVerdict;
    now: number;
    /** The `warnings` of the signup answer, when this number was connected here. */
    warnings?: readonly unknown[] | null;
}): ConnectedReadiness {
    const { zone, payment, now } = input;
    const paymentPending = payment === "missing" || payment === "restricted" || payment === "unestablished";
    const signup = signupBlockers(input.warnings);
    const pending: ConnectedPending[] = [];
    if (zone?.kind === "missing") pending.push("billing_zone");
    if (paymentPending) pending.push("payment_method");
    pending.push(...signup);

    if (!zone) return { headline: "checking", answering: false, pending };
    if (zone.kind === "missing") return { headline: "needs_zone", answering: false, pending };
    if (zone.kind === "unknown") return { headline: "zone_unknown", answering: false, pending };
    if (payment === "checking") return { headline: "checking", answering: false, pending };
    if (payment === "restricted") return { headline: "payment_restricted", answering: false, pending };
    if (payment === "missing") return { headline: "needs_payment", answering: false, pending };
    if (payment === "unestablished" && paymentRequiredNow(now)) {
        return { headline: "needs_payment", answering: false, pending };
    }
    if (signup.length > 0) return { headline: "signup_pending", answering: false, pending };
    return { headline: "ready", answering: true, pending };
}

/**
 * The zone the picker starts on: the business's own, so confirming is one tap.
 *
 * Only a starting value — `WhatsAppBillingTimeZone` still sends nothing until
 * somebody presses the button that names the zone. It replaces only the
 * generic "most common" suggestion: a zone another number of the SAME WhatsApp
 * account already holds is the account's real zone (Meta keeps one per
 * account), and two siblings that disagree must be chosen between by a person.
 *
 * `suggestionSource` is cleared so the card does not explain the business's
 * zone as "the most common one"; the headline says where it came from.
 */
export function preselectBusinessZone(
    state: BillingZoneState,
    businessZone: string | null | undefined,
    options: readonly string[],
): { state: BillingZoneState; fromBusiness: string | null } {
    if (state.kind !== "missing") return { state, fromBusiness: null };
    if (state.suggestionSource === "same_account" || state.conflictingZones.length > 1) {
        return { state, fromBusiness: null };
    }
    const raw = text(businessZone);
    if (!raw) return { state, fromBusiness: null };
    const zone = options.includes(raw) ? raw : options.includes(normalizeTimezone(raw)) ? normalizeTimezone(raw) : null;
    if (!zone) return { state, fromBusiness: null };
    return { state: { ...state, suggestion: zone, suggestionSource: null }, fromBusiness: zone };
}

/**
 * The readiness after a save the server confirmed, before it is read again.
 *
 * The endpoint answered `success` with the zone it wrote, for this number and
 * for `alsoApplied` siblings. If the re-read that follows fails, the screen
 * must not fall back to "we could not check" about a zone it just saw saved.
 */
export function withSavedZone(
    readiness: BillingZoneReadiness | null | undefined,
    saved: { phoneNumberId: string; timeZone: string; alsoApplied: string[] },
): BillingZoneReadiness {
    const ids = new Set([saved.phoneNumberId, ...saved.alsoApplied]);
    const numbers = readiness?.numbers ?? [];
    const patched = numbers.map((number) => ids.has(number.phoneNumberId)
        ? { ...number, zone: saved.timeZone, resolution: "known" as const, resolvedZone: null, candidateZones: [] }
        : number);
    if (!patched.some((number) => number.phoneNumberId === saved.phoneNumberId)) {
        patched.push({
            phoneNumberId: saved.phoneNumberId, zone: saved.timeZone, resolution: "known",
            resolvedZone: null, candidateZones: [], displayPhoneNumber: null,
        });
    }
    // Contradictions stay as they were: a sibling the save did not reach may
    // still disagree, and only the next read can say it no longer does.
    return { numbers: patched, contradictions: readiness?.contradictions ?? [] };
}

/** The tenant zone from `GET /auth/tenant/timezone`, or null when there is none. */
export function readTenantTimeZone(payload: unknown): string | null {
    if (!isRecord(payload) || payload.success === false) return null;
    const data = isRecord(payload.data) ? payload.data : payload;
    return text(data.timezone);
}

/**
 * Which number the wizard just connected.
 *
 * The signup answer names it; an answer recovered from an earlier attempt may
 * not. Then the readiness list is matched by the digits of the display number,
 * and a tenant whose list holds a single number — day 0 — is that number.
 */
export function connectedNumberId(
    connected: WhatsAppConnectedPayload,
    readiness: BillingZoneReadiness | null | undefined,
): string | null {
    const direct = text(connected.phoneNumberId);
    if (direct) return direct;
    if (!readiness) return null;
    const digits = digitsOf(connected.displayPhoneNumber);
    if (digits) {
        const match = readiness.numbers.find((number) => digitsOf(number.displayPhoneNumber) === digits);
        if (match) return match.phoneNumberId;
    }
    return readiness.numbers.length === 1 ? readiness.numbers[0].phoneNumberId : null;
}
