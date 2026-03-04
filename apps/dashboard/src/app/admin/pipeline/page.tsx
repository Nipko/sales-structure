"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import {
    DollarSign,
    TrendingUp,
    Target,
    Users,
    MoreVertical,
    Plus,
    Phone,
    Calendar,
    Clock,
    ChevronDown,
    GripVertical,
    ArrowRight,
} from "lucide-react";

// ============================================
// MOCK DATA
// ============================================

const mockStages = [
    {
        id: "s1", name: "Lead nuevo", color: "#95a5a6", position: 0,
        deals: [
            { id: "d1", title: "Grupo corporativo TechCorp", contactName: "Laura Martínez", value: 2400000, probability: 10, daysInStage: 2, contactPhone: "+57 312 890 1234" },
            { id: "d2", title: "Tour familiar Medina", contactName: "Carlos Medina", value: 900000, probability: 10, daysInStage: 0, contactPhone: "+57 310 456 7890" },
        ],
    },
    {
        id: "s2", name: "Contactado", color: "#3498db", position: 1,
        deals: [
            { id: "d3", title: "Combo aventura x4", contactName: "Ana García", value: 600000, probability: 25, daysInStage: 1, contactPhone: "+57 315 789 0123" },
        ],
    },
    {
        id: "s3", name: "Calificado", color: "#e67e22", position: 2,
        deals: [
            { id: "d4", title: "Rafting grupal", contactName: "Pedro Sánchez", value: 1200000, probability: 50, daysInStage: 3, contactPhone: "+57 318 567 8901" },
            { id: "d5", title: "Team building empresa", contactName: "María Pérez", value: 3500000, probability: 50, daysInStage: 5, contactPhone: "+57 301 234 5678" },
        ],
    },
    {
        id: "s4", name: "Propuesta enviada", color: "#9b59b6", position: 3,
        deals: [
            { id: "d6", title: "Parapente + almuerzo VIP", contactName: "Luis Rodríguez", value: 1800000, probability: 70, daysInStage: 2, contactPhone: "+57 320 123 4567" },
        ],
    },
    {
        id: "s5", name: "Negociación", color: "#f39c12", position: 4,
        deals: [
            { id: "d7", title: "Paquete fin de semana x10", contactName: "Laura Martínez", value: 5500000, probability: 85, daysInStage: 1, contactPhone: "+57 312 890 1234" },
        ],
    },
    { id: "s6", name: "Cerrado ganado", color: "#2ecc71", position: 5, deals: [] },
    { id: "s7", name: "Cerrado perdido", color: "#e74c3c", position: 6, deals: [] },
];

const formatCurrency = (n: number) => `$${n.toLocaleString()}`;

export default function PipelinePage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [stages, setStages] = useState(mockStages);
    const [draggedDeal, setDraggedDeal] = useState<string | null>(null);
    const [dragOverStage, setDragOverStage] = useState<string | null>(null);
    const [isLive, setIsLive] = useState(false);
    const [showNewDeal, setShowNewDeal] = useState(false);
    const [newDeal, setNewDeal] = useState({ title: "", contactName: "", contactPhone: "", value: "", stageId: "s1", probability: "10" });
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    // Load kanban from API
    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            const result = await api.getKanban(activeTenantId);
            if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                setStages(result.data);
                setIsLive(true);
            }
        }
        load();
    }, [activeTenantId]);

    const totalValue = stages.flatMap(s => s.deals).reduce((sum, d) => sum + d.value, 0);
    const weightedValue = stages.flatMap(s => s.deals).reduce((sum, d) => sum + d.value * (d.probability / 100), 0);
    const totalDeals = stages.flatMap(s => s.deals).length;

    const content = (
        <div>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Pipeline de Ventas</h1>
                        <DataSourceBadge isLive={isLive} />
                    </div>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                        Arrastra los deals entre etapas · {totalDeals} oportunidades abiertas
                    </p>
                </div>
                <button onClick={() => setShowNewDeal(true)} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
                    borderRadius: 10, border: "none", background: "var(--accent)", color: "white",
                    fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}>
                    <Plus size={18} /> Nuevo Deal
                </button>
            </div>

            {/* Forecast Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                {[
                    { icon: DollarSign, label: "Valor total", value: formatCurrency(totalValue), color: "#3498db" },
                    { icon: TrendingUp, label: "Ponderado", value: formatCurrency(Math.round(weightedValue)), color: "#2ecc71" },
                    { icon: Target, label: "Deals abiertos", value: String(totalDeals), color: "#e67e22" },
                    { icon: Users, label: "Valor promedio", value: formatCurrency(totalDeals > 0 ? Math.round(totalValue / totalDeals) : 0), color: "#9b59b6" },
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
                {stages.map(stage => {
                    const stageTotal = stage.deals.reduce((sum, d) => sum + d.value, 0);
                    const isDragOver = dragOverStage === stage.id;

                    return (
                        <div
                            key={stage.id}
                            onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id); }}
                            onDragLeave={() => setDragOverStage(null)}
                            onDrop={async () => {
                                if (draggedDeal && activeTenantId) {
                                    // Optimistic update: move deal in local state
                                    setStages(prev => {
                                        const allDeals = prev.flatMap(s => s.deals);
                                        const deal = allDeals.find(d => d.id === draggedDeal);
                                        if (!deal) return prev;
                                        return prev.map(s => ({
                                            ...s,
                                            deals: s.id === stage.id
                                                ? [...s.deals.filter(d => d.id !== draggedDeal), deal]
                                                : s.deals.filter(d => d.id !== draggedDeal),
                                        }));
                                    });
                                    // API call
                                    await api.moveDeal(activeTenantId, draggedDeal, stage.id);
                                    setToast(`Deal movido a ${stage.name}`);
                                    setTimeout(() => setToast(null), 2000);
                                }
                                setDragOverStage(null);
                                setDraggedDeal(null);
                            }}
                            style={{
                                minWidth: 280, width: 280, flexShrink: 0, display: "flex", flexDirection: "column",
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
                                        <span style={{ fontWeight: 600, fontSize: 14 }}>{stage.name}</span>
                                        <span style={{
                                            fontSize: 11, padding: "1px 6px", borderRadius: 10,
                                            background: "var(--bg-tertiary)", color: "var(--text-secondary)",
                                        }}>
                                            {stage.deals.length}
                                        </span>
                                    </div>
                                </div>
                                {stageTotal > 0 && (
                                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                                        {formatCurrency(stageTotal)} COP
                                    </div>
                                )}
                            </div>

                            {/* Deals */}
                            <div style={{ flex: 1, padding: 8, display: "flex", flexDirection: "column", gap: 8, overflow: "auto" }}>
                                {stage.deals.map(deal => (
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
                                                {formatCurrency(deal.value)}
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

                                {stage.deals.length === 0 && (
                                    <div style={{
                                        padding: 20, textAlign: "center", color: "var(--text-secondary)",
                                        fontSize: 12, opacity: 0.6,
                                    }}>
                                        Arrastra deals aquí
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    // ---- New Deal Modal ----
    async function handleCreateDeal() {
        if (!newDeal.title || !newDeal.value) return;
        setSaving(true);
        try {
            const dealData = {
                title: newDeal.title,
                contactId: "", // Will match by name
                value: parseInt(newDeal.value) || 0,
                stageId: newDeal.stageId,
                probability: parseInt(newDeal.probability) || 10,
            };
            if (activeTenantId) {
                await api.createDeal(activeTenantId, dealData);
            }
            // Optimistic add to local state
            const targetStage = stages.find(s => s.id === newDeal.stageId);
            setStages(prev => prev.map(s => {
                if (s.id !== newDeal.stageId) return s;
                return {
                    ...s,
                    deals: [...s.deals, {
                        id: `d${Date.now()}`,
                        title: newDeal.title,
                        contactName: newDeal.contactName || "Nuevo contacto",
                        value: parseInt(newDeal.value) || 0,
                        probability: parseInt(newDeal.probability) || 10,
                        daysInStage: 0,
                        contactPhone: newDeal.contactPhone || "",
                    }],
                };
            }));
            setShowNewDeal(false);
            setNewDeal({ title: "", contactName: "", contactPhone: "", value: "", stageId: "s1", probability: "10" });
            setToast("Deal creado exitosamente");
            setTimeout(() => setToast(null), 2000);
        } finally {
            setSaving(false);
        }
    }

    const modalOverlay = showNewDeal ? (
        <div style={{
            position: "fixed", inset: 0, zIndex: 1000, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
        }} onClick={() => setShowNewDeal(false)}>
            <div onClick={e => e.stopPropagation()} style={{
                width: 440, padding: 28, borderRadius: 18,
                background: "var(--bg-secondary)", border: "1px solid var(--border)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Nuevo Deal</h2>
                {[
                    { key: "title", label: "Título del deal", placeholder: "Paquete aventura x4" },
                    { key: "contactName", label: "Nombre del contacto", placeholder: "Carlos Medina" },
                    { key: "contactPhone", label: "Teléfono", placeholder: "+57 310 456 7890" },
                    { key: "value", label: "Valor (COP)", placeholder: "1500000", type: "number" },
                    { key: "probability", label: "Probabilidad (%)", placeholder: "50", type: "number" },
                ].map(field => (
                    <div key={field.key} style={{ marginBottom: 14 }}>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                            {field.label}
                        </label>
                        <input
                            value={(newDeal as any)[field.key]}
                            onChange={e => setNewDeal(prev => ({ ...prev, [field.key]: e.target.value }))}
                            placeholder={field.placeholder}
                            type={field.type || "text"}
                            style={{
                                width: "100%", padding: "10px 12px", borderRadius: 8,
                                border: "1px solid var(--border)", background: "var(--bg-primary)",
                                color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box",
                            }}
                        />
                    </div>
                ))}
                <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Etapa
                    </label>
                    <select
                        value={newDeal.stageId}
                        onChange={e => setNewDeal(prev => ({ ...prev, stageId: e.target.value }))}
                        style={{
                            width: "100%", padding: "10px 12px", borderRadius: 8,
                            border: "1px solid var(--border)", background: "var(--bg-primary)",
                            color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box",
                        }}
                    >
                        {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button onClick={() => setShowNewDeal(false)} style={{
                        flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)",
                        background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer",
                    }}>Cancelar</button>
                    <button onClick={handleCreateDeal} disabled={saving || !newDeal.title || !newDeal.value} style={{
                        flex: 1, padding: "10px", borderRadius: 10, border: "none",
                        background: saving ? "var(--border)" : "var(--accent)", color: "white",
                        fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer",
                    }}>{saving ? "Guardando..." : "Crear Deal"}</button>
                </div>
            </div>
        </div>
    ) : null;

    const toastElement = toast ? (
        <div style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 1100,
            padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600,
            background: "#2ecc71", color: "white", boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            animation: "slideUp 0.3s ease",
        }}>
            ✓ {toast}
        </div>
    ) : null;

    return (
        <>
            {content}
            {modalOverlay}
            {toastElement}
            <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </>
    );
}
