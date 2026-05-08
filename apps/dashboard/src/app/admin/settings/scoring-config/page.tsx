"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { PageHeader } from "@/components/ui/page-header";
import { BarChart2, Save, Loader2, X, Plus } from "lucide-react";

interface Weights {
    engagement: number;
    intent: number;
    recency: number;
    stageProgress: number;
    profileCompleteness: number;
}

interface ScoringConfigData {
    weights: Weights;
    purchase_keywords: string[];
    decay_enabled: boolean;
    decay_days: number;
    decay_factor: number;
}

const DEFAULT_CONFIG: ScoringConfigData = {
    weights: {
        engagement: 0.25,
        intent: 0.30,
        recency: 0.20,
        stageProgress: 0.15,
        profileCompleteness: 0.10,
    },
    purchase_keywords: [
        "precio", "costo", "comprar", "reservar", "disponible",
        "cuánto vale", "quiero", "inscribir", "pagar", "descuento",
        "promoción", "oferta", "financiación", "cuotas",
    ],
    decay_enabled: false,
    decay_days: 30,
    decay_factor: 0.5,
};

const WEIGHT_KEYS: (keyof Weights)[] = [
    "engagement", "intent", "recency", "stageProgress", "profileCompleteness",
];

export default function ScoringConfigPage() {
    const t = useTranslations("scoringConfig");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [config, setConfig] = useState<ScoringConfigData>(DEFAULT_CONFIG);
    const [savedConfig, setSavedConfig] = useState<ScoringConfigData>(DEFAULT_CONFIG);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [newKeyword, setNewKeyword] = useState("");

    useEffect(() => {
        if (!activeTenantId) return;
        setLoading(true);
        api.getScoringConfig(activeTenantId)
            .then((res: any) => {
                const data = res?.data;
                if (data) {
                    const loaded: ScoringConfigData = {
                        weights: data.weights || DEFAULT_CONFIG.weights,
                        purchase_keywords: data.purchase_keywords || DEFAULT_CONFIG.purchase_keywords,
                        decay_enabled: data.decay_enabled ?? DEFAULT_CONFIG.decay_enabled,
                        decay_days: data.decay_days ?? DEFAULT_CONFIG.decay_days,
                        decay_factor: data.decay_factor ?? DEFAULT_CONFIG.decay_factor,
                    };
                    setConfig(loaded);
                    setSavedConfig(loaded);
                }
            })
            .catch(() => {
                setConfig(DEFAULT_CONFIG);
                setSavedConfig(DEFAULT_CONFIG);
            })
            .finally(() => setLoading(false));
    }, [activeTenantId]);

    const markDirty = useCallback(() => setDirty(true), []);

    const updateWeight = (key: keyof Weights, pct: number) => {
        setConfig((prev) => ({
            ...prev,
            weights: { ...prev.weights, [key]: pct / 100 },
        }));
        markDirty();
    };

    const totalPct = Math.round(
        WEIGHT_KEYS.reduce((sum, k) => sum + config.weights[k], 0) * 100
    );

    const addKeyword = () => {
        const kw = newKeyword.trim().toLowerCase();
        if (!kw || config.purchase_keywords.includes(kw)) return;
        setConfig((prev) => ({
            ...prev,
            purchase_keywords: [...prev.purchase_keywords, kw],
        }));
        setNewKeyword("");
        markDirty();
    };

    const removeKeyword = (kw: string) => {
        setConfig((prev) => ({
            ...prev,
            purchase_keywords: prev.purchase_keywords.filter((k) => k !== kw),
        }));
        markDirty();
    };

    const handleSave = async () => {
        if (!activeTenantId) return;
        setSaving(true);
        try {
            await api.saveScoringConfig(activeTenantId, config);
            setSavedConfig(config);
            setDirty(false);
        } catch (err) {
            console.error("Failed to save scoring config:", err);
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        setConfig(savedConfig);
        setDirty(false);
    };

    if (loading) {
        return (
            <div className="max-w-2xl space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="skeleton h-20 w-full rounded-xl" />
                ))}
            </div>
        );
    }

    return (
        <div className="max-w-[800px] mx-auto pb-20 space-y-6">
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={BarChart2}
            />

            {/* Card 1: Score Weights */}
            <div className="rounded-xl border border-border bg-card">
                <div className="px-5 py-4 border-b border-border">
                    <h3 className="text-sm font-semibold text-foreground">{t("weightsTitle")}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("weightsDesc")}</p>
                </div>
                <div className="px-5 py-4 space-y-4">
                    {WEIGHT_KEYS.map((key) => {
                        const pct = Math.round(config.weights[key] * 100);
                        return (
                            <div key={key} className="flex items-center gap-4">
                                <span className="w-[160px] text-sm text-foreground shrink-0">
                                    {t(key)}
                                </span>
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={5}
                                    value={pct}
                                    onChange={(e) => updateWeight(key, Number(e.target.value))}
                                    className="flex-1 h-2 rounded-full appearance-none bg-muted accent-indigo-500 cursor-pointer"
                                />
                                <span className="w-[48px] text-right text-sm font-medium tabular-nums text-foreground">
                                    {pct}%
                                </span>
                            </div>
                        );
                    })}

                    {/* Total row */}
                    <div className="flex items-center gap-4 pt-3 border-t border-border">
                        <span className="w-[160px] text-sm font-semibold text-foreground shrink-0">
                            {t("totalWeight")}
                        </span>
                        <div className="flex-1" />
                        <span
                            className={`w-[48px] text-right text-sm font-semibold tabular-nums ${
                                totalPct === 100 ? "text-emerald-500" : "text-red-500"
                            }`}
                        >
                            {totalPct}%
                        </span>
                    </div>
                    {totalPct !== 100 && (
                        <p className="text-xs text-red-500 mt-1">{t("weightWarning")}</p>
                    )}
                </div>
            </div>

            {/* Card 2: Purchase Keywords */}
            <div className="rounded-xl border border-border bg-card">
                <div className="px-5 py-4 border-b border-border">
                    <h3 className="text-sm font-semibold text-foreground">{t("keywordsTitle")}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("keywordsDesc")}</p>
                </div>
                <div className="px-5 py-4 space-y-3">
                    {/* Add input */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newKeyword}
                            onChange={(e) => setNewKeyword(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    addKeyword();
                                }
                            }}
                            placeholder={t("keywordPlaceholder")}
                            className="flex-1 px-3 py-2 rounded-lg border border-border bg-transparent text-sm outline-none focus:border-indigo-500/50 text-foreground placeholder:text-muted-foreground"
                        />
                        <button
                            onClick={addKeyword}
                            className="px-3 py-2 rounded-lg border border-border bg-transparent text-sm text-indigo-500 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors flex items-center gap-1"
                        >
                            <Plus size={14} />
                            {t("addKeyword")}
                        </button>
                    </div>

                    {/* Chips */}
                    <div className="flex flex-wrap gap-2">
                        {config.purchase_keywords.map((kw) => (
                            <span
                                key={kw}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted border border-border text-xs text-foreground"
                            >
                                {kw}
                                <button
                                    onClick={() => removeKeyword(kw)}
                                    className="p-0 border-none bg-transparent text-muted-foreground hover:text-red-500 cursor-pointer transition-colors"
                                >
                                    <X size={12} />
                                </button>
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Card 3: Score Decay */}
            <div className="rounded-xl border border-border bg-card">
                <div className="px-5 py-4 border-b border-border">
                    <h3 className="text-sm font-semibold text-foreground">{t("decayTitle")}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("decayDesc")}</p>
                </div>
                <div className="px-5 py-4 space-y-4">
                    {/* Toggle */}
                    <label className="flex items-center gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={config.decay_enabled}
                            onChange={(e) => {
                                setConfig((prev) => ({ ...prev, decay_enabled: e.target.checked }));
                                markDirty();
                            }}
                            className="w-4 h-4 rounded border-border accent-indigo-500 cursor-pointer"
                        />
                        <span className="text-sm text-foreground">{t("decayEnabled")}</span>
                    </label>

                    {config.decay_enabled && (
                        <>
                            {/* Decay days */}
                            <div className="flex items-center gap-4">
                                <span className="w-[200px] text-sm text-foreground shrink-0">
                                    {t("decayDays")}
                                </span>
                                <input
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={config.decay_days}
                                    onChange={(e) => {
                                        setConfig((prev) => ({
                                            ...prev,
                                            decay_days: Number(e.target.value) || 1,
                                        }));
                                        markDirty();
                                    }}
                                    className="w-[100px] px-3 py-2 rounded-lg border border-border bg-transparent text-sm outline-none text-center text-foreground focus:border-indigo-500/50"
                                />
                            </div>

                            {/* Decay factor */}
                            <div className="flex items-center gap-4">
                                <div className="w-[200px] shrink-0">
                                    <span className="text-sm text-foreground">{t("decayFactor")}</span>
                                    <p className="text-xs text-muted-foreground mt-0.5">{t("decayFactorHelp")}</p>
                                </div>
                                <input
                                    type="range"
                                    min={10}
                                    max={90}
                                    step={5}
                                    value={Math.round(config.decay_factor * 100)}
                                    onChange={(e) => {
                                        setConfig((prev) => ({
                                            ...prev,
                                            decay_factor: Number(e.target.value) / 100,
                                        }));
                                        markDirty();
                                    }}
                                    className="flex-1 h-2 rounded-full appearance-none bg-muted accent-indigo-500 cursor-pointer"
                                />
                                <span className="w-[48px] text-right text-sm font-medium tabular-nums text-foreground">
                                    {Math.round(config.decay_factor * 100)}%
                                </span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Sticky save bar */}
            {dirty && (
                <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm px-6 py-3 flex items-center justify-end gap-3">
                    <span className="text-xs text-muted-foreground mr-auto">{t("unsavedChanges")}</span>
                    <button
                        onClick={handleCancel}
                        className="px-4 py-2 rounded-lg border border-border bg-transparent text-sm text-muted-foreground cursor-pointer hover:bg-muted transition-colors"
                    >
                        {t("cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || totalPct !== 100}
                        className="px-5 py-2 rounded-lg border-none bg-indigo-500 text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5 hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        {saving ? tc("saving") : tc("saveChanges")}
                    </button>
                </div>
            )}
        </div>
    );
}
