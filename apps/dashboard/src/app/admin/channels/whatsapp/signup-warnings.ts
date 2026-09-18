/**
 * ═══ WHAT THE SIGNUP OF A CONNECTED NUMBER LEFT OPEN, AFTER THE FACT ═══
 *
 * Embedded Signup can finish "connected" with warnings that stop every reply
 * (Meta did not confirm the webhook subscription, or did not register the
 * number). Until now a screen knew them only from the answer to a signup it
 * had just run: after a reload, or for a number connected earlier, the wizard
 * and Canales → WhatsApp showed a clean "Conectado".
 *
 * `GET /channels/whatsapp/status` now carries, per connected number,
 * `signupWarnings` — the codes the latest signup of that connection left open
 * (`[]` = nothing open; `null` = the server could not read them) — and
 * `signupWarningsAt`, when that signup completed. The body of the older
 * WhatsApp-specific handler has neither field; absent reads as "not known",
 * like `null`, never as "nothing open".
 *
 * Pure functions only, so the reading is pinned by tests instead of JSX.
 */

import { signupBlockers } from "./connected-readiness";
import { readWhatsAppChannelRows, whatsAppRowPhoneNumberId } from "./whatsapp-channel-rows";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The codes the server reported for one status row, or `undefined` when it reported none. */
export function whatsAppRowSignupWarnings(row: unknown): string[] | undefined {
    if (!isRecord(row) || !Array.isArray(row.signupWarnings)) return undefined;
    const codes: string[] = [];
    for (const code of row.signupWarnings) {
        if (typeof code === "string" && code.trim() && !codes.includes(code.trim())) codes.push(code.trim());
    }
    return codes;
}

/** When the signup those codes come from completed, or null. */
export function whatsAppRowSignupWarningsAt(row: unknown): string | null {
    if (!isRecord(row) || typeof row.signupWarningsAt !== "string") return null;
    return Number.isNaN(Date.parse(row.signupWarningsAt)) ? null : row.signupWarningsAt;
}

/**
 * One number's persisted signup warnings, from a status body.
 *
 * `undefined` when the body does not say (unreadable, the number is not
 * listed, or the server could not read them): a caller keeps whatever it
 * already knew rather than reading "nothing open" into it.
 */
export function numberSignupWarnings(statusPayload: unknown, phoneNumberId: string | null | undefined): string[] | undefined {
    const rows = readWhatsAppChannelRows(statusPayload).connected;
    const id = phoneNumberId?.trim();
    // Without a number to look for, a tenant with a single connected number —
    // day 0 — is that number; with several, nothing can be said.
    const row = id
        ? rows.find((candidate) => whatsAppRowPhoneNumberId(candidate) === id)
        : rows.length === 1 ? rows[0] : undefined;
    return row ? whatsAppRowSignupWarnings(row) : undefined;
}

/** What one connected number's signup left open, as Canales → WhatsApp lists it. */
export interface SignupWarningGroup {
    /** Meta's phone number id, or "" for a signup answer that did not name it. */
    phoneNumberId: string;
    warnings: string[];
    /** When the signup completed, when the server said. */
    recordedAt: string | null;
}

/**
 * Every connected number with something open, in the page's order.
 *
 * The server's record wins: it is the same answer, persisted, and it survives
 * a reload. The answer of a signup run on this page (`session`) fills in only
 * where the server could not say — a number not listed yet, or a read that
 * failed — so what was just shown is never taken back by a slow read.
 */
export function signupWarningGroups(
    connectedRows: readonly unknown[],
    session: { phoneNumberId?: string | null; warnings: readonly string[] } | null,
): SignupWarningGroup[] {
    const groups: SignupWarningGroup[] = [];
    const sessionId = session?.phoneNumberId?.trim() ?? "";
    let sessionUsed = false;
    for (const row of connectedRows) {
        const id = whatsAppRowPhoneNumberId(row);
        const persisted = whatsAppRowSignupWarnings(row);
        const fromSession = session && id && id === sessionId ? [...session.warnings] : undefined;
        if (fromSession) sessionUsed = true;
        const warnings = persisted ?? fromSession ?? [];
        if (warnings.length > 0) {
            groups.push({ phoneNumberId: id, warnings, recordedAt: persisted ? whatsAppRowSignupWarningsAt(row) : null });
        }
    }
    if (session && !sessionUsed && session.warnings.length > 0) {
        groups.push({ phoneNumberId: sessionId, warnings: [...session.warnings], recordedAt: null });
    }
    return groups;
}

/**
 * Whether what a signup left open stops every reply from this number.
 *
 * "Blocking" is the connected state's rule (`signupBlockers`): Meta did not
 * register the number, or did not confirm our webhooks. A verification or a
 * template sync still pending does not stop a reply. Canales → WhatsApp used
 * to offer "Prueba tu agente" over a number in that state, for a test that
 * could not answer.
 *
 * A group the signup answer did not tie to a number counts for the number
 * asked about, and every group counts when the caller cannot say which number
 * it means: when unsure, the page does not promise a reply.
 */
export function signupBlocksRepliesOn(
    groups: readonly SignupWarningGroup[],
    phoneNumberId: string | null | undefined,
): boolean {
    const id = phoneNumberId?.trim() ?? "";
    return groups.some((group) => (!id || !group.phoneNumberId || group.phoneNumberId === id)
        && signupBlockers(group.warnings).length > 0);
}
