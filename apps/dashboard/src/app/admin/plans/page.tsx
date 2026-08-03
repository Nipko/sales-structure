"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { useTranslations } from "next-intl";
import { api, type MercadoPagoProviderStatus } from "@/lib/api";
import {
    Layers, Save, CheckCircle, AlertCircle, Loader2, Pencil, X,
    RefreshCw, Users, ToggleLeft, ToggleRight,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

type Plan = {
    id: string;
    slug: string;
    name: string;
    priceUsdCents: number;
    trialDays: number;
    requiresCardForTrial: boolean;
    maxAgents: number;
    maxAiMessages: number;
    features: Record<string, any>;
    priceLocalOverrides: Record<string, { currency: string; amountCents: number; mpPlanId?: string; annual?: { amountCents?: number; mpPlanId?: string } }>;
    isActive: boolean;
    sortOrder: number;
    tenantCount: number;
    unknownFeatureKeys?: string[];
};

type FeatureType = "boolean" | "number" | "string" | "array" | "object";
type FeatureDef = { key: string; type: FeatureType; category: string };

// Order + i18n label key (plansPage.categories.*) for each registry category.
const CATEGORY_ORDER = ["resource", "channel", "ai", "operational", "enterprise", "module", "rate", "media"] as const;
const CATEGORY_I18N: Record<string, string> = {
    resource: "resources",
    channel: "channels",
    ai: "ai",
    operational: "operational",
    enterprise: "enterprise",
    module: "modules",
    rate: "rateLimits",
    media: "media",
};

// Nested config objects render their inner numeric keys as sub-rows. These inner
// key sets mirror the backend RATE_LIMIT_KEYS / MEDIA_PROCESSING_KEYS.
const NESTED_INNER: Record<string, { key: string; label: string }[]> = {
    rateLimits: [
        { key: "automation", label: "rateLimitsAutomation" },
        { key: "outbound", label: "rateLimitsOutbound" },
        { key: "broadcast", label: "rateLimitsBroadcast" },
        { key: "priority", label: "rateLimitsPriority" },
        { key: "maxPendingJobs", label: "rateLimitsMaxPendingJobs" },
    ],
    mediaProcessing: [
        { key: "audioPerMonth", label: "mediaAudioPerMonth" },
        { key: "imagePerMonth", label: "mediaImagePerMonth" },
        { key: "maxAudioDurationSec", label: "mediaMaxAudioDurationSec" },
        { key: "perContactPerDay", label: "mediaPerContactPerDay" },
        { key: "perConvPer5min", label: "mediaPerConvPer5min" },
        { key: "perTenantPerHour", label: "mediaPerTenantPerHour" },
        { key: "dailyBudgetCentsUsd", label: "mediaDailyBudgetCentsUsd" },
    ],
    // Per-channel-type connected-account limits (-1 = unlimited). Rendered as
    // sub-rows under the "channels" category, alongside the channels chips.
    maxChannelAccounts: [
        { key: "whatsapp", label: "maxChannelAccountsWhatsapp" },
        { key: "instagram", label: "maxChannelAccountsInstagram" },
        { key: "messenger", label: "maxChannelAccountsMessenger" },
        { key: "telegram", label: "maxChannelAccountsTelegram" },
        { key: "sms", label: "maxChannelAccountsSms" },
    ],
};
// Categories that ARE a single nested object (whole category renders as sub-rows).
const CATEGORY_TO_NESTED: Record<string, string> = { rate: "rateLimits", media: "mediaProcessing" };

const CHANNEL_OPTIONS = ["whatsapp", "instagram", "messenger", "telegram", "sms", "email"];

const LLM_TIERS = ["tier_1", "tier_2", "tier_3", "tier_4"];

export default function PlansPage() {
    const t = useTranslations("plansPage");
    const tf = useTranslations("plansPage.features");
    const tc = useTranslations("plansPage.categories");
    const tHelp = useTranslations("help");

    const [plans, setPlans] = useState<Plan[]>([]);
    const [registry, setRegistry] = useState<FeatureDef[]>([]);
    const [loading, setLoading] = useState(true);
    const [editSlug, setEditSlug] = useState<string | null>(null);
    const [editBuffer, setEditBuffer] = useState<Plan | null>(null);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
    const [providerStatus, setProviderStatus] = useState<MercadoPagoProviderStatus | null>(null);
    const [syncing, setSyncing] = useState<string | null>(null);
    const [reconciling, setReconciling] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [plansRes, regRes, provRes] = await Promise.all([
                api.getAdminPlans(),
                api.getFeatureRegistry(),
                api.getMpProviderStatus(),
            ]);
            if (plansRes.success) setPlans(plansRes.data);
            if (regRes.success) setRegistry(regRes.data);
            if (provRes.success && provRes.data) setProviderStatus(provRes.data.mercadopago);
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (toast) {
            const id = setTimeout(() => setToast(null), 4000);
            return () => clearTimeout(id);
        }
    }, [toast]);

    const startEdit = (plan: Plan) => {
        setEditSlug(plan.slug);
        setEditBuffer(JSON.parse(JSON.stringify(plan)));
    };

    const cancelEdit = () => {
        setEditSlug(null);
        setEditBuffer(null);
    };

    const handleSave = async () => {
        if (!editBuffer || !editSlug) return;
        setSaving(true);
        try {
            const res = await api.updateAdminPlan(editSlug, {
                name: editBuffer.name,
                priceUsdCents: editBuffer.priceUsdCents,
                trialDays: editBuffer.trialDays,
                requiresCardForTrial: editBuffer.requiresCardForTrial,
                maxAgents: editBuffer.maxAgents,
                maxAiMessages: editBuffer.maxAiMessages,
                features: editBuffer.features,
                priceLocalOverrides: editBuffer.priceLocalOverrides,
                isActive: editBuffer.isActive,
            });
            if (res.success) {
                setToast({ type: "success", msg: `${t("saved")} — ${t("cacheInvalidated", { count: String((res as any).invalidatedTenants ?? 0) })}` });
                cancelEdit();
                load();
            } else {
                setToast({ type: "error", msg: res.error || "Error" });
            }
        } catch {
            setToast({ type: "error", msg: "Connection error" });
        }
        setSaving(false);
    };

    const handleSync = async (slug: string, force: boolean, cycle: "month" | "year" = "month") => {
        setSyncing(cycle === "year" ? `${slug}:annual` : slug);
        try {
            const res = await api.syncPlanToMp(slug, { country: "CO", force, cycle });
            if (res.success) {
                setToast({ type: "success", msg: res.data?.skipped ? t("syncMpSkipped") : t("syncMpDone") });
                load();
            } else {
                setToast({ type: "error", msg: res.error || "Error" });
            }
        } catch {
            setToast({ type: "error", msg: "Connection error" });
        }
        setSyncing(null);
    };

    const handleReconcile = async () => {
        setReconciling(true);
        try {
            const res = await api.reconcileBilling("full");
            if (res.success) {
                setToast({ type: "success", msg: t("reconcileDone", { scanned: String(res.data?.scanned ?? 0), drift: String(res.data?.drift ?? 0) }) });
                load();
            } else {
                setToast({ type: "error", msg: res.error || "Error" });
            }
        } catch {
            setToast({ type: "error", msg: "Connection error" });
        }
        setReconciling(false);
    };

    const updateTopLevel = (key: keyof Plan, val: any) => {
        if (!editBuffer) return;
        setEditBuffer({ ...editBuffer, [key]: val });
    };

    const updateFeature = (key: string, val: any) => {
        if (!editBuffer) return;
        setEditBuffer({
            ...editBuffer,
            features: { ...editBuffer.features, [key]: val },
        });
    };

    const getNested = (plan: Plan, objKey: string, path: string): number => {
        return plan.features?.[objKey]?.[path] ?? 0;
    };

    const updateNested = (objKey: string, path: string, val: number) => {
        if (!editBuffer) return;
        const obj = { ...(editBuffer.features[objKey] || {}) };
        obj[path] = val;
        setEditBuffer({
            ...editBuffer,
            features: { ...editBuffer.features, [objKey]: obj },
        });
    };

    const toggleChannel = (ch: string) => {
        if (!editBuffer) return;
        const current: string[] = editBuffer.features.channels || [];
        const next = current.includes(ch) ? current.filter(c => c !== ch) : [...current, ch];
        updateFeature("channels", next);
    };

    const fmtPrice = (cents: number) => `$${(cents / 100).toFixed(0)}`;
    const fmtNum = (v: number) => v === -1 ? t("unlimited") : v.toLocaleString();

    const cellTypeFor = (def: FeatureDef): "number" | "boolean" | "select" | "channels" | "text" => {
        if (def.type === "boolean") return "boolean";
        if (def.type === "array") return "channels";
        if (def.type === "string") return def.key === "llmTier" ? "select" : "text";
        return "number";
    };

    const sectionCls = "rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900";
    const thCls = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400";
    const tdCls = "px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200";
    const inputCls = "w-full h-8 rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30";
    const catCls = "px-3 py-2 bg-neutral-50 dark:bg-neutral-800/50 text-xs font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-400 border-t border-neutral-200 dark:border-neutral-700";

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 size={16} className="animate-spin" /> Loading...
            </div>
        );
    }

    const renderCell = (plan: Plan, key: string, type: "number" | "boolean" | "select" | "channels" | "text") => {
        const isEditing = editSlug === plan.slug && editBuffer;
        const val = isEditing ? editBuffer.features[key] : plan.features[key];

        if (type === "boolean") {
            const checked = !!val;
            if (!isEditing) {
                return (
                    <span className={`inline-block w-2 h-2 rounded-full ${checked ? "bg-green-500" : "bg-neutral-300 dark:bg-neutral-600"}`} />
                );
            }
            return (
                <button type="button" onClick={() => updateFeature(key, !checked)} className="text-neutral-500 hover:text-indigo-500 transition-colors">
                    {checked ? <ToggleRight size={20} className="text-green-500" /> : <ToggleLeft size={20} />}
                </button>
            );
        }

        if (type === "select") {
            if (!isEditing) return <span className="text-xs font-mono">{val || "—"}</span>;
            return (
                <select value={val || ""} onChange={e => updateFeature(key, e.target.value)} className={inputCls}>
                    {LLM_TIERS.map(tier => (
                        <option key={tier} value={tier}>{tier}</option>
                    ))}
                </select>
            );
        }

        if (type === "text") {
            if (!isEditing) return <span className="text-xs">{val || "—"}</span>;
            return (
                <input type="text" className={inputCls} value={val || ""} onChange={e => updateFeature(key, e.target.value)} />
            );
        }

        if (type === "channels") {
            const channels: string[] = val || [];
            if (!isEditing) {
                return (
                    <div className="flex flex-wrap gap-1">
                        {channels.map(ch => (
                            <span key={ch} className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-500/20 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
                                {ch}
                            </span>
                        ))}
                    </div>
                );
            }
            return (
                <div className="flex flex-wrap gap-1">
                    {CHANNEL_OPTIONS.map(ch => (
                        <button
                            key={ch}
                            type="button"
                            onClick={() => toggleChannel(ch)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                                channels.includes(ch)
                                    ? "bg-indigo-600 text-white border-indigo-600"
                                    : "bg-transparent text-neutral-400 border-neutral-300 dark:border-neutral-600 hover:border-indigo-400"
                            }`}
                        >
                            {ch}
                        </button>
                    ))}
                </div>
            );
        }

        // number
        const numVal = typeof val === "number" ? val : 0;
        if (!isEditing) return <span className="font-mono text-xs">{fmtNum(numVal)}</span>;
        return (
            <input
                type="number"
                className={inputCls}
                value={numVal}
                onChange={e => updateFeature(key, parseInt(e.target.value) || 0)}
            />
        );
    };

    const renderNestedCell = (plan: Plan, objKey: string, path: string) => {
        const isEditing = editSlug === plan.slug && editBuffer;
        const val = isEditing ? getNested(editBuffer, objKey, path) : getNested(plan, objKey, path);
        if (!isEditing) return <span className="font-mono text-xs">{fmtNum(val)}</span>;
        return (
            <input type="number" className={inputCls} value={val} onChange={e => updateNested(objKey, path, parseInt(e.target.value) || 0)} />
        );
    };

    const renderTopCell = (plan: Plan, key: "maxAgents" | "maxAiMessages" | "priceUsdCents" | "trialDays", display: string) => {
        const isEditing = editSlug === plan.slug && editBuffer;
        const val = isEditing ? editBuffer[key] : plan[key];
        if (!isEditing) {
            return <span className="font-mono text-xs">{key === "priceUsdCents" ? fmtPrice(val as number) : fmtNum(val as number)}</span>;
        }
        return (
            <input
                type="number"
                className={inputCls}
                value={val as number}
                onChange={e => updateTopLevel(key, parseInt(e.target.value) || 0)}
            />
        );
    };

    return (
        <div className="space-y-5 max-w-full">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                        <Layers size={20} className="text-indigo-600 dark:text-indigo-400" />
                        {t("title")}
                        {providerStatus && (
                            <span
                                title={`${t("providerStatus")}${providerStatus.webhookConfigured ? "" : " · webhook ⚠"}`}
                                className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                    providerStatus.environment === "production"
                                        ? "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300"
                                        : providerStatus.environment === "sandbox"
                                        ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"
                                        : "bg-neutral-100 dark:bg-neutral-800 text-neutral-500"
                                }`}
                            >
                                MP: {t(providerStatus.environment)}
                            </span>
                        )}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
                    {providerStatus?.credentialModeInferred === "app_usr" && providerStatus.collectorValidation === "not_checked" && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                            {t("mpCollectorPreflightPending")}
                        </p>
                    )}
                </div>
                <button
                    onClick={handleReconcile}
                    disabled={reconciling}
                    title={t("reconcileHint")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:border-indigo-400 transition-colors disabled:opacity-50"
                >
                    {reconciling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {t("reconcile")}
                </button>
            </div>

            <HelpPanel
                title={tHelp("plans.title")}
                description={tHelp("plans.description")}
                tips={tHelp.raw("plans.tips") as string[]}
                mediaKey="plans"
            />

            {toast && (
                <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
                    toast.type === "success"
                        ? "border border-green-200 bg-green-50 text-green-600 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400"
                        : "border border-red-200 bg-red-50 text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
                }`}>
                    {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {toast.msg}
                </div>
            )}

            <div className={`${sectionCls} overflow-x-auto`}>
                <table className="w-full min-w-[800px]">
                    <thead>
                        <tr className="border-b border-neutral-200 dark:border-neutral-700">
                            <th className={`${thCls} w-[200px]`}>Feature</th>
                            {plans.map(p => (
                                <th key={p.slug} className={thCls}>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-sm normal-case font-bold text-neutral-900 dark:text-neutral-100">{p.name}</span>
                                            <span className={`ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                p.isActive
                                                    ? "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300"
                                                    : "bg-neutral-100 dark:bg-neutral-800 text-neutral-500"
                                            }`}>
                                                {p.isActive ? t("active") : t("inactive")}
                                            </span>
                                            {!!p.unknownFeatureKeys?.length && (
                                                <span
                                                    title={p.unknownFeatureKeys.join(", ")}
                                                    className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"
                                                >
                                                    <AlertCircle size={10} /> {p.unknownFeatureKeys.length}
                                                </span>
                                            )}
                                            <div className="flex items-center gap-1 mt-0.5 text-[10px] text-neutral-400 font-normal normal-case">
                                                <Users size={10} /> {p.tenantCount} {t("tenants")}
                                            </div>
                                        </div>
                                        {editSlug === p.slug ? (
                                            <div className="flex gap-1">
                                                <button onClick={handleSave} disabled={saving} className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-500/20 text-green-600 transition-colors disabled:opacity-50">
                                                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                </button>
                                                <button onClick={cancelEdit} className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 transition-colors">
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button onClick={() => startEdit(p)} className="p-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-500 transition-colors">
                                                <Pencil size={14} />
                                            </button>
                                        )}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {/* Plan Info */}
                        <tr><td colSpan={plans.length + 1} className={catCls}>{tc("planInfo")}</td></tr>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className={`${tdCls} font-medium`}>{t("planName")}</td>
                            {plans.map(p => {
                                const isEditing = editSlug === p.slug && editBuffer;
                                return (
                                    <td key={p.slug} className={tdCls}>
                                        {isEditing ? (
                                            <input type="text" className={inputCls} value={editBuffer.name} onChange={e => updateTopLevel("name", e.target.value)} />
                                        ) : (
                                            <span className="text-sm font-medium">{p.name}</span>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className={`${tdCls} font-medium`}>{t("priceRef")}</td>
                            {plans.map(p => <td key={p.slug} className={tdCls}>{renderTopCell(p, "priceUsdCents", "")}</td>)}
                        </tr>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className={`${tdCls} font-medium`}>{t("priceCOP")}</td>
                            {plans.map(p => {
                                const isEditing = editSlug === p.slug && editBuffer;
                                const overrides = isEditing ? editBuffer.priceLocalOverrides : p.priceLocalOverrides;
                                const copCents = overrides?.CO?.amountCents ?? 0;
                                if (!isEditing) {
                                    return <td key={p.slug} className={tdCls}><span className="font-mono text-xs">{copCents ? `$${(copCents / 100).toLocaleString("es-CO")}` : "—"}</span></td>;
                                }
                                return (
                                    <td key={p.slug} className={tdCls}>
                                        <input
                                            type="number"
                                            className={inputCls}
                                            value={copCents}
                                            onChange={e => {
                                                const val = parseInt(e.target.value) || 0;
                                                setEditBuffer({
                                                    ...editBuffer,
                                                    priceLocalOverrides: {
                                                        ...editBuffer.priceLocalOverrides,
                                                        CO: { ...(editBuffer.priceLocalOverrides?.CO ?? { currency: "COP" }), amountCents: val },
                                                    },
                                                });
                                            }}
                                        />
                                        <span className="text-[10px] text-neutral-400 mt-0.5 block">{t("copHint")}</span>
                                    </td>
                                );
                            })}
                        </tr>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className={`${tdCls} font-medium`}>{t("priceCOPAnnual")}</td>
                            {plans.map(p => {
                                const isEditing = editSlug === p.slug && editBuffer;
                                const overrides = isEditing ? editBuffer.priceLocalOverrides : p.priceLocalOverrides;
                                const annualCents = overrides?.CO?.annual?.amountCents ?? 0;
                                if (p.slug === "custom") {
                                    return <td key={p.slug} className={tdCls}><span className="text-xs text-neutral-400">—</span></td>;
                                }
                                if (!isEditing) {
                                    return <td key={p.slug} className={tdCls}><span className="font-mono text-xs">{annualCents ? `$${(annualCents / 100).toLocaleString("es-CO")}` : "—"}</span></td>;
                                }
                                return (
                                    <td key={p.slug} className={tdCls}>
                                        <input
                                            type="number"
                                            className={inputCls}
                                            value={annualCents}
                                            onChange={e => {
                                                const val = parseInt(e.target.value) || 0;
                                                const co = editBuffer.priceLocalOverrides?.CO ?? { currency: "COP", amountCents: 0 };
                                                setEditBuffer({
                                                    ...editBuffer,
                                                    priceLocalOverrides: {
                                                        ...editBuffer.priceLocalOverrides,
                                                        CO: { ...co, annual: { ...(co.annual ?? {}), amountCents: val } },
                                                    },
                                                });
                                            }}
                                        />
                                        <span className="text-[10px] text-neutral-400 mt-0.5 block">{t("copAnnualHint")}</span>
                                    </td>
                                );
                            })}
                        </tr>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className={`${tdCls} font-medium`}>{t("mpPlanId")}</td>
                            {plans.map(p => {
                                const mpId = p.priceLocalOverrides?.CO?.mpPlanId;
                                if (p.slug === "custom") {
                                    return <td key={p.slug} className={tdCls}><span className="text-xs text-neutral-400">—</span></td>;
                                }
                                return (
                                    <td key={p.slug} className={tdCls}>
                                        {mpId ? (
                                            <span className="inline-flex items-center gap-1.5" title={mpId}>
                                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                                                <span className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">{String(mpId).slice(0, 14)}…</span>
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                                                <AlertCircle size={11} /> {t("notSynced")}
                                            </span>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className={`${tdCls} font-medium`}>{t("mpPlanIdAnnual")}</td>
                            {plans.map(p => {
                                const mpId = p.priceLocalOverrides?.CO?.annual?.mpPlanId;
                                if (p.slug === "custom") {
                                    return <td key={p.slug} className={tdCls}><span className="text-xs text-neutral-400">—</span></td>;
                                }
                                return (
                                    <td key={p.slug} className={tdCls}>
                                        {mpId ? (
                                            <span className="inline-flex items-center gap-1.5" title={mpId}>
                                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                                                <span className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">{String(mpId).slice(0, 14)}…</span>
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                                                <AlertCircle size={11} /> {t("notSynced")}
                                            </span>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className={`${tdCls} font-medium`}>{t("trialDays")}</td>
                            {plans.map(p => <td key={p.slug} className={tdCls}>{renderTopCell(p, "trialDays", "")}</td>)}
                        </tr>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className={`${tdCls} font-medium`}>{t("requiresCard")}</td>
                            {plans.map(p => {
                                const isEditing = editSlug === p.slug && editBuffer;
                                const val = isEditing ? editBuffer.requiresCardForTrial : p.requiresCardForTrial;
                                return (
                                    <td key={p.slug} className={tdCls}>
                                        {isEditing ? (
                                            <button type="button" onClick={() => updateTopLevel("requiresCardForTrial", !val)} className="text-neutral-500 hover:text-indigo-500 transition-colors">
                                                {val ? <ToggleRight size={20} className="text-green-500" /> : <ToggleLeft size={20} />}
                                            </button>
                                        ) : (
                                            <span className={`inline-block w-2 h-2 rounded-full ${val ? "bg-green-500" : "bg-neutral-300 dark:bg-neutral-600"}`} />
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className={`${tdCls} font-medium`}>{t("active")}</td>
                            {plans.map(p => {
                                const isEditing = editSlug === p.slug && editBuffer;
                                const val = isEditing ? editBuffer.isActive : p.isActive;
                                return (
                                    <td key={p.slug} className={tdCls}>
                                        {isEditing ? (
                                            <button type="button" onClick={() => updateTopLevel("isActive", !val)} className="text-neutral-500 hover:text-indigo-500 transition-colors">
                                                {val ? <ToggleRight size={20} className="text-green-500" /> : <ToggleLeft size={20} />}
                                            </button>
                                        ) : (
                                            <span className={`inline-block w-2 h-2 rounded-full ${val ? "bg-green-500" : "bg-neutral-300 dark:bg-neutral-600"}`} />
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className={`${tdCls} font-medium`}>{t("maxAgents")}</td>
                            {plans.map(p => <td key={p.slug} className={tdCls}>{renderTopCell(p, "maxAgents", "")}</td>)}
                        </tr>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <td className={`${tdCls} font-medium`}>{t("maxAiMessages")}</td>
                            {plans.map(p => <td key={p.slug} className={tdCls}>{renderTopCell(p, "maxAiMessages", "")}</td>)}
                        </tr>

                        {/* Feature categories (registry-driven) */}
                        {CATEGORY_ORDER.map(cat => {
                            // A category is EITHER a single nested object (rate/media) OR a set of
                            // flat features that may also include extra nested-object features
                            // (e.g. `channel` = channels chips + maxChannelAccounts sub-rows).
                            const pureNestedKey = CATEGORY_TO_NESTED[cat];
                            const featureDefs = pureNestedKey
                                ? []
                                : registry.filter(d => d.category === cat && d.type !== "object" && !CATEGORY_TO_NESTED[d.category]);
                            const nestedKeys: string[] = pureNestedKey
                                ? [pureNestedKey]
                                : registry.filter(d => d.category === cat && d.type === "object" && NESTED_INNER[d.key]).map(d => d.key);
                            if (!featureDefs.length && !nestedKeys.length) return null;
                            return (
                                <Fragment key={cat}>
                                    <tr><td colSpan={plans.length + 1} className={catCls}>{tc(CATEGORY_I18N[cat])}</td></tr>
                                    {featureDefs.map(def => (
                                        <tr key={def.key} className="border-b border-neutral-100 dark:border-neutral-800">
                                            <td className={`${tdCls} font-medium`}>{tf(def.key)}</td>
                                            {plans.map(p => <td key={p.slug} className={tdCls}>{renderCell(p, def.key, cellTypeFor(def))}</td>)}
                                        </tr>
                                    ))}
                                    {nestedKeys.flatMap(nestedKey => (NESTED_INNER[nestedKey] || []).map(({ key, label }) => (
                                        <tr key={`${nestedKey}.${key}`} className="border-b border-neutral-100 dark:border-neutral-800">
                                            <td className={`${tdCls} font-medium`}>{tf(label)}</td>
                                            {plans.map(p => <td key={p.slug} className={tdCls}>{renderNestedCell(p, nestedKey, key)}</td>)}
                                        </tr>
                                    )))}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Sync plans to MercadoPago */}
            <div className={`${sectionCls} p-4`}>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">{t("syncMpTitle")}</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">{t("syncMpDesc")}</p>
                <div className="flex flex-wrap gap-2">
                    {plans.filter(p => p.slug !== "custom").map(p => {
                        const syncedM = !!p.priceLocalOverrides?.CO?.mpPlanId;
                        const syncedA = !!p.priceLocalOverrides?.CO?.annual?.mpPlanId;
                        const hasAnnualPrice = !!p.priceLocalOverrides?.CO?.annual?.amountCents;
                        const busyM = syncing === p.slug;
                        const busyA = syncing === `${p.slug}:annual`;
                        const btnCls = "inline-flex items-center gap-1 px-2 py-1 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-[11px] font-medium text-neutral-700 dark:text-neutral-300 hover:border-indigo-400 transition-colors disabled:opacity-50";
                        return (
                            <div key={p.slug} className="inline-flex flex-col gap-1 rounded-lg border border-neutral-200 dark:border-neutral-700 p-1.5">
                                <span className="px-1 text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">{p.name}</span>
                                <div className="flex gap-1">
                                    <button
                                        disabled={busyM}
                                        onClick={() => {
                                            if (syncedM && !window.confirm(t("syncMpConfirm"))) return;
                                            handleSync(p.slug, syncedM, "month");
                                        }}
                                        className={btnCls}
                                    >
                                        {busyM ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                                        {t("cycleMonthly")}
                                        {syncedM && <span className="text-[9px] text-amber-600 dark:text-amber-400">· {t("resync")}</span>}
                                    </button>
                                    <button
                                        disabled={busyA || !hasAnnualPrice}
                                        title={!hasAnnualPrice ? t("annualPriceMissing") : undefined}
                                        onClick={() => {
                                            if (syncedA && !window.confirm(t("syncMpConfirm"))) return;
                                            handleSync(p.slug, syncedA, "year");
                                        }}
                                        className={btnCls}
                                    >
                                        {busyA ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                                        {t("cycleAnnual")}
                                        {syncedA && <span className="text-[9px] text-amber-600 dark:text-amber-400">· {t("resync")}</span>}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Cache invalidation buttons */}
            <div className={`${sectionCls} p-4`}>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3">{t("invalidateCache")}</h3>
                <div className="flex flex-wrap gap-2">
                    {plans.map(p => (
                        <button
                            key={p.slug}
                            onClick={async () => {
                                const res = await api.invalidatePlanCache(p.slug);
                                if (res.success) {
                                    setToast({ type: "success", msg: t("cacheInvalidated", { count: String((res as any).invalidatedCount ?? 0) }) });
                                }
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:border-indigo-400 transition-colors"
                        >
                            <RefreshCw size={12} /> {p.name}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
