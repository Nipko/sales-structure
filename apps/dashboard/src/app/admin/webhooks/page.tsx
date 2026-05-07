"use client";

/**
 * Webhook live-tail console for super_admin. Polls /webhook-tap every
 * 5 seconds and shows the most recent inbound webhook events from all
 * channels. Useful for debugging integrations without container SSH.
 *
 * Storage is a Redis-backed bounded list (last 200 events, 7-day TTL).
 * Only summaries are stored — no PII / raw payloads.
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Radio, RefreshCw, Loader2, CheckCircle, XCircle, AlertTriangle, Pause, Play, Eye,
} from "lucide-react";

interface WebhookEvent {
    channelType: string;
    timestamp: string;
    status: "received" | "parsed" | "rejected" | "ignored" | "error";
    accountId?: string;
    summary?: string;
    error?: string;
}

const CHANNELS = ["whatsapp", "instagram", "messenger", "telegram", "sms"];
const STATUSES: WebhookEvent["status"][] = ["parsed", "ignored", "error", "rejected"];

const STATUS_STYLE: Record<WebhookEvent["status"], { bg: string; text: string; icon: any }> = {
    parsed:   { bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300", icon: CheckCircle },
    received: { bg: "bg-blue-500/10",    text: "text-blue-700 dark:text-blue-300",       icon: Radio },
    ignored:  { bg: "bg-neutral-500/10", text: "text-neutral-600 dark:text-neutral-400", icon: Eye },
    rejected: { bg: "bg-amber-500/10",   text: "text-amber-700 dark:text-amber-300",     icon: AlertTriangle },
    error:    { bg: "bg-red-500/10",     text: "text-red-700 dark:text-red-300",         icon: XCircle },
};

const CHANNEL_ACCENT: Record<string, string> = {
    whatsapp: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    instagram: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
    messenger: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    telegram: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    sms: "bg-neutral-500/10 text-neutral-700 dark:text-neutral-300",
};

const POLL_MS = 5000;

export default function WebhooksPage() {
    const t = useTranslations("webhookTap");
    const tc = useTranslations("common");
    const [events, setEvents] = useState<WebhookEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [paused, setPaused] = useState(false);
    const [filterChannel, setFilterChannel] = useState<string>("");
    const [filterStatus, setFilterStatus] = useState<string>("");
    const [lastFetch, setLastFetch] = useState<Date | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const res = await api.getWebhookTap({
                channelType: filterChannel || undefined,
                status: filterStatus || undefined,
                limit: 200,
            });
            if (res.success) {
                setEvents(res.data || []);
                setError(null);
                setLastFetch(new Date());
            } else {
                setError(res.error || tc("connectionError"));
            }
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setLoading(false);
        }
    }, [filterChannel, filterStatus, tc]);

    useEffect(() => { fetchData(); }, [fetchData]);

    useEffect(() => {
        if (paused) return;
        const id = setInterval(fetchData, POLL_MS);
        return () => clearInterval(id);
    }, [paused, fetchData]);

    const counts = {
        parsed: events.filter(e => e.status === "parsed").length,
        ignored: events.filter(e => e.status === "ignored").length,
        error: events.filter(e => e.status === "error").length,
        rejected: events.filter(e => e.status === "rejected").length,
    };

    const timeAgo = (iso: string) => {
        const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (sec < 60) return `${sec}s`;
        if (sec < 3600) return `${Math.floor(sec / 60)}m`;
        return `${Math.floor(sec / 3600)}h`;
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Radio className="h-6 w-6 text-pink-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPaused(!paused)}
                        className={cn(
                            "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition",
                            paused ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20"
                                : "bg-card border border-border hover:bg-muted",
                        )}
                    >
                        {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                        {paused ? t("resume") : t("pause")}
                    </button>
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-card border border-border hover:bg-muted rounded-lg text-sm transition disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {tc("refresh")}
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex bg-card border border-border rounded-lg p-0.5">
                    <button
                        onClick={() => setFilterChannel("")}
                        className={cn("px-3 py-1.5 text-xs font-medium rounded transition",
                            filterChannel === "" ? "bg-indigo-600 text-white" : "text-muted-foreground hover:text-foreground")}
                    >
                        {t("allChannels")}
                    </button>
                    {CHANNELS.map(ch => (
                        <button
                            key={ch}
                            onClick={() => setFilterChannel(ch)}
                            className={cn("px-3 py-1.5 text-xs font-medium rounded transition capitalize",
                                filterChannel === ch ? "bg-indigo-600 text-white" : "text-muted-foreground hover:text-foreground")}
                        >
                            {ch}
                        </button>
                    ))}
                </div>
                <div className="flex bg-card border border-border rounded-lg p-0.5">
                    <button
                        onClick={() => setFilterStatus("")}
                        className={cn("px-3 py-1.5 text-xs font-medium rounded transition",
                            filterStatus === "" ? "bg-indigo-600 text-white" : "text-muted-foreground hover:text-foreground")}
                    >
                        {t("allStatuses")}
                    </button>
                    {STATUSES.map(s => (
                        <button
                            key={s}
                            onClick={() => setFilterStatus(s)}
                            className={cn("px-3 py-1.5 text-xs font-medium rounded transition",
                                filterStatus === s ? "bg-indigo-600 text-white" : "text-muted-foreground hover:text-foreground")}
                        >
                            {t(`status.${s}` as any)}
                        </button>
                    ))}
                </div>
                {lastFetch && !paused && (
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        {t("liveUpdated", { time: lastFetch.toLocaleTimeString() })}
                    </span>
                )}
            </div>

            {/* Summary */}
            <div className="grid grid-cols-4 gap-2 text-sm">
                {(["parsed", "ignored", "rejected", "error"] as const).map(s => {
                    const Icon = STATUS_STYLE[s].icon;
                    return (
                        <div key={s} className={cn("rounded-lg border border-border p-2 flex items-center gap-2", STATUS_STYLE[s].bg)}>
                            <Icon className={cn("h-4 w-4", STATUS_STYLE[s].text)} />
                            <span className={cn("text-xs font-medium", STATUS_STYLE[s].text)}>{t(`status.${s}` as any)}</span>
                            <span className="ml-auto font-mono font-bold">{counts[s]}</span>
                        </div>
                    );
                })}
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Event list */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                    {loading && events.length === 0 ? (
                        <div className="px-4 py-8 text-center text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> {tc("loading")}
                        </div>
                    ) : events.length === 0 ? (
                        <div className="px-4 py-8 text-center text-muted-foreground">{t("empty")}</div>
                    ) : events.map((e, i) => {
                        const StatusIcon = STATUS_STYLE[e.status].icon;
                        return (
                            <div key={i} className="px-4 py-2.5 flex items-start gap-3 text-sm hover:bg-muted/20">
                                <StatusIcon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", STATUS_STYLE[e.status].text)} />
                                <span className={cn("inline-flex px-2 py-0.5 rounded text-[10px] font-mono font-medium flex-shrink-0", CHANNEL_ACCENT[e.channelType] || "bg-muted text-muted-foreground")}>
                                    {e.channelType}
                                </span>
                                <div className="flex-1 min-w-0">
                                    {e.summary && (
                                        <div className="font-mono text-xs truncate">{e.summary}</div>
                                    )}
                                    {e.error && (
                                        <div className="font-mono text-xs text-red-600 truncate">{e.error}</div>
                                    )}
                                    {e.accountId && (
                                        <div className="text-[10px] text-muted-foreground font-mono">
                                            {e.accountId.length > 24 ? e.accountId.slice(0, 24) + '…' : e.accountId}
                                        </div>
                                    )}
                                </div>
                                <span className="text-xs text-muted-foreground font-mono flex-shrink-0" title={e.timestamp}>
                                    {timeAgo(e.timestamp)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            <p className="text-[11px] text-muted-foreground border-t border-border pt-3">
                {t("hint")}
            </p>
        </div>
    );
}
