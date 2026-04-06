"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    Bot, User, MessageSquare, Brain, Clock, Cpu, CheckCircle,
    ChevronLeft, ChevronRight, Plus, X, Save, Sparkles,
    Shield, AlertTriangle, Smile, Globe, Calendar, Thermometer,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────

interface PersonaConfig {
    persona: {
        name: string;
        role: string;
        personality: { tone: string; formality: string; emojiUsage: string; humor: string };
        greeting: string;
        fallbackMessage: string;
    };
    behavior: {
        rules: string[];
        forbiddenTopics: string[];
        handoffTriggers: string[];
        requiredFields: Record<string, any>;
    };
    hours: {
        timezone: string;
        schedule: Record<string, { start: string; end: string } | null>;
        afterHoursMessage: string;
    };
    llm: {
        temperature: number;
        maxTokens: number;
        routing: any;
        memory: { shortTerm: number; longTerm: boolean; summaryAfter: number };
    };
    rag: {
        enabled: boolean;
        chunkSize: number;
        chunkOverlap: number;
        topK: number;
        similarityThreshold: number;
    };
    industry: string;
    language: string;
    name: string;
    slug: string;
    id: string;
    isActive: boolean;
}

// ── Default config ─────────────────────────────────────────────

const defaultConfig: PersonaConfig = {
    persona: {
        name: "",
        role: "",
        personality: { tone: "amigable", formality: "casual-professional", emojiUsage: "minimal", humor: "" },
        greeting: "",
        fallbackMessage: "",
    },
    behavior: {
        rules: [],
        forbiddenTopics: [],
        handoffTriggers: [],
        requiredFields: {},
    },
    hours: {
        timezone: "America/Bogota",
        schedule: {
            lun: { start: "08:00", end: "18:00" },
            mar: { start: "08:00", end: "18:00" },
            mie: { start: "08:00", end: "18:00" },
            jue: { start: "08:00", end: "18:00" },
            vie: { start: "08:00", end: "18:00" },
            sab: { start: "08:00", end: "14:00" },
            dom: null,
        },
        afterHoursMessage: "",
    },
    llm: {
        temperature: 0.7,
        maxTokens: 800,
        routing: {
            tiers: {
                tier_1_premium: { models: ["gpt-4o"], costLevel: "high" },
                tier_2_standard: { models: ["gpt-4o-mini"], costLevel: "medium" },
                tier_3_efficient: { models: ["gpt-4o-mini"], costLevel: "low" },
                tier_4_budget: { models: ["gpt-4o-mini"], costLevel: "very_low" },
            },
            factors: {},
            fallback: "auto_upgrade",
        },
        memory: { shortTerm: 20, longTerm: false, summaryAfter: 30 },
    },
    rag: { enabled: false, chunkSize: 512, chunkOverlap: 50, topK: 5, similarityThreshold: 0.75 },
    industry: "general",
    language: "es-CO",
    name: "",
    slug: "",
    id: "",
    isActive: true,
};

// ── Steps ──────────────────────────────────────────────────────

const STEPS = [
    { label: "Identidad", icon: User },
    { label: "Personalidad", icon: Smile },
    { label: "Comportamiento", icon: Shield },
    { label: "Horario", icon: Calendar },
    { label: "Modelo IA", icon: Cpu },
    { label: "Resumen", icon: CheckCircle },
];

const DAY_LABELS: Record<string, string> = {
    lun: "Lunes",
    mar: "Martes",
    mie: "Miércoles",
    jue: "Jueves",
    vie: "Viernes",
    sab: "Sábado",
    dom: "Domingo",
};

// ── Component ──────────────────────────────────────────────────

export default function AgentConfigPage() {
    const { activeTenantId } = useTenant();
    const [mode, setMode] = useState<"wizard" | "prompt">("wizard");
    const [step, setStep] = useState(0);
    const [config, setConfig] = useState<PersonaConfig>(structuredClone(defaultConfig));
    const [customPrompt, setCustomPrompt] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    // Load existing config
    useEffect(() => {
        if (!activeTenantId) return;
        setLoading(true);
        api.getPersonaConfig(activeTenantId)
            .then((res: any) => {
                if (res?.success && res.data) {
                    const data = res.data;
                    setConfig(deepMerge(structuredClone(defaultConfig), data));
                    // If a custom prompt was saved, load it and switch to prompt mode
                    if (data._customPrompt) {
                        setCustomPrompt(data._customPrompt);
                        setMode("prompt");
                    }
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [activeTenantId]);

    // Toast auto-dismiss
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 2500);
        return () => clearTimeout(t);
    }, [toast]);

    // ── Helpers ────────────────────────────────────────────────

    function deepMerge(target: any, source: any): any {
        const output = { ...target };
        for (const key of Object.keys(source)) {
            if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) && target[key]) {
                output[key] = deepMerge(target[key], source[key]);
            } else if (source[key] !== undefined) {
                output[key] = source[key];
            }
        }
        return output;
    }

    function updatePersona(field: string, value: any) {
        setConfig(prev => ({ ...prev, persona: { ...prev.persona, [field]: value } }));
    }

    function updatePersonality(field: string, value: any) {
        setConfig(prev => ({
            ...prev,
            persona: { ...prev.persona, personality: { ...prev.persona.personality, [field]: value } },
        }));
    }

    function updateBehaviorList(field: "rules" | "forbiddenTopics" | "handoffTriggers", index: number, value: string) {
        setConfig(prev => {
            const list = [...prev.behavior[field]];
            list[index] = value;
            return { ...prev, behavior: { ...prev.behavior, [field]: list } };
        });
    }

    function addBehaviorItem(field: "rules" | "forbiddenTopics" | "handoffTriggers") {
        setConfig(prev => ({
            ...prev,
            behavior: { ...prev.behavior, [field]: [...prev.behavior[field], ""] },
        }));
    }

    function removeBehaviorItem(field: "rules" | "forbiddenTopics" | "handoffTriggers", index: number) {
        setConfig(prev => ({
            ...prev,
            behavior: { ...prev.behavior, [field]: prev.behavior[field].filter((_, i) => i !== index) },
        }));
    }

    function updateScheduleDay(day: string, active: boolean) {
        setConfig(prev => ({
            ...prev,
            hours: {
                ...prev.hours,
                schedule: {
                    ...prev.hours.schedule,
                    [day]: active ? { start: "08:00", end: "18:00" } : null,
                },
            },
        }));
    }

    function updateScheduleTime(day: string, field: "start" | "end", value: string) {
        setConfig(prev => ({
            ...prev,
            hours: {
                ...prev.hours,
                schedule: {
                    ...prev.hours.schedule,
                    [day]: { ...(prev.hours.schedule[day] as any), [field]: value },
                },
            },
        }));
    }

    async function handleSave() {
        if (!activeTenantId) return;
        setSaving(true);
        try {
            let payload: any;
            if (mode === "prompt") {
                // Save the custom prompt alongside minimal config
                payload = {
                    ...config,
                    _customPrompt: customPrompt,
                    _mode: "prompt",
                };
            } else {
                payload = { ...config, _customPrompt: undefined, _mode: "wizard" };
            }
            const res = await api.savePersonaConfig(activeTenantId, payload);
            if (res?.success) {
                setToast("Configuración guardada exitosamente");
            } else {
                setToast("Error al guardar la configuración");
            }
        } catch {
            setToast("Error al guardar la configuración");
        } finally {
            setSaving(false);
        }
    }

    // ── Shared styles ──────────────────────────────────────────

    const inputStyle: React.CSSProperties = {
        width: "100%",
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        fontSize: 14,
        outline: "none",
        boxSizing: "border-box",
    };

    const selectStyle: React.CSSProperties = {
        ...inputStyle,
        appearance: "none" as const,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239898b0' viewBox='0 0 24 24'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
        paddingRight: 32,
    };

    const labelStyle: React.CSSProperties = {
        display: "block",
        fontSize: 13,
        fontWeight: 600,
        color: "var(--text-secondary)",
        marginBottom: 6,
    };

    const cardStyle: React.CSSProperties = {
        padding: 24,
        borderRadius: 14,
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
    };

    // ── Step renderers ─────────────────────────────────────────

    function renderStep0() {
        return (
            <div style={cardStyle}>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
                    <User size={20} color="var(--accent)" /> Identidad del Agente
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    <div>
                        <label style={labelStyle}>Nombre del agente</label>
                        <input
                            style={inputStyle}
                            placeholder="Ej: Sofia Henao"
                            value={config.persona.name}
                            onChange={e => updatePersona("name", e.target.value)}
                        />
                    </div>
                    <div>
                        <label style={labelStyle}>Rol</label>
                        <input
                            style={inputStyle}
                            placeholder="Ej: Asesora de ventas"
                            value={config.persona.role}
                            onChange={e => updatePersona("role", e.target.value)}
                        />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                        <label style={labelStyle}>Mensaje de bienvenida</label>
                        <textarea
                            style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
                            placeholder="Escribe el saludo que enviará el agente al iniciar una conversación..."
                            value={config.persona.greeting}
                            onChange={e => updatePersona("greeting", e.target.value)}
                        />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                        <label style={labelStyle}>Mensaje cuando no puede responder</label>
                        <textarea
                            style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
                            placeholder="Mensaje de fallback cuando el agente no sabe qué responder..."
                            value={config.persona.fallbackMessage}
                            onChange={e => updatePersona("fallbackMessage", e.target.value)}
                        />
                    </div>
                    <div>
                        <label style={labelStyle}>Idioma</label>
                        <select
                            style={selectStyle}
                            value={config.language}
                            onChange={e => setConfig(prev => ({ ...prev, language: e.target.value }))}
                        >
                            <option value="es-CO">Español (Colombia)</option>
                            <option value="es-MX">Español (México)</option>
                            <option value="en-US">English (US)</option>
                            <option value="pt-BR">Português (Brasil)</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Industria</label>
                        <select
                            style={selectStyle}
                            value={config.industry}
                            onChange={e => setConfig(prev => ({ ...prev, industry: e.target.value }))}
                        >
                            <option value="general">General</option>
                            <option value="tourism">Turismo</option>
                            <option value="education">Educación</option>
                            <option value="ecommerce">E-commerce</option>
                            <option value="health">Salud</option>
                            <option value="services">Servicios</option>
                        </select>
                    </div>
                </div>
            </div>
        );
    }

    function renderStep1() {
        return (
            <div style={cardStyle}>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
                    <Smile size={20} color="var(--accent)" /> Personalidad
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    <div>
                        <label style={labelStyle}>Tono</label>
                        <select
                            style={selectStyle}
                            value={config.persona.personality.tone}
                            onChange={e => updatePersonality("tone", e.target.value)}
                        >
                            <option value="amigable">Amigable</option>
                            <option value="profesional">Profesional</option>
                            <option value="formal">Formal</option>
                            <option value="casual">Casual</option>
                            <option value="empático">Empático</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Formalidad</label>
                        <select
                            style={selectStyle}
                            value={config.persona.personality.formality}
                            onChange={e => updatePersonality("formality", e.target.value)}
                        >
                            <option value="formal">Formal</option>
                            <option value="casual-professional">Casual-Profesional</option>
                            <option value="casual">Casual</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Uso de emojis</label>
                        <select
                            style={selectStyle}
                            value={config.persona.personality.emojiUsage}
                            onChange={e => updatePersonality("emojiUsage", e.target.value)}
                        >
                            <option value="none">Ninguno</option>
                            <option value="minimal">Mínimo</option>
                            <option value="moderate">Moderado</option>
                            <option value="heavy">Abundante</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Humor</label>
                        <input
                            style={inputStyle}
                            placeholder="Ej: ligero, temática de aventura"
                            value={config.persona.personality.humor}
                            onChange={e => updatePersonality("humor", e.target.value)}
                        />
                    </div>
                </div>
            </div>
        );
    }

    function renderStep2() {
        const sections: { key: "rules" | "forbiddenTopics" | "handoffTriggers"; title: string; placeholder: string; icon: any }[] = [
            { key: "rules", title: "Reglas estrictas", placeholder: "Ej: Siempre confirmar disponibilidad antes de cotizar", icon: Shield },
            { key: "forbiddenTopics", title: "Temas prohibidos", placeholder: "Ej: Competencia, precios de terceros", icon: AlertTriangle },
            { key: "handoffTriggers", title: "Triggers de handoff", placeholder: "Ej: Cliente solicita hablar con un humano", icon: MessageSquare },
        ];

        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {sections.map(section => (
                    <div key={section.key} style={cardStyle}>
                        <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                            <section.icon size={18} color="var(--accent)" /> {section.title}
                        </h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {config.behavior[section.key].map((item, idx) => (
                                <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <input
                                        style={{ ...inputStyle, flex: 1 }}
                                        placeholder={section.placeholder}
                                        value={item}
                                        onChange={e => updateBehaviorList(section.key, idx, e.target.value)}
                                    />
                                    <button
                                        onClick={() => removeBehaviorItem(section.key, idx)}
                                        style={{
                                            width: 36, height: 36, borderRadius: 8, border: "1px solid var(--border)",
                                            background: "var(--bg-primary)", color: "var(--danger)", cursor: "pointer",
                                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                                        }}
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            ))}
                            <button
                                onClick={() => addBehaviorItem(section.key)}
                                style={{
                                    padding: "8px 16px", borderRadius: 8, border: "1px dashed var(--border)",
                                    background: "transparent", color: "var(--accent)", cursor: "pointer",
                                    fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
                                    alignSelf: "flex-start",
                                }}
                            >
                                <Plus size={14} /> Agregar
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    function renderStep3() {
        const timezones = [
            { value: "America/Bogota", label: "Bogotá (GMT-5)" },
            { value: "America/Mexico_City", label: "Ciudad de México (GMT-6)" },
            { value: "America/Lima", label: "Lima (GMT-5)" },
            { value: "America/Santiago", label: "Santiago (GMT-4)" },
            { value: "America/Buenos_Aires", label: "Buenos Aires (GMT-3)" },
        ];

        return (
            <div style={cardStyle}>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
                    <Calendar size={20} color="var(--accent)" /> Horario Comercial
                </h3>
                <div style={{ marginBottom: 20 }}>
                    <label style={labelStyle}>Zona horaria</label>
                    <select
                        style={{ ...selectStyle, maxWidth: 320 }}
                        value={config.hours.timezone}
                        onChange={e => setConfig(prev => ({ ...prev, hours: { ...prev.hours, timezone: e.target.value } }))}
                    >
                        {timezones.map(tz => (
                            <option key={tz.value} value={tz.value}>{tz.label}</option>
                        ))}
                    </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                    {Object.entries(DAY_LABELS).map(([key, label]) => {
                        const daySchedule = config.hours.schedule[key];
                        const isActive = daySchedule !== null;
                        return (
                            <div key={key} style={{
                                display: "flex", alignItems: "center", gap: 14, padding: "10px 14px",
                                borderRadius: 10, background: "var(--bg-primary)", border: "1px solid var(--border)",
                            }}>
                                <button
                                    onClick={() => updateScheduleDay(key, !isActive)}
                                    style={{
                                        width: 42, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                                        background: isActive ? "var(--success)" : "var(--border)",
                                        position: "relative", transition: "background 0.2s",
                                    }}
                                >
                                    <div style={{
                                        width: 18, height: 18, borderRadius: 9, background: "#fff",
                                        position: "absolute", top: 3,
                                        left: isActive ? 21 : 3, transition: "left 0.2s",
                                    }} />
                                </button>
                                <span style={{ width: 90, fontSize: 14, fontWeight: 600, color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}>
                                    {label}
                                </span>
                                {isActive ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <input
                                            type="time"
                                            style={{ ...inputStyle, width: 130 }}
                                            value={(daySchedule as any).start}
                                            onChange={e => updateScheduleTime(key, "start", e.target.value)}
                                        />
                                        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>a</span>
                                        <input
                                            type="time"
                                            style={{ ...inputStyle, width: 130 }}
                                            value={(daySchedule as any).end}
                                            onChange={e => updateScheduleTime(key, "end", e.target.value)}
                                        />
                                    </div>
                                ) : (
                                    <span style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>Cerrado</span>
                                )}
                            </div>
                        );
                    })}
                </div>
                <div>
                    <label style={labelStyle}>Mensaje fuera de horario</label>
                    <textarea
                        style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
                        placeholder="Mensaje que se envía fuera del horario comercial..."
                        value={config.hours.afterHoursMessage}
                        onChange={e => setConfig(prev => ({ ...prev, hours: { ...prev.hours, afterHoursMessage: e.target.value } }))}
                    />
                </div>
            </div>
        );
    }

    function renderStep4() {
        return (
            <div style={cardStyle}>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
                    <Cpu size={20} color="var(--accent)" /> Modelo de IA
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                    <div>
                        <label style={labelStyle}>Temperatura: {config.llm.temperature}</label>
                        <input
                            type="range"
                            min={0} max={1} step={0.1}
                            value={config.llm.temperature}
                            onChange={e => setConfig(prev => ({ ...prev, llm: { ...prev.llm, temperature: parseFloat(e.target.value) } }))}
                            style={{ width: "100%", accentColor: "var(--accent)" }}
                        />
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                            <span>Preciso (0)</span>
                            <span>Creativo (1)</span>
                        </div>
                    </div>
                    <div>
                        <label style={labelStyle}>Max tokens</label>
                        <input
                            type="number"
                            style={inputStyle}
                            min={100} max={4000}
                            value={config.llm.maxTokens}
                            onChange={e => setConfig(prev => ({ ...prev, llm: { ...prev.llm, maxTokens: parseInt(e.target.value) || 800 } }))}
                        />
                    </div>
                </div>
                <div style={{
                    marginTop: 20, padding: 16, borderRadius: 10,
                    background: "var(--accent-glow)", border: "1px solid var(--accent)",
                }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <Sparkles size={18} color="var(--accent)" style={{ marginTop: 2, flexShrink: 0 }} />
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                            <strong style={{ color: "var(--text-primary)" }}>Temperatura</strong> controla la creatividad de las respuestas.
                            Valores bajos (0-0.3) producen respuestas consistentes y predecibles.
                            Valores altos (0.7-1) generan respuestas más variadas y creativas.<br />
                            <strong style={{ color: "var(--text-primary)" }}>Max tokens</strong> limita la longitud máxima de cada respuesta.
                            800 tokens equivalen aproximadamente a 2-3 párrafos.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    function renderStep5() {
        const summarySection = (title: string, icon: any, items: { label: string; value: string }[]) => (
            <div style={{ ...cardStyle, marginBottom: 16 }}>
                <h4 style={{ fontSize: 15, fontWeight: 700, marginTop: 0, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                    {icon} {title}
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {items.map((item, i) => (
                        <div key={i}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                                {item.label}
                            </div>
                            <div style={{ fontSize: 14, color: "var(--text-primary)", marginTop: 2 }}>
                                {item.value || "—"}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );

        const activeDays = Object.entries(config.hours.schedule)
            .filter(([, v]) => v !== null)
            .map(([k, v]) => `${DAY_LABELS[k]} ${(v as any).start}-${(v as any).end}`)
            .join(", ");

        return (
            <div>
                {summarySection("Identidad", <User size={16} color="var(--accent)" />, [
                    { label: "Nombre", value: config.persona.name },
                    { label: "Rol", value: config.persona.role },
                    { label: "Idioma", value: config.language },
                    { label: "Industria", value: config.industry },
                    { label: "Saludo", value: config.persona.greeting },
                    { label: "Fallback", value: config.persona.fallbackMessage },
                ])}
                {summarySection("Personalidad", <Smile size={16} color="var(--accent)" />, [
                    { label: "Tono", value: config.persona.personality.tone },
                    { label: "Formalidad", value: config.persona.personality.formality },
                    { label: "Emojis", value: config.persona.personality.emojiUsage },
                    { label: "Humor", value: config.persona.personality.humor },
                ])}
                {summarySection("Comportamiento", <Shield size={16} color="var(--accent)" />, [
                    { label: "Reglas", value: config.behavior.rules.filter(Boolean).join("; ") },
                    { label: "Temas prohibidos", value: config.behavior.forbiddenTopics.filter(Boolean).join("; ") },
                    { label: "Triggers handoff", value: config.behavior.handoffTriggers.filter(Boolean).join("; ") },
                ])}
                {summarySection("Horario", <Calendar size={16} color="var(--accent)" />, [
                    { label: "Zona horaria", value: config.hours.timezone },
                    { label: "Días activos", value: activeDays },
                    { label: "Mensaje fuera de horario", value: config.hours.afterHoursMessage },
                ])}
                {summarySection("Modelo IA", <Cpu size={16} color="var(--accent)" />, [
                    { label: "Temperatura", value: String(config.llm.temperature) },
                    { label: "Max tokens", value: String(config.llm.maxTokens) },
                ])}
                <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                        width: "100%", padding: "14px 24px", borderRadius: 12, border: "none",
                        background: saving ? "var(--border)" : "var(--accent)",
                        color: "#fff", fontSize: 16, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        transition: "background 0.2s",
                    }}
                    onMouseEnter={e => { if (!saving) (e.currentTarget.style.background = "var(--accent-hover)"); }}
                    onMouseLeave={e => { if (!saving) (e.currentTarget.style.background = "var(--accent)"); }}
                >
                    <Save size={18} />
                    {saving ? "Guardando..." : "Guardar Configuración"}
                </button>
            </div>
        );
    }

    // ── Render ─────────────────────────────────────────────────

    if (loading) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
                <div style={{ textAlign: "center" }}>
                    <Bot size={40} color="var(--accent)" style={{ marginBottom: 12 }} />
                    <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>Cargando configuración del agente...</div>
                </div>
            </div>
        );
    }

    const stepRenderers = [renderStep0, renderStep1, renderStep2, renderStep3, renderStep4, renderStep5];

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                    <Bot size={28} color="var(--accent)" /> Agente IA
                </h1>
                <p style={{ color: "var(--text-secondary)", margin: "4px 0 0", fontSize: 14 }}>
                    Configura el comportamiento de tu agente conversacional
                </p>
            </div>

            {/* Mode toggle */}
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                <button
                    onClick={() => setMode("wizard")}
                    style={{
                        flex: 1, padding: "14px 20px", borderRadius: 12,
                        border: `2px solid ${mode === "wizard" ? "var(--accent)" : "var(--border)"}`,
                        background: mode === "wizard" ? "var(--accent-glow)" : "var(--bg-secondary)",
                        color: mode === "wizard" ? "var(--accent)" : "var(--text-secondary)",
                        fontSize: 14, fontWeight: 600, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        transition: "all 0.2s",
                    }}
                >
                    <Sparkles size={16} /> Wizard guiado
                </button>
                <button
                    onClick={() => setMode("prompt")}
                    style={{
                        flex: 1, padding: "14px 20px", borderRadius: 12,
                        border: `2px solid ${mode === "prompt" ? "var(--accent)" : "var(--border)"}`,
                        background: mode === "prompt" ? "var(--accent-glow)" : "var(--bg-secondary)",
                        color: mode === "prompt" ? "var(--accent)" : "var(--text-secondary)",
                        fontSize: 14, fontWeight: 600, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        transition: "all 0.2s",
                    }}
                >
                    <Brain size={16} /> Prompt personalizado
                </button>
            </div>

            {mode === "prompt" ? (
                /* ── Prompt mode ─────────────────────────── */
                <>
                    <div style={{
                        padding: 24, borderRadius: 14,
                        background: "var(--bg-secondary)", border: "1px solid var(--border)",
                        marginBottom: 24,
                    }}>
                        <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                            <Brain size={20} color="var(--accent)" /> System Prompt personalizado
                        </h3>
                        <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "0 0 16px" }}>
                            Escribe el prompt completo que recibirá el modelo de IA como instrucción del sistema.
                            Este prompt reemplaza toda la configuración del wizard.
                        </p>
                        <textarea
                            value={customPrompt}
                            onChange={e => setCustomPrompt(e.target.value)}
                            placeholder={`Eres Sofia Henao, asesora de ventas de Gecko Aventura Extrema.\n\nTu personalidad:\n- Tono amigable y entusiasta\n- Uso moderado de emojis\n- Siempre respondes en español colombiano\n\nReglas:\n1. Nunca inventes precios\n2. Si no puedes resolver en 3 mensajes, ofrece hablar con un humano\n3. Siempre confirma fecha y número de personas antes de cotizar\n\nHorario: Lunes a Viernes 8am-6pm, Sábados 8am-2pm (Colombia)`}
                            style={{
                                width: "100%", minHeight: 400, padding: "16px",
                                borderRadius: 10, border: "1px solid var(--border)",
                                background: "var(--bg-primary)", color: "var(--text-primary)",
                                fontSize: 14, lineHeight: 1.6, fontFamily: "monospace",
                                outline: "none", boxSizing: "border-box", resize: "vertical",
                            }}
                        />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                            <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                                {customPrompt.length} caracteres
                            </span>
                            <button
                                onClick={handleSave}
                                disabled={saving || !customPrompt.trim()}
                                style={{
                                    padding: "10px 24px", borderRadius: 10, border: "none",
                                    background: saving || !customPrompt.trim() ? "var(--border)" : "var(--accent)",
                                    color: "#fff", fontSize: 14, fontWeight: 600,
                                    cursor: saving || !customPrompt.trim() ? "not-allowed" : "pointer",
                                    display: "flex", alignItems: "center", gap: 6,
                                }}
                            >
                                <Save size={16} /> {saving ? "Guardando..." : "Guardar Prompt"}
                            </button>
                        </div>
                    </div>
                </>
            ) : (
                /* ── Wizard mode ─────────────────────────── */
                <>
                    {/* Step indicator */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
                        {STEPS.map((s, i) => {
                            const isActive = i === step;
                            const isDone = i < step;
                            return (
                                <button
                                    key={i}
                                    onClick={() => setStep(i)}
                                    style={{
                                        padding: "8px 16px", borderRadius: 20,
                                        border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                                        background: isActive ? "var(--accent)" : isDone ? "var(--accent-glow)" : "var(--bg-secondary)",
                                        color: isActive ? "#fff" : isDone ? "var(--accent)" : "var(--text-secondary)",
                                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                                        display: "flex", alignItems: "center", gap: 6,
                                        transition: "all 0.2s",
                                    }}
                                >
                                    <s.icon size={14} />
                                    {s.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Step content */}
                    <div style={{ marginBottom: 24 }}>
                        {stepRenderers[step]()}
                    </div>

                    {/* Navigation */}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <button
                            onClick={() => setStep(prev => prev - 1)}
                            disabled={step === 0}
                            style={{
                                padding: "10px 20px", borderRadius: 10,
                                border: "1px solid var(--border)",
                                background: "var(--bg-secondary)",
                                color: step === 0 ? "var(--border)" : "var(--text-primary)",
                                fontSize: 14, fontWeight: 600, cursor: step === 0 ? "not-allowed" : "pointer",
                                display: "flex", alignItems: "center", gap: 6,
                            }}
                        >
                            <ChevronLeft size={16} /> Anterior
                        </button>
                        {step < 5 ? (
                            <button
                                onClick={() => setStep(prev => prev + 1)}
                                style={{
                                    padding: "10px 20px", borderRadius: 10, border: "none",
                                    background: "var(--accent)", color: "#fff",
                                    fontSize: 14, fontWeight: 600, cursor: "pointer",
                                    display: "flex", alignItems: "center", gap: 6,
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = "var(--accent-hover)")}
                                onMouseLeave={e => (e.currentTarget.style.background = "var(--accent)")}
                            >
                                Siguiente <ChevronRight size={16} />
                            </button>
                        ) : (
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                style={{
                                    padding: "10px 20px", borderRadius: 10, border: "none",
                                    background: saving ? "var(--border)" : "var(--accent)",
                                    color: "#fff", fontSize: 14, fontWeight: 600,
                                    cursor: saving ? "not-allowed" : "pointer",
                                    display: "flex", alignItems: "center", gap: 6,
                                }}
                            >
                                <Save size={16} /> {saving ? "Guardando..." : "Guardar"}
                            </button>
                        )}
                    </div>
                </>
            )}

            {/* Toast */}
            {toast && (
                <div style={{
                    position: "fixed", bottom: 24, right: 24,
                    padding: "12px 20px", borderRadius: 10,
                    background: toast.includes("Error") ? "var(--danger)" : "var(--success)",
                    color: "#fff", fontSize: 14, fontWeight: 600,
                    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                    zIndex: 9999, display: "flex", alignItems: "center", gap: 8,
                    animation: "slideIn 0.3s ease",
                }}>
                    {toast.includes("Error") ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
                    {toast}
                </div>
            )}
        </div>
    );
}
