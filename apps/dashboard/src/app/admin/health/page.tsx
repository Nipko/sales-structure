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
    ChevronDown, ChevronRight, Trash2, RotateCw, Trash, Eraser,
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
    const [busyJobId, setBusyJobId] = useState<string | null>(null);
    const [showCleanAll, setShowCleanAll] = useState(false);
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const load = useCallback(async () => {
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
    }, [queueName, state, tc]);

    useEffect(() => { load(); }, [load]);

    async function handleRemove(jobId: string) {
        if (!confirm(t("removeConfirm"))) return;
        setBusyJobId(jobId);
        setFeedback(null);
        try {
            const res = await api.removeQueueJob(queueName, jobId);
            if (res.success) {
                setFeedback({ type: "success", text: t("removeSuccess") });
                setJobs(prev => prev.filter(j => j.id !== jobId));
            } else {
                setFeedback({ type: "error", text: res.error || tc("connectionError") });
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setBusyJobId(null);
        }
    }

    async function handleRetry(jobId: string) {
        setBusyJobId(jobId);
        setFeedback(null);
        try {
            const res = await api.retryQueueJob(queueName, jobId);
            if (res.success) {
                setFeedback({ type: "success", text: t("retrySuccess") });
                setJobs(prev => prev.filter(j => j.id !== jobId));
            } else {
                setFeedback({ type: "error", text: res.error || tc("connectionError") });
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setBusyJobId(null);
        }
    }

    const Icon = STATE_ICONS[state] || InboxIcon;
    const canClean = state === 'failed' || state === 'completed' || state === 'delayed' || state === 'waiting';

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border gap-3">
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
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                            onClick={load}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-card border border-border hover:bg-muted rounded text-xs transition"
                            title={tc("refresh")}
                        >
                            <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                        {canClean && jobs.length > 0 && (
                            <button
                                onClick={() => setShowCleanAll(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-300 rounded text-xs font-medium transition"
                            >
                                <Eraser className="h-3.5 w-3.5" />
                                {t("cleanAll")}
                            </button>
                        )}
                        <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
                    </div>
                </div>

                {feedback && (
                    <div className={cn(
                        "mx-4 mt-3 px-3 py-2 rounded-lg text-sm border flex items-start gap-2",
                        feedback.type === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
                        feedback.type === "error" && "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
                    )}>
                        {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
                        <span>{feedback.text}</span>
                    </div>
                )}

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
                                <JobRow
                                    key={job.id}
                                    job={job}
                                    queueName={queueName}
                                    state={state}
                                    busy={busyJobId === job.id}
                                    onRemove={() => handleRemove(job.id)}
                                    onRetry={() => handleRetry(job.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-border bg-muted/10 text-xs text-muted-foreground">
                    {t("inspectorHint")}
                </div>

                {showCleanAll && (
                    <CleanAllModal
                        queueName={queueName}
                        state={state}
                        count={jobs.length}
                        onClose={() => setShowCleanAll(false)}
                        onSuccess={(removed) => {
                            setShowCleanAll(false);
                            setFeedback({ type: "success", text: t("cleanAllSuccess", { count: removed }) });
                            load();
                        }}
                    />
                )}
            </div>
        </div>
    );
}

interface JobDetail {
    id: string;
    name: string;
    state: string;
    data: any;
    opts: any;
    returnvalue: any;
    stacktrace: string[];
    failedReason: string | null;
    attemptsMade: number;
    timestamp: string | null;
    processedOn: string | null;
    finishedOn: string | null;
    progress: any;
}

function JobRow({
    job, queueName, state, busy, onRemove, onRetry,
}: {
    job: QueueJob;
    queueName: string;
    state: string;
    busy: boolean;
    onRemove: () => void;
    onRetry: () => void;
}) {
    const t = useTranslations("platformHealth");
    const tc = useTranslations("common");
    const [expanded, setExpanded] = useState(false);
    const [detail, setDetail] = useState<JobDetail | null>(null);
    const [loading, setLoading] = useState(false);

    async function toggleExpand() {
        if (expanded) { setExpanded(false); return; }
        setExpanded(true);
        if (detail) return;
        setLoading(true);
        try {
            const res = await api.getQueueJobDetail(queueName, job.id);
            if (res.success) setDetail(res.data);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className={cn("hover:bg-muted/20 transition", busy && "opacity-50 pointer-events-none")}>
            <div className="p-3 flex items-start justify-between gap-3">
                <button onClick={toggleExpand} className="flex-shrink-0 mt-0.5 p-0.5 hover:bg-muted rounded">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
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
                <div className="text-xs text-muted-foreground font-mono text-right flex-shrink-0 flex flex-col items-end gap-1">
                    {job.timestamp && <div>{new Date(job.timestamp).toLocaleString()}</div>}
                    {job.delay > 0 && state === 'delayed' && (
                        <div className="text-amber-600">+{Math.round(job.delay / 1000)}s</div>
                    )}
                    <div className="flex gap-1 mt-1">
                        {state === 'failed' && (
                            <button
                                onClick={onRetry}
                                disabled={busy}
                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded text-[10px] font-medium transition"
                                title={t("retryJob")}
                            >
                                <RotateCw className="h-3 w-3" />
                                {t("retry")}
                            </button>
                        )}
                        <button
                            onClick={onRemove}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-300 rounded text-[10px] font-medium transition"
                            title={t("removeJob")}
                        >
                            <Trash2 className="h-3 w-3" />
                            {t("remove")}
                        </button>
                    </div>
                </div>
            </div>

            {expanded && (
                <div className="pl-9 pr-4 pb-4 space-y-3">
                    {loading ? (
                        <div className="text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> {tc("loading")}
                        </div>
                    ) : detail ? (
                        <>
                            <div>
                                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">
                                    {t("payload")}
                                </div>
                                <pre className="bg-muted/40 border border-border rounded p-2 text-[11px] overflow-x-auto font-mono max-h-60">
                                    {JSON.stringify(detail.data, null, 2)}
                                </pre>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-[11px]">
                                <div>
                                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">{t("opts")}</div>
                                    <pre className="bg-muted/40 border border-border rounded p-2 overflow-x-auto font-mono">
                                        {JSON.stringify(detail.opts, null, 2)}
                                    </pre>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">{t("timeline")}</div>
                                    <div className="bg-muted/40 border border-border rounded p-2 font-mono space-y-0.5">
                                        <div><span className="text-muted-foreground">created:</span> {detail.timestamp ? new Date(detail.timestamp).toLocaleString() : '—'}</div>
                                        <div><span className="text-muted-foreground">processed:</span> {detail.processedOn ? new Date(detail.processedOn).toLocaleString() : '—'}</div>
                                        <div><span className="text-muted-foreground">finished:</span> {detail.finishedOn ? new Date(detail.finishedOn).toLocaleString() : '—'}</div>
                                    </div>
                                </div>
                            </div>
                            {detail.stacktrace && detail.stacktrace.length > 0 && (
                                <div>
                                    <div className="text-[10px] uppercase font-bold text-red-600 tracking-wider mb-1">{t("stacktrace")}</div>
                                    <pre className="bg-red-500/5 border border-red-500/20 rounded p-2 text-[11px] overflow-x-auto font-mono max-h-40 text-red-700 dark:text-red-300">
                                        {detail.stacktrace.slice(0, 5).join('\n\n')}
                                    </pre>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-xs text-muted-foreground italic">{t("detailUnavailable")}</div>
                    )}
                </div>
            )}
        </div>
    );
}

function CleanAllModal({
    queueName, state, count, onClose, onSuccess,
}: {
    queueName: string;
    state: string;
    count: number;
    onClose: () => void;
    onSuccess: (removed: number) => void;
}) {
    const t = useTranslations("platformHealth");
    const tc = useTranslations("common");
    const [confirmText, setConfirmText] = useState("");
    const [olderThanHours, setOlderThanHours] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const expected = `clean ${state}`;
    const matches = confirmText.trim().toLowerCase() === expected;

    async function handleClean() {
        if (!matches) return;
        setBusy(true);
        setError(null);
        try {
            const res = await api.cleanQueue(queueName, {
                state,
                olderThanMs: olderThanHours * 3600 * 1000,
                limit: 1000,
            });
            if (res.success) {
                onSuccess((res as any).removed || 0);
            } else {
                setError(res.error || tc("connectionError"));
            }
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border-2 border-red-500/30 rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border bg-red-500/5">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-red-500/20 flex items-center justify-center">
                            <Trash className="h-4 w-4 text-red-600" />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-red-700 dark:text-red-300">{t("cleanAllTitle")}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                <span className="font-mono">{queueName}</span> · {state}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} disabled={busy} className="p-1 hover:bg-muted rounded disabled:opacity-50">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                        {t("cleanAllWarning", { count })}
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">{t("olderThanLabel")}</label>
                        <select
                            value={olderThanHours}
                            onChange={e => setOlderThanHours(parseInt(e.target.value, 10))}
                            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                        >
                            <option value={0}>{t("olderAny")}</option>
                            <option value={1}>{t("olderHours", { hours: 1 })}</option>
                            <option value={6}>{t("olderHours", { hours: 6 })}</option>
                            <option value={24}>{t("olderHours", { hours: 24 })}</option>
                            <option value={168}>{t("olderDays", { days: 7 })}</option>
                            <option value={720}>{t("olderDays", { days: 30 })}</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">
                            {t("cleanAllConfirmLabel", { phrase: expected })}
                        </label>
                        <input
                            type="text"
                            value={confirmText}
                            onChange={e => setConfirmText(e.target.value)}
                            placeholder={expected}
                            className="w-full bg-card border-2 border-border rounded-lg px-3 py-2 font-mono text-sm"
                            autoFocus
                            disabled={busy}
                        />
                    </div>

                    {error && (
                        <div className="text-sm text-red-600 bg-red-500/10 p-2 rounded">{error}</div>
                    )}
                </div>

                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} disabled={busy} className="px-3 py-1.5 hover:bg-muted rounded-lg text-sm disabled:opacity-50">
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={handleClean}
                        disabled={!matches || busy}
                        className="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-red-600/30 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2"
                    >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {t("cleanAllConfirm")}
                    </button>
                </div>
            </div>
        </div>
    );
}
