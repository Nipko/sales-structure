"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    MessageSquare,
    Instagram,
    Facebook,
    Send,
    Key,
    Eye,
    EyeOff,
    Save,
    CheckCircle,
} from "lucide-react";

const channelTabs = [
    { id: "whatsapp", label: "WhatsApp", icon: MessageSquare, color: "text-green-500", activeBg: "bg-green-500/10", activeBorder: "border-green-500" },
    { id: "instagram", label: "Instagram", icon: Instagram, color: "text-pink-500", activeBg: "bg-pink-500/10", activeBorder: "border-pink-500" },
    { id: "messenger", label: "Messenger", icon: Facebook, color: "text-blue-500", activeBg: "bg-blue-500/10", activeBorder: "border-blue-500" },
    { id: "telegram", label: "Telegram", icon: Send, color: "text-sky-500", activeBg: "bg-sky-500/10", activeBorder: "border-sky-500" },
];

interface FieldConfig {
    key: string;
    label: string;
    description: string;
    type: "text" | "password";
    placeholder?: string;
}

const fieldsSchema: Record<string, FieldConfig[]> = {
    whatsapp: [
        { key: "whatsapp.phone_number_id", label: "Phone Number ID", description: "Phone Number ID in Meta Business", type: "text", placeholder: "1234567890" },
        { key: "whatsapp.access_token", label: "Access Token", description: "Token permanente de Meta", type: "password", placeholder: "EAAG..." },
        { key: "whatsapp.business_account_id", label: "Business Account ID (WABA)", description: "ID de tu cuenta WhatsApp Business", type: "text", placeholder: "1234567890" },
        { key: "whatsapp.verify_token", label: "Webhook Verify Token", description: "Token para verificar webhooks de Meta", type: "password" },
        { key: "whatsapp.app_secret", label: "App Secret", description: "Meta App Secret (signature verification)", type: "password" },
    ],
    instagram: [
        { key: "instagram.ig_user_id", label: "Instagram User ID", description: "ID de tu cuenta de Instagram Business", type: "text", placeholder: "1234567890" },
        { key: "instagram.access_token", label: "Page Access Token", description: "Token de la Facebook Page vinculada", type: "password", placeholder: "EAAG..." },
        { key: "instagram.verify_token", label: "Webhook Verify Token", description: "Token para verificar webhooks de Meta", type: "password" },
        { key: "instagram.app_secret", label: "App Secret", description: "Secret de la Meta App", type: "password" },
        { key: "instagram.webhook_url", label: "Webhook URL", description: "URL para configurar en Meta Developer", type: "text", placeholder: "https://api.parallly-chat.cloud/api/v1/channels/webhook/instagram" },
    ],
    messenger: [
        { key: "messenger.page_id", label: "Facebook Page ID", description: "Your Facebook Page ID", type: "text", placeholder: "1234567890" },
        { key: "messenger.page_access_token", label: "Page Access Token", description: "Permanent page access token", type: "password", placeholder: "EAAG..." },
        { key: "messenger.verify_token", label: "Webhook Verify Token", description: "Token para verificar webhooks", type: "password" },
        { key: "messenger.app_secret", label: "App Secret", description: "Secret de la Meta App", type: "password" },
        { key: "messenger.webhook_url", label: "Webhook URL", description: "URL para configurar en Meta Developer", type: "text", placeholder: "https://api.parallly-chat.cloud/api/v1/channels/webhook/messenger" },
    ],
    telegram: [
        { key: "telegram.bot_token", label: "Bot Token", description: "Token del bot (obtenido de @BotFather)", type: "password", placeholder: "1234567890:AAHfiqksKZ8WmR2zMn..." },
        { key: "telegram.bot_username", label: "Bot Username", description: "Username del bot (sin @)", type: "text", placeholder: "mi_bot" },
        { key: "telegram.webhook_url", label: "Webhook URL", description: "URL para setWebhook", type: "text", placeholder: "https://api.parallly-chat.cloud/api/v1/channels/webhook/telegram" },
    ],
};

export default function ChannelsSettingsPage() {
    const t = useTranslations("settings");
    const [activeTab, setActiveTab] = useState("whatsapp");
    const [values, setValues] = useState<Record<string, string>>({});
    const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        async function load() {
            const result = await api.getApiKeys();
            if (result.success && result.data) {
                setValues(prev => ({ ...prev, ...result.data }));
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
            setTimeout(() => setSaved(false), 3000);
        } catch { /* ignore */ }
        setSaving(false);
    };

    const activeConfig = channelTabs.find(t => t.id === activeTab);

    return (
        <div className="max-w-3xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                        {t("pages.channelsConfig")}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        {t("pages.channelsConfigDesc")}
                    </p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                        "flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all",
                        saved ? "bg-emerald-500" : "bg-indigo-600 hover:bg-indigo-700",
                        saving && "opacity-70"
                    )}
                >
                    {saved ? <CheckCircle size={16} /> : <Save size={16} />}
                    {saving ? t("saving") : saved ? t("saved") : t("save")}
                </button>
            </div>

            {/* Channel tabs */}
            <div className="flex flex-wrap gap-2">
                {channelTabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                                isActive
                                    ? cn(tab.activeBorder, tab.activeBg, tab.color)
                                    : "border-neutral-200 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
                            )}
                        >
                            <Icon size={16} /> {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Fields */}
            <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        {activeConfig && <activeConfig.icon size={18} className={activeConfig.color} />}
                        <span className="text-neutral-900 dark:text-neutral-100">{activeConfig?.label}</span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {fieldsSchema[activeTab]?.map(field => {
                        const value = values[field.key] || "";
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
                                        type={isPassword && !isVisible ? "password" : "text"}
                                        value={value}
                                        onChange={e => handleChange(field.key, e.target.value)}
                                        placeholder={field.placeholder}
                                        className={cn(
                                            "h-9 rounded-lg border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800",
                                            isPassword && "pr-11 font-mono"
                                        )}
                                    />
                                    {isPassword && (
                                        <button
                                            onClick={() => setShowSecrets(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 border-none bg-transparent p-1 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400"
                                        >
                                            {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>
        </div>
    );
}
