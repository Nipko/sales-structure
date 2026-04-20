"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useTranslations } from "next-intl";
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

const STATUS_COLORS: Record<string, string> = {
    handoff: "#e74c3c", open: "#2ecc71", active: "#2ecc71",
    assigned: "#3498db", pending: "#e67e22", resolved: "#95a5a6",
    with_human: "#3498db", waiting_human: "#e67e22",
};
const STATUS_I18N_KEYS: Record<string, string> = {
    handoff: "statusHandoff", open: "statusOpen", active: "statusActive",
    assigned: "statusAssigned", pending: "statusPending", resolved: "statusResolved",
    with_human: "statusWithHuman", waiting_human: "statusWaitingHuman",
};

// ============================================
// CHANNEL ICON COMPONENT
// ============================================

const channelConfig: Record<string, { label: string; bg: string; color: string }> = {
    whatsapp: { label: "WhatsApp", bg: "#25D366", color: "#ffffff" },
    instagram: { label: "Instagram DM", bg: "#E1306C", color: "#ffffff" },
    messenger: { label: "Messenger", bg: "#0084FF", color: "#ffffff" },
    telegram: { label: "Telegram", bg: "#0088cc", color: "#ffffff" },
};

function ChannelIcon({ channel, size = 20 }: { channel: string; size?: number }) {
    const cfg = channelConfig[channel] || { label: channel, bg: "#6b7280", color: "#ffffff" };
    const iconSize = Math.round(size * 0.55);
    const common = "flex items-center justify-center rounded-full flex-shrink-0";

    if (channel === "whatsapp") {
        return (
            <div className={common} style={{ width: size, height: size, background: cfg.bg }}>
                <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" fill={cfg.color} />
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.96 7.96 0 01-4.106-1.138l-.294-.176-2.866.852.852-2.866-.176-.294A7.96 7.96 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z" fill={cfg.color} />
                </svg>
            </div>
        );
    }

    if (channel === "instagram") {
        return (
            <div
                className={common}
                style={{
                    width: size,
                    height: size,
                    background: "linear-gradient(135deg, #833AB4, #E1306C, #F77737)",
                }}
            >
                <Instagram size={iconSize} color={cfg.color} strokeWidth={2.2} />
            </div>
        );
    }

    if (channel === "messenger") {
        return (
            <div className={common} style={{ width: size, height: size, background: cfg.bg }}>
                <MessageSquare size={iconSize} color={cfg.color} strokeWidth={2.2} />
            </div>
        );
    }

    if (channel === "telegram") {
        return (
            <div className={common} style={{ width: size, height: size, background: cfg.bg }}>
                <Send size={iconSize} color={cfg.color} strokeWidth={2.2} />
            </div>
        );
    }

    // Default / unknown channel
    return (
        <div className={common} style={{ width: size, height: size, background: cfg.bg }}>
            <MessageSquare size={iconSize} color={cfg.color} strokeWidth={2.2} />
        </div>
    );
}

// ============================================
// HELPERS
// ============================================

/** Locale-aware date formatting */
function formatTime(dateStr: string, todayLabel = "Today", yesterdayLabel = "Yesterday"): string {
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "";
        const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const diffDays = Math.floor((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return time;
        if (diffDays === 1) return `${yesterdayLabel} ${time}`;
        if (diffDays < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
        return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
    } catch {
        return "";
    }
}

function formatDateLabel(dateStr: string, todayLabel = "Today", yesterdayLabel = "Yesterday"): string {
    try {
        const d = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (d.toDateString() === today.toDateString()) return todayLabel;
        if (d.toDateString() === yesterday.toDateString()) return yesterdayLabel;
        return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
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

/** Status dot color mapping */
const statusDotColor: Record<string, string> = {
    active: "#22c55e",
    open: "#22c55e",
    pending: "#f97316",
    waiting_human: "#f97316",
    with_human: "#3b82f6",
    assigned: "#3b82f6",
    handoff: "#ef4444",
    resolved: "#9ca3af",
};

// ============================================
// COMPONENT
// ============================================

export default function InboxPage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const t = useTranslations("inbox");
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
                        contactName: c.contact_name || c.contactName || t('unknown'),
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
                    // Sort by most recent message first so the order matches
                    // what the user expects (freshest conversation on top).
                    convs.sort((a: any, b: any) =>
                        new Date(b.lastMessageAtRaw || 0).getTime() - new Date(a.lastMessageAtRaw || 0).getTime()
                    );
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
                            senderLabel: isInbound ? t('client') : (isHumanAgent ? t('agent') : 'IA'),
                            senderName: isInbound ? selectedConv.contactName : (isHumanAgent ? t('agent') : 'IA'),
                            timestamp: (m.timestamp || m.created_at) ? formatTime(m.timestamp || m.created_at) : '',
                            rawDate: m.timestamp || m.created_at || '',
                            type: m.content_type || 'text',
                        };
                    });
                    setMessages(msgs);
                    // Update notes from conversation data if available
                    if (conv.notes) {
                        setNotes(conv.notes.map((n: any) => ({
                            id: n.id,
                            content: n.content || n.content_text || '',
                            agentName: n.created_by || n.agent_name || t('agent'),
                            createdAt: n.created_at ? new Date(n.created_at).toLocaleDateString(undefined) : '',
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
                senderLabel: isInbound ? t('client') : (isHumanAgent ? t('agent') : 'IA'),
                senderName: isInbound ? t('client') : (isHumanAgent ? t('agent') : 'IA'),
                timestamp: (message.timestamp || message.created_at) ? formatTime(message.timestamp || message.created_at) : new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
                rawDate: message.timestamp || message.created_at || new Date().toISOString(),
                type: message.content_type || 'text',
            };

            // Increment unread count if this conversation is not currently selected
            const isViewing = selectedConvIdRef.current === conversationId;

            // Update conversation list with latest message + unread badge,
            // then reorder so the conversation that just received a message
            // bubbles to the top — users expect the freshest chat on top
            // without having to reload or navigate away.
            setConversations((prev: any[]) => {
                const updated = prev.map(c => {
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
                });
                return updated.sort((a: any, b: any) =>
                    new Date(b.lastMessageAtRaw || 0).getTime() - new Date(a.lastMessageAtRaw || 0).getTime()
                );
            });

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
            .replace(/\{\{agentName\}\}/gi, user?.firstName || t('agent'));
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
                const agentName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || t('agent');
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
            senderLabel: t('agent'),
            senderName: user?.firstName || t('agent'),
            timestamp: now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
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

    // --- Channel display label ---
    const channelLabel = channelConfig[selectedConv?.channel]?.label || selectedConv?.channel || '';

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

            {/* ======== LEFT COLUMN: Conversation List (320px) ======== */}
            <div className={cn(
                "border-r border-border flex flex-col bg-card flex-shrink-0",
                "w-full md:w-[320px]",
                mobileShowChat ? "hidden md:flex" : "flex"
            )}>
                {/* Header */}
                <div className="px-4 pt-4 pb-3 border-b border-border">
                    <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-2.5">
                            <h2 className="text-lg font-semibold m-0">Inbox</h2>
                            {isLive && (
                                <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    LIVE
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Notification Bell */}
                            <div className="relative cursor-pointer">
                                <Bell size={18} className="text-muted-foreground" />
                                {totalUnread > 0 && (
                                    <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[10px] font-semibold rounded-full px-[5px] py-px min-w-[16px] text-center leading-[14px] shadow-[0_0_0_2px_hsl(var(--card))]">
                                        {totalUnread > 99 ? "99+" : totalUnread}
                                    </span>
                                )}
                            </div>
                            <DataSourceBadge isLive={isLive} />
                        </div>
                    </div>

                    {/* Filter pills */}
                    <div className="flex gap-1.5 mb-3 flex-wrap">
                        {([
                            { key: "all" as const, label: t("filterAll") },
                            { key: "mine" as const, label: t("filterMine") },
                            { key: "unassigned" as const, label: t("filterUnassigned") },
                            { key: "handoff" as const, label: "Handoff" },
                        ]).map(f => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                className={cn(
                                    "py-1 px-3 rounded-full border text-xs cursor-pointer transition-all",
                                    filter === f.key
                                        ? "font-semibold bg-indigo-600 text-white border-indigo-600"
                                        : "font-normal bg-transparent text-muted-foreground border-border hover:bg-muted hover:border-muted-foreground/30"
                                )}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder={t("searchPlaceholder")}
                            className="w-full py-2 px-3 pl-9 rounded-xl border border-border bg-muted/50 text-foreground text-[13px] outline-none focus:border-indigo-500/50 transition-colors"
                        />
                    </div>
                </div>

                {/* Conversation List */}
                <div className="inbox-scrollbar flex-1 overflow-auto">
                    {loadingConv && conversations.length === 0 && (
                        <div className="flex items-center justify-center py-12 text-muted-foreground">
                            <Loader2 size={20} className="animate-spin" />
                        </div>
                    )}
                    {filteredConversations.map(conv => {
                        const hasUnread = (conv.unreadCount || 0) > 0;
                        const isSelected = selectedConv?.id === conv.id;
                        const dotColor = statusDotColor[conv.status] || "#9ca3af";
                        return (
                            <div
                                key={conv.id}
                                className={cn(
                                    "inbox-conv-item relative cursor-pointer transition-colors duration-150",
                                    isSelected && "bg-indigo-600/[0.06] dark:bg-indigo-500/[0.08]"
                                )}
                                onClick={() => {
                                    setSelectedConv(conv);
                                    setMobileShowChat(true);
                                    setConversations(prev => prev.map(c =>
                                        c.id === conv.id ? { ...c, unreadCount: 0 } : c
                                    ));
                                }}
                            >
                                {/* Selected indicator: left border */}
                                {isSelected && (
                                    <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-indigo-600" />
                                )}
                                <div className="px-4 py-3 border-b border-border/60">
                                    <div className="flex gap-3 items-start">
                                        {/* Channel icon */}
                                        <div className="relative flex-shrink-0 mt-0.5">
                                            <ChannelIcon channel={conv.channel} size={36} />
                                            {/* Status dot */}
                                            <div
                                                className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card"
                                                style={{ background: dotColor }}
                                            />
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className={cn(
                                                        "text-sm truncate",
                                                        hasUnread ? "font-semibold text-foreground" : "font-semibold text-foreground"
                                                    )}>
                                                        {conv.contactName}
                                                    </span>
                                                    {conv.isAiHandled && <Bot size={13} className="text-indigo-500 flex-shrink-0" />}
                                                </div>
                                                {/* Time badge */}
                                                <span className={cn(
                                                    "text-[11px] flex-shrink-0",
                                                    hasUnread ? "text-indigo-500 font-semibold" : "text-muted-foreground"
                                                )}>
                                                    {conv.lastMessageAt}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between gap-2 mt-1">
                                                <p className={cn(
                                                    "text-xs whitespace-nowrap overflow-hidden text-ellipsis m-0",
                                                    hasUnread ? "text-foreground font-medium" : "text-muted-foreground"
                                                )}>
                                                    {conv.lastMessage}
                                                </p>
                                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                                    {/* Assigned agent initial */}
                                                    {conv.assignedAgentName && (
                                                        <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center text-[9px] font-semibold flex-shrink-0" title={conv.assignedAgentName}>
                                                            {conv.assignedAgentName.charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                    {/* Unread badge */}
                                                    {hasUnread && (
                                                        <span className="bg-red-500 text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-semibold flex-shrink-0">
                                                            {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {/* Tags row */}
                                            {conv.tags.length > 0 && (
                                                <div className="flex gap-1 mt-1.5 flex-wrap">
                                                    {conv.tags.slice(0, 3).map((tag: string) => (
                                                        <span key={tag} className="text-[10px] px-1.5 py-px rounded-md bg-indigo-600/10 text-indigo-500 dark:text-indigo-400">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                    {conv.tags.length > 3 && (
                                                        <span className="text-[10px] text-muted-foreground">+{conv.tags.length - 3}</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {!loadingConv && filteredConversations.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                            <MessageSquare size={32} className="opacity-20" />
                            <span className="text-sm">{t("noConversations")}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* ======== CENTER COLUMN: Chat Thread (flex-1) ======== */}
            <div className={cn(
                "flex-1 flex flex-col bg-background min-w-0",
                mobileShowChat ? "flex" : "hidden md:flex"
            )}>
                {selectedConv ? (
                    <>
                        {/* Chat Header */}
                        <div className="px-4 md:px-5 py-3 border-b border-border flex justify-between items-center bg-card gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                {/* Mobile back button */}
                                <button
                                    onClick={() => setMobileShowChat(false)}
                                    className="md:hidden p-1.5 rounded-xl border-none bg-transparent text-muted-foreground cursor-pointer hover:bg-muted flex-shrink-0"
                                >
                                    <ArrowLeft size={20} />
                                </button>
                                {/* Channel icon */}
                                <ChannelIcon channel={selectedConv.channel} size={38} />
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-[15px] truncate">{selectedConv.contactName}</span>
                                        <span
                                            className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                                            style={{
                                                background: `${(STATUS_COLORS[selectedConv.status] || '#95a5a6')}18`,
                                                color: STATUS_COLORS[selectedConv.status] || '#95a5a6',
                                            }}
                                        >
                                            {t(STATUS_I18N_KEYS[selectedConv.status] || selectedConv.status)}
                                        </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                        <span>{channelLabel}</span>
                                        {selectedConv.contactPhone && (
                                            <>
                                                <span className="opacity-40">|</span>
                                                <span>{selectedConv.contactPhone}</span>
                                            </>
                                        )}
                                        {selectedConv.contactEmail && (
                                            <>
                                                <span className="opacity-40">|</span>
                                                <span className="truncate">{selectedConv.contactEmail}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                            {/* Action buttons */}
                            <div className="flex gap-1.5 md:gap-2 flex-wrap justify-end flex-shrink-0 items-center">
                                <button
                                    onClick={() => setShowNotes(!showNotes)}
                                    className={cn(
                                        "py-1.5 px-3 rounded-xl border text-xs cursor-pointer flex gap-1.5 items-center transition-colors",
                                        showNotes
                                            ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                                            : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                                    )}
                                >
                                    <StickyNote size={14} /> Notas
                                </button>
                                {selectedConv.assignedAgentName && (
                                    <div className="py-1 px-2.5 rounded-xl text-[11px] bg-blue-500/10 text-blue-500 flex gap-1 items-center font-medium border border-blue-500/20">
                                        <UserCheck size={12} />
                                        {selectedConv.assignedAgentName}
                                    </div>
                                )}
                                <button
                                    onClick={handleResolve}
                                    className="py-1.5 px-3 rounded-xl border-none bg-emerald-500 text-white text-xs font-semibold cursor-pointer flex gap-1.5 items-center hover:bg-emerald-600 transition-colors"
                                >
                                    <CheckCircle size={14} /> Resolver
                                </button>
                                <button
                                    onClick={handleAssign}
                                    disabled={assignLoading}
                                    className={cn(
                                        "py-1.5 px-3 rounded-xl border-none text-xs font-semibold flex gap-1.5 items-center transition-all",
                                        assignLoading
                                            ? "bg-muted text-muted-foreground cursor-not-allowed opacity-70"
                                            : "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
                                    )}
                                >
                                    {assignLoading
                                        ? <><Loader2 size={14} className="animate-spin" /> Asignando...</>
                                        : <><ArrowRight size={14} /> {selectedConv.assignedAgentId === user?.id ? t('reassignToMe') : t('assignToMe')}</>
                                    }
                                </button>
                                {/* Snooze Button */}
                                <div ref={snoozeRef} className="relative">
                                    <button
                                        onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
                                        className={cn(
                                            "py-1.5 px-3 rounded-xl border text-xs cursor-pointer flex gap-1.5 items-center transition-colors",
                                            showSnoozeMenu
                                                ? "bg-indigo-600 text-white border-indigo-600"
                                                : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                                        )}
                                    >
                                        <Clock size={14} /> Snooze
                                    </button>
                                    {showSnoozeMenu && (
                                        <div className="absolute top-full right-0 mt-1.5 bg-card border border-border rounded-xl p-1 z-[100] min-w-[170px] shadow-lg">
                                            {[
                                                { key: "1h", label: "1 hora" },
                                                { key: "3h", label: "3 horas" },
                                                { key: "tomorrow", label: t("snoozeTomorrow") },
                                                { key: "monday", label: t("snoozeMonday") },
                                            ].map(opt => (
                                                <button
                                                    key={opt.key}
                                                    onClick={() => handleSnooze(opt.key)}
                                                    className="flex items-center gap-2 w-full py-2 px-3 border-none rounded-lg bg-transparent text-foreground text-[13px] cursor-pointer text-left hover:bg-muted transition-colors"
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
                                            "py-1.5 px-3 rounded-xl border text-xs cursor-pointer flex gap-1.5 items-center transition-colors",
                                            showMacrosMenu
                                                ? "bg-indigo-600 text-white border-indigo-600"
                                                : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                                        )}
                                    >
                                        <Zap size={14} /> Macros
                                    </button>
                                    {showMacrosMenu && (
                                        <div className="absolute top-full right-0 mt-1.5 bg-card border border-border rounded-xl p-1 z-[100] min-w-[220px] max-h-60 overflow-y-auto shadow-lg">
                                            {macros.length === 0 ? (
                                                <div className="py-3 px-3.5 text-[13px] text-muted-foreground">
                                                    No hay macros configurados
                                                </div>
                                            ) : macros.map((m: any) => (
                                                <button
                                                    key={m.id}
                                                    onClick={() => handleExecuteMacro(m.id)}
                                                    className="flex items-center justify-between w-full py-2 px-3 border-none rounded-lg bg-transparent text-foreground text-[13px] cursor-pointer text-left hover:bg-muted transition-colors"
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
                            className="inbox-scrollbar flex-1 overflow-auto px-4 md:px-8 py-5 flex flex-col gap-1"
                            style={{
                                background: "linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--muted) / 0.15) 100%)",
                            }}
                        >
                            {messagesWithSeparators.map((item: any) => {
                                // Date separator
                                if (item._type === "date-separator") {
                                    return (
                                        <div key={item.key} className="flex items-center justify-center py-4 gap-4">
                                            <div className="flex-1 h-px bg-border/50" />
                                            <span className="text-[11px] text-muted-foreground bg-card px-3.5 py-1 rounded-full font-medium border border-border/60 shadow-sm capitalize">
                                                {formatDateLabel(item.date)}
                                            </span>
                                            <div className="flex-1 h-px bg-border/50" />
                                        </div>
                                    );
                                }

                                const msg = item;
                                const isInbound = msg.direction === "inbound";

                                // System messages
                                if (msg.type === "system") {
                                    return (
                                        <div key={msg.id} className="inbox-msg-bubble text-center text-[11px] text-muted-foreground px-4 py-2 bg-red-500/[0.08] rounded-xl mx-auto max-w-[80%] flex gap-1.5 items-center justify-center border border-red-500/10">
                                            <AlertCircle size={14} className="text-red-500" />
                                            {msg.content}
                                        </div>
                                    );
                                }

                                return (
                                    <div key={msg.id} className={cn(
                                        "inbox-msg-bubble flex items-end gap-2 mb-1.5",
                                        isInbound ? "justify-start" : "justify-end"
                                    )}>
                                        {/* Customer avatar (left side) */}
                                        {isInbound && (
                                            <div className="w-8 h-8 rounded-full flex-shrink-0 bg-muted flex items-center justify-center mb-0.5">
                                                <User size={15} className="text-muted-foreground" />
                                            </div>
                                        )}

                                        <div className="max-w-[65%]">
                                            {/* Sender label + channel icon + timestamp */}
                                            <div className={cn(
                                                "text-[10px] text-muted-foreground mb-1 flex gap-1.5 items-center",
                                                isInbound ? "text-left justify-start pl-1" : "text-right justify-end pr-1"
                                            )}>
                                                {!isInbound && msg.senderLabel === "IA" && <Bot size={10} className="text-indigo-500" />}
                                                {!isInbound && msg.senderLabel === t('agent') && <User size={10} />}
                                                <span className="font-semibold">{msg.senderLabel || msg.senderName}</span>
                                                <ChannelIcon channel={selectedConv.channel} size={14} />
                                                <span className="opacity-50">{msg.timestamp}</span>
                                            </div>

                                            {/* Bubble */}
                                            <div className={cn(
                                                "px-4 py-3 text-sm leading-relaxed break-words shadow-sm",
                                                isInbound
                                                    ? "bg-card border border-border rounded-xl rounded-bl-md"
                                                    : msg.senderLabel === "IA"
                                                        ? "bg-indigo-600/[0.12] border border-indigo-500/20 rounded-xl rounded-br-md text-foreground"
                                                        : "bg-blue-600 border-none rounded-xl rounded-br-md text-white"
                                            )}>
                                                {msg.content}
                                            </div>
                                        </div>

                                        {/* Outbound: small icon on right */}
                                        {!isInbound && (
                                            <div className={cn(
                                                "w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center mb-0.5",
                                                msg.senderLabel === "IA" ? "bg-indigo-500/15" : "bg-blue-500/15"
                                            )}>
                                                {msg.senderLabel === "IA"
                                                    ? <Bot size={15} className="text-indigo-500" />
                                                    : <User size={15} className="text-blue-500" />
                                                }
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* AI Suggestion Banner */}
                            {selectedConv && ['with_human', 'waiting_human', 'handoff', 'assigned', 'open'].includes(selectedConv.status) && (
                                aiSuggestionLoading ? (
                                    <div className="px-4 py-3 rounded-xl bg-gradient-to-r from-purple-500/[0.08] to-indigo-500/[0.08] border border-purple-500/20 flex gap-2.5 items-center mt-3">
                                        <Loader2 size={16} className="text-purple-500 animate-spin flex-shrink-0" />
                                        <div className="text-[13px] text-muted-foreground">
                                            Generando sugerencia de IA...
                                        </div>
                                    </div>
                                ) : aiSuggestion ? (
                                    <div className="px-4 py-3 rounded-xl bg-gradient-to-r from-purple-500/[0.08] to-indigo-500/[0.08] border border-purple-500/20 flex gap-2.5 items-start mt-3">
                                        <Sparkles size={16} className="text-purple-500 mt-0.5 flex-shrink-0" />
                                        <div className="flex-1">
                                            <div className="text-[11px] font-semibold text-purple-500 mb-1 flex items-center gap-1">
                                                <span>Sugerencia IA</span>
                                            </div>
                                            <div className="text-[13px] text-muted-foreground leading-relaxed">
                                                &quot;{aiSuggestion}&quot;
                                            </div>
                                            <div className="flex gap-2 mt-2">
                                                <button
                                                    onClick={() => {
                                                        setMessageInput(aiSuggestion);
                                                        messageInputRef.current?.focus();
                                                    }}
                                                    className="py-1 px-3 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-500 text-xs cursor-pointer flex gap-1.5 items-center hover:bg-purple-500/20 transition-colors font-medium"
                                                >
                                                    <Zap size={12} /> Usar sugerencia
                                                </button>
                                                <button
                                                    onClick={() => fetchAiSuggestion()}
                                                    className="py-1 px-3 rounded-lg border border-border bg-transparent text-muted-foreground text-xs cursor-pointer flex gap-1.5 items-center hover:bg-muted transition-colors"
                                                >
                                                    <RefreshCw size={12} /> Actualizar
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : null
                            )}

                            {/* Spacing for scroll */}
                            <div className="min-h-1" />

                            {/* Scroll anchor */}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Notes Panel (conditional) */}
                        {showNotes && (
                            <div className="border-t border-border px-4 md:px-5 py-3 bg-amber-500/5 max-h-[200px] overflow-auto">
                                <div className="text-xs font-semibold text-amber-500 mb-2.5 flex gap-1.5 items-center">
                                    <StickyNote size={14} /> Notas internas
                                </div>
                                {notes.length > 0 ? notes.map(note => (
                                    <div key={note.id} className="px-3 py-2 rounded-xl bg-card border border-border/50 mb-2 text-[13px]">
                                        <div>{note.content}</div>
                                        <div className="text-[10px] text-muted-foreground mt-1.5">-- {note.agentName}, {note.createdAt}</div>
                                    </div>
                                )) : (
                                    <div className="text-xs text-muted-foreground opacity-60">{t("noNotes")}</div>
                                )}
                                <div className="flex gap-2 mt-2.5">
                                    <input
                                        value={noteInput}
                                        onChange={e => setNoteInput(e.target.value)}
                                        placeholder={t("addNotePlaceholder")}
                                        className="flex-1 py-2 px-3 rounded-xl border border-border bg-muted/50 text-foreground text-xs outline-none focus:border-amber-500/50 transition-colors"
                                    />
                                    <button
                                        onClick={handleAddNote}
                                        className="py-2 px-4 rounded-xl border-none bg-amber-500 text-white text-xs font-semibold cursor-pointer hover:bg-amber-600 transition-colors"
                                    >
                                        Guardar
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Message Input */}
                        <div className="px-4 md:px-5 py-3 border-t border-border flex gap-2.5 items-center bg-card">
                            <button className="bg-transparent border-none text-muted-foreground cursor-pointer p-1.5 hover:text-foreground rounded-lg hover:bg-muted transition-colors">
                                <Paperclip size={18} />
                            </button>
                            <div className="relative flex-1">
                                {/* Canned Responses Dropdown */}
                                {showCannedMenu && filteredCanned.length > 0 && (
                                    <div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-xl shadow-lg max-h-[220px] overflow-auto z-50">
                                        <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground border-b border-border flex gap-1.5 items-center">
                                            <Zap size={12} className="text-indigo-500" /> Respuestas rapidas
                                        </div>
                                        {filteredCanned.map((cr, idx) => (
                                            <div
                                                key={cr.id}
                                                onClick={() => selectCannedResponse(cr)}
                                                className={cn(
                                                    "px-3 py-2.5 cursor-pointer transition-colors duration-100",
                                                    idx === cannedSelectedIndex ? "bg-indigo-600/[0.08]" : "bg-transparent hover:bg-muted",
                                                    idx < filteredCanned.length - 1 && "border-b border-border/50"
                                                )}
                                                onMouseEnter={() => setCannedSelectedIndex(idx)}
                                            >
                                                <div className="flex gap-2 items-center">
                                                    <span className="text-[11px] font-semibold text-indigo-500 bg-indigo-500/10 px-1.5 py-0.5 rounded font-mono">
                                                        /{cr.shortcode}
                                                    </span>
                                                    <span className="text-xs font-medium text-foreground">
                                                        {cr.title}
                                                    </span>
                                                </div>
                                                <div className="text-[11px] text-muted-foreground mt-1 whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                                                    {cr.content}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {showCannedMenu && filteredCanned.length === 0 && cannedFilter && (
                                    <div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-xl shadow-lg px-4 py-3 z-50">
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
                                    placeholder={t("messagePlaceholder")}
                                    className="w-full py-2.5 px-4 rounded-xl border border-border bg-muted/50 text-foreground text-sm outline-none focus:border-indigo-500/50 transition-colors"
                                />
                            </div>
                            <button className="bg-transparent border-none text-muted-foreground cursor-pointer p-1.5 hover:text-foreground rounded-lg hover:bg-muted transition-colors">
                                <Smile size={18} />
                            </button>
                            <button
                                onClick={handleSend}
                                className="p-2.5 rounded-xl border-none bg-indigo-600 text-white cursor-pointer flex items-center justify-center hover:bg-indigo-700 transition-all duration-150 active:scale-95"
                            >
                                <Send size={18} />
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
                        <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center">
                            <MessageSquare size={28} className="opacity-30" />
                        </div>
                        <span className="text-sm">{t("selectConversation")}</span>
                    </div>
                )}
            </div>

            {/* ======== RIGHT COLUMN: Contact Panel (350px, collapsible) ======== */}
            <div className="inbox-scrollbar hidden lg:flex lg:flex-col w-[350px] border-l border-border overflow-auto bg-card flex-shrink-0">
                {selectedConv ? (
                    <div className="p-5">
                        {/* Contact Avatar & Name */}
                        <div className="text-center mb-6">
                            <div className="w-[72px] h-[72px] rounded-xl mx-auto mb-3 bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-2xl font-semibold text-white shadow-lg shadow-indigo-500/20">
                                {selectedConv.contactName?.charAt(0) || '?'}
                            </div>
                            <div className="font-semibold text-base">{selectedConv.contactName}</div>
                            <div className="flex items-center justify-center gap-2 mt-1.5">
                                <span
                                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                                    style={{
                                        background: `${STATUS_COLORS[selectedConv.status] || '#95a5a6'}15`,
                                        color: STATUS_COLORS[selectedConv.status] || '#95a5a6',
                                    }}
                                >
                                    <span
                                        className="w-1.5 h-1.5 rounded-full"
                                        style={{ background: STATUS_COLORS[selectedConv.status] || '#95a5a6' }}
                                    />
                                    {t(STATUS_I18N_KEYS[selectedConv.status] || selectedConv.status)}
                                </span>
                            </div>
                        </div>

                        {/* Contact Details Card */}
                        <div className="rounded-xl border border-border bg-muted/30 p-3.5 mb-4">
                            <div className="flex flex-col gap-2.5">
                                <div className="flex items-center gap-2.5 text-[13px]">
                                    <Phone size={14} className="text-muted-foreground flex-shrink-0" />
                                    <span className="truncate">{selectedConv.contactPhone || t('noPhone')}</span>
                                    {selectedConv.contactPhone && (
                                        <button
                                            onClick={() => navigator.clipboard.writeText(selectedConv.contactPhone)}
                                            className="ml-auto bg-transparent border-none text-muted-foreground hover:text-foreground cursor-pointer p-0.5 flex-shrink-0"
                                            title={t("copyPhone")}
                                        >
                                            <ExternalLink size={12} />
                                        </button>
                                    )}
                                </div>
                                {selectedConv.contactEmail && (
                                    <div className="flex items-center gap-2.5 text-[13px]">
                                        <Mail size={14} className="text-muted-foreground flex-shrink-0" />
                                        <span className="truncate">{selectedConv.contactEmail}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Channel Info Card */}
                        <div className="rounded-xl border border-border bg-muted/30 p-3.5 mb-4">
                            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Canal</div>
                            <div className="flex items-center gap-2.5">
                                <ChannelIcon channel={selectedConv.channel} size={28} />
                                <div>
                                    <div className="text-sm font-medium">{channelLabel}</div>
                                    <div className="text-[11px] text-muted-foreground">
                                        {selectedConv.contactPhone && `via ${selectedConv.contactPhone}`}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Assigned Agent */}
                        <div className="mb-4">
                            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <UserCheck size={12} /> {t('assignedAgent')}
                            </div>
                            {selectedConv.assignedAgentName ? (
                                <div className="px-3.5 py-2.5 rounded-xl bg-blue-500/[0.08] border border-blue-500/20 flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-xs font-semibold text-white flex-shrink-0 shadow-sm">
                                        {selectedConv.assignedAgentName.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="text-[13px] font-medium">{selectedConv.assignedAgentName}</div>
                                        {selectedConv.assignedAgentId === user?.id && (
                                            <div className="text-[10px] text-indigo-500 font-medium">{t("you")}</div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="px-3.5 py-2.5 rounded-xl bg-muted/50 border border-border text-xs text-muted-foreground text-center">
                                    Sin asignar
                                </div>
                            )}
                        </div>

                        {/* Tags */}
                        {selectedConv.tags?.length > 0 && (
                            <div className="mb-4">
                                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Tag size={12} /> Tags
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {selectedConv.tags.map((tag: string) => (
                                        <span key={tag} className="text-[11px] px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 font-medium">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Estimated Value */}
                        {selectedConv.estimatedValue > 0 && (
                            <div className="p-3.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/15 mb-4">
                                <div className="text-[11px] text-muted-foreground mb-1">{t("estimatedValue")}</div>
                                <div className="text-xl font-semibold text-emerald-500">
                                    ${selectedConv.estimatedValue.toLocaleString()} COP
                                </div>
                            </div>
                        )}

                        {/* Conversation Metadata */}
                        <div className="rounded-xl border border-border bg-muted/30 p-3.5 mb-4">
                            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">{t("conversation")}</div>
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2 text-[13px]">
                                    <Clock size={13} className="text-muted-foreground flex-shrink-0" />
                                    <span className="text-muted-foreground text-xs">{t('lastActivity')}:</span>
                                    <span className="text-xs ml-auto">{selectedConv.lastMessageAt || 'N/A'}</span>
                                </div>
                                <div className="flex items-center gap-2 text-[13px]">
                                    <MessageSquare size={13} className="text-muted-foreground flex-shrink-0" />
                                    <span className="text-muted-foreground text-xs">{t('priority')}:</span>
                                    <span
                                        className="text-xs ml-auto font-medium px-1.5 py-0.5 rounded"
                                        style={{
                                            color: priorityColors[selectedConv.priority] || '#95a5a6',
                                            background: `${priorityColors[selectedConv.priority] || '#95a5a6'}15`,
                                        }}
                                    >
                                        {selectedConv.priority}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* {t('additionalInfo')} */}
                        <div className="mb-4">
                            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                                <Edit2 size={12} /> {t('additionalInfo')}
                            </div>
                            <div className="flex flex-col gap-2.5">
                                {/* {t("company")} */}
                                <div className="flex items-start gap-2.5 text-[13px]">
                                    <Building2 size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] text-muted-foreground mb-0.5">{t("company")}</div>
                                        {editingField === 'empresa' ? (
                                            <input
                                                autoFocus
                                                value={contactMeta.empresa || ''}
                                                onChange={e => updateContactMeta('empresa', e.target.value)}
                                                onBlur={() => setEditingField(null)}
                                                onKeyDown={e => e.key === 'Enter' && setEditingField(null)}
                                                className="w-full py-1.5 px-2.5 rounded-lg border border-border bg-muted/50 text-foreground text-xs outline-none focus:border-indigo-500/50"
                                            />
                                        ) : (
                                            <div
                                                onClick={() => setEditingField('empresa')}
                                                className="text-xs cursor-pointer hover:text-indigo-400 transition-colors truncate"
                                            >
                                                {contactMeta.empresa || <span className="text-muted-foreground opacity-50 italic">{t("addCompany")}</span>}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* {t("city")} */}
                                <div className="flex items-start gap-2.5 text-[13px]">
                                    <MapPin size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] text-muted-foreground mb-0.5">{t("city")}</div>
                                        {editingField === 'ciudad' ? (
                                            <input
                                                autoFocus
                                                value={contactMeta.ciudad || ''}
                                                onChange={e => updateContactMeta('ciudad', e.target.value)}
                                                onBlur={() => setEditingField(null)}
                                                onKeyDown={e => e.key === 'Enter' && setEditingField(null)}
                                                className="w-full py-1.5 px-2.5 rounded-lg border border-border bg-muted/50 text-foreground text-xs outline-none focus:border-indigo-500/50"
                                            />
                                        ) : (
                                            <div
                                                onClick={() => setEditingField('ciudad')}
                                                className="text-xs cursor-pointer hover:text-indigo-400 transition-colors truncate"
                                            >
                                                {contactMeta.ciudad || <span className="text-muted-foreground opacity-50 italic">{t("addCity")}</span>}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* {t("website")} */}
                                <div className="flex items-start gap-2.5 text-[13px]">
                                    <Globe size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] text-muted-foreground mb-0.5">{t("website")}</div>
                                        {editingField === 'sitio_web' ? (
                                            <input
                                                autoFocus
                                                value={contactMeta.sitio_web || ''}
                                                onChange={e => updateContactMeta('sitio_web', e.target.value)}
                                                onBlur={() => setEditingField(null)}
                                                onKeyDown={e => e.key === 'Enter' && setEditingField(null)}
                                                placeholder="https://..."
                                                className="w-full py-1.5 px-2.5 rounded-lg border border-border bg-muted/50 text-foreground text-xs outline-none focus:border-indigo-500/50"
                                            />
                                        ) : contactMeta.sitio_web ? (
                                            <div className="flex items-center gap-1.5">
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
                                                <span className="text-muted-foreground opacity-50 italic">{t("addWebsite")}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* {t("socialNetworks")} */}
                                <div className="flex items-start gap-2.5 text-[13px]">
                                    <Hash size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] text-muted-foreground mb-1.5">{t("socialNetworks")}</div>
                                        <div className="flex gap-2">
                                            {/* Instagram */}
                                            <div className="relative group/social">
                                                <button
                                                    onClick={() => setEditingField(editingField === 'instagram' ? null : 'instagram')}
                                                    className={cn(
                                                        "w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition-colors",
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
                                                        className="absolute top-full left-0 mt-1 w-36 py-1.5 px-2.5 rounded-lg border border-border bg-card text-foreground text-xs outline-none z-10 shadow-lg"
                                                    />
                                                )}
                                            </div>
                                            {/* Facebook */}
                                            <div className="relative group/social">
                                                <button
                                                    onClick={() => setEditingField(editingField === 'facebook' ? null : 'facebook')}
                                                    className={cn(
                                                        "w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition-colors",
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
                                                        className="absolute top-full left-0 mt-1 w-36 py-1.5 px-2.5 rounded-lg border border-border bg-card text-foreground text-xs outline-none z-10 shadow-lg"
                                                    />
                                                )}
                                            </div>
                                            {/* LinkedIn */}
                                            <div className="relative group/social">
                                                <button
                                                    onClick={() => setEditingField(editingField === 'linkedin' ? null : 'linkedin')}
                                                    className={cn(
                                                        "w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition-colors",
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
                                                        className="absolute top-full left-0 mt-1 w-36 py-1.5 px-2.5 rounded-lg border border-border bg-card text-foreground text-xs outline-none z-10 shadow-lg"
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* {t("quickNotes")} */}
                                <div className="flex items-start gap-2.5 text-[13px]">
                                    <StickyNote size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] text-muted-foreground mb-0.5">{t("quickNotes")}</div>
                                        <textarea
                                            value={contactMeta.notas_rapidas || ''}
                                            onChange={e => updateContactMeta('notas_rapidas', e.target.value)}
                                            placeholder={t("writeNotePlaceholder")}
                                            rows={2}
                                            className="w-full py-1.5 px-2.5 rounded-lg border border-border bg-muted/50 text-foreground text-xs outline-none resize-none focus:border-indigo-500/50 transition-colors"
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
                                        "w-full mt-3 py-2 px-3 rounded-xl border-none text-xs font-semibold flex gap-1.5 items-center justify-center transition-all",
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
                            <div className="mb-4">
                                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Hash size={12} /> Atributos personalizados
                                </div>
                                <div className="flex flex-col gap-2.5">
                                    {customAttrDefs.map((attr: any) => {
                                        const key = attr.key || attr.name || attr.id;
                                        const label = attr.label || attr.name || key;
                                        const value = contactMeta[key] || '';
                                        return (
                                            <div key={key} className="flex items-start gap-2.5 text-[13px]">
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
                                                            className="w-full py-1.5 px-2.5 rounded-lg border border-border bg-muted/50 text-foreground text-xs outline-none focus:border-indigo-500/50"
                                                        />
                                                    ) : (
                                                        <div
                                                            onClick={() => setEditingField(`custom_${key}`)}
                                                            className="text-xs cursor-pointer hover:text-indigo-400 transition-colors truncate"
                                                        >
                                                            {value || <span className="text-muted-foreground opacity-50 italic">{t("noValue")}</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Quick Actions */}
                        <div className="mt-2 pt-4 border-t border-border">
                            <div className="flex gap-2">
                                {selectedConv.contactId && (
                                    <a
                                        href={`/admin/contacts/${selectedConv.contactId}`}
                                        className="flex-1 py-2 px-3 rounded-xl border border-border bg-transparent text-foreground text-xs font-medium cursor-pointer flex gap-1.5 items-center justify-center hover:bg-muted transition-colors no-underline"
                                    >
                                        <ExternalLink size={12} /> Ver en CRM
                                    </a>
                                )}
                                {selectedConv.contactPhone && (
                                    <button
                                        onClick={() => navigator.clipboard.writeText(selectedConv.contactPhone)}
                                        className="flex-1 py-2 px-3 rounded-xl border border-border bg-transparent text-foreground text-xs font-medium cursor-pointer flex gap-1.5 items-center justify-center hover:bg-muted transition-colors"
                                    >
                                        <Phone size={12} /> Copiar tel.
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                        <span className="opacity-50">{t("selectConversation")}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
