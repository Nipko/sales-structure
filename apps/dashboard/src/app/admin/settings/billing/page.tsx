"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    CreditCard, CheckCircle2, AlertTriangle, XCircle, Clock,
    Zap, Rocket, Briefcase, Sparkles, Loader2,
} from "lucide-react";

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
    starter: Zap,
    pro: Rocket,
    enterprise: Briefcase,
    custom: Sparkles,
};

export default function BillingPage() {
    const t = useTranslations("billingPage");
    const { activeTenantId } = useTenant();
    const locale = typeof navigator !== "undefined" ? navigator.language : "es-CO";

    const [loading, setLoading] = useState(true);
    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [action, setAction] = useState<null | "upgrade" | "cancel" | "reactivate">(null);
    const [targetPlan, setTargetPlan] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        setError(null);
        try {
            const [subRes, plansRes] = await Promise.all([
                api.getBillingSubscription(activeTenantId),
                api.getBillingPlans(),
            ]);
            if (subRes?.success) setSubscription((subRes.data as any) ?? null);
            if (plansRes?.success) setPlans((plansRes.data as Plan[]) ?? []);
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

    const handleUpgrade = async (planSlug: string) => {
        if (!activeTenantId) return;
        setAction("upgrade");
        setTargetPlan(planSlug);
        try {
            if (!subscription) {
                const res = await api.startBillingTrial(activeTenantId, { planSlug });
                if (!res?.success) throw new Error((res as any)?.error || t("actionFailed"));
                setToast(t("trialStarted"));
            } else {
                const res = await api.upgradeBillingPlan(activeTenantId, { planSlug });
                if (!res?.success) throw new Error((res as any)?.error || t("actionFailed"));
                setToast(t("planChanged"));
            }
            await load();
        } catch (err: any) {
            setError(err?.message || t("actionFailed"));
        } finally {
            setAction(null);
            setTargetPlan(null);
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
            <div className="flex items-center justify-center py-20 text-neutral-500">
                <Loader2 className="animate-spin mr-2" size={20} />
                {t("loading")}
            </div>
        );
    }

    return (
        <div className="max-w-4xl space-y-6">
            <header>
                <h1 className="text-2xl font-semibold flex items-center gap-2">
                    <CreditCard size={22} />
                    {t("title")}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
            </header>

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
                                {currentPlan ? formatMoney(currentPlan.priceUsdCents, "USD", locale) : ""} / {t("month")}
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

                    <div className="mt-5 flex flex-wrap gap-2">
                        {(subscription.status === "active" || subscription.status === "trialing") && !subscription.cancelAtPeriodEnd && (
                            <>
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
                </section>
            ) : (
                <section className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/20 p-6 text-sm text-indigo-800 dark:text-indigo-300">
                    <p className="font-medium">{t("noSubscription")}</p>
                    <p className="mt-1 text-indigo-700 dark:text-indigo-400">{t("noSubscriptionHint")}</p>
                </section>
            )}

            {/* Plans grid */}
            <section>
                <h2 className="text-lg font-semibold mb-3">{t("availablePlans")}</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {plans
                        .filter((p) => p.slug !== "custom")
                        .map((plan) => {
                            const isCurrent = subscription?.planId === plan.id;
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
                                        {formatMoney(plan.priceUsdCents, "USD", locale)}
                                        <span className="text-sm font-normal text-neutral-500"> / {t("month")}</span>
                                    </p>
                                    <ul className="mt-4 space-y-1.5 text-sm text-neutral-600 dark:text-neutral-400 flex-1">
                                        <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("agentsUpTo", { n: plan.maxAgents })}</li>
                                        <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("aiMessages", { n: plan.maxAiMessages.toLocaleString() })}</li>
                                        <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />{t("trialDays", { n: plan.trialDays })}</li>
                                        {plan.requiresCardForTrial && (
                                            <li className="flex gap-2"><CreditCard size={14} className="text-neutral-400 mt-0.5 shrink-0" />{t("requiresCard")}</li>
                                        )}
                                    </ul>
                                    <button
                                        onClick={() => handleUpgrade(plan.slug)}
                                        disabled={isCurrent || action !== null || (plan.requiresCardForTrial && !subscription)}
                                        className={cn(
                                            "mt-4 w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                                            isCurrent
                                                ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 cursor-default"
                                                : "bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-60",
                                        )}
                                    >
                                        {action === "upgrade" && targetPlan === plan.slug ? t("loading") :
                                         isCurrent ? t("currentPlanLabel") :
                                         subscription ? t("changeToPlan", { name: plan.name }) :
                                         t("startTrial")}
                                    </button>
                                    {plan.requiresCardForTrial && !subscription && (
                                        <p className="text-[11px] text-neutral-500 mt-2 text-center">{t("cardPickerPending")}</p>
                                    )}
                                </div>
                            );
                        })}
                </div>
            </section>

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
                                            {p.invoicePdfUrl ? (
                                                <a href={p.invoicePdfUrl} target="_blank" rel="noopener" className="text-indigo-500 hover:underline">{t("download")}</a>
                                            ) : (
                                                <span className="text-neutral-400">—</span>
                                            )}
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
