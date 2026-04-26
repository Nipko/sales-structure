"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
    MessageSquare, Shield, CheckCircle,
    Link as LinkIcon, Zap, Phone, Copy, ExternalLink,
    AlertCircle, Settings, ArrowRight, Sprout, Clock, XCircle,
} from "lucide-react";
import WhatsAppEmbeddedSignup from "./WhatsAppEmbeddedSignup";

export default function WhatsAppSetupPage() {
    const tc = useTranslations("common");
    const twt = useTranslations("whatsappTemplates");
    const router = useRouter();
    const { user } = useAuth();
    const isSuperAdmin = user?.role === "super_admin";
    const [status, setStatus] = useState<any>(null);
    const [templates, setTemplates] = useState<any[]>([]);
    const [config, setConfig] = useState<{ webhookUrl?: string; verifyToken?: string } | null>(null);

    const [phoneNumber, setPhoneNumber] = useState("");
    const [phoneNumberId, setPhoneNumberId] = useState("");
    const [wabaId, setWabaId] = useState("");
    const [accessToken, setAccessToken] = useState("");

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showManual, setShowManual] = useState(false);
    const [copied, setCopied] = useState("");
    const [message, setMessage] = useState({ type: "", text: "" });

    const loadData = async () => {
        setLoading(true);

        try {
            const statusRes = await api.fetch("/channels/whatsapp/status");
            setStatus(statusRes);
            // Support both formats: legacy (statusRes.channel) and generic API (statusRes.data.account)
            const channelData = statusRes?.channel || statusRes?.data?.account;
            if (channelData) {
                setPhoneNumber(channelData.display_phone_number || channelData.metadata?.displayPhoneNumber || channelData.accountId || "");
                setPhoneNumberId(channelData.phone_number_id || channelData.metadata?.phoneNumberId || channelData.accountId || "");
                setWabaId(channelData.meta_waba_id || channelData.metadata?.wabaId || "");
            }
        } catch (e) { console.error("Failed to load WA status", e); }

        try {
            const tplRes = await api.fetch("/channels/whatsapp/templates");
            setTemplates(tplRes || []);
        } catch (e) { console.error("Failed to load WA templates", e); }

        try {
            const configRes = await api.getWhatsappConfig();
            if (configRes?.data) setConfig(configRes.data);
            else if ((configRes as any)?.webhookUrl) setConfig(configRes as any);
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
                body: JSON.stringify({
                    phoneNumberId,
                    wabaId,
                    accessToken,
                    displayPhoneNumber: phoneNumber || undefined,
                }),
            });
            setMessage({ type: "success", text: "Canal conectado correctamente." });
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

    // Support both formats: WhatsApp-specific (status.status) and generic channel API (data.connected)
    const statusData = status?.data || status;
    const isConnected = statusData?.connected === true || status?.status === "connected";

    return (
        <div className="mx-auto max-w-[960px]">
            {/* ======== HEADER ======== */}
            <div className="flex justify-between items-center mb-8">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-[10px] flex items-center justify-center bg-[#25D366]">
                            <MessageSquare size={20} className="text-white" />
                        </div>
                        <h1 className="text-[28px] font-semibold m-0">WhatsApp Business</h1>
                    </div>
                    <p className="text-[var(--text-secondary)] mt-1">
                        Conecta y gestiona tu cuenta de WhatsApp Business con Meta Cloud API.
                    </p>
                </div>
                <div
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold border",
                        isConnected
                            ? "bg-[rgba(46,204,113,0.1)] text-[#2ecc71] border-[rgba(46,204,113,0.2)]"
                            : "bg-[rgba(231,76,60,0.1)] text-[#e74c3c] border-[rgba(231,76,60,0.2)]"
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
                            ? "bg-[rgba(231,76,60,0.1)] text-[#e74c3c] border-[rgba(231,76,60,0.2)]"
                            : "bg-[rgba(46,204,113,0.1)] text-[#2ecc71] border-[rgba(46,204,113,0.2)]"
                    )}
                >
                    {message.text}
                </div>
            )}

            {/* ======== SECTION 1: WEBHOOK CONFIG (always visible) ======== */}
            <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                    <Shield size={18} className="text-[#e67e22]" />
                    <h2 className="text-base font-semibold m-0">Configuracion del Webhook</h2>
                    <span className="text-xs text-[var(--text-secondary)] ml-auto">
                        Configura estos valores en tu App de Meta Developers
                    </span>
                </div>
                <div className="p-6 flex gap-6">
                    <div className="flex-1">
                        <label className="text-[13px] font-semibold mb-2 block">Callback URL</label>
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
                        {copied === "url" && <span className="text-[11px] text-[#2ecc71]">Copiado</span>}
                    </div>
                    <div className="flex-1">
                        <label className="text-[13px] font-semibold mb-2 block">Verify Token</label>
                        <div
                            className="relative bg-[var(--bg-tertiary)] p-3 px-4 rounded-lg border border-border font-mono text-xs text-primary break-all cursor-pointer"
                            onClick={() => config?.verifyToken && copyToClipboard(config.verifyToken, "token")}
                            title="Click para copiar"
                        >
                            {config?.verifyToken || "No configurado — agrega WHATSAPP_VERIFY_TOKEN en el servidor"}
                            {config?.verifyToken && (
                                <Copy size={14} className="absolute right-3 top-3.5 opacity-50" />
                            )}
                        </div>
                        {copied === "token" && <span className="text-[11px] text-[#2ecc71]">Copiado</span>}
                    </div>
                </div>
            </div>

            {/* ======== SECTION 2: CONNECTION ======== */}
            {!isConnected ? (
                <>
                    {/* Embedded Signup (primary) */}
                    <div className="rounded-xl p-7 mb-4 bg-gradient-to-br from-[rgba(37,211,102,0.05)] to-[rgba(18,140,126,0.08)] border border-[rgba(37,211,102,0.15)]">
                        <div className="flex items-center gap-2.5 mb-4">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#25D366]">
                                <Zap size={16} className="text-white" />
                            </div>
                            <div>
                                <h2 className="text-base font-semibold m-0">Conexion Rapida — Embedded Signup</h2>
                                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
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

                    {/* Toggle manual connection — super_admin only (uses raw Meta credentials) */}
                    {isSuperAdmin && (
                    <div className="text-center mb-6">
                        <button
                            onClick={() => setShowManual(!showManual)}
                            className="bg-transparent border-none text-[var(--text-secondary)] text-[13px] cursor-pointer underline"
                        >
                            {showManual ? "Ocultar conexion manual" : "O conectar manualmente con credenciales de Meta"}
                        </button>
                    </div>
                    )}

                    {/* Manual connection form — super_admin only */}
                    {isSuperAdmin && showManual && (
                        <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                            <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                                <Settings size={18} className="text-primary" />
                                <h2 className="text-base font-semibold m-0">Conexion Manual</h2>
                            </div>
                            <div className="p-6">
                                <p className="text-[13px] text-[var(--text-secondary)] mb-5 leading-relaxed">
                                    Obtiene estos datos de <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-primary">
                                    developers.facebook.com <ExternalLink size={12} className="inline" /></a> &rarr; tu app &rarr; WhatsApp &rarr; API Setup
                                </p>
                                <form onSubmit={handleConnect} className="flex flex-col gap-4">
                                    <div>
                                        <label className="text-[13px] font-semibold mb-1 block">Numero de telefono</label>
                                        <span className="text-[11px] text-[var(--text-secondary)] block mb-1.5">El numero de WhatsApp Business desde el que se enviaran los mensajes</span>
                                        <input type="text" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="Ej: +57 320 801 0737" className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[13px] font-semibold mb-1 block">Phone Number ID</label>
                                        <span className="text-[11px] text-[var(--text-secondary)] block mb-1.5">Lo encuentras en WhatsApp &rarr; API Setup, debajo de tu numero</span>
                                        <input type="text" value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} placeholder="Ej: 104561234908123" required className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[13px] font-semibold mb-1 block">Business Account ID</label>
                                        <span className="text-[11px] text-[var(--text-secondary)] block mb-1.5">WhatsApp &rarr; API Setup &rarr; WhatsApp Business Account ID (arriba de la pagina)</span>
                                        <input type="text" value={wabaId} onChange={e => setWabaId(e.target.value)} placeholder="Ej: 1120019283746" required className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[13px] font-semibold mb-1 block">API Key (Access Token permanente)</label>
                                        <span className="text-[11px] text-[var(--text-secondary)] block mb-1.5">System User Token o token temporal de API Setup. Nunca se almacena en texto plano.</span>
                                        <input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="EAAG..." required className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm font-mono outline-none" />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className={cn(
                                            "mt-2 py-3 rounded-[10px] border-none bg-[#25D366] text-white font-semibold text-sm cursor-pointer",
                                            saving && "opacity-70"
                                        )}
                                    >
                                        {saving ? "Conectando..." : "Conectar WABA"}
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                /* ======== CONNECTED STATE ======== */
                <div className="grid grid-cols-2 gap-6 mb-6">
                    {/* Channel Info */}
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden">
                        <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                            <Phone size={18} className="text-[#25D366]" />
                            <h2 className="text-base font-semibold m-0">Canal Activo</h2>
                        </div>
                        <div className="p-6">
                            {(() => {
                                const ch = status?.channel || statusData?.account;
                                return (
                                    <div className="flex flex-col gap-3.5">
                                        <div>
                                            <span className="text-xs text-[var(--text-secondary)]">Numero</span>
                                            <p className="text-base font-semibold mt-1 mb-0">
                                                {ch?.display_phone_number || ch?.metadata?.displayPhoneNumber || ch?.accountId || phoneNumberId || "\u2014"}
                                            </p>
                                        </div>
                                        <div>
                                            <span className="text-xs text-[var(--text-secondary)]">Nombre verificado</span>
                                            <p className="text-sm mt-1 mb-0">
                                                {ch?.display_name || ch?.verified_name || ch?.displayName || ch?.metadata?.verifiedName || "\u2014"}
                                            </p>
                                        </div>
                                        <div>
                                            <span className="text-xs text-[var(--text-secondary)]">Calidad</span>
                                            <span className="inline-block ml-2 px-2.5 py-0.5 rounded-xl text-xs font-semibold bg-[rgba(46,204,113,0.1)] text-[#2ecc71]">
                                                {ch?.quality_rating || ch?.metadata?.qualityRating || "GREEN"}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-xs text-[var(--text-secondary)]">Phone Number ID</span>
                                            <p className="text-xs font-mono mt-1 mb-0 text-[var(--text-secondary)]">
                                                {ch?.phone_number_id || ch?.metadata?.phoneNumberId || ch?.accountId || phoneNumberId || "\u2014"}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Update Credentials — super_admin only (raw Meta credentials) */}
                    {isSuperAdmin && (
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden">
                        <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                            <LinkIcon size={18} className="text-primary" />
                            <h2 className="text-base font-semibold m-0">Actualizar Credenciales</h2>
                        </div>
                        <div className="p-6">
                            <form onSubmit={handleConnect} className="flex flex-col gap-3.5">
                                <div>
                                    <label className="text-[13px] font-semibold mb-1.5 block">Phone Number ID</label>
                                    <input type="text" value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} required className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm outline-none" />
                                </div>
                                <div>
                                    <label className="text-[13px] font-semibold mb-1.5 block">Business Account ID</label>
                                    <input type="text" value={wabaId} onChange={e => setWabaId(e.target.value)} required className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm outline-none" />
                                </div>
                                <div>
                                    <label className="text-[13px] font-semibold mb-1.5 block">Nueva API Key (Access Token)</label>
                                    <input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="Solo si necesitas actualizar" className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground text-sm font-mono outline-none" />
                                </div>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className={cn(
                                        "py-2.5 rounded-[10px] border border-border bg-[var(--bg-tertiary)] text-foreground font-semibold text-[13px] cursor-pointer",
                                        saving && "opacity-70"
                                    )}
                                >
                                    {saving ? "Actualizando..." : "Actualizar Credenciales"}
                                </button>
                            </form>
                        </div>
                    </div>
                    )}
                </div>
            )}

            {/* ======== SECTION 3: TEMPLATES (summary + link to dedicated page) ======== */}
            {isConnected && (() => {
                const approvedCount = templates.filter((x: any) => x.approval_status === "APPROVED").length;
                const pendingCount  = templates.filter((x: any) => x.approval_status === "PENDING").length;
                const rejectedCount = templates.filter((x: any) => x.approval_status === "REJECTED").length;
                const seedCount     = templates.filter((x: any) => x.is_seed).length;
                return (
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                        <div className="px-6 py-5 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <MessageSquare size={18} className="text-primary" />
                                <h2 className="text-base font-semibold m-0">{twt("title")}</h2>
                                <span className="text-xs text-[var(--text-secondary)]">
                                    {twt("countLabel", { count: templates.length })}
                                </span>
                            </div>
                            <button
                                onClick={() => router.push("/admin/channels/whatsapp/templates")}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-[var(--bg-tertiary)] text-foreground text-[13px] font-medium cursor-pointer"
                            >
                                {twt("manageTemplates")} <ArrowRight size={14} />
                            </button>
                        </div>
                        <div className="p-6">
                            <p className="text-[13px] text-[var(--text-secondary)] mb-4 leading-relaxed">
                                {twt("summaryIntro")}
                            </p>
                            <div className="grid grid-cols-4 gap-3">
                                <div className="rounded-lg border border-border p-3 bg-[var(--bg-tertiary)]">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <CheckCircle size={14} className="text-[#2ecc71]" />
                                        <span className="text-[11px] text-[var(--text-secondary)] font-medium">{twt("statApproved")}</span>
                                    </div>
                                    <div className="text-xl font-semibold">{approvedCount}</div>
                                </div>
                                <div className="rounded-lg border border-border p-3 bg-[var(--bg-tertiary)]">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <Clock size={14} className="text-[#f1c40f]" />
                                        <span className="text-[11px] text-[var(--text-secondary)] font-medium">{twt("statPending")}</span>
                                    </div>
                                    <div className="text-xl font-semibold">{pendingCount}</div>
                                </div>
                                <div className="rounded-lg border border-border p-3 bg-[var(--bg-tertiary)]">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <XCircle size={14} className="text-[#e74c3c]" />
                                        <span className="text-[11px] text-[var(--text-secondary)] font-medium">{twt("statRejected")}</span>
                                    </div>
                                    <div className="text-xl font-semibold">{rejectedCount}</div>
                                </div>
                                <div className="rounded-lg border border-border p-3 bg-[var(--bg-tertiary)]">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <Sprout size={14} className="text-[#25D366]" />
                                        <span className="text-[11px] text-[var(--text-secondary)] font-medium">{twt("statSeeds")}</span>
                                    </div>
                                    <div className="text-xl font-semibold">{seedCount}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
