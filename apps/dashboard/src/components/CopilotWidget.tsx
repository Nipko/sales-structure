"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import {
    Sparkles, X, Send, Bot, User, Loader2, Trash2, Minimize2,
    ChevronRight, Lightbulb,
} from "lucide-react";

interface Message {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: Date;
}

function buildSystemPrompt(ctx: {
    userName: string;
    userRole: string;
    tenantName: string | null;
    currentPage: string;
}) {
    return `You are **Parallly Copilot**, the intelligent assistant embedded in the Parallly SaaS platform.
Your mission is to help the current user understand, configure, and operate all platform modules.

## Current Context
- **User:** ${ctx.userName} (Role: ${ctx.userRole})
- **Active Tenant:** ${ctx.tenantName || "None (Super Admin)"}
- **Current Page:** ${ctx.currentPage}

## Platform Knowledge
Parallly is a multi-tenant SaaS for conversational sales automation across WhatsApp, Instagram, Messenger, Telegram, and SMS.

### Available Modules:
1. Dashboard (/admin) - Global KPIs, leads, revenue metrics
2. Inbox (/admin/inbox) - Unified chat with AI responses, handoff, notes
3. CRM (/admin/contacts) - Contacts, pipeline, segments, scoring
4. Appointments (/admin/appointments) - Calendar, services, recurring, public booking
5. Automation (/admin/automation) - Rules engine with triggers, conditions, actions
6. AI Agent (/admin/agent) - Persona config, tools, business hours
7. Analytics (/admin/analytics) - Metrics, charts, anomaly detection, cohorts
8. Channels (/admin/channels) - WhatsApp, Instagram, Messenger, Telegram, SMS setup
9. Broadcast (/admin/broadcast) - Mass campaigns with templates
10. Knowledge Base (/admin/knowledge) - RAG documents for AI context
11. Settings (/admin/settings) - Company, security, localization, tools

## Behavior Rules:
- Respond in the same language the user writes in
- Be concise but complete. Use Markdown formatting when useful
- If the user asks about a specific page, explain step by step how to use it
- If you don't know, say so honestly and suggest where to look
- Suggest concrete actions based on the user's current page`;
}

export default function CopilotWidget() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const pathname = usePathname();
    const t = useTranslations("copilot");

    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
    useEffect(() => { if (isOpen) setTimeout(() => inputRef.current?.focus(), 300); }, [isOpen]);

    const handleSend = useCallback(async (text?: string) => {
        const content = text || input.trim();
        if (!content || isLoading) return;

        const userMsg: Message = { id: `u${Date.now()}`, role: "user", content, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setIsLoading(true);

        try {
            const result = await api.copilotChat({
                message: content,
                context: {
                    page: pathname,
                    tenantId: activeTenantId || undefined,
                    tenantName: user?.tenantName || undefined,
                    userName: `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
                    userRole: user?.role || "agent",
                },
                history: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
            });

            setMessages(prev => [...prev, {
                id: `a${Date.now()}`, role: "assistant",
                content: result.success && result.data?.reply ? result.data.reply : t("errorProcessing"),
                timestamp: new Date(),
            }]);
        } catch {
            setMessages(prev => [...prev, {
                id: `e${Date.now()}`, role: "assistant",
                content: t("errorConnection"),
                timestamp: new Date(),
            }]);
        } finally {
            setIsLoading(false);
        }
    }, [input, isLoading, pathname, activeTenantId, user, messages, t]);

    function renderContent(text: string) {
        return text
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/`(.*?)`/g, '<code style="background:rgba(108,92,231,0.15);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
            .replace(/\n/g, "<br/>");
    }

    return (
        <>
            <button onClick={() => setIsOpen(o => !o)}
                style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9998, width: 56, height: 56, borderRadius: "50%", border: "none", background: isOpen ? "var(--bg-tertiary)" : "linear-gradient(135deg, #6c5ce7, #a29bfe)", color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: isOpen ? "none" : "0 4px 20px rgba(108,92,231,0.4)", transition: "all 0.3s ease", transform: isOpen ? "scale(0.9)" : "scale(1)" }}
                title="Parallly Copilot">
                {isOpen ? <X size={22} /> : <Sparkles size={24} />}
            </button>

            <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 420, zIndex: 9997, background: "var(--bg-primary)", borderLeft: "1px solid var(--border)", boxShadow: isOpen ? "-8px 0 30px rgba(0,0,0,0.2)" : "none", transform: isOpen ? "translateX(0)" : "translateX(100%)", transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)", display: "flex", flexDirection: "column" }}>
                {/* Header */}
                <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "linear-gradient(135deg, rgba(108,92,231,0.08), rgba(162,155,254,0.05))" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #6c5ce7, #a29bfe)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Bot size={20} color="white" />
                        </div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>Parallly Copilot</div>
                            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{t("subtitle")}</div>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setMessages([])} title={t("clearChat")} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4 }}><Trash2 size={16} /></button>
                        <button onClick={() => setIsOpen(false)} title={t("close")} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4 }}><Minimize2 size={16} /></button>
                    </div>
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    {messages.length === 0 && (
                        <div style={{ textAlign: "center", marginTop: 40 }}>
                            <div style={{ width: 64, height: 64, borderRadius: 16, margin: "0 auto 16px", background: "linear-gradient(135deg, rgba(108,92,231,0.15), rgba(162,155,254,0.1))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Sparkles size={30} color="var(--accent)" />
                            </div>
                            <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px" }}>{t("greeting")}</h3>
                            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 20px", lineHeight: 1.5 }}>{t("greetingDesc")}</p>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                                    <Lightbulb size={14} /> {t("suggestions")}
                                </div>
                                {[t("suggestion1"), t("suggestion2")].map(s => (
                                    <button key={s} onClick={() => handleSend(s)} style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, textAlign: "left", border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "border-color 0.2s ease" }}>
                                        <ChevronRight size={14} color="var(--accent)" /> {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {messages.map(msg => (
                        <div key={msg.id} style={{ display: "flex", gap: 10, flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
                            <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: msg.role === "user" ? "linear-gradient(135deg, #2ecc71, #27ae60)" : "linear-gradient(135deg, #6c5ce7, #a29bfe)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2 }}>
                                {msg.role === "user" ? <User size={16} color="white" /> : <Bot size={16} color="white" />}
                            </div>
                            <div style={{ maxWidth: "80%", padding: "10px 14px", borderRadius: 12, background: msg.role === "user" ? "var(--accent)" : "var(--bg-secondary)", color: msg.role === "user" ? "white" : "var(--text-primary)", fontSize: 13, lineHeight: 1.55, borderBottomRightRadius: msg.role === "user" ? 4 : 12, borderBottomLeftRadius: msg.role === "user" ? 12 : 4 }}>
                                <div dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }} />
                                <div style={{ fontSize: 10, marginTop: 4, opacity: 0.6, textAlign: msg.role === "user" ? "right" : "left" }}>
                                    {msg.timestamp.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                </div>
                            </div>
                        </div>
                    ))}

                    {isLoading && (
                        <div style={{ display: "flex", gap: 10 }}>
                            <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, #6c5ce7, #a29bfe)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Bot size={16} color="white" />
                            </div>
                            <div style={{ padding: "10px 14px", borderRadius: 12, borderBottomLeftRadius: 4, background: "var(--bg-secondary)", display: "flex", alignItems: "center", gap: 8 }}>
                                <Loader2 size={16} color="var(--accent)" style={{ animation: "spin 1s linear infinite" }} />
                                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("thinking")}</span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                    <div style={{ display: "flex", gap: 8 }}>
                        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
                            placeholder={t("inputPlaceholder")} disabled={isLoading}
                            style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none" }} />
                        <button onClick={() => handleSend()} disabled={isLoading || !input.trim()}
                            style={{ width: 40, height: 40, borderRadius: 10, border: "none", background: input.trim() ? "var(--accent)" : "var(--border)", color: "white", cursor: input.trim() ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.2s ease" }}>
                            <Send size={18} />
                        </button>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 6, textAlign: "center" }}>
                        Parallly Copilot · {pathname.replace("/admin", "") || "Dashboard"}
                    </div>
                </div>
            </div>

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
    );
}
