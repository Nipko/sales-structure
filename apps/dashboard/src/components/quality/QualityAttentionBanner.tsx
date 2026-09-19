"use client";

import {
  AGENT_QUALITY_DELIVERY_FAILURE_CODES,
  WHATSAPP_DELIVERY_BLOCK_REASONS,
  isOnboardingBeforeLive,
  type AgentQualityAttentionAction,
  type AgentQualityAttentionSummary,
} from "@parallext/shared";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertOctagon, Clock3, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQualityHealth } from "@/contexts/QualityHealthContext";
import { useRole } from "@/hooks/useRole";
import {
  PRODUCT_TOUR_PENDING_KEY,
  PRODUCT_TOUR_CLOSED_EVENT,
  PRODUCT_TOUR_PREPARE_EVENT,
  canRunProductTourAtWidth,
} from "@/lib/product-tour-contract";
import { askAssistAboutQuality } from "@/lib/quality-health-events";
import {
  getOnboardingLandingServerSnapshot,
  getOnboardingLandingSignal,
  isOnboardingGuidanceOwningHome,
  subscribeOnboardingLanding,
  type OnboardingLandingSignal,
} from "@/lib/onboarding-guide-signal";
import {
  getFocusedQualitySignal,
  getFocusedQualitySignalServerSnapshot,
  safeQualityHref,
  shouldShowQualityAttentionBanner,
  subscribeFocusedQualitySignal,
  withQualityFocus,
} from "@/lib/quality-health";

/**
 * The signals that mean "the agent cannot answer through a channel this
 * account connected" — the shared list the API also picks `deliveryAction`
 * from: the connection cannot send, a connected channel has no agent answering
 * it, or WhatsApp refuses every reply. (An agent with no channel assigned is
 * not one of them: the default agent answers what nobody claims.)
 *
 * Before a channel exists they are just unfinished setup: the setup card asks
 * for exactly that, step by step. After one exists they are the reason the
 * agent is silent, and hiding them is how the day 0 ended with WhatsApp
 * "connected" and nobody answering.
 */
const DELIVERY_FAILURES: ReadonlySet<string> = new Set(AGENT_QUALITY_DELIVERY_FAILURE_CODES);

const DELIVERY_REASONS: ReadonlySet<string> = new Set(WHATSAPP_DELIVERY_BLOCK_REASONS);

/** What the banner reads from the session to decide whether a channel exists. */
export interface DayZeroChannelFacts {
  /** Active channel connections, from the same count the stage is derived from. `undefined` = not known. */
  hasAnyChannel?: unknown;
  onboardingStage?: unknown;
}

/**
 * Whether this account provably has a channel.
 *
 * `hasAnyChannel` is the server's own fact and travels with the session. Only
 * a POSITIVE fact proves anything, from any source: the stage (the wizard's
 * last button writes `completed`, which outranks `channel_connected`, so it
 * loses that proof on the usual path) and Home's published landing (fresher
 * than a session read at login, right after a connection) still count. A
 * `false` or a missing fact never vetoes another source's `true`.
 */
export function isChannelProvenForDayZero(
  facts: DayZeroChannelFacts | null | undefined,
  landing: OnboardingLandingSignal,
): boolean {
  return facts?.hasAnyChannel === true
    || facts?.onboardingStage === "channel_connected"
    || landing === "setup_card_and_health"
    || landing === "normal";
}

/**
 * True when this action says a channel cannot deliver, and that was CHECKED:
 * a critical signal from the shared delivery list whose check failed.
 *
 * A check that could not be RUN (`checkStatus: 'unknown'` — a lookup failed)
 * is also `critical` on a critical check, but it is not evidence that anything
 * is broken, so it never jumps ahead of anything. A signal stored before the
 * status travelled has none, and keeps counting as it always did.
 */
function isCheckedDeliveryFailure(
  action: Pick<AgentQualityAttentionAction, "code" | "severity" | "checkStatus"> | undefined,
): boolean {
  if (!action) return false;
  if (action.severity !== "critical" || !DELIVERY_FAILURES.has(action.code)) return false;
  return action.checkStatus === undefined || action.checkStatus === "fail";
}

/**
 * True when a day-0 account must see this action anyway: a checked delivery
 * failure over a proven channel. Every other quality nag waits for the first
 * real reply.
 */
export function isDayZeroDeliveryFailure(
  action: Pick<AgentQualityAttentionAction, "code" | "severity" | "checkStatus"> | undefined,
  channelProven: boolean,
): boolean {
  return channelProven && isCheckedDeliveryFailure(action);
}

/**
 * The delivery failure the bar puts first, day 0 or not.
 *
 * `deliveryAction` first: `topAction` is one row ordered by severity and
 * recency, so a silent channel can sit behind an unrelated critical. `topAction`
 * is still read for a summary from before `deliveryAction` existed.
 */
function deliveryFailureAction(
  summary: Pick<AgentQualityAttentionSummary, "topAction" | "deliveryAction"> | null | undefined,
): AgentQualityAttentionAction | undefined {
  for (const candidate of [summary?.deliveryAction, summary?.topAction]) {
    if (isCheckedDeliveryFailure(candidate)) return candidate;
  }
  return undefined;
}

/** The action a day-0 account sees, if any: a delivery failure over a proven channel. */
export function dayZeroDeliveryAction(
  summary: Pick<AgentQualityAttentionSummary, "topAction" | "deliveryAction"> | null | undefined,
  channelProven: boolean,
): AgentQualityAttentionAction | undefined {
  return channelProven ? deliveryFailureAction(summary) : undefined;
}

export type QualityBannerHeadline =
  | "bannerAtRisk"
  | "bannerCritical"
  | "bannerDeliveryFailure"
  | "bannerChannelUnanswered";

/** What the bar says: which action, its headline, and the one-line reason when the signal names one. */
export interface QualityBannerContent {
  action: AgentQualityAttentionAction;
  headline: QualityBannerHeadline;
  reasonKey: string | null;
}

/**
 * What the red bar shows, if anything.
 *
 * A checked delivery failure leads whenever there is one — during day 0 AND
 * after it. Day 0 ends at the first real reply or, for an agent that never
 * answered anybody, at the 3-day cap; going back to `topAction` there let an
 * unrelated critical (a missing business description) stand in front of the
 * one alert that explains why nobody gets an answer, under a generic headline.
 *
 * The specific headline ("tu agente no puede contestar por el canal que
 * conectaste") needs a proven channel. Day 0 without one is unfinished setup
 * and stays quiet; after day 0 the failure still leads, in the generic words,
 * because a channel assigned and never connected is not "the one you connected".
 */
export function qualityBannerContent(
  summary: AgentQualityAttentionSummary | null | undefined,
  context: { dayZero: boolean; channelProven: boolean },
): QualityBannerContent | null {
  const generic: QualityBannerHeadline = summary?.worstStatus === "at_risk" ? "bannerAtRisk" : "bannerCritical";
  const delivery = deliveryFailureAction(summary);
  if (delivery && (context.channelProven || !context.dayZero)) {
    const headline: QualityBannerHeadline = !context.channelProven
      ? generic
      : delivery.code === "fix_channel_unanswered" ? "bannerChannelUnanswered" : "bannerDeliveryFailure";
    return { action: delivery, headline, reasonKey: deliveryReasonKey(delivery) };
  }
  if (context.dayZero || !summary?.topAction || !shouldShowQualityAttentionBanner(summary)) return null;
  return { action: summary.topAction, headline: generic, reasonKey: null };
}

/** The i18n key of the one-line reason a WhatsApp delivery failure carries, if it names one. */
export function deliveryReasonKey(action: Pick<AgentQualityAttentionAction, "code" | "deliveryIssue">): string | null {
  if (action.code !== "fix_whatsapp_delivery" || !action.deliveryIssue) return null;
  return DELIVERY_REASONS.has(action.deliveryIssue) ? `bannerDeliveryReason.${action.deliveryIssue}` : null;
}

export default function QualityAttentionBanner() {
  const t = useTranslations("qualityHealth");
  const pathname = usePathname();
  const { summary, snoozeSignal } = useQualityHealth();
  const { canAccess, canEditAgent, canManageChannels } = useRole();
  const canLaunchTour = canEditAgent && canManageChannels;
  const [tourSuppressedPath, setTourSuppressedPath] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  // The context clears the snoozed signal from `topAction` and
  // `deliveryAction` while the snooze is in flight; this bar also hides the
  // action it showed on its own, so it never depends on which of the two the
  // context cleared. By the time the snooze settles the context has re-read
  // the summary: a snoozed signal is gone from it, a refused snooze brings the
  // alert back.
  const [snoozingSignalId, setSnoozingSignalId] = useState<string | null>(null);
  // The context bar on the destination screen explains the SAME signal with
  // more detail. Two red bars saying it read as two separate problems.
  const focusedSignalId = useSyncExternalStore(
    subscribeFocusedQualitySignal,
    getFocusedQualitySignal,
    getFocusedQualitySignalServerSnapshot,
  );
  // Una sola guía en la pantalla de inicio. Mientras la puesta en marcha manda
  // en `/admin` —o mientras todavía no se sabe— esta barra roja se calla: sobre
  // una cuenta recién creada `channel_connection` es crítico por definición, así
  // que decía en tono de alarma lo mismo que la tarjeta de puesta en marcha ya
  // estaba pidiendo paso a paso. En el resto de las pantallas no cambia nada.
  const onboardingLanding = useSyncExternalStore(
    subscribeOnboardingLanding,
    getOnboardingLandingSignal,
    getOnboardingLandingServerSnapshot,
  );

  useEffect(() => {
    try {
      // A pending tour cannot run on mobile because its anchors live in the
      // desktop sidebar. Do not let that deferred flag hide critical health.
      if (canLaunchTour
        && canRunProductTourAtWidth(window.innerWidth)
        && localStorage.getItem(PRODUCT_TOUR_PENDING_KEY) === "true") {
        setTourSuppressedPath(pathname);
      }
    } catch { /* the tour is optional */ }
    const suppressForTour = () => setTourSuppressedPath(pathname);
    const restoreAfterTour = () => setTourSuppressedPath(null);
    window.addEventListener(PRODUCT_TOUR_PREPARE_EVENT, suppressForTour);
    window.addEventListener(PRODUCT_TOUR_CLOSED_EVENT, restoreAfterTour);
    return () => {
      window.removeEventListener(PRODUCT_TOUR_PREPARE_EVENT, suppressForTour);
      window.removeEventListener(PRODUCT_TOUR_CLOSED_EVENT, restoreAfterTour);
    };
  }, [canLaunchTour, pathname]);

  const { user: authUser } = useAuth();
  // Before the first real reply almost every "critical" is unfinished setup,
  // and the setup card already says it without the red. The exception is the
  // one alert that explains a silent agent: a channel the account connected
  // that cannot deliver. That one comes through; the rest return once the
  // agent has answered somebody.
  const dayZero = isOnboardingBeforeLive(authUser?.onboardingStage, {
    firstReplyAt: authUser?.firstReplyAt,
    createdAt: authUser?.tenantCreatedAt,
  });
  const channelProven = isChannelProvenForDayZero(authUser, onboardingLanding);
  const content = qualityBannerContent(summary, { dayZero, channelProven });
  if (!content) return null;
  const { action: topAction, headline, reasonKey } = content;
  if (snoozingSignalId === topAction.signalId) return null;
  if (pathname === "/admin/setup-wizard" || pathname.startsWith("/admin/agent/quality")) return null;
  if (pathname === "/admin" && isOnboardingGuidanceOwningHome(onboardingLanding)) return null;
  if (tourSuppressedPath === pathname) return null;
  if (focusedSignalId && focusedSignalId === topAction.signalId) return null;

  const centerHref = safeQualityHref(null, topAction.agentId);
  const requestedHref = safeQualityHref(topAction.href, topAction.agentId);
  const allowedHref = canAccess(requestedHref) ? requestedHref : centerHref;
  // Carry the signal to the destination so the screen can say why it opened.
  const reviewHref = withQualityFocus(allowedHref, {
    signalId: topAction.signalId,
    agentId: topAction.agentId,
  });

  const handleSnooze = async () => {
    const signalId = topAction.signalId;
    setSnoozing(true);
    setSnoozingSignalId(signalId);
    try {
      await snoozeSignal(signalId, 24);
    } finally {
      setSnoozingSignalId(null);
      setSnoozing(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2.5 text-red-900 dark:border-red-900/70 dark:bg-red-950/35 dark:text-red-100" role="alert">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <AlertOctagon size={17} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <p className="min-w-0 text-sm">
            {/* A channel that cannot deliver leads, day 0 or not: say that,
                and why when the signal knows, not a generic "critical action". */}
            <span className="font-semibold">{t(headline)}</span>{" "}
            {reasonKey && <span>{t(reasonKey)}{" "}</span>}
            <span className="text-red-800/85 dark:text-red-200/85">{t("bannerAgent", { agent: topAction.agentName })}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-6 lg:pl-0">
          <Link href={reviewHref} className="inline-flex min-h-8 items-center justify-center rounded-md bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:bg-red-500 dark:text-neutral-950 dark:hover:bg-red-400">
            {t("review")}
          </Link>
          <button
            type="button"
            onClick={() => askAssistAboutQuality({
              signalId: topAction.signalId,
              agentId: topAction.agentId,
              agentName: topAction.agentName,
              code: topAction.code,
              severity: topAction.severity,
              href: allowedHref,
            })}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:hover:bg-red-900/50"
          >
            <MessageCircle size={13} aria-hidden="true" /> {t("askAssist")}
          </button>
          <button
            type="button"
            onClick={() => void handleSnooze()}
            disabled={snoozing}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-red-900/50"
          >
            <Clock3 size={13} aria-hidden="true" /> {t("snooze24h")}
          </button>
        </div>
      </div>
    </div>
  );
}
