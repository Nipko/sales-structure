"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import {
    Users, CheckCircle, XCircle, Clock, MessageSquare, MessageCircle, Instagram, ArrowRight, Loader2,
} from "lucide-react";

const channelStyles: Record<string, { bg: string; color: string; label: string }> = {
    whatsapp: { bg: "rgba(37, 211, 102, 0.15)", color: "#25D366", label: "WhatsApp" },
    instagram: { bg: "rgba(228, 64, 95, 0.15)", color: "#E4405F", label: "Instagram" },
    messenger: { bg: "rgba(0, 132, 255, 0.15)", color: "#0084FF", label: "Messenger" },
};

const matchTypeStyles: Record<string, { bg: string; color: string }> = {
    phone_match: { bg: "rgba(0, 214, 143, 0.15)", color: "var(--success, #00d68f)" },
    email_match: { bg: "rgba(108, 92, 231, 0.15)", color: "var(--accent-hex, #6c5ce7)" },
};

function ChannelBadge({ channel }: { channel: string }) {
    const s = channelStyles[channel] || { bg: "rgba(152,152,176,0.15)", color: "#9898b0", label: channel };
    const IconMap: Record<string, any> = { whatsapp: MessageSquare, instagram: Instagram, messenger: MessageCircle };
    const Icon = IconMap[channel] || MessageSquare;
    return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl text-[11px] font-semibold" style={{ background: s.bg, color: s.color }}>
            <Icon size={12} /> {s.label}
        </span>
    );
}

export default function IdentityPage() {
    const t = useTranslations('identity');
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [message, setMessage] = useState({ type: "", text: "" });

    const loadSuggestions = async () => {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const data = await api.fetch(`/identity/${activeTenantId}/suggestions`);
            setSuggestions(Array.isArray(data) ? data : data?.data || []);
        } catch (err) { console.error("Failed to load identity suggestions", err); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadSuggestions(); }, [activeTenantId]);

    const handleAction = async (id: string, action: "approve" | "reject") => {
        setActionLoading(id); setMessage({ type: "", text: "" });
        try {
            await api.fetch(`/identity/${activeTenantId}/suggestions/${id}/${action}`, { method: "POST" });
            setMessage({ type: "success", text: action === "approve" ? t("toast.merged") : t("toast.rejected") });
            await loadSuggestions();
        } catch (err: any) { setMessage({ type: "error", text: err.message || tc("errorSaving") }); }
        finally { setActionLoading(null); }
    };

    const pending = suggestions.filter(s => s.status === "pending");
    const approved = suggestions.filter(s => s.status === "approved");
    const rejected = suggestions.filter(s => s.status === "rejected");

    if (loading) return <div className="p-8 text-center text-muted-foreground">{t("loading")}</div>;

    return (
        <div className="max-w-[1060px] mx-auto">
            <PageHeader title={t('title')} subtitle={t('subtitle')} icon={Users} iconColor="bg-primary" />

            {message.text && (
                <div className={cn("p-4 rounded-xl mb-6 text-sm border", message.type === "error" ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20")}>
                    {message.text}
                </div>
            )}

            <div className="grid grid-cols-3 gap-5 mb-8">
                {([
                    { key: "pending", count: pending.length, color: "var(--warning, #ffaa00)", Icon: Clock },
                    { key: "approved", count: approved.length, color: "var(--success, #00d68f)", Icon: CheckCircle },
                    { key: "rejected", count: rejected.length, color: "var(--danger, #ff4757)", Icon: XCircle },
                ] as const).map(stat => (
                    <div key={stat.key} className="bg-card border border-border rounded-xl overflow-hidden p-6 flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${stat.color}15` }}>
                            <stat.Icon size={22} color={stat.color} />
                        </div>
                        <div>
                            <p className="text-[28px] font-semibold m-0 text-foreground">{stat.count}</p>
                            <p className="text-[13px] text-muted-foreground m-0">{t(`stats.${stat.key}`)}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                    <Users size={18} className="text-primary" />
                    <h2 className="text-base font-semibold m-0 text-foreground">{t("pendingTitle")}</h2>
                    <span className="text-xs text-muted-foreground ml-auto">{t("suggestionCount", { count: pending.length })}</span>
                </div>

                {pending.length === 0 ? (
                    <div className="py-[60px] text-center text-muted-foreground">
                        <Users size={40} className="opacity-30 mb-4" />
                        <p className="text-[15px] font-medium m-0 mb-1">{t("empty.title")}</p>
                        <p className="text-[13px] m-0">{t("empty.description")}</p>
                    </div>
                ) : (
                    <div>
                        {pending.map(s => {
                            const mt = matchTypeStyles[s.match_type] || { bg: "rgba(152,152,176,0.15)", color: "#9898b0" };
                            const matchLabel = s.match_type === "phone_match"
                                ? t("matchType.phone")
                                : s.match_type === "email_match"
                                    ? t("matchType.email")
                                    : s.match_type;
                            const isActioning = actionLoading === s.id;
                            return (
                                <div key={s.id} className="px-6 py-5 border-b border-border flex items-center gap-4">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold m-0 mb-1.5 text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{s.contact_a?.name || s.contact_a_name || t("contactA")}</p>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <ChannelBadge channel={s.contact_a?.channel || s.contact_a_channel || "whatsapp"} />
                                            <span className="text-[11px] text-muted-foreground font-mono">{s.contact_a?.external_id || s.contact_a_external_id || "\u2014"}</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-center gap-1.5 shrink-0 min-w-[120px]">
                                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl text-[11px] font-semibold" style={{ background: mt.bg, color: mt.color }}>{matchLabel}</span>
                                        <div className="flex items-center gap-1.5">
                                            <ArrowRight size={14} className="text-muted-foreground" />
                                            <span className="text-[13px] font-semibold text-foreground">{s.confidence != null ? `${Math.round(Number(s.confidence) * 100)}%` : "\u2014"}</span>
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0 text-right">
                                        <p className="text-sm font-semibold m-0 mb-1.5 text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{s.contact_b?.name || s.contact_b_name || t("contactB")}</p>
                                        <div className="flex items-center gap-2 justify-end flex-wrap">
                                            <span className="text-[11px] text-muted-foreground font-mono">{s.contact_b?.external_id || s.contact_b_external_id || "\u2014"}</span>
                                            <ChannelBadge channel={s.contact_b?.channel || s.contact_b_channel || "whatsapp"} />
                                        </div>
                                    </div>
                                    <div className="flex gap-2 shrink-0 ml-2">
                                        <button onClick={() => handleAction(s.id, "approve")} disabled={isActioning} className={cn("px-4 py-2 rounded-lg border-none bg-[var(--success)]/15 text-[var(--success)] text-xs font-semibold cursor-pointer flex items-center gap-1", isActioning && "opacity-60")}>
                                            {isActioning ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} {t("approve")}
                                        </button>
                                        <button onClick={() => handleAction(s.id, "reject")} disabled={isActioning} className={cn("px-4 py-2 rounded-lg border-none bg-destructive/15 text-destructive text-xs font-semibold cursor-pointer flex items-center gap-1", isActioning && "opacity-60")}>
                                            {isActioning ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} {t("reject")}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
