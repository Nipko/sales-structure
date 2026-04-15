"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
    MessageSquare, MessagesSquare, Bot, Clock, Star, DollarSign,
    Shield, Brain, ArrowUpDown, Download, Loader2,
    Activity, Users, Zap, Radio, Send, CheckCircle, XCircle,
    Eye, MailX, AlertTriangle,
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

const TABS = ["overview", "aiBotTab", "automationTab", "broadcastTab", "channelsTab", "csatTab", "anomaliesTab", "cohortsTab"] as const;

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
    const [realtime, setRealtime] = useState<any>(null);
    const [automation, setAutomation] = useState<any>(null);
    const [broadcast, setBroadcast] = useState<any>(null);
    const [anomalies, setAnomalies] = useState<any>(null);
    const [cohorts, setCohorts] = useState<any>(null);

    const fetchData = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const [kpiRes, volRes, rtRes, aiRes, hmRes, autoRes, bcRes] = await Promise.all([
                api.getDashboardKPIs(tenantId, start, end),
                api.getDashboardVolume(tenantId, start, end),
                api.getDashboardResponseTimes(tenantId, start, end),
                api.getDashboardAIMetrics(tenantId, start, end),
                api.getDashboardHeatmap(tenantId, start, end),
                api.getDashboardAutomation(tenantId, start, end),
                api.getDashboardBroadcast(tenantId, start, end),
            ]);

            if (kpiRes.success) setKPIs(kpiRes.data.kpis || []);
            if (volRes.success) setVolume(volRes.data.series || []);
            if (rtRes.success) setResponseTimes(rtRes.data.series || []);
            if (aiRes.success) setAIMetrics(aiRes.data);
            if (hmRes.success) setHeatmap(hmRes.data.data || []);
            if (autoRes.success) setAutomation(autoRes.data);
            if (bcRes.success) setBroadcast(bcRes.data);

            // Phase 3 data
            const [anomRes, cohortRes] = await Promise.all([
                api.getDashboardAnomalies(tenantId),
                api.getDashboardCohorts(tenantId),
            ]);
            if (anomRes.success) setAnomalies(anomRes.data);
            if (cohortRes.success) setCohorts(cohortRes.data);
        } catch (err) {
            console.error("Failed to fetch analytics:", err);
        }
        setLoading(false);
    }, [tenantId, start, end]);

    // Real-time polling (every 30s)
    useEffect(() => {
        if (!tenantId) return;
        const fetchRealtime = async () => {
            const res = await api.getDashboardRealtime(tenantId);
            if (res.success) setRealtime(res.data);
        };
        fetchRealtime();
        const interval = setInterval(fetchRealtime, 30000);
        return () => clearInterval(interval);
    }, [tenantId]);

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

            {/* Real-time bar */}
            {realtime && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                    <RealtimeCard label={t("activeConversations")} value={realtime.activeConversations} icon={MessageSquare} color="text-indigo-400" />
                    <RealtimeCard label={t("agentsOnline")} value={realtime.agentsOnline} icon={Users} color="text-emerald-400" pulse />
                    <RealtimeCard label={t("agentsBusy")} value={realtime.agentsBusy} icon={Activity} color="text-amber-400" />
                    <RealtimeCard label={t("queueDepth")} value={realtime.queueDepth} icon={Clock} color={realtime.queueDepth > 0 ? "text-red-400" : "text-muted-foreground"} />
                    <RealtimeCard label={t("agentsOffline")} value={realtime.agentsOffline} icon={Users} color="text-muted-foreground" />
                    <RealtimeCard label={t("messagesToday")} value={realtime.messagesToday} icon={MessagesSquare} color="text-blue-400" />
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
                    <Loader2 size={20} className="animate-spin" /> {t("loading")}
                </div>
            ) : (
                <>
                    {activeTab === "overview" && <OverviewTab kpis={kpis} volume={volume} heatmap={heatmap} responseTimes={responseTimes} />}
                    {activeTab === "aiBotTab" && <AIBotTab data={aiMetrics} />}
                    {activeTab === "automationTab" && <AutomationTab data={automation} />}
                    {activeTab === "broadcastTab" && <BroadcastTab data={broadcast} />}
                    {activeTab === "channelsTab" && <ChannelsTab volume={volume} />}
                    {activeTab === "csatTab" && <CSATTab kpis={kpis} />}
                    {activeTab === "anomaliesTab" && <AnomaliesTab data={anomalies} />}
                    {activeTab === "cohortsTab" && <CohortsTab data={cohorts} />}
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

// ── Real-time Card ──

function RealtimeCard({ label, value, icon: Icon, color, pulse }: {
    label: string; value: number; icon: any; color: string; pulse?: boolean;
}) {
    return (
        <div className="px-4 py-3 rounded-lg bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] flex items-center gap-3">
            <div className={`${color} relative`}>
                <Icon size={18} />
                {pulse && value > 0 && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
            </div>
            <div>
                <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
                <p className="text-[11px] text-muted-foreground">{label}</p>
            </div>
        </div>
    );
}

// ── Tab: Automation ──

function AutomationTab({ data }: { data: any }) {
    const t = useTranslations("analyticsV2");

    if (!data) return <p className="text-muted-foreground py-10 text-center">{t("noData")}</p>;

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KPICard label={t("totalRules")} value={data.totalRules} changePercent={0} icon={Zap} iconColor="text-indigo-400" />
                <KPICard label={t("activeRules")} value={data.activeRules} changePercent={0} icon={Radio} iconColor="text-emerald-400" />
                <KPICard label={t("totalExecutions")} value={data.totalExecutions} changePercent={0} icon={Activity} iconColor="text-blue-400" />
                <KPICard label={t("successRate")} value={`${data.successRate}%`} changePercent={0} icon={CheckCircle} iconColor="text-emerald-400" />
            </div>

            {/* Executions by day chart */}
            {data.executionsByDay?.length > 0 && (
                <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                    <h3 className="text-sm font-semibold text-foreground mb-4">{t("executionsByDay")}</h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={data.executionsByDay}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9898b0" }} tickFormatter={(d: string) => d.slice(5)} />
                            <YAxis tick={{ fontSize: 11, fill: "#9898b0" }} />
                            <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar dataKey="success" fill="#00b894" name={t("success")} stackId="a" />
                            <Bar dataKey="failed" fill="#d63031" name={t("failed")} stackId="a" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Rule performance table */}
            {data.rulePerformance?.length > 0 && (
                <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                    <h3 className="text-sm font-semibold text-foreground mb-4">{t("rulePerformance")}</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 dark:border-white/10">
                                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t("rule")}</th>
                                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t("trigger")}</th>
                                    <th className="text-center py-2.5 px-3 text-muted-foreground font-medium">{t("status")}</th>
                                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("totalExecutions")}</th>
                                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("success")}</th>
                                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("failed")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rulePerformance.map((r: any, i: number) => (
                                    <tr key={i} className="border-b border-gray-100 dark:border-white/5">
                                        <td className="py-2.5 px-3 text-foreground font-medium">{r.name}</td>
                                        <td className="py-2.5 px-3 text-muted-foreground">{r.triggerType}</td>
                                        <td className="py-2.5 px-3 text-center">
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${r.active ? "bg-emerald-500/10 text-emerald-500" : "bg-gray-200 dark:bg-white/10 text-muted-foreground"}`}>
                                                {r.active ? t("active") : t("inactive")}
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-3 text-right text-foreground">{r.executions}</td>
                                        <td className="py-2.5 px-3 text-right text-emerald-500">{r.success}</td>
                                        <td className="py-2.5 px-3 text-right text-red-400">{r.failed}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Tab: Broadcast Funnel ──

function BroadcastTab({ data }: { data: any }) {
    const t = useTranslations("analyticsV2");

    if (!data || !data.campaigns?.length) return <p className="text-muted-foreground py-10 text-center">{t("noData")}</p>;

    const { totals } = data;

    // Funnel data for chart
    const funnelData = [
        { stage: t("total"), value: totals.total, color: "#6c5ce7" },
        { stage: t("sent"), value: totals.sent, color: "#0984e3" },
        { stage: t("delivered"), value: totals.delivered, color: "#00cec9" },
        { stage: t("read"), value: totals.read, color: "#00b894" },
    ];

    return (
        <div className="space-y-6">
            {/* Funnel summary */}
            <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                <h3 className="text-sm font-semibold text-foreground mb-4">{t("broadcastFunnel")}</h3>
                <div className="space-y-3">
                    {funnelData.map((item, i) => {
                        const pct = totals.total > 0 ? (item.value / totals.total) * 100 : 0;
                        return (
                            <div key={i} className="flex items-center gap-4">
                                <span className="w-24 text-[13px] text-muted-foreground shrink-0">{item.stage}</span>
                                <div className="flex-1 h-8 rounded-lg bg-gray-100 dark:bg-white/[0.04] overflow-hidden">
                                    <div
                                        className="h-full rounded-lg flex items-center px-3 text-white text-[12px] font-medium transition-all"
                                        style={{ width: `${Math.max(pct, 2)}%`, background: item.color }}
                                    >
                                        {item.value}
                                    </div>
                                </div>
                                <span className="text-[13px] text-muted-foreground w-14 text-right">{Math.round(pct)}%</span>
                            </div>
                        );
                    })}
                    {totals.failed > 0 && (
                        <div className="flex items-center gap-4">
                            <span className="w-24 text-[13px] text-red-400 shrink-0">{t("failed")}</span>
                            <div className="flex-1 h-8 rounded-lg bg-gray-100 dark:bg-white/[0.04] overflow-hidden">
                                <div
                                    className="h-full rounded-lg flex items-center px-3 text-white text-[12px] font-medium"
                                    style={{ width: `${Math.max((totals.failed / totals.total) * 100, 2)}%`, background: "#d63031" }}
                                >
                                    {totals.failed}
                                </div>
                            </div>
                            <span className="text-[13px] text-muted-foreground w-14 text-right">{Math.round((totals.failed / totals.total) * 100)}%</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Per-campaign table */}
            <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                <h3 className="text-sm font-semibold text-foreground mb-4">{t("campaign")}</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-white/10">
                                <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t("campaign")}</th>
                                <th className="text-center py-2.5 px-3 text-muted-foreground font-medium">{t("channel")}</th>
                                <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("total")}</th>
                                <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("sent")}</th>
                                <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("delivered")}</th>
                                <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("read")}</th>
                                <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("failed")}</th>
                                <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("deliveryRate")}</th>
                                <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("readRate")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.campaigns.map((c: any) => (
                                <tr key={c.id} className="border-b border-gray-100 dark:border-white/5">
                                    <td className="py-2.5 px-3 text-foreground font-medium">{c.name}</td>
                                    <td className="py-2.5 px-3 text-center">
                                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${CHANNEL_COLORS[c.channel] || "#6c5ce7"}20`, color: CHANNEL_COLORS[c.channel] || "#6c5ce7" }}>
                                            {c.channel}
                                        </span>
                                    </td>
                                    <td className="py-2.5 px-3 text-right text-foreground">{c.total}</td>
                                    <td className="py-2.5 px-3 text-right text-blue-400">{c.sent}</td>
                                    <td className="py-2.5 px-3 text-right text-cyan-400">{c.delivered}</td>
                                    <td className="py-2.5 px-3 text-right text-emerald-400">{c.read}</td>
                                    <td className="py-2.5 px-3 text-right text-red-400">{c.failed}</td>
                                    <td className="py-2.5 px-3 text-right text-foreground">{c.deliveryRate}%</td>
                                    <td className="py-2.5 px-3 text-right text-foreground">{c.readRate}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// ── Tab: Anomalies ──

function AnomaliesTab({ data }: { data: any }) {
    const t = useTranslations("analyticsV2");

    if (!data) return <p className="text-muted-foreground py-10 text-center">{t("noData")}</p>;

    const anomalies = data.anomalies || [];

    if (anomalies.length === 0) {
        return (
            <div className="p-8 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-center">
                <CheckCircle size={40} className="mx-auto text-emerald-400 mb-3" />
                <p className="text-foreground font-medium">{t("noAnomalies")}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-400" />
                    {t("anomaliesDetected")} ({anomalies.length})
                </h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-white/10">
                                <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t("metric")}</th>
                                <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t("date")}</th>
                                <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("value")}</th>
                                <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("average")}</th>
                                <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("deviation")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {anomalies.map((a: any, i: number) => (
                                <tr key={i} className="border-b border-gray-100 dark:border-white/5">
                                    <td className="py-2.5 px-3 text-foreground font-medium capitalize">{a.metric}</td>
                                    <td className="py-2.5 px-3 text-muted-foreground">{a.date}</td>
                                    <td className="py-2.5 px-3 text-right">
                                        <span className={`font-bold ${a.value > a.avg ? "text-red-400" : "text-blue-400"}`}>{a.value}</span>
                                    </td>
                                    <td className="py-2.5 px-3 text-right text-muted-foreground">{a.avg}</td>
                                    <td className="py-2.5 px-3 text-right">
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
                                            {a.zScore}σ
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// ── Tab: Cohorts ──

function CohortsTab({ data }: { data: any }) {
    const t = useTranslations("analyticsV2");

    if (!data || !data.cohorts?.length) return <p className="text-muted-foreground py-10 text-center">{t("noData")}</p>;

    const cohorts = data.cohorts;
    const maxMonths = Math.max(...cohorts.map((c: any) => c.retention.length));

    const getColor = (pct: number) => {
        if (pct >= 80) return "bg-emerald-500/70 text-white";
        if (pct >= 60) return "bg-emerald-500/50 text-white";
        if (pct >= 40) return "bg-emerald-500/30 text-emerald-100";
        if (pct >= 20) return "bg-emerald-500/15 text-emerald-300";
        if (pct > 0) return "bg-emerald-500/5 text-emerald-400";
        return "bg-transparent text-muted-foreground";
    };

    return (
        <div className="space-y-6">
            <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                <h3 className="text-sm font-semibold text-foreground mb-4">{t("cohortRetention")}</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-white/10">
                                <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t("cohortMonth")}</th>
                                <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t("cohortSize")}</th>
                                {Array.from({ length: maxMonths }, (_, i) => (
                                    <th key={i} className="text-center py-2.5 px-2 text-muted-foreground font-medium text-[11px]">
                                        {t("month")} {i}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {cohorts.map((cohort: any) => (
                                <tr key={cohort.month} className="border-b border-gray-100 dark:border-white/5">
                                    <td className="py-2.5 px-3 text-foreground font-medium">{cohort.month}</td>
                                    <td className="py-2.5 px-3 text-right text-muted-foreground">{cohort.size}</td>
                                    {Array.from({ length: maxMonths }, (_, i) => (
                                        <td key={i} className="py-1.5 px-1 text-center">
                                            {i < cohort.retention.length ? (
                                                <span className={`inline-block w-full py-1.5 rounded text-[11px] font-medium ${getColor(cohort.retention[i])}`}>
                                                    {cohort.retention[i]}%
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground/30">—</span>
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
