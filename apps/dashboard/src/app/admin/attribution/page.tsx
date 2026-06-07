"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { Megaphone, Loader2, MousePointerClick, Users, Target, Trophy, DollarSign, Radio } from "lucide-react";

interface CtwaSummary { clicks: number; ads: number; contacts: number; leads: number; won: number; revenue: number; conversionRate: number }
interface AdRow { sourceId: string; headline?: string; sourceUrl?: string; clicks: number; leads: number; won: number; revenue: number; conversionRate: number }
interface BroadcastRow { campaignId: string; campaignName: string; recipients: number; won: number; revenue: number }

const CARD = "rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]";
const fmtMoney = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const RANGES = [
    { key: "30", days: 30 },
    { key: "90", days: 90 },
    { key: "365", days: 365 },
];

export default function AttributionPage() {
    const t = useTranslations("attribution");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();

    const [summary, setSummary] = useState<CtwaSummary | null>(null);
    const [ads, setAds] = useState<AdRow[]>([]);
    const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [rangeDays, setRangeDays] = useState(90);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        const end = new Date().toISOString();
        const start = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();
        const range = { start, end };
        try {
            const [s, a, b]: any[] = await Promise.all([
                api.getCtwaSummary(activeTenantId, range),
                api.getCtwaAds(activeTenantId, range),
                api.getBroadcastRevenue(activeTenantId, range),
            ]);
            if (s?.success) setSummary(s.data);
            if (a?.success) setAds(a.data || []);
            if (b?.success) setBroadcasts(b.data || []);
        } catch { /* noop */ }
        setLoading(false);
    }, [activeTenantId, rangeDays]);

    useEffect(() => { load(); }, [load]);

    const funnel = summary ? [
        { key: "clicks", icon: MousePointerClick, color: "#6366f1", value: summary.clicks },
        { key: "contacts", icon: Users, color: "#8b5cf6", value: summary.contacts },
        { key: "leads", icon: Target, color: "#f59e0b", value: summary.leads },
        { key: "won", icon: Trophy, color: "#22c55e", value: summary.won },
    ] : [];
    const funnelMax = Math.max(...funnel.map((f) => f.value), 1);

    return (
        <div className="space-y-6">
            <PageHeader icon={Megaphone} title={t("title")} subtitle={t("subtitle")}
                action={
                    <div className="flex gap-1 rounded-lg border border-border p-0.5">
                        {RANGES.map((r) => (
                            <button key={r.key} onClick={() => setRangeDays(r.days)}
                                className={cn("px-3 py-1 text-xs rounded-md", rangeDays === r.days ? "bg-accent text-white" : "text-muted-foreground hover:text-foreground")}>
                                {t(`range_${r.key}`)}
                            </button>
                        ))}
                    </div>
                }
            />
            <HelpPanel
                title={tHelp("attribution.title")}
                description={tHelp("attribution.description")}
                tips={tHelp.raw("attribution.tips") as string[]}
                mediaKey="attribution"
            />

            {loading && !summary ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : (
                <>
                    {/* KPIs */}
                    {summary && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Kpi icon={MousePointerClick} color="text-indigo-500" label={t("adClicks")} value={summary.clicks} sub={t("adsCount", { n: summary.ads })} />
                            <Kpi icon={Trophy} color="text-emerald-500" label={t("conversions")} value={summary.won} sub={`${summary.conversionRate}% ${t("convRate")}`} />
                            <Kpi icon={DollarSign} color="text-green-500" label={t("attributedRevenue")} value={fmtMoney(summary.revenue)} />
                            <Kpi icon={Target} color="text-amber-500" label={t("leadsGenerated")} value={summary.leads} />
                        </div>
                    )}

                    {/* Funnel */}
                    {summary && summary.clicks > 0 && (
                        <div className={cn(CARD, "p-5")}>
                            <h3 className="text-sm font-semibold text-foreground mb-4">{t("funnelTitle")}</h3>
                            <div className="space-y-2.5">
                                {funnel.map((f) => (
                                    <div key={f.key}>
                                        <div className="flex justify-between text-[13px] mb-1">
                                            <span className="text-text-secondary flex items-center gap-1.5"><f.icon size={13} style={{ color: f.color }} /> {t(`funnel_${f.key}`)}</span>
                                            <span className="text-foreground font-medium">{f.value}</span>
                                        </div>
                                        <div className="h-2.5 rounded-full bg-neutral-100 dark:bg-white/[0.06] overflow-hidden">
                                            <div className="h-full rounded-full" style={{ width: `${(f.value / funnelMax) * 100}%`, background: f.color }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Per-ad table */}
                    <div className={cn(CARD, "p-5")}>
                        <h3 className="text-sm font-semibold text-foreground mb-3">{t("byAd")}</h3>
                        {ads.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">{t("noAds")}</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-200 dark:border-white/10 text-left">
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium">{t("ad")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-center">{t("clicks")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-center">{t("won")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-center">{t("convRate")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-right">{t("revenue")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ads.map((a) => (
                                            <tr key={a.sourceId} className="border-b border-neutral-100 dark:border-white/5">
                                                <td className="py-2.5 px-3 max-w-[280px] truncate">
                                                    <span className="text-foreground">{a.headline || a.sourceId}</span>
                                                    {a.headline && <span className="block text-[11px] text-muted-foreground font-mono truncate">{a.sourceId}</span>}
                                                </td>
                                                <td className="py-2.5 px-3 text-center text-text-secondary">{a.clicks}</td>
                                                <td className="py-2.5 px-3 text-center text-text-secondary">{a.won}</td>
                                                <td className="py-2.5 px-3 text-center text-text-secondary">{a.conversionRate}%</td>
                                                <td className="py-2.5 px-3 text-right font-medium text-emerald-500">{fmtMoney(a.revenue)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Broadcast revenue */}
                    <div className={cn(CARD, "p-5")}>
                        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><Radio size={15} className="text-orange-500" /> {t("broadcastRevenue")}</h3>
                        {broadcasts.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">{t("noBroadcasts")}</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-200 dark:border-white/10 text-left">
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium">{t("campaign")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-center">{t("recipients")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-center">{t("won")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-right">{t("revenue")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {broadcasts.map((b) => (
                                            <tr key={b.campaignId} className="border-b border-neutral-100 dark:border-white/5">
                                                <td className="py-2.5 px-3 text-foreground">{b.campaignName}</td>
                                                <td className="py-2.5 px-3 text-center text-text-secondary">{b.recipients}</td>
                                                <td className="py-2.5 px-3 text-center text-text-secondary">{b.won}</td>
                                                <td className="py-2.5 px-3 text-right font-medium text-emerald-500">{fmtMoney(b.revenue)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function Kpi({ icon: Icon, color, label, value, sub }: { icon: any; color: string; label: string; value: string | number; sub?: string }) {
    return (
        <div className={cn(CARD, "p-4")}>
            <div className="flex items-center gap-2 mb-1.5"><Icon size={15} className={color} /><span className="text-xs text-muted-foreground">{label}</span></div>
            <div className="text-xl font-semibold text-foreground">{value}</div>
            {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
        </div>
    );
}
