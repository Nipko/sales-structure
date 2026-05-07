"use client";

/**
 * Per-tenant feature flag panel for super_admin. Toggling a flag here
 * has immediate effect (cache invalidated). Pattern modeled after
 * LaunchDarkly's targeted rollouts — useful for incident killswitches,
 * beta gating, and sales-driven enablement.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Flag, Save, Loader2, AlertTriangle, CheckCircle, FlaskConical, Power,
} from "lucide-react";

interface FlagDef {
    key: string;
    label: string;
    description: string;
    category: "beta" | "killswitch" | "experimental";
    default: boolean;
}

interface FlagsData {
    registry: FlagDef[];
    flags: Record<string, boolean>;
}

const CATEGORY_STYLE: Record<FlagDef["category"], { bg: string; text: string; icon: any; labelKey: string }> = {
    beta:         { bg: "bg-blue-500/10",    text: "text-blue-700 dark:text-blue-300",       icon: FlaskConical, labelKey: "categoryBeta" },
    experimental: { bg: "bg-purple-500/10",  text: "text-purple-700 dark:text-purple-300",   icon: FlaskConical, labelKey: "categoryExperimental" },
    killswitch:   { bg: "bg-red-500/10",     text: "text-red-700 dark:text-red-300",         icon: Power,        labelKey: "categoryKillswitch" },
};

export default function TenantFeatureFlags({ tenantId }: { tenantId: string }) {
    const t = useTranslations("featureFlags");
    const tc = useTranslations("common");
    const [data, setData] = useState<FlagsData | null>(null);
    const [pending, setPending] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

    async function load() {
        setLoading(true);
        try {
            const res = await api.getTenantFeatureFlags(tenantId);
            if (res.success && res.data) {
                setData(res.data);
                setPending({ ...res.data.flags });
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, [tenantId]);

    const isEffectiveOn = (def: FlagDef): boolean => {
        if (!data) return def.default;
        if (Object.prototype.hasOwnProperty.call(pending, def.key)) {
            return pending[def.key];
        }
        return def.default;
    };

    const isOverridden = (def: FlagDef): boolean => {
        if (!data) return false;
        return Object.prototype.hasOwnProperty.call(data.flags, def.key)
            && (Object.prototype.hasOwnProperty.call(pending, def.key) || data.flags[def.key] !== def.default);
    };

    const hasUnsaved = (): boolean => {
        if (!data) return false;
        const keys = new Set([...Object.keys(data.flags), ...Object.keys(pending)]);
        for (const k of keys) {
            const a = data.flags[k];
            const b = pending[k];
            if (a !== b && !(a === undefined && b === undefined)) return true;
        }
        return false;
    };

    const handleToggle = (key: string, current: boolean) => {
        setPending(prev => ({ ...prev, [key]: !current }));
    };

    const handleSave = async () => {
        setSaving(true);
        setFeedback(null);
        try {
            const res = await api.setTenantFeatureFlags(tenantId, pending);
            if (res.success) {
                setFeedback({ type: "success", text: t("savedSuccess") });
                setData(prev => prev ? { ...prev, flags: res.data || {} } : prev);
            } else {
                setFeedback({ type: "error", text: res.error || tc("connectionError") });
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="bg-card border border-border rounded-xl p-6 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!data) return null;

    // Group by category
    const byCategory: Record<string, FlagDef[]> = { killswitch: [], beta: [], experimental: [] };
    for (const def of data.registry) byCategory[def.category].push(def);

    return (
        <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border flex items-start justify-between">
                <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Flag className="h-4 w-4 text-fuchsia-500" />
                        {t("title")}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("subtitle")}</p>
                </div>
                {hasUnsaved() && (
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {t("saveChanges")}
                    </button>
                )}
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

            <div className="p-4 space-y-5">
                {(["killswitch", "beta", "experimental"] as const).map(cat => {
                    const flags = byCategory[cat];
                    if (!flags?.length) return null;
                    const Icon = CATEGORY_STYLE[cat].icon;
                    return (
                        <div key={cat} className="space-y-2">
                            <h4 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 text-muted-foreground">
                                <Icon className="h-3.5 w-3.5" />
                                {t(CATEGORY_STYLE[cat].labelKey as any)}
                            </h4>
                            {flags.map(def => {
                                const on = isEffectiveOn(def);
                                const overridden = isOverridden(def);
                                return (
                                    <div key={def.key} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-muted/10">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium">{def.label}</span>
                                                <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-mono", CATEGORY_STYLE[cat].bg, CATEGORY_STYLE[cat].text)}>
                                                    {def.key}
                                                </span>
                                                {overridden && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 font-medium">
                                                        {t("overridden")}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                                        </div>
                                        <button
                                            onClick={() => handleToggle(def.key, on)}
                                            className={cn(
                                                "relative h-6 w-11 rounded-full transition-colors flex-shrink-0 mt-0.5",
                                                on
                                                    ? cat === "killswitch" ? "bg-red-500" : "bg-emerald-500"
                                                    : "bg-neutral-300 dark:bg-neutral-600",
                                            )}
                                            title={t(on ? "enabled" : "disabled")}
                                        >
                                            <div className={cn(
                                                "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left]",
                                                on ? "left-[26px]" : "left-[3px]",
                                            )} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}

                <p className="text-[11px] text-muted-foreground border-t border-border pt-3">
                    {t("hint")}
                </p>
            </div>
        </div>
    );
}
