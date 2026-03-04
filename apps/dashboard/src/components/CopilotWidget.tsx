"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import {
    Sparkles, X, Send, Bot, User, Loader2, Trash2, Minimize2,
    ChevronRight, Lightbulb,
} from "lucide-react";

// ============================================
// TYPES
// ============================================
interface Message {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: Date;
}

// ============================================
// SYSTEM PROMPT — The "brain" of the copilot
// ============================================
function buildSystemPrompt(ctx: {
    userName: string;
    userRole: string;
    tenantName: string | null;
    currentPage: string;
}) {
    return `Eres **Parallext Copilot**, el asistente inteligente integrado en la plataforma Parallext Engine.
Tu misión es ayudar al usuario actual a entender, configurar y operar todos los módulos de la plataforma.

## Contexto actual
- **Usuario:** ${ctx.userName} (Rol: ${ctx.userRole})
- **Tenant activo:** ${ctx.tenantName || "Ninguno (Super Admin global)"}
- **Página actual:** ${ctx.currentPage}

## Conocimiento de la plataforma Parallext Engine
Parallext Engine es una plataforma SaaS multi-tenant para automatización de ventas conversacionales vía WhatsApp (y otros canales).

### Módulos disponibles:
1. **Dashboard** (/admin) — Métricas globales de revenue, leads, CSAT y actividad.
2. **Tenants** (/admin/tenants) — Gestión de organizaciones/clientes (multi-tenant). Cada tenant tiene su propio schema en PostgreSQL.
3. **Contactos** (/admin/contacts) — Base de contactos con nombre, teléfono, email, canal y tags.
4. **Pipeline** (/admin/pipeline) — Tablero Kanban de ventas. Etapas: Nuevos → Calificados → Propuesta → Negociación → Ganado.
5. **Inbox** (/admin/inbox) — Centro de mensajería con chat view, notas internas y resolución de conversaciones.
6. **Automatización** (/admin/automation) — Reglas de automatización (triggers, condiciones, acciones). Tipos: autoresponse, assignment, follow_up, escalation.
7. **Broadcast** (/admin/broadcast) — Campañas masivas de WhatsApp, templates con {{name}} personalización, scheduling.
8. **Conversaciones** (/admin/conversations) — Vista global de todas las conversaciones con filtros de estado/sentimiento y tags.
9. **AI / LLM Router** (/admin/ai) — Configuración de modelos de IA (GPT-4o, Claude, embeddings), reglas de enrutamiento por intent.
10. **Knowledge Base** (/admin/knowledge) — Documentos RAG (PDF, Markdown, Excel, URLs) que alimentan al LLM con información de la empresa.
11. **Analytics** (/admin/agent-analytics) — Métricas de rendimiento de agentes, tiempos de respuesta, CSAT.
12. **Usuarios** (/admin/users) — Gestión de usuarios con roles: super_admin, tenant_admin, agent.
13. **Configuración** (/admin/settings) — API Keys de LLM providers, configuración general de la cuenta.

### Arquitectura técnica:
- **Frontend:** Next.js 16 + React
- **Backend/API:** NestJS + Prisma ORM + PostgreSQL (multi-schema por tenant)
- **Hosting:** VPS con Docker Compose, Cloudflare Tunnel, Watchtower para auto-deploy
- **Auth:** JWT + Refresh Tokens
- **AI:** OpenAI (GPT-4o/3.5), Anthropic (Claude), embeddings con text-embedding-3-small, pgvector para RAG

### Roles de usuario:
- **super_admin** — VE todo (todos los tenants), puede gestionar usuarios y configuración global.
- **tenant_admin** — Solo ve datos de su tenant. Puede gestionar agentes y configuración del tenant.
- **agent** — Solo ve Inbox y contactos asignados de su tenant.

## Reglas de comportamiento:
- Responde SIEMPRE en español (Colombia) ya que los usuarios son hispanohablantes.
- Sé conciso pero completo. Usa listas y formato Markdown cuando sea útil.
- Si el usuario pregunta sobre una página específica, explica exactamente cómo usarla paso a paso.
- Si no conoces la respuesta exacta, di honestamente que no lo sabes pero sugiere dónde buscarla.
- Usa máximo 2-3 emojis por respuesta, no exageres.
- Puedes sugerir acciones concretas basadas en la página actual del usuario.`;
}

// ============================================
// CONTEXTUAL SUGGESTIONS
// ============================================
const pageSuggestions: Record<string, string[]> = {
    "/admin": ["¿Qué significan las métricas del Dashboard?", "¿Cómo aumento mi tasa de conversión?"],
    "/admin/tenants": ["¿Cómo creo un nuevo tenant?", "¿Qué es un tenant?"],
    "/admin/contacts": ["¿Cómo importo contactos?", "¿Puedo segmentar por tags?"],
    "/admin/pipeline": ["¿Cómo muevo un deal entre etapas?", "¿Cómo creo un nuevo deal?"],
    "/admin/inbox": ["¿Cómo respondo a un cliente?", "¿Cómo agrego una nota interna?"],
    "/admin/automation": ["¿Cómo creo una regla de auto-respuesta?", "¿Qué triggers están disponibles?"],
    "/admin/broadcast": ["¿Cómo creo una campaña?", "¿Cómo uso variables {{name}}?"],
    "/admin/conversations": ["¿Cómo filtro por sentimiento?", "¿Qué significan los tags?"],
    "/admin/ai": ["¿Cómo configuro el modelo de IA?", "¿Cuánto cuesta GPT-4o por conversación?"],
    "/admin/knowledge": ["¿Cómo subo un documento?", "¿Qué es RAG y cómo funciona?"],
    "/admin/agent-analytics": ["¿Cómo mejoro el CSAT?", "¿Qué métricas de agentes rastreo?"],
    "/admin/users": ["¿Cómo creo un nuevo usuario?", "¿Qué roles existen?"],
    "/admin/settings": ["¿Cómo configuro las API Keys?", "¿Dónde pongo mi clave de OpenAI?"],
};

// ============================================
// COPILOT WIDGET COMPONENT
// ============================================
export default function CopilotWidget() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const pathname = usePathname();

    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const suggestions = pageSuggestions[pathname] || pageSuggestions["/admin"] || [];

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Focus input when opening
    useEffect(() => {
        if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
    }, [isOpen]);

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

            const assistantMsg: Message = {
                id: `a${Date.now()}`,
                role: "assistant",
                content: result.success && result.data?.reply
                    ? result.data.reply
                    : "Lo siento, no pude procesar tu solicitud. Intenta de nuevo en un momento. 🤔",
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, assistantMsg]);
        } catch {
            setMessages(prev => [...prev, {
                id: `e${Date.now()}`, role: "assistant",
                content: "⚠️ Error de conexión con el servidor. Verifica tu conexión a internet e inténtalo de nuevo.",
                timestamp: new Date(),
            }]);
        } finally {
            setIsLoading(false);
        }
    }, [input, isLoading, pathname, activeTenantId, user, messages]);

    function handleClear() {
        setMessages([]);
    }

    // Simple markdown-ish rendering
    function renderContent(text: string) {
        return text
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/`(.*?)`/g, '<code style="background:rgba(108,92,231,0.15);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
            .replace(/\n/g, "<br/>");
    }

    return (
        <>
            {/* FAB Button */}
            <button
                onClick={() => setIsOpen(o => !o)}
                style={{
                    position: "fixed", bottom: 24, right: 24, zIndex: 9998,
                    width: 56, height: 56, borderRadius: "50%", border: "none",
                    background: isOpen ? "var(--bg-tertiary)" : "linear-gradient(135deg, #6c5ce7, #a29bfe)",
                    color: "white", cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    boxShadow: isOpen ? "none" : "0 4px 20px rgba(108,92,231,0.4)",
                    transition: "all 0.3s ease",
                    transform: isOpen ? "scale(0.9)" : "scale(1)",
                }}
                title="Parallext Copilot"
            >
                {isOpen ? <X size={22} /> : <Sparkles size={24} />}
            </button>

            {/* Drawer Panel */}
            <div style={{
                position: "fixed", top: 0, right: 0, bottom: 0, width: 420, zIndex: 9997,
                background: "var(--bg-primary)", borderLeft: "1px solid var(--border)",
                boxShadow: isOpen ? "-8px 0 30px rgba(0,0,0,0.2)" : "none",
                transform: isOpen ? "translateX(0)" : "translateX(100%)",
                transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                display: "flex", flexDirection: "column",
            }}>
                {/* Header */}
                <div style={{
                    padding: "16px 20px", borderBottom: "1px solid var(--border)",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: "linear-gradient(135deg, rgba(108,92,231,0.08), rgba(162,155,254,0.05))",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: "linear-gradient(135deg, #6c5ce7, #a29bfe)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                            <Bot size={20} color="white" />
                        </div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>Parallext Copilot</div>
                            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                                Tu asistente de la plataforma ✨
                            </div>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={handleClear} title="Limpiar chat" style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4 }}>
                            <Trash2 size={16} />
                        </button>
                        <button onClick={() => setIsOpen(false)} title="Cerrar" style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4 }}>
                            <Minimize2 size={16} />
                        </button>
                    </div>
                </div>

                {/* Messages Area */}
                <div style={{
                    flex: 1, overflowY: "auto", padding: 16,
                    display: "flex", flexDirection: "column", gap: 12,
                }}>
                    {messages.length === 0 && (
                        <div style={{ textAlign: "center", marginTop: 40 }}>
                            <div style={{
                                width: 64, height: 64, borderRadius: 16, margin: "0 auto 16px",
                                background: "linear-gradient(135deg, rgba(108,92,231,0.15), rgba(162,155,254,0.1))",
                                display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                                <Sparkles size={30} color="var(--accent)" />
                            </div>
                            <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px" }}>¡Hola! 👋</h3>
                            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 20px", lineHeight: 1.5 }}>
                                Soy tu asistente de Parallext. Pregúntame cualquier cosa sobre la plataforma.
                            </p>
                            {/* Contextual suggestions */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                                    <Lightbulb size={14} /> Sugerencias para esta página:
                                </div>
                                {suggestions.map(s => (
                                    <button key={s} onClick={() => handleSend(s)} style={{
                                        padding: "10px 14px", borderRadius: 10, fontSize: 13, textAlign: "left",
                                        border: "1px solid var(--border)", background: "var(--bg-secondary)",
                                        color: "var(--text-primary)", cursor: "pointer", display: "flex",
                                        alignItems: "center", gap: 8, transition: "border-color 0.2s ease",
                                    }}>
                                        <ChevronRight size={14} color="var(--accent)" /> {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {messages.map(msg => (
                        <div key={msg.id} style={{
                            display: "flex", gap: 10,
                            flexDirection: msg.role === "user" ? "row-reverse" : "row",
                        }}>
                            <div style={{
                                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                background: msg.role === "user"
                                    ? "linear-gradient(135deg, #2ecc71, #27ae60)"
                                    : "linear-gradient(135deg, #6c5ce7, #a29bfe)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                marginTop: 2,
                            }}>
                                {msg.role === "user" ? <User size={16} color="white" /> : <Bot size={16} color="white" />}
                            </div>
                            <div style={{
                                maxWidth: "80%", padding: "10px 14px", borderRadius: 12,
                                background: msg.role === "user" ? "var(--accent)" : "var(--bg-secondary)",
                                color: msg.role === "user" ? "white" : "var(--text-primary)",
                                fontSize: 13, lineHeight: 1.55,
                                borderBottomRightRadius: msg.role === "user" ? 4 : 12,
                                borderBottomLeftRadius: msg.role === "user" ? 12 : 4,
                            }}>
                                <div dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }} />
                                <div style={{
                                    fontSize: 10, marginTop: 4, opacity: 0.6,
                                    textAlign: msg.role === "user" ? "right" : "left",
                                }}>
                                    {msg.timestamp.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                                </div>
                            </div>
                        </div>
                    ))}

                    {isLoading && (
                        <div style={{ display: "flex", gap: 10 }}>
                            <div style={{
                                width: 30, height: 30, borderRadius: 8,
                                background: "linear-gradient(135deg, #6c5ce7, #a29bfe)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                                <Bot size={16} color="white" />
                            </div>
                            <div style={{
                                padding: "10px 14px", borderRadius: 12, borderBottomLeftRadius: 4,
                                background: "var(--bg-secondary)", display: "flex", alignItems: "center", gap: 8,
                            }}>
                                <Loader2 size={16} color="var(--accent)" style={{ animation: "spin 1s linear infinite" }} />
                                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Pensando...</span>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div style={{
                    padding: "12px 16px", borderTop: "1px solid var(--border)",
                    background: "var(--bg-secondary)",
                }}>
                    <div style={{ display: "flex", gap: 8 }}>
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
                            placeholder="Pregúntame cualquier cosa..."
                            disabled={isLoading}
                            style={{
                                flex: 1, padding: "10px 14px", borderRadius: 10,
                                border: "1px solid var(--border)", background: "var(--bg-primary)",
                                color: "var(--text-primary)", fontSize: 14, outline: "none",
                            }}
                        />
                        <button
                            onClick={() => handleSend()}
                            disabled={isLoading || !input.trim()}
                            style={{
                                width: 40, height: 40, borderRadius: 10, border: "none",
                                background: input.trim() ? "var(--accent)" : "var(--border)",
                                color: "white", cursor: input.trim() ? "pointer" : "not-allowed",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                transition: "background 0.2s ease",
                            }}
                        >
                            <Send size={18} />
                        </button>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 6, textAlign: "center" }}>
                        Parallext Copilot · Powered by OpenAI · Contexto: {pathname.replace("/admin", "") || "Dashboard"}
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
        </>
    );
}
