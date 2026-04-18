"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";
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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const formatCurrency = (n: number) => `$${n.toLocaleString()}`;

export default function PipelinePage() {
    const t = useTranslations('pipeline');
    const { activeTenantId } = useTenant();
    const [kanban, setKanban] = useState<any>(null);
    const [draggedDeal, setDraggedDeal] = useState<string | null>(null);
    const [dragOverStage, setDragOverStage] = useState<string | null>(null);
    const [isLive, setIsLive] = useState(false);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<string | null>(null);

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
        return (
            <div className="flex items-center justify-center h-[400px] gap-3 text-muted-foreground">
                <Loader2 size={24} className="animate-spin" />
                Cargando pipeline...
            </div>
        );
    }

    return (
        <>
            <div>
                {/* Header */}
                <PageHeader
                    title={t('title')}
                    subtitle={`${forecast.dealCount} ${t('subtitle') || 'deals'}`}
                    badge={<DataSourceBadge isLive={isLive} />}
                />

                {/* Forecast Cards */}
                <div className="grid grid-cols-4 gap-3 mb-5">
                    {[
                        { icon: DollarSign, label: "Valor total", value: formatCurrency(forecast.total), color: "#3498db", bg: "bg-blue-500/10" },
                        { icon: TrendingUp, label: "Ponderado", value: formatCurrency(Math.round(forecast.weighted)), color: "#2ecc71", bg: "bg-emerald-500/10" },
                        { icon: Target, label: "Oportunidades", value: String(forecast.dealCount), color: "#e67e22", bg: "bg-orange-500/10" },
                        { icon: Users, label: "Promedio", value: formatCurrency(Math.round(forecast.avgDealValue)), color: "#9b59b6", bg: "bg-purple-500/10" },
                    ].map(card => (
                        <Card key={card.label} className="border-border bg-card">
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
                                            setToast(`Oportunidad movida a ${stage.name}`);
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
                                            <span className="font-semibold text-[13px]">{stage.name}</span>
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
                                                <GripVertical size={14} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                                            </div>

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
                                            Arrastra oportunidades aquí
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold bg-emerald-500 text-white shadow-[0_4px_20px_rgba(0,0,0,0.2)] animate-in slide-in-from-bottom-2 fade-in duration-300">
                    ✓ {toast}
                </div>
            )}
        </>
    );
}
