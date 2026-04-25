"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AlertTriangle, Ban, Trash2 } from "lucide-react";
import type { Tenant } from "./types";

interface Props {
  tenants: Tenant[];
  onSuspend: (tenant: Tenant) => void;
  onReactivate: (tenantId: string) => void;
}

export default function OffboardingTab({ tenants, onSuspend, onReactivate }: Props) {
  const t = useTranslations("tenants");

  const pastDue = useMemo(
    () => tenants.filter((t2) => t2.subscriptionStatus === "past_due"),
    [tenants]
  );

  const suspended = useMemo(
    () =>
      tenants
        .filter((t2) => t2.suspendedAt)
        .sort((a, b) => new Date(b.suspendedAt!).getTime() - new Date(a.suspendedAt!).getTime()),
    [tenants]
  );

  const pendingDeletion = useMemo(
    () => tenants.filter((t2) => t2.subscriptionStatus === "cancelled" && !t2.isActive),
    [tenants]
  );

  const kpis = [
    { label: t("kpis.pastDue"), value: pastDue.length, icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: t("kpis.suspended"), value: suspended.length, icon: Ban, color: "text-red-500", bg: "bg-red-500/10" },
    { label: t("kpis.pendingDeletion"), value: pendingDeletion.length, icon: Trash2, color: "text-neutral-500", bg: "bg-neutral-500/10" },
  ];

  function daysPastDue(tenant: Tenant): number {
    if (!tenant.currentPeriodEnd) return 0;
    const end = new Date(tenant.currentPeriodEnd);
    const now = new Date();
    return Math.max(0, Math.floor((now.getTime() - end.getTime()) / (1000 * 60 * 60 * 24)));
  }

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-3 gap-3">
        {kpis.map((kpi) => {
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

      {/* Past Due Tenants */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("sections.pastDueTenants")}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 dark:border-neutral-800">
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.company")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.daysPastDue")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.periodEnd")}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-neutral-500 uppercase">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {pastDue.map((tenant) => (
                <tr key={tenant.id}>
                  <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{tenant.name}</td>
                  <td className="px-4 py-2">
                    <span className="text-amber-600 dark:text-amber-400 font-medium">{daysPastDue(tenant)}d</span>
                  </td>
                  <td className="px-4 py-2 text-neutral-500 text-xs">
                    {tenant.currentPeriodEnd ? new Date(tenant.currentPeriodEnd).toLocaleDateString() : "--"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => onSuspend(tenant)}
                        className="px-3 py-1 rounded-lg text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400 cursor-pointer border-none hover:bg-red-500/20"
                      >
                        {t("actions.suspend")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pastDue.length === 0 && (
            <div className="py-8 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>
      </div>

      {/* Recently Suspended */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("sections.recentlySuspended")}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 dark:border-neutral-800">
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.company")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.suspendedDate")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.reason")}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-neutral-500 uppercase">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {suspended.map((tenant) => (
                <tr key={tenant.id}>
                  <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{tenant.name}</td>
                  <td className="px-4 py-2 text-neutral-500 text-xs">
                    {tenant.suspendedAt ? new Date(tenant.suspendedAt).toLocaleDateString() : "--"}
                  </td>
                  <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400 text-xs">{tenant.suspendReason || "--"}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => onReactivate(tenant.id)}
                      className="px-3 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-pointer border-none hover:bg-emerald-500/20"
                    >
                      {t("actions.reactivate")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {suspended.length === 0 && (
            <div className="py-8 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>
      </div>
    </div>
  );
}
