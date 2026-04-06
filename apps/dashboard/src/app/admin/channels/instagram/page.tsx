"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import {
    Instagram,
    Shield,
    CheckCircle,
    AlertCircle,
    Copy,
    Link as LinkIcon,
    User,
} from "lucide-react";

// ---- Styles ----
const card = {
    background: "var(--bg-secondary, #12121e)",
    border: "1px solid var(--border, #2a2a45)",
    borderRadius: 16,
    overflow: "hidden" as const,
};
const cardHeader = {
    padding: "20px 24px",
    borderBottom: "1px solid var(--border, #2a2a45)",
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 10,
};
const cardBody = { padding: 24 };
const input = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid var(--border, #2a2a45)",
    background: "var(--bg-tertiary, #0a0a12)",
    color: "var(--text-primary, #e8e8f0)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box" as const,
};
const mono = {
    background: "var(--bg-tertiary, #0a0a12)",
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--border, #2a2a45)",
    fontFamily: "monospace",
    fontSize: 12,
    color: "var(--accent, #6c5ce7)",
    wordBreak: "break-all" as const,
    position: "relative" as const,
    cursor: "pointer" as const,
};

const BRAND_COLOR = "#E4405F";

export default function InstagramSetupPage() {
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
            setMessage({ type: "error", text: err.message || "Error al conectar Instagram." });
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
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-secondary, #9898b0)" }}>
                Cargando estado de Instagram...
            </div>
        );
    }

    const isConnected = status?.status === "connected";

    return (
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                            background: BRAND_COLOR,
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}>
                            <Instagram size={20} color="white" />
                        </div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "var(--text-primary, #e8e8f0)" }}>
                            Instagram DM
                        </h1>
                    </div>
                    <p style={{ color: "var(--text-secondary, #9898b0)", margin: "4px 0 0" }}>
                        Conecta tu cuenta de Instagram Business para recibir y responder mensajes directos.
                    </p>
                </div>
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px",
                    background: isConnected ? "rgba(0, 214, 143, 0.1)" : "rgba(255, 71, 87, 0.1)",
                    color: isConnected ? "var(--success, #00d68f)" : "var(--danger, #ff4757)",
                    borderRadius: 20,
                    border: `1px solid ${isConnected ? "rgba(0, 214, 143, 0.2)" : "rgba(255, 71, 87, 0.2)"}`,
                    fontSize: 13,
                    fontWeight: 600,
                }}>
                    {isConnected ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {isConnected ? "Conectado" : "Desconectado"}
                </div>
            </div>

            {/* Alert Message */}
            {message.text && (
                <div style={{
                    padding: 16,
                    borderRadius: 12,
                    marginBottom: 24,
                    fontSize: 14,
                    background: message.type === "error" ? "rgba(255, 71, 87, 0.1)" : "rgba(0, 214, 143, 0.1)",
                    color: message.type === "error" ? "var(--danger, #ff4757)" : "var(--success, #00d68f)",
                    border: `1px solid ${message.type === "error" ? "rgba(255, 71, 87, 0.2)" : "rgba(0, 214, 143, 0.2)"}`,
                }}>
                    {message.text}
                </div>
            )}

            {/* Webhook Config Card */}
            <div style={{ ...card, marginBottom: 24 }}>
                <div style={cardHeader}>
                    <Shield size={18} color="#e67e22" />
                    <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--text-primary, #e8e8f0)" }}>
                        Configuracion del Webhook
                    </h2>
                    <span style={{ fontSize: 12, color: "var(--text-secondary, #9898b0)", marginLeft: "auto" }}>
                        Configura estos valores en tu App de Meta Developers
                    </span>
                </div>
                <div style={{ ...cardBody, display: "flex", gap: 24 }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "block", color: "var(--text-primary, #e8e8f0)" }}>
                            Callback URL
                        </label>
                        <div
                            style={mono}
                            onClick={() => config?.webhookUrl && copyToClipboard(config.webhookUrl, "url")}
                            title="Click para copiar"
                        >
                            {config?.webhookUrl || "No disponible — verifica la configuracion del servidor"}
                            {config?.webhookUrl && (
                                <Copy size={14} style={{ position: "absolute", right: 12, top: 14, opacity: 0.5 }} />
                            )}
                        </div>
                        {copied === "url" && <span style={{ fontSize: 11, color: "var(--success, #00d68f)" }}>Copiado</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "block", color: "var(--text-primary, #e8e8f0)" }}>
                            Verify Token
                        </label>
                        <div
                            style={mono}
                            onClick={() => config?.verifyToken && copyToClipboard(config.verifyToken, "token")}
                            title="Click para copiar"
                        >
                            {config?.verifyToken || "No configurado — agrega INSTAGRAM_VERIFY_TOKEN en el servidor"}
                            {config?.verifyToken && (
                                <Copy size={14} style={{ position: "absolute", right: 12, top: 14, opacity: 0.5 }} />
                            )}
                        </div>
                        {copied === "token" && <span style={{ fontSize: 11, color: "var(--success, #00d68f)" }}>Copiado</span>}
                    </div>
                </div>
            </div>

            {/* Connection / Connected State */}
            {!isConnected ? (
                <div style={{ ...card, marginBottom: 24 }}>
                    <div style={cardHeader}>
                        <LinkIcon size={18} color={BRAND_COLOR} />
                        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--text-primary, #e8e8f0)" }}>
                            Conectar Instagram
                        </h2>
                    </div>
                    <div style={cardBody}>
                        <form onSubmit={handleConnect} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            <div>
                                <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block", color: "var(--text-primary, #e8e8f0)" }}>
                                    Instagram Business Account ID
                                </label>
                                <span style={{ fontSize: 11, color: "var(--text-secondary, #9898b0)", display: "block", marginBottom: 6 }}>
                                    El ID de tu cuenta de Instagram Business vinculada a tu pagina de Facebook
                                </span>
                                <input
                                    type="text"
                                    value={accountId}
                                    onChange={(e) => setAccountId(e.target.value)}
                                    placeholder="Ej: 17841400123456789"
                                    required
                                    style={input}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block", color: "var(--text-primary, #e8e8f0)" }}>
                                    Facebook Page ID
                                </label>
                                <span style={{ fontSize: 11, color: "var(--text-secondary, #9898b0)", display: "block", marginBottom: 6 }}>
                                    La pagina de Facebook conectada a tu cuenta de Instagram Business
                                </span>
                                <input
                                    type="text"
                                    value={pageId}
                                    onChange={(e) => setPageId(e.target.value)}
                                    placeholder="Ej: 101234567890123"
                                    style={input}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block", color: "var(--text-primary, #e8e8f0)" }}>
                                    Page Access Token
                                </label>
                                <span style={{ fontSize: 11, color: "var(--text-secondary, #9898b0)", display: "block", marginBottom: 6 }}>
                                    Token de acceso de la pagina con permisos de instagram_manage_messages. Nunca se almacena en texto plano.
                                </span>
                                <input
                                    type="password"
                                    value={accessToken}
                                    onChange={(e) => setAccessToken(e.target.value)}
                                    placeholder="EAAG..."
                                    required
                                    style={{ ...input, fontFamily: "monospace" }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "block", color: "var(--text-primary, #e8e8f0)" }}>
                                    Nombre para mostrar
                                </label>
                                <span style={{ fontSize: 11, color: "var(--text-secondary, #9898b0)", display: "block", marginBottom: 6 }}>
                                    Nombre amigable para identificar este canal en el dashboard
                                </span>
                                <input
                                    type="text"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder="Ej: @mi_negocio"
                                    style={input}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={saving}
                                style={{
                                    marginTop: 8,
                                    padding: "12px",
                                    borderRadius: 10,
                                    border: "none",
                                    background: BRAND_COLOR,
                                    color: "white",
                                    fontWeight: 600,
                                    fontSize: 14,
                                    cursor: "pointer",
                                    opacity: saving ? 0.7 : 1,
                                }}
                            >
                                {saving ? "Conectando..." : "Conectar"}
                            </button>
                        </form>
                    </div>
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
                    {/* Account Info */}
                    <div style={card}>
                        <div style={cardHeader}>
                            <User size={18} color={BRAND_COLOR} />
                            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--text-primary, #e8e8f0)" }}>
                                Cuenta Conectada
                            </h2>
                        </div>
                        <div style={cardBody}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                <div>
                                    <span style={{ fontSize: 12, color: "var(--text-secondary, #9898b0)" }}>Nombre</span>
                                    <p style={{ fontSize: 16, fontWeight: 600, margin: "4px 0 0", color: "var(--text-primary, #e8e8f0)" }}>
                                        {status?.channel?.display_name || displayName || "—"}
                                    </p>
                                </div>
                                <div>
                                    <span style={{ fontSize: 12, color: "var(--text-secondary, #9898b0)" }}>Account ID</span>
                                    <p style={{ fontSize: 12, fontFamily: "monospace", margin: "4px 0 0", color: "var(--text-secondary, #9898b0)" }}>
                                        {status?.channel?.account_id || accountId || "—"}
                                    </p>
                                </div>
                                {(status?.channel?.metadata?.pageId || pageId) && (
                                    <div>
                                        <span style={{ fontSize: 12, color: "var(--text-secondary, #9898b0)" }}>Facebook Page ID</span>
                                        <p style={{ fontSize: 12, fontFamily: "monospace", margin: "4px 0 0", color: "var(--text-secondary, #9898b0)" }}>
                                            {status?.channel?.metadata?.pageId || pageId || "—"}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Update Token */}
                    <div style={card}>
                        <div style={cardHeader}>
                            <LinkIcon size={18} color="var(--accent, #6c5ce7)" />
                            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--text-primary, #e8e8f0)" }}>
                                Actualizar Token
                            </h2>
                        </div>
                        <div style={cardBody}>
                            <form onSubmit={handleConnect} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                <div>
                                    <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block", color: "var(--text-primary, #e8e8f0)" }}>
                                        Page Access Token
                                    </label>
                                    <input
                                        type="password"
                                        value={accessToken}
                                        onChange={(e) => setAccessToken(e.target.value)}
                                        placeholder="Solo si necesitas actualizar"
                                        style={{ ...input, fontFamily: "monospace" }}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block", color: "var(--text-primary, #e8e8f0)" }}>
                                        Nombre para mostrar
                                    </label>
                                    <input
                                        type="text"
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        placeholder="Nombre del canal"
                                        style={input}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    style={{
                                        padding: "10px",
                                        borderRadius: 10,
                                        border: "1px solid var(--border, #2a2a45)",
                                        background: "var(--bg-tertiary, #0a0a12)",
                                        color: "var(--text-primary, #e8e8f0)",
                                        fontWeight: 600,
                                        fontSize: 13,
                                        cursor: "pointer",
                                        opacity: saving ? 0.7 : 1,
                                    }}
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
