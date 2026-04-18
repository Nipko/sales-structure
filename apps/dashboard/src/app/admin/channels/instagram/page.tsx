"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import {
    Instagram,
    Shield,
    CheckCircle,
    AlertCircle,
    Copy,
    Link as LinkIcon,
    User,
} from "lucide-react";

const BRAND_COLOR = "#E4405F";

export default function InstagramSetupPage() {
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [status, setStatus] = useState<any>(null);
    const [config, setConfig] = useState<{ webhookUrl?: string; verifyToken?: string } | null>(null);

    const [accountId, setAccountId] = useState("");
    const [pageId, setPageId] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [displayName, setDisplayName] = useState("");

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [copied, setCopied] = useState("");
    const [message, setMessage] = useState({ type: "", text: "" });

    const loadData = async () => {
        setLoading(true);
        try {
            const statusRes = await api.fetch("/channels/instagram/status");
            setStatus(statusRes);
            if (statusRes?.channel) {
                setAccountId(statusRes.channel.account_id || "");
                setDisplayName(statusRes.channel.display_name || "");
                setPageId(statusRes.channel.metadata?.pageId || "");
            }
        } catch (e) {
            console.error("Failed to load Instagram status", e);
        }
        try {
            const configRes = await api.fetch("/channels/instagram/config");
            if (configRes?.webhookUrl || configRes?.data?.webhookUrl) {
                setConfig(configRes.data || configRes);
            }
        } catch (e) {
            console.error("Failed to load Instagram config", e);
        }
        setLoading(false);
    };

    useEffect(() => { loadData(); }, [activeTenantId]);

    const handleConnect = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage({ type: "", text: "" });
        try {
            await api.fetch("/channels/instagram/connect", {
                method: "POST",
                body: JSON.stringify({
                    accountId,
                    accessToken,
                    displayName: displayName || undefined,
                    metadata: { pageId: pageId || undefined },
                }),
            });
            setMessage({ type: "success", text: "Canal de Instagram conectado correctamente." });
            setAccessToken("");
            await loadData();
        } catch (err: any) {
            setMessage({ type: "error", text: err.message || tc("connectionError") });
        } finally {
            setSaving(false);
        }
    };

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        setCopied(label);
        setTimeout(() => setCopied(""), 2000);
    };

    if (loading) {
        return (
            <div className="p-8 text-center text-[var(--text-secondary)]">
                Cargando estado de Instagram...
            </div>
        );
    }

    const isConnected = status?.status === "connected";

    return (
        <div className="mx-auto max-w-[960px]">
            {/* Header */}
            <div className="flex justify-between items-center mb-8">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div
                            className="w-10 h-10 rounded-[10px] flex items-center justify-center"
                            style={{ background: BRAND_COLOR }}
                        >
                            <Instagram size={20} className="text-white" />
                        </div>
                        <h1 className="text-[28px] font-semibold m-0 text-foreground">
                            Instagram DM
                        </h1>
                    </div>
                    <p className="text-[var(--text-secondary)] mt-1">
                        Conecta tu cuenta de Instagram Business para recibir y responder mensajes directos.
                    </p>
                </div>
                <div
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold border",
                        isConnected
                            ? "bg-[rgba(0,214,143,0.1)] text-[var(--success)] border-[rgba(0,214,143,0.2)]"
                            : "bg-[rgba(255,71,87,0.1)] text-[var(--danger)] border-[rgba(255,71,87,0.2)]"
                    )}
                >
                    {isConnected ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {isConnected ? "Conectado" : "Desconectado"}
                </div>
            </div>

            {/* Alert Message */}
            {message.text && (
                <div
                    className={cn(
                        "p-4 rounded-xl mb-6 text-sm border",
                        message.type === "error"
                            ? "bg-[rgba(255,71,87,0.1)] text-[var(--danger)] border-[rgba(255,71,87,0.2)]"
                            : "bg-[rgba(0,214,143,0.1)] text-[var(--success)] border-[rgba(0,214,143,0.2)]"
                    )}
                >
                    {message.text}
                </div>
            )}

            {/* Webhook Config Card */}
            <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                    <Shield size={18} className="text-[#e67e22]" />
                    <h2 className="text-base font-semibold m-0 text-foreground">
                        Configuracion del Webhook
                    </h2>
                    <span className="text-xs text-[var(--text-secondary)] ml-auto">
                        Configura estos valores en tu App de Meta Developers
                    </span>
                </div>
                <div className="p-6 flex gap-6">
                    <div className="flex-1">
                        <label className="text-[13px] font-semibold mb-2 block text-foreground">
                            Callback URL
                        </label>
                        <div
                            className="relative bg-[var(--bg-tertiary)] p-3 px-4 rounded-lg border border-border font-mono text-xs text-primary break-all cursor-pointer"
                            onClick={() => config?.webhookUrl && copyToClipboard(config.webhookUrl, "url")}
                            title="Click para copiar"
                        >
                            {config?.webhookUrl || "No disponible — verifica la configuracion del servidor"}
                            {config?.webhookUrl && (
                                <Copy size={14} className="absolute right-3 top-3.5 opacity-50" />
                            )}
                        </div>
                        {copied === "url" && <span className="text-[11px] text-[var(--success)]">Copiado</span>}
                    </div>
                    <div className="flex-1">
                        <label className="text-[13px] font-semibold mb-2 block text-foreground">
                            Verify Token
                        </label>
                        <div
                            className="relative bg-[var(--bg-tertiary)] p-3 px-4 rounded-lg border border-border font-mono text-xs text-primary break-all cursor-pointer"
                            onClick={() => config?.verifyToken && copyToClipboard(config.verifyToken, "token")}
                            title="Click para copiar"
                        >
                            {config?.verifyToken || "No configurado — agrega INSTAGRAM_VERIFY_TOKEN en el servidor"}
                            {config?.verifyToken && (
                                <Copy size={14} className="absolute right-3 top-3.5 opacity-50" />
                            )}
                        </div>
                        {copied === "token" && <span className="text-[11px] text-[var(--success)]">Copiado</span>}
                    </div>
                </div>
            </div>

            {/* Connection / Connected State */}
            {!isConnected ? (
                <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                    <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                        <LinkIcon size={18} style={{ color: BRAND_COLOR }} />
                        <h2 className="text-base font-semibold m-0 text-foreground">
                            Conectar Instagram
                        </h2>
                    </div>
                    <div className="p-6">
                        <form onSubmit={handleConnect} className="flex flex-col gap-4">
                            <div>
                                <label className="text-[13px] font-semibold mb-1 block text-foreground">
                                    Instagram Business Account ID
                                </label>
                                <span className="text-[11px] text-[var(--text-secondary)] block mb-1.5">
                                    El ID de tu cuenta de Instagram Business vinculada a tu pagina de Facebook
                                </span>
                                <input
                                    type="text"
                                    value={accountId}
                                    onChange={(e) => setAccountId(e.target.value)}
                                    placeholder="Ej: 17841400123456789"
                                    required
                                    className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-[13px] font-semibold mb-1 block text-foreground">
                                    Facebook Page ID
                                </label>
                                <span className="text-[11px] text-[var(--text-secondary)] block mb-1.5">
                                    La pagina de Facebook conectada a tu cuenta de Instagram Business
                                </span>
                                <input
                                    type="text"
                                    value={pageId}
                                    onChange={(e) => setPageId(e.target.value)}
                                    placeholder="Ej: 101234567890123"
                                    className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-[13px] font-semibold mb-1 block text-foreground">
                                    Page Access Token
                                </label>
                                <span className="text-[11px] text-[var(--text-secondary)] block mb-1.5">
                                    Token de acceso de la pagina con permisos de instagram_manage_messages. Nunca se almacena en texto plano.
                                </span>
                                <input
                                    type="password"
                                    value={accessToken}
                                    onChange={(e) => setAccessToken(e.target.value)}
                                    placeholder="EAAG..."
                                    required
                                    className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm font-mono outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-[13px] font-semibold mb-1 block text-foreground">
                                    Nombre para mostrar
                                </label>
                                <span className="text-[11px] text-[var(--text-secondary)] block mb-1.5">
                                    Nombre amigable para identificar este canal en el dashboard
                                </span>
                                <input
                                    type="text"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder="Ej: @mi_negocio"
                                    className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm outline-none"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={saving}
                                className={cn(
                                    "mt-2 py-3 rounded-[10px] border-none text-white font-semibold text-sm cursor-pointer",
                                    saving && "opacity-70"
                                )}
                                style={{ background: BRAND_COLOR }}
                            >
                                {saving ? "Conectando..." : "Conectar"}
                            </button>
                        </form>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-6 mb-6">
                    {/* Account Info */}
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden">
                        <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                            <User size={18} style={{ color: BRAND_COLOR }} />
                            <h2 className="text-base font-semibold m-0 text-foreground">
                                Cuenta Conectada
                            </h2>
                        </div>
                        <div className="p-6">
                            <div className="flex flex-col gap-3.5">
                                <div>
                                    <span className="text-xs text-[var(--text-secondary)]">Nombre</span>
                                    <p className="text-base font-semibold mt-1 mb-0 text-foreground">
                                        {status?.channel?.display_name || displayName || "\u2014"}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-xs text-[var(--text-secondary)]">Account ID</span>
                                    <p className="text-xs font-mono mt-1 mb-0 text-[var(--text-secondary)]">
                                        {status?.channel?.account_id || accountId || "\u2014"}
                                    </p>
                                </div>
                                {(status?.channel?.metadata?.pageId || pageId) && (
                                    <div>
                                        <span className="text-xs text-[var(--text-secondary)]">Facebook Page ID</span>
                                        <p className="text-xs font-mono mt-1 mb-0 text-[var(--text-secondary)]">
                                            {status?.channel?.metadata?.pageId || pageId || "\u2014"}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Update Token */}
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden">
                        <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                            <LinkIcon size={18} className="text-primary" />
                            <h2 className="text-base font-semibold m-0 text-foreground">
                                Actualizar Token
                            </h2>
                        </div>
                        <div className="p-6">
                            <form onSubmit={handleConnect} className="flex flex-col gap-3.5">
                                <div>
                                    <label className="text-[13px] font-semibold mb-1.5 block text-foreground">
                                        Page Access Token
                                    </label>
                                    <input
                                        type="password"
                                        value={accessToken}
                                        onChange={(e) => setAccessToken(e.target.value)}
                                        placeholder="Solo si necesitas actualizar"
                                        className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm font-mono outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-[13px] font-semibold mb-1.5 block text-foreground">
                                        Nombre para mostrar
                                    </label>
                                    <input
                                        type="text"
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        placeholder="Nombre del canal"
                                        className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm outline-none"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className={cn(
                                        "py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground font-semibold text-[13px] cursor-pointer",
                                        saving && "opacity-70"
                                    )}
                                >
                                    {saving ? "Actualizando..." : "Actualizar Token"}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
