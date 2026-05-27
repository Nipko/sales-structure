"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
    Mail,
    CheckCircle,
    AlertCircle,
    Loader2,
    ChevronDown,
    ChevronUp,
    Server,
    Key,
    Info,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Provider = "SMTP" | "SendGrid";
type SmtpEncryption = "TLS" | "SSL" | "None";

interface SmtpConfig {
    host: string;
    port: string;
    username: string;
    password: string;
    encryption: SmtpEncryption;
}

interface SendGridConfig {
    apiKey: string;
}

interface EmailChannelConfig {
    id?: string;
    tenantId?: string;
    provider: Provider;
    fromEmail: string;
    fromName: string;
    replyTo: string;
    inboundType: string;
    providerConfig: SmtpConfig | SendGridConfig;
    isActive: boolean;
}

const DEFAULT_SMTP: SmtpConfig = {
    host: "",
    port: "587",
    username: "",
    password: "",
    encryption: "TLS",
};

const DEFAULT_SENDGRID: SendGridConfig = {
    apiKey: "",
};

const DEFAULT_CONFIG: EmailChannelConfig = {
    provider: "SMTP",
    fromEmail: "",
    fromName: "",
    replyTo: "",
    inboundType: "sendgrid_inbound_parse",
    providerConfig: { ...DEFAULT_SMTP },
    isActive: false,
};

export default function EmailChannelPage() {
    const { activeTenantId } = useTenant();
    const { user } = useAuth();
    const t = useTranslations("emailChannel");

    const [config, setConfig] = useState<EmailChannelConfig>({ ...DEFAULT_CONFIG });
    const [hasExisting, setHasExisting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [providerOpen, setProviderOpen] = useState(false);
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

    // ── Load existing config ──────────────────────────────
    useEffect(() => {
        if (!activeTenantId) return;
        (async () => {
            setLoading(true);
            try {
                const res = await api.fetch(`/channels/email/config/${activeTenantId}`);
                const data = res?.data || res;
                if (data && data.fromEmail) {
                    setConfig({
                        id: data.id,
                        tenantId: data.tenantId,
                        provider: data.provider || "SMTP",
                        fromEmail: data.fromEmail || "",
                        fromName: data.fromName || "",
                        replyTo: data.replyTo || "",
                        inboundType: data.inboundType || "sendgrid_inbound_parse",
                        providerConfig: data.providerConfig || { ...DEFAULT_SMTP },
                        isActive: data.isActive ?? false,
                    });
                    setHasExisting(true);
                    setProviderOpen(false);
                }
            } catch {
                // No config found — stay with defaults
            }
            setLoading(false);
        })();
    }, [activeTenantId]);

    // ── Toast auto-dismiss ────────────────────────────────
    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(timer);
    }, [toast]);

    // ── Handlers ──────────────────────────────────────────
    const handleProviderChange = (provider: Provider) => {
        setConfig((prev) => ({
            ...prev,
            provider,
            providerConfig: provider === "SMTP" ? { ...DEFAULT_SMTP } : { ...DEFAULT_SENDGRID },
        }));
        setProviderOpen(true);
    };

    const updateProviderConfig = (key: string, value: string) => {
        setConfig((prev) => ({
            ...prev,
            providerConfig: { ...prev.providerConfig, [key]: value },
        }));
    };

    const handleSave = async () => {
        if (!activeTenantId) return;
        setSaving(true);
        try {
            const payload = {
                provider: config.provider,
                fromEmail: config.fromEmail,
                fromName: config.fromName,
                replyTo: config.replyTo || null,
                inboundType: config.inboundType,
                providerConfig: config.providerConfig,
                isActive: config.isActive,
            };
            const res = await api.fetch(`/channels/email/config/${activeTenantId}`, {
                method: "PUT",
                body: JSON.stringify(payload),
            });
            const data = res?.data || res;
            if (data?.id) {
                setConfig((prev) => ({ ...prev, id: data.id, tenantId: data.tenantId }));
                setHasExisting(true);
            }
            setToast({ type: "success", message: t("toast.saved") });
        } catch {
            setToast({ type: "error", message: t("toast.error") });
        }
        setSaving(false);
    };

    // ── Loading state ─────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Loader2 size={24} className="animate-spin text-[var(--text-secondary)]" />
            </div>
        );
    }

    const isConnected = hasExisting && config.isActive;
    const smtpConfig = config.providerConfig as SmtpConfig;
    const sendGridConfig = config.providerConfig as SendGridConfig;

    return (
        <div className="mx-auto max-w-[720px] mt-4">
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={Mail}
                iconColor="bg-blue-500/10"
            />

            {/* ── Toast ─────────────────────────────────────── */}
            {toast && (
                <div
                    className={cn(
                        "fixed top-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border shadow-lg transition-all animate-in fade-in slide-in-from-top-2",
                        toast.type === "success"
                            ? "bg-[rgba(0,214,143,0.1)] text-[var(--success)] border-[rgba(0,214,143,0.2)]"
                            : "bg-[rgba(255,71,87,0.1)] text-[var(--danger)] border-[rgba(255,71,87,0.2)]"
                    )}
                >
                    {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {toast.message}
                </div>
            )}

            {/* ── Connection Status ─────────────────────────── */}
            <div className="mb-5">
                {isConnected ? (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[rgba(0,214,143,0.1)] text-[var(--success)] border border-[rgba(0,214,143,0.2)]">
                        <CheckCircle size={12} />
                        {t("status.connected")}
                    </div>
                ) : (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-border">
                        <AlertCircle size={12} />
                        {t("status.notConfigured")}
                    </div>
                )}
            </div>

            {/* ── Help text ─────────────────────────────────── */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 mb-6">
                <Info size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-[13px] text-[var(--text-secondary)] m-0 leading-relaxed">
                    {t("helpText")}
                </p>
            </div>

            {/* ── Sender Settings ───────────────────────────── */}
            <div className="bg-card border border-border rounded-[14px] p-5 mb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                    {t("form.senderSettings") || "Sender"}
                </p>

                {/* From Email */}
                <div className="mb-4">
                    <label className="text-[13px] font-semibold mb-1.5 block text-foreground">
                        {t("form.fromEmail")} <span className="text-[var(--danger)]">*</span>
                    </label>
                    <input
                        type="email"
                        required
                        value={config.fromEmail}
                        onChange={(e) => setConfig((p) => ({ ...p, fromEmail: e.target.value }))}
                        placeholder="noreply@yourdomain.com"
                        className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none focus:border-blue-500 transition-colors"
                    />
                </div>

                {/* From Name */}
                <div className="mb-4">
                    <label className="text-[13px] font-semibold mb-1.5 block text-foreground">
                        {t("form.fromName")}
                    </label>
                    <input
                        type="text"
                        value={config.fromName}
                        onChange={(e) => setConfig((p) => ({ ...p, fromName: e.target.value }))}
                        placeholder="Parallly Support"
                        className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none focus:border-blue-500 transition-colors"
                    />
                </div>

                {/* Reply-To */}
                <div>
                    <label className="text-[13px] font-semibold mb-1.5 block text-foreground">
                        {t("form.replyTo")}
                    </label>
                    <input
                        type="email"
                        value={config.replyTo}
                        onChange={(e) => setConfig((p) => ({ ...p, replyTo: e.target.value }))}
                        placeholder="support@yourdomain.com"
                        className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none focus:border-blue-500 transition-colors"
                    />
                </div>
            </div>

            {/* ── Provider ──────────────────────────────────── */}
            <div className="bg-card border border-border rounded-[14px] p-5 mb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                    {t("form.provider")}
                </p>

                <div className="flex gap-3 mb-4">
                    <button
                        type="button"
                        onClick={() => handleProviderChange("SMTP")}
                        className={cn(
                            "flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-semibold cursor-pointer transition-all",
                            config.provider === "SMTP"
                                ? "border-blue-500 bg-blue-500/10 text-blue-400"
                                : "border-border bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                        )}
                    >
                        <Server size={16} />
                        {t("form.providerSmtp")}
                    </button>
                    <button
                        type="button"
                        onClick={() => handleProviderChange("SendGrid")}
                        className={cn(
                            "flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-semibold cursor-pointer transition-all",
                            config.provider === "SendGrid"
                                ? "border-blue-500 bg-blue-500/10 text-blue-400"
                                : "border-border bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                        )}
                    >
                        <Key size={16} />
                        {t("form.providerSendgrid")}
                    </button>
                </div>

                {/* Collapsible provider config */}
                <button
                    type="button"
                    onClick={() => setProviderOpen((o) => !o)}
                    className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-secondary)] cursor-pointer bg-transparent border-none p-0 mb-2 hover:text-foreground transition-colors"
                >
                    {providerOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {config.provider === "SMTP" ? t("form.providerSmtp") : t("form.providerSendgrid")} — {t("form.providerConfig") || "Configuration"}
                </button>

                {providerOpen && (
                    <div className="mt-3 space-y-4 pl-0">
                        {config.provider === "SMTP" ? (
                            <>
                                {/* SMTP Host */}
                                <div>
                                    <label className="text-[13px] font-semibold mb-1.5 block text-foreground">
                                        {t("form.smtpHost")}
                                    </label>
                                    <input
                                        type="text"
                                        value={smtpConfig.host || ""}
                                        onChange={(e) => updateProviderConfig("host", e.target.value)}
                                        placeholder="smtp.gmail.com"
                                        className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>

                                {/* SMTP Port */}
                                <div>
                                    <label className="text-[13px] font-semibold mb-1.5 block text-foreground">
                                        {t("form.smtpPort")}
                                    </label>
                                    <input
                                        type="text"
                                        value={smtpConfig.port || ""}
                                        onChange={(e) => updateProviderConfig("port", e.target.value)}
                                        placeholder="587"
                                        className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>

                                {/* SMTP Username */}
                                <div>
                                    <label className="text-[13px] font-semibold mb-1.5 block text-foreground">
                                        {t("form.smtpUser")}
                                    </label>
                                    <input
                                        type="text"
                                        value={smtpConfig.username || ""}
                                        onChange={(e) => updateProviderConfig("username", e.target.value)}
                                        placeholder="user@gmail.com"
                                        className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>

                                {/* SMTP Password */}
                                <div>
                                    <label className="text-[13px] font-semibold mb-1.5 block text-foreground">
                                        {t("form.smtpPass")}
                                    </label>
                                    <input
                                        type="password"
                                        value={smtpConfig.password || ""}
                                        onChange={(e) => updateProviderConfig("password", e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>

                                {/* SMTP Encryption */}
                                <div>
                                    <label className="text-[13px] font-semibold mb-1.5 block text-foreground">
                                        {t("form.smtpEncryption")}
                                    </label>
                                    <div className="flex gap-2">
                                        {(["TLS", "SSL", "None"] as SmtpEncryption[]).map((enc) => (
                                            <button
                                                key={enc}
                                                type="button"
                                                onClick={() => updateProviderConfig("encryption", enc)}
                                                className={cn(
                                                    "px-4 py-2 rounded-lg border text-sm font-medium cursor-pointer transition-all",
                                                    smtpConfig.encryption === enc
                                                        ? "border-blue-500 bg-blue-500/10 text-blue-400"
                                                        : "border-border bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                                                )}
                                            >
                                                {enc}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </>
                        ) : (
                            /* SendGrid API Key */
                            <div>
                                <label className="text-[13px] font-semibold mb-1.5 block text-foreground">
                                    {t("form.sendgridApiKey")}
                                </label>
                                <input
                                    type="password"
                                    value={sendGridConfig.apiKey || ""}
                                    onChange={(e) => updateProviderConfig("apiKey", e.target.value)}
                                    placeholder="SG.xxxxxxxxxxxx..."
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm font-mono outline-none focus:border-blue-500 transition-colors"
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Inbound ───────────────────────────────────── */}
            <div className="bg-card border border-border rounded-[14px] p-5 mb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                    {t("form.inboundType")}
                </p>

                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-[var(--bg-tertiary)]">
                    <Mail size={16} className="text-[var(--text-secondary)] flex-shrink-0" />
                    <div>
                        <p className="text-sm font-medium text-foreground m-0">
                            SendGrid Inbound Parse
                        </p>
                        <p className="text-[12px] text-[var(--text-secondary)] m-0 mt-0.5 leading-relaxed">
                            {t("form.inboundHint")}
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Active Toggle ──────────────────────────────── */}
            <div className="bg-card border border-border rounded-[14px] p-5 mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold text-foreground m-0">
                            {t("form.active")}
                        </p>
                        <p className="text-[12px] text-[var(--text-secondary)] m-0 mt-0.5">
                            {config.isActive
                                ? t("status.connected")
                                : t("status.notConfigured")}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setConfig((p) => ({ ...p, isActive: !p.isActive }))}
                        className={cn(
                            "relative w-11 h-6 rounded-full cursor-pointer transition-colors border-none",
                            config.isActive
                                ? "bg-[var(--success)]"
                                : "bg-[var(--bg-tertiary)] border border-border"
                        )}
                    >
                        <span
                            className={cn(
                                "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
                                config.isActive && "translate-x-5"
                            )}
                        />
                    </button>
                </div>
            </div>

            {/* ── Save Button ────────────────────────────────── */}
            <button
                onClick={handleSave}
                disabled={saving || !config.fromEmail}
                className={cn(
                    "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold cursor-pointer transition-all bg-blue-600 hover:bg-blue-700",
                    (saving || !config.fromEmail) && "opacity-50 cursor-not-allowed"
                )}
            >
                {saving ? (
                    <>
                        <Loader2 size={16} className="animate-spin" />
                        {t("saving") || "Saving..."}
                    </>
                ) : (
                    t("save")
                )}
            </button>
        </div>
    );
}
