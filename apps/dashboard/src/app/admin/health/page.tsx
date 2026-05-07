"use client";

/**
 * Platform health dashboard. Polls /tenants/health every 15s and shows:
 *   - Service availability (api / redis / postgres)
 *   - BullMQ queue status (waiting / active / delayed / failed per queue)
 *
 * Visual cue: green dot when healthy, red when down. Failed-job count
 * highlighted in amber to draw attention to retry-stuck items.
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Activity, Database, Server, RefreshCw, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

interface HealthData {
    services: { api: boolean; redis: boolean; postgres: boolean };
    queues: Array<{ name: string; waiting: number; active: number; delayed: number; failed: number }>;
}

export default function HealthPage() {
    const t = useTranslations("platformHealth");
    const tc = useTranslations("common");
    const [data, setData] = useState<HealthData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastFetch, setLastFetch] = useState<Date | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const res = await api.getPlatformHealth();
            if (res.success) {
                setData(res.data);
                setError(null);
            } else {
                setError(res.error || tc("connectionError"));
            }
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setLoading(false);
            setLastFetch(new Date());
        }
    }, [tc]);

    useEffect(() => {
        fetchData();
        const id = setInterval(fetchData, 15000);
        return () => clearInterval(id);
    }, [fetchData]);

    const allServicesUp = data?.services
        ? data.services.api && data.services.redis && data.services.postgres
        : false;
    const anyFailedJobs = data?.queues?.some(q => q.failed > 0) || false;
    const overallStatus = !data ? "loading" : (!allServicesUp ? "degraded" : (anyFailedJobs ? "warning" : "healthy"));

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Activity className="h-6 w-6 text-emerald-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <button
                    onClick={fetchData}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-card border border-border hover:bg-muted rounded-lg text-sm transition disabled:opacity-50"
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {tc("refresh")}
                </button>
            </div>

            {/* Overall status banner */}
            <div className={cn(
                "rounded-xl border p-4 flex items-center justify-between",
                overallStatus === "healthy" && "bg-emerald-500/10 border-emerald-500/20",
                overallStatus === "warning" && "bg-amber-500/10 border-amber-500/20",
                overallStatus === "degraded" && "bg-red-500/10 border-red-500/20",
                overallStatus === "loading" && "bg-muted border-border",
            )}>
                <div className="flex items-center gap-3">
                    {overallStatus === "healthy" && <CheckCircle2 className="h-6 w-6 text-emerald-500" />}
                    {(overallStatus === "warning" || overallStatus === "degraded") && <AlertCircle className={cn("h-6 w-6", overallStatus === "warning" ? "text-amber-500" : "text-red-500")} />}
                    {overallStatus === "loading" && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                    <div>
                        <div className="font-semibold">
                            {t(`status.${overallStatus}` as any)}
                        </div>
                        {lastFetch && (
                            <div className="text-xs text-muted-foreground">
                                {t("lastChecked", { time: lastFetch.toLocaleTimeString() })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Services */}
            {data && (
                <div className="space-y-3">
                    <h2 className="text-base font-semibold">{t("services")}</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <ServiceCard label="API" icon={Server} healthy={data.services.api} />
                        <ServiceCard label="Redis" icon={Database} healthy={data.services.redis} />
                        <ServiceCard label="Postgres" icon={Database} healthy={data.services.postgres} />
                    </div>
                </div>
            )}

            {/* Queues */}
            {data && data.queues && data.queues.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-base font-semibold">{t("queues")}</h2>
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/30">
                                <tr className="text-left">
                                    <th className="px-4 py-2 font-semibold">{t("queueName")}</th>
                                    <th className="px-4 py-2 font-semibold text-right">{t("waiting")}</th>
                                    <th className="px-4 py-2 font-semibold text-right">{t("active")}</th>
                                    <th className="px-4 py-2 font-semibold text-right">{t("delayed")}</th>
                                    <th className="px-4 py-2 font-semibold text-right">{t("failed")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {data.queues.map(q => {
                                    const broken = q.waiting < 0;
                                    return (
                                        <tr key={q.name} className="hover:bg-muted/20">
                                            <td className="px-4 py-2 font-mono text-xs">{q.name}</td>
                                            {broken ? (
                                                <td colSpan={4} className="px-4 py-2 text-xs text-muted-foreground italic text-right">
                                                    {t("queueUnavailable")}
                                                </td>
                                            ) : (
                                                <>
                                                    <td className="px-4 py-2 text-right">{q.waiting}</td>
                                                    <td className="px-4 py-2 text-right">{q.active}</td>
                                                    <td className="px-4 py-2 text-right">{q.delayed}</td>
                                                    <td className={cn("px-4 py-2 text-right font-semibold", q.failed > 0 ? "text-amber-600" : "text-muted-foreground")}>
                                                        {q.failed}
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <p className="text-xs text-muted-foreground border-t border-border pt-3">
                {t("autoRefresh")}
            </p>
        </div>
    );
}

function ServiceCard({ label, icon: Icon, healthy }: { label: string; icon: any; healthy: boolean }) {
    return (
        <div className={cn(
            "border rounded-xl p-4 flex items-center justify-between",
            healthy ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20",
        )}>
            <div className="flex items-center gap-3">
                <Icon className={cn("h-5 w-5", healthy ? "text-emerald-500" : "text-red-500")} />
                <div className="font-medium">{label}</div>
            </div>
            <div className={cn(
                "w-2.5 h-2.5 rounded-full",
                healthy ? "bg-emerald-500 animate-pulse" : "bg-red-500",
            )} />
        </div>
    );
}
