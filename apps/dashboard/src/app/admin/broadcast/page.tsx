"use client";

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

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
    draft: { label: "Borrador", color: "#95a5a6", icon: FileText },
    scheduled: { label: "Programada", color: "#f39c12", icon: Calendar },
    sending: { label: "Enviando", color: "#3498db", icon: Zap },
    sent: { label: "Enviada", color: "#2ecc71", icon: CheckCircle2 },
    failed: { label: "Fallida", color: "#e74c3c", icon: AlertCircle },
};

export default function BroadcastPage() {
    const t = useTranslations('broadcast');
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
            setToast("Campana creada exitosamente");
            setTimeout(() => setToast(null), 2000);
        } else {
            setCreating(false);
            setToast("Error al crear campana");
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
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-[28px] font-bold m-0 flex items-center gap-2.5">
                            <Megaphone size={28} className="text-primary" /> {t('title')}
                            <DataSourceBadge isLive={false} />
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            {stats.total} campanas · {stats.totalRecipients} destinatarios totales
                        </p>
                    </div>
                    <button
                        onClick={() => setShowNewCampaign(true)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer"
                    >
                        <Plus size={18} /> Nueva Campana
                    </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                    {[
                        { label: "Campanas", value: stats.total, color: "#6c5ce7", icon: Megaphone },
                        { label: "Enviadas", value: stats.sent, color: "#2ecc71", icon: Send },
                        { label: "Programadas", value: stats.scheduled, color: "#f39c12", icon: Calendar },
                        { label: "Respuestas", value: stats.totalReplies, color: "#9b59b6", icon: MessageSquare },
                    ].map(stat => (
                        <div key={stat.label} className="p-5 rounded-[14px] bg-card border border-border">
                            <div className="flex justify-between items-center">
                                <div>
                                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{stat.label}</div>
                                    <div className="text-[28px] font-bold mt-1">{stat.value}</div>
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
                        const sc = statusConfig[campaign.status];
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
                                                <Icon size={12} /> {sc.label}
                                            </span>
                                        </div>
                                        <div className="text-[13px] text-muted-foreground mb-2.5 leading-snug max-w-[600px]">
                                            {campaign.template.length > 120 ? campaign.template.slice(0, 120) + "..." : campaign.template}
                                        </div>
                                        {campaign.status === "sent" && (
                                            <div className="flex gap-5 text-xs">
                                                <span className="flex items-center gap-1">
                                                    <Target size={12} className="text-muted-foreground" />
                                                    <strong>{campaign.recipientCount}</strong> destinatarios
                                                </span>
                                                <span className="text-emerald-500">📬 {deliveryRate}% entregados</span>
                                                <span className="text-blue-500">👁️ {readRate}% leidos</span>
                                                <span className="text-purple-500">💬 {replyRate}% respondieron</span>
                                            </div>
                                        )}
                                        {campaign.status === "scheduled" && campaign.scheduledAt && (
                                            <div className="text-xs text-amber-500 flex items-center gap-1">
                                                <Clock size={12} /> Programada: {campaign.scheduledAt}
                                            </div>
                                        )}
                                        {campaign.status === "draft" && (
                                            <div className="text-xs text-muted-foreground">
                                                Borrador — sin programar
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
                                            <span>🟣 respondido</span>
                                            <span>🔵 leido</span>
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
                <div
                    className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onClick={() => setShowNewCampaign(false)}
                >
                    <div onClick={e => e.stopPropagation()} className="w-[500px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-bold m-0">Nueva Campana</h2>
                            <button onClick={() => setShowNewCampaign(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">Nombre de la campana</label>
                            <input value={newCampaign.name} onChange={e => setNewCampaign(p => ({ ...p, name: e.target.value }))} placeholder="Promo Verano 2026 ☀️" className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                        </div>
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                Mensaje template <span className="font-normal">(usa {"{{name}}"} para personalizar)</span>
                            </label>
                            <textarea value={newCampaign.template} onChange={e => setNewCampaign(p => ({ ...p, template: e.target.value }))} placeholder={"¡Hola {{name}}! Tenemos una oferta especial para ti..."} rows={4} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border resize-y" />
                        </div>
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">Fecha de envio (opcional)</label>
                            <input type="datetime-local" value={newCampaign.scheduledAt} onChange={e => setNewCampaign(p => ({ ...p, scheduledAt: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                            <div className="text-[11px] text-muted-foreground mt-1">Dejar vacio para guardar como borrador</div>
                        </div>
                        <div className="p-3.5 rounded-[10px] bg-primary/[0.08] border border-primary/15 mb-3.5">
                            <div className="text-xs font-semibold text-primary mb-1">📋 Vista previa del mensaje</div>
                            <div className="text-[13px] text-foreground leading-relaxed">
                                {newCampaign.template ? newCampaign.template.replace(/\{\{name\}\}/g, "Carlos Medina") : "Tu mensaje aparecera aqui..."}
                            </div>
                        </div>
                        <div className="flex gap-2.5 mt-5">
                            <button onClick={() => setShowNewCampaign(false)} className="flex-1 py-2.5 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer">Cancelar</button>
                            <button
                                onClick={handleCreateCampaign}
                                disabled={!newCampaign.name || !newCampaign.template}
                                className={cn(
                                    "flex-1 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold",
                                    (!newCampaign.name || !newCampaign.template) ? "bg-muted cursor-not-allowed" : "bg-primary cursor-pointer"
                                )}
                            >
                                {newCampaign.scheduledAt ? "📅 Programar" : "📝 Guardar borrador"}
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
