"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Send, Users, MessageSquare, Calendar, Clock, Plus, X,
    CheckCircle2, AlertCircle, Megaphone, BarChart3, Target,
    FileText, Zap, ChevronRight,
} from "lucide-react";

const statusStyle: Record<string, { color: string; icon: any }> = {
    draft: { color: "#95a5a6", icon: FileText },
    scheduled: { color: "#f39c12", icon: Calendar },
    sending: { color: "#3498db", icon: Zap },
    sent: { color: "#2ecc71", icon: CheckCircle2 },
    failed: { color: "#e74c3c", icon: AlertCircle },
};

export default function BroadcastPage() {
    const t = useTranslations('broadcast');
    const tc = useTranslations("common");
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
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
    const [newCampaign, setNewCampaign] = useState({ name: "", channel: "whatsapp", template: "", targetAudience: "all", scheduledAt: "" });
    const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const stats = {
        total: campaigns.length,
        sent: campaigns.filter(c => c.status === "sent").length,
        scheduled: campaigns.filter(c => c.status === "scheduled").length,
        totalRecipients: campaigns.reduce((s, c) => s + c.recipientCount, 0),
        totalReplies: campaigns.reduce((s, c) => s + c.repliedCount, 0),
    };

    const handleCreateCampaign = async () => {
        if (!activeTenantId) return;
        if (!newCampaign.name || !newCampaign.template) return;

        setCreating(true);
        const res = await api.createCampaign(activeTenantId, newCampaign);
        if (res?.success) {
            setCreating(false);
            setNewCampaign({ name: "", channel: "whatsapp", template: "", targetAudience: "all", scheduledAt: "" });
            loadCampaigns();
            setShowNewCampaign(false);
            setToast("Campaign created successfully");
            setTimeout(() => setToast(null), 2000);
        } else {
            setCreating(false);
            setToast(tc("errorSaving"));
            setTimeout(() => setToast(null), 2000);
        }
    };

    const handleSendNow = async (id: string) => {
        if (!activeTenantId) return;
        setCampaigns(campaigns.map(c => c.id === id ? { ...c, status: "sending" } : c));
        await api.sendCampaign(activeTenantId, id);
        setTimeout(loadCampaigns, 2000);
    };

    return (
        <>
            <div>
                {/* Header */}
                <PageHeader
                    title={t('title')}
                    subtitle={t('subtitleStats', { campaigns: stats.total, recipients: stats.totalRecipients })}
                    icon={Megaphone}
                    badge={<DataSourceBadge isLive={false} />}
                    action={
                        <button onClick={() => setShowNewCampaign(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect">
                            <Plus size={16} /> {tc("create")}
                        </button>
                    }
                />

                {/* Stats */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                    {[
                        { key: "campaigns", label: t('stats.campaigns'), value: stats.total, color: "#6c5ce7", icon: Megaphone },
                        { key: "sent", label: t('stats.sent'), value: stats.sent, color: "#2ecc71", icon: Send },
                        { key: "scheduled", label: t('stats.scheduled'), value: stats.scheduled, color: "#f39c12", icon: Calendar },
                        { key: "responses", label: t('stats.responses'), value: stats.totalReplies, color: "#9b59b6", icon: MessageSquare },
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

                {/* Campaign List */}
                <div className="flex flex-col gap-3">
                    {campaigns.map(campaign => {
                        const sc = statusStyle[campaign.status];
                        const Icon = sc.icon;
                        const deliveryRate = campaign.recipientCount > 0 ? Math.round((campaign.deliveredCount / campaign.recipientCount) * 100) : 0;
                        const readRate = campaign.deliveredCount > 0 ? Math.round((campaign.readCount / campaign.deliveredCount) * 100) : 0;
                        const replyRate = campaign.deliveredCount > 0 ? Math.round((campaign.repliedCount / campaign.deliveredCount) * 100) : 0;

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
                                        </div>
                                        <div className="text-[13px] text-muted-foreground mb-2.5 leading-snug max-w-[600px]">
                                            {campaign.template.length > 120 ? campaign.template.slice(0, 120) + "..." : campaign.template}
                                        </div>
                                        {campaign.status === "sent" && (
                                            <div className="flex gap-5 text-xs">
                                                <span className="flex items-center gap-1">
                                                    <Target size={12} className="text-muted-foreground" />
                                                    <strong>{campaign.recipientCount}</strong> {t('recipients')}
                                                </span>
                                                <span className="text-emerald-500">📬 {deliveryRate}% {t('delivered')}</span>
                                                <span className="text-blue-500">👁️ {readRate}% {t('read')}</span>
                                                <span className="text-purple-500">💬 {replyRate}% {t('responded')}</span>
                                            </div>
                                        )}
                                        {campaign.status === "scheduled" && campaign.scheduledAt && (
                                            <div className="text-xs text-amber-500 flex items-center gap-1">
                                                <Clock size={12} /> {t('scheduledAt', { date: campaign.scheduledAt })}
                                            </div>
                                        )}
                                        {campaign.status === "draft" && (
                                            <div className="text-xs text-muted-foreground">
                                                {t('draftNotScheduled')}
                                            </div>
                                        )}
                                    </div>
                                    <ChevronRight size={20} className="text-muted-foreground" />
                                </div>

                                {campaign.status === "sent" && campaign.recipientCount > 0 && (
                                    <div className="mt-3">
                                        <div className="h-1.5 rounded-sm bg-muted overflow-hidden flex">
                                            <div className="transition-[width] duration-500" style={{ width: `${replyRate}%`, background: "#9b59b6" }} />
                                            <div className="transition-[width] duration-500" style={{ width: `${readRate - replyRate}%`, background: "#3498db" }} />
                                            <div className="transition-[width] duration-500" style={{ width: `${deliveryRate - readRate}%`, background: "#2ecc71" }} />
                                        </div>
                                        <div className="flex justify-end gap-3 mt-1 text-[10px] text-muted-foreground">
                                            <span>🟣 responded</span>
                                            <span>🔵 read</span>
                                            <span>🟢 delivered</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* New Campaign Modal */}
            {showNewCampaign && (
                <div
                    className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onClick={() => setShowNewCampaign(false)}
                >
                    <div onClick={e => e.stopPropagation()} className="w-[500px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-semibold m-0">{t('modal.title')}</h2>
                            <button onClick={() => setShowNewCampaign(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t('modal.nameLabel')}</label>
                            <input value={newCampaign.name} onChange={e => setNewCampaign(p => ({ ...p, name: e.target.value }))} placeholder={t('modal.namePlaceholder')} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                        </div>
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                {t('modal.templateLabel')} <span className="font-normal">{t('modal.templateHint')}</span>
                            </label>
                            <textarea value={newCampaign.template} onChange={e => setNewCampaign(p => ({ ...p, template: e.target.value }))} placeholder={t('modal.templatePlaceholder')} rows={4} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border resize-y" />
                        </div>
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t('modal.sendDateLabel')}</label>
                            <input type="datetime-local" value={newCampaign.scheduledAt} onChange={e => setNewCampaign(p => ({ ...p, scheduledAt: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                            <div className="text-[11px] text-muted-foreground mt-1">{t('modal.leaveEmpty')}</div>
                        </div>
                        <div className="p-3.5 rounded-[10px] bg-primary/[0.08] border border-primary/15 mb-3.5">
                            <div className="text-xs font-semibold text-primary mb-1">📋 {t('modal.preview')}</div>
                            <div className="text-[13px] text-foreground leading-relaxed">
                                {newCampaign.template ? newCampaign.template.replace(/\{\{name\}\}/g, "Carlos Medina") : t('modal.previewEmpty')}
                            </div>
                        </div>
                        <div className="flex gap-2.5 mt-5">
                            <button onClick={() => setShowNewCampaign(false)} className="flex-1 py-2.5 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer">{tc('cancel')}</button>
                            <button
                                onClick={handleCreateCampaign}
                                disabled={!newCampaign.name || !newCampaign.template}
                                className={cn(
                                    "flex-1 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold",
                                    (!newCampaign.name || !newCampaign.template) ? "bg-muted cursor-not-allowed" : "bg-primary cursor-pointer"
                                )}
                            >
                                {newCampaign.scheduledAt ? `📅 ${t('modal.schedule')}` : `📝 ${t('modal.saveDraft')}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold bg-emerald-500 text-white shadow-lg animate-in">
                    ✓ {toast}
                </div>
            )}
        </>
    );
}
