"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { MessageSquare, Shield, CheckCircle, RefreshCw, Key, Link as LinkIcon, Zap } from "lucide-react";
import WhatsAppEmbeddedSignup from "./WhatsAppEmbeddedSignup";

export default function WhatsAppSetupPage() {
    const [status, setStatus] = useState<any>(null);
    const [templates, setTemplates] = useState<any[]>([]);
    const [config, setConfig] = useState<{ webhookUrl?: string, verifyToken?: string } | null>(null);
    
    // Form state
    const [phoneNumberId, setPhoneNumberId] = useState("");
    const [wabaId, setWabaId] = useState("");
    const [accessToken, setAccessToken] = useState("");
    
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [message, setMessage] = useState({ type: "", text: "" });

    const loadData = async () => {
        setLoading(true);
        try {
            const statusRes = await api.fetch('/channels/whatsapp/status');
            setStatus(statusRes);
            if (statusRes.channel) {
                setPhoneNumberId(statusRes.channel.display_phone_number || statusRes.channel.phone_number_id || "");
                setWabaId(statusRes.channel.meta_waba_id || "");
            }

            const tplRes = await api.fetch('/channels/whatsapp/templates');
            setTemplates(tplRes || []);

            try {
                const configRes = await api.getWhatsappConfig();
                if (configRes && configRes.data) setConfig(configRes.data);
            } catch (e) { console.error("Could not load config", e); }
        } catch (error) {
            console.error("Failed to load WA setup", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleConnect = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage({ type: "", text: "" });
        
        try {
            await api.fetch('/channels/whatsapp/connect/complete', {
                method: 'POST',
                body: JSON.stringify({ phoneNumberId, wabaId, accessToken })
            });
            setMessage({ type: "success", text: "Canal conectado correctamente." });
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
            await api.fetch('/channels/whatsapp/templates/sync', { method: 'POST' });
            setMessage({ type: "success", text: "Plantillas sincronizadas." });
            await loadData();
        } catch (err: any) {
            setMessage({ type: "error", text: "Error sincronizando plantillas." });
        } finally {
            setSyncing(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-[var(--text-secondary)]">Cargando estado de WhatsApp...</div>;

    const isConnected = status?.status === "connected";

    return (
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ background: "#25D366", width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <MessageSquare size={20} color="white" />
                        </div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>WhatsApp Business</h1>
                    </div>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                        Gestiona tu conexión oficial con Meta Cloud API y sincroniza plantillas.
                    </p>
                </div>
                {isConnected && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "rgba(46, 204, 113, 0.1)", color: "#2ecc71", borderRadius: 20, border: "1px solid rgba(46, 204, 113, 0.2)", fontSize: 13, fontWeight: 600 }}>
                        <CheckCircle size={16} /> Canal Conectado
                    </div>
                )}
            </div>

            {message.text && (
                <div style={{
                    padding: 16, borderRadius: 12, marginBottom: 24, fontSize: 14,
                    background: message.type === "error" ? "rgba(231, 76, 60, 0.1)" : "rgba(46, 204, 113, 0.1)",
                    color: message.type === "error" ? "#e74c3c" : "#2ecc71",
                    border: message.type === "error" ? "1px solid rgba(231, 76, 60, 0.2)" : "1px solid rgba(46, 204, 113, 0.2)"
                }}>
                    {message.text}
                </div>
            )}

            {/* === Embedded Signup — One-Click Onboarding === */}
            {!isConnected && (
                <div style={{
                    background: "linear-gradient(135deg, rgba(37, 211, 102, 0.05), rgba(18, 140, 126, 0.08))",
                    border: "1px solid rgba(37, 211, 102, 0.15)",
                    borderRadius: 16,
                    padding: 28,
                    marginBottom: 28,
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                        <div style={{ background: "#25D366", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Zap size={16} color="white" />
                        </div>
                        <div>
                            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Conexión Rápida — Embedded Signup</h2>
                            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "2px 0 0" }}>Conecta tu cuenta de WhatsApp Business en un solo clic</p>
                        </div>
                    </div>

                    <WhatsAppEmbeddedSignup
                        tenantId={(() => {
                            try {
                                const token = localStorage.getItem("accessToken");
                                if (token) {
                                    const payload = JSON.parse(atob(token.split(".")[1]));
                                    return payload.tenantId || "";
                                }
                            } catch {}
                            return "";
                        })()}
                        onSuccess={(result) => {
                            setMessage({ type: "success", text: `¡Canal WhatsApp conectado exitosamente! Número: ${result.displayPhoneNumber || "N/A"}` });
                            loadData();
                        }}
                        onError={(error) => {
                            setMessage({ type: "error", text: error });
                        }}
                    />
                </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                {/* Connection Box */}
                <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
                    <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
                        <LinkIcon size={18} color="var(--accent)" />
                        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Credenciales de Meta</h2>
                    </div>
                    <div style={{ padding: 24 }}>
                        <form onSubmit={handleConnect} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            <div>
                                <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>Phone Number ID</label>
                                <input
                                    type="text"
                                    value={phoneNumberId}
                                    onChange={e => setPhoneNumberId(e.target.value)}
                                    placeholder="Ej: 104561234908123"
                                    required
                                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>WhatsApp Business Account ID (WABA)</label>
                                <input
                                    type="text"
                                    value={wabaId}
                                    onChange={e => setWabaId(e.target.value)}
                                    placeholder="Ej: 1120019283746"
                                    required
                                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>System User Access Token</label>
                                <input
                                    type="password"
                                    value={accessToken}
                                    onChange={e => setAccessToken(e.target.value)}
                                    placeholder="EAAG... (Token permanente)"
                                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={saving}
                                style={{
                                    marginTop: 8, padding: "12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer", opacity: saving ? 0.7 : 1
                                }}
                            >
                                {saving ? "Conectando..." : (isConnected ? "Actualizar Credenciales" : "Conectar WABA")}
                            </button>
                        </form>
                    </div>
                </div>

                {/* Info & Webhooks */}
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                    <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                            <Shield size={18} color="#e67e22" />
                            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Webhook de Meta</h3>
                        </div>
                        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 16 }}>
                            Configura este webhook en tu App de Meta for Developers para recibir mensajes entrantes y estados de lectura.
                        </p>
                        <div style={{ background: "var(--bg-tertiary)", padding: "12px 16px", borderRadius: 8, border: "1px solid var(--border)", fontFamily: "monospace", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>
                            {config?.webhookUrl || "Cargando configuración..."}
                        </div>
                        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 16, marginBottom: 8 }}>
                            <strong>Verify Token:</strong> {config?.verifyToken || "Cargando..."}
                        </p>
                    </div>
                </div>
            </div>

            {/* Templates Section */}
            {isConnected && (
                <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 16, marginTop: 32, overflow: "hidden" }}>
                    <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <MessageSquare size={18} color="var(--accent)" />
                            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Plantillas Aprobadas (HSM)</h2>
                        </div>
                        <button
                            onClick={handleSyncTemplates}
                            disabled={syncing}
                            style={{
                                display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 13, fontWeight: 500, cursor: "pointer", opacity: syncing ? 0.7 : 1
                            }}
                        >
                            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                            {syncing ? "Sincronizando..." : "Sincronizar desde Meta"}
                        </button>
                    </div>
                    
                    <div style={{ padding: 0 }}>
                        {templates.length === 0 ? (
                            <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>
                                No hay plantillas sincronizadas. Haz clic en "Sincronizar desde Meta" para descargarlas.
                            </div>
                        ) : (
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                                        <th style={{ padding: "12px 24px", fontWeight: 600, color: "var(--text-secondary)" }}>Nombre</th>
                                        <th style={{ padding: "12px 24px", fontWeight: 600, color: "var(--text-secondary)" }}>Categoría</th>
                                        <th style={{ padding: "12px 24px", fontWeight: 600, color: "var(--text-secondary)" }}>Idioma</th>
                                        <th style={{ padding: "12px 24px", fontWeight: 600, color: "var(--text-secondary)" }}>Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {templates.map(t => (
                                        <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                            <td style={{ padding: "16px 24px", fontWeight: 500 }}>{t.name}</td>
                                            <td style={{ padding: "16px 24px", color: "var(--text-secondary)" }}>{t.category}</td>
                                            <td style={{ padding: "16px 24px", color: "var(--text-secondary)" }}>{t.language}</td>
                                            <td style={{ padding: "16px 24px" }}>
                                                <span style={{ 
                                                    padding: "4px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, 
                                                    background: t.approval_status === 'APPROVED' ? 'rgba(46, 204, 113, 0.1)' : 'rgba(241, 196, 15, 0.1)',
                                                    color: t.approval_status === 'APPROVED' ? '#2ecc71' : '#f1c40f'
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
