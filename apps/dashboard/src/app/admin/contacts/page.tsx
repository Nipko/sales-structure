"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import {
    Search,
    Filter,
    Phone,
    Mail,
    MessageSquare,
    Tag,
    User,
    UserPlus,
    MoreVertical,
    ChevronDown,
    ArrowUpDown,
    Eye,
} from "lucide-react";

const mockContacts = [
    {
        id: "c1", name: "Carlos Medina", phone: "+57 310 456 7890", email: "carlos@email.com",
        tags: ["vip", "turismo", "grupo"], segment: "qualified",
        conversations: 4, lifetimeValue: 1250000, lastInteraction: "Hoy, 10:38 AM",
        city: "Bogotá",
    },
    {
        id: "c2", name: "Ana García", phone: "+57 315 789 0123", email: "ana.garcia@gmail.com",
        tags: ["interesado"], segment: "lead",
        conversations: 1, lifetimeValue: 0, lastInteraction: "Hoy, 10:30 AM",
        city: "Medellín",
    },
    {
        id: "c3", name: "Luis Rodríguez", phone: "+57 320 123 4567", email: "luis.r@outlook.com",
        tags: ["frecuente", "referido"], segment: "customer",
        conversations: 12, lifetimeValue: 3450000, lastInteraction: "Ayer, 3:22 PM",
        city: "Bucaramanga",
    },
    {
        id: "c4", name: "María Pérez", phone: "+57 301 234 5678", email: "maria.p@hotmail.com",
        tags: ["reserva"], segment: "qualified",
        conversations: 3, lifetimeValue: 650000, lastInteraction: "Hoy, 9:15 AM",
        city: "Cali",
    },
    {
        id: "c5", name: "Pedro Sánchez", phone: "+57 318 567 8901", email: "",
        tags: ["pagado", "combo"], segment: "customer",
        conversations: 7, lifetimeValue: 2100000, lastInteraction: "Hoy, 8:42 AM",
        city: "San Gil",
    },
    {
        id: "c6", name: "Laura Martínez", phone: "+57 312 890 1234", email: "laura@empresa.co",
        tags: ["corporativo", "vip"], segment: "customer",
        conversations: 15, lifetimeValue: 8500000, lastInteraction: "28 Feb, 4:10 PM",
        city: "Bogotá",
    },
];

const segmentColors: Record<string, { bg: string; color: string }> = {
    new: { bg: "rgba(149, 165, 166, 0.15)", color: "#95a5a6" },
    lead: { bg: "rgba(52, 152, 219, 0.15)", color: "#3498db" },
    qualified: { bg: "rgba(230, 126, 34, 0.15)", color: "#e67e22" },
    customer: { bg: "rgba(46, 204, 113, 0.15)", color: "#2ecc71" },
    churned: { bg: "rgba(231, 76, 60, 0.15)", color: "#e74c3c" },
};

export default function ContactsPage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const router = useRouter();
    const [contacts, setContacts] = useState(mockContacts);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeSegment, setActiveSegment] = useState<string>("all");
    const [isLive, setIsLive] = useState(false);

    // Load contacts from API (reusing inbox data shape)
    useEffect(() => {
        async function load() {
            // Contacts endpoint TBD — for now use mock
            // When API has /contacts endpoint, uncomment:
            // if (!activeTenantId) return;
            // const result = await api.getContacts(activeTenantId);
            // if (result.success && Array.isArray(result.data)) ...
        }
        load();
    }, [activeTenantId]);

    const segments = [
        { key: "all", label: "Todos", count: contacts.length },
        { key: "lead", label: "Leads", count: contacts.filter(c => c.segment === "lead").length },
        { key: "qualified", label: "Calificados", count: contacts.filter(c => c.segment === "qualified").length },
        { key: "customer", label: "Clientes", count: contacts.filter(c => c.segment === "customer").length },
    ];

    const filtered = contacts.filter(c => {
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.email.toLowerCase().includes(q);
        }
        if (activeSegment !== "all") return c.segment === activeSegment;
        return true;
    });

    const totalValue = contacts.reduce((sum, c) => sum + c.lifetimeValue, 0);

    return (
        <div>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Contactos</h1>
                        <DataSourceBadge isLive={isLive} />
                    </div>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                        {contacts.length} contactos · Valor total: ${totalValue.toLocaleString()} COP
                    </p>
                </div>
                <button style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
                    borderRadius: 10, border: "none", background: "var(--accent)", color: "white",
                    fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}>
                    <UserPlus size={18} /> Nuevo contacto
                </button>
            </div>

            {/* Stats Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
                {segments.map(seg => (
                    <button
                        key={seg.key}
                        onClick={() => setActiveSegment(seg.key)}
                        style={{
                            padding: "14px 16px", borderRadius: 12, cursor: "pointer",
                            border: activeSegment === seg.key ? "1px solid var(--accent)" : "1px solid var(--border)",
                            background: activeSegment === seg.key ? "var(--accent-glow)" : "var(--bg-secondary)",
                            textAlign: "left",
                        }}
                    >
                        <div style={{ fontSize: 24, fontWeight: 700 }}>{seg.count}</div>
                        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{seg.label}</div>
                    </button>
                ))}
            </div>

            {/* Search */}
            <div style={{ position: "relative", marginBottom: 16 }}>
                <Search size={16} style={{ position: "absolute", left: 14, top: 12, color: "var(--text-secondary)" }} />
                <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar por nombre, teléfono o email..."
                    style={{
                        width: "100%", padding: "10px 14px 10px 38px", borderRadius: 10,
                        border: "1px solid var(--border)", background: "var(--bg-secondary)",
                        color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box",
                    }}
                />
            </div>

            {/* Table */}
            <div style={{
                background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)",
                overflow: "hidden",
            }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                            {["Contacto", "Segmento", "Conversaciones", "Valor (COP)", "Última interacción", "Tags", ""].map(h => (
                                <th key={h} style={{
                                    padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600,
                                    color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5,
                                }}>
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(contact => {
                            const seg = segmentColors[contact.segment] || segmentColors.new;
                            return (
                                <tr
                                    key={contact.id}
                                    style={{
                                        borderBottom: "1px solid var(--border)",
                                        cursor: "pointer",
                                        transition: "background 0.15s ease",
                                    }}
                                    onMouseOver={e => (e.currentTarget.style.background = "var(--bg-tertiary)")}
                                    onMouseOut={e => (e.currentTarget.style.background = "transparent")}
                                >
                                    <td style={{ padding: "12px 16px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <div style={{
                                                width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                                                background: "linear-gradient(135deg, var(--accent), #9b59b6)",
                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                color: "white", fontWeight: 700, fontSize: 14,
                                            }}>
                                                {contact.name.charAt(0)}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 14 }}>{contact.name}</div>
                                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                                    {contact.phone}
                                                    {contact.city && ` · ${contact.city}`}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span style={{
                                            padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                                            background: seg.bg, color: seg.color,
                                        }}>
                                            {contact.segment}
                                        </span>
                                    </td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14 }}>
                                            <MessageSquare size={14} color="var(--text-secondary)" />
                                            {contact.conversations}
                                        </div>
                                    </td>
                                    <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14 }}>
                                        {contact.lifetimeValue > 0 ? `$${contact.lifetimeValue.toLocaleString()}` : "—"}
                                    </td>
                                    <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)" }}>
                                        {contact.lastInteraction}
                                    </td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                            {contact.tags.slice(0, 3).map(tag => (
                                                <span key={tag} style={{
                                                    fontSize: 10, padding: "2px 6px", borderRadius: 4,
                                                    background: "rgba(108, 92, 231, 0.15)", color: "#6c5ce7",
                                                }}>
                                                    {tag}
                                                </span>
                                            ))}
                                            {contact.tags.length > 3 && (
                                                <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                                                    +{contact.tags.length - 3}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <button
                                            onClick={() => router.push(`/admin/contacts/${contact.id}`)}
                                            style={{
                                                background: "none", border: "none", cursor: "pointer",
                                                color: "var(--text-secondary)", padding: 4,
                                            }}
                                        >
                                            <Eye size={16} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
