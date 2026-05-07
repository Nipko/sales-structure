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
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Activity, Database, Server, RefreshCw, Loader2, AlertCircle, CheckCircle2, X,
    ListOrdered, AlertTriangle, Clock as ClockIcon, Play, Inbox as InboxIcon,
} from "lucide-react";

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
    const [inspect, setInspect] = useState<{ queueName: string; state: string } | null>(null);

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
                                                    <CountCell count={q.waiting} state="waiting" queueName={q.name} onClick={(qn, st) => setInspect({ queueName: qn, state: st })} />
                                                    <CountCell count={q.active} state="active" queueName={q.name} onClick={(qn, st) => setInspect({ queueName: qn, state: st })} />
                                                    <CountCell count={q.delayed} state="delayed" queueName={q.name} onClick={(qn, st) => setInspect({ queueName: qn, state: st })} />
                                                    <CountCell count={q.failed} state="failed" queueName={q.name} highlight={q.failed > 0} onClick={(qn, st) => setInspect({ queueName: qn, state: st })} />
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

            {inspect && (
                <QueueInspectorModal
                    queueName={inspect.queueName}
                    state={inspect.state}
                    onClose={() => setInspect(null)}
                />
            )}
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

/**
 * Clickable counter cell — opens the inspector modal with the actual
 * jobs in that state. Counts of 0 stay non-clickable to avoid noise.
 */
function CountCell({
    count, state, queueName, highlight, onClick,
}: {
    count: number;
    state: string;
    queueName: string;
    highlight?: boolean;
    onClick: (queueName: string, state: string) => void;
}) {
    if (count <= 0) {
        return (
            <td className={cn("px-4 py-2 text-right", highlight ? "text-amber-600 font-semibold" : "text-muted-foreground")}>
                {count}
            </td>
        );
    }
    return (
        <td className="px-4 py-2 text-right">
            <button
                onClick={() => onClick(queueName, state)}
                className={cn(
                    "px-2 py-0.5 rounded font-mono font-semibold hover:bg-indigo-500/10 hover:text-indigo-700 dark:hover:text-indigo-300 transition",
                    highlight && "text-amber-600",
                )}
                title="Inspect jobs"
            >
                {count}
            </button>
        </td>
    );
}

interface QueueJob {
    id: string;
    name: string;
    summary: string;
    tenantId: string | null;
    channelType: string | null;
    timestamp: string | null;
    delay: number;
    attemptsMade: number;
    failedReason: string | null;
    processedOn: string | null;
    finishedOn: string | null;
}

const STATE_ICONS: Record<string, any> = {
    waiting: ListOrdered,
    active: Play,
    delayed: ClockIcon,
    failed: AlertTriangle,
    completed: CheckCircle2,
};

function QueueInspectorModal({
    queueName, state, onClose,
}: { queueName: string; state: string; onClose: () => void }) {
    const t = useTranslations("platformHealth");
    const tc = useTranslations("common");
    const [jobs, setJobs] = useState<QueueJob[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const res = await api.getQueueJobs(queueName, state, 50);
                if (res.success) {
                    setJobs(res.data || []);
                    setError(null);
                } else {
                    setError(res.error || tc("connectionError"));
                }
            } catch (e: any) {
                setError(e?.message || tc("connectionError"));
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [queueName, state, tc]);

    const Icon = STATE_ICONS[state] || InboxIcon;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                            <Icon className="h-4 w-4 text-indigo-600" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-base font-semibold truncate">
                                <span className="font-mono">{queueName}</span>
                                <span className="text-muted-foreground"> · </span>
                                <span className="text-indigo-600 dark:text-indigo-400">{state}</span>
                            </h3>
                            <p className="text-xs text-muted-foreground">{t("inspectorSubtitle", { count: jobs.length })}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="px-4 py-12 text-center text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> {tc("loading")}
                        </div>
                    ) : error ? (
                        <div className="m-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-700 dark:text-red-300">
                            {error}
                        </div>
                    ) : jobs.length === 0 ? (
                        <div className="px-4 py-12 text-center text-muted-foreground">
                            {t("inspectorEmpty")}
                        </div>
                    ) : (
                        <div className="divide-y divide-border">
                            {jobs.map(job => (
                                <div key={job.id} className="p-4 hover:bg-muted/20">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-mono text-xs font-semibold">#{job.id}</span>
                                                {job.name && <span className="font-mono text-xs text-muted-foreground">{job.name}</span>}
                                                {job.channelType && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                                                        {job.channelType}
                                                    </span>
                                                )}
                                                {job.attemptsMade > 0 && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-mono">
                                                        {job.attemptsMade} {t("attempts")}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-muted-foreground font-mono mt-0.5">
                                                {job.summary || '—'}
                                            </div>
                                            {job.tenantId && (
                                                <Link
                                                    href={`/admin/tenants/${job.tenantId}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-xs text-indigo-600 hover:underline font-mono"
                                                >
                                                    {job.tenantId.slice(0, 8)}…
                                                </Link>
                                            )}
                                            {job.failedReason && (
                                                <div className="text-xs text-red-600 mt-1 font-mono break-all">
                                                    {job.failedReason.slice(0, 200)}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground font-mono text-right flex-shrink-0">
                                            {job.timestamp && (
                                                <div>{new Date(job.timestamp).toLocaleString()}</div>
                                            )}
                                            {job.delay > 0 && state === 'delayed' && (
                                                <div className="text-amber-600">+{Math.round(job.delay / 1000)}s</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-border bg-muted/10 text-xs text-muted-foreground">
                    {t("inspectorHint")}
                </div>
            </div>
        </div>
    );
}
