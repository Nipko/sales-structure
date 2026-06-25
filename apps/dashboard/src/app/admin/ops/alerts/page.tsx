"use client";

/**
 * Alert thresholds configuration — lets super_admin tune the platform monitor's
 * thresholds (disk/RAM/Redis/connections/PgBouncer/payments/AI budget/storage/
 * projection/backup) and toggle the email/Telegram channels, without a deploy.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SlidersHorizontal, Loader2, Save, ChevronLeft, Check } from "lucide-react";

interface AlertConfig {
    disk: { warn: number; crit: number };
    ram: { warn: number; crit: number };
    redis: { warn: number; crit: number };
    dbConnections: { warn: number; crit: number };
    pgbouncer: { warnSec: number; critSec: number };
    sentryErrors: { warn: number; crit: number };
    slaBreaches: { warn: number; crit: number };
    queueDepth: Record<string, { warn: number; crit: number }>;
    queueFailed: number;
    paymentFailures: number;
    llmBudgetPct: number;
    storageQuotaPct: number;
    diskProjectionDays: number;
    backupStaleHours: number;
    channels: { email: boolean; telegram: boolean };
}

export default function AlertConfigPage() {
    const t = useTranslations("alertConfig");
    const tc = useTranslations("common");

    const [cfg, setCfg] = useState<AlertConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await api.getAlertConfig();
                if (res.success) setCfg(res.data as AlertConfig);
                else setError(res.error || tc("connectionError"));
            } catch (e: any) {
                setError(e?.message || tc("connectionError"));
            } finally {
                setLoading(false);
            }
        })();
    }, [tc]);

    function setNum(path: string[], val: string) {
        const n = Number(val);
        setCfg(prev => {
            if (!prev) return prev;
            const next: any = structuredClone(prev);
            let o: any = next;
            for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
            o[path[path.length - 1]] = Number.isFinite(n) ? n : 0;
            return next;
        });
        setSaved(false);
    }

    function setChannel(key: "email" | "telegram", val: boolean) {
        setCfg(prev => prev ? { ...prev, channels: { ...prev.channels, [key]: val } } : prev);
        setSaved(false);
    }

    async function save() {
        if (!cfg) return;
        setSaving(true);
        try {
            const res = await api.saveAlertConfig(cfg);
            if (res.success) { setCfg(res.data as AlertConfig); setSaved(true); setError(null); }
            else setError(res.error || tc("connectionError"));
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setSaving(false);
        }
    }

    const Pair = ({ label, base, warnKey = "warn", critKey = "crit", unit }: { label: string; base: "disk" | "ram" | "redis" | "dbConnections" | "pgbouncer" | "sentryErrors" | "slaBreaches"; warnKey?: string; critKey?: string; unit: string }) => (
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2 border-b border-border last:border-0">
            <span className="text-sm">{label}</span>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {t("warn")}
                <input type="number" value={(cfg as any)![base][warnKey]} onChange={e => setNum([base, warnKey], e.target.value)}
                    className="w-20 bg-card border border-border rounded-lg px-2 py-1 text-sm text-foreground" />
                <span className="w-6">{unit}</span>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {t("crit")}
                <input type="number" value={(cfg as any)![base][critKey]} onChange={e => setNum([base, critKey], e.target.value)}
                    className="w-20 bg-card border border-border rounded-lg px-2 py-1 text-sm text-foreground" />
                <span className="w-6">{unit}</span>
            </label>
        </div>
    );

    const Single = ({ label, field, unit }: { label: string; field: keyof AlertConfig; unit: string }) => (
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-2 border-b border-border last:border-0">
            <span className="text-sm">{label}</span>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="number" value={(cfg as any)![field]} onChange={e => setNum([field as string], e.target.value)}
                    className="w-20 bg-card border border-border rounded-lg px-2 py-1 text-sm text-foreground" />
                <span className="min-w-[2.5rem]">{unit}</span>
            </label>
        </div>
    );

    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <Link href="/admin/incidents" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
                    <ChevronLeft className="h-3.5 w-3.5" /> {t("backToIncidents")}
                </Link>
                <h1 className="text-2xl font-semibold flex items-center gap-2">
                    <SlidersHorizontal className="h-6 w-6 text-indigo-500" />
                    {t("title")}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">{error}</div>
            )}

            {loading || !cfg ? (
                <div className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" /> {tc("loading")}</div>
            ) : (
                <>
                    <section className="bg-card border border-border rounded-xl p-4">
                        <h3 className="text-sm font-semibold mb-1">{t("thresholdsTitle")}</h3>
                        <Pair label={t("disk")} base="disk" unit="%" />
                        <Pair label={t("ram")} base="ram" unit="%" />
                        <Pair label={t("redis")} base="redis" unit="%" />
                        <Pair label={t("dbConnections")} base="dbConnections" unit="%" />
                        <Pair label={t("pgbouncer")} base="pgbouncer" warnKey="warnSec" critKey="critSec" unit="s" />
                        <Pair label={t("sentryErrors")} base="sentryErrors" unit="/h" />
                        <Pair label={t("slaBreaches")} base="slaBreaches" unit="" />
                        <Single label={t("queueFailed")} field="queueFailed" unit={t("unitJobs")} />
                        <Single label={t("paymentFailures")} field="paymentFailures" unit={t("unit24h")} />
                        <Single label={t("llmBudgetPct")} field="llmBudgetPct" unit="%" />
                        <Single label={t("storageQuotaPct")} field="storageQuotaPct" unit="%" />
                        <Single label={t("diskProjectionDays")} field="diskProjectionDays" unit={t("unitDays")} />
                        <Single label={t("backupStaleHours")} field="backupStaleHours" unit={t("unitHours")} />
                    </section>

                    <section className="bg-card border border-border rounded-xl p-4">
                        <h3 className="text-sm font-semibold mb-1">{t("queueDepthTitle")}</h3>
                        <p className="text-xs text-muted-foreground mb-2">{t("queueDepthHint")}</p>
                        {Object.keys(cfg.queueDepth).map(name => (
                            <div key={name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2 border-b border-border last:border-0">
                                <span className="text-sm font-mono truncate">{name}</span>
                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    {t("warn")}
                                    <input type="number" value={cfg.queueDepth[name].warn} onChange={e => setNum(["queueDepth", name, "warn"], e.target.value)}
                                        className="w-20 bg-card border border-border rounded-lg px-2 py-1 text-sm text-foreground" />
                                </label>
                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    {t("crit")}
                                    <input type="number" value={cfg.queueDepth[name].crit} onChange={e => setNum(["queueDepth", name, "crit"], e.target.value)}
                                        className="w-20 bg-card border border-border rounded-lg px-2 py-1 text-sm text-foreground" />
                                </label>
                            </div>
                        ))}
                    </section>

                    <section className="bg-card border border-border rounded-xl p-4">
                        <h3 className="text-sm font-semibold mb-3">{t("channelsTitle")}</h3>
                        <div className="space-y-2">
                            {(["email", "telegram"] as const).map(ch => (
                                <label key={ch} className="flex items-center justify-between py-1.5 cursor-pointer">
                                    <span className="text-sm capitalize">{ch}</span>
                                    <input type="checkbox" checked={cfg.channels[ch]} onChange={e => setChannel(ch, e.target.checked)} className="h-4 w-4 accent-indigo-500" />
                                </label>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">{t("channelsHint")}</p>
                    </section>

                    <div className="flex items-center gap-3">
                        <button onClick={save} disabled={saving}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            {t("save")}
                        </button>
                        {saved && (
                            <span className="text-sm text-emerald-600 inline-flex items-center gap-1"><Check className="h-4 w-4" /> {t("saved")}</span>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
