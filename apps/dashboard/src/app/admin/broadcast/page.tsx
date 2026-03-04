"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import {
    Send, Users, MessageSquare, Calendar, Clock, Plus, X,
    CheckCircle2, AlertCircle, Megaphone, BarChart3, Target,
    FileText, Zap, ChevronRight,
} from "lucide-react";

// ============================================
// MOCK DATA
// ============================================
const mockCampaigns = [
    {
        id: "c1", name: "Promo Semana Santa 🏖️", status: "sent" as const,
        channel: "whatsapp", recipientCount: 245, deliveredCount: 238, readCount: 189, repliedCount: 42,
        scheduledAt: "2026-03-01 09:00", sentAt: "2026-03-01 09:00",
        template: "¡Hola {{name}}! Esta Semana Santa vive la aventura con 20% OFF en todos nuestros paquetes. 🌊🏔️",
    },
    {
        id: "c2", name: "Follow-up clientes inactivos", status: "sent" as const,
        channel: "whatsapp", recipientCount: 87, deliveredCount: 84, readCount: 61, repliedCount: 15,
        scheduledAt: "2026-02-25 14:00", sentAt: "2026-02-25 14:00",
        template: "¡Hola {{name}}! Te extrañamos en Gecko Aventura. ¿Listo para tu próxima aventura? 🎒",
    },
    {
        id: "c3", name: "Lanzamiento Rafting Nocturno 🌙", status: "scheduled" as const,
        channel: "whatsapp", recipientCount: 312, deliveredCount: 0, readCount: 0, repliedCount: 0,
        scheduledAt: "2026-03-10 08:00", sentAt: null,
        template: "¡NOVEDAD! Rafting bajo las estrellas 🌙 Sé de los primeros en vivir esta experiencia única. Cupos limitados.",
    },
    {
        id: "c4", name: "Encuesta de satisfacción", status: "draft" as const,
        channel: "whatsapp", recipientCount: 0, deliveredCount: 0, readCount: 0, repliedCount: 0,
        scheduledAt: null, sentAt: null,
        template: "¡Hola {{name}}! ¿Cómo fue tu experiencia con nosotros? Tu opinión nos ayuda a mejorar. Responde 1-5 ⭐",
    },
];

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
    draft: { label: "Borrador", color: "#95a5a6", icon: FileText },
    scheduled: { label: "Programada", color: "#f39c12", icon: Calendar },
    sending: { label: "Enviando", color: "#3498db", icon: Zap },
    sent: { label: "Enviada", color: "#2ecc71", icon: CheckCircle2 },
    failed: { label: "Fallida", color: "#e74c3c", icon: AlertCircle },
};

export default function BroadcastPage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [campaigns, setCampaigns] = useState(mockCampaigns);
    const [showNewCampaign, setShowNewCampaign] = useState(false);
    const [newCampaign, setNewCampaign] = useState({ name: "", template: "", scheduledAt: "" });
    const [selectedCampaign, setSelectedCampaign] = useState<typeof mockCampaigns[0] | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const stats = {
        total: campaigns.length,
        sent: campaigns.filter(c => c.status === "sent").length,
        scheduled: campaigns.filter(c => c.status === "scheduled").length,
        totalRecipients: campaigns.reduce((s, c) => s + c.recipientCount, 0),
        totalReplies: campaigns.reduce((s, c) => s + c.repliedCount, 0),
    };

    function handleCreateCampaign() {
        if (!newCampaign.name || !newCampaign.template) return;
        setCampaigns(prev => [...prev, {
            id: `c${Date.now()}`,
            name: newCampaign.name,
            status: (newCampaign.scheduledAt ? "scheduled" : "draft") as any,
            channel: "whatsapp",
            recipientCount: 0,
            deliveredCount: 0,
            readCount: 0,
            repliedCount: 0,
            scheduledAt: newCampaign.scheduledAt || null,
            sentAt: null,
            template: newCampaign.template,
        }]);
        setShowNewCampaign(false);
        setNewCampaign({ name: "", template: "", scheduledAt: "" });
        setToast("Campaña creada exitosamente");
        setTimeout(() => setToast(null), 2000);
    }

    return (
        <>
            <div>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                            <Megaphone size={28} color="var(--accent)" /> Broadcast & Campañas
                            <DataSourceBadge isLive={false} />
                        </h1>
                        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                            {stats.total} campañas · {stats.totalRecipients} destinatarios totales
                        </p>
                    </div>
                    <button onClick={() => setShowNewCampaign(true)} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
                        borderRadius: 10, border: "none", background: "var(--accent)", color: "white",
                        fontWeight: 600, fontSize: 14, cursor: "pointer",
                    }}>
                        <Plus size={18} /> Nueva Campaña
                    </button>
                </div>

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                    {[
                        { label: "Campañas", value: stats.total, color: "var(--accent)", icon: Megaphone },
                        { label: "Enviadas", value: stats.sent, color: "#2ecc71", icon: Send },
                        { label: "Programadas", value: stats.scheduled, color: "#f39c12", icon: Calendar },
                        { label: "Respuestas", value: stats.totalReplies, color: "#9b59b6", icon: MessageSquare },
                    ].map(stat => (
                        <div key={stat.label} style={{
                            padding: 20, borderRadius: 14, background: "var(--bg-secondary)",
                            border: "1px solid var(--border)",
                        }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>{stat.label}</div>
                                    <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{stat.value}</div>
                                </div>
                                <div style={{ width: 44, height: 44, borderRadius: 12, background: `${stat.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <stat.icon size={22} color={stat.color} />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Campaign List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {campaigns.map(campaign => {
                        const sc = statusConfig[campaign.status];
                        const Icon = sc.icon;
                        const deliveryRate = campaign.recipientCount > 0 ? Math.round((campaign.deliveredCount / campaign.recipientCount) * 100) : 0;
                        const readRate = campaign.deliveredCount > 0 ? Math.round((campaign.readCount / campaign.deliveredCount) * 100) : 0;
                        const replyRate = campaign.deliveredCount > 0 ? Math.round((campaign.repliedCount / campaign.deliveredCount) * 100) : 0;

                        return (
                            <div key={campaign.id} onClick={() => setSelectedCampaign(campaign)} style={{
                                padding: 20, borderRadius: 14, background: "var(--bg-secondary)",
                                border: `1px solid ${selectedCampaign?.id === campaign.id ? "var(--accent)" : "var(--border)"}`,
                                cursor: "pointer", transition: "border-color 0.2s ease",
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                                            <span style={{ fontSize: 16, fontWeight: 600 }}>{campaign.name}</span>
                                            <span style={{
                                                fontSize: 10, padding: "3px 8px", borderRadius: 6,
                                                background: `${sc.color}15`, color: sc.color, fontWeight: 600,
                                                display: "flex", alignItems: "center", gap: 4,
                                            }}>
                                                <Icon size={12} /> {sc.label}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.4, maxWidth: 600 }}>
                                            {campaign.template.length > 120 ? campaign.template.slice(0, 120) + "..." : campaign.template}
                                        </div>
                                        {campaign.status === "sent" && (
                                            <div style={{ display: "flex", gap: 20, fontSize: 12 }}>
                                                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                    <Target size={12} color="var(--text-secondary)" />
                                                    <strong>{campaign.recipientCount}</strong> destinatarios
                                                </span>
                                                <span style={{ color: "#2ecc71" }}>
                                                    📬 {deliveryRate}% entregados
                                                </span>
                                                <span style={{ color: "#3498db" }}>
                                                    👁️ {readRate}% leídos
                                                </span>
                                                <span style={{ color: "#9b59b6" }}>
                                                    💬 {replyRate}% respondieron
                                                </span>
                                            </div>
                                        )}
                                        {campaign.status === "scheduled" && campaign.scheduledAt && (
                                            <div style={{ fontSize: 12, color: "#f39c12", display: "flex", alignItems: "center", gap: 4 }}>
                                                <Clock size={12} /> Programada: {campaign.scheduledAt}
                                            </div>
                                        )}
                                        {campaign.status === "draft" && (
                                            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                                Borrador — sin programar
                                            </div>
                                        )}
                                    </div>
                                    <ChevronRight size={20} color="var(--text-secondary)" />
                                </div>

                                {/* Progress bar for sent campaigns */}
                                {campaign.status === "sent" && campaign.recipientCount > 0 && (
                                    <div style={{ marginTop: 12 }}>
                                        <div style={{ height: 6, borderRadius: 3, background: "var(--bg-tertiary)", overflow: "hidden", display: "flex" }}>
                                            <div style={{ width: `${replyRate}%`, background: "#9b59b6", transition: "width 0.5s ease" }} />
                                            <div style={{ width: `${readRate - replyRate}%`, background: "#3498db", transition: "width 0.5s ease" }} />
                                            <div style={{ width: `${deliveryRate - readRate}%`, background: "#2ecc71", transition: "width 0.5s ease" }} />
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 4, fontSize: 10, color: "var(--text-secondary)" }}>
                                            <span>🟣 respondido</span>
                                            <span>🔵 leído</span>
                                            <span>🟢 entregado</span>
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
                <div style={{
                    position: "fixed", inset: 0, zIndex: 1000, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
                }} onClick={() => setShowNewCampaign(false)}>
                    <div onClick={e => e.stopPropagation()} style={{
                        width: 500, padding: 28, borderRadius: 18,
                        background: "var(--bg-secondary)", border: "1px solid var(--border)",
                        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Nueva Campaña</h2>
                            <button onClick={() => setShowNewCampaign(false)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}><X size={20} /></button>
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Nombre de la campaña</label>
                            <input value={newCampaign.name} onChange={e => setNewCampaign(p => ({ ...p, name: e.target.value }))} placeholder="Promo Verano 2026 ☀️" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                                Mensaje template <span style={{ fontWeight: 400 }}>(usa {"{{name}}"} para personalizar)</span>
                            </label>
                            <textarea value={newCampaign.template} onChange={e => setNewCampaign(p => ({ ...p, template: e.target.value }))} placeholder={"¡Hola {{name}}! Tenemos una oferta especial para ti..."} rows={4} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box", resize: "vertical" }} />
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Fecha de envío (opcional)</label>
                            <input type="datetime-local" value={newCampaign.scheduledAt} onChange={e => setNewCampaign(p => ({ ...p, scheduledAt: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                                Dejar vacío para guardar como borrador
                            </div>
                        </div>
                        <div style={{ padding: 14, borderRadius: 10, background: "rgba(108,92,231,0.08)", border: "1px solid rgba(108,92,231,0.15)", marginBottom: 14 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", marginBottom: 4 }}>📋 Vista previa del mensaje</div>
                            <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>
                                {newCampaign.template ? newCampaign.template.replace(/\{\{name\}\}/g, "Carlos Medina") : "Tu mensaje aparecerá aquí..."}
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                            <button onClick={() => setShowNewCampaign(false)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer" }}>Cancelar</button>
                            <button onClick={handleCreateCampaign} disabled={!newCampaign.name || !newCampaign.template} style={{
                                flex: 1, padding: "10px", borderRadius: 10, border: "none",
                                background: (!newCampaign.name || !newCampaign.template) ? "var(--border)" : "var(--accent)", color: "white",
                                fontSize: 14, fontWeight: 600, cursor: (!newCampaign.name || !newCampaign.template) ? "not-allowed" : "pointer",
                            }}>
                                {newCampaign.scheduledAt ? "📅 Programar" : "📝 Guardar borrador"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
