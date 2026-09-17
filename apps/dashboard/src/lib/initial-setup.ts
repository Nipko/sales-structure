import type { AgentQualityCheck, AgentSetupTask, AgentSetupTaskKey, GuidedTourId, GuidedTourStartDetail } from "@parallext/shared";
import { isEssentialSetupTask } from "@parallext/shared";

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
  labelKey: string;
  /** The tour "Mostrarme dónde" runs for this item. `null` = no tour covers it. */
  tourId: GuidedTourId | null;
  channelType?: GuidedTourStartDetail["channelType"];
  /** An unavailable check is not a verified missing setting. */
  verification?: "unavailable";
  pendingCheck?: AgentQualityCheck;
  notApplicable?: true;
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
  // Only what the agent needs to answer a customer at all. Mission, knowledge,
  // hours, appointments, catalogue and tests make it better and live in Salud
  // de agentes; nine equal boxes made a new owner say "tendría que trabajar en
  // todos estos" and leave.
  return tasks.filter(task => isEssentialSetupTask(task.key) && canAccess(task.href)).map(task => ({
    key: task.key,
    href: task.href,
    done: task.status === "pass" || task.status === "not_applicable",
    labelKey: setupTaskLabelKey(task),
    tourId: task.tourId,
    channelType: task.channelType,
    ...(task.pendingCheckCode ? { pendingCheck: task.checks.find(check => check.code === task.pendingCheckCode) } : {}),
    ...(task.status === "not_applicable" ? { notApplicable: true as const } : {}),
    ...(task.status === "unknown" ? { verification: "unavailable" as const } : {}),
  }));
}

/** Labels explain the server's diagnosis without recomputing readiness. */
export function setupTaskLabelKey(task: Pick<AgentSetupTask, 'key' | 'status' | 'pendingCheckCode' | 'checks'>): string {
  if (task.key !== 'channel') return `items.${task.key}`;
  if (task.status === 'unknown') return 'channelActions.verify';
  if (task.status === 'pass') return 'channelActions.ready';
  const check = task.checks.find(check => check.code === task.pendingCheckCode);
  if (check?.code === 'operational_channel_scope') return 'channelActions.unsupported';
  if (check?.code === 'channel_assignment') return 'channelActions.assign';
  if (check?.code === 'channel_coverage') return 'channelActions.coverage';
  if (check?.code === 'channel_connection') {
    if (check.evidence?.hasCredentialIssue) return 'channelActions.credentials';
    if (Number(check.evidence?.staleBindings) > 0) return 'channelActions.reassign';
    return 'channelActions.connect';
  }
  return 'items.channel';
}
