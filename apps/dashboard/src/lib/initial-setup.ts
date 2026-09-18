import type { AgentQualityCheck, AgentSetupTask, AgentSetupTaskKey, GuidedTourId, GuidedTourStartDetail } from "@parallext/shared";
import { isEssentialSetupTask } from "@parallext/shared";
import { isWizardChannel, type WizardChannel } from "@/app/admin/setup-wizard/connect-channels";

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
  /** The channel the label names (`channelActions.connectLead`), set by `withLeadChannel`. */
  leadChannel?: WizardChannel;
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
  // A connected channel no agent answers: "connect and assign a channel" would
  // send the owner to connect what is already connected.
  if (check?.code === 'channel_unanswered') return 'channelActions.unanswered';
  if (check?.code === 'whatsapp_delivery') {
    // The only reason that is ALSO a warning (no payment method before
    // 1-oct-2026, still delivering): say what to add, never "it is blocked".
    return check.evidence?.reason === 'funding_absent'
      ? 'channelActions.whatsappPaymentMethod'
      : 'channelActions.whatsappDelivery';
  }
  return 'items.channel';
}

/** Where each channel is connected. Its own page, not the list: the label already named it. */
const LEAD_CHANNEL_HREF: Record<WizardChannel, string> = {
  whatsapp: "/admin/channels/whatsapp",
  instagram: "/admin/channels/instagram",
  messenger: "/admin/channels/messenger",
  telegram: "/admin/channels/telegram",
};

/** The two labels the server's "connect your first channel" step can arrive with. */
const CONNECT_FIRST_LABELS = new Set(["channelActions.connect", "channelActions.assign"]);

/**
 * What Home knows about an account's FIRST channel, for `withLeadChannel`.
 *
 * Only an account known to have no connection at all gets one: with a
 * channel connected, "asignar" means assigning the one she has, not
 * connecting another. `fallback` is Home's own recipe + plan reading
 * (`homeLeadChannel`), `null` while it is not known.
 */
export interface FirstChannelLead {
  fallback: WizardChannel | null;
}

/**
 * The channel step of an account with NO connection, said with ONE channel.
 *
 * The server's step carries that channel in `channelType`: the first one of
 * the order the setup wizard saved (the recipe filtered by the plan, or
 * WhatsApp first once she chose it and left it for later), else the agent's
 * own assignment, else WhatsApp. "Salud de agentes" and Assist name the same
 * one. This used to run backwards — the card kept its own reading of the
 * recipe and gave way only when the server did NOT say WhatsApp — so an
 * Instagram-led salon read "Conecta tu primer canal" and landed on the
 * channel list, and a saved WhatsApp-first order was overruled by the
 * recipe's Instagram.
 *
 * - `lead` null/undefined: the account is not known to have zero
 *   connections. Nothing changes.
 * - `channelType` present: THAT is the channel. A `web_chat` (or anything
 *   this card cannot name) leaves the server's own step untouched.
 * - `channelType` absent (the server could not count the connections, so it
 *   never shaped the step): `lead.fallback`; `null` changes nothing.
 *
 * Only the label, the destination and the tour change — never `done`: whether
 * the step is finished is the server's answer, not this function's. And only
 * when the step says "connect" (or "assign", which with zero connections can
 * only be repaired by connecting) — "review the authorization" or "nobody
 * answers" is a different problem — and the person may open the channel's
 * page.
 */
export function withLeadChannel(
  item: EssentialSetupItem,
  lead: FirstChannelLead | null | undefined,
  canAccess: (href: string) => boolean,
): EssentialSetupItem {
  if (!lead || item.key !== "channel" || item.done || item.verification) return item;
  if (!CONNECT_FIRST_LABELS.has(item.labelKey)) return item;
  const channel = item.channelType
    ? (isWizardChannel(item.channelType) ? item.channelType : null)
    : lead.fallback;
  if (!channel) return item;
  const href = LEAD_CHANNEL_HREF[channel];
  if (!canAccess(href)) return item;
  return {
    ...item,
    labelKey: "channelActions.connectLead",
    leadChannel: channel,
    href,
    // WhatsApp has its own first-channel tour; the others are walked to their
    // card on the channel list, which is what `connect_channel` does with a
    // `channelType`.
    tourId: channel === "whatsapp" ? "first_channel_whatsapp" : "connect_channel",
    channelType: channel,
  };
}
