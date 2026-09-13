import type { AgentSetupTask, AgentSetupTaskKey, GuidedTourId, GuidedTourStartDetail } from "@parallext/shared";

/**
 * The card's view of one setup task — and nothing else.
 *
 * "What is still missing before this account works" is answered in exactly one
 * place: `AgentAssessment.tasks`, computed server-side against the same
 * preparation checks Agent health is graded on, and read here through
 * `api.getAgentAssessment`. This file used to carry a second, fully-tested
 * implementation of that same question — channel ordering, check groups,
 * catalogue routes, appointment gating — that no screen rendered. Two answers
 * to one question is how the card and health started disagreeing in the first
 * place, so do not grow another one here: extend the assessment instead.
 */

export type EssentialSetupItemKey = AgentSetupTaskKey;

export interface EssentialSetupItem {
  key: EssentialSetupItemKey;
  href: string;
  done: boolean;
  /** The tour "Mostrarme dónde" runs for this item. `null` = no tour covers it. */
  tourId: GuidedTourId | null;
  channelType?: GuidedTourStartDetail["channelType"];
  /** An unavailable check is not a verified missing setting. */
  verification?: "unavailable";
}

/**
 * Project the server-owned assessment into the setup card.
 *
 * This deliberately does not infer readiness from channels, records or local
 * toggles. It only applies navigation access to the tasks the API already
 * evaluated, then translates the shared status vocabulary for the card.
 */
export function essentialSetupItemsFromAssessment(
  tasks: AgentSetupTask[],
  canAccess: (href: string) => boolean,
): EssentialSetupItem[] {
  return tasks.filter(task => canAccess(task.href)).map(task => ({
    key: task.key,
    href: task.href,
    done: task.status === "pass" || task.status === "not_applicable",
    tourId: task.tourId,
    channelType: task.channelType,
    ...(task.status === "unknown" ? { verification: "unavailable" as const } : {}),
  }));
}
