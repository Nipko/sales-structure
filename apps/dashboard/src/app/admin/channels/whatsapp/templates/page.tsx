"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    ArrowLeft, MessageSquare, RefreshCw, CheckCircle, Clock,
    XCircle, Sprout, AlertCircle, Info,
} from "lucide-react";

type Template = {
    id: string;
    name: string;
    language: string;
    category: string;
    approval_status: "APPROVED" | "PENDING" | "REJECTED" | "IN_APPEAL" | "PAUSED" | "DISABLED" | string;
    components_json: any;
    meta_template_id?: string | null;
    rejected_reason?: string | null;
    is_seed?: boolean;
    submitted_at?: string | null;
    last_sync_at?: string | null;
    created_at?: string | null;
};

type StatusFilter = "all" | "APPROVED" | "PENDING" | "REJECTED";

const STATUS_COLORS: Record<string, string> = {
    APPROVED:  "bg-[rgba(46,204,113,0.1)]  text-[#2ecc71] border-[rgba(46,204,113,0.2)]",
    PENDING:   "bg-[rgba(241,196,15,0.1)]  text-[#f1c40f] border-[rgba(241,196,15,0.2)]",
    REJECTED:  "bg-[rgba(231,76,60,0.1)]   text-[#e74c3c] border-[rgba(231,76,60,0.2)]",
    IN_APPEAL: "bg-[rgba(52,152,219,0.1)]  text-[#3498db] border-[rgba(52,152,219,0.2)]",
    PAUSED:    "bg-[rgba(149,165,166,0.1)] text-[#95a5a6] border-[rgba(149,165,166,0.2)]",
    DISABLED:  "bg-[rgba(127,140,141,0.1)] text-[#7f8c8d] border-[rgba(127,140,141,0.2)]",
};

const CATEGORY_COLORS: Record<string, string> = {
    UTILITY:        "bg-[rgba(52,152,219,0.1)] text-[#3498db]",
    MARKETING:      "bg-[rgba(155,89,182,0.1)] text-[#9b59b6]",
    AUTHENTICATION: "bg-[rgba(230,126,34,0.1)] text-[#e67e22]",
};

function parseComponents(raw: any): any[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
        try { return JSON.parse(raw) || []; } catch { return []; }
    }
    return [];
}

function replaceExamples(text: string, examples?: string[]): string {
    if (!text) return "";
    if (!examples || examples.length === 0) return text;
    return text.replace(/\{\{(\d+)\}\}/g, (_match, n) => {
        const idx = parseInt(n, 10) - 1;
        return examples[idx] !== undefined ? `«${examples[idx]}»` : `{{${n}}}`;
    });
}

function TemplatePreview({ tpl }: { tpl: Template }) {
    const comps = parseComponents(tpl.components_json);
    const header = comps.find((c: any) => c.type === "HEADER");
    const body = comps.find((c: any) => c.type === "BODY");
    const footer = comps.find((c: any) => c.type === "FOOTER");
    const buttons = comps.find((c: any) => c.type === "BUTTONS");

    const bodyExamples = body?.example?.body_text?.[0] as string[] | undefined;

    return (
        <div className="bg-[#e5ddd5] dark:bg-[#0b141a] rounded-xl p-4 flex justify-start">
            <div className="max-w-[280px] bg-white dark:bg-[#202c33] rounded-lg p-3 shadow-sm">
                {header?.format === "TEXT" && header?.text && (
                    <div className="font-semibold text-[14px] text-[#111] dark:text-white mb-1.5">
                        {header.text}
                    </div>
                )}
                {body?.text && (
                    <div className="text-[13.5px] text-[#111] dark:text-[#e9edef] whitespace-pre-wrap leading-[1.4]">
                        {replaceExamples(body.text, bodyExamples)}
                    </div>
                )}
                {footer?.text && (
                    <div className="text-[11.5px] text-[#667781] dark:text-[#8696a0] mt-2">
                        {footer.text}
                    </div>
                )}
                {buttons?.buttons?.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#e9edef] dark:border-[#374045] flex flex-col gap-1.5">
                        {buttons.buttons.map((b: any, i: number) => (
                            <div
                                key={i}
                                className="text-center text-[13px] text-[#00a5f4] py-1.5 rounded"
                            >
                                {b.text}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function WhatsAppTemplatesPage() {
    const t = useTranslations("whatsappTemplates");
    const router = useRouter();
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [filter, setFilter] = useState<StatusFilter>("all");
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const loadTemplates = async () => {
        setLoading(true);
        try {
            const res = await api.fetch("/channels/whatsapp/templates");
            setTemplates(Array.isArray(res) ? res : []);
        } catch (e: any) {
            setTemplates([]);
            setMessage({ type: "error", text: e?.message || t("errorLoad") });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadTemplates(); }, []);

    const handleSync = async () => {
        setSyncing(true);
        setMessage(null);
        try {
            await api.fetch("/channels/whatsapp/templates/sync", { method: "POST" });
            setMessage({ type: "success", text: t("syncSuccess") });
            await loadTemplates();
        } catch (e: any) {
            setMessage({ type: "error", text: e?.message || t("syncError") });
        } finally {
            setSyncing(false);
        }
    };

    const stats = useMemo(() => {
        const total = templates.length;
        const approved = templates.filter(t => t.approval_status === "APPROVED").length;
        const pending = templates.filter(t => t.approval_status === "PENDING").length;
        const rejected = templates.filter(t => t.approval_status === "REJECTED").length;
        return { total, approved, pending, rejected };
    }, [templates]);

    const filtered = useMemo(() => {
        if (filter === "all") return templates;
        return templates.filter(t => t.approval_status === filter);
    }, [templates, filter]);

    return (
        <div className="mx-auto max-w-[1200px]">
            {/* Header */}
            <div className="mb-6">
                <button
                    onClick={() => router.push("/admin/channels/whatsapp")}
                    className="flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] hover:text-foreground mb-3 bg-transparent border-none cursor-pointer"
                >
                    <ArrowLeft size={14} /> {t("backToWhatsapp")}
                </button>
                <div className="flex justify-between items-start gap-4">
                    <div>
                        <div className="flex items-center gap-2.5">
                            <div className="w-10 h-10 rounded-[10px] flex items-center justify-center bg-[#25D366]">
                                <MessageSquare size={20} className="text-white" />
                            </div>
                            <h1 className="text-[28px] font-semibold m-0">{t("title")}</h1>
                        </div>
                        <p className="text-[var(--text-secondary)] mt-1 text-sm">{t("subtitle")}</p>
                    </div>
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className={cn(
                            "flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-border bg-[var(--bg-tertiary)] text-foreground text-[13px] font-medium cursor-pointer whitespace-nowrap",
                            syncing && "opacity-70"
                        )}
                    >
                        <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                        {syncing ? t("syncing") : t("syncFromMeta")}
                    </button>
                </div>
            </div>

            {/* Alert */}
            {message && (
                <div
                    className={cn(
                        "p-4 rounded-xl mb-4 text-sm border",
                        message.type === "error"
                            ? "bg-[rgba(231,76,60,0.1)] text-[#e74c3c] border-[rgba(231,76,60,0.2)]"
                            : "bg-[rgba(46,204,113,0.1)] text-[#2ecc71] border-[rgba(46,204,113,0.2)]"
                    )}
                >
                    {message.text}
                </div>
            )}

            {/* Informational banner about seed templates */}
            {templates.some(t => t.is_seed) && (
                <div className="p-4 rounded-xl mb-6 text-sm border bg-[rgba(37,211,102,0.07)] border-[rgba(37,211,102,0.2)] text-[var(--text-secondary)] flex items-start gap-2.5">
                    <Sprout size={18} className="text-[#25D366] flex-shrink-0 mt-[1px]" />
                    <div>
                        <strong className="text-foreground">{t("seedBannerTitle")}</strong>
                        <div className="mt-0.5">{t("seedBannerBody")}</div>
                    </div>
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-5">
                {([
                    { key: "all" as StatusFilter, label: t("statTotal"), value: stats.total, icon: MessageSquare, color: "text-primary" },
                    { key: "APPROVED" as StatusFilter, label: t("statApproved"), value: stats.approved, icon: CheckCircle, color: "text-[#2ecc71]" },
                    { key: "PENDING" as StatusFilter, label: t("statPending"), value: stats.pending, icon: Clock, color: "text-[#f1c40f]" },
                    { key: "REJECTED" as StatusFilter, label: t("statRejected"), value: stats.rejected, icon: XCircle, color: "text-[#e74c3c]" },
                ]).map(stat => {
                    const Icon = stat.icon;
                    const active = filter === stat.key;
                    return (
                        <button
                            key={stat.key}
                            onClick={() => setFilter(stat.key)}
                            className={cn(
                                "flex flex-col items-start rounded-xl border p-4 text-left bg-[var(--bg-secondary)] cursor-pointer transition-colors",
                                active ? "border-primary ring-1 ring-primary" : "border-border hover:border-[var(--border)]"
                            )}
                        >
                            <div className="flex items-center gap-2 mb-2">
                                <Icon size={16} className={stat.color} />
                                <span className="text-[12px] text-[var(--text-secondary)] font-medium">{stat.label}</span>
                            </div>
                            <div className="text-[24px] font-semibold">{stat.value}</div>
                        </button>
                    );
                })}
            </div>

            {/* List */}
            {loading ? (
                <div className="py-16 text-center text-[var(--text-secondary)]">{t("loading")}</div>
            ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-[var(--bg-secondary)] p-12 text-center">
                    <Info size={32} className="mx-auto text-[var(--text-secondary)] mb-3" />
                    <p className="text-foreground font-medium mb-1">
                        {filter === "all" ? t("emptyTitle") : t("emptyFilterTitle")}
                    </p>
                    <p className="text-[var(--text-secondary)] text-sm">
                        {filter === "all" ? t("emptyBody") : t("emptyFilterBody")}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {filtered.map(tpl => {
                        const comps = parseComponents(tpl.components_json);
                        const body = comps.find((c: any) => c.type === "BODY");
                        const varCount = (body?.text?.match(/\{\{\d+\}\}/g) || []).length;
                        return (
                            <div
                                key={tpl.id || `${tpl.name}-${tpl.language}`}
                                className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden flex flex-col"
                            >
                                <div className="px-5 py-4 border-b border-border">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            {tpl.is_seed && (
                                                <span title={t("seedBadgeTitle")} className="flex items-center">
                                                    <Sprout size={16} className="text-[#25D366]" />
                                                </span>
                                            )}
                                            <h3 className="font-semibold text-sm truncate m-0">{tpl.name}</h3>
                                        </div>
                                        <span
                                            className={cn(
                                                "px-2 py-0.5 rounded-full text-[10.5px] font-semibold border whitespace-nowrap",
                                                STATUS_COLORS[tpl.approval_status] || STATUS_COLORS.PENDING
                                            )}
                                        >
                                            {tpl.approval_status}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px] flex-wrap">
                                        <span className={cn("px-1.5 py-0.5 rounded font-semibold", CATEGORY_COLORS[tpl.category] || "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]")}>
                                            {tpl.category}
                                        </span>
                                        <span className="text-[var(--text-secondary)]">
                                            {tpl.language}
                                        </span>
                                        {varCount > 0 && (
                                            <span className="text-[var(--text-secondary)]">
                                                · {t("variablesCount", { count: varCount })}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="p-4 flex-1">
                                    <TemplatePreview tpl={tpl} />
                                </div>

                                {tpl.approval_status === "REJECTED" && tpl.rejected_reason && (
                                    <div className="px-5 py-3 border-t border-border bg-[rgba(231,76,60,0.05)] flex items-start gap-2">
                                        <AlertCircle size={14} className="text-[#e74c3c] flex-shrink-0 mt-0.5" />
                                        <div className="text-[12px] text-[#e74c3c]">
                                            <strong>{t("rejectionReason")}:</strong> {tpl.rejected_reason}
                                        </div>
                                    </div>
                                )}

                                {(tpl.submitted_at || tpl.last_sync_at) && (
                                    <div className="px-5 py-2.5 border-t border-border bg-[var(--bg-tertiary)] text-[11px] text-[var(--text-secondary)] flex justify-between">
                                        {tpl.submitted_at && (
                                            <span>{t("submittedAt")}: {new Date(tpl.submitted_at).toLocaleDateString()}</span>
                                        )}
                                        {tpl.last_sync_at && (
                                            <span>{t("lastSync")}: {new Date(tpl.last_sync_at).toLocaleDateString()}</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
