"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Mic, Image, DollarSign, Loader2 } from "lucide-react";

interface MediaUsageData {
    audio: { used: number; limit: number };
    image: { used: number; limit: number };
    dailyCostCents: number;
    dailyBudgetCents: number;
}

export default function TenantMediaStats({ tenantId }: { tenantId: string }) {
    const t = useTranslations("tenantMedia");
    const [data, setData] = useState<MediaUsageData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        api.getMediaProcessingUsage(tenantId)
            .then(res => {
                if (res.success && res.data) setData(res.data);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [tenantId]);

    if (loading) {
        return (
            <div className="bg-card border border-border rounded-xl p-6 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!data) return null;

    const formatLimit = (n: number) => n === -1 || !Number.isFinite(n) ? t("unlimited") : n.toLocaleString();
    const pct = (used: number, limit: number) => {
        if (limit === -1 || !Number.isFinite(limit) || limit === 0) return 0;
        return Math.min(100, Math.round((used / limit) * 100));
    };

    const rows = [
        {
            icon: <Mic className="h-4 w-4 text-indigo-500" />,
            label: t("audioLabel"),
            help: t("audioHelp"),
            used: data.audio.used,
            limit: data.audio.limit,
        },
        {
            icon: <Image className="h-4 w-4 text-emerald-500" />,
            label: t("imageLabel"),
            help: t("imageHelp"),
            used: data.image.used,
            limit: data.image.limit,
        },
        {
            icon: <DollarSign className="h-4 w-4 text-amber-500" />,
            label: t("dailyCostLabel"),
            help: t("dailyCostHelp"),
            used: data.dailyCostCents,
            limit: data.dailyBudgetCents,
        },
    ];

    return (
        <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Mic className="h-4 w-4 text-indigo-500" />
                    {t("title")}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">{t("subtitle")}</p>
            </div>

            <div className="p-4 space-y-3">
                {rows.map((r, i) => {
                    const p = pct(r.used, r.limit);
                    const over = p >= 100;
                    const warn = p >= 80 && !over;
                    return (
                        <div key={i} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    {r.icon}
                                    <div>
                                        <span className="text-sm font-medium">{r.label}</span>
                                        <p className="text-xs text-muted-foreground">{r.help}</p>
                                    </div>
                                </div>
                                <span className="font-mono text-xs text-muted-foreground">
                                    {r.used.toLocaleString()} / {formatLimit(r.limit)}
                                </span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                    className={cn(
                                        "h-full transition-all",
                                        over ? "bg-red-500" : warn ? "bg-amber-500" : "bg-emerald-500",
                                    )}
                                    style={{ width: `${p}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
