"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import { io } from "socket.io-client";
import {
    Search, Filter, Send, Paperclip, Smile, Phone, Mail, Tag,
    Clock, CheckCircle, AlertCircle, Bot, User, MessageSquare,
    ArrowRight, StickyNote, Sparkles, Hash, RefreshCw, Zap, Loader2, UserCheck,
} from "lucide-react";

// No mock arrays — all data fetched from API

// ============================================
// TYPES
// ============================================

type InboxFilter = "all" | "mine" | "unassigned" | "handoff";

interface CannedResponse {
    id: string;
    shortcode: string;
    title: string;
    content: string;
}

const priorityColors: Record<string, string> = {
    urgent: "#e74c3c",
    high: "#e67e22",
    normal: "#3498db",
    low: "#95a5a6",
};

const statusLabels: Record<string, { label: string; color: string }> = {
    handoff: { label: "Handoff", color: "#e74c3c" },
    open: { label: "Abierta", color: "#2ecc71" },
    active: { label: "Activa", color: "#2ecc71" },
    assigned: { label: "Asignada", color: "#3498db" },
    pending: { label: "Pendiente", color: "#e67e22" },
    resolved: { label: "Resuelta", color: "#95a5a6" },
    with_human: { label: "Con agente", color: "#3498db" },
    waiting_human: { label: "Esperando agente", color: "#e67e22" },
};

// ============================================
// COMPONENT
// ============================================

export default function InboxPage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [filter, setFilter] = useState<InboxFilter>("all");
    const [conversations, setConversations] = useState<any[]>([]);
    const [selectedConv, setSelectedConv] = useState<any>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [notes, setNotes] = useState<any[]>([]);
    const [messageInput, setMessageInput] = useState("");
    const [noteInput, setNoteInput] = useState("");
    const [showNotes, setShowNotes] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [isLive, setIsLive] = useState(false);
    const [loadingConv, setLoadingConv] = useState(true);

    // --- Canned Responses State ---
    const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
    const [showCannedMenu, setShowCannedMenu] = useState(false);
    const [cannedFilter, setCannedFilter] = useState("");
    const [cannedSelectedIndex, setCannedSelectedIndex] = useState(0);
    const messageInputRef = useRef<HTMLInputElement>(null);
    const selectedConvIdRef = useRef<string | null>(null);

    // Keep ref in sync with selected conversation ID (for WebSocket handler)
    useEffect(() => {
        selectedConvIdRef.current = selectedConv?.id || null;
    }, [selectedConv?.id]);

    // --- AI Suggestion State ---
    const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
    const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);

    // --- Assign State ---
    const [assignLoading, setAssignLoading] = useState(false);

    // Load conversations and canned responses from API
    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            setLoadingConv(true);
            try {
                const [inboxResult, cannedResult] = await Promise.all([
                    api.getInbox(activeTenantId),
                    api.getCannedResponses(activeTenantId),
                ]);

                if (inboxResult.success && Array.isArray(inboxResult.data) && inboxResult.data.length > 0) {
                    const convs = inboxResult.data.map((c: any) => ({
                        id: c.id,
                        contactName: c.contact_name || c.contactName || 'Desconocido',
                        contactPhone: c.contact_phone || c.contactPhone || '',
                        contactEmail: c.contact_email || c.contactEmail || '',
                        lastMessage: c.last_message || c.lastMessage || '',
                        lastMessageAt: c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : c.lastMessageAt || '',
                        status: c.status || 'open',
                        channel: c.channel_type || c.channel || 'whatsapp',
                        unreadCount: c.unread_count || c.unreadCount || 0,
                        priority: c.priority || 'normal',
                        tags: c.tags || [],
                        isAiHandled: c.is_ai_handled ?? c.isAiHandled ?? false,
                        assignedAgentId: c.assigned_agent_id || c.assignedAgentId || '',
                        assignedAgentName: c.assigned_agent_name || c.assignedAgentName || '',
                        contactId: c.contact_id || c.contactId,
                        estimatedValue: c.estimated_ticket_value || 0,
                    }));
                    setConversations(convs);
                    setSelectedConv(convs[0]);
                    setIsLive(true);
                }

                if (cannedResult.success && Array.isArray(cannedResult.data)) {
                    setCannedResponses(cannedResult.data.map((r: any) => ({
                        id: r.id,
                        shortcode: r.shortcode || r.short_code || '',
                        title: r.title || r.name || '',
                        content: r.content || r.body || '',
                    })));
                }
            } catch (err) {
                console.error('Failed to load inbox:', err);
            } finally {
                setLoadingConv(false);
            }
        }
        load();
    }, [activeTenantId]);

    // Load messages when selecting a conversation
    useEffect(() => {
        async function loadMessages() {
            if (!activeTenantId || !selectedConv?.id) return;
            try {
                const result = await api.getConversation(activeTenantId, selectedConv.id);
                if (result.success && result.data) {
                    const conv = result.data;
                    const msgs = (conv.messages || []).map((m: any) => ({
                        id: m.id,
                        content: m.content_text || m.content || '',
                        sender: m.direction === 'inbound' ? 'customer' : (m.llm_model_used ? 'ai' : 'agent'),
                        senderName: m.direction === 'inbound' ? selectedConv.contactName : (m.llm_model_used ? 'IA' : 'Agente'),
                        timestamp: m.created_at ? new Date(m.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '',
                        type: m.content_type || 'text',
                    }));
                    setMessages(msgs);
                    // Update notes from conversation data if available
                    if (conv.notes) {
                        setNotes(conv.notes.map((n: any) => ({
                            id: n.id,
                            content: n.content || n.content_text || '',
                            agentName: n.created_by || n.agent_name || 'Agente',
                            createdAt: n.created_at ? new Date(n.created_at).toLocaleDateString('es-CO') : '',
                        })));
                    }
                }
            } catch (err) {
                console.error('Failed to load conversation:', err);
                setMessages([]);
            }
        }
        loadMessages();
    }, [activeTenantId, selectedConv?.id]);

    // WebSocket real-time updates
    useEffect(() => {
        if (!activeTenantId) return;

        const token = localStorage.getItem("accessToken");
        const socketUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
        
        const socket = io(`${socketUrl}/inbox`, {
            auth: { token }
        });

        socket.on('connect', () => {
            console.log('Connected to Inbox live updates');
            setIsLive(true);
        });

        socket.on('disconnect', () => {
            setIsLive(false);
        });

        socket.on('newMessage', (payload) => {
            const { conversationId, message } = payload;
            
            // Normalize message for UI (must match shape from loadMessages)
            const uiMsg = {
                id: message.id,
                content: message.content_text || message.content || '',
                sender: message.direction === 'inbound' ? 'customer' : (message.llm_model_used ? 'ai' : 'agent'),
                senderName: message.direction === 'inbound' ? 'Cliente' : (message.llm_model_used ? 'IA' : 'Agente'),
                timestamp: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
                type: message.content_type || 'text',
            };
            
            // Update conversation list with latest message
            setConversations((prev: any[]) => prev.map(c => {
                 if (c.id === conversationId) {
                     return { ...c, lastMessage: uiMsg.content, lastMessageAt: uiMsg.timestamp };
                 }
                 return c;
            }));

            // If the selected conversation received a message, append to chat view
            setSelectedConv((prev: any) => {
                if (prev?.id === conversationId) {
                    return { ...prev, messages: [...(prev.messages || []), uiMsg], lastMessage: uiMsg.content };
                }
                return prev;
            });

            // Update the messages state (the actual rendered chat thread) if this
            // message belongs to the currently viewed conversation
            if (selectedConvIdRef.current === conversationId) {
                setMessages(prev => [...prev, uiMsg]);
            }
        });

        return () => {
            socket.disconnect();
        };
    }, [activeTenantId]);

    // --- Fetch AI Suggestion when conversation changes ---
    const fetchAiSuggestion = useCallback(async (convId?: string) => {
        const cId = convId || selectedConv?.id;
        if (!activeTenantId || !cId) return;
        // Only fetch for conversations that are with or waiting for a human agent
        const conv = conversations.find(c => c.id === cId) || selectedConv;
        if (!conv || !['with_human', 'waiting_human', 'handoff', 'assigned', 'open'].includes(conv.status)) {
            setAiSuggestion(null);
            return;
        }
        setAiSuggestionLoading(true);
        setAiSuggestion(null);
        try {
            const result = await api.getAISuggestion(activeTenantId, cId);
            if (result.success && result.data) {
                const text = typeof result.data === 'string' ? result.data : (result.data as any).suggestion || (result.data as any).text || (result.data as any).content || '';
                setAiSuggestion(text || null);
            }
        } catch (err) {
            console.error('Failed to fetch AI suggestion:', err);
        } finally {
            setAiSuggestionLoading(false);
        }
    }, [activeTenantId, selectedConv?.id, conversations]);

    useEffect(() => {
        if (selectedConv?.id) {
            fetchAiSuggestion(selectedConv.id);
        } else {
            setAiSuggestion(null);
        }
    }, [selectedConv?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Canned Responses: filter & interpolation ---
    const filteredCanned = cannedResponses.filter(r => {
        if (!cannedFilter) return true;
        const q = cannedFilter.toLowerCase();
        return r.shortcode.toLowerCase().includes(q) || r.title.toLowerCase().includes(q);
    });

    const interpolateCanned = (content: string): string => {
        return content
            .replace(/\{\{contactName\}\}/gi, selectedConv?.contactName || '')
            .replace(/\{\{contactPhone\}\}/gi, selectedConv?.contactPhone || '')
            .replace(/\{\{agentName\}\}/gi, user?.firstName || 'Agente');
    };

    const selectCannedResponse = (response: CannedResponse) => {
        const interpolated = interpolateCanned(response.content);
        setMessageInput(interpolated);
        setShowCannedMenu(false);
        setCannedFilter("");
        setCannedSelectedIndex(0);
        messageInputRef.current?.focus();
    };

    // --- Handle message input change for canned responses trigger ---
    const handleMessageInputChange = (value: string) => {
        setMessageInput(value);
        if (value.startsWith("/")) {
            setShowCannedMenu(true);
            setCannedFilter(value.slice(1));
            setCannedSelectedIndex(0);
        } else {
            setShowCannedMenu(false);
            setCannedFilter("");
        }
    };

    // --- Handle keyboard nav in canned menu ---
    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (showCannedMenu && filteredCanned.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setCannedSelectedIndex(prev => Math.min(prev + 1, filteredCanned.length - 1));
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setCannedSelectedIndex(prev => Math.max(prev - 1, 0));
                return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                selectCannedResponse(filteredCanned[cannedSelectedIndex]);
                return;
            }
            if (e.key === "Escape") {
                setShowCannedMenu(false);
                return;
            }
        }
        if (e.key === "Enter" && !showCannedMenu) {
            handleSend();
        }
    };

    // --- Assign conversation ---
    const handleAssign = async () => {
        if (!activeTenantId || !selectedConv?.id || !user?.id) return;
        setAssignLoading(true);
        try {
            const result = await api.assignConversation(activeTenantId, selectedConv.id, user.id);
            if (result.success) {
                const agentName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Agente';
                // Update the selected conversation — backend assignConversation() sets status 'with_human'
                setSelectedConv((prev: any) => ({
                    ...prev,
                    assignedAgentId: user.id,
                    assignedAgentName: agentName,
                    status: 'with_human',
                }));
                // Update the conversation in the list
                setConversations((prev: any[]) => prev.map(c =>
                    c.id === selectedConv.id
                        ? { ...c, assignedAgentId: user.id, assignedAgentName: agentName, status: 'with_human' }
                        : c
                ));
            }
        } catch (err) {
            console.error('Failed to assign conversation:', err);
        } finally {
            setAssignLoading(false);
        }
    };

    const filteredConversations = conversations.filter(c => {
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return c.contactName.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q);
        }
        if (filter === "handoff") return c.status === "handoff";
        if (filter === "unassigned") return c.isAiHandled && (c.status as string) !== "resolved";
        return true;
    });

    // ---- Interactive functions ----
    const handleSend = async () => {
        if (!messageInput.trim()) return;
        const content = messageInput.trim();
        setMessageInput("");
        setShowCannedMenu(false);
        // Optimistic add to local messages
        setMessages(prev => [...prev, {
            id: `msg_${Date.now()}`, sender: "agent" as const, content,
            senderName: user?.firstName || 'Agente',
            timestamp: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
            type: 'text',
        }]);
        setSelectedConv((prev: any) => ({ ...prev, lastMessage: content }));
        // API call
        if (activeTenantId && selectedConv?.id) {
            await api.sendMessage(activeTenantId, selectedConv.id, content, user?.id);
        }
    };

    const handleAddNote = async () => {
        if (!noteInput.trim()) return;
        const content = noteInput.trim();
        setNoteInput("");
        // API call
        if (activeTenantId && selectedConv.id) {
            await api.addNote(activeTenantId, selectedConv.id, content, user?.id);
        }
    };

    const handleResolve = async () => {
        // Optimistic update — backend resolveConversation() returns status 'active' (back to AI handling)
        setConversations((prev: any[]) => prev.map(c =>
            c.id === selectedConv.id ? { ...c, status: "active" as any } : c
        ));
        setSelectedConv((prev: any) => ({ ...prev, status: "active" as any }));
        // API call
        if (activeTenantId && selectedConv.id) {
            await api.resolveConversation(activeTenantId, selectedConv.id, user?.id);
        }
    };


    return (
        <div style={{ display: "flex", height: "calc(100vh - 64px)", margin: "-32px -40px", overflow: "hidden" }}>
            {/* Keyframes for spinner animation */}
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

            {/* ======== LEFT: Conversation List ======== */}
            <div style={{
                width: 340, borderRight: "1px solid var(--border)", display: "flex",
                flexDirection: "column", background: "var(--bg-secondary)",
            }}>
                {/* Header */}
                <div style={{ padding: "16px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px" }}>Inbox</h2>
                        <DataSourceBadge isLive={isLive} />
                    </div>

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
                            { key: "all" as const, label: "Todas", count: conversations.length },
                            { key: "handoff" as const, label: "Handoff", count: conversations.filter(c => c.status === "handoff").length },
                            { key: "unassigned" as const, label: "IA", count: conversations.filter(c => c.isAiHandled).length },
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
                                background: selectedConv?.id === conv.id ? "var(--accent-glow)" : "transparent",
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
                                            background: `${(statusLabels[conv.status]?.color || '#95a5a6')}22`,
                                            color: statusLabels[conv.status]?.color || '#95a5a6',
                                            fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                                        }}>
                                            {statusLabels[conv.status]?.label || conv.status}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            {conv.tags.length > 0 && (
                                <div style={{ display: "flex", gap: 4, marginTop: 6, marginLeft: 50 }}>
                                    {conv.tags.map((tag: string) => (
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
                {selectedConv ? (
                    <>
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
                        {selectedConv.assignedAgentName && (
                            <div style={{
                                padding: "4px 10px", borderRadius: 6, fontSize: 11,
                                background: "rgba(52, 152, 219, 0.12)", color: "#3498db",
                                display: "flex", gap: 4, alignItems: "center", fontWeight: 500,
                            }}>
                                <UserCheck size={12} />
                                {selectedConv.assignedAgentName}
                            </div>
                        )}
                        <button onClick={handleResolve} style={{
                            padding: "6px 12px", borderRadius: 8, border: "none",
                            background: "#2ecc71", color: "white", fontSize: 12, fontWeight: 600,
                            cursor: "pointer", display: "flex", gap: 4, alignItems: "center",
                        }}>
                            <CheckCircle size={14} /> Resolver
                        </button>
                        <button
                            onClick={handleAssign}
                            disabled={assignLoading}
                            style={{
                                padding: "6px 12px", borderRadius: 8, border: "none",
                                background: assignLoading ? "var(--bg-tertiary)" : "var(--accent)",
                                color: assignLoading ? "var(--text-secondary)" : "white",
                                fontSize: 12, fontWeight: 600,
                                cursor: assignLoading ? "not-allowed" : "pointer",
                                display: "flex", gap: 4, alignItems: "center",
                                opacity: assignLoading ? 0.7 : 1,
                            }}
                        >
                            {assignLoading
                                ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Asignando...</>
                                : <><ArrowRight size={14} /> {selectedConv.assignedAgentId === user?.id ? 'Reasignar a mí' : 'Asignarme'}</>
                            }
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {messages.map(msg => {
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

                    {/* AI Suggestion Banner — only when conversation is active */}
                    {selectedConv && ['with_human', 'waiting_human', 'handoff', 'assigned', 'open'].includes(selectedConv.status) && (
                        aiSuggestionLoading ? (
                            <div style={{
                                padding: "10px 14px", borderRadius: 10,
                                background: "rgba(46, 204, 113, 0.08)", border: "1px solid rgba(46, 204, 113, 0.2)",
                                display: "flex", gap: 8, alignItems: "center", marginTop: 8,
                            }}>
                                <Loader2 size={16} color="#2ecc71" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
                                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                                    Generando sugerencia de IA...
                                </div>
                            </div>
                        ) : aiSuggestion ? (
                            <div style={{
                                padding: "10px 14px", borderRadius: 10,
                                background: "rgba(46, 204, 113, 0.08)", border: "1px solid rgba(46, 204, 113, 0.2)",
                                display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8,
                            }}>
                                <Sparkles size={16} color="#2ecc71" style={{ marginTop: 2, flexShrink: 0 }} />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: "#2ecc71", marginBottom: 4 }}>Sugerencia IA</div>
                                    <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                                        &quot;{aiSuggestion}&quot;
                                    </div>
                                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                        <button
                                            onClick={() => {
                                                setMessageInput(aiSuggestion);
                                                messageInputRef.current?.focus();
                                            }}
                                            style={{
                                                padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(46, 204, 113, 0.3)",
                                                background: "transparent", color: "#2ecc71", fontSize: 12, cursor: "pointer",
                                                display: "flex", gap: 4, alignItems: "center",
                                            }}
                                        >
                                            <Zap size={12} /> Usar sugerencia
                                        </button>
                                        <button
                                            onClick={() => fetchAiSuggestion()}
                                            style={{
                                                padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)",
                                                background: "transparent", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
                                                display: "flex", gap: 4, alignItems: "center",
                                            }}
                                        >
                                            <RefreshCw size={12} /> Actualizar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : null
                    )}
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
                        {notes.length > 0 ? notes.map(note => (
                            <div key={note.id} style={{
                                padding: "6px 10px", borderRadius: 6, background: "var(--bg-secondary)",
                                marginBottom: 6, fontSize: 13,
                            }}>
                                <div>{note.content}</div>
                                <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 4 }}>— {note.agentName}, {note.createdAt}</div>
                            </div>
                        )) : (
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", opacity: 0.6 }}>No hay notas para esta conversación</div>
                        )}
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
                            <button onClick={handleAddNote} style={{
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
                        {/* Canned Responses Dropdown */}
                        {showCannedMenu && filteredCanned.length > 0 && (
                            <div style={{
                                position: "absolute", bottom: "100%", left: 0, right: 0,
                                marginBottom: 4, background: "var(--bg-secondary)",
                                border: "1px solid var(--border)", borderRadius: 10,
                                boxShadow: "0 -4px 20px rgba(0,0,0,0.15)", maxHeight: 220, overflow: "auto",
                                zIndex: 50,
                            }}>
                                <div style={{
                                    padding: "8px 12px", fontSize: 11, fontWeight: 600,
                                    color: "var(--text-secondary)", borderBottom: "1px solid var(--border)",
                                    display: "flex", gap: 4, alignItems: "center",
                                }}>
                                    <Zap size={12} /> Respuestas rápidas
                                </div>
                                {filteredCanned.map((cr, idx) => (
                                    <div
                                        key={cr.id}
                                        onClick={() => selectCannedResponse(cr)}
                                        style={{
                                            padding: "8px 12px", cursor: "pointer",
                                            background: idx === cannedSelectedIndex ? "var(--accent-glow)" : "transparent",
                                            borderBottom: idx < filteredCanned.length - 1 ? "1px solid var(--border)" : "none",
                                            transition: "background 0.1s ease",
                                        }}
                                        onMouseEnter={() => setCannedSelectedIndex(idx)}
                                    >
                                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                            <span style={{
                                                fontSize: 11, fontWeight: 600, color: "var(--accent)",
                                                background: "rgba(108, 92, 231, 0.1)", padding: "2px 6px", borderRadius: 4,
                                                fontFamily: "monospace",
                                            }}>
                                                /{cr.shortcode}
                                            </span>
                                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
                                                {cr.title}
                                            </span>
                                        </div>
                                        <div style={{
                                            fontSize: 11, color: "var(--text-secondary)", marginTop: 2,
                                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                            maxWidth: "100%",
                                        }}>
                                            {cr.content}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {showCannedMenu && filteredCanned.length === 0 && cannedFilter && (
                            <div style={{
                                position: "absolute", bottom: "100%", left: 0, right: 0,
                                marginBottom: 4, background: "var(--bg-secondary)",
                                border: "1px solid var(--border)", borderRadius: 10,
                                boxShadow: "0 -4px 20px rgba(0,0,0,0.15)", padding: "12px 14px",
                                zIndex: 50,
                            }}>
                                <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center" }}>
                                    No se encontraron respuestas para &quot;/{cannedFilter}&quot;
                                </div>
                            </div>
                        )}
                        <input
                            ref={messageInputRef}
                            value={messageInput}
                            onChange={e => handleMessageInputChange(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            onBlur={() => { setTimeout(() => setShowCannedMenu(false), 150); }}
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
                    </>
                ) : (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", gap: 16 }}>
                        <MessageSquare size={48} opacity={0.2} />
                        <span>Selecciona una conversación para ver los mensajes.</span>
                    </div>
                )}
            </div>

            {/* ======== RIGHT: Contact Panel ======== */}
            <div style={{
                width: 300, borderLeft: "1px solid var(--border)", overflow: "auto",
                background: "var(--bg-secondary)", padding: "16px",
            }}>
                {/* Contact Header — derived from selected conversation */}
                {selectedConv && (
                    <>
                    <div style={{ textAlign: "center", marginBottom: 20 }}>
                        <div style={{
                            width: 64, height: 64, borderRadius: "50%", margin: "0 auto 10px",
                            background: "linear-gradient(135deg, var(--accent), #9b59b6)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 24, fontWeight: 700, color: "white",
                        }}>
                            {selectedConv.contactName?.charAt(0) || '?'}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{selectedConv.contactName}</div>
                        <div style={{
                            padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600,
                            background: `${statusLabels[selectedConv.status]?.color || '#95a5a6'}22`,
                            color: statusLabels[selectedConv.status]?.color || '#95a5a6',
                            display: "inline-block", marginTop: 4,
                        }}>
                            {statusLabels[selectedConv.status]?.label || selectedConv.status}
                        </div>
                    </div>

                    {/* Contact Details */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                            <Phone size={14} color="var(--text-secondary)" />
                            <span>{selectedConv.contactPhone || 'Sin teléfono'}</span>
                        </div>
                        {selectedConv.contactEmail && (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                                <Mail size={14} color="var(--text-secondary)" />
                                <span>{selectedConv.contactEmail}</span>
                            </div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                            <Clock size={14} color="var(--text-secondary)" />
                            <span>{selectedConv.lastMessageAt || 'Sin interacciones'}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                            <MessageSquare size={14} color="var(--text-secondary)" />
                            <span>{selectedConv.channel}</span>
                        </div>
                    </div>

                    {/* Assigned Agent */}
                    <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                            <UserCheck size={12} /> Agente asignado
                        </div>
                        {selectedConv.assignedAgentName ? (
                            <div style={{
                                padding: "8px 12px", borderRadius: 8,
                                background: "rgba(52, 152, 219, 0.08)", border: "1px solid rgba(52, 152, 219, 0.2)",
                                display: "flex", alignItems: "center", gap: 8,
                            }}>
                                <div style={{
                                    width: 28, height: 28, borderRadius: "50%",
                                    background: "linear-gradient(135deg, #3498db, #2980b9)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: 12, fontWeight: 700, color: "white", flexShrink: 0,
                                }}>
                                    {selectedConv.assignedAgentName.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <div style={{ fontSize: 13, fontWeight: 500 }}>{selectedConv.assignedAgentName}</div>
                                    {selectedConv.assignedAgentId === user?.id && (
                                        <div style={{ fontSize: 10, color: "var(--accent)" }}>Tú</div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div style={{
                                padding: "8px 12px", borderRadius: 8,
                                background: "var(--bg-tertiary)", fontSize: 12,
                                color: "var(--text-secondary)", textAlign: "center",
                            }}>
                                Sin asignar
                            </div>
                        )}
                    </div>

                    {/* Tags */}
                    {selectedConv.tags?.length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                                <Tag size={12} /> Tags
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {selectedConv.tags.map((tag: string) => (
                                    <span key={tag} style={{
                                        fontSize: 11, padding: "3px 8px", borderRadius: 6,
                                        background: "rgba(108, 92, 231, 0.15)", color: "#6c5ce7",
                                    }}>
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Estimated Value */}
                    {selectedConv.estimatedValue > 0 && (
                        <div style={{
                            padding: "12px", borderRadius: 10, background: "var(--bg-tertiary)",
                            border: "1px solid var(--border)", marginBottom: 20,
                        }}>
                            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Valor estimado</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: "#2ecc71" }}>
                                ${selectedConv.estimatedValue.toLocaleString()} COP
                            </div>
                        </div>
                    )}
                    </>
                )}
            </div>
        </div>
    );
}
