"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    BarChart3, Plus, Star, Trash2, Edit3, Save, X, Loader2,
    Eye, Copy, ChevronDown, FileText,
} from "lucide-react";
import {
    BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import DateRangePicker from "@/components/analytics/DateRangePicker";
import { HelpPanel } from "@/components/ui/help-panel";

type SavedReport = {
    id: string;
    name: string;
    description: string | null;
    config: ReportConfig;
    is_favorite: boolean;
    created_at: string;
    updated_at: string;
};

type ChartType = "bar" | "line" | "area" | "pie";

type ReportConfig = {
    metrics: string[];
    chartType: ChartType;
    dateRange?: { start: string; end: string };
    groupBy?: string;
};

const METRIC_OPTIONS = [
    { key: "conversations", group: "conversations" },
    { key: "messages", group: "conversations" },
    { key: "handoffs", group: "conversations" },
    { key: "aiResolutionRate", group: "ai" },
    { key: "containmentRate", group: "ai" },
    { key: "llmCost", group: "ai" },
    { key: "responseTime", group: "performance" },
    { key: "resolutionTime", group: "performance" },
    { key: "totalLeads", group: "crm" },
    { key: "hotLeads", group: "crm" },
    { key: "conversionRate", group: "crm" },
    { key: "pipelineValue", group: "crm" },
    { key: "appointments", group: "operations" },
    { key: "noShows", group: "operations" },
    { key: "campaignsSent", group: "operations" },
    { key: "csatScore", group: "operations" },
];

const CHART_TYPES: { value: ChartType; icon: string }[] = [
    { value: "bar", icon: "Bar" },
    { value: "line", icon: "Line" },
    { value: "area", icon: "Area" },
    { value: "pie", icon: "Pie" },
];

const CHART_COLORS = ["#6c5ce7", "#00cec9", "#fdcb6e", "#e17055", "#0984e3", "#00b894", "#d63031", "#e84393"];

function daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
}

function ChartPreview({ config, data }: { config: ReportConfig; data: any[] }) {
    if (!data.length || !config.metrics.length) {
        return (
            <div className="h-[300px] flex items-center justify-center text-[var(--text-secondary)] text-sm">
                <FileText size={20} className="mr-2 opacity-50" />
                Sin datos para mostrar
            </div>
        );
    }

    if (config.chartType === "pie") {
        const pieData = config.metrics.map((m, i) => ({
            name: m,
            value: data.reduce((sum, d) => sum + (Number(d[m]) || 0), 0),
            fill: CHART_COLORS[i % CHART_COLORS.length],
        }));
        return (
            <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                        {pieData.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                        ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid #2a2a45", borderRadius: 8, color: "#e8e8f0" }} />
                </PieChart>
            </ResponsiveContainer>
        );
    }

    const Chart = config.chartType === "area" ? AreaChart : config.chartType === "line" ? LineChart : BarChart;
    const DataComponent = config.chartType === "area" ? Area : config.chartType === "line" ? Line : Bar;

    return (
        <ResponsiveContainer width="100%" height={300}>
            <Chart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" />
                <XAxis dataKey="label" tick={{ fill: "#9898b0", fontSize: 11 }} />
                <YAxis tick={{ fill: "#9898b0", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid #2a2a45", borderRadius: 8, color: "#e8e8f0" }} />
                {config.metrics.map((m, i) => (
                    <DataComponent
                        key={m}
                        type="monotone"
                        dataKey={m}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        fillOpacity={config.chartType === "area" ? 0.3 : 1}
                    />
                ))}
            </Chart>
        </ResponsiveContainer>
    );
}

export default function ReportBuilderPage() {
    const t = useTranslations("reportBuilder");
    const tHelp = useTranslations("help");
    const { user } = useAuth();
    const tenantId = user?.tenantId;

    const [reports, setReports] = useState<SavedReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [activeReport, setActiveReport] = useState<SavedReport | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [showBuilder, setShowBuilder] = useState(false);

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [config, setConfig] = useState<ReportConfig>({
        metrics: ["conversations"],
        chartType: "bar",
        dateRange: { start: daysAgo(30), end: daysAgo(0) },
    });

    const [previewData, setPreviewData] = useState<any[]>([]);
    const [loadingPreview, setLoadingPreview] = useState(false);

    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const loadReports = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const res = await api.listSavedReports(tenantId);
            setReports(res?.data || []);
        } catch {
            setReports([]);
        } finally {
            setLoading(false);
        }
    }, [tenantId]);

    useEffect(() => { loadReports(); }, [loadReports]);

    const loadPreview = useCallback(async () => {
        if (!tenantId || !config.metrics.length) return;
        setLoadingPreview(true);
        try {
            const start = config.dateRange?.start || daysAgo(30);
            const end = config.dateRange?.end || daysAgo(0);

            const results: any[] = [];

            const kpiRes = await api.fetch(
                `/dashboard-analytics/overview-kpis/${tenantId}?start=${start}&end=${end}`
            );

            if (kpiRes?.data?.kpis) {
                const kpis = kpiRes.data.kpis as Array<{ key: string; value: number }>;
                const row: Record<string, any> = { label: t("currentPeriod") };
                kpis.forEach(k => { row[k.key] = k.value; });
                config.metrics.forEach(m => {
                    if (row[m] === undefined) row[m] = 0;
                });
                results.push(row);
            }

            const volumeRes = await api.fetch(
                `/dashboard-analytics/conversations-volume/${tenantId}?start=${start}&end=${end}`
            );
            if (volumeRes?.data?.series?.length) {
                const series = volumeRes.data.series as any[];
                series.forEach((pt: any) => {
                    const row: Record<string, any> = {
                        label: pt.date?.substring(5) || pt.date,
                        conversations: (pt.whatsapp || 0) + (pt.instagram || 0) + (pt.messenger || 0) + (pt.telegram || 0),
                        messages: pt.totalMessages || 0,
                    };
                    results.push(row);
                });
            }

            setPreviewData(results.length > 1 ? results.slice(1) : results);
        } catch {
            setPreviewData([]);
        } finally {
            setLoadingPreview(false);
        }
    }, [tenantId, config.metrics, config.dateRange, t]);

    useEffect(() => {
        if (showBuilder) loadPreview();
    }, [showBuilder, loadPreview]);

    const handleSave = async () => {
        if (!tenantId || !name.trim()) return;
        setSaving(true);
        try {
            if (activeReport && editMode) {
                await api.updateSavedReport(tenantId, activeReport.id, { name, description, config });
                setMessage({ type: "success", text: t("saveSuccess") });
            } else {
                await api.createSavedReport(tenantId, { name, description, config });
                setMessage({ type: "success", text: t("createSuccess") });
            }
            setShowBuilder(false);
            setEditMode(false);
            setActiveReport(null);
            await loadReports();
        } catch (e: any) {
            setMessage({ type: "error", text: e?.message || t("saveError") });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!tenantId) return;
        try {
            await api.deleteSavedReport(tenantId, id);
            setMessage({ type: "success", text: t("deleteSuccess") });
            await loadReports();
        } catch (e: any) {
            setMessage({ type: "error", text: e?.message || t("deleteError") });
        }
    };

    const handleToggleFavorite = async (report: SavedReport) => {
        if (!tenantId) return;
        await api.updateSavedReport(tenantId, report.id, { isFavorite: !report.is_favorite });
        await loadReports();
    };

    const handleDuplicate = async (report: SavedReport) => {
        if (!tenantId) return;
        await api.createSavedReport(tenantId, {
            name: `${report.name} (${t("copy")})`,
            description: report.description || undefined,
            config: report.config,
        });
        await loadReports();
    };

    const openBuilder = (report?: SavedReport) => {
        if (report) {
            setActiveReport(report);
            setEditMode(true);
            setName(report.name);
            setDescription(report.description || "");
            setConfig(report.config);
        } else {
            setActiveReport(null);
            setEditMode(false);
            setName("");
            setDescription("");
            setConfig({ metrics: ["conversations"], chartType: "bar", dateRange: { start: daysAgo(30), end: daysAgo(0) } });
        }
        setShowBuilder(true);
    };

    const toggleMetric = (key: string) => {
        setConfig(c => ({
            ...c,
            metrics: c.metrics.includes(key)
                ? c.metrics.filter(m => m !== key)
                : [...c.metrics, key],
        }));
    };

    const metricGroups = useMemo(() => {
        const groups: Record<string, typeof METRIC_OPTIONS> = {};
        METRIC_OPTIONS.forEach(m => {
            if (!groups[m.group]) groups[m.group] = [];
            groups[m.group].push(m);
        });
        return groups;
    }, []);

    return (
        <div className="mx-auto max-w-[1200px]">
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-[10px] flex items-center justify-center bg-primary/10">
                            <BarChart3 size={20} className="text-primary" />
                        </div>
                        <h1 className="text-[28px] font-semibold m-0">{t("title")}</h1>
                    </div>
                    <p className="text-[var(--text-secondary)] mt-1 text-sm">{t("subtitle")}</p>
                </div>
                <button
                    onClick={() => openBuilder()}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary text-white text-[13px] font-medium"
                >
                    <Plus size={14} />
                    {t("newReport")}
                </button>
            </div>

            <HelpPanel
                title={tHelp("reportBuilder.title")}
                description={tHelp("reportBuilder.description")}
                tips={tHelp.raw("reportBuilder.tips") as string[]}
                mediaKey="reportBuilder"
            />

            {/* Toast */}
            {message && (
                <div
                    className={cn(
                        "p-4 rounded-xl mb-4 text-sm border",
                        message.type === "error"
                            ? "bg-[rgba(231,76,60,0.1)] text-[#e74c3c] border-[rgba(231,76,60,0.2)]"
                            : "bg-[rgba(46,204,113,0.1)] text-[#2ecc71] border-[rgba(46,204,113,0.2)]"
                    )}
                    onClick={() => setMessage(null)}
                >
                    {message.text}
                </div>
            )}

            {/* Report Builder Modal */}
            {showBuilder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowBuilder(false)}>
                    <div className="w-full max-w-[1000px] max-h-[90vh] bg-[var(--bg-secondary)] rounded-2xl border border-border overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                        {/* Modal header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                            <h2 className="text-lg font-semibold">{editMode ? t("editReport") : t("newReport")}</h2>
                            <button onClick={() => setShowBuilder(false)} className="p-1 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"><X size={18} /></button>
                        </div>

                        {/* Modal body */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-5">
                            {/* Name + Description */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-[var(--text-secondary)] mb-1 block">{t("reportName")}</label>
                                    <input
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        className="w-full bg-[var(--bg-tertiary)] border border-border rounded-lg px-3 py-2 text-sm"
                                        placeholder={t("reportNamePlaceholder")}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-[var(--text-secondary)] mb-1 block">{t("reportDescription")}</label>
                                    <input
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        className="w-full bg-[var(--bg-tertiary)] border border-border rounded-lg px-3 py-2 text-sm"
                                        placeholder={t("reportDescPlaceholder")}
                                    />
                                </div>
                            </div>

                            {/* Chart type selector */}
                            <div>
                                <label className="text-xs text-[var(--text-secondary)] mb-2 block">{t("chartType")}</label>
                                <div className="flex gap-2">
                                    {CHART_TYPES.map(ct => (
                                        <button
                                            key={ct.value}
                                            onClick={() => setConfig(c => ({ ...c, chartType: ct.value }))}
                                            className={cn(
                                                "px-4 py-2 rounded-lg border text-sm font-medium transition-colors",
                                                config.chartType === ct.value
                                                    ? "border-primary bg-primary/10 text-primary"
                                                    : "border-border bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:border-[var(--border)]"
                                            )}
                                        >
                                            {t(`chartType_${ct.value}`)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Metric selector */}
                            <div>
                                <label className="text-xs text-[var(--text-secondary)] mb-2 block">{t("selectMetrics")}</label>
                                <div className="space-y-3">
                                    {Object.entries(metricGroups).map(([group, metrics]) => (
                                        <div key={group}>
                                            <p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">{t(`metricGroup_${group}`)}</p>
                                            <div className="flex flex-wrap gap-2">
                                                {metrics.map(m => (
                                                    <button
                                                        key={m.key}
                                                        onClick={() => toggleMetric(m.key)}
                                                        className={cn(
                                                            "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                                                            config.metrics.includes(m.key)
                                                                ? "border-primary bg-primary/15 text-primary"
                                                                : "border-border text-[var(--text-secondary)] hover:border-[var(--border)]"
                                                        )}
                                                    >
                                                        {t(`metric_${m.key}`)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Date range */}
                            <div>
                                <label className="text-xs text-[var(--text-secondary)] mb-2 block">{t("dateRange")}</label>
                                <div className="flex gap-3">
                                    <input
                                        type="date"
                                        value={config.dateRange?.start || ""}
                                        onChange={e => setConfig(c => ({ ...c, dateRange: { start: e.target.value, end: c.dateRange?.end || daysAgo(0) } }))}
                                        className="bg-[var(--bg-tertiary)] border border-border rounded-lg px-3 py-2 text-sm"
                                    />
                                    <span className="text-[var(--text-secondary)] self-center">—</span>
                                    <input
                                        type="date"
                                        value={config.dateRange?.end || ""}
                                        onChange={e => setConfig(c => ({ ...c, dateRange: { start: c.dateRange?.start || daysAgo(30), end: e.target.value } }))}
                                        className="bg-[var(--bg-tertiary)] border border-border rounded-lg px-3 py-2 text-sm"
                                    />
                                    <button
                                        onClick={loadPreview}
                                        className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-border text-sm flex items-center gap-1.5"
                                    >
                                        {loadingPreview ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                                        {t("preview")}
                                    </button>
                                </div>
                            </div>

                            {/* Chart Preview */}
                            <div className="rounded-xl border border-border bg-[var(--bg-primary)] p-4">
                                <p className="text-xs text-[var(--text-secondary)] mb-3">{t("previewTitle")}</p>
                                <ChartPreview config={config} data={previewData} />
                            </div>
                        </div>

                        {/* Modal footer */}
                        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
                            <button onClick={() => setShowBuilder(false)} className="px-4 py-2 rounded-lg border border-border text-sm">{t("cancel")}</button>
                            <button
                                onClick={handleSave}
                                disabled={saving || !name.trim() || !config.metrics.length}
                                className={cn(
                                    "px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium flex items-center gap-2",
                                    (saving || !name.trim() || !config.metrics.length) && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                {saving && <Loader2 size={14} className="animate-spin" />}
                                {t("save")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reports List */}
            {loading ? (
                <div className="py-16 text-center text-[var(--text-secondary)]">{t("loading")}</div>
            ) : reports.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-[var(--bg-secondary)] p-12 text-center">
                    <BarChart3 size={40} className="mx-auto text-[var(--text-secondary)] mb-3 opacity-40" />
                    <p className="text-foreground font-medium mb-1">{t("emptyTitle")}</p>
                    <p className="text-[var(--text-secondary)] text-sm mb-4">{t("emptyBody")}</p>
                    <button
                        onClick={() => openBuilder()}
                        className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium inline-flex items-center gap-1.5"
                    >
                        <Plus size={14} />
                        {t("createFirst")}
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {reports.map(report => (
                        <div key={report.id} className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden flex flex-col">
                            <div className="p-5 flex-1">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <h3 className="font-semibold text-sm truncate">{report.name}</h3>
                                    <button
                                        onClick={() => handleToggleFavorite(report)}
                                        className={cn("flex-shrink-0", report.is_favorite ? "text-[#f1c40f]" : "text-[var(--text-secondary)] hover:text-[#f1c40f]")}
                                    >
                                        <Star size={14} fill={report.is_favorite ? "#f1c40f" : "none"} />
                                    </button>
                                </div>
                                {report.description && (
                                    <p className="text-[12px] text-[var(--text-secondary)] mb-3 line-clamp-2">{report.description}</p>
                                )}
                                <div className="flex flex-wrap gap-1.5 mb-3">
                                    {(report.config?.metrics || []).slice(0, 4).map(m => (
                                        <span key={m} className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-[10px] font-medium">
                                            {t(`metric_${m}`)}
                                        </span>
                                    ))}
                                    {(report.config?.metrics?.length || 0) > 4 && (
                                        <span className="px-2 py-0.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-full text-[10px]">
                                            +{(report.config?.metrics?.length || 0) - 4}
                                        </span>
                                    )}
                                </div>
                                <div className="flex gap-1.5 text-[10px] text-[var(--text-secondary)]">
                                    <span className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded text-[10px]">
                                        {t(`chartType_${report.config?.chartType || "bar"}`)}
                                    </span>
                                    <span>{new Date(report.updated_at).toLocaleDateString()}</span>
                                </div>
                            </div>
                            <div className="px-5 py-3 border-t border-border bg-[var(--bg-tertiary)] flex items-center gap-2">
                                <button onClick={() => openBuilder(report)} className="text-xs text-primary hover:underline flex items-center gap-1"><Edit3 size={12} />{t("edit")}</button>
                                <button onClick={() => handleDuplicate(report)} className="text-xs text-[var(--text-secondary)] hover:text-foreground flex items-center gap-1"><Copy size={12} />{t("duplicate")}</button>
                                <button onClick={() => handleDelete(report.id)} className="text-xs text-[#e74c3c] hover:underline flex items-center gap-1 ml-auto"><Trash2 size={12} />{t("delete")}</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
