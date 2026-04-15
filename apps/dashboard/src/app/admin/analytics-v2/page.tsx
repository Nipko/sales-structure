"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
    MessageSquare, MessagesSquare, Bot, Clock, Star, DollarSign,
    Shield, Brain, ArrowUpDown, Download, Loader2,
} from "lucide-react";
import {
    BarChart, Bar, AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import KPICard from "@/components/analytics/KPICard";
import DateRangePicker from "@/components/analytics/DateRangePicker";
import Heatmap from "@/components/analytics/Heatmap";

// ── Helpers ──

function daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
}

function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

const CHANNEL_COLORS: Record<string, string> = {
    whatsapp: "#25D366",
    instagram: "#E4405F",
    messenger: "#0084FF",
    telegram: "#0088CC",
};

const MODEL_COLORS = ["#6c5ce7", "#00cec9", "#fdcb6e", "#e17055", "#0984e3", "#d63031", "#00b894"];

const TABS = ["overview", "aiBotTab", "agentsTab", "channelsTab", "csatTab", "crmTab"] as const;

// ── Main Page ──

export default function AnalyticsV2Page() {
    const t = useTranslations("analyticsV2");
    const { user } = useAuth();
    const tenantId = user?.tenantId;

    const [activeTab, setActiveTab] = useState<string>("overview");
    const [start, setStart] = useState(daysAgo(30));
    const [end, setEnd] = useState(new Date().toISOString().split("T")[0]);
    const [loading, setLoading] = useState(true);

    // Data
    const [kpis, setKPIs] = useState<any[]>([]);
    const [volume, setVolume] = useState<any[]>([]);
    const [responseTimes, setResponseTimes] = useState<any[]>([]);
    const [aiMetrics, setAIMetrics] = useState<any>(null);
    const [heatmap, setHeatmap] = useState<any[]>([]);

    const fetchData = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const [kpiRes, volRes, rtRes, aiRes, hmRes] = await Promise.all([
                api.getDashboardKPIs(tenantId, start, end),
                api.getDashboardVolume(tenantId, start, end),
                api.getDashboardResponseTimes(tenantId, start, end),
                api.getDashboardAIMetrics(tenantId, start, end),
                api.getDashboardHeatmap(tenantId, start, end),
            ]);

            if (kpiRes.success) setKPIs(kpiRes.data.kpis || []);
            if (volRes.success) setVolume(volRes.data.series || []);
            if (rtRes.success) setResponseTimes(rtRes.data.series || []);
            if (aiRes.success) setAIMetrics(aiRes.data);
            if (hmRes.success) setHeatmap(hmRes.data.data || []);
        } catch (err) {
            console.error("Failed to fetch analytics:", err);
        }
        setLoading(false);
    }, [tenantId, start, end]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleDateChange = (s: string, e: string) => {
        setStart(s);
        setEnd(e);
    };

    const handleExportCSV = async () => {
        if (!tenantId) return;
        const blob = await api.exportDashboardCSV(tenantId, start, end);
        if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `parallly-analytics-${start}-${end}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    const getKPI = (key: string) => kpis.find((k: any) => k.key === key) || { value: 0, changePercent: 0 };

    return (
        <div className="p-6 max-w-[1400px] mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
                <div className="flex items-center gap-3 flex-wrap">
                    <DateRangePicker start={start} end={end} onChange={handleDateChange} />
                    <button
                        onClick={handleExportCSV}
                        className="px-3 py-1.5 rounded-lg text-[13px] font-medium border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                    >
                        <Download size={14} /> {t("exportCSV")}
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-white/10 overflow-x-auto">
                {TABS.map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                            activeTab === tab
                                ? "border-indigo-500 text-indigo-500"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {t(tab)}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
                    <Loader2 size={20} className="animate-spin" /> {t("loading")}
                </div>
            ) : (
                <>
                    {activeTab === "overview" && <OverviewTab kpis={kpis} volume={volume} heatmap={heatmap} responseTimes={responseTimes} />}
                    {activeTab === "aiBotTab" && <AIBotTab data={aiMetrics} />}
                    {activeTab === "channelsTab" && <ChannelsTab volume={volume} />}
                    {activeTab === "csatTab" && <CSATTab kpis={kpis} />}
                </>
            )}
        </div>
    );
}

// ── Tab: Overview ──

function OverviewTab({ kpis, volume, heatmap, responseTimes }: any) {
    const t = useTranslations("analyticsV2");
    const getKPI = (key: string) => kpis.find((k: any) => k.key === key) || { value: 0, changePercent: 0 };

    const convKPI = getKPI("conversations");
    const msgKPI = getKPI("messages");
    const aiKPI = getKPI("aiResolutionRate");
    const rtKPI = getKPI("avgResponseTime");
    const csatKPI = getKPI("csatAvg");
    const costKPI = getKPI("llmCost");

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <KPICard label={t("conversations")} value={convKPI.value} changePercent={convKPI.changePercent} icon={MessageSquare} iconColor="text-indigo-400" />
                <KPICard label={t("messages")} value={msgKPI.value} changePercent={msgKPI.changePercent} icon={MessagesSquare} iconColor="text-blue-400" />
                <KPICard label={t("aiResolutionRate")} value={`${aiKPI.value}%`} changePercent={aiKPI.changePercent} icon={Bot} iconColor="text-emerald-400" />
                <KPICard label={t("avgResponseTime")} value={formatTime(rtKPI.value)} changePercent={rtKPI.changePercent} icon={Clock} iconColor="text-amber-400" invertTrend />
                <KPICard label={t("csatAvg")} value={csatKPI.value} unit="/5" changePercent={csatKPI.changePercent} icon={Star} iconColor="text-yellow-400" />
                <KPICard label={t("llmCost")} value={`$${costKPI.value}`} changePercent={costKPI.changePercent} icon={DollarSign} iconColor="text-red-400" invertTrend />
            </div>

            {/* Volume by Channel */}
            <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                <h3 className="text-sm font-semibold text-foreground mb-4">{t("volumeByChannel")}</h3>
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={volume}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9898b0" }} tickFormatter={d => d.slice(5)} />
                        <YAxis tick={{ fontSize: 11, fill: "#9898b0" }} />
                        <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                        <Legend />
                        <Bar dataKey="whatsapp" stackId="a" fill={CHANNEL_COLORS.whatsapp} name="WhatsApp" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="instagram" stackId="a" fill={CHANNEL_COLORS.instagram} name="Instagram" />
                        <Bar dataKey="messenger" stackId="a" fill={CHANNEL_COLORS.messenger} name="Messenger" />
                        <Bar dataKey="telegram" stackId="a" fill={CHANNEL_COLORS.telegram} name="Telegram" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Response Times */}
            {responseTimes.length > 0 && (
                <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                    <h3 className="text-sm font-semibold text-foreground mb-4">{t("responseTimes")}</h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={responseTimes}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9898b0" }} tickFormatter={d => d.slice(5)} />
                            <YAxis tick={{ fontSize: 11, fill: "#9898b0" }} tickFormatter={v => formatTime(v)} />
                            <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => formatTime(v)} />
                            <Legend />
                            <Line type="monotone" dataKey="medianResponse" stroke="#6c5ce7" name={`${t("median")} ${t("response")}`} strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="p90Response" stroke="#6c5ce7" name={`${t("p90")} ${t("response")}`} strokeWidth={1} strokeDasharray="5 5" dot={false} />
                            <Line type="monotone" dataKey="medianResolution" stroke="#00cec9" name={`${t("median")} ${t("resolution")}`} strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="p90Resolution" stroke="#00cec9" name={`${t("p90")} ${t("resolution")}`} strokeWidth={1} strokeDasharray="5 5" dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Heatmap */}
            <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                <h3 className="text-sm font-semibold text-foreground mb-4">{t("peakHours")}</h3>
                <Heatmap data={heatmap} />
            </div>
        </div>
    );
}

// ── Tab: AI & Bot ──

function AIBotTab({ data }: { data: any }) {
    const t = useTranslations("analyticsV2");

    if (!data) return <p className="text-muted-foreground py-10 text-center">{t("noData")}</p>;

    return (
        <div className="space-y-6">
            {/* AI KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <KPICard label={t("aiResolutionRate")} value={`${data.resolutionRate}%`} changePercent={0} icon={Bot} iconColor="text-emerald-400" />
                <KPICard label={t("containmentRate")} value={`${data.containmentRate}%`} changePercent={0} icon={Shield} iconColor="text-blue-400" />
                <KPICard label={t("totalConversations")} value={data.totalConversations} changePercent={0} icon={MessageSquare} iconColor="text-indigo-400" />
                <KPICard label={t("aiResolved")} value={data.aiResolved} changePercent={0} icon={Brain} iconColor="text-emerald-400" />
                <KPICard label={t("handoffs")} value={data.handoffs} changePercent={0} icon={ArrowUpDown} iconColor="text-amber-400" />
                <KPICard label={t("totalCost")} value={`$${data.totalCost}`} changePercent={0} icon={DollarSign} iconColor="text-red-400" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Model Usage Pie */}
                {data.modelUsage?.length > 0 && (
                    <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                        <h3 className="text-sm font-semibold text-foreground mb-4">{t("modelUsage")}</h3>
                        <ResponsiveContainer width="100%" height={250}>
                            <PieChart>
                                <Pie data={data.modelUsage} dataKey="requests" nameKey="model" cx="50%" cy="50%" outerRadius={90} label={({ model, percent }: any) => `${model} ${(percent * 100).toFixed(0)}%`}>
                                    {data.modelUsage.map((_: any, i: number) => (
                                        <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                            </PieChart>
                        </ResponsiveContainer>
                        {/* Table */}
                        <div className="mt-4 space-y-2">
                            {data.modelUsage.map((m: any, i: number) => (
                                <div key={m.model} className="flex items-center justify-between text-[13px]">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                                        <span className="text-foreground">{m.model}</span>
                                    </div>
                                    <div className="flex items-center gap-4 text-muted-foreground">
                                        <span>{m.requests} {t("requests")}</span>
                                        <span>${m.cost}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Handoff Reasons */}
                {data.handoffReasons?.length > 0 && (
                    <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                        <h3 className="text-sm font-semibold text-foreground mb-4">{t("handoffReasons")}</h3>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={data.handoffReasons} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis type="number" tick={{ fontSize: 11, fill: "#9898b0" }} />
                                <YAxis dataKey="reason" type="category" tick={{ fontSize: 11, fill: "#9898b0" }} width={120} />
                                <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                                <Bar dataKey="count" fill="#6c5ce7" radius={[0, 6, 6, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Tab: Channels ──

function ChannelsTab({ volume }: { volume: any[] }) {
    const t = useTranslations("analyticsV2");

    // Aggregate per channel
    const totals: Record<string, number> = { whatsapp: 0, instagram: 0, messenger: 0, telegram: 0 };
    for (const row of volume) {
        totals.whatsapp += row.whatsapp || 0;
        totals.instagram += row.instagram || 0;
        totals.messenger += row.messenger || 0;
        totals.telegram += row.telegram || 0;
    }
    const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0) || 1;

    const channels = Object.entries(totals)
        .map(([ch, count]) => ({ channel: ch, count, pct: Math.round((count / grandTotal) * 1000) / 10 }))
        .sort((a, b) => b.count - a.count);

    return (
        <div className="space-y-6">
            {/* Channel cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {channels.map(ch => (
                    <div key={ch.channel} className="p-5 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ background: CHANNEL_COLORS[ch.channel] }}>
                                {ch.channel[0].toUpperCase()}
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-foreground">{t(ch.channel as any)}</p>
                                <p className="text-[12px] text-muted-foreground">{ch.pct}% del total</p>
                            </div>
                        </div>
                        <p className="text-2xl font-bold text-foreground">{ch.count}</p>
                        <div className="mt-3 h-2 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${ch.pct}%`, background: CHANNEL_COLORS[ch.channel] }} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Channel volume over time */}
            <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                <h3 className="text-sm font-semibold text-foreground mb-4">{t("volumeByChannel")}</h3>
                <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={volume}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9898b0" }} tickFormatter={d => d.slice(5)} />
                        <YAxis tick={{ fontSize: 11, fill: "#9898b0" }} />
                        <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                        <Legend />
                        <Area type="monotone" dataKey="whatsapp" stackId="1" fill={CHANNEL_COLORS.whatsapp} stroke={CHANNEL_COLORS.whatsapp} fillOpacity={0.6} name="WhatsApp" />
                        <Area type="monotone" dataKey="instagram" stackId="1" fill={CHANNEL_COLORS.instagram} stroke={CHANNEL_COLORS.instagram} fillOpacity={0.6} name="Instagram" />
                        <Area type="monotone" dataKey="messenger" stackId="1" fill={CHANNEL_COLORS.messenger} stroke={CHANNEL_COLORS.messenger} fillOpacity={0.6} name="Messenger" />
                        <Area type="monotone" dataKey="telegram" stackId="1" fill={CHANNEL_COLORS.telegram} stroke={CHANNEL_COLORS.telegram} fillOpacity={0.6} name="Telegram" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// ── Tab: CSAT ──

function CSATTab({ kpis }: { kpis: any[] }) {
    const t = useTranslations("analyticsV2");
    const csatKPI = kpis.find((k: any) => k.key === "csatAvg") || { value: 0, changePercent: 0 };

    const scoreColor = csatKPI.value >= 4 ? "text-emerald-500" : csatKPI.value >= 3 ? "text-amber-400" : "text-red-400";

    return (
        <div className="space-y-6">
            <div className="p-8 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-center">
                <p className="text-sm text-muted-foreground mb-2">{t("csatAvg")}</p>
                <p className={`text-6xl font-bold ${scoreColor}`}>{csatKPI.value}</p>
                <p className="text-muted-foreground text-sm mt-1">/ 5</p>
                <div className="flex items-center justify-center gap-1 mt-3">
                    {[1, 2, 3, 4, 5].map(star => (
                        <Star
                            key={star}
                            size={24}
                            className={star <= Math.round(csatKPI.value) ? "text-yellow-400 fill-yellow-400" : "text-gray-300 dark:text-white/20"}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
