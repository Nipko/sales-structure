"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Loader2, BarChart3 } from "lucide-react";

interface Snapshot {
    tenantId: string;
    industry: string | null;
    subType: string | null;
    stats: Record<string, any> | null;
    generatedAt: string;
}

export default function TenantVerticalActivity({ tenantId }: { tenantId: string }) {
    const t = useTranslations("verticalAnalytics");
    const tInd = useTranslations("onboarding.industries");
    const [data, setData] = useState<Snapshot | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            const res = await api.getVerticalTenant(tenantId);
            if (!cancelled && res.success) setData(res.data ?? null);
            if (!cancelled) setLoading(false);
        }
        load();
        return () => { cancelled = true; };
    }, [tenantId]);

    if (loading) {
        return (
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
                <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
            </div>
        );
    }

    if (!data || !data.stats || Object.keys(data.stats).length === 0) {
        return null;
    }

    const numericEntries = Object.entries(data.stats)
        .filter(([, v]) => typeof v === "number");

    if (numericEntries.length === 0) return null;

    const cleanInd = data.industry ? data.industry.replace(/^tenants\.industries\./, "") : "";
    const industryLabel = cleanInd && tInd.has(cleanInd)
        ? tInd(cleanInd)
        : cleanInd || "—";

    return (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
            <header className="flex items-start gap-2 mb-4">
                <BarChart3 className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
                <div>
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {t("perTenant.title")} — {industryLabel}
                    </h3>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {t("perTenant.subtitle")}
                    </p>
                </div>
            </header>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {numericEntries.map(([key, val]) => (
                    <div
                        key={key}
                        className="bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-100 dark:border-neutral-800 rounded-lg p-3"
                    >
                        <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 truncate">
                            {t.has(`metrics.${key}`) ? t(`metrics.${key}`) : key}
                        </div>
                        <div className="text-xl font-bold text-neutral-900 dark:text-neutral-100 mt-1">
                            {val as number}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
