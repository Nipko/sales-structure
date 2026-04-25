"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Building2, Search, Eye, Edit, Ban, UserCheck, MoreHorizontal,
  DollarSign, Users, Activity, Clock, AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import type { Tenant, PlatformStats } from "./types";

interface Props {
  tenants: Tenant[];
  stats: PlatformStats | null;
  onEdit: (tenant: Tenant) => void;
  onSuspend: (tenant: Tenant) => void;
  onImpersonate: (tenant: Tenant) => void;
}

const STATUS_FILTERS = ["all", "active", "trialing", "past_due", "cancelled", "suspended"] as const;

const statusColor: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  trialing: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  past_due: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  cancelled: "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400",
  suspended: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const planColor: Record<string, string> = {
  starter: "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300",
  professional: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  pro: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  enterprise: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  custom: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

function resolveStatus(tenant: Tenant): string {
  if (tenant.suspendedAt) return "suspended";
  if (tenant.subscriptionStatus) return tenant.subscriptionStatus;
  if (!tenant.isActive) return "cancelled";
  return "active";
}

export default function TenantsOverviewTab({ tenants, stats, onEdit, onSuspend, onImpersonate }: Props) {
  const t = useTranslations("tenants");
  const tc = useTranslations("common");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const filtered = tenants.filter((tenant) => {
    const matchesSearch =
      tenant.name.toLowerCase().includes(search.toLowerCase()) ||
      tenant.slug.toLowerCase().includes(search.toLowerCase());
    const status = resolveStatus(tenant);
    const matchesStatus = statusFilter === "all" || status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const kpis = [
    { label: t("kpis.active"), value: stats?.active ?? tenants.filter(t2 => resolveStatus(t2) === "active").length, icon: Activity, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: t("kpis.trialing"), value: stats?.trialing ?? tenants.filter(t2 => resolveStatus(t2) === "trialing").length, icon: Clock, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: t("kpis.pastDue"), value: stats?.pastDue ?? tenants.filter(t2 => resolveStatus(t2) === "past_due").length, icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: t("kpis.cancelled"), value: stats?.cancelled ?? tenants.filter(t2 => resolveStatus(t2) === "cancelled").length, icon: Ban, color: "text-neutral-500", bg: "bg-neutral-500/10" },
    { label: t("kpis.mrr"), value: `$${(stats?.mrr ?? 0).toLocaleString()}`, icon: DollarSign, color: "text-indigo-500", bg: "bg-indigo-500/10" },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
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

      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors border",
              statusFilter === s
                ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 border-transparent"
                : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
            )}
          >
            {t(`status.${s}`)}
          </button>
        ))}

        <div className="ml-auto relative max-w-[300px] w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            placeholder={`${tc("search")}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">{t("table.company")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">{t("table.planCol")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">{t("table.statusCol")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">{t("table.periodEnd")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">{t("table.users")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">{t("table.channels")}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {filtered.map((tenant) => {
                const status = resolveStatus(tenant);
                return (
                  <tr key={tenant.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-500/10">
                          <Building2 size={16} className="text-indigo-500" />
                        </div>
                        <div>
                          <div className="font-medium text-neutral-900 dark:text-neutral-100">{tenant.name}</div>
                          <div className="text-xs text-neutral-500 dark:text-neutral-400">{tenant.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium", planColor[tenant.plan] || planColor.starter)}>
                        {tenant.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium", statusColor[status] || statusColor.active)}>
                        {t(`status.${status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400 text-xs">
                      {tenant.currentPeriodEnd ? new Date(tenant.currentPeriodEnd).toLocaleDateString() : "--"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
                        <Users size={14} />
                        <span>{tenant.users}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{tenant.channels}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="relative inline-block">
                        <button
                          onClick={() => setOpenMenu(openMenu === tenant.id ? null : tenant.id)}
                          className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer bg-transparent border-none text-neutral-500"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        {openMenu === tenant.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                            <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg py-1">
                              <Link
                                href={`/admin/tenants/${tenant.id}`}
                                className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 no-underline"
                                onClick={() => setOpenMenu(null)}
                              >
                                <Eye size={14} /> {t("actions.view")}
                              </Link>
                              <button
                                onClick={() => { onEdit(tenant); setOpenMenu(null); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer bg-transparent border-none text-left"
                              >
                                <Edit size={14} /> {t("actions.edit")}
                              </button>
                              <button
                                onClick={() => { onSuspend(tenant); setOpenMenu(null); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer bg-transparent border-none text-left"
                              >
                                <Ban size={14} /> {t("actions.suspend")}
                              </button>
                              <button
                                onClick={() => { onImpersonate(tenant); setOpenMenu(null); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer bg-transparent border-none text-left"
                              >
                                <UserCheck size={14} /> {t("actions.impersonate")}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-neutral-500 dark:text-neutral-400 text-sm">
              {tc("noResults")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
