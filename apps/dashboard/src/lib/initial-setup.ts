import type { AgentSetupTaskKey, GuidedTourId, GuidedTourStartDetail } from "@parallext/shared";

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
