"use client";

/**
 * Acquisition funnel for super_admin. Shows where signups drop off:
 *   Signup → Onboarding completed → First message → Paying
 *
 * Plus median time-to-first-message and a source breakdown so we can
 * see which acquisition channels deliver activated tenants vs which
 * just generate signups that stall at onboarding.
 *
 * Data is computed live from public.tenants timestamps. New columns:
 * onboarding_completed_at, first_message_at, signup_source.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Filter as FunnelIcon, RefreshCw, Loader2, TrendingUp, Clock, Users,
    UserPlus, MessageSquare, DollarSign,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

interface Stage {
    key: string;
    label: string;
    count: number;
    conversionFromPrev: number;
}

interface SourceRow {
    source: string;
    signups: number;
    onboarded: number;
    activated: number;
    paying: number;
}

interface FunnelData {
    window: { since: string; until: string };
    stages: Stage[];
    overallConversion: number;
    medianTimeToFirstMessageHours: number | null;
    bySource: SourceRow[];
}

const RANGE_OPTIONS = [
    { days: 7, labelKey: "range7d" },
    { days: 30, labelKey: "range30d" },
    { days: 90, labelKey: "range90d" },
];

const STAGE_ICONS: Record<string, any> = {
    signups: UserPlus,
    onboarded: Users,
    activated: MessageSquare,
    paying: DollarSign,
};

const STAGE_COLORS: Record<string, { bar: string; bg: string; text: string }> = {
    signups:    { bar: "bg-blue-500",    bg: "bg-blue-500/10",    text: "text-blue-600" },
    onboarded:  { bar: "bg-indigo-500",  bg: "bg-indigo-500/10",  text: "text-indigo-600" },
    activated:  { bar: "bg-emerald-500", bg: "bg-emerald-500/10", text: "text-emerald-600" },
    paying:     { bar: "bg-amber-500",   bg: "bg-amber-500/10",   text: "text-amber-700" },
};

export default function FunnelPage() {
    const t = useTranslations("funnel");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const [days, setDays] = useState(30);
    const [data, setData] = useState<FunnelData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        try {
            const res = await api.getOnboardingFunnel(days);
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
        }
    }

    useEffect(() => { load(); }, [days]);

    const topCount = data?.stages?.[0]?.count || 1;

    const formatTtfm = (hours: number | null) => {
        if (hours === null) return "—";
        if (hours < 1) return `${Math.round(hours * 60)}m`;
        if (hours < 24) return `${hours.toFixed(1)}h`;
        return `${(hours / 24).toFixed(1)}d`;
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <FunnelIcon className="h-6 w-6 text-indigo-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex bg-card border border-border rounded-lg p-0.5">
                        {RANGE_OPTIONS.map(r => (
                            <button
                                key={r.days}
                                onClick={() => setDays(r.days)}
                                className={cn(
                                    "px-3 py-1.5 text-xs font-medium rounded transition",
                                    days === r.days ? "bg-indigo-600 text-white" : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {t(r.labelKey as any)}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={load}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground rounded-lg text-sm transition disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {tc("refresh")}
                    </button>
                </div>
            </div>

            <HelpPanel
                title={tHelp("funnel.title")}
                description={tHelp("funnel.description")}
                tips={tHelp.raw("funnel.tips") as string[]}
                mediaKey="funnel"
            />

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Top KPIs */}
            {data && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="bg-card border border-border rounded-xl p-4">
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <TrendingUp className="h-3.5 w-3.5" />
                            {t("overallConversion")}
                        </div>
                        <div className="text-2xl font-bold mt-1 font-mono">{data.overallConversion}%</div>
                        <p className="text-[11px] text-muted-foreground mt-1">{t("signupToPaying")}</p>
                    </div>
                    <div className="bg-card border border-border rounded-xl p-4">
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            {t("ttfm")}
                        </div>
                        <div className="text-2xl font-bold mt-1 font-mono">{formatTtfm(data.medianTimeToFirstMessageHours)}</div>
                        <p className="text-[11px] text-muted-foreground mt-1">{t("ttfmHint")}</p>
                    </div>
                    <div className="bg-card border border-border rounded-xl p-4 col-span-2 sm:col-span-1">
                        <div className="text-xs text-muted-foreground">{t("rangeLabel")}</div>
                        <div className="text-2xl font-bold mt-1">
                            {data.stages[0]?.count ?? 0}
                            <span className="text-sm font-normal text-muted-foreground ml-1">{t("signupsTotal")}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                            {new Date(data.window.since).toLocaleDateString()} → {new Date(data.window.until).toLocaleDateString()}
                        </p>
                    </div>
                </div>
            )}

            {/* Funnel bars */}
            {data && (
                <div className="bg-card border border-border rounded-xl p-5 space-y-3">
                    <h2 className="text-base font-semibold">{t("stages")}</h2>
                    <div className="space-y-2">
                        {data.stages.map((s, i) => {
                            const Icon = STAGE_ICONS[s.key] || UserPlus;
                            const colors = STAGE_COLORS[s.key];
                            const widthPct = topCount > 0 ? (s.count / topCount) * 100 : 0;
                            return (
                                <div key={s.key} className="flex items-center gap-3">
                                    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0", colors?.bg)}>
                                        <Icon className={cn("h-4 w-4", colors?.text)} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-sm font-medium">{s.label}</span>
                                            <span className="text-sm font-mono">
                                                {s.count.toLocaleString()}
                                                {i > 0 && (
                                                    <span className="ml-2 text-xs text-muted-foreground">
                                                        ({s.conversionFromPrev}%)
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className={cn("h-full transition-all", colors?.bar)}
                                                style={{ width: `${widthPct}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Source breakdown */}
            {data && data.bySource.length > 0 && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-border">
                        <h2 className="text-base font-semibold">{t("bySource")}</h2>
                        <p className="text-xs text-muted-foreground">{t("bySourceHint")}</p>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                            <tr className="text-left">
                                <th className="px-4 py-2 font-semibold">{t("source")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("signupsCol")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("onboardedCol")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("activatedCol")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("payingCol")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("conversionCol")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {data.bySource.map(s => {
                                const conv = s.signups > 0 ? Math.round((s.paying / s.signups) * 1000) / 10 : 0;
                                return (
                                    <tr key={s.source} className="hover:bg-muted/20">
                                        <td className="px-4 py-2 font-mono text-xs">{s.source}</td>
                                        <td className="px-4 py-2 text-right font-mono">{s.signups}</td>
                                        <td className="px-4 py-2 text-right font-mono text-muted-foreground">{s.onboarded}</td>
                                        <td className="px-4 py-2 text-right font-mono text-muted-foreground">{s.activated}</td>
                                        <td className="px-4 py-2 text-right font-mono">{s.paying}</td>
                                        <td className="px-4 py-2 text-right font-mono font-semibold">
                                            <span className={cn(conv >= 5 ? "text-emerald-600" : conv > 0 ? "text-amber-600" : "text-muted-foreground")}>
                                                {conv}%
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <p className="text-[11px] text-muted-foreground border-t border-border pt-3">
                {t("hint")}
            </p>
        </div>
    );
}
