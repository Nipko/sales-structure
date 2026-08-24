"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { Sparkles, AlertTriangle, Lock, X } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { RestrictionInfo } from "@/app/admin/layout";

interface Props {
    restriction?: RestrictionInfo;
}

export default function TrialCountdownBanner({ restriction }: Props) {
    const t = useTranslations("trialBanner");
    const locale = useLocale();
    const { activeTenantId } = useTenant();
    const { isSuperAdmin, impersonating } = useRole();
    const [daysLeft, setDaysLeft] = useState<number | null>(null);
    const [nextCharge, setNextCharge] = useState<
        { at: string; amountCents: number; currency: string } | null
    >(null);
    const [dismissed, setDismissed] = useState(false);
    const hiddenForSuperAdmin = isSuperAdmin && !impersonating;

    useEffect(() => {
        if (hiddenForSuperAdmin || !activeTenantId) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await api.getBillingSubscription(activeTenantId);
                if (cancelled) return;
                const sub: any = res?.data;
                if (!sub || sub.status !== "trialing" || !sub.trialEndsAt) {
                    setDaysLeft(null);
                    setNextCharge(null);
                    return;
                }
                const ms = new Date(sub.trialEndsAt).getTime() - Date.now();
                setDaysLeft(Math.max(0, Math.ceil(ms / 86_400_000)));
                // Un trial con cobro agendado no es un trial por vencer: el
                // cliente ya puso su medio de pago y eligió plan. Apurarlo con el
                // mismo aviso que a quien no hizo nada es decirle que su compra
                // no sirvió de nada.
                setNextCharge(sub.nextCharge ?? null);
            } catch {
                setDaysLeft(null);
            }
        })();
        return () => { cancelled = true; };
    }, [activeTenantId, hiddenForSuperAdmin]);

    const dismissalKey = activeTenantId
        ? `trial-banner-dismissed:${activeTenantId}:${new Date().toISOString().slice(0, 10)}`
        : null;

    useEffect(() => {
        if (hiddenForSuperAdmin || !dismissalKey || typeof window === "undefined") return;
        setDismissed(window.localStorage.getItem(dismissalKey) === "1");
    }, [dismissalKey, hiddenForSuperAdmin]);

    const handleDismiss = () => {
        if (dismissalKey && typeof window !== "undefined") {
            window.localStorage.setItem(dismissalKey, "1");
        }
        setDismissed(true);
    };

    if (hiddenForSuperAdmin) return null;

    // Soft lock banner — NOT dismissable
    if (restriction?.level === "soft_lock") {
        return (
            <div
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm border-b bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200"
                role="alert"
            >
                <div className="flex items-center gap-2 min-w-0">
                    <Lock size={16} className="shrink-0" />
                    <span className="font-medium">
                        {t("softLock", { days: restriction.daysRemaining })}
                    </span>
                    <Link
                        href="/admin/settings/billing"
                        className="font-semibold underline hover:no-underline shrink-0"
                    >
                        {t("payNow")}
                    </Link>
                </div>
            </div>
        );
    }

    // Warning banner (past_due, days 0-2) — NOT dismissable
    if (restriction?.level === "warning") {
        return (
            <div
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm border-b bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200"
                role="alert"
            >
                <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle size={16} className="shrink-0" />
                    <span className="font-medium">
                        {t("graceWarning", { days: restriction.daysRemaining })}
                    </span>
                    <Link
                        href="/admin/settings/billing"
                        className="font-semibold underline hover:no-underline shrink-0"
                    >
                        {t("managePlan")}
                    </Link>
                </div>
            </div>
        );
    }

    // Normal trial countdown — dismissable
    if (daysLeft === null || dismissed) return null;

    // Con el cobro ya agendado el aviso es informativo, nunca urgente: no hay
    // nada que el cliente tenga que correr a hacer.
    const isUrgent = daysLeft <= 3 && !nextCharge;
    const Icon = isUrgent ? AlertTriangle : Sparkles;

    return (
        <div
            className={cn(
                "flex items-center justify-between gap-3 px-4 py-2 text-sm border-b",
                isUrgent
                    ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300"
                    : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300",
            )}
            role="status"
        >
            <div className="flex items-center gap-2 min-w-0">
                <Icon size={16} className="shrink-0" />
                <span className="truncate">
                    {nextCharge
                        ? t("convertsOn", {
                            date: new Date(nextCharge.at).toLocaleDateString(locale, {
                                day: "numeric", month: "long",
                            }),
                            amount: new Intl.NumberFormat(locale, {
                                style: "currency",
                                currency: nextCharge.currency || "USD",
                                maximumFractionDigits: nextCharge.amountCents % 100 === 0 ? 0 : 2,
                            }).format(nextCharge.amountCents / 100),
                        })
                        : daysLeft === 0
                            ? t("endsToday")
                            : daysLeft === 1
                                ? t("endsTomorrow")
                                : t("endsIn", { days: daysLeft })}
                </span>
                <Link
                    href="/admin/settings/billing"
                    className="font-semibold underline hover:no-underline shrink-0"
                >
                    {t("managePlan")}
                </Link>
            </div>
            <button
                onClick={handleDismiss}
                aria-label={t("dismiss")}
                className={cn(
                    "shrink-0 p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors",
                )}
            >
                <X size={14} />
            </button>
        </div>
    );
}
