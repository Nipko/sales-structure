"use client";

/**
 * Action bar shown on the tenant detail page for super_admin only.
 * Surfaces backend operations that previously had no UI:
 *   - Extend trial (input N days)
 *   - Suspend / Reactivate (status-aware single button)
 *   - Reactivate channels (when channels were turned off but provider not unsubscribed)
 *   - Purge tenant (irreversible — requires typing the slug to confirm)
 *
 * Destructive actions use double confirmation patterns: a modal + a typed
 * match against the tenant slug for purge. This is consistent with how
 * Stripe/Supabase/Vercel handle "delete account" flows.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Clock, AlertTriangle, RefreshCw, Power, Trash2, X, Loader2, CheckCircle, XCircle, Gift,
} from "lucide-react";

interface TenantSummary {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    subscriptionStatus?: string;
}

interface Props {
    tenant: TenantSummary;
    onChange?: () => void;  // refetch after successful action
}

type ActionResult = { type: "success" | "error" | "warning"; text: string } | null;

export default function TenantAdminActions({ tenant, onChange }: Props) {
    const t = useTranslations("tenantAdminActions");
    const tc = useTranslations("common");

    const [showExtendTrial, setShowExtendTrial] = useState(false);
    const [showPurge, setShowPurge] = useState(false);
    const [showCompPlan, setShowCompPlan] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<ActionResult>(null);

    const isSuspended = tenant.subscriptionStatus === "expired"
        || tenant.subscriptionStatus === "cancelled"
        || tenant.isActive === false;

    async function handleSuspendOrReactivate() {
        setBusy("status");
        setFeedback(null);
        try {
            if (isSuspended) {
                const res = await api.reactivateTenant(tenant.id);
                if (res.success) {
                    setFeedback({ type: "success", text: t("reactivated") });
                    onChange?.();
                } else {
                    setFeedback({ type: "error", text: res.error || tc("connectionError") });
                }
            } else {
                if (!confirm(t("suspendConfirm"))) {
                    setBusy(null);
                    return;
                }
                const reason = prompt(t("suspendReasonPrompt")) || "manual";
                const res = await api.suspendTenant(tenant.id, reason);
                if (res.success) {
                    setFeedback({ type: "warning", text: t("suspended") });
                    onChange?.();
                } else {
                    setFeedback({ type: "error", text: res.error || tc("connectionError") });
                }
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setBusy(null);
        }
    }

    async function handleReactivateChannels() {
        setBusy("channels");
        setFeedback(null);
        try {
            const res = await api.reactivateChannels(tenant.id);
            if (res.success) {
                const restored = res.data?.restored ?? 0;
                const needsReconnect = res.data?.needsReconnect ?? 0;
                setFeedback({
                    type: needsReconnect > 0 ? "warning" : "success",
                    text: t("channelsResult", { restored, needsReconnect }),
                });
                onChange?.();
            } else {
                setFeedback({ type: "error", text: res.error || tc("connectionError") });
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setBusy(null);
        }
    }

    return (
        <>
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        {t("title")}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("subtitle")}</p>
                </div>

                {feedback && (
                    <div className={cn(
                        "p-3 rounded-lg text-sm border flex items-start gap-2",
                        feedback.type === "error" && "bg-red-500/10 text-red-600 border-red-500/20",
                        feedback.type === "warning" && "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
                        feedback.type === "success" && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                    )}>
                        {feedback.type === "error" || feedback.type === "warning"
                            ? <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            : <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        }
                        <span>{feedback.text}</span>
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Extend trial — visible only when trialing */}
                    {tenant.subscriptionStatus === "trialing" && (
                        <button
                            onClick={() => setShowExtendTrial(true)}
                            className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium transition"
                        >
                            <Clock className="h-4 w-4" /> {t("extendTrial")}
                        </button>
                    )}

                    {/* Suspend / Reactivate */}
                    <button
                        onClick={handleSuspendOrReactivate}
                        disabled={busy === "status"}
                        className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50",
                            isSuspended
                                ? "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                                : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300",
                        )}
                    >
                        {busy === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                        {isSuspended ? t("reactivate") : t("suspend")}
                    </button>

                    {/* Reactivate channels */}
                    <button
                        onClick={handleReactivateChannels}
                        disabled={busy === "channels"}
                        className="flex items-center gap-2 px-3 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 rounded-lg text-sm font-medium transition disabled:opacity-50"
                    >
                        {busy === "channels" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {t("reactivateChannels")}
                    </button>

                    {/* Comp plan — gift a tenant a free plan for N days */}
                    <button
                        onClick={() => setShowCompPlan(true)}
                        className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-700 dark:text-purple-300 rounded-lg text-sm font-medium transition"
                    >
                        <Gift className="h-4 w-4" /> {t("compPlan")}
                    </button>

                    {/* Purge — destructive */}
                    <button
                        onClick={() => setShowPurge(true)}
                        className="flex items-center gap-2 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-300 rounded-lg text-sm font-medium transition"
                    >
                        <Trash2 className="h-4 w-4" /> {t("purge")}
                    </button>
                </div>

                <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                    {t("hint")}
                </p>
            </div>

            {showExtendTrial && (
                <ExtendTrialModal
                    tenant={tenant}
                    onClose={() => setShowExtendTrial(false)}
                    onSuccess={() => {
                        setShowExtendTrial(false);
                        setFeedback({ type: "success", text: t("trialExtended") });
                        onChange?.();
                    }}
                />
            )}

            {showPurge && (
                <PurgeTenantModal
                    tenant={tenant}
                    onClose={() => setShowPurge(false)}
                    onSuccess={(summary) => {
                        setShowPurge(false);
                        setFeedback({
                            type: "success",
                            text: t("purgeSuccess", {
                                channels: summary.channelsDisconnected ?? 0,
                                files: summary.mediaFilesRemoved ?? 0,
                            }),
                        });
                        onChange?.();
                    }}
                />
            )}

            {showCompPlan && (
                <CompPlanModal
                    tenant={tenant}
                    onClose={() => setShowCompPlan(false)}
                    onSuccess={() => {
                        setShowCompPlan(false);
                        setFeedback({ type: "success", text: t("compPlanGranted") });
                        onChange?.();
                    }}
                />
            )}
        </>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Extend Trial Modal
// ──────────────────────────────────────────────────────────────────────

function ExtendTrialModal({
    tenant, onClose, onSuccess,
}: { tenant: TenantSummary; onClose: () => void; onSuccess: () => void }) {
    const t = useTranslations("tenantAdminActions");
    const tc = useTranslations("common");
    const [days, setDays] = useState(7);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit() {
        if (days < 1 || days > 365) {
            setError(t("trialDaysInvalid"));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await api.extendTrial(tenant.id, days);
            if (res.success) {
                onSuccess();
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
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <div>
                        <h3 className="text-base font-semibold">{t("extendTrialTitle")}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{tenant.name}</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"><X className="h-4 w-4" /></button>
                </div>
                <div className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("trialDays")}</label>
                        <input
                            type="number"
                            min={1}
                            max={365}
                            value={days}
                            onChange={e => setDays(parseInt(e.target.value || "0", 10))}
                            className="w-full bg-card border border-border rounded-lg px-3 py-2"
                        />
                        <p className="text-xs text-muted-foreground mt-1">{t("trialDaysHelp")}</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("reason")}</label>
                        <input
                            type="text"
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder={t("reasonPlaceholder")}
                            className="w-full bg-card border border-border rounded-lg px-3 py-2"
                        />
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} className="px-3 py-1.5 hover:bg-muted rounded-lg text-sm text-foreground border border-border">{tc("cancel")}</button>
                    <button onClick={handleSubmit} disabled={busy} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2">
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {t("extendTrialConfirm", { days })}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Purge Tenant Modal — destructive, requires typing the slug
// ──────────────────────────────────────────────────────────────────────

function PurgeTenantModal({
    tenant, onClose, onSuccess,
}: { tenant: TenantSummary; onClose: () => void; onSuccess: (summary: any) => void }) {
    const t = useTranslations("tenantAdminActions");
    const tc = useTranslations("common");
    const [confirmText, setConfirmText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const matches = confirmText.trim() === tenant.slug;

    async function handlePurge() {
        if (!matches) return;
        setBusy(true);
        setError(null);
        try {
            const res = await api.purgeTenant(tenant.id);
            if (res.success) {
                onSuccess(res.data || {});
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border-2 border-red-500/30 rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border bg-red-500/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                            <AlertTriangle className="h-5 w-5 text-red-600" />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-red-700 dark:text-red-300">{t("purgeTitle")}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">{tenant.name}</p>
                        </div>
                    </div>
                    <button onClick={onClose} disabled={busy} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"><X className="h-4 w-4" /></button>
                </div>

                <div className="p-5 space-y-4">
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-2 text-sm">
                        <p className="font-semibold text-red-700 dark:text-red-300">{t("purgeWarning")}</p>
                        <ul className="list-disc list-inside space-y-1 text-red-700/90 dark:text-red-300/90 text-xs">
                            <li>{t("purgeBullet1")}</li>
                            <li>{t("purgeBullet2")}</li>
                            <li>{t("purgeBullet3")}</li>
                            <li>{t("purgeBullet4")}</li>
                            <li>{t("purgeBullet5")}</li>
                        </ul>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">
                            {t("purgeTypePrompt", { slug: tenant.slug })}
                        </label>
                        <input
                            type="text"
                            autoFocus
                            value={confirmText}
                            onChange={e => setConfirmText(e.target.value)}
                            placeholder={tenant.slug}
                            className="w-full bg-card border-2 border-border rounded-lg px-3 py-2 font-mono"
                            disabled={busy}
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-red-600 bg-red-500/10 p-2 rounded">{error}</p>
                    )}
                </div>

                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} disabled={busy} className="px-3 py-1.5 hover:bg-muted rounded-lg text-sm text-foreground border border-border disabled:opacity-50">{tc("cancel")}</button>
                    <button
                        onClick={handlePurge}
                        disabled={!matches || busy}
                        className="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-red-600/30 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2"
                    >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {t("purgeConfirm")}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Comp Plan Modal — gift a tenant a free plan for N days
// ──────────────────────────────────────────────────────────────────────

function CompPlanModal({
    tenant, onClose, onSuccess,
}: { tenant: TenantSummary; onClose: () => void; onSuccess: () => void }) {
    const t = useTranslations("tenantAdminActions");
    const tc = useTranslations("common");
    const [planSlug, setPlanSlug] = useState<"emprendedor" | "starter" | "pro" | "enterprise" | "custom">("pro");
    const [days, setDays] = useState(30);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit() {
        if (days < 1 || days > 3650) {
            setError(t("compPlanDaysInvalid"));
            return;
        }
        if (!reason.trim() || reason.trim().length < 3) {
            setError(t("compPlanReasonRequired"));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await api.grantCompPlan(tenant.id, { planSlug, durationDays: days, reason: reason.trim() });
            if (res.success) onSuccess();
            else setError((res as any).error || tc("connectionError"));
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <div>
                        <h3 className="text-base font-semibold flex items-center gap-2">
                            <Gift className="h-4 w-4 text-purple-500" />
                            {t("compPlanTitle")}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{tenant.name}</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"><X className="h-4 w-4" /></button>
                </div>
                <div className="p-5 space-y-4">
                    <p className="text-xs text-muted-foreground">{t("compPlanHint")}</p>
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("compPlanLabel")}</label>
                        <select
                            value={planSlug}
                            onChange={e => setPlanSlug(e.target.value as any)}
                            className="w-full bg-card border border-border rounded-lg px-3 py-2"
                        >
                            <option value="emprendedor">Emprendedor</option>
                            <option value="starter">Starter</option>
                            <option value="pro">Pro</option>
                            <option value="enterprise">Enterprise</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("compPlanDays")}</label>
                        <input
                            type="number"
                            min={1}
                            max={3650}
                            value={days}
                            onChange={e => setDays(parseInt(e.target.value || "0", 10))}
                            className="w-full bg-card border border-border rounded-lg px-3 py-2"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("compPlanReason")} <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder={t("compPlanReasonPlaceholder")}
                            className="w-full bg-card border border-border rounded-lg px-3 py-2"
                        />
                    </div>
                    {error && <p className="text-sm text-red-600 bg-red-500/10 p-2 rounded">{error}</p>}
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} disabled={busy} className="px-3 py-1.5 hover:bg-muted rounded-lg text-sm text-foreground border border-border disabled:opacity-50">{tc("cancel")}</button>
                    <button
                        onClick={handleSubmit}
                        disabled={busy}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2"
                    >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {t("compPlanConfirm", { days })}
                    </button>
                </div>
            </div>
        </div>
    );
}
