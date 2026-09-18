import { api } from "@/lib/api";
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
 * The account's answer lives on the server; this browser keeps a copy.
 *
 * The screen promises "lo dejamos anotado y lo retomas cuando lo tengas" and
 * "te lo vamos a recordar en Inicio". With the answer only in localStorage
 * that promise held on one device: from the owner's phone, a private window
 * or after clearing the browser the question came back and Inicio had nothing
 * to remind her of. So every answer is written to the account
 * (`PUT /persona/:tenantId/whatsapp-triage`, read back in `setup-status` as
 * `whatsappTriage: { answerId, recordedAt } | null`), and the local copy only
 * saves the screen a question while that read is in flight.
 */
export function whatsAppTriageEndpoint(tenantId: string): string {
    return `/persona/${encodeURIComponent(tenantId)}/whatsapp-triage`;
}

/** The account's answer, in the shape `setup-status` exposes it. */
export interface RecordedWhatsAppTriage {
    answerId: WhatsAppTriageAnswerId;
    recordedAt: string;
}

/**
 * `setup-status.whatsappTriage`, validated. `null` = the account has no
 * answer; an id this screen no longer offers, or a malformed value, is no
 * answer rather than a guess.
 *
 * "Malformed" includes a `recordedAt` that does not read as a date. The API
 * only ever writes an ISO instant, and its own reader
 * (`readWhatsAppTriage` in `whatsapp-triage.util.ts`) already turns an
 * unparseable one into "no answer"; the panel applies the same rule, so an
 * API older than that reader, or a hand-edited row, cannot make Inicio remind
 * the owner of something she never said — nor hand a later "cuándo lo
 * dejaste anotado" an "Invalid Date".
 */
export function readRecordedTriage(value: unknown): RecordedWhatsAppTriage | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const { answerId, recordedAt } = value as Record<string, unknown>;
    if (!isWhatsAppTriageAnswerId(answerId) || typeof recordedAt !== "string" || !recordedAt.trim()) return null;
    if (Number.isNaN(Date.parse(recordedAt))) return null;
    return { answerId, recordedAt };
}

/** Per tenant, the last write still on its way: reads wait for it, writes queue behind it. */
const pendingWrites = new Map<string, Promise<boolean>>();

/**
 * Writes the answer (or clears it, with `null`) to the account. Never throws:
 * `false` means it did not reach the server, and the local copy still holds
 * it for this browser.
 *
 * Writes for one tenant go out one after the other. Two quick clicks, or
 * "Cambiar mi respuesta" followed by a new answer, must land in the order the
 * person made them — two parallel requests can arrive the other way round and
 * leave the account with the answer she took back.
 */
export function persistTriage(tenantId: string, answerId: WhatsAppTriageAnswerId | null): Promise<boolean> {
    const previous = pendingWrites.get(tenantId) ?? Promise.resolve(true);
    const write = previous.then(async () => {
        try {
            await api.fetch(whatsAppTriageEndpoint(tenantId), {
                method: "PUT",
                body: JSON.stringify({ answerId }),
            });
            return true;
        } catch {
            return false;
        }
    });
    pendingWrites.set(tenantId, write);
    void write.then(() => {
        if (pendingWrites.get(tenantId) === write) pendingWrites.delete(tenantId);
    });
    return write;
}

/**
 * The account's answer. `undefined` = it could not be read (or the API is
 * older than the field): the caller keeps what it has instead of treating an
 * unreadable answer as "she never answered".
 *
 * Waits for this browser's own pending write first. Otherwise "Cambiar mi
 * respuesta" remounts the question, the read overtakes the clearing write, and
 * the answer she just took back reappears on screen.
 */
export async function fetchRecordedTriage(tenantId: string): Promise<RecordedWhatsAppTriage | null | undefined> {
    await pendingWrites.get(tenantId);
    try {
        const response = await api.getSetupStatus(tenantId);
        const data = response?.success === true ? (response.data as Record<string, unknown> | undefined) : undefined;
        if (!data || typeof data !== "object" || !("whatsappTriage" in data)) return undefined;
        return readRecordedTriage(data.whatsappTriage);
    } catch {
        return undefined;
    }
}

/** This browser's copy of the account's answer. */
export function readRememberedTriage(tenantId: string | null | undefined): WhatsAppTriageAnswerId | null {
    if (!tenantId || typeof window === "undefined") return null;
    try {
        const stored = window.localStorage.getItem(STORAGE_PREFIX + tenantId);
        return isWhatsAppTriageAnswerId(stored) ? stored : null;
    } catch {
        return null;
    }
}

/** Updates only this browser's copy — used when the server's answer is adopted. */
export function cacheTriage(tenantId: string | null | undefined, answerId: WhatsAppTriageAnswerId | null): void {
    if (!tenantId || typeof window === "undefined") return;
    try {
        if (answerId) window.localStorage.setItem(STORAGE_PREFIX + tenantId, answerId);
        else window.localStorage.removeItem(STORAGE_PREFIX + tenantId);
    } catch {
        /* a browser with storage disabled keeps only the server's answer */
    }
}

/**
 * The person answered (or took the answer back, with `null`): this browser's
 * copy changes at once, and the account's copy follows in the background.
 * Every caller — the question itself and the connect panel's "Volver" — goes
 * through here, so none of them can update one copy and forget the other.
 */
export function rememberTriage(tenantId: string | null | undefined, answerId: WhatsAppTriageAnswerId | null): void {
    if (!tenantId) return;
    cacheTriage(tenantId, answerId);
    void persistTriage(tenantId, answerId);
}
