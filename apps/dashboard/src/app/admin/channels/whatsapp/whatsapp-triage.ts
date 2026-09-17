import type { WhatsAppConnectRouteId } from "./whatsapp-connect-routes";

/**
 * "¿Dónde vive hoy tu número?" — the one question that decides everything.
 *
 * In the 14-sep recording the owner met three route cards ("coexistencia",
 * "número nuevo", "migrar desde otro proveedor") with ~450 words of detail and
 * no way to recognise her own situation. She hovered between two of them for
 * two minutes, picked the wrong one, and Meta refused twice. Nothing on that
 * screen could have told her which one was hers.
 *
 * So the screen asks first, in her words, and the answer chooses the route.
 * Two of the five answers do not open Meta's window at all: one sends her to
 * install WhatsApp Business first, the other postpones with a reason — and
 * both say that meanwhile the agent already answers on its own link.
 */
export const WHATSAPP_TRIAGE_ANSWER_IDS = [
    "business_app",
    "personal_app",
    "new_number",
    "other_provider",
    "not_at_hand",
] as const;

export type WhatsAppTriageAnswerId = typeof WHATSAPP_TRIAGE_ANSWER_IDS[number];

export type WhatsAppTriageOutcome =
    /** Opens Meta's window on this route. */
    | { kind: "route"; routeId: WhatsAppConnectRouteId }
    /** A free five-minute step on her phone, then she comes back. */
    | { kind: "install_business_app" }
    /** Nothing to do here today; the reason changes what we say. */
    | { kind: "later"; reason: "other_provider" | "not_at_hand" };

export interface WhatsAppTriageAnswer {
    id: WhatsAppTriageAnswerId;
    outcome: WhatsAppTriageOutcome;
    /**
     * The person's OWN hands-on minutes, shown only after they answer — never
     * on the cards, where it used to read as the total wait. null = we cannot
     * promise a time because it depends on somebody else.
     */
    minutes: number | null;
    /** Capitalised i18n segment: `channels.whatsapp.triage.answer<MessageKey>…`. */
    messageKey: "BusinessApp" | "PersonalApp" | "NewNumber" | "OtherProvider" | "NotAtHand";
    /** How many `need<n>` lines this answer shows. Three at most, on purpose. */
    needCount: number;
    /**
     * The answer opens a route, but the person may not be able to use it today
     * because somebody else has to act first. Then the card offers both: go on,
     * or leave it noted.
     */
    alsoPostpone?: boolean;
}

export const WHATSAPP_TRIAGE_ANSWERS: readonly WhatsAppTriageAnswer[] = [
    {
        id: "business_app",
        outcome: { kind: "route", routeId: "coexistence" },
        minutes: 10,
        messageKey: "BusinessApp",
        needCount: 3,
    },
    {
        id: "personal_app",
        outcome: { kind: "install_business_app" },
        minutes: 5,
        messageKey: "PersonalApp",
        needCount: 3,
    },
    {
        id: "new_number",
        outcome: { kind: "route", routeId: "new" },
        minutes: 5,
        messageKey: "NewNumber",
        needCount: 3,
    },
    {
        id: "other_provider",
        // The migration route exists for exactly this number. Sending the answer
        // to a postpone left the only route that names her case unreachable from
        // the only question that identifies it.
        outcome: { kind: "route", routeId: "migration" },
        // A number lives with one provider at a time, and the old one has to
        // release it. That wait is theirs, not ours: we do not promise a time.
        minutes: null,
        messageKey: "OtherProvider",
        needCount: 3,
        alsoPostpone: true,
    },
    {
        id: "not_at_hand",
        outcome: { kind: "later", reason: "not_at_hand" },
        minutes: null,
        messageKey: "NotAtHand",
        needCount: 2,
    },
];

export function getWhatsAppTriageAnswer(id: unknown): WhatsAppTriageAnswer | null {
    return WHATSAPP_TRIAGE_ANSWERS.find((answer) => answer.id === id) ?? null;
}

export function isWhatsAppTriageAnswerId(value: unknown): value is WhatsAppTriageAnswerId {
    return typeof value === "string" && (WHATSAPP_TRIAGE_ANSWER_IDS as readonly string[]).includes(value);
}

/** `channels.whatsapp.triage.answer<Key><suffix>` — no parallel copy namespace. */
export function whatsAppTriageKey(answer: WhatsAppTriageAnswer, suffix: string): string {
    return `answer${answer.messageKey}${suffix}`;
}

/** The route Meta's window is launched with, or null when the answer stays here. */
export function triageRouteId(answer: WhatsAppTriageAnswer): WhatsAppConnectRouteId | null {
    return answer.outcome.kind === "route" ? answer.outcome.routeId : null;
}

/**
 * The route to open when the person presses the primary button.
 *
 * Someone who had the number in the ordinary WhatsApp app and moved it to
 * WhatsApp Business is, from that moment, exactly the coexistence case — the
 * mini-step is a detour on the way to the same door.
 */
export function routeAfterTriage(answer: WhatsAppTriageAnswer): WhatsAppConnectRouteId | null {
    if (answer.outcome.kind === "route") return answer.outcome.routeId;
    if (answer.outcome.kind === "install_business_app") return "coexistence";
    return null;
}

const STORAGE_PREFIX = "parallly_wa_triage_";

/**
 * Remembered per tenant in this browser: coming back to the screen should not
 * ask the same question again. It is a UI preference, not a business fact —
 * the deferral itself is already recorded server-side (channelConnectSkippedAt).
 */
export function readRememberedTriage(tenantId: string | null | undefined): WhatsAppTriageAnswerId | null {
    if (!tenantId || typeof window === "undefined") return null;
    try {
        const stored = window.localStorage.getItem(STORAGE_PREFIX + tenantId);
        return isWhatsAppTriageAnswerId(stored) ? stored : null;
    } catch {
        return null;
    }
}

export function rememberTriage(tenantId: string | null | undefined, answerId: WhatsAppTriageAnswerId | null): void {
    if (!tenantId || typeof window === "undefined") return;
    try {
        if (answerId) window.localStorage.setItem(STORAGE_PREFIX + tenantId, answerId);
        else window.localStorage.removeItem(STORAGE_PREFIX + tenantId);
    } catch {
        /* a browser with storage disabled simply asks again */
    }
}
