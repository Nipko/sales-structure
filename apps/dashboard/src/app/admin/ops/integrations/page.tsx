"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
    Loader2,
    RefreshCw,
    Waypoints,
} from "lucide-react";
import {
    api,
    type IntegrationOutboxOverview,
    type IntegrationRailStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const OUTBOX_STATUSES = [
    "pending",
    "retrying",
    "in_flight",
    "delivered",
    "dead",
    "suppressed",
    "expired",
] as const;

type OutboxStatus = typeof OUTBOX_STATUSES[number];

const EMPTY_RAIL: IntegrationRailStatus = {
    certified: [],
    registered: [],
    certifiedWithoutAdapter: [],
    adapterWithoutCertification: [],
};

function ProviderList({ providers, empty }: { providers: string[]; empty: string }) {
    if (!providers.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
    return (
        <div className="flex flex-wrap gap-2">
            {providers.map(provider => (
                <span
                    key={provider}
                    className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium"
                >
                    {provider}
                </span>
            ))}
        </div>
    );
}

export default function IntegrationOutboxReviewPage() {
    const t = useTranslations("integrationOutbox");
    const locale = useLocale();
    const [rail, setRail] = useState<IntegrationRailStatus>(EMPTY_RAIL);
    const [overview, setOverview] = useState<IntegrationOutboxOverview>({ tenants: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(false);
        const [railResponse, overviewResponse] = await Promise.all([
            api.getIntegrationRail(),
            api.getIntegrationOutboxOverview(),
        ]);

        if (!railResponse.success || !railResponse.data
            || !overviewResponse.success || !overviewResponse.data) {
            setError(true);
        } else {
            setRail(railResponse.data);
            setOverview(overviewResponse.data);
        }
        setLoading(false);
    }, []);

    useEffect(() => { void load(); }, [load]);

    const totals = useMemo(() => {
        const result: Record<OutboxStatus, number> = Object.fromEntries(
            OUTBOX_STATUSES.map(status => [status, 0]),
        ) as Record<OutboxStatus, number>;
        for (const tenant of overview.tenants) {
            for (const status of OUTBOX_STATUSES) {
                result[status] += Number(tenant.byStatus[status] || 0);
            }
        }
        return result;
    }, [overview]);

    const railMismatch = rail.certifiedWithoutAdapter.length > 0
        || rail.adapterWithoutCertification.length > 0;
    const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
    }), [locale]);

    return (
        <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold">
                        <Waypoints className="h-6 w-6 text-indigo-500" />
                        {t("title")}
                    </h1>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitle")}</p>
                </div>
                <button
                    type="button"
                    onClick={() => void load()}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm transition hover:bg-muted disabled:opacity-50"
                >
                    {loading
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <RefreshCw className="h-4 w-4" />}
                    {t("refresh")}
                </button>
            </header>

            <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-4 text-sm text-blue-800 dark:text-blue-200">
                {t("scopeNote")}
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
                    <AlertCircle className="h-5 w-5 shrink-0" />
                    {t("loadError")}
                </div>
            )}

            {!loading && !error && (
                <>
                    <section className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold">{t("railTitle")}</h2>
                            <span className={cn(
                                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                                railMismatch
                                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                            )}>
                                {railMismatch
                                    ? <AlertTriangle className="h-3.5 w-3.5" />
                                    : <CheckCircle2 className="h-3.5 w-3.5" />}
                                {railMismatch ? t("unsafeRail") : t("healthyRail")}
                            </span>
                        </div>

                        {railMismatch && (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
                                {t("mismatchWarning")}
                            </div>
                        )}

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            {([
                                ["certified", rail.certified],
                                ["registered", rail.registered],
                                ["certifiedWithoutAdapter", rail.certifiedWithoutAdapter],
                                ["adapterWithoutCertification", rail.adapterWithoutCertification],
                            ] as const).map(([key, providers]) => (
                                <article key={key} className="rounded-xl border border-border bg-card p-4">
                                    <h3 className="mb-3 text-sm font-semibold">{t(key)}</h3>
                                    <ProviderList providers={providers} empty={t("none")} />
                                </article>
                            ))}
                        </div>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">{t("totalsTitle")}</h2>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
                            {OUTBOX_STATUSES.map(status => (
                                <article key={status} className="rounded-xl border border-border bg-card p-4">
                                    <p className="text-xs text-muted-foreground">{t(`statuses.${status}`)}</p>
                                    <p className="mt-1 text-2xl font-semibold tabular-nums">{totals[status]}</p>
                                </article>
                            ))}
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div>
                            <h2 className="text-lg font-semibold">{t("tenantReviewTitle")}</h2>
                            <p className="text-sm text-muted-foreground">{t("tenantReviewSubtitle")}</p>
                        </div>

                        {!overview.tenants.length ? (
                            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                                {t("noTrackedTenants")}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {overview.tenants.map(tenant => (
                                    <article key={tenant.tenantId} className="overflow-hidden rounded-xl border border-border bg-card">
                                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                                            <div>
                                                <h3 className="font-semibold">{tenant.tenantName}</h3>
                                                <p className="text-xs text-muted-foreground">
                                                    {t("attentionCount", { count: tenant.attention.length })}
                                                </p>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {OUTBOX_STATUSES
                                                    .filter(status => Number(tenant.byStatus[status] || 0) > 0)
                                                    .map(status => (
                                                        <span key={status} className="rounded-full bg-muted px-2 py-1 text-xs">
                                                            {t(`statuses.${status}`)}: {tenant.byStatus[status]}
                                                        </span>
                                                    ))}
                                            </div>
                                        </div>

                                        {!tenant.attention.length ? (
                                            <p className="p-4 text-sm text-muted-foreground">{t("noAttention")}</p>
                                        ) : (
                                            <div className="overflow-x-auto">
                                                <table className="w-full min-w-[760px] text-left text-sm">
                                                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                                                        <tr>
                                                            <th className="px-4 py-3 font-medium">{t("provider")}</th>
                                                            <th className="px-4 py-3 font-medium">{t("operation")}</th>
                                                            <th className="px-4 py-3 font-medium">{t("status")}</th>
                                                            <th className="px-4 py-3 font-medium">{t("attempts")}</th>
                                                            <th className="px-4 py-3 font-medium">{t("lastError")}</th>
                                                            <th className="px-4 py-3 font-medium">{t("createdAt")}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-border">
                                                        {tenant.attention.map(item => (
                                                            <tr key={item.id}>
                                                                <td className="px-4 py-3 font-medium">{item.provider}</td>
                                                                <td className="px-4 py-3">{item.operation}</td>
                                                                <td className="px-4 py-3">
                                                                    <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                                                                        {OUTBOX_STATUSES.includes(item.status as OutboxStatus)
                                                                            ? t(`statuses.${item.status as OutboxStatus}`)
                                                                            : t("statuses.unknown")}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3 tabular-nums">{item.attempts}</td>
                                                                <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                                                                    {item.lastError || t("none")}
                                                                </td>
                                                                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                                                    {dateFormatter.format(new Date(item.createdAt))}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
