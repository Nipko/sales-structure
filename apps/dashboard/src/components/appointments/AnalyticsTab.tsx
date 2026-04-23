"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  CalendarCheck, CalendarX, UserX, Clock, TrendingUp, TrendingDown,
  BarChart3, Loader2,
} from "lucide-react";

interface AnalyticsTabProps {
  activeTenantId: string | null;
}

export default function AnalyticsTab({ activeTenantId }: AnalyticsTabProps) {
  const t = useTranslations("appointments");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");

  const dateRange = useMemo(() => {
    const end = new Date();
    const start = new Date();
    if (period === "7d") start.setDate(end.getDate() - 7);
    else if (period === "30d") start.setDate(end.getDate() - 30);
    else start.setDate(end.getDate() - 90);
    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
    };
  }, [period]);

  useEffect(() => {
    if (!activeTenantId) return;
    setLoading(true);
    api.getAppointmentAnalytics(activeTenantId, dateRange.start, dateRange.end)
      .then(res => { if (res.success) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeTenantId, dateRange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!data) return null;

  const { kpis, previousKpis, daily, byService, bySource, peakHours } = data;
  const maxDaily = Math.max(...daily.map((d: any) => d.total), 1);
  const maxHour = Math.max(...peakHours.map((h: any) => h.count), 1);

  const changeIcon = (cur: number, prev: number) => {
    if (cur > prev) return <TrendingUp size={14} className="text-emerald-500" />;
    if (cur < prev) return <TrendingDown size={14} className="text-red-500" />;
    return null;
  };

  const changePct = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? "+100%" : "—";
    const pct = Math.round(((cur - prev) / prev) * 100);
    return pct >= 0 ? `+${pct}%` : `${pct}%`;
  };

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t("analyticsTitle")}</h2>
        <div className="flex gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl">
          {(["7d", "30d", "90d"] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border-none transition-all",
                period === p
                  ? "bg-white dark:bg-neutral-900 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground bg-transparent")}>
              {t(`period.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t("total"), value: kpis.total, prev: previousKpis.total, icon: BarChart3, color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 dark:bg-indigo-500/10" },
          { label: t("status.completed"), value: kpis.completed, prev: previousKpis.completed, icon: CalendarCheck, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10", rate: `${kpis.completionRate}%` },
          { label: t("status.cancelled"), value: kpis.cancelled, prev: previousKpis.cancelled, icon: CalendarX, color: "text-red-500 dark:text-red-400", bg: "bg-red-50 dark:bg-red-500/10", rate: `${kpis.cancellationRate}%` },
          { label: t("status.noShow"), value: kpis.noShow, prev: previousKpis.noShow, icon: UserX, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-500/10", rate: `${kpis.noShowRate}%` },
        ].map(kpi => (
          <div key={kpi.label} className="p-5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between mb-3">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", kpi.bg)}>
                <kpi.icon size={20} className={kpi.color} />
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {changeIcon(kpi.value, kpi.prev)}
                <span>{changePct(kpi.value, kpi.prev)}</span>
              </div>
            </div>
            <p className="text-2xl font-semibold text-foreground">{kpi.value}</p>
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              {kpi.rate && <span className="text-[10px] font-semibold text-muted-foreground">{kpi.rate}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Volume Chart */}
        <div className="rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">{t("dailyVolume")}</h3>
          <div className="flex items-end gap-[2px] h-32">
            {daily.map((d: any, i: number) => (
              <div key={i} className="flex-1 flex flex-col items-stretch gap-[1px]" title={`${d.date}: ${d.total}`}>
                {d.noShow > 0 && (
                  <div className="bg-amber-400 rounded-t-sm" style={{ height: `${(d.noShow / maxDaily) * 100}%` }} />
                )}
                {d.cancelled > 0 && (
                  <div className="bg-red-400" style={{ height: `${(d.cancelled / maxDaily) * 100}%` }} />
                )}
                <div className="bg-emerald-500 rounded-b-sm" style={{ height: `${Math.max((d.completed / maxDaily) * 100, 2)}%` }} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3">
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {t("status.completed")}</span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-full bg-red-400" /> {t("status.cancelled")}</span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-full bg-amber-400" /> {t("status.noShow")}</span>
          </div>
        </div>

        {/* Peak Hours */}
        <div className="rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Clock size={14} /> {t("peakHours")}
          </h3>
          <div className="flex items-end gap-1 h-32">
            {Array.from({ length: 14 }, (_, i) => i + 7).map(hour => {
              const entry = peakHours.find((h: any) => h.hour === hour);
              const count = entry?.count || 0;
              return (
                <div key={hour} className="flex-1 flex flex-col items-center gap-1" title={`${hour}:00 — ${count}`}>
                  <div className="w-full bg-indigo-500 rounded-t-sm transition-all" style={{ height: `${maxHour > 0 ? (count / maxHour) * 100 : 0}%`, minHeight: count > 0 ? '4px' : '0' }} />
                  <span className="text-[9px] text-muted-foreground">{hour}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* By Service */}
        <div className="rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">{t("byService")}</h3>
          {byService.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">{t("noAppointments")}</p>
          ) : (
            <div className="space-y-3">
              {byService.slice(0, 8).map((svc: any) => {
                const maxSvc = byService[0]?.count || 1;
                return (
                  <div key={svc.serviceName}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: svc.color }} />
                        <span className="text-xs font-medium text-foreground">{svc.serviceName}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{svc.count}</span>
                    </div>
                    <div className="h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(svc.count / maxSvc) * 100}%`, backgroundColor: svc.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* By Source */}
        <div className="rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">{t("bySource")}</h3>
          {bySource.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">{t("noAppointments")}</p>
          ) : (
            <div className="space-y-2">
              {bySource.map((src: any) => {
                const sourceLabels: Record<string, string> = {
                  manual: t("source.manual"),
                  ai_agent: t("source.aiAgent"),
                  public_booking: t("source.publicBooking"),
                };
                const sourceColors: Record<string, string> = {
                  manual: "#6c5ce7",
                  ai_agent: "#00d68f",
                  public_booking: "#3b82f6",
                };
                return (
                  <div key={src.source} className="flex items-center justify-between p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: sourceColors[src.source] || "#999" }} />
                      <span className="text-xs font-medium text-foreground">{sourceLabels[src.source] || src.source}</span>
                    </div>
                    <span className="text-sm font-semibold text-foreground">{src.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
