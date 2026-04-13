"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
    Brain,
    MessageSquare,
    Headphones,
    Settings as SettingsIcon,
    Save,
    Eye,
    EyeOff,
    CheckCircle,
    Key,
    Globe,
    Shield,
    Instagram,
    Facebook,
    Send,
    Database,
    Zap,
    ArrowRight,
    Mail,
    Image,
    Lock,
} from "lucide-react";

const tabs = [
    { id: "llm", label: "LLM Providers", icon: Brain, color: "text-indigo-500", activeBg: "bg-indigo-500/10", activeBorder: "border-indigo-500" },
    { id: "whatsapp", label: "WhatsApp", icon: MessageSquare, color: "text-green-500", activeBg: "bg-green-500/10", activeBorder: "border-green-500" },
    { id: "instagram", label: "Instagram", icon: Instagram, color: "text-pink-500", activeBg: "bg-pink-500/10", activeBorder: "border-pink-500" },
    { id: "messenger", label: "Messenger", icon: Facebook, color: "text-blue-500", activeBg: "bg-blue-500/10", activeBorder: "border-blue-500" },
    { id: "telegram", label: "Telegram", icon: Send, color: "text-sky-500", activeBg: "bg-sky-500/10", activeBorder: "border-sky-500" },
    { id: "chatwoot", label: "Chatwoot", icon: Headphones, color: "text-blue-400", activeBg: "bg-blue-400/10", activeBorder: "border-blue-400" },
    { id: "general", label: "General", icon: SettingsIcon, color: "text-sky-500", activeBg: "bg-sky-500/10", activeBorder: "border-sky-500" },
];

interface FieldConfig {
    key: string;
    label: string;
    description: string;
    type: "text" | "password" | "number" | "boolean" | "select";
    options?: string[];
    placeholder?: string;
}

const settingsSchema: Record<string, FieldConfig[]> = {
    llm: [
        { key: "llm.openai_api_key", label: "OpenAI API Key", description: "Para GPT-4o y GPT-4o-mini", type: "password", placeholder: "sk-..." },
        { key: "llm.anthropic_api_key", label: "Anthropic API Key", description: "Para Claude Sonnet", type: "password", placeholder: "sk-ant-..." },
        { key: "llm.google_ai_api_key", label: "Google AI API Key", description: "Para Gemini Pro y Gemini Flash", type: "password", placeholder: "AI..." },
        { key: "llm.xai_api_key", label: "xAI API Key", description: "Para Grok models", type: "password", placeholder: "xai-..." },
        { key: "llm.deepseek_api_key", label: "DeepSeek API Key", description: "Para DeepSeek Chat", type: "password", placeholder: "sk-..." },
        { key: "llm.default_model", label: "Modelo por defecto", description: "Usado cuando el router no puede decidir", type: "select", options: ["gpt-4o", "gpt-4o-mini", "gemini-2.0-flash", "gemini-2.0-pro", "claude-sonnet-4-20250514", "grok-2", "deepseek-chat"] },
        { key: "llm.default_temperature", label: "Temperatura", description: "Creatividad de respuestas (0.0 - 1.0)", type: "number", placeholder: "0.7" },
        { key: "llm.max_tokens", label: "Max Tokens", description: "Límite de tokens por respuesta", type: "number", placeholder: "800" },
    ],
    whatsapp: [
        { key: "whatsapp.phone_number_id", label: "Phone Number ID", description: "ID del número en Meta Business", type: "text", placeholder: "1234567890" },
        { key: "whatsapp.access_token", label: "Access Token", description: "Token permanente de Meta", type: "password", placeholder: "EAAG..." },
        { key: "whatsapp.business_account_id", label: "Business Account ID (WABA)", description: "ID de tu cuenta WhatsApp Business", type: "text", placeholder: "1234567890" },
        { key: "whatsapp.verify_token", label: "Webhook Verify Token", description: "Token para verificar webhooks de Meta", type: "password", placeholder: "my-verify-token" },
        { key: "whatsapp.app_secret", label: "App Secret", description: "Secret de la Meta App (verificación de firma)", type: "password", placeholder: "" },
    ],
    instagram: [
        { key: "instagram.ig_user_id", label: "Instagram User ID", description: "ID de tu cuenta de Instagram Business", type: "text", placeholder: "1234567890" },
        { key: "instagram.access_token", label: "Page Access Token", description: "Token de la Facebook Page vinculada", type: "password", placeholder: "EAAG..." },
        { key: "instagram.verify_token", label: "Webhook Verify Token", description: "Token para verificar webhooks de Meta", type: "password", placeholder: "my-ig-verify-token" },
        { key: "instagram.app_secret", label: "App Secret", description: "Secret de la Meta App", type: "password", placeholder: "" },
        { key: "instagram.webhook_url", label: "Webhook URL", description: "URL para configurar en Meta Developer", type: "text", placeholder: "https://api.parallly-chat.cloud/api/v1/channels/webhook/instagram" },
    ],
    messenger: [
        { key: "messenger.page_id", label: "Facebook Page ID", description: "ID de tu página de Facebook", type: "text", placeholder: "1234567890" },
        { key: "messenger.page_access_token", label: "Page Access Token", description: "Token permanente de la página", type: "password", placeholder: "EAAG..." },
        { key: "messenger.verify_token", label: "Webhook Verify Token", description: "Token para verificar webhooks", type: "password", placeholder: "my-fb-verify-token" },
        { key: "messenger.app_secret", label: "App Secret", description: "Secret de la Meta App", type: "password", placeholder: "" },
        { key: "messenger.webhook_url", label: "Webhook URL", description: "URL para configurar en Meta Developer", type: "text", placeholder: "https://api.parallly-chat.cloud/api/v1/channels/webhook/messenger" },
    ],
    telegram: [
        { key: "telegram.bot_token", label: "Bot Token", description: "Token del bot (obtenido de @BotFather)", type: "password", placeholder: "1234567890:AAHfiqksKZ8WmR2zMn..." },
        { key: "telegram.bot_username", label: "Bot Username", description: "Username del bot (sin @)", type: "text", placeholder: "mi_bot" },
        { key: "telegram.webhook_url", label: "Webhook URL", description: "URL para setWebhook", type: "text", placeholder: "https://api.parallly-chat.cloud/api/v1/channels/webhook/telegram" },
    ],
    chatwoot: [
        { key: "chatwoot.url", label: "Chatwoot URL", description: "URL base de tu instancia", type: "text", placeholder: "https://chatwoot.example.com" },
        { key: "chatwoot.api_token", label: "API Token", description: "Token de API para integraciones", type: "password", placeholder: "" },
        { key: "chatwoot.account_id", label: "Account ID", description: "ID de la cuenta en Chatwoot", type: "text", placeholder: "1" },
        { key: "chatwoot.inbox_id", label: "Inbox ID", description: "ID del inbox para handoff a agente humano", type: "text", placeholder: "1" },
    ],
    general: [
        { key: "general.platform_name", label: "Nombre de plataforma", description: "Nombre visible en el dashboard", type: "text", placeholder: "Parallext Engine" },
        { key: "general.default_language", label: "Idioma por defecto", description: "Idioma para nuevos tenants", type: "select", options: ["es-CO", "es-MX", "es-ES", "en-US", "pt-BR"] },
        { key: "general.default_timezone", label: "Zona horaria", description: "Timezone por defecto", type: "select", options: ["America/Bogota", "America/Mexico_City", "America/Lima", "America/New_York", "Europe/Madrid", "America/Sao_Paulo"] },
        { key: "general.max_conversations_per_tenant", label: "Max conversaciones", description: "Límite de conversaciones activas por tenant", type: "number", placeholder: "100" },
        { key: "general.enable_analytics", label: "Analytics habilitado", description: "Tracking de eventos y métricas", type: "boolean" },
        { key: "general.enable_rag", label: "RAG habilitado", description: "Búsqueda por Knowledge Base", type: "boolean" },
    ],
};

const toolCards = [
    {
        title: "Atributos Personalizados",
        description: "Define campos dinámicos para contactos y conversaciones",
        icon: Database,
        href: "/admin/settings/custom-attributes",
        iconColor: "text-blue-500",
        iconBg: "bg-blue-500/10",
    },
    {
        title: "Macros",
        description: "Secuencias de acciones guardadas para ejecutar rápidamente",
        icon: Zap,
        href: "/admin/settings/macros",
        iconColor: "text-orange-500",
        iconBg: "bg-orange-500/10",
    },
    {
        title: "Formulario Pre-Chat",
        description: "Configura los campos que se solicitan antes de iniciar un chat",
        icon: MessageSquare,
        href: "/admin/settings/prechat",
        iconColor: "text-emerald-500",
        iconBg: "bg-emerald-500/10",
    },
    {
        title: "Plantillas de Correo",
        description: "Personaliza emails de confirmacion, recordatorios y bienvenida",
        icon: Mail,
        href: "/admin/settings/email-templates",
        iconColor: "text-purple-500",
        iconBg: "bg-purple-500/10",
    },
    {
        title: "Banco de Imagenes",
        description: "Sube y gestiona imagenes de productos, logo de empresa y media",
        icon: Image,
        href: "/admin/settings/media",
        iconColor: "text-pink-500",
        iconBg: "bg-pink-500/10",
    },
    {
        title: "Cambiar Contrasena",
        description: "Actualiza la contrasena de tu cuenta o establece una nueva",
        icon: Lock,
        href: "/admin/settings/change-password",
        iconColor: "text-amber-500",
        iconBg: "bg-amber-500/10",
    },
];

export default function SettingsPage() {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState("llm");
    const [isLive, setIsLive] = useState(false);
    const [values, setValues] = useState<Record<string, string>>({
        "llm.default_model": "gpt-4o-mini",
        "llm.default_temperature": "0.7",
        "llm.max_tokens": "800",
        "chatwoot.account_id": "",
        "chatwoot.inbox_id": "",
        "general.platform_name": "Parallext Engine",
        "general.default_language": "es-CO",
        "general.default_timezone": "America/Bogota",
        "general.max_conversations_per_tenant": "100",
        "general.enable_analytics": "true",
        "general.enable_rag": "true",
    });
    const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);

    // Load existing API keys from backend
    useEffect(() => {
        async function load() {
            const result = await api.getApiKeys();
            if (result.success && result.data) {
                setValues(prev => ({ ...prev, ...result.data }));
                setIsLive(true);
            }
        }
        load();
    }, []);

    const handleChange = (key: string, value: string) => {
        setValues(prev => ({ ...prev, [key]: value }));
        setSaved(false);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.updateSettings(values);
            setSaved(true);
            setIsLive(true);
            setTimeout(() => setSaved(false), 3000);
        } catch {
            console.error("Error saving settings");
        } finally {
            setSaving(false);
        }
    };

    const toggleSecret = (key: string) => {
        setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const renderField = (field: FieldConfig) => {
        const value = values[field.key] || "";

        if (field.type === "boolean") {
            return (
                <div
                    key={field.key}
                    className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-800/50"
                >
                    <div>
                        <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{field.label}</div>
                        <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{field.description}</div>
                    </div>
                    <button
                        onClick={() => handleChange(field.key, value === "true" ? "false" : "true")}
                        className={cn(
                            "relative h-6 w-12 shrink-0 cursor-pointer rounded-full border-none transition-colors duration-200",
                            value === "true" ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-600"
                        )}
                    >
                        <div className={cn(
                            "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left] duration-200",
                            value === "true" ? "left-[27px]" : "left-[3px]"
                        )} />
                    </button>
                </div>
            );
        }

        if (field.type === "select") {
            return (
                <div key={field.key} className="flex flex-col gap-1.5">
                    <Label className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{field.label}</Label>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{field.description}</p>
                    <select
                        value={value}
                        onChange={e => handleChange(field.key, e.target.value)}
                        className="h-9 w-full cursor-pointer rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    >
                        {field.options?.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                </div>
            );
        }

        const isPassword = field.type === "password";
        const isVisible = showSecrets[field.key];

        return (
            <div key={field.key} className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {isPassword && <Key size={14} className="text-indigo-600" />}
                    {field.label}
                </Label>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{field.description}</p>
                <div className="relative">
                    <Input
                        type={isPassword && !isVisible ? "password" : field.type === "number" ? "number" : "text"}
                        value={value}
                        onChange={e => handleChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className={cn(
                            "h-9 rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800",
                            isPassword && "pr-11",
                            isPassword && !isVisible && "font-mono"
                        )}
                    />
                    {isPassword && (
                        <button
                            onClick={() => toggleSecret(field.key)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 border-none bg-transparent p-1 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                        >
                            {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const activeTabConfig = tabs.find(t => t.id === activeTab);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Configuración</h1>
                        <DataSourceBadge isLive={isLive} />
                    </div>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        Gestiona las API keys, credenciales y parámetros de la plataforma
                    </p>
                </div>
                <Button
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                        "gap-2 rounded-xl px-6",
                        saved
                            ? "bg-emerald-500 hover:bg-emerald-600"
                            : "bg-indigo-600 hover:bg-indigo-700",
                        saving && "opacity-70"
                    )}
                >
                    {saved ? <CheckCircle size={18} /> : <Save size={18} />}
                    {saving ? "Guardando..." : saved ? "¡Guardado!" : "Guardar cambios"}
                </Button>
            </div>

            {/* Security Badge */}
            <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs text-neutral-600 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-neutral-400">
                <Shield size={16} className="shrink-0 text-indigo-600" />
                Las API keys se almacenan encriptadas y se muestran enmascaradas. Solo super_admin puede modificarlas.
            </div>

            {/* Herramientas */}
            <div>
                <h2 className="mb-3 text-base font-semibold text-neutral-900 dark:text-neutral-100">Herramientas</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {toolCards.map(card => {
                        const Icon = card.icon;
                        return (
                            <button
                                key={card.href}
                                onClick={() => router.push(card.href)}
                                className="group flex items-center gap-3.5 rounded-xl border border-neutral-200 bg-white px-5 py-4 text-left transition-colors hover:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-indigo-500"
                            >
                                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", card.iconBg)}>
                                    <Icon size={20} className={card.iconColor} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                        {card.title}
                                    </div>
                                    <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                                        {card.description}
                                    </div>
                                </div>
                                <ArrowRight size={16} className="shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5" />
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap gap-2">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors",
                                isActive
                                    ? cn(tab.activeBorder, tab.activeBg, tab.color)
                                    : "border-neutral-200 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
                            )}
                        >
                            <Icon size={18} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Active Tab Content */}
            <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <Globe size={18} className={activeTabConfig?.color} />
                        <span className="text-neutral-900 dark:text-neutral-100">{activeTabConfig?.label}</span>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-4">
                        {settingsSchema[activeTab]?.map(field => renderField(field))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
