"use client";

/**
 * Recent admin activity feed for a single tenant. Shows the last 10
 * audit_log rows scoped to this tenant — useful when diagnosing "what
 * just happened?" without leaving the tenant detail page. The full log
 * lives at /admin/audit with filtering.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Clock, AlertTriangle, CheckCircle, Info, ExternalLink, Loader2,
} from "lucide-react";

interface AuditRow {
    id: string;
    action: string;
    resource: string | null;
    details: any;
    createdAt: string;
}

function actionAccent(action: string): string {
    if (action.includes("disconnect") || action.includes("suspend") || action.includes("offboard")
        || action.includes("purge") || action.includes("revoke")) return "text-red-600";
    if (action.includes("reactivate") || action.includes("connect") || action.includes("trial_extended")) return "text-emerald-600";
    if (action.includes("escalat") || action.includes("warn") || action.includes("stale")) return "text-amber-600";
    return "text-muted-foreground";
}

function actionIcon(action: string) {
    if (action.includes("disconnect") || action.includes("suspend") || action.includes("purge")) return AlertTriangle;
    if (action.includes("reactivate") || action.includes("connect")) return CheckCircle;
    return Info;
}

function timeAgo(iso: string): string {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const sec = Math.round((now - then) / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h`;
    const days = Math.round(hr / 24);
    return `${days}d`;
}

export default function TenantActivityFeed({ tenantId }: { tenantId: string }) {
    const t = useTranslations("tenantActivityFeed");
    const tc = useTranslations("common");
    const [rows, setRows] = useState<AuditRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetch() {
            try {
                const res = await api.getAuditLogs({ tenantId, limit: 10 });
                if (res.success) {
                    setRows(res.data?.rows || []);
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
        fetch();
    }, [tenantId, tc]);

    return (
        <div className="bg-card border border-border rounded-xl">
            <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="h-4 w-4 text-indigo-500" />
                    {t("title")}
                </h3>
                <Link
                    href={`/admin/audit?tenantId=${tenantId}`}
                    className="text-xs text-muted-foreground hover:text-indigo-600 inline-flex items-center gap-1"
                >
                    {t("viewAll")} <ExternalLink className="h-3 w-3" />
                </Link>
            </div>

            <div className="divide-y divide-border">
                {loading ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> {tc("loading")}
                    </div>
                ) : error ? (
                    <div className="px-4 py-6 text-center text-sm text-red-600">{error}</div>
                ) : rows.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t("empty")}</div>
                ) : rows.map(row => {
                    const Icon = actionIcon(row.action);
                    const accent = actionAccent(row.action);
                    return (
                        <div key={row.id} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                            <Icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", accent)} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className={cn("font-mono text-xs font-semibold", accent)}>{row.action}</span>
                                    {row.resource && <span className="text-xs text-muted-foreground">{row.resource}</span>}
                                </div>
                                {row.details?.providerError && (
                                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                        {String(row.details.providerError).substring(0, 120)}
                                    </p>
                                )}
                            </div>
                            <span className="text-xs text-muted-foreground font-mono flex-shrink-0">
                                {timeAgo(row.createdAt)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
