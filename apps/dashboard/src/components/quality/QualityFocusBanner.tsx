"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertOctagon, Clock3, Compass, MessageCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  AgentQualityCheck,
  AgentQualityOverview,
  AgentQualitySeverity,
  AgentQualitySignal,
  WhatsappDeliveryBlockReason,
} from "@parallext/shared";
import {
  GUIDED_TOUR_START_EVENT,
  WHATSAPP_DELIVERY_BLOCK_REASONS,
  canRoleRunGuidedTour,
  findGuidedTourForQualityCode,
  type GuidedTourStartDetail,
} from "@parallext/shared";
import { useQualityHealth } from "@/contexts/QualityHealthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { canRunProductTourAtWidth } from "@/lib/product-tour-contract";
import { askAssistAboutQuality, QUALITY_HEALTH_REFRESH_EVENT } from "@/lib/quality-health-events";
import {
  QUALITY_HEALTH_CACHE_MS,
  readQualityFocus,
  safeQualityHref,
  setFocusedQualitySignal,
  stripQualityFocus,
} from "@/lib/quality-health";
import { qualityCheckCodeFor, useRecommendationLabel } from "@/lib/quality-labels";
import { cn } from "@/lib/utils";
import { resolveQualityFocusResponse } from "@/lib/quality-focus";

/**
 * The context bar that makes "Revisar" consequent.
 *
 * The global banner used to say "there is a critical action, check Laura Sofía
 * first" and send the person to Channels, where WhatsApp shows a green
 * "Connected" chip and nothing explains what is wrong. This bar travels with
 * the `?qa=&qagent=` pair and states, on the destination screen: which action,
 * for which agent, why (in plain language, from the check's own evidence) and
 * what to do about it — including a guided tour that points at the control.
 *
 * It never blocks the page: a 404 (the signal was resolved elsewhere) or an
 * older API during a rolling deploy degrades to a dismissible line.
 */

const SEVERITY_TONE: Record<AgentQualitySeverity, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  low: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200",
};

interface FocusPayload {
  signal: AgentQualitySignal;
  overview: AgentQualityOverview | null;
}

interface CachedFocus {
  data: FocusPayload | null;
  fetchedAt: number;
}

/** Module cache: navigating between the steps of one fix must not refetch. */
const focusCache = new Map<string, CachedFocus>();

function cacheKey(tenantId: string, signalId: string, agentId: string): string {
  return `${tenantId}:${signalId}:${agentId}`;
}

function findCheck(overview: AgentQualityOverview | null, code: string): AgentQualityCheck | null {
  if (!overview) return null;
  const wanted = qualityCheckCodeFor(code);
  for (const dimension of overview.preparation.dimensions) {
    const match = dimension.checks.find((check) => check.code === wanted);
    if (match) return match;
  }
  return null;
}

/** Evidence values are bounded scalars by contract; render them as-is. */
function evidenceEntries(check: AgentQualityCheck | null): [string, string | number | boolean][] {
  if (!check?.evidence) return [];
  return Object.entries(check.evidence)
    .filter((entry): entry is [string, string | number | boolean] =>
      entry[1] !== null && entry[1] !== undefined && entry[1] !== "")
    .slice(0, 6);
}

function scalar(value: unknown, fallback = ""): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

function evidenceCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, count) : null;
}

export type PendingPriceScope = "services" | "plans" | "both";

/** One kind of price the agent will not say, counted over services and plans. */
export interface PendingPriceGroup {
  count: number;
  /** Which of the two lists it is in, so the sentence names the right screen's rows. */
  scope: PendingPriceScope;
}

/** Every price `services_example_price` counts, split by why the agent keeps quiet. */
export interface PendingPriceSummary {
  /** Amounts a recipe seeded and nobody confirmed. `null` when there are none. */
  example: PendingPriceGroup | null;
  /** Rows with no amount at all: the agent tells the customer "por confirmar". `null` when there are none. */
  missing: PendingPriceGroup | null;
}

function priceGroup(services: number, plans: number): PendingPriceGroup {
  const scope: PendingPriceScope = services > 0 && plans > 0 ? "both" : plans > 0 ? "plans" : "services";
  return { count: services + plans, scope };
}

/**
 * `services_example_price` counts every price the agent will not say yet, in
 * four numbers: example amounts on services (`examplePriceServices`) and on a
 * gym's membership plans (`examplePricePlans`), and services and plans with no
 * amount at all (`noPriceServices`, `noPricePlans`). Reading only the example
 * halves told an owner whose only pending prices were empty ones that there
 * were "0 servicios con un precio de ejemplo". The two kinds are kept apart
 * because the fix differs — confirm an amount vs. give one — and each says
 * which list it is in. An API without any of the four falls back to `count`.
 */
export function examplePriceSummary(evidence: Record<string, unknown>): PendingPriceSummary | null {
  const exampleServices = evidenceCount(evidence.examplePriceServices);
  const examplePlans = evidenceCount(evidence.examplePricePlans);
  const missingServices = evidenceCount(evidence.noPriceServices);
  const missingPlans = evidenceCount(evidence.noPricePlans);
  if ([exampleServices, examplePlans, missingServices, missingPlans].every((value) => value === null)) return null;
  const example = priceGroup(exampleServices ?? 0, examplePlans ?? 0);
  const missing = priceGroup(missingServices ?? 0, missingPlans ?? 0);
  return {
    // With nothing pending the check passes and this bar says it is resolved;
    // should a warning still arrive with four zeros, it keeps the one sentence
    // it always had rather than none.
    example: example.count > 0 || missing.count === 0 ? example : null,
    missing: missing.count > 0 ? missing : null,
  };
}

/**
 * Why a `whatsapp_delivery` check says the number cannot deliver, one reason
 * per sentence of the explanation. `reason` names one, or `multiple` with the
 * full list in `reasons` (comma-separated). Anything outside the contract's
 * list is dropped, in the contract's order; `[]` when the check names none.
 */
export function whatsappDeliveryReasons(evidence: Record<string, unknown>): WhatsappDeliveryBlockReason[] {
  const reason = typeof evidence.reason === "string" ? evidence.reason.trim() : "";
  const listed = reason === "multiple"
    ? (typeof evidence.reasons === "string" ? evidence.reasons.split(",") : [])
    : [reason];
  const wanted = new Set(listed.map((value) => value.trim()));
  return WHATSAPP_DELIVERY_BLOCK_REASONS.filter((known) => wanted.has(known));
}

/** The connected channel types a `channel_unanswered` check says nobody answers. */
export function unansweredChannelTypes(evidence: Record<string, unknown>): string[] {
  if (typeof evidence.unansweredChannels !== "string") return [];
  return [...new Set(evidence.unansweredChannels.split(",").map((type) => type.trim()).filter(Boolean))];
}

/**
 * Why nobody answers: no agent at all (`none`), two agents claiming the same
 * channel so the pipeline picks neither (`conflict`), or some of each. The fix
 * differs — assign one, or leave only one.
 */
export function unansweredCause(evidence: Record<string, unknown>): "none" | "conflict" | "mixed" {
  const none = evidenceCount(evidence.unanswered) ?? 0;
  const conflicted = evidenceCount(evidence.conflicted) ?? 0;
  if (conflicted > 0 && none > 0) return "mixed";
  return conflicted > 0 ? "conflict" : "none";
}

export default function QualityFocusBanner() {
  const t = useTranslations("qualityHealth");
  const tQuality = useTranslations("agentQuality");
  const recommendationLabel = useRecommendationLabel();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeTenantId } = useTenant();
  const { role, isSuperAdmin, impersonating, canAccess } = useRole();
  const { snoozeSignal } = useQualityHealth();

  const eligible = role === "tenant_admin"
    || role === "tenant_supervisor"
    || (isSuperAdmin && impersonating);

  const focus = useMemo(() => readQualityFocus(searchParams), [searchParams]);
  const [payload, setPayload] = useState<FocusPayload | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "gone" | "unavailable">("idle");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => {
    if (activeTenantId && focus) focusCache.delete(cacheKey(activeTenantId, focus.signalId, focus.agentId));
    setRevision(value => value + 1);
  }, [activeTenantId, focus]);
  useEffect(() => {
    window.addEventListener(QUALITY_HEALTH_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(QUALITY_HEALTH_REFRESH_EVENT, refresh);
  }, [refresh]);
  const [snoozing, setSnoozing] = useState(false);
  const [wideEnoughForTour, setWideEnoughForTour] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const sync = () => setWideEnoughForTour(canRunProductTourAtWidth(window.innerWidth));
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!eligible || !activeTenantId || !focus) {
      setPayload(null);
      setState("idle");
      return;
    }

    let cancelled = false;
    const key = cacheKey(activeTenantId, focus.signalId, focus.agentId);
    const cached = focusCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < QUALITY_HEALTH_CACHE_MS) {
      setPayload(cached.data);
      setState(cached.data ? "ready" : "gone");
      return;
    }

    setState("loading");
    void (async () => {
      // The overview is best-effort: without it the bar still names the action,
      // it just cannot spell out the evidence.
      const [signalResponse, overviewResponse] = await Promise.all([
        api.getAgentQualitySignal(activeTenantId, focus.signalId, focus.agentId),
        api.getAgentQualityOverview(activeTenantId, focus.agentId).catch(() => null),
      ]);
      if (cancelled) return;

      const resolved = resolveQualityFocusResponse(signalResponse, overviewResponse, focus.agentId);
      if (resolved.state !== "ready") {
        setPayload(null);
        setState(resolved.state);
        return;
      }

      const next: FocusPayload = resolved.payload;
      focusCache.set(key, { data: next, fetchedAt: Date.now() });
      setPayload(next);
      setState("ready");
    })().catch(() => {
      if (!cancelled) { setPayload(null); setState("unavailable"); }
    });

    return () => { cancelled = true; };
  }, [activeTenantId, eligible, focus, revision]);

  const visible = Boolean(focus) && ["ready", "gone", "unavailable"].includes(state);

  // Tell QualityAttentionBanner to stand down while this bar owns the signal.
  useEffect(() => {
    setFocusedQualitySignal(visible && focus ? focus.signalId : null);
    return () => setFocusedQualitySignal(null);
  }, [focus, visible]);

  const dismiss = useCallback(() => {
    setFocusedQualitySignal(null);
    router.replace(stripQualityFocus(pathname, searchParams));
  }, [pathname, router, searchParams]);

  const handleSnooze = useCallback(async () => {
    if (!focus) return;
    setSnoozing(true);
    await snoozeSignal(focus.signalId, 24);
    if (activeTenantId) focusCache.delete(cacheKey(activeTenantId, focus.signalId, focus.agentId));
    setSnoozing(false);
    dismiss();
  }, [activeTenantId, dismiss, focus, snoozeSignal]);

  if (!visible || !focus) return null;

  const verifiedCheck = payload ? findCheck(payload.overview, payload.signal.code) : null;
  const verifiedResolved = verifiedCheck?.status === "pass" || verifiedCheck?.status === "not_applicable";
  if (state === "gone" || !payload || verifiedResolved) {
    return (
      <div
        role="region"
        aria-live="polite"
        aria-label={t("focus.title")}
        className="shrink-0 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
      >
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-sm">{t(verifiedResolved ? "focus.verifiedResolved" : state === "unavailable" ? "focus.verificationUnavailable" : "focus.signalGone")}</p>
          {state === "unavailable" && <button type="button" onClick={refresh} className="rounded-md px-2.5 py-2 text-xs font-semibold focus-visible:ring-2">{t("setup.retry")}</button>}
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold hover:bg-neutral-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 dark:hover:bg-neutral-800"
          >
            <X size={13} aria-hidden="true" /> {t("focus.close")}
          </button>
        </div>
      </div>
    );
  }

  const { signal, overview } = payload;
  const check = findCheck(overview, signal.code);
  const evidence = check?.evidence ?? {};
  const staleAssignment = check?.code === 'channel_connection'
    && Number(evidence.staleBindings) > 0 && !evidence.hasCredentialIssue;
  const explanationCode = staleAssignment ? 'focus.explanations.stale_channel_binding' : `focus.explanations.${signal.code}`;
  const examplePrices = examplePriceSummary(evidence);
  const deliveryReasons = whatsappDeliveryReasons(evidence);
  // `channel_unanswered` names the channel types; the owner reads "WhatsApp",
  // not `web_widget`. A type this panel does not know keeps its raw name.
  const unansweredChannels = unansweredChannelTypes(evidence)
    .map((type) => (t.has(`focus.channelNames.${type}`) ? t(`focus.channelNames.${type}`) : type));
  const explanationParams = {
    agent: signal.agent.name,
    assigned: scalar(evidence.assigned ?? evidence.assignedChannels ?? evidence.assignedCount, "0"),
    connected: scalar(evidence.connected ?? evidence.connectedAssignments, "0"),
    disconnected: scalar(evidence.disconnectedChannels, t("focus.noneValue")),
    connectedChannels: scalar(evidence.connectedChannels, t("focus.noneValue")),
    credentialIssue: scalar(evidence.credentialIssue, "none"),
    // Only for an API without the four price counts (see `examplePriceSummary`).
    count: scalar(evidence.count, "0"),
    priceScope: "services",
    channels: unansweredChannels.join(", "),
    cause: unansweredCause(evidence),
  };
  const explanation = !check || check.status === "unknown"
    ? t("focus.verificationUnavailable")
    // One sentence per reason the number cannot deliver: a number with no
    // time zone AND no payment method needs both fixed, and saying only one
    // sends the owner back a second time. `other` = the check named none.
    : signal.code === "fix_whatsapp_delivery"
      ? (deliveryReasons.length ? deliveryReasons : ["other"])
        .map((reason) => t("focus.explanations.fix_whatsapp_delivery", { ...explanationParams, reason }))
        .join(" ")
      // One sentence per kind of pending price: example amounts to confirm,
      // and rows with no amount. Each names services, plans or both.
      : signal.code === "fix_services_example_price" && examplePrices
        ? [
          examplePrices.example && t("focus.explanations.fix_services_example_price", {
            ...explanationParams, count: examplePrices.example.count, priceScope: examplePrices.example.scope,
          }),
          examplePrices.missing && t("focus.explanations.services_no_price", {
            ...explanationParams, count: examplePrices.missing.count, priceScope: examplePrices.missing.scope,
          }),
        ].filter(Boolean).join(" ")
        // Without the channel list the sentence would name nothing.
        : signal.code === "fix_channel_unanswered" && unansweredChannels.length === 0
          ? t("focus.explanations.generic", explanationParams)
          : t(t.has(explanationCode) ? explanationCode : "focus.explanations.generic", explanationParams);

  const tour = !check || check.status === 'unknown' ? null : findGuidedTourForQualityCode(signal.code, evidence);
  const canShowMe = Boolean(tour)
    && canRoleRunGuidedTour(tour!, role)
    && wideEnoughForTour;
  const reviewHref = safeQualityHref(check?.href ?? signal.href, signal.agent.id);

  const startTour = () => {
    if (!tour) return;
    const detail: GuidedTourStartDetail = {
      tourId: tour.id,
      signalId: focus.signalId,
      agentId: focus.agentId,
    };
    window.dispatchEvent(new CustomEvent<GuidedTourStartDetail>(GUIDED_TOUR_START_EVENT, { detail }));
  };

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={t("focus.title")}
      className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <AlertOctagon size={17} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold">{recommendationLabel(signal.code)}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", SEVERITY_TONE[signal.severity])}>
                {tQuality(`severities.${signal.severity}`)}
              </span>
              <span className="text-amber-900/80 dark:text-amber-100/80">
                {t("focus.from", { agent: signal.agent.name })}
              </span>
            </p>
            <p className="mt-1 text-sm leading-relaxed text-amber-900/90 dark:text-amber-100/90">{explanation}</p>
            {evidenceEntries(check).length > 0 && (
              <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {evidenceEntries(check).map(([key, value]) => (
                  <div key={key} className="flex gap-1 rounded-md bg-white/50 px-1.5 py-0.5 text-[11px] dark:bg-black/20">
                    <dt className="opacity-75">
                      {tQuality.has(`evidenceKeys.${key}`) ? tQuality(`evidenceKeys.${key}`) : tQuality("evidenceKeys.unknown")}:
                    </dt>
                    <dd className="font-semibold">
                      {typeof value === "boolean" ? tQuality(value ? "common.yes" : "common.no") : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-6 xl:pl-0">
          {canShowMe && (
            <button
              type="button"
              onClick={startTour}
              className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md bg-amber-700 px-3 text-xs font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 dark:bg-amber-500 dark:text-neutral-950 dark:hover:bg-amber-400"
            >
              <Compass size={13} aria-hidden="true" /> {t("focus.showMe")}
            </button>
          )}
          <button
            type="button"
            onClick={() => askAssistAboutQuality({
              signalId: signal.id,
              agentId: signal.agent.id,
              agentName: signal.agent.name,
              code: signal.code,
              severity: signal.severity,
              href: canAccess(reviewHref) ? reviewHref : safeQualityHref(null, signal.agent.id),
            })}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:hover:bg-amber-500/20"
          >
            <MessageCircle size={13} aria-hidden="true" /> {t("askAssist")}
          </button>
          <button
            type="button"
            onClick={() => void handleSnooze()}
            disabled={snoozing}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-amber-500/20"
          >
            <Clock3 size={13} aria-hidden="true" /> {t("snooze24h")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("focus.close")}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:hover:bg-amber-500/20"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
