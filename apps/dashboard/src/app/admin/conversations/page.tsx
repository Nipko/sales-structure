"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import { cn } from "@/lib/utils";
import {
    MessageSquare, Search, Filter, Clock, User, Bot, Phone,
    CheckCircle2, AlertCircle, ArrowUpDown, ChevronRight,
    Calendar, Hash, Tag,
} from "lucide-react";

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
    const tc = useTranslations("common");
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [conversations, setConversations] = useState<any[]>([]);
    const [isLive, setIsLive] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [sortBy, setSortBy] = useState<"recent" | "messages">("recent");

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
            const matchSearch = searchQuery ? `${c.contactName} ${c.contactPhone} ${c.lastMessage}`.toLowerCase().includes(searchQuery.toLowerCase()) : true;
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
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-[28px] font-semibold m-0 flex items-center gap-2.5">
                        <MessageSquare size={28} className="text-primary" /> Conversaciones
                        <DataSourceBadge isLive={isLive} />
                    </h1>
                    <p className="text-muted-foreground mt-1">{stats.total} conversaciones · {stats.totalMessages} mensajes totales</p>
                </div>
            </div>

            <div className="grid grid-cols-4 gap-4 mb-6">
                {[
                    { label: "Total", value: stats.total, color: "#6c5ce7", icon: MessageSquare },
                    { label: "Activas", value: stats.active, color: "#2ecc71", icon: CheckCircle2 },
                    { label: "Esperando", value: stats.waiting, color: "#f39c12", icon: Clock },
                    { label: "Resueltas", value: stats.resolved, color: "#95a5a6", icon: CheckCircle2 },
                ].map(stat => (
                    <div key={stat.label} className="p-5 rounded-[14px] bg-card border border-border">
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

            <div className="flex gap-3 mb-5 items-center">
                <div className="relative flex-1 max-w-[360px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={tc("search") + "..."} className="w-full py-2.5 pl-9 pr-2.5 rounded-[10px] border border-border bg-card text-foreground text-sm outline-none box-border" />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3.5 py-2.5 rounded-[10px] border border-border bg-card text-foreground text-sm outline-none">
                    <option value="all">Todos</option>
                    <option value="active">Activas</option>
                    <option value="waiting">Esperando</option>
                    <option value="resolved">Resueltas</option>
                </select>
                <button onClick={() => setSortBy(s => s === "recent" ? "messages" : "recent")} className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-[10px] border border-border bg-card text-foreground text-[13px] cursor-pointer">
                    <ArrowUpDown size={14} /> {sortBy === "recent" ? "Recientes" : "Mas mensajes"}
                </button>
            </div>

            <div className="rounded-[14px] border border-border overflow-hidden">
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="bg-card">
                            {["Contacto", "Ultimo mensaje", "Mensajes", "Estado", "Agente", "Sentimiento", "Fecha"].map(h => (
                                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(conv => {
                            const sc = statusConfig[conv.status];
                            const sm = sentimentConfig[conv.sentiment];
                            return (
                                <tr key={conv.id} className="border-b border-border cursor-pointer">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center text-white font-semibold text-sm">
                                                {conv.contactName.charAt(0)}
                                            </div>
                                            <div>
                                                <div className="font-semibold text-sm">{conv.contactName}</div>
                                                <div className="text-[11px] text-muted-foreground">{conv.contactPhone}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-[13px] text-muted-foreground max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap">{conv.lastMessage}</td>
                                    <td className="px-4 py-3">
                                        <span className="flex items-center gap-1 text-[13px] font-semibold">
                                            <Hash size={12} className="text-muted-foreground" /> {conv.messageCount}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold" style={{ background: `${sc.color}15`, color: sc.color }}>{sc.label}</span>
                                    </td>
                                    <td className="px-4 py-3 text-[13px] text-muted-foreground">{conv.assignedAgent}</td>
                                    <td className="px-4 py-3"><span title={sm.label}>{sm.emoji}</span></td>
                                    <td className="px-4 py-3 text-xs text-muted-foreground">{conv.lastMessageAt}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="mt-5 p-4 rounded-[14px] bg-card border border-border">
                <div className="text-[13px] font-semibold mb-2.5 flex items-center gap-1.5">
                    <Tag size={14} className="text-primary" /> Tags mas usados
                </div>
                <div className="flex gap-2 flex-wrap">
                    {Array.from(new Set(conversations.flatMap(c => c.tags))).filter(Boolean).map(tag => {
                        const count = conversations.filter(c => c.tags.includes(tag)).length;
                        return (
                            <span key={tag} className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary font-medium">{tag} ({count})</span>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
