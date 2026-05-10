"use client";

import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";
import { useVerticalTerms } from "@/hooks/useVerticalTerms";
import { cn } from "@/lib/utils";
import {
    DollarSign,
    TrendingUp,
    Target,
    Users,
    Plus,
    Clock,
    GripVertical,
    Loader2,
    Check,
    X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const formatCurrency = (n: number) => `$${n.toLocaleString()}`;
const KNOWN_STAGE_KEYS = ['nuevo','contactado','respondio','calificado','tibio','caliente','listo_cierre','ganado','perdido','no_interesado'];

export default function PipelinePage() {
    const t = useTranslations('pipeline');
    const tc = useTranslations('common');
    const tEmpty = useTranslations("verticalEmptyStates");
    const tHelp = useTranslations("help");
    const vt = useVerticalTerms();
    const { activeTenantId } = useTenant();
    const { hasRole } = useAuth();
    const router = useRouter();
    const [kanban, setKanban] = useState<any>(null);
    const [draggedDeal, setDraggedDeal] = useState<string | null>(null);
    const [dragOverStage, setDragOverStage] = useState<string | null>(null);
    const [isLive, setIsLive] = useState(false);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<string | null>(null);
    const [approvalModal, setApprovalModal] = useState<{ dealId: string; targetStage: any } | null>(null);
    const [rejectModal, setRejectModal] = useState<{ dealId: string } | null>(null);
    const [rejectReason, setRejectReason] = useState("");
    const [approvalLoading, setApprovalLoading] = useState(false);
    const [showCreateDeal, setShowCreateDeal] = useState(false);
    const [dealForm, setDealForm] = useState({ contactId: "", title: "", value: "", stageId: "", notes: "" });
    const [dealCreating, setDealCreating] = useState(false);
    const [contacts, setContacts] = useState<any[]>([]);

    const canApprove = hasRole('super_admin', 'tenant_admin', 'tenant_supervisor');

    const handleRequestApproval = async () => {
        if (!approvalModal || !activeTenantId) return;
        setApprovalLoading(true);
        try {
            await api.fetch(`/crm/opportunities/${activeTenantId}/${approvalModal.dealId}/request-approval`, {
                method: "PUT",
                body: JSON.stringify({ approval_stage: approvalModal.targetStage.id }),
            });
            // Update local state: set approval_status to pending on the deal
            setKanban((prev: any) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    stages: prev.stages.map((s: any) => ({
                        ...s,
                        deals: s.deals.map((d: any) =>
                            d.id === approvalModal.dealId
                                ? { ...d, approval_status: 'pending', approval_stage: approvalModal.targetStage.id }
                                : d
                        ),
                    })),
                };
            });
            setToast(t('approvalPending'));
            setTimeout(() => setToast(null), 2000);
        } catch (err) {
            console.error("Failed to request approval:", err);
        } finally {
            setApprovalLoading(false);
            setApprovalModal(null);
        }
    };

    const handleApprove = async (dealId: string) => {
        if (!activeTenantId) return;
        try {
            await api.fetch(`/crm/opportunities/${activeTenantId}/${dealId}/approve`, {
                method: "PUT",
            });
            // Reload kanban to reflect the move
            const json = await api.fetch(`/crm/kanban/${activeTenantId}`);
            if (json.success && json.data) setKanban(json.data);
            setToast(t('approved'));
            setTimeout(() => setToast(null), 2000);
        } catch (err) {
            console.error("Failed to approve:", err);
        }
    };

    const handleReject = async () => {
        if (!rejectModal || !activeTenantId) return;
        setApprovalLoading(true);
        try {
            await api.fetch(`/crm/opportunities/${activeTenantId}/${rejectModal.dealId}/reject`, {
                method: "PUT",
                body: JSON.stringify({ reason: rejectReason }),
            });
            setKanban((prev: any) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    stages: prev.stages.map((s: any) => ({
                        ...s,
                        deals: s.deals.map((d: any) =>
                            d.id === rejectModal.dealId
                                ? { ...d, approval_status: 'rejected', approval_stage: null }
                                : d
                        ),
                    })),
                };
            });
            setToast(t('rejected'));
            setTimeout(() => setToast(null), 2000);
        } catch (err) {
            console.error("Failed to reject:", err);
        } finally {
            setApprovalLoading(false);
            setRejectModal(null);
            setRejectReason("");
        }
    };

    const openCreateDeal = async () => {
        setShowCreateDeal(true);
        if (activeTenantId) {
            const res = await api.fetch(`/crm/leads/${activeTenantId}?limit=200`);
            if (res?.success && Array.isArray(res.data)) setContacts(res.data);
        }
        if (stages.length > 0 && !dealForm.stageId) {
            setDealForm(f => ({ ...f, stageId: stages[0].id }));
        }
    };

    const handleCreateDeal = async () => {
        if (!activeTenantId || !dealForm.contactId || !dealForm.title || !dealForm.stageId) return;
        setDealCreating(true);
        try {
            await api.createDeal(activeTenantId, {
                contactId: dealForm.contactId,
                title: dealForm.title,
                value: Number(dealForm.value) || 0,
                stageId: dealForm.stageId,
                notes: dealForm.notes || undefined,
            });
            setDealForm({ contactId: "", title: "", value: "", stageId: "", notes: "" });
            setShowCreateDeal(false);
            const json = await api.fetch(`/crm/kanban/${activeTenantId}`);
            if (json.success && json.data) setKanban(json.data);
            setToast(t('dealCreated'));
            setTimeout(() => setToast(null), 2000);
        } catch {
            setToast(tc('errorSaving'));
            setTimeout(() => setToast(null), 2000);
        } finally {
            setDealCreating(false);
        }
    };

    // Load kanban from CRM API (opportunities grouped by stage)
    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            setLoading(true);
            try {
                const json = await api.fetch(`/crm/kanban/${activeTenantId}`);
                if (json.success && json.data) {
                    setKanban(json.data);
                    setIsLive(true);
                }
            } catch (err) {
                console.error("Failed to load kanban:", err);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [activeTenantId]);

    const stages = kanban?.stages || [];
    const forecast = kanban?.forecast || { total: 0, weighted: 0, dealCount: 0, avgDealValue: 0 };

    if (loading) {
        // Mini kanban skeleton — 4 columns of card stubs to telegraph the layout
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 animate-stagger">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-card border border-border rounded-xl p-3 space-y-2">
                        <div className="skeleton h-3 w-20" />
                        <div className="skeleton h-20 w-full rounded-md" />
                        <div className="skeleton h-16 w-full rounded-md" />
                        <div className="skeleton h-16 w-full rounded-md" />
                    </div>
                ))}
            </div>
        );
    }

    return (
        <>
            <div>
                {/* Header */}
                <PageHeader
                    title={vt.pipelineNoun.charAt(0).toUpperCase() + vt.pipelineNoun.slice(1)}
                    subtitle={t('subtitle')}
                    badge={<DataSourceBadge isLive={isLive} />}
                    action={
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">{forecast.dealCount} {t('deals')}</span>
                            <button
                                onClick={openCreateDeal}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity press-effect"
                            >
                                <Plus size={14} /> {t('newDeal')}
                            </button>
                            <button
                                onClick={() => router.push('/admin/settings/pipeline')}
                                className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent text-sm text-neutral-600 dark:text-neutral-300 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-1.5"
                            >
                                <GripVertical size={14} /> {t('customizeStages')}
                            </button>
                        </div>
                    }
                />

                <HelpPanel
                    title={tHelp("pipeline.title")}
                    description={tHelp("pipeline.description")}
                    tips={tHelp.raw("pipeline.tips") as string[]}
                />

                {/* Forecast Cards */}
                <div className="grid grid-cols-4 gap-3 mb-5">
                    {[
                        { key: "totalValue", icon: DollarSign, label: t('kpi.totalValue'), value: formatCurrency(forecast.total), color: "#3498db", bg: "bg-blue-500/10" },
                        { key: "weighted", icon: TrendingUp, label: t('kpi.weighted'), value: formatCurrency(Math.round(forecast.weighted)), color: "#2ecc71", bg: "bg-emerald-500/10" },
                        { key: "opportunities", icon: Target, label: t('kpi.opportunities'), value: String(forecast.dealCount), color: "#e67e22", bg: "bg-orange-500/10" },
                        { key: "average", icon: Users, label: t('kpi.average'), value: formatCurrency(Math.round(forecast.avgDealValue)), color: "#9b59b6", bg: "bg-purple-500/10" },
                    ].map(card => (
                        <Card key={card.key} className="border-border bg-card">
                            <CardContent className="flex items-center gap-3 p-3.5">
                                <div className={cn("w-10 h-10 rounded-[10px] flex items-center justify-center", card.bg)}>
                                    <card.icon size={20} color={card.color} />
                                </div>
                                <div>
                                    <div className="text-xl font-semibold">{card.value}</div>
                                    <div className="text-xs text-muted-foreground">{card.label}</div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Kanban Board */}
                <div className="flex gap-3 overflow-x-auto pb-4 min-h-[calc(100vh-320px)]">
                    {stages.map((stage: any) => {
                        const isDragOver = dragOverStage === stage.id;

                        return (
                            <div
                                key={stage.id}
                                onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id); }}
                                onDragLeave={() => setDragOverStage(null)}
                                onDrop={async () => {
                                    if (draggedDeal && activeTenantId) {
                                        // If dropping on a terminal stage, request approval instead
                                        if (stage.is_terminal) {
                                            setApprovalModal({ dealId: draggedDeal, targetStage: stage });
                                            setDragOverStage(null);
                                            setDraggedDeal(null);
                                            return;
                                        }
                                        // Optimistic update
                                        setKanban((prev: any) => {
                                            if (!prev) return prev;
                                            const allDeals = prev.stages.flatMap((s: any) => s.deals);
                                            const deal = allDeals.find((d: any) => d.id === draggedDeal);
                                            if (!deal) return prev;
                                            return {
                                                ...prev,
                                                stages: prev.stages.map((s: any) => ({
                                                    ...s,
                                                    deals: s.id === stage.id
                                                        ? [...s.deals.filter((d: any) => d.id !== draggedDeal), deal]
                                                        : s.deals.filter((d: any) => d.id !== draggedDeal),
                                                    dealCount: s.id === stage.id
                                                        ? s.deals.filter((d: any) => d.id !== draggedDeal).length + 1
                                                        : s.deals.filter((d: any) => d.id !== draggedDeal).length,
                                                })),
                                            };
                                        });
                                        // API call to persist
                                        try {
                                            await api.fetch(`/crm/kanban/${activeTenantId}/${draggedDeal}/move`, {
                                                method: "PUT",
                                                body: JSON.stringify({ stage: stage.id }),
                                            });
                                            const stageName = KNOWN_STAGE_KEYS.includes(stage.id) ? tc(`stages.${stage.id}`) : stage.name;
                                            setToast(t('movedTo', { stage: stageName }));
                                            setTimeout(() => setToast(null), 2000);
                                        } catch (err) {
                                            console.error("Failed to move opportunity:", err);
                                        }
                                    }
                                    setDragOverStage(null);
                                    setDraggedDeal(null);
                                }}
                                className={cn(
                                    "min-w-[260px] w-[260px] flex-shrink-0 flex flex-col rounded-xl transition-all duration-200",
                                    isDragOver
                                        ? "bg-indigo-600/5 border-2 border-dashed border-indigo-600"
                                        : "bg-card border border-border"
                                )}
                            >
                                {/* Stage Header */}
                                <div className="p-3 border-b border-border">
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-2.5 h-2.5 rounded-full"
                                                style={{ background: stage.color }}
                                            />
                                            <span className="font-semibold text-[13px]">{KNOWN_STAGE_KEYS.includes(stage.id) ? tc(`stages.${stage.id}`) : stage.name}</span>
                                            <span className="text-[11px] px-1.5 py-px rounded-full bg-neutral-100 dark:bg-neutral-800 text-muted-foreground">
                                                {stage.deals?.length || 0}
                                            </span>
                                        </div>
                                    </div>
                                    {stage.totalValue > 0 && (
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {formatCurrency(stage.totalValue)} COP
                                        </div>
                                    )}
                                </div>

                                {/* Deals */}
                                <div className="flex-1 p-2 flex flex-col gap-2 overflow-auto">
                                    {(stage.deals || []).map((deal: any) => (
                                        <div
                                            key={deal.id}
                                            draggable
                                            onDragStart={() => setDraggedDeal(deal.id)}
                                            onDragEnd={() => { setDraggedDeal(null); setDragOverStage(null); }}
                                            className={cn(
                                                "p-3 rounded-[10px] bg-background cursor-grab transition-all duration-150",
                                                draggedDeal === deal.id
                                                    ? "border border-indigo-600 opacity-50"
                                                    : "border border-border opacity-100"
                                            )}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="font-semibold text-[13px] leading-tight">{deal.title}</div>
                                                <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                                                    {canApprove && deal.approval_status === 'pending' && (
                                                        <>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleApprove(deal.id); }}
                                                                className="w-5 h-5 rounded flex items-center justify-center bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                                                                title={t('approve')}
                                                            >
                                                                <Check size={12} />
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setRejectModal({ dealId: deal.id }); }}
                                                                className="w-5 h-5 rounded flex items-center justify-center bg-red-500/15 text-red-500 hover:bg-red-500/30 transition-colors cursor-pointer"
                                                                title={t('reject')}
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        </>
                                                    )}
                                                    <GripVertical size={14} className="text-muted-foreground" />
                                                </div>
                                            </div>
                                            {deal.approval_status === 'pending' && (
                                                <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 font-semibold">
                                                    {t('approvalPending')}
                                                </span>
                                            )}
                                            {deal.approval_status === 'rejected' && (
                                                <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 font-semibold">
                                                    {t('approvalRejected')}
                                                </span>
                                            )}

                                            <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                                                <div
                                                    className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                                                    style={{ background: `linear-gradient(135deg, ${stage.color}, ${stage.color}88)` }}
                                                >
                                                    {deal.contactName.charAt(0)}
                                                </div>
                                                {deal.contactName}
                                            </div>

                                            <div className="flex justify-between items-center mt-2.5">
                                                <span className="text-[15px] font-semibold text-emerald-500">
                                                    {deal.value > 0 ? formatCurrency(deal.value) : "\u2014"}
                                                </span>
                                                <div className="flex gap-1.5 items-center">
                                                    {deal.daysInStage > 3 && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500">
                                                            {deal.daysInStage}d ⚠️
                                                        </span>
                                                    )}
                                                    {deal.score > 0 && (
                                                        <span className={cn(
                                                            "text-[10px] px-1.5 py-0.5 rounded font-semibold",
                                                            deal.score >= 7
                                                                ? "bg-emerald-500/15 text-emerald-500"
                                                                : "bg-amber-500/15 text-amber-500"
                                                        )}>
                                                            ★{deal.score}
                                                        </span>
                                                    )}
                                                    <span
                                                        className="text-[10px] px-1.5 py-0.5 rounded"
                                                        style={{ background: `${stage.color}22`, color: stage.color }}
                                                    >
                                                        {deal.probability}%
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {(!stage.deals || stage.deals.length === 0) && (
                                        <div className="p-5 text-center text-muted-foreground text-xs opacity-60">
                                            {t('dragHere')}
                                        </div>
                                    )}

                                </div>
                            </div>
                        );
                    })}
                </div>
                {!loading && forecast.dealCount === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Target size={48} className="text-muted-foreground opacity-20 mb-4" />
                        <p className="text-sm text-muted-foreground">
                            {tEmpty(vt.industry !== 'otro' ? `${vt.industry}.pipeline` : 'default.pipeline')}
                        </p>
                    </div>
                )}
            </div>

            {/* Create Deal Modal */}
            {showCreateDeal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateDeal(false)}>
                    <div className="bg-card border border-border rounded-xl p-6 w-[460px] shadow-xl" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-5">
                            <h3 className="text-lg font-semibold">{t('newDeal')}</h3>
                            <button onClick={() => setShowCreateDeal(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={18} /></button>
                        </div>
                        <div className="space-y-3.5">
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t('dealForm.contact')}</label>
                                <select
                                    value={dealForm.contactId}
                                    onChange={e => setDealForm(f => ({ ...f, contactId: e.target.value }))}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                >
                                    <option value="">{t('dealForm.selectContact')}</option>
                                    {contacts.map(c => (
                                        <option key={c.id} value={c.id}>
                                            {c.first_name || ''} {c.last_name || ''} {c.phone ? `(${c.phone})` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t('dealForm.title')}</label>
                                <input
                                    value={dealForm.title}
                                    onChange={e => setDealForm(f => ({ ...f, title: e.target.value }))}
                                    placeholder={t('dealForm.titlePlaceholder')}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">{t('dealForm.value')}</label>
                                    <input
                                        type="number"
                                        value={dealForm.value}
                                        onChange={e => setDealForm(f => ({ ...f, value: e.target.value }))}
                                        placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">{t('dealForm.stage')}</label>
                                    <select
                                        value={dealForm.stageId}
                                        onChange={e => setDealForm(f => ({ ...f, stageId: e.target.value }))}
                                        className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                    >
                                        {stages.map((s: any) => (
                                            <option key={s.id} value={s.id}>
                                                {KNOWN_STAGE_KEYS.includes(s.id) ? tc(`stages.${s.id}`) : s.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t('dealForm.notes')}</label>
                                <textarea
                                    value={dealForm.notes}
                                    onChange={e => setDealForm(f => ({ ...f, notes: e.target.value }))}
                                    placeholder={t('dealForm.notesPlaceholder')}
                                    rows={2}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none resize-none"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-5">
                            <button
                                onClick={() => setShowCreateDeal(false)}
                                className="px-4 py-2 rounded-lg border border-border text-sm cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                            >
                                {tc('cancel')}
                            </button>
                            <button
                                onClick={handleCreateDeal}
                                disabled={dealCreating || !dealForm.contactId || !dealForm.title}
                                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm cursor-pointer hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {dealCreating && <Loader2 size={14} className="animate-spin" />}
                                {tc('create')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Approval Request Modal */}
            {approvalModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setApprovalModal(null)}>
                    <div className="bg-card border border-border rounded-xl p-6 w-[400px] shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="font-semibold text-base mb-2">{t('requestApproval')}</h3>
                        <p className="text-sm text-muted-foreground mb-5">
                            {t('approvalRequired')}
                        </p>
                        <div className="flex items-center gap-2 mb-5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: approvalModal.targetStage.color }} />
                            <span className="text-sm font-semibold">
                                {KNOWN_STAGE_KEYS.includes(approvalModal.targetStage.id) ? tc(`stages.${approvalModal.targetStage.id}`) : approvalModal.targetStage.name}
                            </span>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setApprovalModal(null)}
                                className="px-4 py-2 rounded-lg border border-border text-sm cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                            >
                                {tc('cancel')}
                            </button>
                            <button
                                onClick={handleRequestApproval}
                                disabled={approvalLoading}
                                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm cursor-pointer hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {approvalLoading && <Loader2 size={14} className="animate-spin" />}
                                {tc('confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reject Reason Modal */}
            {rejectModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { setRejectModal(null); setRejectReason(""); }}>
                    <div className="bg-card border border-border rounded-xl p-6 w-[400px] shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="font-semibold text-base mb-4">{t('reject')}</h3>
                        <label className="text-sm text-muted-foreground mb-1.5 block">{t('rejectReason')}</label>
                        <textarea
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            className="w-full h-20 rounded-lg border border-border bg-background p-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-600"
                            autoFocus
                        />
                        <div className="flex justify-end gap-2 mt-4">
                            <button
                                onClick={() => { setRejectModal(null); setRejectReason(""); }}
                                className="px-4 py-2 rounded-lg border border-border text-sm cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                            >
                                {tc('cancel')}
                            </button>
                            <button
                                onClick={handleReject}
                                disabled={approvalLoading || !rejectReason.trim()}
                                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm cursor-pointer hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {approvalLoading && <Loader2 size={14} className="animate-spin" />}
                                {t('reject')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold bg-emerald-500 text-white shadow-[0_4px_20px_rgba(0,0,0,0.2)] animate-in slide-in-from-bottom-2 fade-in duration-300">
                    ✓ {toast}
                </div>
            )}
        </>
    );
}
