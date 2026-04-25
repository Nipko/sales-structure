"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { DollarSign, Users, TrendingUp, TrendingDown, Activity, Zap } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface Props {
  overview: any;
  mrrTrend: any[];
}

function formatCurrency(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number): string {
  return `${(value || 0).toFixed(1)}%`;
}

export default function OverviewTab({ overview, mrrTrend }: Props) {
  const t = useTranslations("financials");

  const row1 = [
    { label: t("kpi.mrr"), value: formatCurrency(overview?.mrr ?? 0), icon: DollarSign, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    { label: t("kpi.arr"), value: formatCurrency(overview?.arr ?? 0), icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: t("kpi.activeCustomers"), value: overview?.activeCustomers ?? 0, icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: t("kpi.arpu"), value: formatCurrency(overview?.arpu ?? 0), icon: Activity, color: "text-purple-500", bg: "bg-purple-500/10" },
  ];

  const row2 = [
    { label: t("kpi.customerChurn"), value: formatPercent(overview?.customerChurnRate ?? 0), icon: TrendingDown, color: "text-red-500", bg: "bg-red-500/10" },
    { label: t("kpi.revenueChurn"), value: formatPercent(overview?.revenueChurnRate ?? 0), icon: TrendingDown, color: "text-orange-500", bg: "bg-orange-500/10" },
    { label: t("kpi.quickRatio"), value: (overview?.quickRatio ?? 0).toFixed(2), icon: Zap, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: t("kpi.ltv"), value: formatCurrency(overview?.ltv ?? 0), icon: DollarSign, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  ];

  const renderKpiRow = (kpis: typeof row1) => (
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
  );

  const mrrChartData = (mrrTrend || []).map((item: any) => ({
    month: item.month,
    mrr: (item.mrr || 0) / 100,
  }));

  const movementsData = (mrrTrend || []).map((item: any) => ({
    month: item.month,
    new: (item.newMrr || 0) / 100,
    expansion: (item.expansionMrr || 0) / 100,
    contraction: -Math.abs((item.contractionMrr || 0) / 100),
    churned: -Math.abs((item.churnedMrr || 0) / 100),
  }));

  return (
    <div className="space-y-6">
      {renderKpiRow(row1)}
      {renderKpiRow(row2)}

      {/* MRR Trend */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
          {t("charts.mrrTrend")}
        </h3>
        {mrrChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={mrrChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" opacity={0.3} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9898b0" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9898b0" tickFormatter={(v) => `$${v.toLocaleString()}`} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a45", borderRadius: 8 }}
                labelStyle={{ color: "#e8e8f0" }}
                formatter={(value: any) => [`$${Number(value).toLocaleString()}`, "MRR"]}
              />
              <Line type="monotone" dataKey="mrr" stroke="#6c5ce7" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="py-12 text-center text-neutral-500 text-sm">--</div>
        )}
      </div>

      {/* MRR Movements */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
          {t("charts.mrrMovements")}
        </h3>
        {movementsData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={movementsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" opacity={0.3} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9898b0" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9898b0" tickFormatter={(v) => `$${v.toLocaleString()}`} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a45", borderRadius: 8 }}
                labelStyle={{ color: "#e8e8f0" }}
                formatter={(value: any, name: any) => [`$${Math.abs(Number(value)).toLocaleString()}`, name]}
              />
              <Legend />
              <Bar dataKey="new" stackId="a" fill="#00d68f" name={t("movements.new")} />
              <Bar dataKey="expansion" stackId="a" fill="#6c5ce7" name={t("movements.expansion")} />
              <Bar dataKey="contraction" stackId="a" fill="#ffaa00" name={t("movements.contraction")} />
              <Bar dataKey="churned" stackId="a" fill="#ff4757" name={t("movements.churned")} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="py-12 text-center text-neutral-500 text-sm">--</div>
        )}
      </div>
    </div>
  );
}
