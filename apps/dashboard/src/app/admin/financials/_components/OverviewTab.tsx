"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { DollarSign, Users, TrendingUp, TrendingDown, Activity, Zap, Sparkles, AlertCircle } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ComposedChart, Area,
} from "recharts";

interface Props {
  overview: any;
  mrrTrend: any[];
  forecast?: {
    history: Array<{ month: string | Date; mrr: number; revenue: number; activeCustomers: number }>;
    forecast: Array<{
      month: string | Date;
      projectedMrrCents: number;
      projectedMrrLowerCents: number;
      projectedMrrUpperCents: number;
      projectedRevenueCents: number;
      projectedActiveCustomers: number;
    }>;
    metadata: {
      insufficientData: boolean;
      historyMonths: number;
      requiredMonths?: number;
      avgMoMGrowthPct?: number;
      rSquared?: number;
      projected3MonthMrrCents?: number | null;
      projected6MonthMrrCents?: number | null;
      projected12MonthMrrCents?: number | null;
    };
  } | null;
}

function formatMonthLabel(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatCurrency(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number): string {
  return `${(value || 0).toFixed(1)}%`;
}

export default function OverviewTab({ overview, mrrTrend, forecast }: Props) {
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

  // Forecast chart data: historical + projected MRR with confidence band
  const forecastChartData = (() => {
    if (!forecast || forecast.metadata.insufficientData) return [];
    const hist = forecast.history.map((h) => ({
      label: formatMonthLabel(h.month),
      historical: (h.mrr || 0) / 100,
      projected: null as number | null,
      lower: null as number | null,
      upper: null as number | null,
    }));
    // Bridge point: last historical also seeds the forecast line so it visually connects
    const last = forecast.history[forecast.history.length - 1];
    const bridgeMrr = last ? (last.mrr || 0) / 100 : 0;
    const proj = forecast.forecast.map((f, idx) => ({
      label: formatMonthLabel(f.month),
      historical: null as number | null,
      projected: f.projectedMrrCents / 100,
      lower: f.projectedMrrLowerCents / 100,
      upper: f.projectedMrrUpperCents / 100,
      // expose band thickness for stacked Area
      _bandFloor: f.projectedMrrLowerCents / 100,
      _bandHeight: (f.projectedMrrUpperCents - f.projectedMrrLowerCents) / 100,
    }));
    if (proj.length > 0) proj[0].historical = bridgeMrr;
    return [...hist, ...proj];
  })();

  return (
    <div className="space-y-6">
      {renderKpiRow(row1)}
      {renderKpiRow(row2)}

      {/* Forecast section */}
      {forecast && !forecast.metadata.insufficientData && (
        <div className="rounded-xl border border-indigo-200/50 dark:border-indigo-800/40 bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/30 dark:to-neutral-900 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10">
              <Sparkles size={16} className="text-indigo-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("forecast.title")}</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {t("forecast.subtitle", {
                  history: forecast.metadata.historyMonths,
                  rSquared: ((forecast.metadata.rSquared ?? 0) * 100).toFixed(0),
                })}
              </p>
            </div>
          </div>

          {/* Projection KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/60">
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">{t("forecast.momGrowth")}</p>
              <p className={cn(
                "text-xl font-semibold tabular-nums mt-0.5",
                (forecast.metadata.avgMoMGrowthPct ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
              )}>
                {(forecast.metadata.avgMoMGrowthPct ?? 0) >= 0 ? "+" : ""}
                {(forecast.metadata.avgMoMGrowthPct ?? 0).toFixed(1)}%
              </p>
            </div>
            <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/60">
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">{t("forecast.in3Months")}</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">
                {forecast.metadata.projected3MonthMrrCents != null
                  ? formatCurrency(forecast.metadata.projected3MonthMrrCents)
                  : "—"}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/60">
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">{t("forecast.in6Months")}</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">
                {forecast.metadata.projected6MonthMrrCents != null
                  ? formatCurrency(forecast.metadata.projected6MonthMrrCents)
                  : "—"}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/60">
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">{t("forecast.confidence")}</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">
                R² {(forecast.metadata.rSquared ?? 0).toFixed(2)}
              </p>
            </div>
          </div>

          {/* Combined chart: historical solid + forecast dashed + 95% CI band */}
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={forecastChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#9898b0" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9898b0" tickFormatter={(v) => `$${Number(v).toLocaleString()}`} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a45", borderRadius: 8 }}
                labelStyle={{ color: "#e8e8f0" }}
                formatter={(value: any, name: any) => {
                  if (value === null || value === undefined) return ["—", name];
                  return [`$${Number(value).toLocaleString()}`, name];
                }}
              />
              <Legend />
              {/* Confidence band — invisible floor + visible height */}
              <Area dataKey="_bandFloor" stackId="ci" stroke="none" fill="transparent" legendType="none" />
              <Area
                dataKey="_bandHeight"
                stackId="ci"
                stroke="none"
                fill="#6366f1"
                fillOpacity={0.12}
                name={t("forecast.confidenceBand")}
              />
              <Line type="monotone" dataKey="historical" stroke="#6c5ce7" strokeWidth={2.5} dot={{ r: 3 }} name={t("forecast.historical")} connectNulls={false} />
              <Line type="monotone" dataKey="projected" stroke="#6366f1" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} name={t("forecast.projected")} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {forecast && forecast.metadata.insufficientData && (
        <div className="rounded-xl border border-amber-200/60 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t("forecast.insufficientTitle")}</p>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
              {t("forecast.insufficientBody", {
                have: forecast.metadata.historyMonths,
                need: forecast.metadata.requiredMonths ?? 3,
              })}
            </p>
          </div>
        </div>
      )}

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
