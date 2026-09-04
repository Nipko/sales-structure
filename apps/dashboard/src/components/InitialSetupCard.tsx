"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Circle, Compass, Rocket, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  GUIDED_TOUR_START_EVENT,
  canRoleRunGuidedTour,
  getGuidedTour,
  type GuidedTourStartDetail,
} from "@parallext/shared";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { guidedTourAnchorId } from "@/lib/guided-tours";
import { buildEssentialSetupItems, resolveInitialSetupSources, type EssentialSetupItem } from "@/lib/initial-setup";
import { readSetupStatusFacts } from "@/lib/onboarding-guide";
import { canAccessDashboardNavigationPath } from "@/lib/navigation-access";

/**
 * The single source of progress for a new account.
 *
 * Every item carries two actions on purpose. **Continuar** takes the person to
 * the screen; **Mostrarme dónde** opens the same screen and walks them to the
 * exact control. The second one exists because "go to Settings → Business
 * hours" is a sentence a hairdresser has no reason to be able to follow.
 */
export default function InitialSetupCard({
  onProgress,
}: {
  /** Reports completion upward so `/admin` can decide which guide to show. */
  onProgress?: (progress: { total: number; completed: number }) => void;
} = {}) {
  const t = useTranslations("qualityHealth.setup");
  const { user, verticalConfig } = useAuth();
  const { role, impersonating } = useRole();
  const tenantId = user?.tenantId;
  const [items, setItems] = useState<EssentialSetupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const canAccess = useCallback((href: string) => Boolean(role) && canAccessDashboardNavigationPath(
    href,
    role!,
    impersonating,
    verticalConfig,
  ), [impersonating, role, verticalConfig]);

  const load = useCallback(async () => {
    if (!tenantId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const [statusResponse, planResponse, channelsResponse] = await Promise.all([
        api.getSetupStatus(tenantId),
        api.getPlanFeatures(tenantId),
        api.fetch(`/channels/overview?tenantId=${tenantId}`),
      ]);

      // The checklist is graded with the same checks Agent health uses, so the
      // two surfaces can never contradict each other. Without an agent there is
      // nothing to grade and every item is honestly pending.
      const facts = readSetupStatusFacts(statusResponse);
      const agentId = facts?.defaultAgent?.id
        || (await resolveDefaultAgentId(tenantId));
      const qualityResponse = agentId
        ? await api.getAgentQualityOverview(tenantId, agentId)
        : undefined;

      const { status, planChannels, activeChannels, checks } = resolveInitialSetupSources(
        statusResponse,
        planResponse,
        channelsResponse,
        qualityResponse,
      );
      setItems(buildEssentialSetupItems({ status, planChannels, activeChannels, checks, canAccess }));
    } catch {
      setItems([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [canAccess, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const completed = items.filter((item) => item.done).length;

  // Held in a ref so an inline callback from the parent cannot turn this into a
  // render loop: the effect depends on the progress, never on the function.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  useEffect(() => {
    if (loading || error) return;
    onProgressRef.current?.({ total: items.length, completed });
  }, [completed, error, items.length, loading]);

  const startTour = useCallback((item: EssentialSetupItem) => {
    const tour = item.tourId ? getGuidedTour(item.tourId) : null;
    if (!tour || !canRoleRunGuidedTour(tour, role)) return;
    const detail: GuidedTourStartDetail = { tourId: tour.id };
    window.dispatchEvent(new CustomEvent(GUIDED_TOUR_START_EVENT, { detail }));
  }, [role]);

  if (!tenantId) return null;
  if (!loading && !error && (items.length === 0 || completed === items.length)) return null;

  const firstPending = items.find((item) => !item.done);

  return (
    <section
      id={guidedTourAnchorId("setup-card")}
      className="mb-8 rounded-xl border border-indigo-200 bg-indigo-50/60 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/[0.07]"
      aria-labelledby="initial-setup-card-title"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <Rocket size={19} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="initial-setup-card-title" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h2>
              <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{t("description")}</p>
            </div>
            {!loading && !error && <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">{t("progress", { completed, total: items.length })}</span>}
          </div>

          {loading ? (
            <div className="mt-4 h-14 animate-pulse rounded-lg bg-indigo-100/80 dark:bg-indigo-500/10" aria-label={t("loading")} />
          ) : error ? (
            <div className="mt-4 flex flex-col gap-2 rounded-lg bg-white/80 p-3 dark:bg-neutral-900/50 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-sm text-neutral-600 dark:text-neutral-300">{t("unavailable")}</p>
              <button type="button" onClick={() => void load()} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
                <RotateCw size={14} aria-hidden="true" /> {t("retry")}
              </button>
            </div>
          ) : (
            <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const isNext = firstPending?.key === item.key;
                const tour = item.tourId ? getGuidedTour(item.tourId) : null;
                const canShowMe = Boolean(tour) && canRoleRunGuidedTour(tour!, role);
                return (
                  <li
                    key={item.key}
                    className="flex min-h-14 flex-col gap-2 rounded-lg border border-indigo-100 bg-white/90 p-3 dark:border-indigo-500/15 dark:bg-neutral-900/60 sm:flex-row sm:items-center sm:gap-2.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      {item.done
                        ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check size={14} aria-hidden="true" /></span>
                        : <Circle size={22} className="shrink-0 text-indigo-300 dark:text-indigo-500" aria-hidden="true" />}
                      <span className="min-w-0 flex-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">{t(`items.${item.key}`)}</span>
                    </div>
                    {!item.done && (
                      <div
                        {...(isNext ? { id: guidedTourAnchorId("setup-next") } : {})}
                        className="flex shrink-0 flex-wrap items-center gap-1"
                      >
                        <Link href={item.href} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
                          {t("continue")} <ArrowRight size={12} aria-hidden="true" />
                        </Link>
                        {canShowMe && (
                          <button
                            type="button"
                            onClick={() => startTour(item)}
                            className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-300 dark:hover:bg-white/5"
                          >
                            <Compass size={12} aria-hidden="true" /> {t("showMe")}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Fallback for tenants whose `setup-status` predates `defaultAgent`. Returns
 * `null` when the tenant genuinely has no agent — which is a valid answer, not
 * a failure.
 */
async function resolveDefaultAgentId(tenantId: string): Promise<string | null> {
  try {
    const response = await api.listAgentQualityAgents(tenantId);
    if (!response.success || !Array.isArray(response.data)) return null;
    const agents = response.data;
    const preferred = agents.find((agent) => agent.is_default)
      ?? agents.find((agent) => agent.is_active)
      ?? agents[0];
    return preferred?.id ?? null;
  } catch {
    return null;
  }
}
