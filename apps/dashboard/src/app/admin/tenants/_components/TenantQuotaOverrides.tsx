"use client";

/**
 * Per-tenant quota override panel for super_admin. Shows the current
 * usage vs effective limit for each rate-limited action and lets the
 * operator bump (or remove) the limit independently of the plan.
 *
 * Pattern modeled after Stripe's "Custom limits" override on enterprise
 * accounts — useful for tenants with traffic spikes who shouldn't have
 * to upgrade tier just to handle a one-off campaign.
 *
 * Empty input = use plan default. -1 = unlimited.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Gauge, Save, Loader2, RotateCcw, AlertTriangle, CheckCircle, Info,
} from "lucide-react";

interface UsageRow {
    current: number;
    limit: number;     // -1 = unlimited
    plan: string;
    overridden: boolean;
}

interface OverrideData {
    overrides: {
        automation?: number;
        outbound?: number;
        broadcast?: number;
        maxAgents?: number;
        maxCalendars?: number;
        reason?: string;
        setBy?: string;
        setAt?: string;
    };
    features: { maxAgents: number; maxCalendars: number; templates: boolean; customPrompt: boolean };
    usage: { automation: UsageRow; outbound: UsageRow; broadcast: UsageRow };
}

const HOURLY_QUOTAS = [
    { key: "automation" as const, labelKey: "automationLabel", helpKey: "automationHelp" },
    { key: "outbound" as const, labelKey: "outboundLabel", helpKey: "outboundHelp" },
    { key: "broadcast" as const, labelKey: "broadcastLabel", helpKey: "broadcastHelp" },
];

const FEATURE_QUOTAS = [
    { key: "maxAgents" as const, labelKey: "maxAgentsLabel" },
    { key: "maxCalendars" as const, labelKey: "maxCalendarsLabel" },
];

export default function TenantQuotaOverrides({ tenantId }: { tenantId: string }) {
    const t = useTranslations("tenantQuota");
    const tc = useTranslations("common");

    const [data, setData] = useState<OverrideData | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // Form state — string so we can distinguish empty (use default) from 0
    const [form, setForm] = useState<Record<string, string>>({
        automation: "",
        outbound: "",
        broadcast: "",
        maxAgents: "",
        maxCalendars: "",
        reason: "",
    });

    async function load() {
        setLoading(true);
        try {
            const res = await api.getTenantQuotaOverrides(tenantId);
            if (res.success && res.data) {
                setData(res.data);
                const o = res.data.overrides || {};
                setForm({
                    automation: o.automation !== undefined ? String(o.automation) : "",
                    outbound: o.outbound !== undefined ? String(o.outbound) : "",
                    broadcast: o.broadcast !== undefined ? String(o.broadcast) : "",
                    maxAgents: o.maxAgents !== undefined ? String(o.maxAgents) : "",
                    maxCalendars: o.maxCalendars !== undefined ? String(o.maxCalendars) : "",
                    reason: o.reason || "",
                });
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, [tenantId]);

    async function handleSave() {
        setSaving(true);
        setFeedback(null);
        const payload: any = { reason: form.reason || undefined };
        for (const k of ["automation", "outbound", "broadcast", "maxAgents", "maxCalendars"]) {
            const v = form[k]?.trim();
            if (v === "" || v === undefined) continue;  // empty = use plan default
            const n = parseInt(v, 10);
            if (Number.isNaN(n)) continue;
            payload[k] = n;
        }
        try {
            const res = await api.setTenantQuotaOverrides(tenantId, payload);
            if (res.success) {
                setFeedback({ type: "success", text: t("savedSuccess") });
                load();
            } else {
                setFeedback({ type: "error", text: res.error || tc("connectionError") });
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setSaving(false);
        }
    }

    async function handleClearAll() {
        if (!confirm(t("clearAllConfirm"))) return;
        setSaving(true);
        setFeedback(null);
        try {
            const res = await api.setTenantQuotaOverrides(tenantId, { reason: "cleared" });
            if (res.success) {
                setFeedback({ type: "success", text: t("clearedSuccess") });
                load();
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="bg-card border border-border rounded-xl p-6 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!data) return null;

    const formatLimit = (n: number) => n === -1 ? t("unlimited") : n.toLocaleString();
    const usagePct = (current: number, limit: number) => {
        if (limit === -1 || limit === 0) return 0;
        return Math.min(100, Math.round((current / limit) * 100));
    };

    return (
        <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                            <Gauge className="h-4 w-4 text-cyan-500" />
                            {t("title")}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("subtitle")}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-medium uppercase">
                        {data.usage.automation.plan}
                    </span>
                </div>
            </div>

            {feedback && (
                <div className={cn(
                    "mx-4 mt-4 px-3 py-2 rounded-lg text-sm border flex items-start gap-2",
                    feedback.type === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
                    feedback.type === "error" && "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
                )}>
                    {feedback.type === "success" ? <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
                    <span>{feedback.text}</span>
                </div>
            )}

            <div className="p-4 space-y-4">
                {/* Hourly action limits */}
                <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{t("hourlyQuotas")}</h4>
                    {HOURLY_QUOTAS.map(q => {
                        const usage = data.usage[q.key];
                        const pct = usagePct(usage.current, usage.limit);
                        const over = pct >= 100;
                        const warn = pct >= 80 && !over;
                        return (
                            <div key={q.key} className="space-y-1.5">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div className="flex-1 min-w-[200px]">
                                        <label className="text-sm font-medium">{t(q.labelKey as any)}</label>
                                        <p className="text-xs text-muted-foreground">{t(q.helpKey as any)}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            placeholder={String(usage.limit === -1 ? "∞" : usage.limit)}
                                            value={form[q.key]}
                                            onChange={e => setForm({ ...form, [q.key]: e.target.value })}
                                            className="w-28 bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-right"
                                        />
                                        <span className="text-xs text-muted-foreground w-16">/ hora</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="font-mono w-24 text-muted-foreground">
                                        {usage.current.toLocaleString()} / {formatLimit(usage.limit)}
                                    </span>
                                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                        <div
                                            className={cn(
                                                "h-full transition-all",
                                                over ? "bg-red-500" : warn ? "bg-amber-500" : "bg-emerald-500",
                                            )}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                    {usage.overridden && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-medium">
                                            {t("overridden")}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Feature quotas */}
                <div className="space-y-2 border-t border-border pt-4">
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{t("featureQuotas")}</h4>
                    {FEATURE_QUOTAS.map(q => {
                        const planValue = data.features[q.key];
                        return (
                            <div key={q.key} className="flex items-center justify-between gap-3 flex-wrap">
                                <label className="text-sm font-medium flex-1 min-w-[200px]">{t(q.labelKey as any)}</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        placeholder={String(planValue)}
                                        value={form[q.key]}
                                        onChange={e => setForm({ ...form, [q.key]: e.target.value })}
                                        className="w-28 bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-right"
                                    />
                                    <span className="text-xs text-muted-foreground w-16">{t("currentLimit", { value: planValue })}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Reason */}
                <div className="border-t border-border pt-4">
                    <label className="block text-sm font-medium mb-1">{t("reasonLabel")}</label>
                    <input
                        type="text"
                        value={form.reason}
                        onChange={e => setForm({ ...form, reason: e.target.value })}
                        placeholder={t("reasonPlaceholder")}
                        className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm"
                    />
                </div>

                {/* Audit info */}
                {data.overrides.setAt && (
                    <p className="text-xs text-muted-foreground italic flex items-start gap-1.5">
                        <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        {t("lastSet", {
                            who: data.overrides.setBy || "—",
                            when: new Date(data.overrides.setAt).toLocaleString(),
                        })}
                    </p>
                )}

                <p className="text-[11px] text-muted-foreground border-t border-border pt-3">
                    {t("hint")}
                </p>

                {/* Actions */}
                <div className="flex justify-end gap-2">
                    {data.overrides.setAt && (
                        <button
                            onClick={handleClearAll}
                            disabled={saving}
                            className="px-3 py-2 hover:bg-muted rounded-lg text-sm inline-flex items-center gap-2 disabled:opacity-50"
                        >
                            <RotateCcw className="h-4 w-4" /> {t("clearAll")}
                        </button>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2 transition"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
