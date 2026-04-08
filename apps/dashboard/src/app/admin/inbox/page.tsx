"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import { cn } from "@/lib/utils";
import { io } from "socket.io-client";
import {
    Search, Filter, Send, Paperclip, Smile, Phone, Mail, Tag,
    Clock, CheckCircle, AlertCircle, Bot, User, MessageSquare,
    ArrowRight, ArrowLeft, StickyNote, Sparkles, Hash, RefreshCw, Zap, Loader2, UserCheck,
    Bell, Globe, Building2, MapPin, Instagram, Facebook, Linkedin, ExternalLink, Edit2, Save,
} from "lucide-react";

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
// HELPERS
// ============================================

/** Day abbreviations in Spanish */
const DAY_ABBR = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Format a date string with smart context: today → "14:30", yesterday → "Ayer 14:30",
 *  this week → "Lun 14:30", older → "15 Mar 14:30" */
function formatTime(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "";
        const time = d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const diffDays = Math.floor((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return time;
        if (diffDays === 1) return `Ayer ${time}`;
        if (diffDays < 7) return `${DAY_ABBR[d.getDay()]} ${time}`;
        return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]} ${time}`;
    } catch {
        return "";
    }
}

/** Format a date for the day separator label */
function formatDateLabel(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (d.toDateString() === today.toDateString()) return "Hoy";
        if (d.toDateString() === yesterday.toDateString()) return "Ayer";
        return d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
    } catch {
        return "";
    }
}

/** Get the calendar date string (YYYY-MM-DD) from an ISO date */
function getDateKey(dateStr: string): string {
    try {
        return new Date(dateStr).toISOString().slice(0, 10);
    } catch {
        return "";
    }
}

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

    // --- Mobile responsive state ---
    // On mobile (<md), show either the conversation list or the chat view
    const [mobileShowChat, setMobileShowChat] = useState(false);

    // --- Canned Responses State ---
    const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
    const [showCannedMenu, setShowCannedMenu] = useState(false);
    const [cannedFilter, setCannedFilter] = useState("");
    const [cannedSelectedIndex, setCannedSelectedIndex] = useState(0);
    const messageInputRef = useRef<HTMLInputElement>(null);
    const selectedConvIdRef = useRef<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);

    // Keep ref in sync with selected conversation ID (for WebSocket handler)
    useEffect(() => {
        selectedConvIdRef.current = selectedConv?.id || null;
    }, [selectedConv?.id]);

    // --- AI Suggestion State ---
    const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
    const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);

    // --- Assign State ---
    const [assignLoading, setAssignLoading] = useState(false);

    // --- Contact Metadata State ---
    const [contactMeta, setContactMeta] = useState<Record<string, any>>({});
    const [contactMetaDirty, setContactMetaDirty] = useState(false);
    const [editingField, setEditingField] = useState<string | null>(null);
    const [contactMetaSaving, setContactMetaSaving] = useState(false);
    const [customAttrDefs, setCustomAttrDefs] = useState<any[]>([]);

    // --- Snooze State ---
    const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
    const snoozeRef = useRef<HTMLDivElement>(null);

    // --- Macros State ---
    const [showMacrosMenu, setShowMacrosMenu] = useState(false);
    const [macros, setMacros] = useState<any[]>([]);
    const [macrosLoaded, setMacrosLoaded] = useState(false);
    const macrosRef = useRef<HTMLDivElement>(null);

    // Close snooze/macros on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) setShowSnoozeMenu(false);
            if (macrosRef.current && !macrosRef.current.contains(e.target as Node)) setShowMacrosMenu(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    // Load macros on mount
    useEffect(() => {
        if (!activeTenantId || macrosLoaded) return;
        api.getMacros(activeTenantId).then((res: any) => {
            if (res?.success && Array.isArray(res.data)) setMacros(res.data);
            else if (Array.isArray(res)) setMacros(res);
            setMacrosLoaded(true);
        }).catch(() => setMacrosLoaded(true));
    }, [activeTenantId, macrosLoaded]);

    // Load custom attribute definitions on mount
    useEffect(() => {
        if (!activeTenantId) return;
        api.getCustomAttributes(activeTenantId, 'contact').then((res: any) => {
            if (res?.success && Array.isArray(res.data)) setCustomAttrDefs(res.data);
            else if (Array.isArray(res)) setCustomAttrDefs(res);
        }).catch(() => {});
    }, [activeTenantId]);

    // Reset contact metadata when conversation changes
    useEffect(() => {
        if (!selectedConv) {
            setContactMeta({});
            setContactMetaDirty(false);
            setEditingField(null);
            return;
        }
        // Initialize from whatever metadata we have on the conversation
        setContactMeta({
            empresa: selectedConv.empresa || '',
            ciudad: selectedConv.ciudad || '',
            sitio_web: selectedConv.sitio_web || '',
            instagram: selectedConv.instagram || '',
            facebook: selectedConv.facebook || '',
            linkedin: selectedConv.linkedin || '',
            notas_rapidas: selectedConv.notas_rapidas || '',
        });
        setContactMetaDirty(false);
        setEditingField(null);
    }, [selectedConv?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const updateContactMeta = (key: string, value: string) => {
        setContactMeta(prev => ({ ...prev, [key]: value }));
        setContactMetaDirty(true);
    };

    const saveContactMeta = async () => {
        if (!activeTenantId || !selectedConv?.contactId) return;
        setContactMetaSaving(true);
        try {
            await api.fetch(`/crm/contacts/${activeTenantId}/${selectedConv.contactId}`, {
                method: 'PATCH',
                body: JSON.stringify({ metadata: contactMeta }),
            });
            setContactMetaDirty(false);
        } catch (err) {
            console.error('Failed to save contact metadata:', err);
        } finally {
            setContactMetaSaving(false);
        }
    };

    const handleSnooze = async (label: string) => {
        if (!activeTenantId || !selectedConv) return;
        const now = new Date();
        let snoozeUntil: Date;
        switch (label) {
            case "1h": snoozeUntil = new Date(now.getTime() + 60 * 60 * 1000); break;
            case "3h": snoozeUntil = new Date(now.getTime() + 3 * 60 * 60 * 1000); break;
            case "tomorrow": {
                snoozeUntil = new Date(now);
                snoozeUntil.setDate(snoozeUntil.getDate() + 1);
                snoozeUntil.setHours(9, 0, 0, 0);
                break;
            }
            case "monday": {
                snoozeUntil = new Date(now);
                const day = snoozeUntil.getDay();
                const daysUntilMon = day === 0 ? 1 : 8 - day;
                snoozeUntil.setDate(snoozeUntil.getDate() + daysUntilMon);
                snoozeUntil.setHours(9, 0, 0, 0);
                break;
            }
            default: snoozeUntil = new Date(now.getTime() + 60 * 60 * 1000);
        }
        try {
            await api.snoozeConversation(activeTenantId, selectedConv.id, snoozeUntil.toISOString());
            setConversations(prev => prev.filter(c => c.id !== selectedConv.id));
            setSelectedConv(null);
            setMessages([]);
        } catch (err) {
            console.error("Snooze failed:", err);
        }
        setShowSnoozeMenu(false);
    };

    const handleExecuteMacro = async (macroId: string) => {
        if (!activeTenantId || !selectedConv || !user?.id) return;
        try {
            await api.executeMacro(activeTenantId, macroId, selectedConv.id, user.id);
            setShowMacrosMenu(false);
        } catch (err) {
            console.error("Macro execution failed:", err);
        }
    };

    // --- Total unread count for bell badge ---
    const totalUnread = useMemo(() => {
        return conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    }, [conversations]);

    // --- Auto-scroll to bottom ---
    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior });
        }, 50);
    }, []);

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages.length, scrollToBottom]);

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
                        lastMessageAt: c.last_message_at ? formatTime(c.last_message_at) : c.lastMessageAt || '',
                        lastMessageAtRaw: c.last_message_at || '',
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
                    const msgs = (conv.messages || []).map((m: any) => {
                        // FIX: Use direction field -- 'inbound' = customer, 'outbound' = AI/agent
                        // The API returns direction aliased as 'sender' in SQL, so check both fields
                        const dir = m.direction || m.sender;
                        const isInbound = dir === 'inbound';
                        // For outbound, check metadata to distinguish human agent vs AI
                        const isHumanAgent = !isInbound && (m.metadata?.source === 'agent');
                        return {
                            id: m.id,
                            content: m.content_text || m.content || '',
                            direction: isInbound ? 'inbound' : 'outbound',
                            senderLabel: isInbound ? 'Cliente' : (isHumanAgent ? 'Agente' : 'IA'),
                            senderName: isInbound ? selectedConv.contactName : (isHumanAgent ? 'Agente' : 'IA'),
                            timestamp: m.created_at ? formatTime(m.created_at) : '',
                            rawDate: m.created_at || '',
                            type: m.content_type || 'text',
                        };
                    });
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
                    // Scroll to bottom instantly on load
                    scrollToBottom("instant");
                }
            } catch (err) {
                console.error('Failed to load conversation:', err);
                setMessages([]);
            }
        }
        loadMessages();
    }, [activeTenantId, selectedConv?.id, scrollToBottom]);

    // WebSocket real-time updates
    useEffect(() => {
        if (!activeTenantId) return;

        const token = localStorage.getItem("accessToken");
        // Socket.io needs the base URL without /api/v1 path
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1";
        const socketUrl = apiUrl.replace(/\/api\/v\d+\/?$/, '');

        const socket = io(`${socketUrl}/inbox`, {
            auth: { token },
            transports: ['websocket', 'polling'],
        });

        socket.on('connect', () => {
            console.log('Connected to Inbox live updates');
            setIsLive(true);
        });

        socket.on('disconnect', () => {
            setIsLive(false);
        });

        socket.on('newMessage', (payload: any) => {
            const { conversationId, message } = payload;

            // FIX: Use direction field -- 'inbound' = customer, 'outbound' = AI/agent
            const isInbound = message.direction === 'inbound';
            const isHumanAgent = !isInbound && (message.metadata?.source === 'agent');
            const uiMsg = {
                id: message.id,
                content: message.content_text || message.content || '',
                direction: isInbound ? 'inbound' : 'outbound',
                senderLabel: isInbound ? 'Cliente' : (isHumanAgent ? 'Agente' : 'IA'),
                senderName: isInbound ? 'Cliente' : (isHumanAgent ? 'Agente' : 'IA'),
                timestamp: message.created_at ? formatTime(message.created_at) : new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
                rawDate: message.created_at || new Date().toISOString(),
                type: message.content_type || 'text',
            };

            // Increment unread count if this conversation is not currently selected
            const isViewing = selectedConvIdRef.current === conversationId;

            // Update conversation list with latest message + unread badge
            setConversations((prev: any[]) => prev.map(c => {
                 if (c.id === conversationId) {
                     return {
                         ...c,
                         lastMessage: uiMsg.content,
                         lastMessageAt: formatTime(uiMsg.rawDate),
                         lastMessageAtRaw: uiMsg.rawDate,
                         unreadCount: isViewing ? 0 : (c.unreadCount || 0) + 1,
                     };
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
                // Update the selected conversation -- backend assignConversation() sets status 'with_human'
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
        const now = new Date();
        setMessages(prev => [...prev, {
            id: `msg_${Date.now()}`,
            direction: 'outbound',
            content,
            senderLabel: 'Agente',
            senderName: user?.firstName || 'Agente',
            timestamp: now.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
            rawDate: now.toISOString(),
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
        // Optimistic update -- backend resolveConversation() returns status 'active' (back to AI handling)
        setConversations((prev: any[]) => prev.map(c =>
            c.id === selectedConv.id ? { ...c, status: "active" as any } : c
        ));
        setSelectedConv((prev: any) => ({ ...prev, status: "active" as any }));
        // API call
        if (activeTenantId && selectedConv.id) {
            await api.resolveConversation(activeTenantId, selectedConv.id, user?.id);
        }
    };

    // --- Build messages with date separators ---
    const messagesWithSeparators = useMemo(() => {
        const result: any[] = [];
        let lastDateKey = "";
        for (const msg of messages) {
            const dateKey = getDateKey(msg.rawDate);
            if (dateKey && dateKey !== lastDateKey) {
                result.push({ _type: "date-separator", date: msg.rawDate, key: `sep-${dateKey}` });
                lastDateKey = dateKey;
            }
            result.push(msg);
        }
        return result;
    }, [messages]);


    return (
        <div className="flex h-[calc(100%+48px)] -m-6 overflow-hidden">
            {/* Keyframes for animations */}
            <style>{`
                @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
                .inbox-msg-bubble { animation: fadeIn 0.2s ease-out; }
                .inbox-conv-item:hover { background: hsl(var(--muted)) !important; }
                .inbox-scrollbar::-webkit-scrollbar { width: 6px; }
                .inbox-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .inbox-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 3px; }
                .inbox-scrollbar::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.3); border-radius: 3px; }
            `}</style>

            {/* ======== LEFT: Conversation List ======== */}
            <div className={cn(
                "border-r border-border flex flex-col bg-card flex-shrink-0",
                "w-full md:w-[280px] lg:w-[320px]",
                mobileShowChat ? "hidden md:flex" : "flex"
            )}>
                {/* Header */}
                <div className="p-4 border-b border-border">
                    <div className="flex justify-between items-center mb-3">
                        <h2 className="text-xl font-bold m-0">Inbox</h2>
                        <div className="flex items-center gap-2.5">
                            {/* Notification Bell */}
                            <div className="relative cursor-pointer">
                                <Bell size={20} className="text-muted-foreground" />
                                {totalUnread > 0 && (
                                    <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full px-[5px] py-px min-w-[16px] text-center leading-[14px] shadow-[0_0_0_2px_hsl(var(--card))]">
                                        {totalUnread > 99 ? "99+" : totalUnread}
                                    </span>
                                )}
                            </div>
                            <DataSourceBadge isLive={isLive} />
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative mb-3">
                        <Search size={16} className="absolute left-2.5 top-2.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Buscar conversaciones..."
                            className="w-full py-2 px-3 pl-[34px] rounded-lg border border-border bg-neutral-100 dark:bg-neutral-800 text-foreground text-[13px] outline-none"
                        />
                    </div>

                    {/* Filters */}
                    <div className="flex gap-1">
                        {([
                            { key: "all" as const, label: "Todas", count: conversations.length },
                            { key: "handoff" as const, label: "Handoff", count: conversations.filter(c => c.status === "handoff").length },
                            { key: "unassigned" as const, label: "IA", count: conversations.filter(c => c.isAiHandled).length },
                        ]).map(f => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                className={cn(
                                    "py-1 px-2.5 rounded-md border-none text-xs cursor-pointer transition-colors",
                                    filter === f.key
                                        ? "font-semibold bg-indigo-600 text-white"
                                        : "font-normal bg-transparent text-muted-foreground hover:bg-muted"
                                )}
                            >
                                {f.label} ({f.count})
                            </button>
                        ))}
                    </div>
                </div>

                {/* Conversation List */}
                <div className="inbox-scrollbar flex-1 overflow-auto">
                    {filteredConversations.map(conv => {
                        const hasUnread = (conv.unreadCount || 0) > 0;
                        const isSelected = selectedConv?.id === conv.id;
                        return (
                        <div
                            key={conv.id}
                            className="inbox-conv-item"
                            onClick={() => {
                                setSelectedConv(conv);
                                setMobileShowChat(true);
                                // Clear unread badge when selecting
                                setConversations(prev => prev.map(c =>
                                    c.id === conv.id ? { ...c, unreadCount: 0 } : c
                                ));
                            }}
                            style={{
                                padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid hsl(var(--border))",
                                background: isSelected ? "rgba(108, 92, 231, 0.08)" : "transparent",
                                transition: "background 0.15s ease",
                            }}
                        >
                            <div className="flex justify-between items-start">
                                <div className="flex gap-2.5 items-center flex-1">
                                    {/* Avatar with unread green dot */}
                                    <div className="relative flex-shrink-0">
                                        <div
                                            className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold text-white"
                                            style={{ background: `linear-gradient(135deg, ${priorityColors[conv.priority]}, ${priorityColors[conv.priority]}88)` }}
                                        >
                                            {conv.contactName.charAt(0)}
                                        </div>
                                        {hasUnread && !isSelected && (
                                            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-card" />
                                        )}
                                    </div>
                                    <div className="overflow-hidden flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className={cn("text-sm", hasUnread ? "font-bold text-foreground" : "font-semibold")}>
                                                {conv.contactName}
                                            </span>
                                            {conv.isAiHandled && <Bot size={14} className="text-indigo-600" />}
                                        </div>
                                        <div className={cn(
                                            "text-xs mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis",
                                            hasUnread ? "text-foreground font-medium" : "text-muted-foreground font-normal"
                                        )}>
                                            {conv.lastMessage}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                    <span className="text-[11px] text-muted-foreground">{conv.lastMessageAt}</span>
                                    <div className="flex gap-1 items-center">
                                        {hasUnread && (
                                            <span className="bg-emerald-500 text-white text-[10px] rounded-full px-1.5 py-px font-bold min-w-[18px] text-center">
                                                {conv.unreadCount}
                                            </span>
                                        )}
                                        <span
                                            className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                                            style={{
                                                background: `${(statusLabels[conv.status]?.color || '#95a5a6')}22`,
                                                color: statusLabels[conv.status]?.color || '#95a5a6',
                                            }}
                                        >
                                            {statusLabels[conv.status]?.label || conv.status}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            {conv.tags.length > 0 && (
                                <div className="flex gap-1 mt-1.5 ml-[50px]">
                                    {conv.tags.map((tag: string) => (
                                        <span key={tag} className="text-[10px] px-1.5 py-px rounded bg-indigo-600/15 text-indigo-600 dark:text-indigo-400">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                        );
                    })}
                </div>
            </div>

            {/* ======== CENTER: Chat Thread ======== */}
            <div className={cn(
                "flex-1 flex flex-col bg-background min-w-0",
                mobileShowChat ? "flex" : "hidden md:flex"
            )}>
                {selectedConv ? (
                    <>
                {/* Chat Header */}
                <div className="px-3 md:px-5 py-3 border-b border-border flex justify-between items-center bg-card gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                        {/* Mobile back button */}
                        <button
                            onClick={() => setMobileShowChat(false)}
                            className="md:hidden p-1.5 rounded-lg border-none bg-transparent text-muted-foreground cursor-pointer hover:bg-muted flex-shrink-0"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white"
                            style={{ background: `linear-gradient(135deg, ${priorityColors[selectedConv.priority]}, ${priorityColors[selectedConv.priority]}88)` }}
                        >
                            {selectedConv.contactName.charAt(0)}
                        </div>
                        <div>
                            <div className="font-semibold text-[15px]">{selectedConv.contactName}</div>
                            <div className="text-xs text-muted-foreground">{selectedConv.contactPhone} · {selectedConv.channel}</div>
                        </div>
                    </div>
                    <div className="flex gap-1.5 md:gap-2 flex-wrap justify-end flex-shrink-0">
                        <button
                            onClick={() => setShowNotes(!showNotes)}
                            className={cn(
                                "py-1.5 px-3 rounded-lg border text-xs cursor-pointer flex gap-1 items-center transition-colors",
                                showNotes
                                    ? "bg-indigo-600 text-white border-indigo-600"
                                    : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                            )}
                        >
                            <StickyNote size={14} /> Notas
                        </button>
                        {selectedConv.assignedAgentName && (
                            <div className="py-1 px-2.5 rounded-md text-[11px] bg-blue-500/10 text-blue-500 flex gap-1 items-center font-medium">
                                <UserCheck size={12} />
                                {selectedConv.assignedAgentName}
                            </div>
                        )}
                        <button
                            onClick={handleResolve}
                            className="py-1.5 px-3 rounded-lg border-none bg-emerald-500 text-white text-xs font-semibold cursor-pointer flex gap-1 items-center hover:bg-emerald-600"
                        >
                            <CheckCircle size={14} /> Resolver
                        </button>
                        <button
                            onClick={handleAssign}
                            disabled={assignLoading}
                            className={cn(
                                "py-1.5 px-3 rounded-lg border-none text-xs font-semibold flex gap-1 items-center transition-opacity",
                                assignLoading
                                    ? "bg-muted text-muted-foreground cursor-not-allowed opacity-70"
                                    : "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
                            )}
                        >
                            {assignLoading
                                ? <><Loader2 size={14} className="animate-spin" /> Asignando...</>
                                : <><ArrowRight size={14} /> {selectedConv.assignedAgentId === user?.id ? 'Reasignar a mi' : 'Asignarme'}</>
                            }
                        </button>
                        {/* Snooze Button */}
                        <div ref={snoozeRef} className="relative">
                            <button
                                onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
                                className={cn(
                                    "py-1.5 px-3 rounded-lg border text-xs cursor-pointer flex gap-1 items-center transition-colors",
                                    showSnoozeMenu
                                        ? "bg-indigo-600 text-white border-indigo-600"
                                        : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                                )}
                            >
                                <Clock size={14} /> Snooze
                            </button>
                            {showSnoozeMenu && (
                                <div className="absolute top-full right-0 mt-1 bg-card border border-border rounded-[10px] p-1 z-[100] min-w-[160px] shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
                                    {[
                                        { key: "1h", label: "1 hora" },
                                        { key: "3h", label: "3 horas" },
                                        { key: "tomorrow", label: "Mañana 9am" },
                                        { key: "monday", label: "Próximo lunes" },
                                    ].map(opt => (
                                        <button
                                            key={opt.key}
                                            onClick={() => handleSnooze(opt.key)}
                                            className="flex items-center gap-2 w-full py-2 px-3 border-none rounded-md bg-transparent text-foreground text-[13px] cursor-pointer text-left hover:bg-muted"
                                        >
                                            <Clock size={13} className="text-muted-foreground" />
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {/* Macros Button */}
                        <div ref={macrosRef} className="relative">
                            <button
                                onClick={() => setShowMacrosMenu(!showMacrosMenu)}
                                className={cn(
                                    "py-1.5 px-3 rounded-lg border text-xs cursor-pointer flex gap-1 items-center transition-colors",
                                    showMacrosMenu
                                        ? "bg-indigo-600 text-white border-indigo-600"
                                        : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                                )}
                            >
                                <Zap size={14} /> Macros
                            </button>
                            {showMacrosMenu && (
                                <div className="absolute top-full right-0 mt-1 bg-card border border-border rounded-[10px] p-1 z-[100] min-w-[200px] max-h-60 overflow-y-auto shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
                                    {macros.length === 0 ? (
                                        <div className="py-3 px-3.5 text-[13px] text-muted-foreground">
                                            No hay macros configurados
                                        </div>
                                    ) : macros.map((m: any) => (
                                        <button
                                            key={m.id}
                                            onClick={() => handleExecuteMacro(m.id)}
                                            className="flex items-center justify-between w-full py-2 px-3 border-none rounded-md bg-transparent text-foreground text-[13px] cursor-pointer text-left hover:bg-muted"
                                        >
                                            <span>{m.name}</span>
                                            {m.actions && (
                                                <span className="text-[11px] text-muted-foreground">
                                                    {Array.isArray(m.actions) ? m.actions.length : 0} acciones
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Messages Area */}
                <div
                    ref={messagesContainerRef}
                    className="inbox-scrollbar flex-1 overflow-auto px-3 md:px-6 py-4 flex flex-col gap-1 bg-[radial-gradient(circle_at_20%_80%,hsl(var(--muted)/0.3)_0%,transparent_50%),radial-gradient(circle_at_80%_20%,hsl(var(--muted)/0.2)_0%,transparent_50%)]"
                >
                    {messagesWithSeparators.map((item: any) => {
                        // Date separator
                        if (item._type === "date-separator") {
                            return (
                                <div key={item.key} className="flex items-center justify-center py-3 gap-3">
                                    <div className="flex-1 h-px bg-border opacity-50" />
                                    <span className="text-[11px] text-muted-foreground bg-background px-3 py-1 rounded-xl font-medium border border-border capitalize">
                                        {formatDateLabel(item.date)}
                                    </span>
                                    <div className="flex-1 h-px bg-border opacity-50" />
                                </div>
                            );
                        }

                        const msg = item;
                        const isInbound = msg.direction === "inbound";

                        // System messages
                        if (msg.type === "system") {
                            return (
                                <div key={msg.id} className="inbox-msg-bubble text-center text-[11px] text-muted-foreground px-4 py-2 bg-red-500/[0.08] rounded-lg mx-auto max-w-[80%] flex gap-1.5 items-center justify-center">
                                    <AlertCircle size={14} className="text-red-500" />
                                    {msg.content}
                                </div>
                            );
                        }

                        return (
                            <div key={msg.id} className={cn(
                                "inbox-msg-bubble flex items-end gap-1.5 mb-1",
                                isInbound ? "justify-start" : "justify-end"
                            )}>
                                {/* Customer avatar (left side) */}
                                {isInbound && (
                                    <div className="w-7 h-7 rounded-full flex-shrink-0 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-0.5">
                                        <User size={14} className="text-muted-foreground" />
                                    </div>
                                )}

                                <div className="max-w-[65%]">
                                    {/* Sender label + timestamp */}
                                    <div className={cn(
                                        "text-[10px] text-muted-foreground mb-[3px] flex gap-1 items-center",
                                        isInbound ? "text-left justify-start pl-1" : "text-right justify-end pr-1"
                                    )}>
                                        {!isInbound && msg.senderLabel === "IA" && <Bot size={10} className="text-indigo-600" />}
                                        {!isInbound && msg.senderLabel === "Agente" && <User size={10} />}
                                        <span className="font-semibold">{msg.senderLabel || msg.senderName}</span>
                                        <span className="opacity-60">{msg.timestamp}</span>
                                    </div>

                                    {/* Bubble */}
                                    <div className={cn(
                                        "px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm break-words",
                                        isInbound
                                            ? "bg-card border border-border rounded-bl-sm"
                                            : msg.senderLabel === "IA"
                                                ? "bg-indigo-600/[0.18] border border-indigo-600/30 rounded-br-sm text-foreground"
                                                : "bg-indigo-600 border-none rounded-br-sm text-white"
                                    )}>
                                        {msg.content}
                                    </div>
                                </div>

                                {/* Outbound: small icon on right */}
                                {!isInbound && (
                                    <div className={cn(
                                        "w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mb-0.5",
                                        msg.senderLabel === "IA" ? "bg-indigo-600/15" : "bg-indigo-600/25"
                                    )}>
                                        {msg.senderLabel === "IA"
                                            ? <Bot size={14} className="text-indigo-600" />
                                            : <User size={14} className="text-indigo-600" />
                                        }
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* AI Suggestion Banner -- only when conversation is active */}
                    {selectedConv && ['with_human', 'waiting_human', 'handoff', 'assigned', 'open'].includes(selectedConv.status) && (
                        aiSuggestionLoading ? (
                            <div className="px-3.5 py-2.5 rounded-[10px] bg-emerald-500/[0.08] border border-emerald-500/20 flex gap-2 items-center mt-2">
                                <Loader2 size={16} className="text-emerald-500 animate-spin flex-shrink-0" />
                                <div className="text-[13px] text-muted-foreground">
                                    Generando sugerencia de IA...
                                </div>
                            </div>
                        ) : aiSuggestion ? (
                            <div className="px-3.5 py-2.5 rounded-[10px] bg-emerald-500/[0.08] border border-emerald-500/20 flex gap-2 items-start mt-2">
                                <Sparkles size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                                <div className="flex-1">
                                    <div className="text-[11px] font-semibold text-emerald-500 mb-1">Sugerencia IA</div>
                                    <div className="text-[13px] text-muted-foreground">
                                        &quot;{aiSuggestion}&quot;
                                    </div>
                                    <div className="flex gap-1.5 mt-1.5">
                                        <button
                                            onClick={() => {
                                                setMessageInput(aiSuggestion);
                                                messageInputRef.current?.focus();
                                            }}
                                            className="py-1 px-2.5 rounded-md border border-emerald-500/30 bg-transparent text-emerald-500 text-xs cursor-pointer flex gap-1 items-center hover:bg-emerald-500/10"
                                        >
                                            <Zap size={12} /> Usar sugerencia
                                        </button>
                                        <button
                                            onClick={() => fetchAiSuggestion()}
                                            className="py-1 px-2.5 rounded-md border border-border bg-transparent text-muted-foreground text-xs cursor-pointer flex gap-1 items-center hover:bg-muted"
                                        >
                                            <RefreshCw size={12} /> Actualizar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : null
                    )}

                    {/* Typing indicator area (visual placeholder for future use) */}
                    <div className="min-h-1" />

                    {/* Scroll anchor */}
                    <div ref={messagesEndRef} />
                </div>

                {/* Notes Panel (conditional) */}
                {showNotes && (
                    <div className="border-t border-border px-3 md:px-5 py-3 bg-amber-500/5 max-h-[200px] overflow-auto">
                        <div className="text-xs font-semibold text-amber-500 mb-2 flex gap-1 items-center">
                            <StickyNote size={14} /> Notas internas
                        </div>
                        {notes.length > 0 ? notes.map(note => (
                            <div key={note.id} className="px-2.5 py-1.5 rounded-md bg-card mb-1.5 text-[13px]">
                                <div>{note.content}</div>
                                <div className="text-[10px] text-muted-foreground mt-1">— {note.agentName}, {note.createdAt}</div>
                            </div>
                        )) : (
                            <div className="text-xs text-muted-foreground opacity-60">No hay notas para esta conversacion</div>
                        )}
                        <div className="flex gap-2 mt-2">
                            <input
                                value={noteInput}
                                onChange={e => setNoteInput(e.target.value)}
                                placeholder="Agregar nota interna..."
                                className="flex-1 py-1.5 px-2.5 rounded-md border border-border bg-neutral-100 dark:bg-neutral-800 text-foreground text-xs outline-none"
                            />
                            <button
                                onClick={handleAddNote}
                                className="py-1.5 px-3 rounded-md border-none bg-amber-500 text-white text-xs cursor-pointer hover:bg-amber-600"
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                )}

                {/* Message Input */}
                <div className="px-3 md:px-5 py-3 border-t border-border flex gap-2 items-center bg-card">
                    <button className="bg-transparent border-none text-muted-foreground cursor-pointer p-1 hover:text-foreground">
                        <Paperclip size={20} />
                    </button>
                    <div className="relative flex-1">
                        {/* Canned Responses Dropdown */}
                        {showCannedMenu && filteredCanned.length > 0 && (
                            <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-[10px] shadow-[0_-4px_20px_rgba(0,0,0,0.15)] max-h-[220px] overflow-auto z-50">
                                <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground border-b border-border flex gap-1 items-center">
                                    <Zap size={12} /> Respuestas rapidas
                                </div>
                                {filteredCanned.map((cr, idx) => (
                                    <div
                                        key={cr.id}
                                        onClick={() => selectCannedResponse(cr)}
                                        className={cn(
                                            "px-3 py-2 cursor-pointer transition-colors duration-100",
                                            idx === cannedSelectedIndex ? "bg-indigo-600/[0.08]" : "bg-transparent",
                                            idx < filteredCanned.length - 1 && "border-b border-border"
                                        )}
                                        onMouseEnter={() => setCannedSelectedIndex(idx)}
                                    >
                                        <div className="flex gap-2 items-center">
                                            <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-600/10 px-1.5 py-0.5 rounded font-mono">
                                                /{cr.shortcode}
                                            </span>
                                            <span className="text-xs font-medium text-foreground">
                                                {cr.title}
                                            </span>
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                                            {cr.content}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {showCannedMenu && filteredCanned.length === 0 && cannedFilter && (
                            <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-[10px] shadow-[0_-4px_20px_rgba(0,0,0,0.15)] px-3.5 py-3 z-50">
                                <div className="text-xs text-muted-foreground text-center">
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
                            placeholder="Escribe un mensaje... (/ para respuestas rapidas)"
                            className="w-full py-2.5 px-3.5 rounded-full border border-border bg-neutral-100 dark:bg-neutral-800 text-foreground text-sm outline-none"
                        />
                    </div>
                    <button className="bg-transparent border-none text-muted-foreground cursor-pointer p-1 hover:text-foreground">
                        <Smile size={20} />
                    </button>
                    <button
                        onClick={handleSend}
                        className="p-2.5 rounded-full border-none bg-indigo-600 text-white cursor-pointer flex items-center justify-center hover:bg-indigo-700 transition-transform duration-100 active:scale-95"
                    >
                        <Send size={18} />
                    </button>
                </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
                        <MessageSquare size={48} className="opacity-20" />
                        <span>Selecciona una conversacion para ver los mensajes.</span>
                    </div>
                )}
            </div>

            {/* ======== RIGHT: Contact Panel ======== */}
            <div className="inbox-scrollbar hidden lg:block w-[280px] border-l border-border overflow-auto bg-card p-4 flex-shrink-0">
                {/* Contact Header -- derived from selected conversation */}
                {selectedConv && (
                    <>
                    <div className="text-center mb-5">
                        <div className="w-16 h-16 rounded-full mx-auto mb-2.5 bg-gradient-to-br from-indigo-600 to-purple-500 flex items-center justify-center text-2xl font-bold text-white">
                            {selectedConv.contactName?.charAt(0) || '?'}
                        </div>
                        <div className="font-bold text-base">{selectedConv.contactName}</div>
                        <span
                            className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                            style={{
                                background: `${statusLabels[selectedConv.status]?.color || '#95a5a6'}22`,
                                color: statusLabels[selectedConv.status]?.color || '#95a5a6',
                            }}
                        >
                            {statusLabels[selectedConv.status]?.label || selectedConv.status}
                        </span>
                    </div>

                    {/* Contact Details */}
                    <div className="flex flex-col gap-2.5 mb-5">
                        <div className="flex items-center gap-2 text-[13px]">
                            <Phone size={14} className="text-muted-foreground" />
                            <span>{selectedConv.contactPhone || 'Sin telefono'}</span>
                        </div>
                        {selectedConv.contactEmail && (
                            <div className="flex items-center gap-2 text-[13px]">
                                <Mail size={14} className="text-muted-foreground" />
                                <span>{selectedConv.contactEmail}</span>
                            </div>
                        )}
                        <div className="flex items-center gap-2 text-[13px]">
                            <Clock size={14} className="text-muted-foreground" />
                            <span>{selectedConv.lastMessageAt || 'Sin interacciones'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[13px]">
                            <MessageSquare size={14} className="text-muted-foreground" />
                            <span>{selectedConv.channel}</span>
                        </div>
                    </div>

                    {/* Assigned Agent */}
                    <div className="mb-5">
                        <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                            <UserCheck size={12} /> Agente asignado
                        </div>
                        {selectedConv.assignedAgentName ? (
                            <div className="px-3 py-2 rounded-lg bg-blue-500/[0.08] border border-blue-500/20 flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                                    {selectedConv.assignedAgentName.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <div className="text-[13px] font-medium">{selectedConv.assignedAgentName}</div>
                                    {selectedConv.assignedAgentId === user?.id && (
                                        <div className="text-[10px] text-indigo-600">Tu</div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-xs text-muted-foreground text-center">
                                Sin asignar
                            </div>
                        )}
                    </div>

                    {/* Tags */}
                    {selectedConv.tags?.length > 0 && (
                        <div className="mb-5">
                            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                                <Tag size={12} /> Tags
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {selectedConv.tags.map((tag: string) => (
                                    <span key={tag} className="text-[11px] px-2 py-[3px] rounded-md bg-indigo-600/15 text-indigo-600 dark:text-indigo-400">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Estimated Value */}
                    {selectedConv.estimatedValue > 0 && (
                        <div className="p-3 rounded-[10px] bg-neutral-100 dark:bg-neutral-800 border border-border mb-5">
                            <div className="text-[11px] text-muted-foreground">Valor estimado</div>
                            <div className="text-xl font-bold text-emerald-500">
                                ${selectedConv.estimatedValue.toLocaleString()} COP
                            </div>
                        </div>
                    )}

                    {/* Información adicional */}
                    <div className="mb-5">
                        <div className="text-xs font-semibold text-muted-foreground mb-2.5 flex items-center gap-1">
                            <Edit2 size={12} /> Información adicional
                        </div>
                        <div className="flex flex-col gap-2">
                            {/* Empresa */}
                            <div className="flex items-start gap-2 text-[13px] group">
                                <Building2 size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] text-muted-foreground mb-0.5">Empresa</div>
                                    {editingField === 'empresa' ? (
                                        <input
                                            autoFocus
                                            value={contactMeta.empresa || ''}
                                            onChange={e => updateContactMeta('empresa', e.target.value)}
                                            onBlur={() => setEditingField(null)}
                                            onKeyDown={e => e.key === 'Enter' && setEditingField(null)}
                                            className="w-full py-1 px-2 rounded border border-border bg-neutral-100 dark:bg-neutral-800 text-foreground text-xs outline-none"
                                        />
                                    ) : (
                                        <div
                                            onClick={() => setEditingField('empresa')}
                                            className="text-xs cursor-pointer hover:text-indigo-400 transition-colors truncate"
                                        >
                                            {contactMeta.empresa || <span className="text-muted-foreground opacity-50 italic">Agregar empresa...</span>}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Ciudad */}
                            <div className="flex items-start gap-2 text-[13px] group">
                                <MapPin size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] text-muted-foreground mb-0.5">Ciudad</div>
                                    {editingField === 'ciudad' ? (
                                        <input
                                            autoFocus
                                            value={contactMeta.ciudad || ''}
                                            onChange={e => updateContactMeta('ciudad', e.target.value)}
                                            onBlur={() => setEditingField(null)}
                                            onKeyDown={e => e.key === 'Enter' && setEditingField(null)}
                                            className="w-full py-1 px-2 rounded border border-border bg-neutral-100 dark:bg-neutral-800 text-foreground text-xs outline-none"
                                        />
                                    ) : (
                                        <div
                                            onClick={() => setEditingField('ciudad')}
                                            className="text-xs cursor-pointer hover:text-indigo-400 transition-colors truncate"
                                        >
                                            {contactMeta.ciudad || <span className="text-muted-foreground opacity-50 italic">Agregar ciudad...</span>}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Sitio web */}
                            <div className="flex items-start gap-2 text-[13px] group">
                                <Globe size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] text-muted-foreground mb-0.5">Sitio web</div>
                                    {editingField === 'sitio_web' ? (
                                        <input
                                            autoFocus
                                            value={contactMeta.sitio_web || ''}
                                            onChange={e => updateContactMeta('sitio_web', e.target.value)}
                                            onBlur={() => setEditingField(null)}
                                            onKeyDown={e => e.key === 'Enter' && setEditingField(null)}
                                            placeholder="https://..."
                                            className="w-full py-1 px-2 rounded border border-border bg-neutral-100 dark:bg-neutral-800 text-foreground text-xs outline-none"
                                        />
                                    ) : contactMeta.sitio_web ? (
                                        <div className="flex items-center gap-1">
                                            <a
                                                href={contactMeta.sitio_web.startsWith('http') ? contactMeta.sitio_web : `https://${contactMeta.sitio_web}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-indigo-400 hover:text-indigo-300 truncate"
                                            >
                                                {contactMeta.sitio_web}
                                            </a>
                                            <ExternalLink size={10} className="text-muted-foreground flex-shrink-0 cursor-pointer" onClick={() => setEditingField('sitio_web')} />
                                        </div>
                                    ) : (
                                        <div
                                            onClick={() => setEditingField('sitio_web')}
                                            className="text-xs cursor-pointer hover:text-indigo-400 transition-colors"
                                        >
                                            <span className="text-muted-foreground opacity-50 italic">Agregar sitio web...</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Redes sociales */}
                            <div className="flex items-start gap-2 text-[13px]">
                                <Hash size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] text-muted-foreground mb-1">Redes sociales</div>
                                    <div className="flex gap-2">
                                        {/* Instagram */}
                                        <div className="relative group/social">
                                            <button
                                                onClick={() => setEditingField(editingField === 'instagram' ? null : 'instagram')}
                                                className={cn(
                                                    "w-7 h-7 rounded-md border flex items-center justify-center cursor-pointer transition-colors",
                                                    contactMeta.instagram
                                                        ? "border-pink-500/30 bg-pink-500/10 text-pink-500"
                                                        : "border-border bg-transparent text-muted-foreground hover:border-pink-500/30 hover:text-pink-500"
                                                )}
                                                title={contactMeta.instagram || 'Instagram'}
                                            >
                                                <Instagram size={14} />
                                            </button>
                                            {editingField === 'instagram' && (
                                                <input
                                                    autoFocus
                                                    value={contactMeta.instagram || ''}
                                                    onChange={e => updateContactMeta('instagram', e.target.value)}
                                                    onBlur={() => setEditingField(null)}
                                                    onKeyDown={e => e.key === 'Enter' && setEditingField(null)}
                                                    placeholder="@usuario"
                                                    className="absolute top-full left-0 mt-1 w-32 py-1 px-2 rounded border border-border bg-card text-foreground text-xs outline-none z-10 shadow-lg"
                                                />
                                            )}
                                        </div>
                                        {/* Facebook */}
                                        <div className="relative group/social">
                                            <button
                                                onClick={() => setEditingField(editingField === 'facebook' ? null : 'facebook')}
                                                className={cn(
                                                    "w-7 h-7 rounded-md border flex items-center justify-center cursor-pointer transition-colors",
                                                    contactMeta.facebook
                                                        ? "border-blue-500/30 bg-blue-500/10 text-blue-500"
                                                        : "border-border bg-transparent text-muted-foreground hover:border-blue-500/30 hover:text-blue-500"
                                                )}
                                                title={contactMeta.facebook || 'Facebook'}
                                            >
                                                <Facebook size={14} />
                                            </button>
                                            {editingField === 'facebook' && (
                                                <input
                                                    autoFocus
                                                    value={contactMeta.facebook || ''}
                                                    onChange={e => updateContactMeta('facebook', e.target.value)}
                                                    onBlur={() => setEditingField(null)}
                                                    onKeyDown={e => e.key === 'Enter' && setEditingField(null)}
                                                    placeholder="facebook.com/..."
                                                    className="absolute top-full left-0 mt-1 w-32 py-1 px-2 rounded border border-border bg-card text-foreground text-xs outline-none z-10 shadow-lg"
                                                />
                                            )}
                                        </div>
                                        {/* LinkedIn */}
                                        <div className="relative group/social">
                                            <button
                                                onClick={() => setEditingField(editingField === 'linkedin' ? null : 'linkedin')}
                                                className={cn(
                                                    "w-7 h-7 rounded-md border flex items-center justify-center cursor-pointer transition-colors",
                                                    contactMeta.linkedin
                                                        ? "border-sky-500/30 bg-sky-500/10 text-sky-500"
                                                        : "border-border bg-transparent text-muted-foreground hover:border-sky-500/30 hover:text-sky-500"
                                                )}
                                                title={contactMeta.linkedin || 'LinkedIn'}
                                            >
                                                <Linkedin size={14} />
                                            </button>
                                            {editingField === 'linkedin' && (
                                                <input
                                                    autoFocus
                                                    value={contactMeta.linkedin || ''}
                                                    onChange={e => updateContactMeta('linkedin', e.target.value)}
                                                    onBlur={() => setEditingField(null)}
                                                    onKeyDown={e => e.key === 'Enter' && setEditingField(null)}
                                                    placeholder="linkedin.com/in/..."
                                                    className="absolute top-full left-0 mt-1 w-32 py-1 px-2 rounded border border-border bg-card text-foreground text-xs outline-none z-10 shadow-lg"
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Notas rápidas */}
                            <div className="flex items-start gap-2 text-[13px]">
                                <StickyNote size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] text-muted-foreground mb-0.5">Notas rápidas</div>
                                    <textarea
                                        value={contactMeta.notas_rapidas || ''}
                                        onChange={e => updateContactMeta('notas_rapidas', e.target.value)}
                                        placeholder="Escribir nota sobre este contacto..."
                                        rows={2}
                                        className="w-full py-1.5 px-2 rounded border border-border bg-neutral-100 dark:bg-neutral-800 text-foreground text-xs outline-none resize-none"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Save button */}
                        {contactMetaDirty && (
                            <button
                                onClick={saveContactMeta}
                                disabled={contactMetaSaving}
                                className={cn(
                                    "w-full mt-3 py-2 px-3 rounded-lg border-none text-xs font-semibold flex gap-1.5 items-center justify-center transition-colors",
                                    contactMetaSaving
                                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                                        : "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
                                )}
                            >
                                {contactMetaSaving
                                    ? <><Loader2 size={14} className="animate-spin" /> Guardando...</>
                                    : <><Save size={14} /> Guardar cambios</>
                                }
                            </button>
                        )}
                    </div>

                    {/* Custom Attributes */}
                    {customAttrDefs.length > 0 && (
                        <div className="mb-5">
                            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                                <Hash size={12} /> Atributos personalizados
                            </div>
                            <div className="flex flex-col gap-2">
                                {customAttrDefs.map((attr: any) => {
                                    const key = attr.key || attr.name || attr.id;
                                    const label = attr.label || attr.name || key;
                                    const value = contactMeta[key] || '';
                                    return (
                                        <div key={key} className="flex items-start gap-2 text-[13px]">
                                            <Hash size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
                                                {editingField === `custom_${key}` ? (
                                                    <input
                                                        autoFocus
                                                        value={value}
                                                        onChange={e => updateContactMeta(key, e.target.value)}
                                                        onBlur={() => setEditingField(null)}
                                                        onKeyDown={e => e.key === 'Enter' && setEditingField(null)}
                                                        className="w-full py-1 px-2 rounded border border-border bg-neutral-100 dark:bg-neutral-800 text-foreground text-xs outline-none"
                                                    />
                                                ) : (
                                                    <div
                                                        onClick={() => setEditingField(`custom_${key}`)}
                                                        className="text-xs cursor-pointer hover:text-indigo-400 transition-colors truncate"
                                                    >
                                                        {value || <span className="text-muted-foreground opacity-50 italic">Sin valor</span>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    </>
                )}
            </div>
        </div>
    );
}
