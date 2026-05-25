"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
    MessageSquare, CheckCircle, Check, X,
    Phone, Sparkles, Layers, ArrowRightLeft,
    AlertCircle, ArrowRight, Sprout, Clock, XCircle, LogOut,
    AlertTriangle, Shield, Timer, Info,
} from "lucide-react";
import WhatsAppEmbeddedSignup from "./WhatsAppEmbeddedSignup";
import { DisconnectChannelModal } from "@/components/ui/disconnect-channel-modal";

type Route = "new" | "coexistence" | "migration";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const MetaLogo = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M120.12 208.29c-3.88-2.9-7.77-4.35-11.65-4.35C91.64 203.94 76.5 241.53 76.5 270.9c0 13.97 4.81 23.53 14.42 23.53 9.15 0 18.79-10.55 29.18-31.07C130.54 243.67 135.1 228.4 135.1 216.67c0-3.88-.97-5.82-2.9-5.82-3.39 0-7.77 0-12.08-2.56zm184.43-6.29c-10.07 0-22.15 16.76-37.56 47.3-10.55 20.03-15.88 35.43-15.88 46.43 0 7.28 2.42 10.55 7.77 10.55 9.14 0 21.66-14.42 37.56-43.28 11.04-20.03 16.37-35.91 16.37-47.42 0-8.74-2.9-13.58-8.26-13.58z" fill="currentColor"/>
        <path d="M256 0C114.62 0 0 114.62 0 256s114.62 256 256 256 256-114.62 256-256S397.38 0 256 0zm-37.2 387.65c-16.76 0-29.32-7.28-37.56-21.9-13.1 14.62-26.21 21.9-39.31 21.9-19.06 0-28.7-13.1-28.7-39.31 0-30.1 13.58-67.33 40.76-111.54 22.15-36.1 43.28-54.18 63.31-54.18 10.07 0 17.83 5.33 23.17 16 3.39-10.55 9.63-16 18.78-16 20.52 0 43.77 18.3 69.75 54.74 21.18 29.81 31.73 56.5 31.73 80.15 0 23.17-7.28 41.73-21.9 55.63-14.62 13.42-33.19 20.22-55.63 20.22-16.27 0-29.57-5.09-39.82-15.27-8.26 6.37-16.27 9.56-24.58 9.56z" fill="currentColor"/>
    </svg>
);

const ROUTES: {
    id: Route;
    icon: typeof Sparkles;
    iconColor: string;
    iconBg: string;
    tagColor: string;
}[] = [
    {
        id: "new",
        icon: Sparkles,
        iconColor: "text-[#25D366]",
        iconBg: "bg-[#25D366]/10",
        tagColor: "bg-[#25D366]/10 text-[#25D366]",
    },
    {
        id: "coexistence",
        icon: Layers,
        iconColor: "text-[#1877F2]",
        iconBg: "bg-[#1877F2]/10",
        tagColor: "bg-[#1877F2]/10 text-[#1877F2]",
    },
    {
        id: "migration",
        icon: ArrowRightLeft,
        iconColor: "text-orange-500",
        iconBg: "bg-orange-500/10",
        tagColor: "bg-orange-500/10 text-orange-500",
    },
];

export default function WhatsAppSetupPage() {
    const tc = useTranslations("common");
    const t = useTranslations("channels");
    const tw = useTranslations("channels.whatsapp");
    const twt = useTranslations("whatsappTemplates");
    const router = useRouter();
    const { user } = useAuth();

    const [selectedRoute, setSelectedRoute] = useState<Route>("new");
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
    const isConnected = statusData?.connected === true || status?.status === "connected";

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
                <div className="flex items-center gap-3">
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

                    {/* Route cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                        {ROUTES.map((route) => {
                            const isSelected = selectedRoute === route.id;
                            const Icon = route.icon;
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
                                    <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center mb-3", route.iconBg)}>
                                        <Icon size={20} className={route.iconColor} />
                                    </div>
                                    <h3 className="text-[14px] font-semibold mb-0.5 pr-6">{tw(`route${cap(route.id)}Title`)}</h3>
                                    <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mb-3">{tw(`route${cap(route.id)}Short`)}</p>
                                    <div className="flex items-center gap-2 mt-auto">
                                        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-md", route.tagColor)}>
                                            {tw(`route${cap(route.id)}Tag`)}
                                        </span>
                                        <span className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1">
                                            <Timer size={11} />
                                            {tw(`route${cap(route.id)}Time`)}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* ─── Route detail panel ─── */}
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                        {/* Overview */}
                        <div className="p-6 border-b border-border">
                            <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                                {tw(`route${cap(selectedRoute)}Overview`)}
                            </p>
                        </div>

                        {/* Coexistence: sync table */}
                        {selectedRoute === "coexistence" && (
                            <>
                                <div className="p-6 border-b border-border">
                                    <h3 className="text-sm font-semibold mb-4">{tw("routeCoexSyncTitle")}</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                        <div>
                                            <p className="text-[11px] font-semibold text-[#2ecc71] mb-2.5 uppercase tracking-wider">{tw("syncYes")}</p>
                                            <div className="flex flex-col gap-2">
                                                {[1, 2, 3, 4].map(i => (
                                                    <div key={i} className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                                                        <CheckCircle size={13} className="text-[#2ecc71] shrink-0 mt-0.5" />
                                                        <span>{tw(`routeCoexSyncYes${i}`)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-semibold text-[#e74c3c] mb-2.5 uppercase tracking-wider">{tw("syncNo")}</p>
                                            <div className="flex flex-col gap-2">
                                                {[1, 2, 3, 4].map(i => (
                                                    <div key={i} className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                                                        <X size={13} className="text-[#e74c3c] shrink-0 mt-0.5" />
                                                        <span>{tw(`routeCoexSyncNo${i}`)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Limitations */}
                                <div className="p-6 border-b border-border">
                                    <h3 className="text-sm font-semibold mb-3">{tw("routeCoexLimitTitle")}</h3>
                                    <div className="flex flex-col gap-2.5">
                                        {[1, 2, 3, 4].map(i => (
                                            <div key={i} className="flex items-start gap-2.5 text-[12px] text-[var(--text-secondary)]">
                                                <Info size={13} className="text-amber-500 shrink-0 mt-0.5" />
                                                <span>{tw(`routeCoexLimit${i}`)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Migration: preserved / lost */}
                        {selectedRoute === "migration" && (
                            <div className="p-6 border-b border-border">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                    <div>
                                        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                            <CheckCircle size={14} className="text-[#2ecc71]" />
                                            {tw("routeMigPreservedTitle")}
                                        </h3>
                                        <div className="flex flex-col gap-2">
                                            {[1, 2, 3, 4, 5].map(i => (
                                                <div key={i} className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                                                    <CheckCircle size={13} className="text-[#2ecc71] shrink-0 mt-0.5" />
                                                    <span>{tw(`routeMigPreserved${i}`)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                            <XCircle size={14} className="text-[#e74c3c]" />
                                            {tw("routeMigLostTitle")}
                                        </h3>
                                        <div className="flex flex-col gap-2">
                                            {[1, 2, 3, 4].map(i => (
                                                <div key={i} className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                                                    <X size={13} className="text-[#e74c3c] shrink-0 mt-0.5" />
                                                    <span>{tw(`routeMigLost${i}`)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Steps */}
                        <div className="p-6 border-b border-border">
                            <h3 className="text-sm font-semibold mb-3">{tw("stepsTitle")}</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="flex items-start gap-2.5 rounded-lg border border-border bg-[var(--bg-tertiary)] p-3">
                                        <span className="w-6 h-6 rounded-full bg-[#25D366] text-white text-xs font-bold flex items-center justify-center shrink-0">{i}</span>
                                        <span className="text-[12px] text-[var(--text-secondary)] leading-relaxed mt-0.5">
                                            {tw(`route${cap(selectedRoute)}Step${i}`)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Prerequisites */}
                        <div className="p-6 border-b border-border">
                            <h3 className="text-sm font-semibold mb-3">{tw("reqsTitle")}</h3>
                            <div className="flex flex-col gap-2">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="flex items-start gap-2.5 text-[12px] text-[var(--text-secondary)]">
                                        <Shield size={13} className="text-[#25D366] shrink-0 mt-0.5" />
                                        <span>{tw(`route${cap(selectedRoute)}Req${i}`)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Warnings (coexistence) */}
                        {selectedRoute === "coexistence" && (
                            <div className="p-6 border-b border-border">
                                <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 p-4">
                                    <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                    <span className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">{tw("routeCoexNote")}</span>
                                </div>
                            </div>
                        )}

                        {/* Warnings (migration) */}
                        {selectedRoute === "migration" && (
                            <div className="p-6 border-b border-border flex flex-col gap-2.5">
                                <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 p-4">
                                    <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                    <span className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">{tw("routeMigWarnBM")}</span>
                                </div>
                                <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 p-4">
                                    <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                    <span className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">{tw("routeMigWarn2FA")}</span>
                                </div>
                            </div>
                        )}

                        {/* Connect button */}
                        <div className="p-6">
                            <WhatsAppEmbeddedSignup
                                mode={selectedRoute === "coexistence" ? "coexistence" : "standard"}
                                tenantId={getTenantId()}
                                onSuccess={(result) => {
                                    setMessage({ type: "success", text: tw("channelConnected", { number: result.displayPhoneNumber || "N/A" }) });
                                    loadData();
                                }}
                                onError={(error) => setMessage({ type: "error", text: error })}
                            />
                        </div>
                    </div>
                </>
            ) : (
                /* ═══════════ CONNECTED STATE ═══════════ */
                <div className="mb-6">
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden">
                        <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                            <Phone size={18} className="text-[#25D366]" />
                            <h2 className="text-base font-semibold m-0">{tw("activeChannel")}</h2>
                        </div>
                        <div className="p-6">
                            {(() => {
                                const ch = status?.channel || statusData?.account;
                                return (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
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
                                                {ch?.phone_number_id || ch?.metadata?.phoneNumberId || ch?.accountId || phoneNumberId || "—"}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
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
