"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface Props {
  overview: any;
  revenueTrend: any[];
}

const PLAN_COLORS: Record<string, string> = {
  starter: "#6b7280",
  pro: "#6366f1",
  professional: "#6366f1",
  enterprise: "#f59e0b",
  custom: "#a855f7",
};

const paymentStatusColor: Record<string, string> = {
  succeeded: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  paid: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
  refunded: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
};

export default function RevenueTab({ overview, revenueTrend }: Props) {
  const t = useTranslations("financials");

  const revenueData = (revenueTrend || []).map((item: any) => ({
    month: item.month,
    revenue: (item.revenue || 0) / 100,
  }));

  const successRateData = (revenueTrend || []).map((item: any) => ({
    month: item.month,
    rate: item.paymentSuccessRate ?? 100,
  }));

  const planData = (overview?.revenueByPlan || []).map((p: any) => ({
    name: p.plan,
    value: (p.revenue || 0) / 100,
    fill: PLAN_COLORS[p.plan] || "#6b7280",
  }));

  const recentPayments: any[] = overview?.recentPayments || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Trend */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
            {t("charts.revenueTrend")}
          </h3>
          {revenueData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9898b0" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9898b0" tickFormatter={(v) => `$${v.toLocaleString()}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a45", borderRadius: 8 }}
                  labelStyle={{ color: "#e8e8f0" }}
                  formatter={(value: any) => [`$${Number(value).toLocaleString()}`, t("table.revenue")]}
                />
                <Line type="monotone" dataKey="revenue" stroke="#00d68f" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>

        {/* Payment Success Rate */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
            {t("charts.paymentSuccessRate")}
          </h3>
          {successRateData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={successRateData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9898b0" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9898b0" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a45", borderRadius: 8 }}
                  labelStyle={{ color: "#e8e8f0" }}
                  formatter={(value: any) => [`${Number(value).toFixed(1)}%`, t("charts.paymentSuccessRate")]}
                />
                <Line type="monotone" dataKey="rate" stroke="#6c5ce7" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Plan */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
            {t("charts.revenueByPlan")}
          </h3>
          {planData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={planData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, value }) => `${name} ($${value.toLocaleString()})`}
                >
                  {planData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => `$${Number(value).toLocaleString()}`} />
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
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {t("table.tenant")} - {t("table.amount")}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.tenant")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.amount")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.status")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.date")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {recentPayments.slice(0, 10).map((p: any, i: number) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{p.tenantName}</td>
                    <td className="px-4 py-2 tabular-nums">${((p.amount || 0) / 100).toLocaleString()}</td>
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
            {recentPayments.length === 0 && (
              <div className="py-8 text-center text-neutral-500 text-sm">--</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
