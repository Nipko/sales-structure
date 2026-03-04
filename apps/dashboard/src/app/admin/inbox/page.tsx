"use client";

import { useState } from "react";
import {
    Search,
    Filter,
    Send,
    Paperclip,
    Smile,
    MoreVertical,
    Phone,
    Mail,
    Tag,
    Clock,
    CheckCircle,
    AlertCircle,
    Bot,
    User,
    MessageSquare,
    Zap,
    ArrowRight,
    StickyNote,
    Sparkles,
    Hash,
} from "lucide-react";

// ============================================
// MOCK DATA (will be replaced by API calls)
// ============================================

const mockConversations = [
    {
        id: "1", contactName: "Carlos Medina", contactPhone: "+57 310 456 7890",
        lastMessage: "Hola, quiero info sobre el rafting", lastMessageAt: "Hace 2 min",
        status: "handoff" as const, channel: "whatsapp", unreadCount: 3,
        priority: "urgent" as const, tags: ["vip", "turismo"], isAiHandled: false,
    },
    {
        id: "2", contactName: "Ana García", contactPhone: "+57 315 789 0123",
        lastMessage: "¿Cuál es el precio del combo aventura?", lastMessageAt: "Hace 8 min",
        status: "open" as const, channel: "whatsapp", unreadCount: 1,
        priority: "high" as const, tags: ["interesado"], isAiHandled: true,
    },
    {
        id: "3", contactName: "Luis Rodríguez", contactPhone: "+57 320 123 4567",
        lastMessage: "Gracias, voy a pensarlo", lastMessageAt: "Hace 25 min",
        status: "assigned" as const, channel: "whatsapp", unreadCount: 0,
        priority: "normal" as const, tags: [], isAiHandled: false, assignedAgentName: "Sofia",
    },
    {
        id: "4", contactName: "María Pérez", contactPhone: "+57 301 234 5678",
        lastMessage: "¿Tienen disponibilidad para el sábado?", lastMessageAt: "Hace 1 hora",
        status: "open" as const, channel: "whatsapp", unreadCount: 2,
        priority: "normal" as const, tags: ["reserva"], isAiHandled: true,
    },
    {
        id: "5", contactName: "Pedro Sánchez", contactPhone: "+57 318 567 8901",
        lastMessage: "Ya hice el pago, aquí el comprobante", lastMessageAt: "Hace 2 horas",
        status: "open" as const, channel: "whatsapp", unreadCount: 0,
        priority: "low" as const, tags: ["pagado"], isAiHandled: true,
    },
];

const mockMessages = [
    { id: "m1", content: "Hola, buenos días! Me interesa hacer rafting este fin de semana", sender: "customer" as const, senderName: "Carlos Medina", timestamp: "10:32 AM", type: "text" as const },
    { id: "m2", content: "¡Hola Carlos! 🏔️ ¡Qué bueno que te interese! Tenemos rafting en el Río Chicamocha con salidas sábados y domingos. ¿Cuántas personas serían?", sender: "ai" as const, senderName: "Sofia IA", timestamp: "10:32 AM", type: "text" as const },
    { id: "m3", content: "Seríamos 6 personas, 4 adultos y 2 niños de 12 y 14 años", sender: "customer" as const, senderName: "Carlos Medina", timestamp: "10:35 AM", type: "text" as const },
    { id: "m4", content: "Para grupos de 6 el precio es de $150,000 COP por persona (adulto) y $120,000 COP por persona menor de 16 años. ¿Qué día prefieren?", sender: "ai" as const, senderName: "Sofia IA", timestamp: "10:35 AM", type: "text" as const },
    { id: "m5", content: "Perfecto, sería para el sábado. ¿Los menores de 12 pueden participar? Mi hijo menor tiene miedo al agua", sender: "customer" as const, senderName: "Carlos Medina", timestamp: "10:38 AM", type: "text" as const },
    { id: "m6", content: "El cliente pregunta sobre menores con miedo al agua — requiere atención personalizada del equipo", sender: "system" as const, senderName: "Sistema", timestamp: "10:38 AM", type: "text" as const },
    { id: "m7", content: "Carlos, te paso con uno de nuestros guías expertos que puede resolver mejor esa consulta. 😊", sender: "ai" as const, senderName: "Sofia IA", timestamp: "10:38 AM", type: "text" as const },
];

const mockContact = {
    id: "c1", name: "Carlos Medina", phone: "+57 310 456 7890", email: "carlos@email.com",
    tags: ["vip", "turismo", "grupo"], segment: "qualified", lifetimeValue: 1250000,
    lastInteraction: "Hoy, 10:38 AM", conversationCount: 4,
    customFields: { empresa: "TechCorp", ciudad: "Bogotá" },
};

const mockNotes = [
    { id: "n1", content: "Cliente VIP, siempre trae grupos grandes. Ofrecerle descuento del 15%", agentName: "Admin", createdAt: "28 Feb 2026" },
    { id: "n2", content: "Última reserva: Combo Aventura Total, 8 personas. Quedó muy satisfecho.", agentName: "Sofia", createdAt: "15 Feb 2026" },
];

// ============================================
// TYPES
// ============================================

type InboxFilter = "all" | "mine" | "unassigned" | "handoff";

const priorityColors: Record<string, string> = {
    urgent: "#e74c3c",
    high: "#e67e22",
    normal: "#3498db",
    low: "#95a5a6",
};

const statusLabels: Record<string, { label: string; color: string }> = {
    handoff: { label: "Handoff", color: "#e74c3c" },
    open: { label: "Abierta", color: "#2ecc71" },
    assigned: { label: "Asignada", color: "#3498db" },
    pending: { label: "Pendiente", color: "#e67e22" },
    resolved: { label: "Resuelta", color: "#95a5a6" },
};

// ============================================
// COMPONENT
// ============================================

export default function InboxPage() {
    const [filter, setFilter] = useState<InboxFilter>("all");
    const [selectedConv, setSelectedConv] = useState(mockConversations[0]);
    const [messageInput, setMessageInput] = useState("");
    const [noteInput, setNoteInput] = useState("");
    const [showNotes, setShowNotes] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const filteredConversations = mockConversations.filter(c => {
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return c.contactName.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q);
        }
        if (filter === "handoff") return c.status === "handoff";
        if (filter === "unassigned") return c.isAiHandled && (c.status as string) !== "resolved";
        return true;
    });

    const handleSend = () => {
        if (!messageInput.trim()) return;
        // TODO: API call
        setMessageInput("");
    };

    return (
        <div style={{ display: "flex", height: "calc(100vh - 64px)", margin: "-32px -40px", overflow: "hidden" }}>

            {/* ======== LEFT: Conversation List ======== */}
            <div style={{
                width: 340, borderRight: "1px solid var(--border)", display: "flex",
                flexDirection: "column", background: "var(--bg-secondary)",
            }}>
                {/* Header */}
                <div style={{ padding: "16px", borderBottom: "1px solid var(--border)" }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px" }}>Inbox</h2>

                    {/* Search */}
                    <div style={{ position: "relative", marginBottom: 12 }}>
                        <Search size={16} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-secondary)" }} />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Buscar conversaciones..."
                            style={{
                                width: "100%", padding: "8px 12px 8px 34px", borderRadius: 8,
                                border: "1px solid var(--border)", background: "var(--bg-tertiary)",
                                color: "var(--text-primary)", fontSize: 13, outline: "none", boxSizing: "border-box",
                            }}
                        />
                    </div>

                    {/* Filters */}
                    <div style={{ display: "flex", gap: 4 }}>
                        {([
                            { key: "all" as const, label: "Todas", count: mockConversations.length },
                            { key: "handoff" as const, label: "Handoff", count: mockConversations.filter(c => c.status === "handoff").length },
                            { key: "unassigned" as const, label: "IA", count: mockConversations.filter(c => c.isAiHandled).length },
                        ]).map(f => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                style={{
                                    padding: "4px 10px", borderRadius: 6, border: "none", fontSize: 12,
                                    fontWeight: filter === f.key ? 600 : 400, cursor: "pointer",
                                    background: filter === f.key ? "var(--accent)" : "transparent",
                                    color: filter === f.key ? "white" : "var(--text-secondary)",
                                }}
                            >
                                {f.label} ({f.count})
                            </button>
                        ))}
                    </div>
                </div>

                {/* Conversation List */}
                <div style={{ flex: 1, overflow: "auto" }}>
                    {filteredConversations.map(conv => (
                        <div
                            key={conv.id}
                            onClick={() => setSelectedConv(conv)}
                            style={{
                                padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid var(--border)",
                                background: selectedConv.id === conv.id ? "var(--accent-glow)" : "transparent",
                                transition: "background 0.15s ease",
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ display: "flex", gap: 10, alignItems: "center", flex: 1 }}>
                                    {/* Avatar */}
                                    <div style={{
                                        width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                                        background: `linear-gradient(135deg, ${priorityColors[conv.priority]}, ${priorityColors[conv.priority]}88)`,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        fontSize: 16, fontWeight: 700, color: "white",
                                    }}>
                                        {conv.contactName.charAt(0)}
                                    </div>
                                    <div style={{ overflow: "hidden", flex: 1 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{ fontWeight: 600, fontSize: 14 }}>{conv.contactName}</span>
                                            {conv.isAiHandled && <Bot size={14} color="var(--accent)" />}
                                        </div>
                                        <div style={{
                                            fontSize: 12, color: "var(--text-secondary)", marginTop: 2,
                                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                        }}>
                                            {conv.lastMessage}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                                    <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{conv.lastMessageAt}</span>
                                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                        {conv.unreadCount > 0 && (
                                            <span style={{
                                                background: "var(--accent)", color: "white", fontSize: 10,
                                                borderRadius: 10, padding: "1px 6px", fontWeight: 700,
                                            }}>
                                                {conv.unreadCount}
                                            </span>
                                        )}
                                        <span style={{
                                            background: `${statusLabels[conv.status].color}22`,
                                            color: statusLabels[conv.status].color,
                                            fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                                        }}>
                                            {statusLabels[conv.status].label}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            {conv.tags.length > 0 && (
                                <div style={{ display: "flex", gap: 4, marginTop: 6, marginLeft: 50 }}>
                                    {conv.tags.map(tag => (
                                        <span key={tag} style={{
                                            fontSize: 10, padding: "1px 6px", borderRadius: 4,
                                            background: "rgba(108, 92, 231, 0.15)", color: "#6c5ce7",
                                        }}>
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* ======== CENTER: Chat Thread ======== */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>
                {/* Chat Header */}
                <div style={{
                    padding: "12px 20px", borderBottom: "1px solid var(--border)",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: "var(--bg-secondary)",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: "50%",
                            background: `linear-gradient(135deg, ${priorityColors[selectedConv.priority]}, ${priorityColors[selectedConv.priority]}88)`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 14, fontWeight: 700, color: "white",
                        }}>
                            {selectedConv.contactName.charAt(0)}
                        </div>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 15 }}>{selectedConv.contactName}</div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{selectedConv.contactPhone} · {selectedConv.channel}</div>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setShowNotes(!showNotes)} style={{
                            padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)",
                            background: showNotes ? "var(--accent)" : "transparent",
                            color: showNotes ? "white" : "var(--text-secondary)",
                            fontSize: 12, cursor: "pointer", display: "flex", gap: 4, alignItems: "center",
                        }}>
                            <StickyNote size={14} /> Notas
                        </button>
                        <button style={{
                            padding: "6px 12px", borderRadius: 8, border: "none",
                            background: "#2ecc71", color: "white", fontSize: 12, fontWeight: 600,
                            cursor: "pointer", display: "flex", gap: 4, alignItems: "center",
                        }}>
                            <CheckCircle size={14} /> Resolver
                        </button>
                        <button style={{
                            padding: "6px 12px", borderRadius: 8, border: "none",
                            background: "var(--accent)", color: "white", fontSize: 12, fontWeight: 600,
                            cursor: "pointer", display: "flex", gap: 4, alignItems: "center",
                        }}>
                            <ArrowRight size={14} /> Asignar
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {mockMessages.map(msg => {
                        const isCustomer = msg.sender === "customer";
                        const isSystem = msg.sender === "system";
                        const isAi = msg.sender === "ai";

                        if (isSystem) {
                            return (
                                <div key={msg.id} style={{
                                    textAlign: "center", fontSize: 11, color: "var(--text-secondary)",
                                    padding: "8px 16px", background: "rgba(231, 76, 60, 0.08)",
                                    borderRadius: 8, margin: "4px auto", maxWidth: "80%",
                                    display: "flex", gap: 6, alignItems: "center", justifyContent: "center",
                                }}>
                                    <AlertCircle size={14} color="#e74c3c" />
                                    {msg.content}
                                </div>
                            );
                        }

                        return (
                            <div key={msg.id} style={{
                                display: "flex", justifyContent: isCustomer ? "flex-start" : "flex-end",
                            }}>
                                <div style={{ maxWidth: "70%" }}>
                                    <div style={{
                                        fontSize: 11, color: "var(--text-secondary)", marginBottom: 2,
                                        textAlign: isCustomer ? "left" : "right",
                                        display: "flex", gap: 4, alignItems: "center",
                                        justifyContent: isCustomer ? "flex-start" : "flex-end",
                                    }}>
                                        {isAi && <Bot size={12} color="var(--accent)" />}
                                        {!isCustomer && !isAi && <User size={12} />}
                                        {msg.senderName} · {msg.timestamp}
                                    </div>
                                    <div style={{
                                        padding: "10px 14px", borderRadius: 12,
                                        background: isCustomer ? "var(--bg-secondary)" : isAi ? "rgba(108, 92, 231, 0.15)" : "var(--accent)",
                                        color: (!isCustomer && !isAi) ? "white" : "var(--text-primary)",
                                        fontSize: 14, lineHeight: 1.5,
                                        borderBottomLeftRadius: isCustomer ? 4 : 12,
                                        borderBottomRightRadius: isCustomer ? 12 : 4,
                                        border: isAi ? "1px solid rgba(108, 92, 231, 0.3)" : "none",
                                    }}>
                                        {msg.content}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* AI Suggestion Banner */}
                    <div style={{
                        padding: "10px 14px", borderRadius: 10,
                        background: "rgba(46, 204, 113, 0.08)", border: "1px solid rgba(46, 204, 113, 0.2)",
                        display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8,
                    }}>
                        <Sparkles size={16} color="#2ecc71" style={{ marginTop: 2, flexShrink: 0 }} />
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#2ecc71", marginBottom: 4 }}>Sugerencia IA</div>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                                &quot;Los niños de 12+ pueden participar. Para quienes tienen miedo al agua, tenemos chalecos especiales y un guía dedicado.
                                El recorrido tiene tramos suaves ideales para principiantes.&quot;
                            </div>
                            <button style={{
                                marginTop: 6, padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(46, 204, 113, 0.3)",
                                background: "transparent", color: "#2ecc71", fontSize: 12, cursor: "pointer",
                            }}>
                                Usar sugerencia
                            </button>
                        </div>
                    </div>
                </div>

                {/* Notes Panel (conditional) */}
                {showNotes && (
                    <div style={{
                        borderTop: "1px solid var(--border)", padding: "12px 20px",
                        background: "rgba(255, 170, 0, 0.05)", maxHeight: 200, overflow: "auto",
                    }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#ffaa00", marginBottom: 8, display: "flex", gap: 4, alignItems: "center" }}>
                            <StickyNote size={14} /> Notas internas
                        </div>
                        {mockNotes.map(note => (
                            <div key={note.id} style={{
                                padding: "6px 10px", borderRadius: 6, background: "var(--bg-secondary)",
                                marginBottom: 6, fontSize: 13,
                            }}>
                                <div>{note.content}</div>
                                <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 4 }}>— {note.agentName}, {note.createdAt}</div>
                            </div>
                        ))}
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <input
                                value={noteInput}
                                onChange={e => setNoteInput(e.target.value)}
                                placeholder="Agregar nota interna..."
                                style={{
                                    flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)",
                                    background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 12, outline: "none",
                                }}
                            />
                            <button style={{
                                padding: "6px 12px", borderRadius: 6, border: "none",
                                background: "#ffaa00", color: "white", fontSize: 12, cursor: "pointer",
                            }}>
                                Guardar
                            </button>
                        </div>
                    </div>
                )}

                {/* Message Input */}
                <div style={{
                    padding: "12px 20px", borderTop: "1px solid var(--border)",
                    display: "flex", gap: 8, alignItems: "center", background: "var(--bg-secondary)",
                }}>
                    <button style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4 }}>
                        <Paperclip size={20} />
                    </button>
                    <div style={{ position: "relative", flex: 1 }}>
                        <input
                            value={messageInput}
                            onChange={e => setMessageInput(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleSend()}
                            placeholder="Escribe un mensaje... (/ para respuestas rápidas)"
                            style={{
                                width: "100%", padding: "10px 14px", borderRadius: 10,
                                border: "1px solid var(--border)", background: "var(--bg-tertiary)",
                                color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box",
                            }}
                        />
                    </div>
                    <button style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4 }}>
                        <Smile size={20} />
                    </button>
                    <button
                        onClick={handleSend}
                        style={{
                            padding: "10px", borderRadius: 10, border: "none",
                            background: "var(--accent)", color: "white", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>

            {/* ======== RIGHT: Contact Panel ======== */}
            <div style={{
                width: 300, borderLeft: "1px solid var(--border)", overflow: "auto",
                background: "var(--bg-secondary)", padding: "16px",
            }}>
                {/* Contact Header */}
                <div style={{ textAlign: "center", marginBottom: 20 }}>
                    <div style={{
                        width: 64, height: 64, borderRadius: "50%", margin: "0 auto 10px",
                        background: "linear-gradient(135deg, var(--accent), #9b59b6)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 24, fontWeight: 700, color: "white",
                    }}>
                        {mockContact.name.charAt(0)}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{mockContact.name}</div>
                    <div style={{
                        padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: "rgba(46, 204, 113, 0.15)", color: "#2ecc71",
                        display: "inline-block", marginTop: 4,
                    }}>
                        {mockContact.segment}
                    </div>
                </div>

                {/* Contact Details */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <Phone size={14} color="var(--text-secondary)" />
                        <span>{mockContact.phone}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <Mail size={14} color="var(--text-secondary)" />
                        <span>{mockContact.email}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <Clock size={14} color="var(--text-secondary)" />
                        <span>{mockContact.lastInteraction}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <MessageSquare size={14} color="var(--text-secondary)" />
                        <span>{mockContact.conversationCount} conversaciones</span>
                    </div>
                </div>

                {/* Tags */}
                <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                        <Tag size={12} /> Tags
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {mockContact.tags.map(tag => (
                            <span key={tag} style={{
                                fontSize: 11, padding: "3px 8px", borderRadius: 6,
                                background: "rgba(108, 92, 231, 0.15)", color: "#6c5ce7",
                            }}>
                                {tag}
                            </span>
                        ))}
                        <button style={{
                            fontSize: 11, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
                            background: "transparent", border: "1px dashed var(--border)", color: "var(--text-secondary)",
                        }}>
                            + Agregar
                        </button>
                    </div>
                </div>

                {/* Lifetime Value */}
                <div style={{
                    padding: "12px", borderRadius: 10, background: "var(--bg-tertiary)",
                    border: "1px solid var(--border)", marginBottom: 20,
                }}>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Valor de por vida</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#2ecc71" }}>
                        ${mockContact.lifetimeValue.toLocaleString()} COP
                    </div>
                </div>

                {/* Custom Fields */}
                <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                        <Hash size={12} /> Campos personalizados
                    </div>
                    {Object.entries(mockContact.customFields).map(([key, value]) => (
                        <div key={key} style={{
                            display: "flex", justifyContent: "space-between", padding: "6px 0",
                            borderBottom: "1px solid var(--border)", fontSize: 13,
                        }}>
                            <span style={{ color: "var(--text-secondary)", textTransform: "capitalize" }}>{key}</span>
                            <span style={{ fontWeight: 500 }}>{value}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
