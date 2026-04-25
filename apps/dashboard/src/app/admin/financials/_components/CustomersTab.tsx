"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Users, Clock, TrendingUp } from "lucide-react";
import {
  LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface Props {
  overview: any;
  trialMetrics: any;
  churnTrend: any[];
}

const STATUS_COLORS: Record<string, string> = {
  active: "#00d68f",
  trialing: "#6c5ce7",
  past_due: "#ffaa00",
  cancelled: "#ff4757",
};

export default function CustomersTab({ overview, trialMetrics, churnTrend }: Props) {
  const t = useTranslations("financials");

  const kpis = [
    { label: t("kpi.activeTrials"), value: trialMetrics?.activeTrials ?? 0, icon: Users, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    { label: t("kpi.trialsEndingSoon"), value: trialMetrics?.trialsEndingSoon?.length ?? 0, icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: t("kpi.conversionRate"), value: `${(trialMetrics?.conversionRate ?? 0).toFixed(1)}%`, icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  ];

  const statusData = (overview?.customerStatusDistribution || []).map((s: any) => ({
    name: s.status,
    value: s.count,
    fill: STATUS_COLORS[s.status] || "#6b7280",
  }));

  const churnData = (churnTrend || []).map((item: any) => ({
    month: item.month,
    churn: item.customerChurnRate ?? 0,
  }));

  const trialsEndingSoon: any[] = trialMetrics?.trialsEndingSoon || [];

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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

      {/* Trials Ending Soon */}
      {trialsEndingSoon.length > 0 && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("kpi.trialsEndingSoon")}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.tenant")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.trialEndsAt")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.daysLeft")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {trialsEndingSoon.map((trial: any, i: number) => {
                  const daysLeft = trial.daysLeft ?? Math.ceil(
                    (new Date(trial.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                  );
                  return (
                    <tr key={i}>
                      <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{trial.tenantName}</td>
                      <td className="px-4 py-2 text-neutral-500 text-xs">{new Date(trial.trialEndsAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2">
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-xs font-medium",
                          daysLeft <= 3 ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        )}>
                          {daysLeft}d
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Customer Status Distribution */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
            {t("kpi.activeCustomers")}
          </h3>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, value }) => `${name} (${value})`}
                >
                  {statusData.map((entry: any, i: number) => (
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

        {/* Churn Trend */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
            {t("charts.churnTrend")}
          </h3>
          {churnData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={churnData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9898b0" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9898b0" domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a45", borderRadius: 8 }}
                  labelStyle={{ color: "#e8e8f0" }}
                  formatter={(value: any) => [`${Number(value).toFixed(1)}%`, t("kpi.customerChurn")]}
                />
                <Line type="monotone" dataKey="churn" stroke="#ff4757" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>
      </div>
    </div>
  );
}
