"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { cn } from "@/lib/utils";
import {
    MessageSquare, CheckCircle, Check,
    Phone, Sparkles, Layers, ArrowRightLeft,
    AlertCircle, ArrowRight, Sprout, Clock, XCircle, LogOut,
    AlertTriangle, Shield, Timer, Plus, Trash2,
} from "lucide-react";
import WhatsAppEmbeddedSignup, { isKnownWhatsAppWarning } from "./WhatsAppEmbeddedSignup";
import WhatsAppPrerequisites from "./WhatsAppPrerequisites";
import WhatsAppRouteBrief from "./WhatsAppRouteBrief";
import {
    WHATSAPP_CONNECT_ROUTES,
    getWhatsAppConnectRoute,
    whatsAppRouteKey,
    type WhatsAppConnectRouteId,
} from "./whatsapp-connect-routes";
import { guidedTourAnchorId } from "@/lib/guided-tours";
import { DisconnectChannelModal } from "@/components/ui/disconnect-channel-modal";
import { HelpPanel } from "@/components/ui/help-panel";

const ROUTE_ICONS: Record<WhatsAppConnectRouteId, typeof Layers> = {
    coexistence: Layers,
    new: Sparkles,
    migration: ArrowRightLeft,
};

const MetaLogo = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M120.12 208.29c-3.88-2.9-7.77-4.35-11.65-4.35C91.64 203.94 76.5 241.53 76.5 270.9c0 13.97 4.81 23.53 14.42 23.53 9.15 0 18.79-10.55 29.18-31.07C130.54 243.67 135.1 228.4 135.1 216.67c0-3.88-.97-5.82-2.9-5.82-3.39 0-7.77 0-12.08-2.56zm184.43-6.29c-10.07 0-22.15 16.76-37.56 47.3-10.55 20.03-15.88 35.43-15.88 46.43 0 7.28 2.42 10.55 7.77 10.55 9.14 0 21.66-14.42 37.56-43.28 11.04-20.03 16.37-35.91 16.37-47.42 0-8.74-2.9-13.58-8.26-13.58z" fill="currentColor"/>
        <path d="M256 0C114.62 0 0 114.62 0 256s114.62 256 256 256 256-114.62 256-256S397.38 0 256 0zm-37.2 387.65c-16.76 0-29.32-7.28-37.56-21.9-13.1 14.62-26.21 21.9-39.31 21.9-19.06 0-28.7-13.1-28.7-39.31 0-30.1 13.58-67.33 40.76-111.54 22.15-36.1 43.28-54.18 63.31-54.18 10.07 0 17.83 5.33 23.17 16 3.39-10.55 9.63-16 18.78-16 20.52 0 43.77 18.3 69.75 54.74 21.18 29.81 31.73 56.5 31.73 80.15 0 23.17-7.28 41.73-21.9 55.63-14.62 13.42-33.19 20.22-55.63 20.22-16.27 0-29.57-5.09-39.82-15.27-8.26 6.37-16.27 9.56-24.58 9.56z" fill="currentColor"/>
    </svg>
);

export default function WhatsAppSetupPage() {
    const tc = useTranslations("common");
    const t = useTranslations("channels");
    const tw = useTranslations("channels.whatsapp");
    const twn = useTranslations("channels.whatsapp.warnings");
    const tHelp = useTranslations("help");
    const twt = useTranslations("whatsappTemplates");
    const router = useRouter();
    const { user } = useAuth();
    const { canAddChannelAccount } = usePlanLimits();

    const [selectedRoute, setSelectedRoute] = useState<WhatsAppConnectRouteId>("coexistence");
    const [prereqsOk, setPrereqsOk] = useState(false);
    const [connectWarnings, setConnectWarnings] = useState<string[]>([]);
    const [showAddNumber, setShowAddNumber] = useState(false);
    const [status, setStatus] = useState<any>(null);
    const [templates, setTemplates] = useState<any[]>([]);
    const [config, setConfig] = useState<{ webhookUrl?: string; verifyToken?: string } | null>(null);
    const [phoneNumber, setPhoneNumber] = useState("");
    const [phoneNumberId, setPhoneNumberId] = useState("");
    const [loading, setLoading] = useState(true);
    const [disconnecting, setDisconnecting] = useState(false);
    const [showDisconnectModal, setShowDisconnectModal] = useState(false);
    const [message, setMessage] = useState({ type: "", text: "" });

    const loadData = async () => {
        setLoading(true);
        try {
            const statusRes = await api.fetch("/channels/whatsapp/status");
            setStatus(statusRes);
            const channelData = statusRes?.channel || statusRes?.data?.account;
            if (channelData) {
                setPhoneNumber(channelData.display_phone_number || channelData.metadata?.displayPhoneNumber || channelData.accountId || "");
                setPhoneNumberId(channelData.phone_number_id || channelData.metadata?.phoneNumberId || channelData.accountId || "");
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

    const handleDisconnect = async () => {
        setDisconnecting(true);
        try {
            const res = await api.fetch("/channels/whatsapp/disconnect", { method: "POST" });
            setShowDisconnectModal(false);
            if (res?.providerOk === false) {
                setMessage({ type: "warning", text: res.message || t("whatsapp.disconnectPartial") });
            } else {
                setMessage({ type: "success", text: t("whatsapp.disconnectSuccess") });
            }
            await loadData();
        } catch (err: any) {
            setMessage({ type: "error", text: err.message || tc("connectionError") });
        } finally {
            setDisconnecting(false);
        }
    };

    const handleDisconnectNumber = async (phoneNumberId: string) => {
        if (!phoneNumberId) return;
        if (!window.confirm(t("disconnectAccountConfirm"))) return;
        setMessage({ type: "", text: "" });
        try {
            const res = await api.disconnectChannelAccount("whatsapp", phoneNumberId);
            if (res?.success) {
                setMessage({ type: "success", text: t("whatsapp.disconnectSuccess") });
                await loadData();
            } else {
                setMessage({ type: "error", text: (res as any)?.error || tc("connectionError") });
            }
        } catch (err: any) {
            setMessage({ type: "error", text: err.message || tc("connectionError") });
        }
    };

    const getTenantId = () => {
        try {
            const token = localStorage.getItem("accessToken");
            if (token) return JSON.parse(atob(token.split(".")[1])).tenantId || "";
        } catch {}
        return "";
    };

    if (loading) {
        return <div className="p-8 text-center text-[var(--text-secondary)]">{tw("loadingStatus")}</div>;
    }

    const statusData = status?.data || status;
    const isConnected = statusData?.connected === true || status?.status === "connected" || statusData?.status === "connected";
    // Robust across response shapes: the WhatsApp controller returns { channel, channels }
    // while the generic channel controller returns { data: { account, accounts } }.
    const waSrc: any = status?.data || status || {};
    const waChannels: any[] =
        (Array.isArray(waSrc.channels) && waSrc.channels.length) ? waSrc.channels
        : (Array.isArray(waSrc.accounts) && waSrc.accounts.length) ? waSrc.accounts
        : (waSrc.channel ? [waSrc.channel]
        : (waSrc.account ? [waSrc.account] : []));
    const canAddWa = canAddChannelAccount("whatsapp", waChannels.length);
    const activeRoute = getWhatsAppConnectRoute(selectedRoute);

    return (
        <div className="mx-auto max-w-[960px]">
            {/* ═══════════ HEADER ═══════════ */}
            <div className="flex justify-between items-center mb-8">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-[10px] flex items-center justify-center bg-[#25D366]">
                            <MessageSquare size={20} className="text-white" />
                        </div>
                        <h1 className="text-[28px] font-semibold m-0">WhatsApp Business</h1>
                    </div>
                    <p className="text-[var(--text-secondary)] mt-1">{tw("pageSubtitle")}</p>
                </div>
                <div id={guidedTourAnchorId("whatsapp-status")} className="flex items-center gap-3">
                    <div className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold border",
                        isConnected
                            ? "bg-[rgba(46,204,113,0.1)] text-[#2ecc71] border-[rgba(46,204,113,0.2)]"
                            : "bg-[rgba(231,76,60,0.1)] text-[#e74c3c] border-[rgba(231,76,60,0.2)]"
                    )}>
                        {isConnected ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                        {isConnected ? t("connected") : t("disconnected")}
                    </div>
                    {isConnected && (
                        <button
                            onClick={() => setShowDisconnectModal(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[rgba(231,76,60,0.3)] text-[#e74c3c] text-[13px] font-medium cursor-pointer bg-transparent hover:bg-[rgba(231,76,60,0.1)] transition-colors"
                        >
                            <LogOut size={14} />
                            {t("whatsapp.disconnect")}
                        </button>
                    )}
                </div>
            </div>

            <HelpPanel
                title={tHelp("channelsWhatsapp.title")}
                description={tHelp("channelsWhatsapp.description")}
                tips={tHelp.raw("channelsWhatsapp.tips") as string[]}
                mediaKey="channelsWhatsapp"
                tourId="first_channel_whatsapp"
            />

            {/* Meta conectó, pero con reservas. Sin esto la persona veía "conectado"
                y se enteraba de la verificación pendiente cuando fallaba un envío. */}
            {connectWarnings.length > 0 && (
                <div className="mb-6 rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4">
                    <div className="flex items-start gap-2.5">
                        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{twn("title")}</p>
                            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">{twn("subtitle")}</p>
                            <ul className="mt-3 space-y-2">
                                {connectWarnings.map((warning) => (
                                    <li key={warning} className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
                                        • {isKnownWhatsAppWarning(warning) ? twn(`codes.${warning}`) : warning}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* Probá tu agente — cierra el loop "canal 100% funcional" tras conectar */}
            {isConnected && phoneNumber && (
                <div id={guidedTourAnchorId("whatsapp-test")} className="mb-6 rounded-xl border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0">
                        <MessageSquare size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{tw("testAgentTitle")}</p>
                        <p className="text-xs text-emerald-700 dark:text-emerald-400/80 mt-0.5">{tw("testAgentDesc", { number: phoneNumber })}</p>
                    </div>
                    <a
                        href={`https://wa.me/${phoneNumber.replace(/[^0-9]/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                    >
                        {tw("testAgentCta")} <ArrowRight size={14} />
                    </a>
                </div>
            )}

            {/* Alert */}
            {message.text && (
                <div className={cn(
                    "p-4 rounded-xl mb-6 text-sm border",
                    message.type === "error"
                        ? "bg-[rgba(231,76,60,0.1)] text-[#e74c3c] border-[rgba(231,76,60,0.2)]"
                        : message.type === "warning"
                        ? "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900"
                        : "bg-[rgba(46,204,113,0.1)] text-[#2ecc71] border-[rgba(46,204,113,0.2)]"
                )}>
                    {message.text}
                </div>
            )}

            {/* ═══════════ NOT CONNECTED ═══════════ */}
            {!isConnected ? (
                <>
                    {/* Meta brief */}
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[rgba(24,119,242,0.04)] border border-[rgba(24,119,242,0.1)] mb-8">
                        <div className="w-8 h-8 rounded-lg bg-[#1877F2] flex items-center justify-center shrink-0">
                            <MetaLogo className="w-4 h-4 text-white" />
                        </div>
                        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{tw("metaBrief")}</p>
                    </div>

                    {/* Route selection header */}
                    <div className="mb-5">
                        <h2 className="text-lg font-semibold">{tw("routeTitle")}</h2>
                        <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">{tw("routeSubtitle")}</p>
                    </div>

                    {/* Pre-check. Vivia solo en el asistente, asi que quien conectaba
                        desde esta pagina descubria adentro de la ventana de Meta que le
                        faltaba el numero o el codigo de verificacion. */}
                    {!prereqsOk ? (
                        <div className="rounded-xl border border-border bg-[var(--bg-secondary)] p-6 mb-6">
                            <WhatsAppPrerequisites onContinue={() => setPrereqsOk(true)} />
                        </div>
                    ) : (
                        <>
                            {/* Route cards */}
                            <div id={guidedTourAnchorId("whatsapp-routes")} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                                {WHATSAPP_CONNECT_ROUTES.map((route) => {
                                    const isSelected = selectedRoute === route.id;
                                    const Icon = ROUTE_ICONS[route.id];
                                    return (
                                        <button
                                            key={route.id}
                                            onClick={() => setSelectedRoute(route.id)}
                                            className={cn(
                                                "relative flex flex-col items-start p-5 rounded-xl border-2 transition-all text-left cursor-pointer bg-[var(--bg-secondary)]",
                                                isSelected
                                                    ? "border-[#25D366] shadow-[0_0_0_1px_rgba(37,211,102,0.15),0_4px_12px_rgba(37,211,102,0.08)]"
                                                    : "border-border hover:border-[var(--text-secondary)]/30"
                                            )}
                                        >
                                            <div className={cn(
                                                "absolute top-4 right-4 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                                                isSelected ? "border-[#25D366] bg-[#25D366]" : "border-[var(--text-secondary)]/25"
                                            )}>
                                                {isSelected && <Check size={12} className="text-white" />}
                                            </div>
                                            {route.recommended && (
                                                <span className="absolute -top-2.5 left-4 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500 text-white">
                                                    {tw("routeRecommended")}
                                                </span>
                                            )}
                                            <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center mb-3", route.accent.bg)}>
                                                <Icon size={20} className={route.accent.fg} />
                                            </div>
                                            <h3 className="text-[14px] font-semibold mb-0.5 pr-6">{tw(whatsAppRouteKey(route, "Title"))}</h3>
                                            <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mb-3">{tw(whatsAppRouteKey(route, "Short"))}</p>
                                            <div className="flex items-center gap-2 mt-auto">
                                                <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-md", route.accent.bg, route.accent.fg)}>
                                                    {tw(whatsAppRouteKey(route, "Tag"))}
                                                </span>
                                                <span className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1">
                                                    <Timer size={11} />
                                                    {tw(whatsAppRouteKey(route, "Time"))}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Resumen de la ruta elegida: pasos, requisitos y avisos ANTES del boton */}
                            {activeRoute && <WhatsAppRouteBrief route={activeRoute} />}

                            <div className="rounded-xl border border-border bg-[var(--bg-secondary)] p-6 mt-4 mb-6">
                                <WhatsAppEmbeddedSignup
                                    mode={activeRoute?.mode ?? "standard"}
                                    tenantId={getTenantId()}
                                    onSuccess={(result) => {
                                        setConnectWarnings(result.warnings ?? []);
                                        setMessage({ type: "success", text: tw("channelConnected", { number: result.displayPhoneNumber || "N/A" }) });
                                        loadData();
                                    }}
                                    onError={() => { /* el componente ya explica el error y ofrece el proximo paso */ }}
                                />
                            </div>
                        </>
                    )}
                </>
            ) : (
                /* ═══════════ CONNECTED STATE (multi-number) ═══════════ */
                <div className="mb-6 space-y-4">
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden">
                        <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                            <Phone size={18} className="text-[#25D366]" />
                            <h2 className="text-base font-semibold m-0">{tw("activeChannel")}</h2>
                            {waChannels.length > 1 && (
                                <span className="ml-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                                    {waChannels.length}
                                </span>
                            )}
                        </div>
                        <div className="p-6 flex flex-col gap-4">
                            {waChannels.map((ch: any, idx: number) => {
                                const pnid = ch?.phone_number_id || ch?.metadata?.phoneNumberId || ch?.accountId;
                                return (
                                    <div key={pnid || ch?.id || idx} className={cn("rounded-lg", waChannels.length > 1 && "border border-border bg-[var(--bg-tertiary)] p-4")}>
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-5 flex-1 min-w-0">
                                                <div>
                                                    <span className="text-xs text-[var(--text-secondary)]">{tw("labelNumber")}</span>
                                                    <p className="text-base font-semibold mt-1 mb-0">
                                                        {ch?.display_phone_number || ch?.metadata?.displayPhoneNumber || ch?.accountId || phoneNumberId || "—"}
                                                    </p>
                                                </div>
                                                <div>
                                                    <span className="text-xs text-[var(--text-secondary)]">{tw("labelVerifiedName")}</span>
                                                    <p className="text-sm mt-1 mb-0">
                                                        {ch?.display_name || ch?.verified_name || ch?.displayName || ch?.metadata?.verifiedName || "—"}
                                                    </p>
                                                </div>
                                                <div>
                                                    <span className="text-xs text-[var(--text-secondary)]">{tw("labelQuality")}</span>
                                                    <span className="inline-block ml-2 px-2.5 py-0.5 rounded-xl text-xs font-semibold bg-[rgba(46,204,113,0.1)] text-[#2ecc71]">
                                                        {ch?.quality_rating || ch?.metadata?.qualityRating || "GREEN"}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="text-xs text-[var(--text-secondary)]">{tw("labelPhoneNumberId")}</span>
                                                    <p className="text-xs font-mono mt-1 mb-0 text-[var(--text-secondary)]">
                                                        {pnid || phoneNumberId || "—"}
                                                    </p>
                                                </div>
                                            </div>
                                            {waChannels.length > 1 && (
                                                <button
                                                    onClick={() => handleDisconnectNumber(pnid)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(231,76,60,0.3)] bg-transparent text-[#e74c3c] text-[12px] font-semibold cursor-pointer hover:bg-[rgba(231,76,60,0.1)] transition-colors shrink-0"
                                                >
                                                    <Trash2 size={13} /> {t("disconnectAccount")}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Add another number (plan-gated) */}
                    {canAddWa && (
                        <div className="rounded-xl border border-dashed border-border bg-[var(--bg-secondary)] overflow-hidden">
                            <div className="p-4">
                                {!showAddNumber ? (
                                    <button
                                        onClick={() => setShowAddNumber(true)}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-[var(--bg-tertiary)] text-foreground text-[13px] font-semibold cursor-pointer hover:bg-[var(--bg-primary)] transition-colors"
                                    >
                                        <Plus size={16} className="text-[#25D366]" /> {t("addAnother")}
                                    </button>
                                ) : (
                                    <WhatsAppEmbeddedSignup
                                        mode="standard"
                                        tenantId={getTenantId()}
                                        onSuccess={(result) => {
                                            setConnectWarnings(result.warnings ?? []);
                                            setMessage({ type: "success", text: tw("channelConnected", { number: result.displayPhoneNumber || "N/A" }) });
                                            setShowAddNumber(false);
                                            loadData();
                                        }}
                                        onError={() => { /* el componente ya explica el error y ofrece el proximo paso */ }}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══════════ BUSINESS PROFILE (connected only) ═══════════ */}
            {isConnected && (
                <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                    <div className="px-6 py-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-emerald-500/10">
                                <Shield size={18} className="text-emerald-500" />
                            </div>
                            <div>
                                <h2 className="text-base font-semibold m-0">{tw("profileCard")}</h2>
                                <p className="text-xs text-[var(--text-secondary)] mt-0.5">{tw("profileCardDesc")}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => router.push("/admin/channels/whatsapp/profile")}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-[var(--bg-tertiary)] text-foreground text-[13px] font-medium cursor-pointer"
                        >
                            {tw("manageProfile")} <ArrowRight size={14} />
                        </button>
                    </div>
                </div>
            )}

            {/* ═══════════ TEMPLATES (connected only) ═══════════ */}
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

            <DisconnectChannelModal
                open={showDisconnectModal}
                onClose={() => setShowDisconnectModal(false)}
                onConfirm={handleDisconnect}
                channelName="WhatsApp"
                description={tw("disconnectConfirm")}
                loading={disconnecting}
            />
        </div>
    );
}
