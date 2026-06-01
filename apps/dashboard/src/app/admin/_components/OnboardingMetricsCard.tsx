"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { api } from "@/lib/api";
import { Rocket, Clock, Zap } from "lucide-react";

interface ActivationData {
    totalTenants: number;
    activatedTenants: number;
    notActivated: number;
    activationRate: number;
    ttfv: {
        sampleSize: number;
        medianSeconds: number | null;
        avgSeconds: number | null;
        p90Seconds: number | null;
        under15minRate: number;
        under1hRate: number;
        under24hRate: number;
    };
    firstChannelBreakdown: { channelType: string; count: number }[];
}

const CHANNEL_LABEL: Record<string, string> = {
    whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger",
    telegram: "Telegram", email: "Email", sms: "SMS", webchat: "Web", web_chat: "Web",
};

export default function OnboardingMetricsCard() {
    const t = useTranslations("onboardingMetrics");
    const locale = useLocale();
    const [data, setData] = useState<ActivationData | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        api.getActivationMetrics()
            .then((res: any) => setData((res?.data as ActivationData) || (res as ActivationData) || null))
            .catch(() => {})
            .finally(() => setLoaded(true));
    }, []);

    const fmt = (secs: number | null): string => {
        if (secs == null) return "—";
        if (secs < 60) return "< 1 min";
        if (secs < 3600) return `${Math.round(secs / 60)} min`;
        if (secs < 86400) return `${(secs / 3600).toFixed(1)} h`;
        const dayUnit = locale === "fr" ? "j" : "d";
        return `${(secs / 86400).toFixed(1)} ${dayUnit}`;
    };

    if (!loaded || !data) return null;

    return (
        <div className="mb-8 rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.02] p-5">
            <div className="flex items-center gap-2 mb-4">
                <Rocket size={16} className="text-indigo-500" />
                <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
                <span className="text-[12px] text-muted-foreground hidden sm:inline">— {t("subtitle")}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Metric
                    icon={<Zap size={16} className="text-emerald-500" />}
                    label={t("activationRate")}
                    value={`${data.activationRate}%`}
                    sub={t("activatedOf", { activated: data.activatedTenants, total: data.totalTenants })}
                />
                <Metric
                    icon={<Clock size={16} className="text-sky-500" />}
                    label={t("ttfvMedian")}
                    value={fmt(data.ttfv.medianSeconds)}
                    sub={t("under15", { rate: data.ttfv.under15minRate })}
                />
                <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">{t("firstChannel")}</p>
                    <div className="flex flex-wrap gap-1.5">
                        {data.firstChannelBreakdown.length === 0 ? (
                            <span className="text-[12px] text-muted-foreground">{t("noData")}</span>
                        ) : (
                            data.firstChannelBreakdown.map((c) => (
                                <span key={c.channelType} className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-medium">
                                    {CHANNEL_LABEL[c.channelType] || c.channelType}: {c.count}
                                </span>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Metric({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub: string }) {
    return (
        <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3.5">
            <div className="flex items-center gap-1.5 mb-1.5">
                {icon}
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            </div>
            <p className="text-2xl font-semibold text-foreground">{value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
        </div>
    );
}
