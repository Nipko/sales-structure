"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Sparkles, AlertTriangle, X } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Persistent header banner that shows the tenant's trial countdown.
 * Disappears once subscription is active/cancelled/expired or when the
 * tenant dismisses the current day's notice.
 *
 * Dismissal is stored in localStorage keyed by tenantId + day-of-year so
 * the banner re-appears every day — nagging but not overwhelming.
 */
export default function TrialCountdownBanner() {
    const t = useTranslations("trialBanner");
    const { activeTenantId } = useTenant();
    const [daysLeft, setDaysLeft] = useState<number | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!activeTenantId) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await api.getBillingSubscription(activeTenantId);
                if (cancelled) return;
                const sub: any = res?.data;
                if (!sub || sub.status !== "trialing" || !sub.trialEndsAt) {
                    setDaysLeft(null);
                    return;
                }
                const ms = new Date(sub.trialEndsAt).getTime() - Date.now();
                setDaysLeft(Math.max(0, Math.ceil(ms / 86_400_000)));
            } catch {
                setDaysLeft(null);
            }
        })();
        return () => { cancelled = true; };
    }, [activeTenantId]);

    // Per-day dismissal — re-shows every calendar day so the tenant stays reminded.
    const dismissalKey = activeTenantId
        ? `trial-banner-dismissed:${activeTenantId}:${new Date().toISOString().slice(0, 10)}`
        : null;

    useEffect(() => {
        if (!dismissalKey || typeof window === "undefined") return;
        setDismissed(window.localStorage.getItem(dismissalKey) === "1");
    }, [dismissalKey]);

    const handleDismiss = () => {
        if (dismissalKey && typeof window !== "undefined") {
            window.localStorage.setItem(dismissalKey, "1");
        }
        setDismissed(true);
    };

    if (daysLeft === null || dismissed) return null;

    const isUrgent = daysLeft <= 3;
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
                    {daysLeft === 0
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
