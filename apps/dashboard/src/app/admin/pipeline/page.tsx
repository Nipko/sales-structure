"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";
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

const formatCurrency = (n: number) => `$${n.toLocaleString()}`;

export default function PipelinePage() {
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, gap: 12, color: "var(--text-secondary)" }}>
                <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} />
                Cargando pipeline...
                <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    return (
        <>
            <div>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Pipeline de Ventas</h1>
                            <DataSourceBadge isLive={isLive} />
                        </div>
                        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                            Arrastra las oportunidades entre etapas · {forecast.dealCount} oportunidades abiertas
                        </p>
                    </div>
                </div>

                {/* Forecast Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                    {[
                        { icon: DollarSign, label: "Valor total", value: formatCurrency(forecast.total), color: "#3498db" },
                        { icon: TrendingUp, label: "Ponderado", value: formatCurrency(Math.round(forecast.weighted)), color: "#2ecc71" },
                        { icon: Target, label: "Oportunidades", value: String(forecast.dealCount), color: "#e67e22" },
                        { icon: Users, label: "Promedio", value: formatCurrency(Math.round(forecast.avgDealValue)), color: "#9b59b6" },
                    ].map(card => (
                        <div key={card.label} style={{
                            padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border)",
                            background: "var(--bg-secondary)", display: "flex", alignItems: "center", gap: 12,
                        }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
                                background: `${card.color}22`,
                            }}>
                                <card.icon size={20} color={card.color} />
                            </div>
                            <div>
                                <div style={{ fontSize: 20, fontWeight: 700 }}>{card.value}</div>
                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{card.label}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Kanban Board */}
                <div style={{
                    display: "flex", gap: 12, overflowX: "auto", paddingBottom: 16,
                    minHeight: "calc(100vh - 320px)",
                }}>
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
                                style={{
                                    minWidth: 260, width: 260, flexShrink: 0, display: "flex", flexDirection: "column",
                                    background: isDragOver ? "rgba(108, 92, 231, 0.05)" : "var(--bg-secondary)",
                                    borderRadius: 12, border: isDragOver ? "2px dashed var(--accent)" : "1px solid var(--border)",
                                    transition: "all 0.2s ease",
                                }}
                            >
                                {/* Stage Header */}
                                <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <div style={{
                                                width: 10, height: 10, borderRadius: "50%",
                                                background: stage.color,
                                            }} />
                                            <span style={{ fontWeight: 600, fontSize: 13 }}>{stage.name}</span>
                                            <span style={{
                                                fontSize: 11, padding: "1px 6px", borderRadius: 10,
                                                background: "var(--bg-tertiary)", color: "var(--text-secondary)",
                                            }}>
                                                {stage.deals?.length || 0}
                                            </span>
                                        </div>
                                    </div>
                                    {stage.totalValue > 0 && (
                                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                                            {formatCurrency(stage.totalValue)} COP
                                        </div>
                                    )}
                                </div>

                                {/* Deals */}
                                <div style={{ flex: 1, padding: 8, display: "flex", flexDirection: "column", gap: 8, overflow: "auto" }}>
                                    {(stage.deals || []).map((deal: any) => (
                                        <div
                                            key={deal.id}
                                            draggable
                                            onDragStart={() => setDraggedDeal(deal.id)}
                                            onDragEnd={() => { setDraggedDeal(null); setDragOverStage(null); }}
                                            style={{
                                                padding: "12px", borderRadius: 10,
                                                background: "var(--bg-primary)",
                                                border: draggedDeal === deal.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                                                cursor: "grab", transition: "all 0.15s ease",
                                                opacity: draggedDeal === deal.id ? 0.5 : 1,
                                            }}
                                        >
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                                <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>{deal.title}</div>
                                                <GripVertical size={14} color="var(--text-secondary)" style={{ flexShrink: 0, marginTop: 2 }} />
                                            </div>

                                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                                                <div style={{
                                                    width: 22, height: 22, borderRadius: "50%",
                                                    background: `linear-gradient(135deg, ${stage.color}, ${stage.color}88)`,
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                    fontSize: 10, fontWeight: 700, color: "white",
                                                }}>
                                                    {deal.contactName.charAt(0)}
                                                </div>
                                                {deal.contactName}
                                            </div>

                                            <div style={{
                                                display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10,
                                            }}>
                                                <span style={{ fontSize: 15, fontWeight: 700, color: "#2ecc71" }}>
                                                    {deal.value > 0 ? formatCurrency(deal.value) : "—"}
                                                </span>
                                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                                    {deal.daysInStage > 3 && (
                                                        <span style={{
                                                            fontSize: 10, padding: "2px 6px", borderRadius: 4,
                                                            background: "rgba(231, 76, 60, 0.15)", color: "#e74c3c",
                                                        }}>
                                                            {deal.daysInStage}d ⚠️
                                                        </span>
                                                    )}
                                                    {deal.score > 0 && (
                                                        <span style={{
                                                            fontSize: 10, padding: "2px 6px", borderRadius: 4,
                                                            background: deal.score >= 7 ? "rgba(46,204,113,0.15)" : "rgba(243,156,18,0.15)",
                                                            color: deal.score >= 7 ? "#2ecc71" : "#f39c12",
                                                            fontWeight: 600,
                                                        }}>
                                                            ★{deal.score}
                                                        </span>
                                                    )}
                                                    <span style={{
                                                        fontSize: 10, padding: "2px 6px", borderRadius: 4,
                                                        background: `${stage.color}22`, color: stage.color,
                                                    }}>
                                                        {deal.probability}%
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {(!stage.deals || stage.deals.length === 0) && (
                                        <div style={{
                                            padding: 20, textAlign: "center", color: "var(--text-secondary)",
                                            fontSize: 12, opacity: 0.6,
                                        }}>
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
                <div style={{
                    position: "fixed", bottom: 24, right: 24, zIndex: 1100,
                    padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600,
                    background: "#2ecc71", color: "white", boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
                    animation: "slideUp 0.3s ease",
                }}>
                    ✓ {toast}
                </div>
            )}
            <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </>
    );
}
