"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import {
    Users,
    CheckCircle,
    XCircle,
    Clock,
    MessageSquare,
    MessageCircle,
    Instagram,
    ArrowRight,
    Loader2,
} from "lucide-react";

// ---- Styles ----
const card = {
    background: "var(--bg-secondary, #12121e)",
    border: "1px solid var(--border, #2a2a45)",
    borderRadius: 16,
    overflow: "hidden" as const,
};

const channelColors: Record<string, { bg: string; color: string; label: string }> = {
    whatsapp: { bg: "rgba(37, 211, 102, 0.15)", color: "#25D366", label: "WhatsApp" },
    instagram: { bg: "rgba(228, 64, 95, 0.15)", color: "#E4405F", label: "Instagram" },
    messenger: { bg: "rgba(0, 132, 255, 0.15)", color: "#0084FF", label: "Messenger" },
};

const matchTypeStyles: Record<string, { bg: string; color: string; label: string }> = {
    phone_match: { bg: "rgba(0, 214, 143, 0.15)", color: "var(--success, #00d68f)", label: "Telefono" },
    email_match: { bg: "rgba(108, 92, 231, 0.15)", color: "var(--accent, #6c5ce7)", label: "Email" },
};

function ChannelBadge({ channel }: { channel: string }) {
    const style = channelColors[channel] || { bg: "rgba(152,152,176,0.15)", color: "#9898b0", label: channel };
    const IconMap: Record<string, any> = { whatsapp: MessageSquare, instagram: Instagram, messenger: MessageCircle };
    const Icon = IconMap[channel] || MessageSquare;
    return (
        <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 10px",
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
            background: style.bg,
            color: style.color,
        }}>
            <Icon size={12} />
            {style.label}
        </span>
    );
}

export default function IdentityPage() {
    const { activeTenantId } = useTenant();

    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [message, setMessage] = useState({ type: "", text: "" });

    const loadSuggestions = async () => {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const data = await api.fetch(`/identity/${activeTenantId}/suggestions`);
            setSuggestions(Array.isArray(data) ? data : data?.data || []);
        } catch (err) {
            console.error("Failed to load identity suggestions", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadSuggestions(); }, [activeTenantId]);

    const handleAction = async (id: string, action: "approve" | "reject") => {
        setActionLoading(id);
        setMessage({ type: "", text: "" });
        try {
            await api.fetch(`/identity/${activeTenantId}/suggestions/${id}/${action}`, { method: "POST" });
            setMessage({
                type: "success",
                text: action === "approve" ? "Contactos fusionados correctamente." : "Sugerencia rechazada.",
            });
            await loadSuggestions();
        } catch (err: any) {
            setMessage({ type: "error", text: err.message || "Error al procesar la sugerencia." });
        } finally {
            setActionLoading(null);
        }
    };

    const pending = suggestions.filter((s) => s.status === "pending");
    const approved = suggestions.filter((s) => s.status === "approved");
    const rejected = suggestions.filter((s) => s.status === "rejected");

    if (loading) {
        return (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-secondary, #9898b0)" }}>
                Cargando sugerencias de identidad...
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1060, margin: "0 auto" }}>
            {/* Header */}
            <div style={{ marginBottom: 32 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <div style={{
                        background: "var(--accent, #6c5ce7)",
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}>
                        <Users size={20} color="white" />
                    </div>
                    <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "var(--text-primary, #e8e8f0)" }}>
                        Identidad Unificada
                    </h1>
                </div>
                <p style={{ color: "var(--text-secondary, #9898b0)", margin: "4px 0 0", paddingLeft: 50 }}>
                    Gestiona la identidad de tus clientes entre canales
                </p>
            </div>

            {/* Alert Message */}
            {message.text && (
                <div style={{
                    padding: 16,
                    borderRadius: 12,
                    marginBottom: 24,
                    fontSize: 14,
                    background: message.type === "error" ? "rgba(255, 71, 87, 0.1)" : "rgba(0, 214, 143, 0.1)",
                    color: message.type === "error" ? "var(--danger, #ff4757)" : "var(--success, #00d68f)",
                    border: `1px solid ${message.type === "error" ? "rgba(255, 71, 87, 0.2)" : "rgba(0, 214, 143, 0.2)"}`,
                }}>
                    {message.text}
                </div>
            )}

            {/* Stats Row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 32 }}>
                {[
                    { label: "Pendientes", count: pending.length, color: "var(--warning, #ffaa00)", Icon: Clock },
                    { label: "Aprobadas", count: approved.length, color: "var(--success, #00d68f)", Icon: CheckCircle },
                    { label: "Rechazadas", count: rejected.length, color: "var(--danger, #ff4757)", Icon: XCircle },
                ].map((stat) => (
                    <div key={stat.label} style={{
                        ...card,
                        padding: 24,
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                    }}>
                        <div style={{
                            width: 44,
                            height: 44,
                            borderRadius: 12,
                            background: `${stat.color}15`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}>
                            <stat.Icon size={22} color={stat.color} />
                        </div>
                        <div>
                            <p style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "var(--text-primary, #e8e8f0)" }}>
                                {stat.count}
                            </p>
                            <p style={{ fontSize: 13, color: "var(--text-secondary, #9898b0)", margin: 0 }}>
                                {stat.label}
                            </p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Suggestions List */}
            <div style={card}>
                <div style={{
                    padding: "20px 24px",
                    borderBottom: "1px solid var(--border, #2a2a45)",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                }}>
                    <Users size={18} color="var(--accent, #6c5ce7)" />
                    <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--text-primary, #e8e8f0)" }}>
                        Sugerencias Pendientes
                    </h2>
                    <span style={{ fontSize: 12, color: "var(--text-secondary, #9898b0)", marginLeft: "auto" }}>
                        {pending.length} sugerencia{pending.length !== 1 ? "s" : ""}
                    </span>
                </div>

                {pending.length === 0 ? (
                    <div style={{
                        padding: 60,
                        textAlign: "center",
                        color: "var(--text-secondary, #9898b0)",
                    }}>
                        <Users size={40} style={{ opacity: 0.3, marginBottom: 16 }} />
                        <p style={{ fontSize: 15, fontWeight: 500, margin: "0 0 4px" }}>
                            No hay sugerencias pendientes
                        </p>
                        <p style={{ fontSize: 13, margin: 0 }}>
                            Cuando el sistema detecte contactos duplicados entre canales, apareceran aqui.
                        </p>
                    </div>
                ) : (
                    <div>
                        {pending.map((s) => {
                            const mt = matchTypeStyles[s.match_type] || {
                                bg: "rgba(152,152,176,0.15)",
                                color: "#9898b0",
                                label: s.match_type,
                            };
                            const isActioning = actionLoading === s.id;

                            return (
                                <div
                                    key={s.id}
                                    style={{
                                        padding: "20px 24px",
                                        borderBottom: "1px solid var(--border, #2a2a45)",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 16,
                                    }}
                                >
                                    {/* Contact A */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{
                                            fontSize: 14,
                                            fontWeight: 600,
                                            margin: "0 0 6px",
                                            color: "var(--text-primary, #e8e8f0)",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap" as const,
                                        }}>
                                            {s.contact_a?.name || s.contact_a_name || "Contacto A"}
                                        </p>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                                            <ChannelBadge channel={s.contact_a?.channel || s.contact_a_channel || "whatsapp"} />
                                            <span style={{
                                                fontSize: 11,
                                                color: "var(--text-secondary, #9898b0)",
                                                fontFamily: "monospace",
                                            }}>
                                                {s.contact_a?.external_id || s.contact_a_external_id || "—"}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Match Info Center */}
                                    <div style={{
                                        display: "flex",
                                        flexDirection: "column" as const,
                                        alignItems: "center",
                                        gap: 6,
                                        flexShrink: 0,
                                        minWidth: 120,
                                    }}>
                                        <span style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 4,
                                            padding: "4px 12px",
                                            borderRadius: 12,
                                            fontSize: 11,
                                            fontWeight: 600,
                                            background: mt.bg,
                                            color: mt.color,
                                        }}>
                                            {mt.label}
                                        </span>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <ArrowRight size={14} color="var(--text-secondary, #9898b0)" />
                                            <span style={{
                                                fontSize: 13,
                                                fontWeight: 700,
                                                color: "var(--text-primary, #e8e8f0)",
                                            }}>
                                                {s.confidence != null
                                                    ? `${Math.round(Number(s.confidence) * 100)}%`
                                                    : "—"}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Contact B */}
                                    <div style={{ flex: 1, minWidth: 0, textAlign: "right" as const }}>
                                        <p style={{
                                            fontSize: 14,
                                            fontWeight: 600,
                                            margin: "0 0 6px",
                                            color: "var(--text-primary, #e8e8f0)",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap" as const,
                                        }}>
                                            {s.contact_b?.name || s.contact_b_name || "Contacto B"}
                                        </p>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" as const }}>
                                            <span style={{
                                                fontSize: 11,
                                                color: "var(--text-secondary, #9898b0)",
                                                fontFamily: "monospace",
                                            }}>
                                                {s.contact_b?.external_id || s.contact_b_external_id || "—"}
                                            </span>
                                            <ChannelBadge channel={s.contact_b?.channel || s.contact_b_channel || "whatsapp"} />
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: 8 }}>
                                        <button
                                            onClick={() => handleAction(s.id, "approve")}
                                            disabled={isActioning}
                                            style={{
                                                padding: "8px 16px",
                                                borderRadius: 8,
                                                border: "none",
                                                background: "rgba(0, 214, 143, 0.15)",
                                                color: "var(--success, #00d68f)",
                                                fontSize: 12,
                                                fontWeight: 600,
                                                cursor: "pointer",
                                                opacity: isActioning ? 0.6 : 1,
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 4,
                                            }}
                                        >
                                            {isActioning ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                                            Aprobar
                                        </button>
                                        <button
                                            onClick={() => handleAction(s.id, "reject")}
                                            disabled={isActioning}
                                            style={{
                                                padding: "8px 16px",
                                                borderRadius: 8,
                                                border: "none",
                                                background: "rgba(255, 71, 87, 0.15)",
                                                color: "var(--danger, #ff4757)",
                                                fontSize: 12,
                                                fontWeight: 600,
                                                cursor: "pointer",
                                                opacity: isActioning ? 0.6 : 1,
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 4,
                                            }}
                                        >
                                            {isActioning ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                                            Rechazar
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
