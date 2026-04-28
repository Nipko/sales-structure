"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import {
    Users, CheckCircle, XCircle, Clock, MessageSquare, MessageCircle, Instagram, ArrowRight, Loader2,
    Search, Merge, Send, Phone,
} from "lucide-react";
import { TabNav } from "@/components/ui/tab-nav";

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
    const [activeTab, setActiveTab] = useState("suggestions");
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [message, setMessage] = useState({ type: "", text: "" });

    // Manual merge state
    const [contacts, setContacts] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [contactA, setContactA] = useState<any>(null);
    const [contactB, setContactB] = useState<any>(null);
    const [merging, setMerging] = useState(false);
    const [contactsLoading, setContactsLoading] = useState(false);

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

    // Load contacts for manual merge
    const loadContacts = async () => {
        if (!activeTenantId) return;
        setContactsLoading(true);
        try {
            const data = await api.fetch(`/crm/leads/${activeTenantId}?limit=100`);
            setContacts(data?.data || []);
        } catch (e) { console.error("Failed to load contacts", e); }
        finally { setContactsLoading(false); }
    };

    useEffect(() => { if (activeTab === "merge") loadContacts(); }, [activeTab, activeTenantId]);

    const handleManualMerge = async () => {
        if (!activeTenantId || !contactA || !contactB) return;
        setMerging(true);
        setMessage({ type: "", text: "" });
        try {
            await api.fetch(`/identity/${activeTenantId}/manual-merge`, {
                method: "POST",
                body: JSON.stringify({ contactIdA: contactA.contact_id, contactIdB: contactB.contact_id }),
            });
            setMessage({ type: "success", text: t("mergeSuccess") });
            setContactA(null);
            setContactB(null);
            loadSuggestions();
            loadContacts();
        } catch (err: any) {
            setMessage({ type: "error", text: err.message || tc("errorSaving") });
        } finally {
            setMerging(false);
        }
    };

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

    const CHANNEL_ICONS: Record<string, { icon: typeof MessageSquare; color: string }> = {
        whatsapp: { icon: Phone, color: "text-emerald-500" },
        instagram: { icon: Instagram, color: "text-pink-500" },
        messenger: { icon: MessageCircle, color: "text-blue-500" },
        telegram: { icon: Send, color: "text-sky-500" },
    };

    const filteredContacts = contacts.filter((c: any) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
        return name.includes(q) || (c.phone || '').includes(q) || (c.email || '').includes(q);
    });

    const tabs = [
        { id: "suggestions", label: t("tabSuggestions"), icon: Users, badge: pending.length || undefined },
        { id: "merge", label: t("tabManualMerge"), icon: Merge },
    ];

    return (
        <div className="max-w-[1060px] mx-auto">
            <PageHeader title={t('title')} subtitle={t('subtitle')} icon={Users} iconColor="bg-primary" />
            <TabNav tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

            {message.text && (
                <div className={cn("p-4 rounded-xl mb-6 text-sm border mt-4", message.type === "error" ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20")}>
                    {message.text}
                </div>
            )}

            {activeTab === "suggestions" && (<>
            <div className="grid grid-cols-3 gap-5 mb-8 mt-4">
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
            </>)}

            {/* Manual Merge Tab */}
            {activeTab === "merge" && (
                <div className="mt-4 space-y-5">
                    <div className="bg-card border border-border rounded-xl p-5">
                        <h3 className="text-sm font-semibold mb-1">{t("mergeTitle")}</h3>
                        <p className="text-xs text-muted-foreground mb-4">{t("mergeDesc")}</p>

                        {/* Selected contacts preview */}
                        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 mb-5">
                            <div className={cn("p-4 rounded-xl border-2 border-dashed min-h-[80px] flex items-center justify-center", contactA ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-border")}>
                                {contactA ? (
                                    <div className="text-center">
                                        <p className="text-sm font-semibold m-0">{contactA.first_name} {contactA.last_name}</p>
                                        <p className="text-xs text-muted-foreground m-0">{contactA.phone}</p>
                                        <button onClick={() => setContactA(null)} className="text-[10px] text-red-500 bg-transparent border-none cursor-pointer mt-1">{tc("delete")}</button>
                                    </div>
                                ) : (
                                    <span className="text-xs text-muted-foreground">{t("selectContactA")}</span>
                                )}
                            </div>
                            <div className="flex items-center">
                                <Merge size={20} className="text-indigo-500" />
                            </div>
                            <div className={cn("p-4 rounded-xl border-2 border-dashed min-h-[80px] flex items-center justify-center", contactB ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-border")}>
                                {contactB ? (
                                    <div className="text-center">
                                        <p className="text-sm font-semibold m-0">{contactB.first_name} {contactB.last_name}</p>
                                        <p className="text-xs text-muted-foreground m-0">{contactB.phone}</p>
                                        <button onClick={() => setContactB(null)} className="text-[10px] text-red-500 bg-transparent border-none cursor-pointer mt-1">{tc("delete")}</button>
                                    </div>
                                ) : (
                                    <span className="text-xs text-muted-foreground">{t("selectContactB")}</span>
                                )}
                            </div>
                        </div>

                        {contactA && contactB && (
                            <button
                                onClick={handleManualMerge}
                                disabled={merging}
                                className="w-full py-2.5 rounded-lg border-none bg-indigo-600 text-white text-sm font-semibold cursor-pointer flex items-center justify-center gap-2 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                            >
                                {merging ? <Loader2 size={14} className="animate-spin" /> : <Merge size={14} />}
                                {merging ? tc("saving") : t("mergeButton")}
                            </button>
                        )}
                    </div>

                    {/* Contact search + list */}
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-border">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder={t("searchContacts")}
                                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-muted text-foreground text-sm outline-none"
                                />
                            </div>
                        </div>

                        {contactsLoading ? (
                            <div className="p-8 text-center text-muted-foreground text-sm">{tc("loading")}</div>
                        ) : (
                            <div className="max-h-[400px] overflow-y-auto">
                                {filteredContacts.map((c: any) => {
                                    const isSelectedA = contactA?.id === c.id;
                                    const isSelectedB = contactB?.id === c.id;
                                    const isSelected = isSelectedA || isSelectedB;
                                    const chIcon = CHANNEL_ICONS[c.contact_channel] || CHANNEL_ICONS.whatsapp;
                                    const ChIcon = chIcon.icon;

                                    return (
                                        <div
                                            key={c.id}
                                            onClick={() => {
                                                if (isSelected) return;
                                                if (!contactA) setContactA(c);
                                                else if (!contactB && c.id !== contactA.id) setContactB(c);
                                            }}
                                            className={cn(
                                                "flex items-center gap-3 px-4 py-3 border-b border-border cursor-pointer transition-colors",
                                                isSelected ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-muted"
                                            )}
                                        >
                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                                                {(c.first_name || '?').charAt(0)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium m-0 truncate">{c.first_name || ''} {c.last_name || ''}</p>
                                                <p className="text-xs text-muted-foreground m-0">{c.phone || c.email || '—'}</p>
                                            </div>
                                            <ChIcon size={14} className={chIcon.color} />
                                            {isSelectedA && <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 font-semibold">A</span>}
                                            {isSelectedB && <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 font-semibold">B</span>}
                                        </div>
                                    );
                                })}
                                {filteredContacts.length === 0 && (
                                    <div className="p-8 text-center text-muted-foreground text-sm">{tc("noResults")}</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
