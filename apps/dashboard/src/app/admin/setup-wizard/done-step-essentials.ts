/**
 * ═══ WHAT "LISTO" LISTS, AND WHETHER EACH ONE IS DONE ═══
 *
 * The last screen printed the same three items for everybody — "Conectar
 * WhatsApp", "Cargar lo que tu agente debe saber", "Invitar a una persona" —
 * numbered as if all three were pending. An owner who had already loaded her
 * prices and invited her partner read two chores she had finished, and one
 * whose channel was Instagram read "Conectar WhatsApp".
 *
 * `GET /persona/:tenantId/setup-status` already answers both questions with
 * the same counts the setup card uses (`hasKnowledge`, `hasTeam`), and the page
 * already reads that endpoint on load. This file turns them into the list:
 * done is said as done, pending as pending, and a count nobody could read is
 * left out — the endpoint sends `undefined` for "not known" precisely so no
 * screen turns a database hiccup into a chore, or into a tick.
 *
 * The channel item is always there; what it says is `done-step-channel.ts`'s job.
 */

import { isRecord } from "../channels/_components/connect-errors";

export type DoneStepEssentialKey = "channel" | "knowledge" | "team";

export interface DoneStepEssential {
    key: DoneStepEssentialKey;
    /** `null` for the channel item, whose state `doneStepChannel` decides. */
    done: boolean | null;
}

/** What setup-status says about the two items besides the channel. `undefined` = not known. */
export interface SetupProgressFacts {
    hasKnowledge?: boolean;
    hasTeam?: boolean;
    handoffRecipient?: string | null;
}

/** The day-0 facts setup-status carries beside the stage, as the session names them. */
export interface SetupActivationFacts {
    stage?: string;
    firstReplyAt?: string | null;
    tenantCreatedAt?: string | null;
}

function optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function optionalIso(value: unknown): string | null | undefined {
    if (value === null) return null;
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

/** Reads the progress counts from a setup-status response; anything else is "not known". */
export function readSetupProgressFacts(response: unknown): SetupProgressFacts {
    if (!isRecord(response) || response.success !== true || !isRecord(response.data)) return {};
    const recipient = isRecord(response.data.handoffRecipient)
        && typeof response.data.handoffRecipient.label === "string"
        ? response.data.handoffRecipient.label : null;
    return {
        hasKnowledge: optionalBoolean(response.data.hasKnowledge),
        hasTeam: optionalBoolean(response.data.hasTeam),
        ...(recipient ? { handoffRecipient: recipient } : {}),
    };
}

/**
 * Reads the stage and the activation facts from a setup-status response.
 * Fresher than the session's copy, which is why the wizard prefers them.
 */
export function readSetupActivationFacts(response: unknown): SetupActivationFacts {
    if (!isRecord(response) || response.success !== true || !isRecord(response.data)) return {};
    const data = response.data;
    return {
        stage: typeof data.onboardingStage === "string" ? data.onboardingStage : undefined,
        firstReplyAt: optionalIso(data.firstReplyAt),
        tenantCreatedAt: optionalIso(data.tenantCreatedAt),
    };
}

/** The items of "Listo", in order, each with whether it is already done. */
export function doneStepEssentials(facts: SetupProgressFacts): DoneStepEssential[] {
    const items: DoneStepEssential[] = [{ key: "channel", done: null }];
    if (typeof facts.hasKnowledge === "boolean") items.push({ key: "knowledge", done: facts.hasKnowledge });
    if (typeof facts.hasTeam === "boolean") items.push({ key: "team", done: facts.hasTeam });
    return items;
}
