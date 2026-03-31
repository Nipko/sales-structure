"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import {
    MessageSquare, Shield, CheckCircle, RefreshCw,
    Link as LinkIcon, Zap, Phone, Copy, ExternalLink,
    AlertCircle, Settings,
} from "lucide-react";
import WhatsAppEmbeddedSignup from "./WhatsAppEmbeddedSignup";

// ---- Styles ----
const card = {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    overflow: "hidden" as const,
};
const cardHeader = {
    padding: "20px 24px",
    borderBottom: "1px solid var(--border)",
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 10,
};
const cardBody = { padding: 24 };
const input = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-tertiary)",
    color: "var(--text-primary)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box" as const,
};
const mono = {
    background: "var(--bg-tertiary)",
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    fontFamily: "monospace",
    fontSize: 12,
    color: "var(--accent)",
    wordBreak: "break-all" as const,
    position: "relative" as const,
    cursor: "pointer" as const,
};

export default function WhatsAppSetupPage() {
    const [status, setStatus] = useState<any>(null);
    const [templates, setTemplates] = useState<any[]>([]);
    const [config, setConfig] = useState<{ webhookUrl?: string; verifyToken?: string } | null>(null);

    const [phoneNumberId, setPhoneNumberId] = useState("");
    const [wabaId, setWabaId] = useState("");
    const [accessToken, setAccessToken] = useState("");

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [showManual, setShowManual] = useState(false);
    const [copied, setCopied] = useState("");
    const [message, setMessage] = useState({ type: "", text: "" });

    const loadData = async () => {
        setLoading(true);

        try {
            const statusRes = await api.fetch("/channels/whatsapp/status");
            setStatus(statusRes);
            if (statusRes?.channel) {
                setPhoneNumberId(statusRes.channel.phone_number_id || statusRes.channel.display_phone_number || "");
                setWabaId(statusRes.channel.meta_waba_id || "");
            }
        } catch (e) { console.error("Failed to load WA status", e); }

        try {
            const tplRes = await api.fetch("/channels/whatsapp/templates");
            setTemplates(tplRes || []);
        } catch (e) { console.error("Failed to load WA templates", e); }

        try {
            const configRes = await api.getWhatsappConfig();
            if (configRes?.data) setConfig(configRes.data);
            else if (configRes?.webhookUrl) setConfig(configRes);
        } catch (e) { console.error("Failed to load WA config", e); }

        setLoading(false);
    };

    useEffect(() => { loadData(); }, []);

    const handleConnect = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage({ type: "", text: "" });
        try {
            await api.fetch("/channels/whatsapp/connect/complete", {
                method: "POST",
                body: JSON.stringify({ phoneNumberId, wabaId, accessToken }),
            });
            setMessage({ type: "success", text: "Canal conectado correctamente." });
            setAccessToken("");
            await loadData();
        } catch (err: any) {
            setMessage({ type: "error", text: err.message || "Error al conectar." });
        } finally {
            setSaving(false);
        }
    };

    const handleSyncTemplates = async () => {
        setSyncing(true);
        try {
            await api.fetch("/channels/whatsapp/templates/sync", { method: "POST" });
            setMessage({ type: "success", text: "Plantillas sincronizadas." });
            await loadData();
        } catch (err: any) {
            setMessage({ type: "error", text: "Error sincronizando plantillas." });
        } finally {
            setSyncing(false);
        }
    };

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        setCopied(label);
        setTimeout(() => setCopied(""), 2000);
    };

    const getTenantId = () => {
        try {
            const token = localStorage.getItem("accessToken");
            if (token) return JSON.parse(atob(token.split(".")[1])).tenantId || "";
        } catch {}
        return "";
    };

    if (loading) {
        return <div className="p-8 text-center text-[var(--text-secondary)]">Cargando estado de WhatsApp...</div>;
    }

    const isConnected = status?.status === "connected";

    return (
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
            {/* ======== HEADER ======== */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ background: "#25D366", width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <MessageSquare size={20} color="white" />
                        </div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>WhatsApp Business</h1>
                    </div>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                        Conecta y gestiona tu cuenta de WhatsApp Business con Meta Cloud API.
                    </p>
                </div>
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
                    background: isConnected ? "rgba(46, 204, 113, 0.1)" : "rgba(231, 76, 60, 0.1)",
                    color: isConnected ? "#2ecc71" : "#e74c3c",
                    borderRadius: 20,
                    border: `1px solid ${isConnected ? "rgba(46, 204, 113, 0.2)" : "rgba(231, 76, 60, 0.2)"}`,
                    fontSize: 13, fontWeight: 600,
                }}>
                    {isConnected ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {isConnected ? "Conectado" : "Desconectado"}
                </div>
            </div>

            {/* Alert Message */}
            {message.text && (
                <div style={{
                    padding: 16, borderRadius: 12, marginBottom: 24, fontSize: 14,
                    background: message.type === "error" ? "rgba(231, 76, 60, 0.1)" : "rgba(46, 204, 113, 0.1)",
                    color: message.type === "error" ? "#e74c3c" : "#2ecc71",
                    border: `1px solid ${message.type === "error" ? "rgba(231, 76, 60, 0.2)" : "rgba(46, 204, 113, 0.2)"}`,
                }}>
                    {message.text}
                </div>
            )}

            {/* ======== SECTION 1: WEBHOOK CONFIG (always visible) ======== */}
            <div style={{ ...card, marginBottom: 24 }}>
                <div style={cardHeader}>
                    <Shield size={18} color="#e67e22" />
                    <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Configuracion del Webhook</h2>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)", marginLeft: "auto" }}>
                        Configura estos valores en tu App de Meta Developers
                    </span>
                </div>
                <div style={{ ...cardBody, display: "flex", gap: 24 }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "block" }}>Callback URL</label>
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
                        {copied === "url" && <span style={{ fontSize: 11, color: "#2ecc71" }}>Copiado</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "block" }}>Verify Token</label>
                        <div
                            style={mono}
                            onClick={() => config?.verifyToken && copyToClipboard(config.verifyToken, "token")}
                            title="Click para copiar"
                        >
                            {config?.verifyToken || "No configurado — agrega WHATSAPP_VERIFY_TOKEN en el servidor"}
                            {config?.verifyToken && (
                                <Copy size={14} style={{ position: "absolute", right: 12, top: 14, opacity: 0.5 }} />
                            )}
                        </div>
                        {copied === "token" && <span style={{ fontSize: 11, color: "#2ecc71" }}>Copiado</span>}
                    </div>
                </div>
            </div>

            {/* ======== SECTION 2: CONNECTION ======== */}
            {!isConnected ? (
                <>
                    {/* Embedded Signup (primary) */}
                    <div style={{
                        background: "linear-gradient(135deg, rgba(37, 211, 102, 0.05), rgba(18, 140, 126, 0.08))",
                        border: "1px solid rgba(37, 211, 102, 0.15)",
                        borderRadius: 16, padding: 28, marginBottom: 16,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                            <div style={{ background: "#25D366", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Zap size={16} color="white" />
                            </div>
                            <div>
                                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Conexion Rapida — Embedded Signup</h2>
                                <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "2px 0 0" }}>
                                    Conecta tu cuenta de WhatsApp Business con un solo clic
                                </p>
                            </div>
                        </div>
                        <WhatsAppEmbeddedSignup
                            tenantId={getTenantId()}
                            onSuccess={(result) => {
                                setMessage({ type: "success", text: `Canal conectado. Numero: ${result.displayPhoneNumber || "N/A"}` });
                                loadData();
                            }}
                            onError={(error) => setMessage({ type: "error", text: error })}
                        />
                    </div>

                    {/* Toggle manual connection */}
                    <div style={{ textAlign: "center", marginBottom: 24 }}>
                        <button
                            onClick={() => setShowManual(!showManual)}
                            style={{
                                background: "none", border: "none", color: "var(--text-secondary)",
                                fontSize: 13, cursor: "pointer", textDecoration: "underline",
                            }}
                        >
                            {showManual ? "Ocultar conexion manual" : "O conectar manualmente con credenciales de Meta"}
                        </button>
                    </div>

                    {/* Manual connection form */}
                    {showManual && (
                        <div style={{ ...card, marginBottom: 24 }}>
                            <div style={cardHeader}>
                                <Settings size={18} color="var(--accent)" />
                                <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Conexion Manual</h2>
                            </div>
                            <div style={cardBody}>
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>
                                    Obtiene estos datos de <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                                    developers.facebook.com <ExternalLink size={12} style={{ display: "inline" }} /></a> → tu app → WhatsApp → API Setup
                                </p>
                                <form onSubmit={handleConnect} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                    <div>
                                        <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Phone Number ID</label>
                                        <input type="text" value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} placeholder="Ej: 104561234908123" required style={input} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>WhatsApp Business Account ID (WABA)</label>
                                        <input type="text" value={wabaId} onChange={e => setWabaId(e.target.value)} placeholder="Ej: 1120019283746" required style={input} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Access Token (System User o permanente)</label>
                                        <input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="EAAG..." required style={{ ...input, fontFamily: "monospace" }} />
                                    </div>
                                    <button type="submit" disabled={saving} style={{
                                        marginTop: 8, padding: "12px", borderRadius: 10, border: "none",
                                        background: "#25D366", color: "white", fontWeight: 600, fontSize: 14,
                                        cursor: "pointer", opacity: saving ? 0.7 : 1,
                                    }}>
                                        {saving ? "Conectando..." : "Conectar WABA"}
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                /* ======== CONNECTED STATE ======== */
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
                    {/* Channel Info */}
                    <div style={card}>
                        <div style={cardHeader}>
                            <Phone size={18} color="#25D366" />
                            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Canal Activo</h2>
                        </div>
                        <div style={cardBody}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                <div>
                                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Numero</span>
                                    <p style={{ fontSize: 16, fontWeight: 600, margin: "4px 0 0" }}>
                                        {status?.channel?.display_phone_number || phoneNumberId || "—"}
                                    </p>
                                </div>
                                <div>
                                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Nombre verificado</span>
                                    <p style={{ fontSize: 14, margin: "4px 0 0" }}>
                                        {status?.channel?.display_name || status?.channel?.verified_name || "—"}
                                    </p>
                                </div>
                                <div>
                                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Calidad</span>
                                    <span style={{
                                        display: "inline-block", marginLeft: 8, padding: "2px 10px", borderRadius: 12,
                                        fontSize: 12, fontWeight: 600,
                                        background: "rgba(46, 204, 113, 0.1)", color: "#2ecc71",
                                    }}>
                                        {status?.channel?.quality_rating || "GREEN"}
                                    </span>
                                </div>
                                <div>
                                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Phone Number ID</span>
                                    <p style={{ fontSize: 12, fontFamily: "monospace", margin: "4px 0 0", color: "var(--text-secondary)" }}>
                                        {status?.channel?.phone_number_id || phoneNumberId || "—"}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Update Credentials */}
                    <div style={card}>
                        <div style={cardHeader}>
                            <LinkIcon size={18} color="var(--accent)" />
                            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Actualizar Credenciales</h2>
                        </div>
                        <div style={cardBody}>
                            <form onSubmit={handleConnect} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                <div>
                                    <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Phone Number ID</label>
                                    <input type="text" value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} required style={input} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>WABA ID</label>
                                    <input type="text" value={wabaId} onChange={e => setWabaId(e.target.value)} required style={input} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Nuevo Access Token</label>
                                    <input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="Solo si necesitas actualizar" style={{ ...input, fontFamily: "monospace" }} />
                                </div>
                                <button type="submit" disabled={saving} style={{
                                    padding: "10px", borderRadius: 10, border: "1px solid var(--border)",
                                    background: "var(--bg-tertiary)", color: "var(--text-primary)",
                                    fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: saving ? 0.7 : 1,
                                }}>
                                    {saving ? "Actualizando..." : "Actualizar Credenciales"}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* ======== SECTION 3: TEMPLATES ======== */}
            {isConnected && (
                <div style={{ ...card, marginBottom: 24 }}>
                    <div style={{ ...cardHeader, justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <MessageSquare size={18} color="var(--accent)" />
                            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Plantillas Aprobadas (HSM)</h2>
                            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                {templates.length} plantilla{templates.length !== 1 ? "s" : ""}
                            </span>
                        </div>
                        <button onClick={handleSyncTemplates} disabled={syncing} style={{
                            display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
                            borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-tertiary)",
                            color: "var(--text-primary)", fontSize: 13, fontWeight: 500, cursor: "pointer",
                            opacity: syncing ? 0.7 : 1,
                        }}>
                            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                            {syncing ? "Sincronizando..." : "Sincronizar desde Meta"}
                        </button>
                    </div>
                    <div>
                        {templates.length === 0 ? (
                            <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>
                                No hay plantillas sincronizadas. Haz clic en "Sincronizar desde Meta" para descargarlas.
                            </div>
                        ) : (
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                                        <th style={{ padding: "12px 24px", fontWeight: 600, color: "var(--text-secondary)" }}>Nombre</th>
                                        <th style={{ padding: "12px 24px", fontWeight: 600, color: "var(--text-secondary)" }}>Categoria</th>
                                        <th style={{ padding: "12px 24px", fontWeight: 600, color: "var(--text-secondary)" }}>Idioma</th>
                                        <th style={{ padding: "12px 24px", fontWeight: 600, color: "var(--text-secondary)" }}>Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {templates.map((t: any) => (
                                        <tr key={t.id || t.name} style={{ borderBottom: "1px solid var(--border)" }}>
                                            <td style={{ padding: "16px 24px", fontWeight: 500 }}>{t.name}</td>
                                            <td style={{ padding: "16px 24px", color: "var(--text-secondary)" }}>{t.category}</td>
                                            <td style={{ padding: "16px 24px", color: "var(--text-secondary)" }}>{t.language}</td>
                                            <td style={{ padding: "16px 24px" }}>
                                                <span style={{
                                                    padding: "4px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                                                    background: t.approval_status === "APPROVED" ? "rgba(46, 204, 113, 0.1)" : "rgba(241, 196, 15, 0.1)",
                                                    color: t.approval_status === "APPROVED" ? "#2ecc71" : "#f1c40f",
                                                }}>
                                                    {t.approval_status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
