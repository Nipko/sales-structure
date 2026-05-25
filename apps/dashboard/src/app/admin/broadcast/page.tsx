"use client";

import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useVerticalTerms } from "@/hooks/useVerticalTerms";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { DataSourceBadge } from "@/hooks/useApiData";
import { UpgradeBanner } from "@/components/ui/upgrade-banner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Send, Users, MessageSquare, Calendar, Clock, Plus, X,
    CheckCircle2, AlertCircle, Megaphone, BarChart3, Target,
    FileText, Zap, ChevronRight, Mail, Phone, MessageCircle,
} from "lucide-react";

const CHANNEL_OPTIONS = [
    { id: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "#25D366" },
    { id: "email", label: "Email", icon: Mail, color: "#6c5ce7" },
    // SMS hidden until integration is ready
    // { id: "sms", label: "SMS", icon: Phone, color: "#f39c12" },
] as const;

const statusStyle: Record<string, { color: string; icon: any }> = {
    draft: { color: "#95a5a6", icon: FileText },
    scheduled: { color: "#f39c12", icon: Calendar },
    active: { color: "#3498db", icon: Zap },
    sending: { color: "#3498db", icon: Zap },
    sent: { color: "#2ecc71", icon: CheckCircle2 },
    finished: { color: "#2ecc71", icon: CheckCircle2 },
    failed: { color: "#e74c3c", icon: AlertCircle },
};

export default function BroadcastPage() {
    const t = useTranslations('broadcast');
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const { user } = useAuth();
    const vt = useVerticalTerms();
    const { activeTenantId } = useTenant();
    const { canCreate, getLimit } = usePlanLimits();
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    const loadCampaigns = async () => {
        if (!activeTenantId) return;
        setLoading(true);
        const res = await api.getCampaigns(activeTenantId);
        if (res?.success) {
            setCampaigns(res.data || []);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadCampaigns();
    }, [activeTenantId]);

    const [showNewCampaign, setShowNewCampaign] = useState(false);
    const [selectedChannels, setSelectedChannels] = useState<string[]>(["whatsapp"]);
    const [newCampaign, setNewCampaign] = useState({
        name: "",
        waTemplate: "",
        emailSubject: "",
        emailBody: "",
        smsBody: "",
        targetAudience: "all",
        scheduledAt: "",
    });
    const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [segments, setSegments] = useState<any[]>([]);
    const [audienceType, setAudienceType] = useState<"all" | "segment">("all");
    const [selectedSegmentId, setSelectedSegmentId] = useState("");

    const stats = {
        total: campaigns.length,
        sent: campaigns.filter(c => ["sent", "finished", "active"].includes(c.status)).length,
        scheduled: campaigns.filter(c => c.status === "scheduled").length,
        totalRecipients: campaigns.reduce((s, c) => s + (c.totalRecipients || 0), 0),
    };

    const toggleChannel = (ch: string) => {
        setSelectedChannels(prev =>
            prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
        );
    };

    const openNewCampaign = async () => {
        setShowNewCampaign(true);
        if (activeTenantId) {
            const res = await api.getSegments(activeTenantId);
            if (res?.success) setSegments(res.data || []);
        }
    };

    const hasContent = () => {
        if (selectedChannels.includes("whatsapp") && !newCampaign.waTemplate) return false;
        if (selectedChannels.includes("email") && (!newCampaign.emailSubject || !newCampaign.emailBody)) return false;
        if (selectedChannels.includes("sms") && !newCampaign.smsBody) return false;
        return selectedChannels.length > 0 && !!newCampaign.name;
    };

    const handleCreateCampaign = async () => {
        if (!activeTenantId) return;
        if (!hasContent()) return;

        const audience = audienceType === "segment" && selectedSegmentId
            ? JSON.stringify({ segmentId: selectedSegmentId })
            : "all";

        const channelContent: any = {};
        if (selectedChannels.includes("whatsapp")) {
            channelContent.whatsapp = { templateName: newCampaign.waTemplate, templateLanguage: "es" };
        }
        if (selectedChannels.includes("email")) {
            channelContent.email = { subject: newCampaign.emailSubject, html: newCampaign.emailBody, text: newCampaign.emailBody.replace(/<[^>]+>/g, "") };
        }
        if (selectedChannels.includes("sms")) {
            channelContent.sms = { body: newCampaign.smsBody };
        }

        setCreating(true);
        const res = await api.createCampaign(activeTenantId, {
            name: newCampaign.name,
            channels: selectedChannels,
            channelContent,
            templateName: channelContent.whatsapp?.templateName || "",
            targetAudience: audience,
            scheduledAt: newCampaign.scheduledAt || undefined,
        });
        if (res?.success) {
            setCreating(false);
            setNewCampaign({ name: "", waTemplate: "", emailSubject: "", emailBody: "", smsBody: "", targetAudience: "all", scheduledAt: "" });
            setSelectedChannels(["whatsapp"]);
            setAudienceType("all");
            setSelectedSegmentId("");
            loadCampaigns();
            setShowNewCampaign(false);
            setToast(t('toast.created'));
            setTimeout(() => setToast(null), 2000);
        } else {
            setCreating(false);
            setToast(tc("errorSaving"));
            setTimeout(() => setToast(null), 2000);
        }
    };

    const [sendingId, setSendingId] = useState<string | null>(null);

    const handleSendNow = async (id: string) => {
        if (!activeTenantId || sendingId) return;
        const previousCampaigns = [...campaigns];
        setCampaigns(campaigns.map(c => c.id === id ? { ...c, status: "active" } : c));
        setSendingId(id);
        try {
            await api.sendCampaign(activeTenantId, id);
            setToast(t("toast.campaignSent")); setTimeout(() => setToast(null), 2500);
            setTimeout(loadCampaigns, 2000);
        } catch {
            setCampaigns(previousCampaigns);
            setToast(tc("errorSaving")); setTimeout(() => setToast(null), 2500);
        } finally {
            setSendingId(null);
        }
    };

    return (
        <>
            <div>
                <PageHeader
                    title={t('title')}
                    subtitle={t('subtitleStats', { campaigns: stats.total, recipients: stats.totalRecipients }).replace(/destinatarios|destinatários|destinataires|recipients/i, vt.customerNounPlural)}
                    icon={Megaphone}
                    badge={<DataSourceBadge isLive={false} />}
                    action={
                        <button
                            onClick={openNewCampaign}
                            disabled={!canCreate("broadcastCampaigns", campaigns.length)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm press-effect",
                                canCreate("broadcastCampaigns", campaigns.length)
                                    ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 cursor-pointer hover:opacity-90"
                                    : "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
                            )}
                        >
                            <Plus size={16} /> {tc("create")}
                        </button>
                    }
                />

                <HelpPanel
                    title={tHelp("broadcast.title")}
                    description={tHelp("broadcast.description")}
                    tips={tHelp.raw("broadcast.tips") as string[]}
                />

                {/* Stats */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                    {[
                        { key: "campaigns", label: t('stats.campaigns'), value: stats.total, color: "#6c5ce7", icon: Megaphone },
                        { key: "sent", label: t('stats.sent'), value: stats.sent, color: "#2ecc71", icon: Send },
                        { key: "scheduled", label: t('stats.scheduled'), value: stats.scheduled, color: "#f39c12", icon: Calendar },
                        { key: "responses", label: t('stats.responses'), value: stats.totalRecipients, color: "#9b59b6", icon: MessageSquare },
                    ].map(stat => (
                        <div key={stat.key} className="p-5 rounded-[14px] bg-card border border-border">
                            <div className="flex justify-between items-center">
                                <div>
                                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{stat.label}</div>
                                    <div className="text-[28px] font-semibold mt-1">{stat.value}</div>
                                </div>
                                <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${stat.color}15` }}>
                                    <stat.icon size={22} color={stat.color} />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <UpgradeBanner
                    current={campaigns.length}
                    limit={getLimit("broadcastCampaigns")}
                    resourceLabel="campañas de broadcast"
                />

                {/* Campaign List */}
                <div className="flex flex-col gap-3">
                    {campaigns.map(campaign => {
                        const sc = statusStyle[campaign.status] || statusStyle.draft;
                        const Icon = sc.icon;
                        const deliveryRate = campaign.totalRecipients > 0 ? Math.round((campaign.deliveredCount / campaign.totalRecipients) * 100) : 0;
                        const readRate = campaign.deliveredCount > 0 ? Math.round((campaign.readCount / campaign.deliveredCount) * 100) : 0;
                        const chs: string[] = campaign.channels || [campaign.channel || "whatsapp"];

                        return (
                            <div
                                key={campaign.id}
                                onClick={() => setSelectedCampaign(campaign)}
                                className={cn(
                                    "p-5 rounded-[14px] bg-card border cursor-pointer transition-colors duration-200",
                                    selectedCampaign?.id === campaign.id ? "border-primary" : "border-border"
                                )}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2.5 mb-1.5">
                                            <span className="text-base font-semibold">{campaign.name}</span>
                                            <span
                                                className="text-[10px] px-2 py-0.5 rounded-md font-semibold flex items-center gap-1"
                                                style={{ background: `${sc.color}15`, color: sc.color }}
                                            >
                                                <Icon size={12} /> {t(`status.${campaign.status}`)}
                                            </span>
                                            {/* Channel badges */}
                                            <div className="flex gap-1">
                                                {chs.map(ch => {
                                                    const opt = CHANNEL_OPTIONS.find(o => o.id === ch);
                                                    if (!opt) return null;
                                                    return (
                                                        <span key={ch} className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${opt.color}15`, color: opt.color }}>
                                                            {opt.label}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="text-[13px] text-muted-foreground mb-2">
                                            <span className="flex items-center gap-1">
                                                <Target size={12} /> <strong>{campaign.totalRecipients}</strong> {vt.customerNounPlural}
                                                {campaign.sentCount > 0 && <span className="ml-2 text-emerald-500">{deliveryRate}% {t('delivered')}</span>}
                                                {campaign.readCount > 0 && <span className="ml-2 text-blue-500">{readRate}% {t('read')}</span>}
                                            </span>
                                        </div>
                                        {campaign.status === "scheduled" && campaign.scheduledAt && (
                                            <div className="text-xs text-amber-500 flex items-center gap-1">
                                                <Clock size={12} /> {new Date(campaign.scheduledAt).toLocaleString()}
                                            </div>
                                        )}
                                        {campaign.status === "draft" && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleSendNow(campaign.id); }}
                                                disabled={sendingId === campaign.id}
                                                className="mt-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500 text-white border-none cursor-pointer hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Send size={12} className="inline mr-1" /> {sendingId === campaign.id ? "..." : t('sendNow')}
                                            </button>
                                        )}
                                    </div>
                                    <ChevronRight size={20} className="text-muted-foreground" />
                                </div>

                                {(campaign.status === "sent" || campaign.status === "finished") && campaign.totalRecipients > 0 && (
                                    <div className="mt-3">
                                        <div className="h-1.5 rounded-sm bg-muted overflow-hidden flex">
                                            <div className="transition-[width] duration-500" style={{ width: `${readRate}%`, background: "#3498db" }} />
                                            <div className="transition-[width] duration-500" style={{ width: `${deliveryRate - readRate}%`, background: "#2ecc71" }} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* New Campaign Modal — Multi-Channel */}
            {showNewCampaign && (
                <div
                    className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onClick={() => setShowNewCampaign(false)}
                >
                    <div onClick={e => e.stopPropagation()} className="w-[560px] max-h-[90vh] overflow-y-auto p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-semibold m-0">{t('modal.title')}</h2>
                            <button onClick={() => setShowNewCampaign(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>

                        {/* Campaign Name */}
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t('modal.nameLabel')}</label>
                            <input value={newCampaign.name} onChange={e => setNewCampaign(p => ({ ...p, name: e.target.value }))} placeholder={t('modal.namePlaceholder')} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                        </div>

                        {/* Channel Selector */}
                        <div className="mb-4">
                            <label className="block text-xs font-semibold text-muted-foreground mb-2">{t('modal.channelsLabel')}</label>
                            <div className="flex gap-2">
                                {CHANNEL_OPTIONS.map(ch => (
                                    <button
                                        key={ch.id}
                                        type="button"
                                        onClick={() => toggleChannel(ch.id)}
                                        className={cn(
                                            "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-all cursor-pointer",
                                            selectedChannels.includes(ch.id)
                                                ? "border-primary bg-primary/10 text-primary shadow-sm"
                                                : "border-border bg-transparent text-muted-foreground hover:border-primary/40"
                                        )}
                                    >
                                        <ch.icon size={16} style={{ color: selectedChannels.includes(ch.id) ? ch.color : undefined }} />
                                        {ch.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Per-Channel Content */}
                        {selectedChannels.includes("whatsapp") && (
                            <div className="mb-3.5 p-3.5 rounded-xl border border-[#25D366]/20 bg-[#25D366]/5">
                                <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1.5">
                                    <MessageCircle size={14} style={{ color: "#25D366" }} /> {t('modal.waTemplateLabel')}
                                </label>
                                <textarea
                                    value={newCampaign.waTemplate}
                                    onChange={e => setNewCampaign(p => ({ ...p, waTemplate: e.target.value }))}
                                    placeholder={t('modal.templatePlaceholder')}
                                    rows={3}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border resize-y"
                                />
                                <div className="text-[10px] text-muted-foreground mt-1">{t('modal.templateHint')}</div>
                            </div>
                        )}

                        {selectedChannels.includes("email") && (
                            <div className="mb-3.5 p-3.5 rounded-xl border border-[#6c5ce7]/20 bg-[#6c5ce7]/5">
                                <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1.5">
                                    <Mail size={14} style={{ color: "#6c5ce7" }} /> {t('modal.emailLabel')}
                                </label>
                                <input
                                    value={newCampaign.emailSubject}
                                    onChange={e => setNewCampaign(p => ({ ...p, emailSubject: e.target.value }))}
                                    placeholder={t('modal.emailSubjectPh')}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border mb-2"
                                />
                                <textarea
                                    value={newCampaign.emailBody}
                                    onChange={e => setNewCampaign(p => ({ ...p, emailBody: e.target.value }))}
                                    placeholder={t('modal.emailBodyPh')}
                                    rows={4}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border resize-y"
                                />
                            </div>
                        )}

                        {selectedChannels.includes("sms") && (
                            <div className="mb-3.5 p-3.5 rounded-xl border border-[#f39c12]/20 bg-[#f39c12]/5">
                                <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1.5">
                                    <Phone size={14} style={{ color: "#f39c12" }} /> {t('modal.smsLabel')}
                                </label>
                                <textarea
                                    value={newCampaign.smsBody}
                                    onChange={e => setNewCampaign(p => ({ ...p, smsBody: e.target.value }))}
                                    placeholder={t('modal.smsBodyPh')}
                                    rows={2}
                                    maxLength={160}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border resize-y"
                                />
                                <div className="text-[10px] text-muted-foreground mt-1 text-right">{newCampaign.smsBody.length}/160</div>
                            </div>
                        )}

                        {/* Audience */}
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t('modal.audienceLabel')}</label>
                            <div className="flex gap-2 mb-2">
                                <button
                                    type="button"
                                    onClick={() => { setAudienceType("all"); setSelectedSegmentId(""); }}
                                    className={cn(
                                        "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer",
                                        audienceType === "all"
                                            ? "border-primary bg-primary/10 text-primary"
                                            : "border-border bg-transparent text-muted-foreground"
                                    )}
                                >
                                    <Users size={14} className="inline mr-1.5" /> {t('modal.allContacts')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAudienceType("segment")}
                                    className={cn(
                                        "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer",
                                        audienceType === "segment"
                                            ? "border-primary bg-primary/10 text-primary"
                                            : "border-border bg-transparent text-muted-foreground"
                                    )}
                                >
                                    <Target size={14} className="inline mr-1.5" /> {t('modal.segment')}
                                </button>
                            </div>
                            {audienceType === "segment" && (
                                <select
                                    value={selectedSegmentId}
                                    onChange={e => setSelectedSegmentId(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                >
                                    <option value="">{t('modal.selectSegment')}</option>
                                    {segments.map(s => (
                                        <option key={s.id} value={s.id}>
                                            {s.name} ({s.contact_count ?? 0} {vt.customerNounPlural})
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {/* Schedule */}
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t('modal.sendDateLabel')}</label>
                            <input type="datetime-local" value={newCampaign.scheduledAt} onChange={e => setNewCampaign(p => ({ ...p, scheduledAt: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                            <div className="text-[11px] text-muted-foreground mt-1">{t('modal.leaveEmpty')}</div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2.5 mt-5">
                            <button onClick={() => setShowNewCampaign(false)} className="flex-1 py-2.5 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer">{tc('cancel')}</button>
                            <button
                                onClick={handleCreateCampaign}
                                disabled={!hasContent() || creating}
                                className={cn(
                                    "flex-1 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold transition-colors",
                                    (!hasContent() || creating) ? "bg-muted cursor-not-allowed" : "bg-primary cursor-pointer hover:bg-primary/90"
                                )}
                            >
                                {creating ? "..." : newCampaign.scheduledAt ? t('modal.schedule') : t('modal.saveDraft')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold bg-emerald-500 text-white shadow-lg animate-in">
                    {toast}
                </div>
            )}
        </>
    );
}
