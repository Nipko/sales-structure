"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { DollarSign, CreditCard, Users, AlertCircle } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { PlatformBilling } from "./types";

interface Props {
  billing: PlatformBilling | null;
}

const PLAN_COLORS: Record<string, string> = {
  starter: "#6b7280",
  professional: "#6366f1",
  pro: "#6366f1",
  enterprise: "#f59e0b",
  custom: "#a855f7",
};

const paymentStatusColor: Record<string, string> = {
  succeeded: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  paid: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
};

export default function BillingTab({ billing }: Props) {
  const t = useTranslations("tenants");

  const kpis = [
    { label: t("kpis.mrr"), value: `$${(billing?.mrr ?? 0).toLocaleString()}`, icon: DollarSign, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    { label: t("kpis.totalRevenue"), value: `$${(billing?.totalRevenue ?? 0).toLocaleString()}`, icon: DollarSign, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: t("kpis.activeSubs"), value: billing?.activeSubscriptions ?? 0, icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: t("kpis.failedPayments"), value: billing?.failedPayments ?? 0, icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10" },
  ];

  const pieData = (billing?.planDistribution ?? []).map((d) => ({
    name: d.plan,
    value: d.count,
    fill: PLAN_COLORS[d.plan] || "#6b7280",
  }));

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plan Distribution Pie */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("sections.planDistribution")}</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, value }) => `${name} (${value})`}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>

        {/* Recent Payments */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("sections.recentPayments")}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.tenant")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.amount")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.statusCol")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.date")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {(billing?.recentPayments ?? []).slice(0, 8).map((p, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{p.tenantName}</td>
                    <td className="px-4 py-2 tabular-nums">${p.amount.toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium", paymentStatusColor[p.status] || paymentStatusColor.pending)}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-neutral-500 text-xs">{new Date(p.date).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(billing?.recentPayments ?? []).length === 0 && (
              <div className="py-8 text-center text-neutral-500 text-sm">--</div>
            )}
          </div>
        </div>
      </div>

      {/* Failed Payments */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("sections.failedPaymentsTable")}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 dark:border-neutral-800">
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.tenant")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.amount")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.failureReason")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.date")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {(billing?.failedPaymentsList ?? []).map((p, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{p.tenantName}</td>
                  <td className="px-4 py-2 tabular-nums">${p.amount.toLocaleString()}</td>
                  <td className="px-4 py-2 text-red-600 dark:text-red-400 text-xs">{p.reason}</td>
                  <td className="px-4 py-2 text-neutral-500 text-xs">{new Date(p.date).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(billing?.failedPaymentsList ?? []).length === 0 && (
            <div className="py-8 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>
      </div>
    </div>
  );
}
