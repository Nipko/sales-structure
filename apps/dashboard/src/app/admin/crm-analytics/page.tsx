"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { SkeletonPage } from "@/components/ui/skeleton-loader";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from "recharts";
import {
    TrendingUp, Target, Users, DollarSign, Activity, Clock,
    Award, BarChart3,
} from "lucide-react";

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6'];
const STAGE_COLORS: Record<string, string> = {
    nuevo: '#95a5a6', contactado: '#3498db', respondio: '#9b59b6', calificado: '#f39c12',
    tibio: '#e67e22', caliente: '#e74c3c', listo_cierre: '#27ae60', ganado: '#2ecc71',
    perdido: '#7f8c8d', no_interesado: '#bdc3c7',
};

export default function CrmAnalyticsPage() {
    const t = useTranslations("crmAnalytics");
    const { activeTenantId } = useTenant();
    const [activeTab, setActiveTab] = useState("overview");
    const [loading, setLoading] = useState(true);

    const [overview, setOverview] = useState<any>(null);
    const [funnel, setFunnel] = useState<any[]>([]);
    const [velocity, setVelocity] = useState<any[]>([]);
    const [winLoss, setWinLoss] = useState<any>(null);
    const [leaderboard, setLeaderboard] = useState<any[]>([]);
    const [sources, setSources] = useState<any[]>([]);

    useEffect(() => {
        if (!activeTenantId) return;
        setLoading(true);

        Promise.all([
            api.fetch(`/crm/analytics/${activeTenantId}/overview`),
            api.fetch(`/crm/analytics/${activeTenantId}/funnel`),
            api.fetch(`/crm/analytics/${activeTenantId}/velocity`),
            api.fetch(`/crm/analytics/${activeTenantId}/win-loss`),
            api.fetch(`/crm/analytics/${activeTenantId}/leaderboard`),
            api.fetch(`/crm/analytics/${activeTenantId}/sources`),
        ]).then(([ov, fn, vel, wl, lb, src]) => {
            setOverview(ov?.data);
            setFunnel(fn?.data || []);
            setVelocity(vel?.data || []);
            setWinLoss(wl?.data);
            setLeaderboard(lb?.data || []);
            setSources(src?.data || []);
        }).catch(err => console.error("CRM analytics load failed:", err))
          .finally(() => setLoading(false));
    }, [activeTenantId]);

    const tabs = [
        { id: "overview", label: t("tabs.overview"), icon: BarChart3 },
        { id: "funnel", label: t("tabs.funnel"), icon: Target },
        { id: "velocity", label: t("tabs.velocity"), icon: Clock },
        { id: "agents", label: t("tabs.agents"), icon: Award },
    ];

    if (loading) return <SkeletonPage />;

    return (
        <div className="space-y-6">
            <PageHeader title={t("title")} subtitle={t("subtitle")} />
            <TabNav tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

            {activeTab === "overview" && (
                <div className="space-y-6">
                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {[
                            { label: t("kpi.totalLeads"), value: overview?.totalLeads || 0, icon: Users, color: "#6366f1" },
                            { label: t("kpi.activeOpps"), value: overview?.activeOpportunities || 0, icon: Target, color: "#8b5cf6" },
                            { label: t("kpi.pipelineValue"), value: `$${(overview?.pipelineValue || 0).toLocaleString()}`, icon: DollarSign, color: "#22c55e" },
                            { label: t("kpi.avgScore"), value: `${overview?.avgScore || 0}/10`, icon: Activity, color: "#f97316" },
                            { label: t("kpi.convRate"), value: `${overview?.conversionRate || 0}%`, icon: TrendingUp, color: "#ec4899" },
                        ].map(kpi => (
                            <div key={kpi.label} className="bg-card border border-border rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${kpi.color}15` }}>
                                        <kpi.icon size={16} style={{ color: kpi.color }} />
                                    </div>
                                </div>
                                <div className="text-2xl font-semibold">{kpi.value}</div>
                                <div className="text-xs text-muted-foreground mt-0.5">{kpi.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Funnel + Sources side by side */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <div className="bg-card border border-border rounded-xl p-5">
                            <h3 className="text-sm font-semibold mb-4">{t("charts.leadsByStage")}</h3>
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={funnel} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                    <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                                    <YAxis dataKey="stage" type="category" width={100} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                                    <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                                        {funnel.map((entry: any, i: number) => (
                                            <Cell key={entry.stage} fill={STAGE_COLORS[entry.stage] || COLORS[i % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="bg-card border border-border rounded-xl p-5">
                            <h3 className="text-sm font-semibold mb-4">{t("charts.leadSources")}</h3>
                            {sources.length > 0 ? (
                                <ResponsiveContainer width="100%" height={280}>
                                    <PieChart>
                                        <Pie data={sources} dataKey="count" nameKey="source" cx="50%" cy="50%" outerRadius={100} label={({ source, percent }: any) => `${source} (${(percent * 100).toFixed(0)}%)`}>
                                            {sources.map((_: any, i: number) => (
                                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">{t("noData")}</div>
                            )}
                        </div>
                    </div>

                    {/* Win/Loss */}
                    {winLoss && (
                        <div className="bg-card border border-border rounded-xl p-5">
                            <h3 className="text-sm font-semibold mb-4">{t("charts.winLoss")}</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                <div className="text-center">
                                    <div className="text-2xl font-semibold text-emerald-500">{winLoss.won}</div>
                                    <div className="text-xs text-muted-foreground">{t("won")}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-2xl font-semibold text-red-500">{winLoss.lost}</div>
                                    <div className="text-xs text-muted-foreground">{t("lost")}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-2xl font-semibold text-primary">{winLoss.winRate}%</div>
                                    <div className="text-xs text-muted-foreground">{t("winRate")}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-2xl font-semibold text-emerald-500">${winLoss.totalValue.toLocaleString()}</div>
                                    <div className="text-xs text-muted-foreground">{t("totalValue")}</div>
                                </div>
                            </div>
                            {winLoss.lossReasons?.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">{t("lossReasons")}</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {winLoss.lossReasons.map((r: any) => (
                                            <span key={r.reason} className="text-xs px-2.5 py-1 rounded-full bg-red-500/10 text-red-500 font-medium">
                                                {r.reason} ({r.count})
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {activeTab === "funnel" && (
                <div className="bg-card border border-border rounded-xl p-5">
                    <h3 className="text-sm font-semibold mb-4">{t("charts.conversionFunnel")}</h3>
                    <div className="flex flex-col gap-2">
                        {funnel.map((stage: any, i: number) => (
                            <div key={stage.stage} className="flex items-center gap-3">
                                <div className="w-28 text-xs font-medium text-right truncate">{stage.stage}</div>
                                <div className="flex-1 h-8 bg-muted rounded-lg overflow-hidden relative">
                                    <div
                                        className="h-full rounded-lg transition-all duration-500"
                                        style={{
                                            width: `${Math.max(stage.percentage, 2)}%`,
                                            background: STAGE_COLORS[stage.stage] || COLORS[i],
                                        }}
                                    />
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold">
                                        {stage.count} ({stage.percentage}%)
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === "velocity" && (
                <div className="bg-card border border-border rounded-xl p-5">
                    <h3 className="text-sm font-semibold mb-4">{t("charts.pipelineVelocity")}</h3>
                    {velocity.length > 0 ? (
                        <ResponsiveContainer width="100%" height={350}>
                            <BarChart data={velocity}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                <XAxis dataKey="stage" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" label={{ value: t("days"), angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                                <Bar dataKey="avgDays" name={t("avgDays")} radius={[4, 4, 0, 0]}>
                                    {velocity.map((entry: any, i: number) => (
                                        <Cell key={entry.stage} fill={STAGE_COLORS[entry.stage] || COLORS[i]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-[350px] text-muted-foreground text-sm">{t("noData")}</div>
                    )}
                </div>
            )}

            {activeTab === "agents" && (
                <div className="bg-card border border-border rounded-xl p-5">
                    <h3 className="text-sm font-semibold mb-4">{t("charts.agentLeaderboard")}</h3>
                    {leaderboard.length > 0 ? (
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">#</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">{t("agent")}</th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">{t("dealsClosed")}</th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">{t("totalValue")}</th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">{t("avgDeal")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {leaderboard.map((agent: any, i: number) => (
                                    <tr key={agent.agentId} className="border-b border-border">
                                        <td className="px-4 py-3 text-sm">
                                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                                        </td>
                                        <td className="px-4 py-3 text-sm font-medium">{agent.agentName}</td>
                                        <td className="px-4 py-3 text-sm text-right font-semibold">{agent.dealsClosed}</td>
                                        <td className="px-4 py-3 text-sm text-right font-semibold text-emerald-500">
                                            ${agent.totalValue.toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                                            ${agent.avgValue.toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">{t("noData")}</div>
                    )}
                </div>
            )}
        </div>
    );
}
