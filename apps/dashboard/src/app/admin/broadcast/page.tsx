"use client";

import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
    FileText, Zap, ChevronRight, MessageCircle,
    FlaskConical, Trophy, Loader2,
} from "lucide-react";

const CHANNEL_OPTIONS = [
    { id: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "#25D366" },
];

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
    const { canCreate, getLimit, features } = usePlanLimits();
    const router = useRouter();
    const searchParams = useSearchParams();
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

    useEffect(() => {
        if (searchParams.get("create") !== "campaign") return;
        setShowNewCampaign(true);
        router.replace("/admin/broadcast", { scroll: false });
    }, [searchParams, router]);
    const [selectedChannels, setSelectedChannels] = useState<string[]>(["whatsapp"]);
    const [newCampaign, setNewCampaign] = useState({
        name: "",
        waTemplate: "",
        targetAudience: "all",
        scheduledAt: "",
    });
    const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [segments, setSegments] = useState<any[]>([]);
    const [waAccounts, setWaAccounts] = useState<any[]>([]);
    const [senderAccountId, setSenderAccountId] = useState("");
    const [audienceType, setAudienceType] = useState<"all" | "segment">("all");
    const [selectedSegmentId, setSelectedSegmentId] = useState("");

    // A/B Test state
    const [abTestEnabled, setAbTestEnabled] = useState(false);
    const [abSplitA, setAbSplitA] = useState(50);
    const [abVariantA, setAbVariantA] = useState({ waTemplate: "" });
    const [abVariantB, setAbVariantB] = useState({ waTemplate: "" });
    const [abTestConfig, setAbTestConfig] = useState({
        testPercentage: 20,
        autoSelectWinner: true,
        minSampleSize: 100,
        significanceLevel: 0.05,
    });
    // A/B Results state (for selected campaign)
    const [abVariants, setAbVariants] = useState<any[]>([]);
    const [abVariantsLoading, setAbVariantsLoading] = useState(false);
    const [showWinnerConfirm, setShowWinnerConfirm] = useState<string | null>(null);
    const [selectingWinner, setSelectingWinner] = useState(false);

    const stats = {
        total: campaigns.length,
        sent: campaigns.filter(c => ["sent", "finished", "active"].includes(c.status)).length,
        scheduled: campaigns.filter(c => c.status === "scheduled").length,
        totalRecipients: campaigns.reduce((s, c) => s + (c.totalRecipients || 0), 0),
    };

    // Fetch A/B variants when selecting an A/B test campaign
    useEffect(() => {
        if (!activeTenantId || !selectedCampaign?.is_ab_test) {
            setAbVariants([]);
            return;
        }
        const fetchVariants = async () => {
            setAbVariantsLoading(true);
            const res = await api.getAbVariants(activeTenantId, selectedCampaign.id);
            if (res?.success) {
                setAbVariants(res.data || []);
            }
            setAbVariantsLoading(false);
        };
        fetchVariants();
    }, [activeTenantId, selectedCampaign?.id, selectedCampaign?.is_ab_test]);

    const handleSelectWinner = async (variantId: string) => {
        if (!activeTenantId || !selectedCampaign) return;
        setSelectingWinner(true);
        const res = await api.selectAbWinner(activeTenantId, selectedCampaign.id, variantId);
        if (res?.success) {
            setToast(t('abTest.toast.winnerSelected'));
            setTimeout(() => setToast(null), 2500);
            // Refresh variants
            const vRes = await api.getAbVariants(activeTenantId, selectedCampaign.id);
            if (vRes?.success) setAbVariants(vRes.data || []);
            loadCampaigns();
        }
        setSelectingWinner(false);
        setShowWinnerConfirm(null);
    };

    const toggleChannel = (ch: string) => {
        setSelectedChannels(prev =>
            prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
        );
    };

    const openNewCampaign = async () => {
        setShowNewCampaign(true);
        setSenderAccountId("");
        if (activeTenantId) {
            const res = await api.getSegments(activeTenantId);
            if (res?.success) setSegments(res.data || []);
            try {
                const ov = await api.fetch("/channels/overview");
                const list = ov?.data || ov;
                if (Array.isArray(list)) {
                    setWaAccounts(list.filter((c: any) => (c.channelType || c.channel_type) === "whatsapp"));
                }
            } catch { /* non-fatal */ }
        }
    };

    const hasContent = () => {
        if (abTestEnabled) {
            // Both variants must have content for each selected channel
            for (const variant of [abVariantA, abVariantB]) {
                if (selectedChannels.includes("whatsapp") && !variant.waTemplate) return false;
            }
        } else {
            if (selectedChannels.includes("whatsapp") && !newCampaign.waTemplate) return false;
        }
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

        setCreating(true);

        // Build A/B test payload if enabled
        const buildVariantContent = (v: typeof abVariantA) => {
            const content: any = {};
            if (selectedChannels.includes("whatsapp")) {
                content.whatsapp = { templateName: v.waTemplate, templateLanguage: "es" };
            }
            return content;
        };

        const abPayload = abTestEnabled ? {
            variants: [
                { name: "A", content: buildVariantContent(abVariantA), percentage: abSplitA },
                { name: "B", content: buildVariantContent(abVariantB), percentage: 100 - abSplitA },
            ],
            abTestConfig,
        } : {};

        const res = await api.createCampaign(activeTenantId, {
            name: newCampaign.name,
            channels: selectedChannels,
            channelContent: abTestEnabled ? undefined : channelContent,
            templateName: abTestEnabled ? undefined : (channelContent.whatsapp?.templateName || ""),
            channelAccountId: (selectedChannels.includes("whatsapp") && senderAccountId) ? senderAccountId : undefined,
            targetAudience: audience,
            scheduledAt: newCampaign.scheduledAt || undefined,
            ...abPayload,
        });
        if (res?.success) {
            setCreating(false);
            setNewCampaign({ name: "", waTemplate: "", targetAudience: "all", scheduledAt: "" });
            setSelectedChannels(["whatsapp"]);
            setSenderAccountId("");
            setAudienceType("all");
            setSelectedSegmentId("");
            setAbTestEnabled(false);
            setAbSplitA(50);
            setAbVariantA({ waTemplate: "" });
            setAbVariantB({ waTemplate: "" });
            setAbTestConfig({ testPercentage: 20, autoSelectWinner: true, minSampleSize: 100, significanceLevel: 0.05 });
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
                    mediaKey="broadcast"
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
                    resourceLabel={t("resourceLabel")}
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
                                                {campaign.is_ab_test && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-primary/10 text-primary flex items-center gap-0.5">
                                                        <FlaskConical size={10} /> A/B
                                                    </span>
                                                )}
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

                                {/* A/B Results Section */}
                                {selectedCampaign?.id === campaign.id && campaign.is_ab_test && (
                                    <div className="mt-4 pt-4 border-t border-border">
                                        <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                                            <FlaskConical size={14} className="text-primary" /> {t('abTest.results')}
                                        </h3>

                                        {abVariantsLoading ? (
                                            <div className="flex items-center justify-center py-6 text-muted-foreground">
                                                <Loader2 size={18} className="animate-spin mr-2" /> ...
                                            </div>
                                        ) : abVariants.length === 0 ? (
                                            <div className="text-sm text-muted-foreground text-center py-4">{t('abTest.noVariants')}</div>
                                        ) : (
                                            <>
                                                <div className="grid grid-cols-2 gap-4">
                                                    {abVariants.map((variant: any) => {
                                                        const vDeliveryRate = variant.sent_count > 0 ? Math.round((variant.delivered_count / variant.sent_count) * 100) : 0;
                                                        const vReadRate = variant.delivered_count > 0 ? Math.round((variant.read_count / variant.delivered_count) * 100) : 0;
                                                        const isWinner = variant.is_winner === true;
                                                        const pValue = variant.p_value;
                                                        const isSignificant = typeof pValue === "number" && pValue < 0.05;

                                                        return (
                                                            <div
                                                                key={variant.id}
                                                                className={cn(
                                                                    "p-4 rounded-[14px] bg-card border",
                                                                    isWinner ? "border-emerald-500" : "border-border"
                                                                )}
                                                            >
                                                                <div className="flex items-center justify-between mb-3">
                                                                    <span className="text-sm font-semibold flex items-center gap-1.5">
                                                                        {variant.name}
                                                                        {isWinner && (
                                                                            <span className="flex items-center gap-0.5 text-emerald-500">
                                                                                <Trophy size={12} /> {t('abTest.winner')}
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                    {typeof pValue === "number" && (
                                                                        <span className={cn(
                                                                            "text-[10px] px-2 py-0.5 rounded-md font-semibold",
                                                                            isSignificant
                                                                                ? "bg-emerald-500/15 text-emerald-500"
                                                                                : "bg-amber-500/15 text-amber-500"
                                                                        )}>
                                                                            {isSignificant ? t('abTest.significant') : t('abTest.notSignificant')}
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                <div className="space-y-1.5 text-xs">
                                                                    <div className="flex justify-between">
                                                                        <span className="text-muted-foreground">{t('abTest.sent')}</span>
                                                                        <span className="font-medium">{variant.sent_count ?? 0}</span>
                                                                    </div>
                                                                    <div className="flex justify-between">
                                                                        <span className="text-muted-foreground">{t('abTest.delivered')}</span>
                                                                        <span className="font-medium">{variant.delivered_count ?? 0}</span>
                                                                    </div>
                                                                    <div className="flex justify-between">
                                                                        <span className="text-muted-foreground">{t('abTest.read')}</span>
                                                                        <span className="font-medium">{variant.read_count ?? 0}</span>
                                                                    </div>
                                                                    <div className="flex justify-between">
                                                                        <span className="text-muted-foreground">{t('abTest.deliveryRate')}</span>
                                                                        <span className="font-medium text-emerald-500">{vDeliveryRate}%</span>
                                                                    </div>
                                                                    <div className="flex justify-between">
                                                                        <span className="text-muted-foreground">{t('abTest.readRate')}</span>
                                                                        <span className="font-medium text-blue-500">{vReadRate}%</span>
                                                                    </div>
                                                                </div>

                                                                {/* Select Winner button */}
                                                                {!abVariants.some((v: any) => v.is_winner) && ["sent", "finished"].includes(campaign.status) && (
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setShowWinnerConfirm(variant.id); }}
                                                                        className="mt-3 w-full py-1.5 text-xs font-medium rounded-lg border border-primary text-primary bg-transparent cursor-pointer hover:bg-primary/10 transition-colors"
                                                                    >
                                                                        <Trophy size={12} className="inline mr-1" /> {t('abTest.selectWinner')}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Winner confirmation dialog */}
                                                {showWinnerConfirm && (
                                                    <div className="mt-3 p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5">
                                                        <p className="text-sm mb-2.5">{t('abTest.confirmWinner')}</p>
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setShowWinnerConfirm(null); }}
                                                                className="flex-1 py-1.5 text-xs rounded-lg border border-border bg-transparent text-foreground cursor-pointer"
                                                            >
                                                                {tc('cancel')}
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleSelectWinner(showWinnerConfirm); }}
                                                                disabled={selectingWinner}
                                                                className="flex-1 py-1.5 text-xs rounded-lg border-none bg-emerald-500 text-white font-semibold cursor-pointer hover:bg-emerald-600 transition-colors disabled:opacity-50"
                                                            >
                                                                {selectingWinner ? "..." : t('abTest.selectWinner')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        )}
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
                    <div onClick={e => e.stopPropagation()} className={cn("max-h-[90vh] overflow-y-auto p-7 rounded-[18px] bg-card border border-border shadow-2xl", abTestEnabled ? "w-[780px]" : "w-[560px]")}>
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

                        {/* A/B Test Toggle */}
                        {features.abTestBroadcasts && (
                            <div className="mb-4">
                                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                    <div
                                        onClick={() => setAbTestEnabled(!abTestEnabled)}
                                        className={cn(
                                            "relative w-10 h-5 rounded-full transition-colors duration-200",
                                            abTestEnabled ? "bg-emerald-500" : "bg-muted"
                                        )}
                                    >
                                        <div className={cn(
                                            "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200",
                                            abTestEnabled ? "translate-x-5" : "translate-x-0.5"
                                        )} />
                                    </div>
                                    <span className="text-sm font-medium flex items-center gap-1.5">
                                        <FlaskConical size={14} className="text-primary" /> {t('abTest.toggle')}
                                    </span>
                                </label>
                            </div>
                        )}

                        {/* Per-Channel Content — Normal mode */}
                        {!abTestEnabled && (
                            <>
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
                                        {waAccounts.length > 1 && (
                                            <div className="mt-3">
                                                <label className="block text-xs font-semibold mb-1.5">{t('modal.senderNumberLabel')}</label>
                                                <select
                                                    value={senderAccountId}
                                                    onChange={e => setSenderAccountId(e.target.value)}
                                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                                                >
                                                    <option value="">{t('modal.senderNumberDefault')}</option>
                                                    {waAccounts.map((a: any) => (
                                                        <option key={a.accountId || a.account_id} value={a.accountId || a.account_id}>
                                                            {a.displayName || a.display_name || a.accountId || a.account_id}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}

                            </>
                        )}

                        {/* Per-Channel Content — A/B Test mode (Variant A & B side by side) */}
                        {abTestEnabled && (
                            <div className="mb-3.5">
                                {/* Split percentage slider */}
                                <div className="mb-4 p-3.5 rounded-xl border border-border bg-muted/30">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-2">{t('abTest.splitLabel')}</label>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-medium w-8 text-right">{abSplitA}%</span>
                                        <input
                                            type="range"
                                            min={10}
                                            max={90}
                                            step={5}
                                            value={abSplitA}
                                            onChange={e => setAbSplitA(Number(e.target.value))}
                                            className="flex-1 accent-primary"
                                        />
                                        <span className="text-sm font-medium w-8">{100 - abSplitA}%</span>
                                    </div>
                                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                                        <span>{t('abTest.variantA')}</span>
                                        <span>{t('abTest.variantB')}</span>
                                    </div>
                                </div>

                                {/* A/B Test Config */}
                                <div className="mb-4 p-3.5 rounded-xl border border-border bg-muted/30">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-2">{t('abTest.testConfig')}</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[10px] text-muted-foreground mb-0.5">{t('abTest.minSample')}</label>
                                            <input
                                                type="number"
                                                min={10}
                                                value={abTestConfig.minSampleSize}
                                                onChange={e => setAbTestConfig(p => ({ ...p, minSampleSize: Number(e.target.value) }))}
                                                className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                            />
                                        </div>
                                        <div className="flex items-end pb-1">
                                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={abTestConfig.autoSelectWinner}
                                                    onChange={e => setAbTestConfig(p => ({ ...p, autoSelectWinner: e.target.checked }))}
                                                    className="accent-primary w-4 h-4"
                                                />
                                                <span className="text-xs">{t('abTest.autoWinner')}</span>
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                {/* Variant editors side by side */}
                                <div className="grid grid-cols-2 gap-4">
                                    {/* Variant A */}
                                    <div className="p-4 rounded-[14px] bg-card border border-border">
                                        <div className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                                            <FlaskConical size={14} className="text-blue-500" /> {t('abTest.variantA')}
                                        </div>

                                        {selectedChannels.includes("whatsapp") && (
                                            <div className="mb-2.5">
                                                <label className="block text-[10px] font-semibold mb-1 flex items-center gap-1">
                                                    <MessageCircle size={12} style={{ color: "#25D366" }} /> WA
                                                </label>
                                                <textarea
                                                    value={abVariantA.waTemplate}
                                                    onChange={e => setAbVariantA(p => ({ ...p, waTemplate: e.target.value }))}
                                                    placeholder={t('modal.templatePlaceholder')}
                                                    rows={2}
                                                    className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-foreground text-xs outline-none box-border resize-y"
                                                />
                                            </div>
                                        )}

                                    </div>

                                    {/* Variant B */}
                                    <div className="p-4 rounded-[14px] bg-card border border-border">
                                        <div className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                                            <FlaskConical size={14} className="text-orange-500" /> {t('abTest.variantB')}
                                        </div>

                                        {selectedChannels.includes("whatsapp") && (
                                            <div className="mb-2.5">
                                                <label className="block text-[10px] font-semibold mb-1 flex items-center gap-1">
                                                    <MessageCircle size={12} style={{ color: "#25D366" }} /> WA
                                                </label>
                                                <textarea
                                                    value={abVariantB.waTemplate}
                                                    onChange={e => setAbVariantB(p => ({ ...p, waTemplate: e.target.value }))}
                                                    placeholder={t('modal.templatePlaceholder')}
                                                    rows={2}
                                                    className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-foreground text-xs outline-none box-border resize-y"
                                                />
                                            </div>
                                        )}

                                    </div>
                                </div>
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
