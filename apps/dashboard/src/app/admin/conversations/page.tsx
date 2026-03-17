"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import {
    MessageSquare, Search, Filter, Clock, User, Bot, Phone,
    CheckCircle2, AlertCircle, ArrowUpDown, ChevronRight,
    Calendar, Hash, Tag,
} from "lucide-react";

// No mock data — all loaded from API

const statusConfig: Record<string, { label: string; color: string }> = {
    active: { label: "Activa", color: "#2ecc71" },
    waiting: { label: "Esperando", color: "#f39c12" },
    resolved: { label: "Resuelta", color: "#95a5a6" },
    handoff: { label: "Handoff", color: "#e74c3c" },
};

const sentimentConfig: Record<string, { label: string; emoji: string }> = {
    positive: { label: "Positivo", emoji: "😊" },
    neutral: { label: "Neutral", emoji: "😐" },
    negative: { label: "Negativo", emoji: "😞" },
};

export default function ConversationsPage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [conversations, setConversations] = useState<any[]>([]);
    const [isLive, setIsLive] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [sortBy, setSortBy] = useState<"recent" | "messages">("recent");

    // Load from API
    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            const result = await api.getInbox(activeTenantId);
            if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                setConversations(result.data as any);
                setIsLive(true);
            }
        }
        load();
    }, [activeTenantId]);

    const filtered = conversations
        .filter(c => {
            const matchSearch = searchQuery
                ? `${c.contactName} ${c.contactPhone} ${c.lastMessage}`.toLowerCase().includes(searchQuery.toLowerCase())
                : true;
            const matchStatus = statusFilter === "all" || c.status === statusFilter;
            return matchSearch && matchStatus;
        })
        .sort((a, b) => sortBy === "messages" ? b.messageCount - a.messageCount : 0);

    const stats = {
        total: conversations.length,
        active: conversations.filter(c => c.status === "active").length,
        waiting: conversations.filter(c => c.status === "waiting").length,
        resolved: conversations.filter(c => c.status === "resolved").length,
        totalMessages: conversations.reduce((s, c) => s + c.messageCount, 0),
    };

    return (
        <div>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                        <MessageSquare size={28} color="var(--accent)" /> Conversaciones
                        <DataSourceBadge isLive={isLive} />
                    </h1>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                        {stats.total} conversaciones · {stats.totalMessages} mensajes totales
                    </p>
                </div>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                {[
                    { label: "Total", value: stats.total, color: "var(--accent)", icon: MessageSquare },
                    { label: "Activas", value: stats.active, color: "#2ecc71", icon: CheckCircle2 },
                    { label: "Esperando", value: stats.waiting, color: "#f39c12", icon: Clock },
                    { label: "Resueltas", value: stats.resolved, color: "#95a5a6", icon: CheckCircle2 },
                ].map(stat => (
                    <div key={stat.label} style={{ padding: 20, borderRadius: 14, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
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

            {/* Filters */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
                <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
                    <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }} />
                    <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar contacto, teléfono o mensaje..."
                        style={{ width: "100%", padding: "10px 10px 10px 36px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 14, outline: "none" }}>
                    <option value="all">Todos</option>
                    <option value="active">Activas</option>
                    <option value="waiting">Esperando</option>
                    <option value="resolved">Resueltas</option>
                </select>
                <button onClick={() => setSortBy(s => s === "recent" ? "messages" : "recent")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 13, cursor: "pointer" }}>
                    <ArrowUpDown size={14} /> {sortBy === "recent" ? "Recientes" : "Más mensajes"}
                </button>
            </div>

            {/* Conversation Table */}
            <div style={{ borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ background: "var(--bg-secondary)" }}>
                            {["Contacto", "Último mensaje", "Mensajes", "Estado", "Agente", "Sentimiento", "Fecha"].map(h => (
                                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid var(--border)" }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(conv => {
                            const sc = statusConfig[conv.status];
                            const sm = sentimentConfig[conv.sentiment];
                            return (
                                <tr key={conv.id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                                    <td style={{ padding: "12px 16px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), #9b59b6)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: 14 }}>
                                                {conv.contactName.charAt(0)}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 14 }}>{conv.contactName}</div>
                                                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{conv.contactPhone}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {conv.lastMessage}
                                    </td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600 }}>
                                            <Hash size={12} color="var(--text-secondary)" /> {conv.messageCount}
                                        </span>
                                    </td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: `${sc.color}15`, color: sc.color, fontWeight: 600 }}>
                                            {sc.label}
                                        </span>
                                    </td>
                                    <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)" }}>{conv.assignedAgent}</td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span title={sm.label}>{sm.emoji}</span>
                                    </td>
                                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)" }}>{conv.lastMessageAt}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Tags Summary */}
            <div style={{ marginTop: 20, padding: 16, borderRadius: 14, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <Tag size={14} color="var(--accent)" /> Tags más usados
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {Array.from(new Set(conversations.flatMap(c => c.tags))).filter(Boolean).map(tag => {
                        const count = conversations.filter(c => c.tags.includes(tag)).length;
                        return (
                            <span key={tag} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, background: "rgba(108,92,231,0.1)", color: "var(--accent)", fontWeight: 500 }}>
                                {tag} ({count})
                            </span>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
