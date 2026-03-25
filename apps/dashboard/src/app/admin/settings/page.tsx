"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";
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
} from "lucide-react";

const tabs = [
    { id: "llm", label: "LLM Providers", icon: Brain, color: "#6c5ce7" },
    { id: "whatsapp", label: "WhatsApp", icon: MessageSquare, color: "#25d366" },
    { id: "instagram", label: "Instagram", icon: Instagram, color: "#e1306c" },
    { id: "messenger", label: "Messenger", icon: Facebook, color: "#0084ff" },
    { id: "telegram", label: "Telegram", icon: Send, color: "#0088cc" },
    { id: "chatwoot", label: "Chatwoot", icon: Headphones, color: "#1f93ff" },
    { id: "general", label: "General", icon: SettingsIcon, color: "#00b4d8" },
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

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState("llm");
    const [isLive, setIsLive] = useState(false);
    const [values, setValues] = useState<Record<string, string>>({
        "llm.default_model": "gpt-4o-mini",
        "llm.default_temperature": "0.7",
        "llm.max_tokens": "800",
        "chatwoot.account_id": "1",
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
            // Save API keys through the centralized client
            for (const [key, value] of Object.entries(values)) {
                if (value && (key.includes("api_key") || key.includes("token") || key.includes("secret"))) {
                    await api.setApiKey(key, value);
                }
            }
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
                <div key={field.key} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "16px 20px", borderRadius: 12, background: "var(--bg-tertiary)",
                    border: "1px solid var(--border)",
                }}>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{field.label}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{field.description}</div>
                    </div>
                    <button
                        onClick={() => handleChange(field.key, value === "true" ? "false" : "true")}
                        style={{
                            width: 48, height: 26, borderRadius: 13, border: "none", cursor: "pointer",
                            background: value === "true" ? "var(--accent)" : "var(--border)",
                            position: "relative", transition: "background 0.2s ease",
                        }}
                    >
                        <div style={{
                            width: 20, height: 20, borderRadius: "50%", background: "white",
                            position: "absolute", top: 3, transition: "left 0.2s ease",
                            left: value === "true" ? 25 : 3,
                        }} />
                    </button>
                </div>
            );
        }

        if (field.type === "select") {
            return (
                <div key={field.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ fontWeight: 600, fontSize: 14 }}>{field.label}</label>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{field.description}</div>
                    <select
                        value={value}
                        onChange={e => handleChange(field.key, e.target.value)}
                        style={{
                            padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)",
                            background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14,
                            outline: "none", cursor: "pointer",
                        }}
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
            <div key={field.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    {isPassword && <Key size={14} color="var(--accent)" />}
                    {field.label}
                </label>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{field.description}</div>
                <div style={{ position: "relative" }}>
                    <input
                        type={isPassword && !isVisible ? "password" : field.type === "number" ? "number" : "text"}
                        value={value}
                        onChange={e => handleChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        style={{
                            width: "100%", padding: "10px 14px", paddingRight: isPassword ? 44 : 14,
                            borderRadius: 10, border: "1px solid var(--border)",
                            background: "var(--bg-tertiary)", color: "var(--text-primary)",
                            fontSize: 14, outline: "none", boxSizing: "border-box",
                            fontFamily: isPassword && !isVisible ? "monospace" : "inherit",
                        }}
                    />
                    {isPassword && (
                        <button
                            onClick={() => toggleSecret(field.key)}
                            style={{
                                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                                background: "none", border: "none", cursor: "pointer",
                                color: "var(--text-secondary)", padding: 4,
                            }}
                        >
                            {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Configuración</h1>
                        <DataSourceBadge isLive={isLive} />
                    </div>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                        Gestiona las API keys, credenciales y parámetros de la plataforma
                    </p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "12px 24px", borderRadius: 12, border: "none",
                        background: saved ? "#2ecc71" : "var(--accent)",
                        color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer",
                        transition: "all 0.3s ease", opacity: saving ? 0.7 : 1,
                    }}
                >
                    {saved ? <CheckCircle size={18} /> : <Save size={18} />}
                    {saving ? "Guardando..." : saved ? "¡Guardado!" : "Guardar cambios"}
                </button>
            </div>

            {/* Security Badge */}
            <div style={{
                display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
                borderRadius: 10, background: "rgba(108, 92, 231, 0.1)", border: "1px solid rgba(108, 92, 231, 0.2)",
                marginBottom: 24, fontSize: 13, color: "var(--text-secondary)",
            }}>
                <Shield size={16} color="#6c5ce7" />
                Las API keys se almacenan encriptadas y se muestran enmascaradas. Solo super_admin puede modificarlas.
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: "flex", alignItems: "center", gap: 8,
                                padding: "10px 20px", borderRadius: 10,
                                border: isActive ? `1px solid ${tab.color}` : "1px solid var(--border)",
                                background: isActive ? `${tab.color}15` : "transparent",
                                color: isActive ? tab.color : "var(--text-secondary)",
                                fontWeight: isActive ? 600 : 500, fontSize: 14, cursor: "pointer",
                                transition: "all 0.2s ease",
                            }}
                        >
                            <Icon size={18} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Active Tab Content */}
            <div style={{
                background: "var(--bg-secondary)", borderRadius: 16,
                border: "1px solid var(--border)", padding: 24,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                    <Globe size={18} color={tabs.find(t => t.id === activeTab)?.color} />
                    <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
                        {tabs.find(t => t.id === activeTab)?.label}
                    </h2>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {settingsSchema[activeTab]?.map(field => renderField(field))}
                </div>
            </div>
        </div>
    );
}
