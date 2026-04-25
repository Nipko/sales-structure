"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { DollarSign, Server, TrendingUp } from "lucide-react";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

interface Props {
  overview: any;
  costsTrend: any[];
  profitability: any[];
}

function formatCurrency(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function CostsTab({ overview, costsTrend, profitability }: Props) {
  const t = useTranslations("financials");

  const kpis = [
    { label: t("kpi.llmCost"), value: formatCurrency(overview?.llmCostThisMonth ?? 0), icon: DollarSign, color: "text-red-500", bg: "bg-red-500/10" },
    { label: t("kpi.infraCost"), value: formatCurrency(overview?.infraCostThisMonth ?? 0), icon: Server, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: t("kpi.grossMargin"), value: `${(overview?.grossMargin ?? 0).toFixed(1)}%`, icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  ];

  const costData = (costsTrend || []).map((item: any) => ({
    month: item.month,
    llm: (item.llmCost || 0) / 100,
    infra: (item.infraCost || 0) / 100,
  }));

  const marginData = (costsTrend || []).map((item: any) => ({
    month: item.month,
    margin: item.grossMargin ?? 0,
  }));

  // Sort profitability by profit ascending (least profitable first)
  const sortedProfitability = [...(profitability || [])].sort(
    (a: any, b: any) => (a.profit || 0) - (b.profit || 0)
  );

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost Trend */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
            {t("charts.costTrend")}
          </h3>
          {costData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={costData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9898b0" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9898b0" tickFormatter={(v) => `$${v.toLocaleString()}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a45", borderRadius: 8 }}
                  labelStyle={{ color: "#e8e8f0" }}
                  formatter={(value: any, name: any) => [`$${Number(value).toLocaleString()}`, name === "llm" ? t("kpi.llmCost") : t("kpi.infraCost")]}
                />
                <Area type="monotone" dataKey="llm" stackId="1" stroke="#ff4757" fill="#ff475730" />
                <Area type="monotone" dataKey="infra" stackId="1" stroke="#ffaa00" fill="#ffaa0030" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>

        {/* Gross Margin Trend */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
            {t("charts.grossMarginTrend")}
          </h3>
          {marginData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={marginData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9898b0" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9898b0" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a45", borderRadius: 8 }}
                  labelStyle={{ color: "#e8e8f0" }}
                  formatter={(value: any) => [`${Number(value).toFixed(1)}%`, t("kpi.grossMargin")]}
                />
                <Line type="monotone" dataKey="margin" stroke="#00d68f" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>
      </div>

      {/* Tenant Profitability Table */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("table.tenant")} - {t("table.profit")}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 dark:border-neutral-800">
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.tenant")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.plan")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.revenue")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.llmCost")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.profit")}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.margin")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {sortedProfitability.map((row: any, i: number) => {
                const margin = row.margin ?? 0;
                const marginColor = margin > 50
                  ? "text-emerald-600 dark:text-emerald-400"
                  : margin > 20
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400";

                return (
                  <tr key={i}>
                    <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{row.tenantName}</td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                        {row.plan}
                      </span>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{formatCurrency(row.revenue || 0)}</td>
                    <td className="px-4 py-2 tabular-nums">{formatCurrency(row.llmCost || 0)}</td>
                    <td className="px-4 py-2 tabular-nums font-medium">{formatCurrency(row.profit || 0)}</td>
                    <td className={cn("px-4 py-2 tabular-nums font-medium", marginColor)}>
                      {margin.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sortedProfitability.length === 0 && (
            <div className="py-8 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>
      </div>
    </div>
  );
}
