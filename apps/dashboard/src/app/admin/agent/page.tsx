"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Bot, User, MessageSquare, Brain, Clock, Cpu, CheckCircle,
    ChevronLeft, ChevronRight, Plus, X, Save, Sparkles,
    Shield, AlertTriangle, Smile, Globe, Calendar, Thermometer, Wrench,
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
    tools?: {
        appointments?: {
            enabled: boolean;
            canBook: boolean;
            canCancel: boolean;
        };
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
    tools: { appointments: { enabled: false, canBook: true, canCancel: true } },
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
    { label: "Herramientas", icon: Wrench },
    { label: "Resumen", icon: CheckCircle },
];

const DAY_LABELS: Record<string, string> = {
    lun: "Lunes",
    mar: "Martes",
    mie: "Miercoles",
    jue: "Jueves",
    vie: "Viernes",
    sab: "Sabado",
    dom: "Domingo",
};

// ── Shared class constants ────────────────────────────────────

const inputCls = "w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-primary)] text-foreground text-sm outline-none";
const selectCls = "w-full px-3.5 py-2.5 pr-8 rounded-[10px] border border-border bg-[var(--bg-primary)] text-foreground text-sm outline-none appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2712%27%20height=%2712%27%20fill=%27%239898b0%27%20viewBox=%270%200%2024%2024%27%3E%3Cpath%20d=%27M7%2010l5%205%205-5z%27/%3E%3C/svg%3E')] bg-no-repeat bg-[right_12px_center]";
const labelCls = "block text-[13px] font-semibold text-[var(--text-secondary)] mb-1.5";
const cardCls = "p-6 rounded-[14px] bg-[var(--bg-secondary)] border border-border";

// ── Component ──────────────────────────────────────────────────

export default function AgentConfigPage() {
    const t = useTranslations('agent');
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
                setToast("Configuracion guardada exitosamente");
            } else {
                setToast("Error al guardar la configuracion");
            }
        } catch {
            setToast("Error al guardar la configuracion");
        } finally {
            setSaving(false);
        }
    }

    // ── Step renderers ─────────────────────────────────────────

    function renderStep0() {
        return (
            <div className={cardCls}>
                <h3 className="text-lg font-semibold mt-0 mb-5 flex items-center gap-2">
                    <User size={20} className="text-primary" /> Identidad del Agente
                </h3>
                <div className="grid grid-cols-2 gap-5">
                    <div>
                        <label className={labelCls}>Nombre del agente</label>
                        <input
                            className={inputCls}
                            placeholder="Ej: Sofia Henao"
                            value={config.persona.name}
                            onChange={e => updatePersona("name", e.target.value)}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>Rol</label>
                        <input
                            className={inputCls}
                            placeholder="Ej: Asesora de ventas"
                            value={config.persona.role}
                            onChange={e => updatePersona("role", e.target.value)}
                        />
                    </div>
                    <div className="col-span-2">
                        <label className={labelCls}>Mensaje de bienvenida</label>
                        <textarea
                            className={cn(inputCls, "min-h-20 resize-y")}
                            placeholder="Escribe el saludo que enviara el agente al iniciar una conversacion..."
                            value={config.persona.greeting}
                            onChange={e => updatePersona("greeting", e.target.value)}
                        />
                    </div>
                    <div className="col-span-2">
                        <label className={labelCls}>Mensaje cuando no puede responder</label>
                        <textarea
                            className={cn(inputCls, "min-h-20 resize-y")}
                            placeholder="Mensaje de fallback cuando el agente no sabe que responder..."
                            value={config.persona.fallbackMessage}
                            onChange={e => updatePersona("fallbackMessage", e.target.value)}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>Idioma</label>
                        <select
                            className={selectCls}
                            value={config.language}
                            onChange={e => setConfig(prev => ({ ...prev, language: e.target.value }))}
                        >
                            <option value="es-CO">Espanol (Colombia)</option>
                            <option value="es-MX">Espanol (Mexico)</option>
                            <option value="en-US">English (US)</option>
                            <option value="pt-BR">Portugues (Brasil)</option>
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Industria</label>
                        <select
                            className={selectCls}
                            value={config.industry}
                            onChange={e => setConfig(prev => ({ ...prev, industry: e.target.value }))}
                        >
                            <option value="general">General</option>
                            <option value="tourism">Turismo</option>
                            <option value="education">Educacion</option>
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
            <div className={cardCls}>
                <h3 className="text-lg font-semibold mt-0 mb-5 flex items-center gap-2">
                    <Smile size={20} className="text-primary" /> Personalidad
                </h3>
                <div className="grid grid-cols-2 gap-5">
                    <div>
                        <label className={labelCls}>Tono</label>
                        <select
                            className={selectCls}
                            value={config.persona.personality.tone}
                            onChange={e => updatePersonality("tone", e.target.value)}
                        >
                            <option value="amigable">Amigable</option>
                            <option value="profesional">Profesional</option>
                            <option value="formal">Formal</option>
                            <option value="casual">Casual</option>
                            <option value="empatico">Empatico</option>
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Formalidad</label>
                        <select
                            className={selectCls}
                            value={config.persona.personality.formality}
                            onChange={e => updatePersonality("formality", e.target.value)}
                        >
                            <option value="formal">Formal</option>
                            <option value="casual-professional">Casual-Profesional</option>
                            <option value="casual">Casual</option>
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Uso de emojis</label>
                        <select
                            className={selectCls}
                            value={config.persona.personality.emojiUsage}
                            onChange={e => updatePersonality("emojiUsage", e.target.value)}
                        >
                            <option value="none">Ninguno</option>
                            <option value="minimal">Minimo</option>
                            <option value="moderate">Moderado</option>
                            <option value="heavy">Abundante</option>
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Humor</label>
                        <input
                            className={inputCls}
                            placeholder="Ej: ligero, tematica de aventura"
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
            <div className="flex flex-col gap-5">
                {sections.map(section => (
                    <div key={section.key} className={cardCls}>
                        <h3 className="text-base font-semibold mt-0 mb-3.5 flex items-center gap-2">
                            <section.icon size={18} className="text-primary" /> {section.title}
                        </h3>
                        <div className="flex flex-col gap-2.5">
                            {config.behavior[section.key].map((item, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                    <input
                                        className={cn(inputCls, "flex-1")}
                                        placeholder={section.placeholder}
                                        value={item}
                                        onChange={e => updateBehaviorList(section.key, idx, e.target.value)}
                                    />
                                    <button
                                        onClick={() => removeBehaviorItem(section.key, idx)}
                                        className="w-9 h-9 rounded-lg border border-border bg-[var(--bg-primary)] text-[var(--danger)] cursor-pointer flex items-center justify-center shrink-0"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            ))}
                            <button
                                onClick={() => addBehaviorItem(section.key)}
                                className="px-4 py-2 rounded-lg border border-dashed border-border bg-transparent text-primary cursor-pointer text-[13px] font-semibold flex items-center gap-1.5 self-start"
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
            { value: "America/Bogota", label: "Bogota (GMT-5)" },
            { value: "America/Mexico_City", label: "Ciudad de Mexico (GMT-6)" },
            { value: "America/Lima", label: "Lima (GMT-5)" },
            { value: "America/Santiago", label: "Santiago (GMT-4)" },
            { value: "America/Buenos_Aires", label: "Buenos Aires (GMT-3)" },
        ];

        const is247 = Object.values(config.hours.schedule).every(v => v !== null) &&
            Object.values(config.hours.schedule).every(v => v === null || ((v as any).start === '00:00' && (v as any).end === '23:59'));

        const toggle247 = (enabled: boolean) => {
            if (enabled) {
                const allDay = { start: '00:00', end: '23:59' };
                setConfig(prev => ({
                    ...prev,
                    hours: {
                        ...prev.hours,
                        schedule: { lun: allDay, mar: allDay, mie: allDay, jue: allDay, vie: allDay, sab: allDay, dom: allDay },
                        afterHoursMessage: '',
                    },
                }));
            } else {
                setConfig(prev => ({
                    ...prev,
                    hours: {
                        ...prev.hours,
                        schedule: {
                            lun: { start: '08:00', end: '18:00' },
                            mar: { start: '08:00', end: '18:00' },
                            mie: { start: '08:00', end: '18:00' },
                            jue: { start: '08:00', end: '18:00' },
                            vie: { start: '08:00', end: '18:00' },
                            sab: { start: '08:00', end: '14:00' },
                            dom: null,
                        },
                    },
                }));
            }
        };

        return (
            <div className={cardCls}>
                <h3 className="text-lg font-semibold mt-0 mb-5 flex items-center gap-2">
                    <Calendar size={20} className="text-primary" /> Horario del Agente
                </h3>

                {/* Timezone */}
                <div className="mb-5">
                    <label className={labelCls}>Zona horaria</label>
                    <select
                        className={cn(selectCls, "max-w-80")}
                        value={config.hours.timezone}
                        onChange={e => setConfig(prev => ({ ...prev, hours: { ...prev.hours, timezone: e.target.value } }))}
                    >
                        {timezones.map(tz => (
                            <option key={tz.value} value={tz.value}>{tz.label}</option>
                        ))}
                    </select>
                </div>

                {/* 24/7 Toggle */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 mb-5">
                    <div>
                        <p className="text-sm font-semibold text-foreground">Disponible 24/7</p>
                        <p className="text-xs text-muted-foreground mt-0.5">El agente atiende todos los días, las 24 horas</p>
                    </div>
                    <button
                        onClick={() => toggle247(!is247)}
                        className={cn(
                            "w-12 h-7 rounded-full border-none cursor-pointer relative transition-colors duration-200",
                            is247 ? "bg-indigo-500" : "bg-neutral-300 dark:bg-white/20"
                        )}
                    >
                        <div
                            className="w-5 h-5 rounded-full bg-white absolute top-1 transition-[left] duration-200 shadow-sm"
                            style={{ left: is247 ? 26 : 4 }}
                        />
                    </button>
                </div>

                {/* Per-day schedule (hidden when 24/7) */}
                {!is247 && (
                    <>
                        <div className="flex flex-col gap-2.5 mb-5">
                            {Object.entries(DAY_LABELS).map(([key, label]) => {
                                const daySchedule = config.hours.schedule[key];
                                const isActive = daySchedule !== null;
                                return (
                                    <div key={key} className="flex items-center gap-3.5 px-3.5 py-2.5 rounded-[10px] bg-[var(--bg-primary)] border border-border">
                                        <button
                                            onClick={() => updateScheduleDay(key, !isActive)}
                                            className={cn(
                                                "w-[42px] h-6 rounded-xl border-none cursor-pointer relative transition-colors duration-200",
                                                isActive ? "bg-[var(--success)]" : "bg-border"
                                            )}
                                        >
                                            <div
                                                className="w-[18px] h-[18px] rounded-full bg-white absolute top-[3px] transition-[left] duration-200"
                                                style={{ left: isActive ? 21 : 3 }}
                                            />
                                        </button>
                                        <span className={cn(
                                            "w-[90px] text-sm font-semibold",
                                            isActive ? "text-foreground" : "text-[var(--text-secondary)]"
                                        )}>
                                            {label}
                                        </span>
                                        {isActive ? (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="time"
                                                    className={cn(inputCls, "w-[130px]")}
                                                    value={(daySchedule as any).start}
                                                    onChange={e => updateScheduleTime(key, "start", e.target.value)}
                                                />
                                                <span className="text-[var(--text-secondary)] text-[13px]">a</span>
                                                <input
                                                    type="time"
                                                    className={cn(inputCls, "w-[130px]")}
                                                    value={(daySchedule as any).end}
                                                    onChange={e => updateScheduleTime(key, "end", e.target.value)}
                                                />
                                            </div>
                                        ) : (
                                            <span className="text-[13px] text-[var(--text-secondary)] italic">Cerrado</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <div>
                            <label className={labelCls}>Mensaje fuera de horario</label>
                            <textarea
                                className={cn(inputCls, "min-h-[70px] resize-y")}
                                placeholder="Mensaje que se envia fuera del horario comercial..."
                                value={config.hours.afterHoursMessage}
                                onChange={e => setConfig(prev => ({ ...prev, hours: { ...prev.hours, afterHoursMessage: e.target.value } }))}
                            />
                        </div>
                    </>
                )}
            </div>
        );
    }

    function renderStep4() {
        return (
            <div className={cardCls}>
                <h3 className="text-lg font-semibold mt-0 mb-5 flex items-center gap-2">
                    <Cpu size={20} className="text-primary" /> Modelo de IA
                </h3>
                <div className="grid grid-cols-2 gap-6">
                    <div>
                        <label className={labelCls}>Temperatura: {config.llm.temperature}</label>
                        <input
                            type="range"
                            min={0} max={1} step={0.1}
                            value={config.llm.temperature}
                            onChange={e => setConfig(prev => ({ ...prev, llm: { ...prev.llm, temperature: parseFloat(e.target.value) } }))}
                            className="w-full accent-primary"
                        />
                        <div className="flex justify-between text-[11px] text-[var(--text-secondary)] mt-1">
                            <span>Preciso (0)</span>
                            <span>Creativo (1)</span>
                        </div>
                    </div>
                    <div>
                        <label className={labelCls}>Max tokens</label>
                        <input
                            type="number"
                            className={inputCls}
                            min={100} max={4000}
                            value={config.llm.maxTokens}
                            onChange={e => setConfig(prev => ({ ...prev, llm: { ...prev.llm, maxTokens: parseInt(e.target.value) || 800 } }))}
                        />
                    </div>
                </div>
                <div className="mt-5 p-4 rounded-[10px] bg-[var(--accent-glow)] border border-primary">
                    <div className="flex items-start gap-2.5">
                        <Sparkles size={18} className="text-primary mt-0.5 shrink-0" />
                        <div className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                            <strong className="text-foreground">Temperatura</strong> controla la creatividad de las respuestas.
                            Valores bajos (0-0.3) producen respuestas consistentes y predecibles.
                            Valores altos (0.7-1) generan respuestas mas variadas y creativas.<br />
                            <strong className="text-foreground">Max tokens</strong> limita la longitud maxima de cada respuesta.
                            800 tokens equivalen aproximadamente a 2-3 parrafos.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    function renderStep5() {
        const tools = config.tools || { appointments: { enabled: false, canBook: true, canCancel: true } };
        const apt = tools.appointments || { enabled: false, canBook: true, canCancel: true };

        const updateTools = (updates: Partial<typeof apt>) => {
            setConfig({
                ...config,
                tools: { ...tools, appointments: { ...apt, ...updates } },
            });
        };

        return (
            <div>
                <h3 className="text-lg font-semibold mb-1">Herramientas del Agente</h3>
                <p className="text-sm text-muted-foreground mb-6">
                    Activa las herramientas que tu agente IA puede usar durante las conversaciones.
                </p>

                {/* Appointments Tool */}
                <div className={cn(cardCls, "mb-4")}>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                                <Calendar size={20} className="text-indigo-500" />
                            </div>
                            <div>
                                <h4 className="text-sm font-semibold">Agendamiento de Citas</h4>
                                <p className="text-xs text-muted-foreground">Permite al agente consultar disponibilidad, agendar y cancelar citas</p>
                            </div>
                        </div>
                        <button
                            onClick={() => updateTools({ enabled: !apt.enabled })}
                            className={cn(
                                "relative w-11 h-6 rounded-full transition-colors",
                                apt.enabled ? "bg-indigo-500" : "bg-neutral-300 dark:bg-white/20"
                            )}
                        >
                            <div className={cn(
                                "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                                apt.enabled ? "translate-x-[22px]" : "translate-x-0.5"
                            )} />
                        </button>
                    </div>

                    {apt.enabled && (
                        <div className="pl-13 space-y-3 border-t border-neutral-200 dark:border-white/10 pt-4">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input type="checkbox" checked={apt.canBook} onChange={(e) => updateTools({ canBook: e.target.checked })}
                                    className="w-4 h-4 rounded border-neutral-300 dark:border-white/20 text-indigo-500" />
                                <div>
                                    <span className="text-sm font-medium">Crear citas</span>
                                    <p className="text-xs text-muted-foreground">El agente puede agendar citas nuevas con confirmación del cliente</p>
                                </div>
                            </label>
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input type="checkbox" checked={apt.canCancel} onChange={(e) => updateTools({ canCancel: e.target.checked })}
                                    className="w-4 h-4 rounded border-neutral-300 dark:border-white/20 text-indigo-500" />
                                <div>
                                    <span className="text-sm font-medium">Cancelar citas</span>
                                    <p className="text-xs text-muted-foreground">El agente puede cancelar citas del mismo cliente que lo solicita</p>
                                </div>
                            </label>
                            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                                <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                                <p className="text-xs text-amber-700 dark:text-amber-300">
                                    El agente siempre pedirá confirmación antes de agendar. Necesitas tener servicios y horarios configurados en Citas.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Future tools placeholder */}
                <div className={cn(cardCls, "opacity-50")}>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-neutral-100 dark:bg-white/5 flex items-center justify-center">
                            <Wrench size={20} className="text-muted-foreground" />
                        </div>
                        <div>
                            <h4 className="text-sm font-semibold text-muted-foreground">Más herramientas próximamente</h4>
                            <p className="text-xs text-muted-foreground">Catálogo, CRM, pagos y más</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    function renderStep6() {
        const summarySection = (title: string, icon: any, items: { label: string; value: string }[]) => (
            <div className={cn(cardCls, "mb-4")}>
                <h4 className="text-[15px] font-semibold mt-0 mb-3.5 flex items-center gap-2">
                    {icon} {title}
                </h4>
                <div className="grid grid-cols-2 gap-2.5">
                    {items.map((item, i) => (
                        <div key={i}>
                            <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                                {item.label}
                            </div>
                            <div className="text-sm text-foreground mt-0.5">
                                {item.value || "\u2014"}
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
                {summarySection("Identidad", <User size={16} className="text-primary" />, [
                    { label: "Nombre", value: config.persona.name },
                    { label: "Rol", value: config.persona.role },
                    { label: "Idioma", value: config.language },
                    { label: "Industria", value: config.industry },
                    { label: "Saludo", value: config.persona.greeting },
                    { label: "Fallback", value: config.persona.fallbackMessage },
                ])}
                {summarySection("Personalidad", <Smile size={16} className="text-primary" />, [
                    { label: "Tono", value: config.persona.personality.tone },
                    { label: "Formalidad", value: config.persona.personality.formality },
                    { label: "Emojis", value: config.persona.personality.emojiUsage },
                    { label: "Humor", value: config.persona.personality.humor },
                ])}
                {summarySection("Comportamiento", <Shield size={16} className="text-primary" />, [
                    { label: "Reglas", value: config.behavior.rules.filter(Boolean).join("; ") },
                    { label: "Temas prohibidos", value: config.behavior.forbiddenTopics.filter(Boolean).join("; ") },
                    { label: "Triggers handoff", value: config.behavior.handoffTriggers.filter(Boolean).join("; ") },
                ])}
                {summarySection("Horario", <Calendar size={16} className="text-primary" />, [
                    { label: "Zona horaria", value: config.hours.timezone },
                    { label: "Dias activos", value: activeDays },
                    { label: "Mensaje fuera de horario", value: config.hours.afterHoursMessage },
                ])}
                {summarySection("Modelo IA", <Cpu size={16} className="text-primary" />, [
                    { label: "Temperatura", value: String(config.llm.temperature) },
                    { label: "Max tokens", value: String(config.llm.maxTokens) },
                ])}
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                        "w-full py-3.5 px-6 rounded-xl border-none text-white text-base font-semibold cursor-pointer flex items-center justify-center gap-2 transition-colors duration-200",
                        saving ? "bg-border cursor-not-allowed" : "bg-primary hover:bg-[var(--accent-hover)]"
                    )}
                >
                    <Save size={18} />
                    {saving ? t("saving") || "..." : "Guardar Configuracion"}
                </button>
            </div>
        );
    }

    // ── Render ─────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="text-center">
                    <Bot size={40} className="text-primary mb-3" />
                    <div className="text-[var(--text-secondary)] text-sm">Cargando configuracion del agente...</div>
                </div>
            </div>
        );
    }

    const stepRenderers = [renderStep0, renderStep1, renderStep2, renderStep3, renderStep4, renderStep5, renderStep6];

    return (
        <div>
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-[28px] font-semibold m-0 flex items-center gap-2.5">
                    <Bot size={28} className="text-primary" /> {t('title')}
                </h1>
                <p className="text-[var(--text-secondary)] mt-1 text-sm">
                    Configura el comportamiento de tu agente conversacional
                </p>
            </div>

            {/* Mode toggle */}
            <div className="flex gap-2 mb-6">
                <button
                    onClick={() => setMode("wizard")}
                    className={cn(
                        "flex-1 py-3.5 px-5 rounded-xl border-2 text-sm font-semibold cursor-pointer flex items-center justify-center gap-2 transition-all duration-200",
                        mode === "wizard"
                            ? "border-primary bg-[var(--accent-glow)] text-primary"
                            : "border-border bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                    )}
                >
                    <Sparkles size={16} /> Wizard guiado
                </button>
                <button
                    onClick={() => setMode("prompt")}
                    className={cn(
                        "flex-1 py-3.5 px-5 rounded-xl border-2 text-sm font-semibold cursor-pointer flex items-center justify-center gap-2 transition-all duration-200",
                        mode === "prompt"
                            ? "border-primary bg-[var(--accent-glow)] text-primary"
                            : "border-border bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                    )}
                >
                    <Brain size={16} /> Prompt personalizado
                </button>
            </div>

            {mode === "prompt" ? (
                /* ── Prompt mode ─────────────────────────── */
                <>
                    <div className={cn(cardCls, "mb-6")}>
                        <h3 className="text-lg font-semibold mt-0 mb-2 flex items-center gap-2">
                            <Brain size={20} className="text-primary" /> System Prompt personalizado
                        </h3>
                        <p className="text-[var(--text-secondary)] text-[13px] mb-4">
                            Escribe el prompt completo que recibira el modelo de IA como instruccion del sistema.
                            Este prompt reemplaza toda la configuracion del wizard.
                        </p>
                        <textarea
                            value={customPrompt}
                            onChange={e => setCustomPrompt(e.target.value)}
                            placeholder={`Eres Sofia Henao, asesora de ventas de Gecko Aventura Extrema.\n\nTu personalidad:\n- Tono amigable y entusiasta\n- Uso moderado de emojis\n- Siempre respondes en espanol colombiano\n\nReglas:\n1. Nunca inventes precios\n2. Si no puedes resolver en 3 mensajes, ofrece hablar con un humano\n3. Siempre confirma fecha y numero de personas antes de cotizar\n\nHorario: Lunes a Viernes 8am-6pm, Sabados 8am-2pm (Colombia)`}
                            className="w-full min-h-[400px] p-4 rounded-[10px] border border-border bg-[var(--bg-primary)] text-foreground text-sm leading-relaxed font-mono outline-none resize-y"
                        />
                        <div className="flex justify-between items-center mt-3">
                            <span className="text-[var(--text-secondary)] text-xs">
                                {customPrompt.length} caracteres
                            </span>
                            <button
                                onClick={handleSave}
                                disabled={saving || !customPrompt.trim()}
                                className={cn(
                                    "px-6 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5",
                                    saving || !customPrompt.trim()
                                        ? "bg-border cursor-not-allowed"
                                        : "bg-primary"
                                )}
                            >
                                <Save size={16} /> {saving ? t("saving") || "..." : "Guardar Prompt"}
                            </button>
                        </div>
                    </div>
                </>
            ) : (
                /* ── Wizard mode ─────────────────────────── */
                <>
                    {/* Step indicator */}
                    <div className="flex gap-1.5 mb-6 flex-wrap">
                        {STEPS.map((s, i) => {
                            const isActive = i === step;
                            const isDone = i < step;
                            return (
                                <button
                                    key={i}
                                    onClick={() => setStep(i)}
                                    className={cn(
                                        "px-4 py-2 rounded-full border text-[13px] font-semibold cursor-pointer flex items-center gap-1.5 transition-all duration-200",
                                        isActive
                                            ? "border-primary bg-primary text-white"
                                            : isDone
                                                ? "border-border bg-[var(--accent-glow)] text-primary"
                                                : "border-border bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                                    )}
                                >
                                    <s.icon size={14} />
                                    {s.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Step content */}
                    <div className="mb-6">
                        {stepRenderers[step]()}
                    </div>

                    {/* Navigation */}
                    <div className="flex justify-between gap-3">
                        <button
                            onClick={() => setStep(prev => prev - 1)}
                            disabled={step === 0}
                            className={cn(
                                "px-5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-secondary)] text-sm font-semibold flex items-center gap-1.5",
                                step === 0
                                    ? "text-border cursor-not-allowed"
                                    : "text-foreground cursor-pointer"
                            )}
                        >
                            <ChevronLeft size={16} /> Anterior
                        </button>
                        {step < 5 ? (
                            <button
                                onClick={() => setStep(prev => prev + 1)}
                                className="px-5 py-2.5 rounded-[10px] border-none bg-primary text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5 hover:bg-[var(--accent-hover)]"
                            >
                                Siguiente <ChevronRight size={16} />
                            </button>
                        ) : (
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className={cn(
                                    "px-5 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold flex items-center gap-1.5",
                                    saving ? "bg-border cursor-not-allowed" : "bg-primary cursor-pointer"
                                )}
                            >
                                <Save size={16} /> {saving ? t("saving") || "..." : "Guardar"}
                            </button>
                        )}
                    </div>
                </>
            )}

            {/* Toast */}
            {toast && (
                <div
                    className={cn(
                        "fixed bottom-6 right-6 px-5 py-3 rounded-[10px] text-white text-sm font-semibold shadow-[0_4px_20px_rgba(0,0,0,0.3)] z-[9999] flex items-center gap-2 animate-in",
                        toast.includes("Error") ? "bg-[var(--danger)]" : "bg-[var(--success)]"
                    )}
                >
                    {toast.includes("Error") ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
                    {toast}
                </div>
            )}
        </div>
    );
}
