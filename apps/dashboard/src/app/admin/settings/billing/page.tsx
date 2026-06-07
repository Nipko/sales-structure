"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    CreditCard, CheckCircle2, AlertTriangle, XCircle, Clock,
    Zap, Rocket, Briefcase, Sparkles, Loader2, X, Tag, Lightbulb,
    Mic, Eye, ArrowUpRight, BookOpen, FileText,
} from "lucide-react";
import MpCardForm from "@/components/billing/MpCardForm";
import { HelpPanel } from "@/components/ui/help-panel";

type SubscriptionStatus = "pending_auth" | "trialing" | "active" | "past_due" | "cancelled" | "expired";

interface Plan {
    id: string;
    slug: string;
    name: string;
    priceUsdCents: number;
    trialDays: number;
    requiresCardForTrial: boolean;
    maxAgents: number;
    maxAiMessages: number;
    features: Record<string, any>;
    priceLocalOverrides: Record<string, { currency: string; amountCents: number; mpPlanId?: string }>;
    /** Display values returned by backend when ?country=XX is sent */
    displayPriceCents?: number;
    displayCurrency?: string;
    priceSource?: "override" | "fx" | "usd";
}

interface Payment {
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    paidAt?: string;
    createdAt: string;
    invoicePdfUrl?: string | null;
}

interface Subscription {
    id: string;
    status: SubscriptionStatus;
    planId: string;
    plan?: Plan;
    provider: string;
    trialStartedAt?: string | null;
    trialEndsAt?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd: boolean;
    cancelledAt?: string | null;
    cancellationReason?: string | null;
    pendingPlanId?: string | null;
    pendingPlanChangeAt?: string | null;
    pendingPlan?: { id: string; slug: string; name: string; priceUsdCents: number } | null;
    payments: Payment[];
}

const STATUS_META: Record<SubscriptionStatus, { label: string; className: string; Icon: any }> = {
    pending_auth: { label: "pendingAuth", className: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300", Icon: Clock },
    trialing: { label: "trialing", className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300", Icon: Sparkles },
    active: { label: "active", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", Icon: CheckCircle2 },
    past_due: { label: "pastDue", className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", Icon: AlertTriangle },
    cancelled: { label: "cancelled", className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", Icon: XCircle },
    expired: { label: "expired", className: "bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-200", Icon: XCircle },
};

function daysUntil(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86_400_000));
}

function formatMoney(amountCents: number, currency: string, locale: string): string {
    try {
        return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 0 }).format(amountCents / 100);
    } catch {
        return `${currency} ${(amountCents / 100).toFixed(2)}`;
    }
}

function formatDate(iso: string | null | undefined, locale: string): string {
    if (!iso) return "—";
    try {
        return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
    } catch {
        return iso.slice(0, 10);
    }
}

const PLAN_ICON: Record<string, any> = {
    emprendedor: Lightbulb,
    starter: Zap,
    pro: Rocket,
    enterprise: Briefcase,
    custom: Sparkles,
};

function MpSecurityScript() {
    const loaded = useRef(false);
    useEffect(() => {
        if (loaded.current) return;
        loaded.current = true;
        const s = document.createElement("script");
        s.src = "https://www.mercadopago.com/v2/security.js";
        s.setAttribute("view", "checkout");
        s.async = true;
        document.head.appendChild(s);
    }, []);
    return null;
}

export default function BillingPage() {
    const t = useTranslations("billingPage");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();
    const { user } = useAuth();
    const isSuperAdmin = user?.role === "super_admin";
    const locale = typeof navigator !== "undefined" ? navigator.language : "es-CO";

    const [loading, setLoading] = useState(true);
    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [usage, setUsage] = useState<{
        used: number;
        limit: number | null;
        remaining: number | null;
        percent: number;
        monthKey: string;
        plan: string;
        conversations?: number;
        activeAgents?: number;
        maxAgents?: number | null;
        media?: {
            audio: { used: number; limit: number | null; percent: number };
            image: { used: number; limit: number | null; percent: number };
            dailyCostCents: number;
            dailyBudgetCents: number | null;
        } | null;
    } | null>(null);
    const [kbUsage, setKbUsage] = useState<{
        embeddings: { used: number; limit: number | null; percent: number };
        documents: { used: number; limit: number | null; percent: number };
        maxCharsPerDoc: number | null;
        monthlyCostCentsUsd: number;
        monthKey: string;
    } | null>(null);
    const [action, setAction] = useState<null | "upgrade" | "cancel" | "reactivate" | "pause" | "resume" | "retry">(null);
    const [targetPlan, setTargetPlan] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    // Modal state — "upgrade" when user is about to subscribe/change to a paid plan
    // that needs a card; "change-card" when rotating the card on an existing sub.
    const [modal, setModal] = useState<null | { kind: "upgrade"; planSlug: string } | { kind: "change-card" }>(null);
    const [modalSubmitting, setModalSubmitting] = useState(false);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        setError(null);
        try {
            // First fetch the subscription to learn the tenant's billing country,
            // then re-fetch plans with that country so prices come back localized.
            const subRes = await api.getBillingSubscription(activeTenantId);
            if (subRes?.success) setSubscription((subRes.data as any) ?? null);
            const country = (subRes as any)?.billingCountry as string | null;
            const [plansRes, usageRes, kbRes] = await Promise.all([
                api.getBillingPlans(country || undefined),
                api.getBillingUsage(activeTenantId),
                api.fetch(`/knowledge/usage/${activeTenantId}`).catch(() => null),
            ]);
            if (plansRes?.success) setPlans((plansRes.data as Plan[]) ?? []);
            if (usageRes?.success) {
                const d = usageRes.data as any;
                setUsage(d?.aiMessages ? {
                    ...d.aiMessages,
                    conversations: d.conversations,
                    activeAgents: d.activeAgents,
                    maxAgents: d.maxAgents,
                    media: d.media ?? null,
                } : null);
            }
            if (kbRes?.success) setKbUsage(kbRes.data);
        } catch (err: any) {
            setError(err?.message || t("loadError"));
        } finally {
            setLoading(false);
        }
    }, [activeTenantId, t]);

    useEffect(() => { load(); }, [load]);

    const currentPlan = useMemo(
        () => plans.find((p) => p.id === subscription?.planId),
        [plans, subscription?.planId],
    );

    const handleUpgrade = async (planSlug: string, cardTokenId?: string) => {
        if (!activeTenantId) return;
        setAction("upgrade");
        setTargetPlan(planSlug);
        try {
            const plan = plans.find((p) => p.slug === planSlug);
            // MP no soporta cambios de plan en suscripciones activas sin recrearlas con un nuevo token.
            const needsCard = !subscription ? plan?.requiresCardForTrial : true;
            if (needsCard && !cardTokenId) {
                // Open the card modal; the modal's submit will call back into
                // handleUpgrade with the token.
                setModal({ kind: "upgrade", planSlug });
                setAction(null);
                setTargetPlan(null);
                return;
            }

            if (!subscription) {
                const res = await api.startBillingTrial(activeTenantId, { planSlug, cardTokenId });
                if (!res?.success) throw new Error((res as any)?.error || t("actionFailed"));
                setToast(t("trialStarted"));
            } else {
                const res = await api.upgradeBillingPlan(activeTenantId, { planSlug, cardTokenId });
                if (!res?.success) throw new Error((res as any)?.error || t("actionFailed"));
                setToast(t("planChanged"));
            }
            setModal(null);
            await load();
        } catch (err: any) {
            setError(err?.message || t("actionFailed"));
        } finally {
            setAction(null);
            setTargetPlan(null);
        }
    };

    const handleChangeCard = async (cardTokenId: string) => {
        if (!activeTenantId) return;
        setModalSubmitting(true);
        try {
            const res = await api.updateBillingPaymentMethod(activeTenantId, { cardTokenId });
            if (!res?.success) throw new Error((res as any)?.error || t("actionFailed"));
            setToast(t("cardUpdated"));
            setModal(null);
            await load();
        } catch (err: any) {
            setError(err?.message || t("actionFailed"));
        } finally {
            setModalSubmitting(false);
        }
    };

    const [couponCode, setCouponCode] = useState("");
    const [redeemingCoupon, setRedeemingCoupon] = useState(false);

    const handleRedeemCoupon = async () => {
        if (!activeTenantId || !couponCode.trim()) return;
        setRedeemingCoupon(true);
        try {
            const res = await api.redeemCoupon(activeTenantId, couponCode.trim());
            if (!res?.success) {
                const errKey = (res as any)?.error;
                throw new Error(errKey ? t(`couponErrors.${errKey}`) : t("actionFailed"));
            }
            setToast(t("couponRedeemed"));
            setCouponCode("");
            await load();
        } catch (err: any) {
            setError(err?.message || t("actionFailed"));
        } finally {
            setRedeemingCoupon(false);
        }
    };

    const handleRefund = async (paymentId: string, fullAmountCents: number, currency: string) => {
        const partial = window.prompt(
            t("refundAmountPrompt", {
                full: formatMoney(fullAmountCents, currency, locale),
            }) || "Partial amount in cents (leave empty for full):",
        );
        if (partial === null) return;
        let amountCents: number | undefined;
        if (partial.trim() !== "") {
            const parsed = parseInt(partial.trim(), 10);
            if (Number.isNaN(parsed) || parsed <= 0 || parsed > fullAmountCents) {
                alert(t("refundInvalidAmount"));
                return;
            }
            amountCents = parsed;
        }
        const reason = window.prompt(t("refundReasonPrompt") || "Reason (required for audit):");
        if (reason === null || !reason.trim()) return;

        try {
            const res = await api.refundBillingPayment(paymentId, { amountCents, reason });
            if (!res?.success) throw new Error((res as any)?.error || t("actionFailed"));
            setToast(t("refundIssued"));
            await load();
        } catch (err: any) {
            setError(err?.message || t("actionFailed"));
        }
    };

    const handleCancelDowngrade = async () => {
        if (!activeTenantId) return;
        try {
            const res = await api.cancelPendingDowngrade(activeTenantId);
            if (!res?.success) throw new Error((res as any)?.error || t("actionFailed"));
            setToast(t("downgradeCancelled"));
            await load();
        } catch (err: any) {
            setError(err?.message || t("actionFailed"));
        }
    };

    const handlePause = async () => {
        if (!activeTenantId) return;
        const reason = window.prompt(t("pauseReasonPrompt") || "Reason (optional):");
        if (reason === null) return;  // user cancelled
        setAction("pause");
        try {
            const res = await api.pauseBillingSubscription(activeTenantId, { reason: reason || undefined });
            if (!res?.success) throw new Error((res as any)?.error || t("actionFailed"));
            setToast(t("paused"));
            await load();
        } catch (err: any) {
            setError(err?.message || t("actionFailed"));
        } finally {
            setAction(null);
        }
    };

    const handleResume = async () => {
        if (!activeTenantId) return;
        setAction("resume");
        try {
            const res = await api.resumeBillingSubscription(activeTenantId);
            if (!res?.success) throw new Error((res as any)?.error || t("actionFailed"));
            setToast(t("resumed"));
            await load();
        } catch (err: any) {
            setError(err?.message || t("actionFailed"));
        } finally {
            setAction(null);
        }
    };

    const handleRetry = async () => {
        if (!activeTenantId) return;
        setAction("retry");
        try {
            const res = await api.syncBillingSubscription(activeTenantId);
            if (!res?.success) throw new Error((res as any)?.error || t("actionFailed"));
            const data: any = (res as any).data;
            setToast(data?.updated ? t("retrySucceeded") : t("retryNoChange"));
            await load();
        } catch (err: any) {
            setError(err?.message || t("actionFailed"));
        } finally {
            setAction(null);
        }
    };

    const handleCancel = async (immediate: boolean) => {
        if (!activeTenantId) return;
        const confirmed = window.confirm(immediate ? t("confirmCancelImmediate") : t("confirmCancelAtPeriodEnd"));
        if (!confirmed) return;
        setAction("cancel");
        try {
            const res = await api.cancelBillingSubscription(activeTenantId, { immediate });
            if (!res?.success) throw new Error((res as any)?.error || t("actionFailed"));
            setToast(t("cancelled"));
            await load();
        } catch (err: any) {
            setError(err?.message || t("actionFailed"));
        } finally {
            setAction(null);
        }
    };

    useEffect(() => {
        if (!toast) return;
        const tm = setTimeout(() => setToast(null), 3000);
        return () => clearTimeout(tm);
    }, [toast]);

    if (loading) {
        return (
            <div className="max-w-4xl space-y-6">
                <div className="space-y-2">
                    <div className="skeleton h-7 w-48" />
                    <div className="skeleton h-4 w-72" />
                </div>
                <div className="skeleton h-44 w-full rounded-xl" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="skeleton h-72 w-full rounded-xl" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl space-y-6">
            <MpSecurityScript />
            <header>
                <h1 className="text-2xl font-semibold flex items-center gap-2">
                    <CreditCard size={22} />
                    {t("title")}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
            </header>

            <HelpPanel
                title={tHelp("settingsBilling.title")}
                description={tHelp("settingsBilling.description")}
                tips={tHelp.raw("settingsBilling.tips") as string[]}
                mediaKey="settingsBilling"
            />

            {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm flex gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            {toast && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-sm flex gap-2">
                    <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                    <span>{toast}</span>
                </div>
            )}

            {/* Current subscription card */}
            {subscription ? (
                <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <p className="text-xs uppercase text-neutral-500 tracking-wider">{t("currentPlan")}</p>
                            <h2 className="text-xl font-semibold mt-1">{currentPlan?.name ?? "—"}</h2>
                            <p className="text-sm text-neutral-500 mt-1">
                                {currentPlan ? formatMoney(
                                    currentPlan.displayPriceCents ?? currentPlan.priceUsdCents,
                                    currentPlan.displayCurrency ?? "USD",
                                    locale,
                                ) : ""} / {t("month")}
                            </p>
                        </div>
                        <StatusBadge status={subscription.status} />
                    </div>

                    <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        {subscription.status === "trialing" && subscription.trialEndsAt && (
                            <InfoRow label={t("trialEndsIn")} value={`${daysUntil(subscription.trialEndsAt) ?? 0} ${t("days")}`} />
                        )}
                        {subscription.currentPeriodEnd && (
                            <InfoRow
                                label={subscription.cancelAtPeriodEnd ? t("accessUntil") : t("nextBilling")}
                                value={formatDate(subscription.currentPeriodEnd, locale)}
                            />
                        )}
                        <InfoRow label={t("provider")} value={subscription.provider} />
                    </div>

                    {subscription.cancelAtPeriodEnd && (
                        <p className="mt-4 text-xs text-amber-700 dark:text-amber-400">
                            {t("scheduledCancelNotice", { date: formatDate(subscription.currentPeriodEnd, locale) })}
                        </p>
                    )}

                    {subscription.pendingPlan && subscription.pendingPlanChangeAt && (
                        <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-start gap-3">
                            <Clock size={14} className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                                    {t("pendingDowngradeTitle", {
                                        plan: subscription.pendingPlan.name,
                                        date: formatDate(subscription.pendingPlanChangeAt, locale),
                                    })}
                                </p>
                                <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">
                                    {t("pendingDowngradeHint")}
                                </p>
                            </div>
                            <button
                                onClick={handleCancelDowngrade}
                                className="text-[11px] font-semibold px-2 py-1 rounded bg-blue-600/10 hover:bg-blue-600/20 text-blue-700 dark:text-blue-300 transition-colors flex-shrink-0"
                            >
                                {t("pendingDowngradeCancel")}
                            </button>
                        </div>
                    )}

                    {(() => {
                        const isPaused = subscription.status === "past_due"
                            && (subscription.cancellationReason === "paused"
                                || subscription.cancellationReason?.startsWith("paused:"));
                        return (
                            <>
                                {isPaused && (
                                    <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-sm text-amber-800 dark:text-amber-300">
                                        {t("pausedBanner")}
                                    </div>
                                )}

                                <div className="mt-5 flex flex-wrap gap-2">
                                    {(subscription.status === "active" || subscription.status === "trialing" || subscription.status === "past_due") && (
                                        <button
                                            onClick={() => setModal({ kind: "change-card" })}
                                            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900"
                                        >
                                            {t("changeCard")}
                                        </button>
                                    )}

                                    {/* Past-due (and not paused): "retry now" force-syncs from MP */}
                                    {subscription.status === "past_due" && !isPaused && (
                                        <button
                                            onClick={handleRetry}
                                            disabled={action === "retry"}
                                            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 disabled:opacity-50"
                                        >
                                            {action === "retry" ? <Loader2 className="inline animate-spin" size={14} /> : t("retryNow")}
                                        </button>
                                    )}

                                    {/* Paused: only resume button */}
                                    {isPaused && (
                                        <button
                                            onClick={handleResume}
                                            disabled={action === "resume"}
                                            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 disabled:opacity-50"
                                        >
                                            {action === "resume" ? <Loader2 className="inline animate-spin" size={14} /> : t("resume")}
                                        </button>
                                    )}

                                    {/* Active / trialing (not pending cancel, not paused): pause + cancel options */}
                                    {(subscription.status === "active" || subscription.status === "trialing") && !subscription.cancelAtPeriodEnd && !isPaused && (
                                        <>
                                            <button
                                                onClick={handlePause}
                                                disabled={action === "pause"}
                                                className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900 disabled:opacity-50"
                                            >
                                                {action === "pause" ? <Loader2 className="inline animate-spin" size={14} /> : t("pause")}
                                            </button>
                                            <button
                                                onClick={() => handleCancel(false)}
                                                disabled={action === "cancel"}
                                                className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 disabled:opacity-50"
                                            >
                                                {t("cancelAtPeriodEnd")}
                                            </button>
                                            <button
                                                onClick={() => handleCancel(true)}
                                                disabled={action === "cancel"}
                                                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900 disabled:opacity-50"
                                            >
                                                {t("cancelImmediate")}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </>
                        );
                    })()}
                </section>
            ) : (
                <section className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/20 p-6 text-sm text-indigo-800 dark:text-indigo-300">
                    <p className="font-medium">{t("noSubscription")}</p>
                    <p className="mt-1 text-indigo-700 dark:text-indigo-400">{t("noSubscriptionHint")}</p>
                </section>
            )}

            {/* Usage this month */}
            {usage && (
                <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                {t("usageTitle")}
                            </h2>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                                {t("usageHint")}
                            </p>
                        </div>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                            {usage.monthKey}
                        </span>
                    </div>

                    <div className="flex items-end justify-between gap-3 mb-2">
                        <div>
                            <span className="text-3xl font-bold tabular text-neutral-900 dark:text-neutral-100">
                                {usage.used.toLocaleString()}
                            </span>
                            <span className="text-sm text-neutral-500 ml-2">
                                {usage.limit !== null
                                    ? `/ ${usage.limit.toLocaleString()} ${t("usageMessages")}`
                                    : t("usageUnlimited")}
                            </span>
                        </div>
                        {usage.limit !== null && (
                            <span
                                className={`text-xs font-bold px-2 py-1 rounded-full ${
                                    usage.percent >= 90
                                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                        : usage.percent >= 70
                                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                }`}
                            >
                                {usage.percent}%
                            </span>
                        )}
                    </div>

                    {usage.limit !== null && (
                        <>
                            <div className="h-2 w-full bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${
                                        usage.percent >= 90 ? "bg-red-500"
                                            : usage.percent >= 70 ? "bg-amber-500"
                                                : "bg-emerald-500"
                                    }`}
                                    style={{ width: `${Math.min(usage.percent, 100)}%` }}
                                />
                            </div>
                            {usage.percent >= 95 && (
                                <div className="mt-3 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 flex items-start gap-2">
                                    <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs font-semibold text-red-700 dark:text-red-300 flex-1">{t("warningCritical", { percent: usage.percent })}</p>
                                    <a href="#plans" className="text-xs font-semibold px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white flex items-center gap-1 flex-shrink-0">
                                        {t("upgradeNow")} <ArrowUpRight size={12} />
                                    </a>
                                </div>
                            )}
                            {usage.percent >= 80 && usage.percent < 95 && (
                                <div className="mt-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 flex items-start gap-2">
                                    <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-700 dark:text-amber-300 flex-1">{t("warningApproaching", { percent: usage.percent })}</p>
                                    <a href="#plans" className="text-xs font-medium px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1 flex-shrink-0">
                                        {t("upgradeNow")} <ArrowUpRight size={12} />
                                    </a>
                                </div>
                            )}
                        </>
                    )}

                    {(usage.conversations !== undefined || usage.activeAgents !== undefined) && (
                        <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800 grid grid-cols-2 gap-4">
                            {usage.conversations !== undefined && (
                                <div>
                                    <p className="text-xs uppercase text-neutral-500 tracking-wider">{t("usageConversations")}</p>
                                    <p className="mt-1 text-lg font-bold text-neutral-900 dark:text-neutral-100">{usage.conversations.toLocaleString()}</p>
                                    <p className="text-[11px] text-neutral-400">{t("usageThisMonth")}</p>
                                </div>
                            )}
                            {usage.activeAgents !== undefined && (
                                <div>
                                    <p className="text-xs uppercase text-neutral-500 tracking-wider">{t("usageAgents")}</p>
                                    <p className="mt-1 text-lg font-bold text-neutral-900 dark:text-neutral-100">
                                        {usage.activeAgents}{usage.maxAgents ? ` / ${usage.maxAgents}` : ""}
                                    </p>
                                    <p className="text-[11px] text-neutral-400">{t("usageActiveAgents")}</p>
                                </div>
                            )}
                        </div>
                    )}
                </section>
            )}

            {/* Media processing usage */}
            {usage?.media && (usage.media.audio.limit !== null || usage.media.image.limit !== null) && (
                <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                {t("mediaUsageTitle")}
                            </h2>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                                {t("mediaUsageHint")}
                            </p>
                        </div>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                            {usage.monthKey}
                        </span>
                    </div>

                    <div className="space-y-4">
                        {/* Audio transcription */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                    <Mic size={14} className="text-indigo-500" />
                                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{t("mediaAudio")}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm tabular-nums text-neutral-600 dark:text-neutral-400">
                                        {usage.media.audio.used.toLocaleString()}
                                        {usage.media.audio.limit !== null
                                            ? ` / ${usage.media.audio.limit.toLocaleString()}`
                                            : ` (${t("mediaUnlimited")})`}
                                    </span>
                                    {usage.media.audio.limit !== null && (
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                            usage.media.audio.percent >= 95 ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                                : usage.media.audio.percent >= 80 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                        }`}>
                                            {usage.media.audio.percent}%
                                        </span>
                                    )}
                                </div>
                            </div>
                            {usage.media.audio.limit !== null && (
                                <div className="h-1.5 w-full bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            usage.media.audio.percent >= 95 ? "bg-red-500"
                                                : usage.media.audio.percent >= 80 ? "bg-amber-500"
                                                    : "bg-emerald-500"
                                        }`}
                                        style={{ width: `${Math.min(usage.media.audio.percent, 100)}%` }}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Image analysis */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                    <Eye size={14} className="text-indigo-500" />
                                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{t("mediaImage")}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm tabular-nums text-neutral-600 dark:text-neutral-400">
                                        {usage.media.image.used.toLocaleString()}
                                        {usage.media.image.limit !== null
                                            ? ` / ${usage.media.image.limit.toLocaleString()}`
                                            : ` (${t("mediaUnlimited")})`}
                                    </span>
                                    {usage.media.image.limit !== null && (
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                            usage.media.image.percent >= 95 ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                                : usage.media.image.percent >= 80 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                        }`}>
                                            {usage.media.image.percent}%
                                        </span>
                                    )}
                                </div>
                            </div>
                            {usage.media.image.limit !== null && (
                                <div className="h-1.5 w-full bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            usage.media.image.percent >= 95 ? "bg-red-500"
                                                : usage.media.image.percent >= 80 ? "bg-amber-500"
                                                    : "bg-emerald-500"
                                        }`}
                                        style={{ width: `${Math.min(usage.media.image.percent, 100)}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Media warnings */}
                    {(usage.media.audio.percent >= 95 || usage.media.image.percent >= 95) && (
                        <div className="mt-4 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 flex items-start gap-2">
                            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                            <p className="text-xs font-semibold text-red-700 dark:text-red-300 flex-1">
                                {t("mediaWarningCritical")}
                            </p>
                            <a href="#plans" className="text-xs font-semibold px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white flex items-center gap-1 flex-shrink-0">
                                {t("upgradeNow")} <ArrowUpRight size={12} />
                            </a>
                        </div>
                    )}
                    {!(usage.media.audio.percent >= 95 || usage.media.image.percent >= 95) && (usage.media.audio.percent >= 80 || usage.media.image.percent >= 80) && (
                        <div className="mt-4 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 flex items-start gap-2">
                            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-700 dark:text-amber-300 flex-1">
                                {t("mediaWarningApproaching")}
                            </p>
                            <a href="#plans" className="text-xs font-medium px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1 flex-shrink-0">
                                {t("upgradeNow")} <ArrowUpRight size={12} />
                            </a>
                        </div>
                    )}
                </section>
            )}

            {/* Knowledge Base Usage */}
            {kbUsage && (kbUsage.embeddings.limit !== null || kbUsage.documents.limit !== null) && (
                <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <BookOpen className="w-4 h-4 text-violet-500" />
                        <h2 className="text-sm font-semibold">{t("kbUsageTitle")}</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Documents */}
                        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-violet-400" />
                                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{t("kbDocuments")}</span>
                                </div>
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: (kbUsage.documents.percent >= 95 ? "rgba(239,68,68,0.15)" : kbUsage.documents.percent >= 80 ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.15)"), color: (kbUsage.documents.percent >= 95 ? "#ef4444" : kbUsage.documents.percent >= 80 ? "#f59e0b" : "#22c55e") }}>
                                    {kbUsage.documents.percent}%
                                </span>
                            </div>
                            <div className="text-lg font-bold mb-1">
                                {kbUsage.documents.used} <span className="text-xs font-normal text-neutral-500">/ {kbUsage.documents.limit ?? t("unlimited")}</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(kbUsage.documents.percent, 100)}%`, background: kbUsage.documents.percent >= 95 ? "#ef4444" : kbUsage.documents.percent >= 80 ? "#f59e0b" : "#22c55e" }} />
                            </div>
                        </div>
                        {/* Embeddings */}
                        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-amber-400" />
                                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{t("kbEmbeddings")}</span>
                                </div>
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: (kbUsage.embeddings.percent >= 95 ? "rgba(239,68,68,0.15)" : kbUsage.embeddings.percent >= 80 ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.15)"), color: (kbUsage.embeddings.percent >= 95 ? "#ef4444" : kbUsage.embeddings.percent >= 80 ? "#f59e0b" : "#22c55e") }}>
                                    {kbUsage.embeddings.percent}%
                                </span>
                            </div>
                            <div className="text-lg font-bold mb-1">
                                {kbUsage.embeddings.used} <span className="text-xs font-normal text-neutral-500">/ {kbUsage.embeddings.limit ?? t("unlimited")}</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(kbUsage.embeddings.percent, 100)}%`, background: kbUsage.embeddings.percent >= 95 ? "#ef4444" : kbUsage.embeddings.percent >= 80 ? "#f59e0b" : "#22c55e" }} />
                            </div>
                        </div>
                    </div>
                    {kbUsage.maxCharsPerDoc && (
                        <div className="mt-3 text-xs text-neutral-500">
                            {t("kbMaxCharsPerDoc")}: {kbUsage.maxCharsPerDoc.toLocaleString()} (~{Math.round(kbUsage.maxCharsPerDoc / 2500)} {t("kbPages")})
                        </div>
                    )}
                    {(kbUsage.embeddings.percent >= 95 || kbUsage.documents.percent >= 95) && (
                        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                            <p className="text-xs text-red-600 dark:text-red-400 flex-1">{t("kbWarningCritical")}</p>
                            <a href="#plans" className="text-xs font-medium px-2.5 py-1 rounded-md bg-red-500 hover:bg-red-600 text-white flex items-center gap-1 flex-shrink-0">
                                {t("upgradeNow")} <ArrowUpRight size={12} />
                            </a>
                        </div>
                    )}
                    {(kbUsage.embeddings.percent >= 80 && kbUsage.embeddings.percent < 95) || (kbUsage.documents.percent >= 80 && kbUsage.documents.percent < 95) ? (
                        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                            <p className="text-xs text-amber-600 dark:text-amber-400 flex-1">{t("kbWarningApproaching")}</p>
                            <a href="#plans" className="text-xs font-medium px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1 flex-shrink-0">
                                {t("upgradeNow")} <ArrowUpRight size={12} />
                            </a>
                        </div>
                    ) : null}
                </section>
            )}

            {/* Coupon redeem */}
            {subscription && (
                <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Tag className="w-4 h-4 text-indigo-500" />
                        <h2 className="text-sm font-semibold">{t("couponTitle")}</h2>
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">{t("couponHint")}</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            type="text"
                            value={couponCode}
                            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                            placeholder="LAUNCH50"
                            className="flex-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm font-mono"
                        />
                        <button
                            onClick={handleRedeemCoupon}
                            disabled={redeemingCoupon || !couponCode.trim()}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white inline-flex items-center justify-center gap-2"
                        >
                            {redeemingCoupon && <Loader2 className="w-4 h-4 animate-spin" />}
                            {t("redeem")}
                        </button>
                    </div>
                </section>
            )}

            {/* Plans grid */}
            <section id="plans">
                <h2 className="text-lg font-semibold mb-3">{t("availablePlans")}</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {plans
                        .filter((p) => p.slug !== "custom")
                        .map((plan) => {
                            const isCurrent = subscription?.planId === plan.id;
                            const isDowngrade = currentPlan && plan.priceUsdCents < currentPlan.priceUsdCents;
                            const Icon = PLAN_ICON[plan.slug] ?? Zap;
                            return (
                                <div
                                    key={plan.id}
                                    className={cn(
                                        "rounded-xl border p-5 flex flex-col",
                                        isCurrent
                                            ? "border-indigo-400 dark:border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20"
                                            : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900",
                                    )}
                                >
                                    <div className="flex items-center gap-2">
                                        <Icon size={18} className="text-indigo-500" />
                                        <h3 className="font-semibold">{plan.name}</h3>
                                    </div>
                                    <p className="mt-3 text-2xl font-bold">
                                        {formatMoney(
                                            plan.displayPriceCents ?? plan.priceUsdCents,
                                            plan.displayCurrency ?? "USD",
                                            locale,
                                        )}
                                        <span className="text-sm font-normal text-neutral-500"> / {t("month")}</span>
                                    </p>
                                    {plan.priceSource === "fx" && (
                                        <p className="text-xs text-neutral-400 -mt-1.5">
                                            ≈ {formatMoney(plan.priceUsdCents, "USD", locale)} {t("approxFromUsd")}
                                        </p>
                                    )}
                                    <ul className="mt-4 space-y-1.5 text-sm text-neutral-600 dark:text-neutral-400 flex-1">
                                        <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("agentsUpTo", { n: plan.maxAgents })}</li>
                                        <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("aiMessages", { n: plan.maxAiMessages === -1 ? t("unlimitedWord") : plan.maxAiMessages.toLocaleString() })}</li>
                                        <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("planChannels", { n: (plan.features?.channels as string[])?.length ?? 1 })}</li>
                                        <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("planContacts", { n: plan.features?.maxContacts === -1 ? t("unlimitedWord") : (plan.features?.maxContacts ?? 100).toLocaleString() })}</li>
                                        <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("planSeats", { n: plan.features?.seats === -1 ? t("unlimitedWord") : (plan.features?.seats ?? 1) })}</li>
                                        <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("planCalendars", { n: plan.features?.maxCalendars === -1 ? t("unlimitedWord") : (plan.features?.maxCalendars ?? 1) })}</li>
                                        {plan.features?.knowledgeMaxCharsPerDoc != null && (
                                            <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("kbMaxPages", { n: plan.features.knowledgeMaxCharsPerDoc === -1 ? t("unlimitedWord") : Math.round((plan.features.knowledgeMaxCharsPerDoc as number) / 2500) })}</li>
                                        )}
                                        {plan.features?.knowledgeEmbeddingsPerMonth != null && (
                                            <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("kbEmbeddings", { n: plan.features.knowledgeEmbeddingsPerMonth === -1 ? t("unlimitedWord") : (plan.features.knowledgeEmbeddingsPerMonth as number).toLocaleString() })}</li>
                                        )}
                                        {plan.features?.customPrompt && (
                                            <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("planCustomPrompt")}</li>
                                        )}
                                        {plan.features?.automationRules !== 0 && (
                                            <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("planAutomation", { n: plan.features?.automationRules === -1 ? t("unlimitedWord") : (plan.features?.automationRules ?? 0) })}</li>
                                        )}
                                        {plan.features?.sso && (
                                            <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("planSso")}</li>
                                        )}
                                        {plan.features?.prioritySupport && (
                                            <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("planPrioritySupport")}</li>
                                        )}
                                        <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("trialDays", { n: plan.trialDays })}</li>
                                        {plan.requiresCardForTrial && (
                                            <li className="flex gap-2"><CreditCard size={14} className="text-neutral-400 mt-0.5 shrink-0" />{t("requiresCard")}</li>
                                        )}
                                    </ul>
                                    <button
                                        onClick={() => {
                                            if (isDowngrade && subscription) {
                                                const ok = window.confirm(t("confirmDowngrade", {
                                                    plan: plan.name,
                                                    date: formatDate(subscription.currentPeriodEnd, locale),
                                                }));
                                                if (!ok) return;
                                            }
                                            handleUpgrade(plan.slug);
                                        }}
                                        disabled={isCurrent || action !== null}
                                        className={cn(
                                            "mt-4 w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                                            isCurrent
                                                ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 cursor-default"
                                                : isDowngrade
                                                    ? "bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-60"
                                                    : "bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-60",
                                        )}
                                    >
                                        {action === "upgrade" && targetPlan === plan.slug ? t("loading") :
                                         isCurrent ? t("currentPlanLabel") :
                                         isDowngrade ? t("downgradeToPlan", { name: plan.name }) :
                                         subscription ? t("upgradeToPlan", { name: plan.name }) :
                                         t("startTrial")}
                                    </button>
                                    {isDowngrade && !isCurrent && (
                                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 text-center">
                                            {t("downgradeScheduledHint")}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                </div>
            </section>

            {/* Card modal — upgrade-to-paid flow and change-card flow */}
            {modal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !modalSubmitting && setModal(null)}>
                    <div className="w-full max-w-md rounded-xl bg-white dark:bg-neutral-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold">
                                {modal.kind === "upgrade" ? t("modalUpgradeTitle") : t("modalChangeCardTitle")}
                            </h3>
                            <button onClick={() => !modalSubmitting && setModal(null)} className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded">
                                <X size={16} />
                            </button>
                        </div>

                        {modal.kind === "upgrade" && (
                            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                                {t("modalUpgradeSubtitle", { name: plans.find(p => p.slug === modal.planSlug)?.name ?? modal.planSlug })}
                            </p>
                        )}

                        <MpCardForm
                            onToken={(token) => {
                                if (modal.kind === "upgrade") handleUpgrade(modal.planSlug, token);
                                else handleChangeCard(token);
                            }}
                            submitting={modalSubmitting || action !== null}
                            submitLabel={modal.kind === "upgrade" ? t("modalUpgradeSubmit") : t("modalChangeCardSubmit")}
                        />
                    </div>
                </div>
            )}

            {/* Invoice history */}
            {subscription && subscription.payments.length > 0 && (
                <section>
                    <h2 className="text-lg font-semibold mb-3">{t("invoiceHistory")}</h2>
                    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-50 dark:bg-neutral-900 text-left text-xs uppercase text-neutral-500">
                                <tr>
                                    <th className="px-4 py-3">{t("date")}</th>
                                    <th className="px-4 py-3">{t("amount")}</th>
                                    <th className="px-4 py-3">{t("status")}</th>
                                    <th className="px-4 py-3 text-right">{t("invoice")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 bg-white dark:bg-neutral-900">
                                {subscription.payments.map((p) => (
                                    <tr key={p.id}>
                                        <td className="px-4 py-3">{formatDate(p.paidAt || p.createdAt, locale)}</td>
                                        <td className="px-4 py-3 font-medium">{formatMoney(p.amountCents, p.currency, locale)}</td>
                                        <td className="px-4 py-3">
                                            <span className={cn(
                                                "px-2 py-0.5 text-[11px] rounded-full",
                                                p.status === "succeeded" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                                                p.status === "failed" && "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
                                                p.status === "refunded" && "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
                                                p.status === "pending" && "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                                            )}>
                                                {["succeeded", "failed", "refunded", "pending"].includes(p.status)
                                                    ? t(`paymentStatus.${p.status as "succeeded" | "failed" | "refunded" | "pending"}`)
                                                    : p.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-3">
                                                {p.status === "succeeded" || p.status === "refunded" ? (
                                                    <button
                                                        onClick={() => api.downloadInvoice(activeTenantId!, p.id)}
                                                        className="text-indigo-500 hover:underline bg-transparent border-none p-0 cursor-pointer text-sm"
                                                    >
                                                        {t("download")}
                                                    </button>
                                                ) : (
                                                    <span className="text-neutral-400">—</span>
                                                )}
                                                {isSuperAdmin && p.status === "succeeded" && (
                                                    <button
                                                        onClick={() => handleRefund(p.id, p.amountCents, p.currency)}
                                                        className="text-xs px-2 py-0.5 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 border border-red-200 dark:border-red-900"
                                                    >
                                                        {t("refund")}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
        </div>
    );
}

function StatusBadge({ status }: { status: SubscriptionStatus }) {
    const t = useTranslations("billingPage.statusLabels");
    const meta = STATUS_META[status];
    const Icon = meta.Icon;
    return (
        <span className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium", meta.className)}>
            <Icon size={14} />
            {t(meta.label)}
        </span>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <p className="text-xs uppercase text-neutral-500 tracking-wider">{label}</p>
            <p className="mt-1 font-medium">{value}</p>
        </div>
    );
}
