"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key, Eye, EyeOff, Save, CheckCircle, Shield, Lock } from "lucide-react";

const providers = [
    { key: "llm.openai_api_key", label: "OpenAI", description: "GPT-4o y GPT-4o-mini", placeholder: "sk-...", color: "bg-emerald-500" },
    { key: "llm.anthropic_api_key", label: "Anthropic", description: "Claude Sonnet y Opus", placeholder: "sk-ant-...", color: "bg-amber-600" },
    { key: "llm.google_ai_api_key", label: "Google AI", description: "Gemini Pro y Flash", placeholder: "AI...", color: "bg-blue-500" },
    { key: "llm.xai_api_key", label: "xAI", description: "Grok models", placeholder: "xai-...", color: "bg-neutral-700" },
    { key: "llm.deepseek_api_key", label: "DeepSeek", description: "DeepSeek Chat", placeholder: "sk-...", color: "bg-indigo-500" },
];

export default function AIProvidersPage() {
    const t = useTranslations("settings");
    const { user } = useAuth();
    const router = useRouter();
    const isSuperAdmin = user?.role === "super_admin";
    const [values, setValues] = useState<Record<string, string>>({});
    const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // Hard guard: LLM provider keys are platform-wide secrets. Only super_admin
    // can view or edit them. Non-super_admins are redirected to Settings home
    // so they never see the keys (even blurred).
    useEffect(() => {
        if (user && !isSuperAdmin) {
            router.replace("/admin/settings");
        }
    }, [user, isSuperAdmin, router]);

    useEffect(() => {
        if (!isSuperAdmin) return;
        async function load() {
            const result = await api.getApiKeys();
            if (result.success && result.data) {
                setValues(prev => ({ ...prev, ...result.data }));
            }
        }
        load();
    }, [isSuperAdmin]);

    if (!user) return null;
    if (!isSuperAdmin) {
        return (
            <div className="max-w-2xl">
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-8 text-center">
                    <Lock size={32} className="mx-auto text-neutral-400 mb-3" />
                    <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                        {t("superAdminOnly.title")}
                    </h2>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        {t("superAdminOnly.description")}
                    </p>
                </div>
            </div>
        );
    }

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.updateSettings(values);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch { /* ignore */ }
        setSaving(false);
    };

    return (
        <div className="max-w-2xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                        {t("pages.aiProviders")}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        {t("pages.aiProvidersDesc")}
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

            <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs text-neutral-600 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-neutral-400">
                <Shield size={14} className="shrink-0 text-indigo-600" />
                {t("security")}
            </div>

            <div className="space-y-4">
                {providers.map(provider => {
                    const value = values[provider.key] || "";
                    const isVisible = showSecrets[provider.key];
                    return (
                        <div
                            key={provider.key}
                            className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center text-white text-xs font-semibold", provider.color)}>
                                    {provider.label.charAt(0)}
                                </div>
                                <div>
                                    <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{provider.label}</div>
                                    <div className="text-xs text-neutral-500 dark:text-neutral-400">{provider.description}</div>
                                </div>
                                {value && !value.includes("•") && (
                                    <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                                        Configurada
                                    </span>
                                )}
                            </div>
                            <div className="relative">
                                <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                                <Input
                                    type={isVisible ? "text" : "password"}
                                    value={value}
                                    onChange={e => {
                                        setValues(prev => ({ ...prev, [provider.key]: e.target.value }));
                                        setSaved(false);
                                    }}
                                    placeholder={provider.placeholder}
                                    className="h-9 pl-9 pr-10 rounded-lg border-neutral-200 bg-neutral-50 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-800"
                                />
                                <button
                                    onClick={() => setShowSecrets(prev => ({ ...prev, [provider.key]: !prev[provider.key] }))}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 border-none bg-transparent p-1 text-neutral-400 hover:text-neutral-600"
                                >
                                    {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
