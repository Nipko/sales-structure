"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { UserPlus, CheckCircle, Radio, Zap, AlertTriangle } from "lucide-react";
import type { Tenant, PlatformStats } from "./types";

interface Props {
  tenants: Tenant[];
  stats: PlatformStats | null;
}

export default function OnboardingTab({ tenants, stats }: Props) {
  const t = useTranslations("tenants");

  const now = new Date();
  const d7ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const d30ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const d3ago = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  const signups7d = stats?.signups7d ?? tenants.filter((t2) => new Date(t2.createdAt) >= d7ago).length;
  const signups30d = stats?.signups30d ?? tenants.filter((t2) => new Date(t2.createdAt) >= d30ago).length;
  const withChannels = tenants.filter((t2) => t2.channels > 0).length;
  const conversionRate = tenants.length > 0 ? ((withChannels / tenants.length) * 100).toFixed(1) : "0";
  const onboardedCount = tenants.filter((t2) => t2.onboardingCompleted).length;
  const activeCount = tenants.filter((t2) => t2.subscriptionStatus === "active" || t2.isActive).length;

  const recentSignups = useMemo(
    () =>
      tenants
        .filter((t2) => new Date(t2.createdAt) >= d30ago)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [tenants]
  );

  const stuckTenants = useMemo(
    () =>
      tenants.filter(
        (t2) => new Date(t2.createdAt) <= d3ago && t2.channels === 0
      ),
    [tenants]
  );

  const funnelSteps = [
    { label: t("onboardingFunnel.signedUp"), value: tenants.length, color: "bg-indigo-500" },
    { label: t("onboardingFunnel.onboardingComplete"), value: onboardedCount, color: "bg-blue-500" },
    { label: t("onboardingFunnel.channelConnected"), value: withChannels, color: "bg-amber-500" },
    { label: t("onboardingFunnel.activeSubscription"), value: activeCount, color: "bg-emerald-500" },
  ];
  const funnelMax = Math.max(...funnelSteps.map((s) => s.value), 1);

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t("kpis.signups7d"), value: signups7d, icon: UserPlus, color: "text-indigo-500", bg: "bg-indigo-500/10" },
          { label: t("kpis.signups30d"), value: signups30d, icon: UserPlus, color: "text-blue-500", bg: "bg-blue-500/10" },
          { label: t("kpis.conversionRate"), value: `${conversionRate}%`, icon: Zap, color: "text-emerald-500", bg: "bg-emerald-500/10" },
        ].map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="flex items-start justify-between p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              <div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">{kpi.label}</p>
                <p className="text-2xl font-semibold tabular-nums">{kpi.value}</p>
              </div>
              <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", kpi.bg)}>
                <Icon size={20} className={kpi.color} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Onboarding Funnel */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("onboardingFunnelTitle")}</h3>
        <div className="space-y-3">
          {funnelSteps.map((step) => {
            const pct = (step.value / funnelMax) * 100;
            return (
              <div key={step.label} className="flex items-center gap-3">
                <div className="w-40 text-xs text-neutral-600 dark:text-neutral-400 text-right font-medium">{step.label}</div>
                <div className="flex-1 h-7 rounded-md bg-neutral-100 dark:bg-neutral-800 overflow-hidden relative">
                  <div
                    className={cn("h-full rounded-md flex items-center justify-end pr-2 transition-all duration-500", step.color)}
                    style={{ width: `${Math.max(pct, 3)}%` }}
                  >
                    <span className="text-xs font-semibold text-white">{step.value}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Signups */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("sections.recentSignups")}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.company")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.planCol")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.created")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {recentSignups.slice(0, 10).map((tenant) => (
                  <tr key={tenant.id}>
                    <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{tenant.name}</td>
                    <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400">{tenant.plan}</td>
                    <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400 text-xs">
                      {new Date(tenant.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recentSignups.length === 0 && (
              <div className="py-8 text-center text-neutral-500 text-sm">--</div>
            )}
          </div>
        </div>

        {/* Stuck Tenants */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" />
              {t("sections.stuckTenants")}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t("sections.stuckDesc")}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.company")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.planCol")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.created")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {stuckTenants.slice(0, 10).map((tenant) => (
                  <tr key={tenant.id}>
                    <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{tenant.name}</td>
                    <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400">{tenant.plan}</td>
                    <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400 text-xs">
                      {new Date(tenant.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stuckTenants.length === 0 && (
              <div className="py-8 text-center text-neutral-500 text-sm">--</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
