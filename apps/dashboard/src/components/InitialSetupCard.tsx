"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Circle, Rocket, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { buildEssentialSetupItems, resolveInitialSetupSources, type EssentialSetupItem } from "@/lib/initial-setup";
import { canAccessDashboardNavigationPath } from "@/lib/navigation-access";

export default function InitialSetupCard() {
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
      const { status, planChannels, activeChannels } = resolveInitialSetupSources(
        statusResponse,
        planResponse,
        channelsResponse,
      );
      setItems(buildEssentialSetupItems({ status, planChannels, activeChannels, canAccess }));
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

  if (!tenantId) return null;
  const completed = items.filter((item) => item.done).length;
  if (!loading && !error && (items.length === 0 || completed === items.length)) return null;

  return (
    <section className="mb-8 rounded-xl border border-indigo-200 bg-indigo-50/60 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/[0.07]" aria-labelledby="initial-setup-card-title">
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
            <ol className="mt-4 grid gap-2 md:grid-cols-3">
              {items.map((item) => (
                <li key={item.key} className="flex min-h-14 items-center gap-2.5 rounded-lg border border-indigo-100 bg-white/90 p-3 dark:border-indigo-500/15 dark:bg-neutral-900/60">
                  {item.done
                    ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check size={14} aria-hidden="true" /></span>
                    : <Circle size={22} className="shrink-0 text-indigo-300 dark:text-indigo-500" aria-hidden="true" />}
                  <span className="min-w-0 flex-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">{t(`items.${item.key}`)}</span>
                  {!item.done && (
                    <Link href={item.href} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
                      {t("continue")} <ArrowRight size={12} aria-hidden="true" />
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
