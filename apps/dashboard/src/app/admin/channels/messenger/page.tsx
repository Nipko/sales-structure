"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import {
    MessageCircle,
    Shield,
    CheckCircle,
    AlertCircle,
    Copy,
    Link as LinkIcon,
    User,
    LogOut,
    Loader2,
} from "lucide-react";

declare global {
    interface Window {
        FB: any;
        fbAsyncInit: () => void;
    }
}

const BRAND_COLOR = "#0084FF";
const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || "";
const MESSENGER_CONFIG_ID = process.env.NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID || "";

export default function MessengerSetupPage() {
    const t = useTranslations("channels");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [status, setStatus] = useState<any>(null);
    const [config, setConfig] = useState<{ webhookUrl?: string; verifyToken?: string } | null>(null);

    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [sdkLoaded, setSdkLoaded] = useState(false);
    const [copied, setCopied] = useState("");
    const [message, setMessage] = useState({ type: "", text: "" });

    // Load Facebook SDK
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (window.FB) {
            setSdkLoaded(true);
            return;
        }

        window.fbAsyncInit = function () {
            window.FB.init({
                appId: META_APP_ID,
                cookie: true,
                xfbml: false,
                version: "v21.0",
            });
            setSdkLoaded(true);
        };

        const script = document.createElement("script");
        script.src = "https://connect.facebook.net/en_US/sdk.js";
        script.async = true;
        script.defer = true;
        document.body.appendChild(script);

        return () => {
            // Cleanup not needed — SDK persists across navigations
        };
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const statusRes = await api.fetch("/channels/messenger/status");
            setStatus(statusRes);
        } catch (e) {
            console.error("Failed to load Messenger status", e);
        }
        try {
            const configRes = await api.fetch("/channels/messenger/config");
            if (configRes?.webhookUrl || configRes?.data?.webhookUrl) {
                setConfig(configRes.data || configRes);
            }
        } catch (e) {
            console.error("Failed to load Messenger config", e);
        }
        setLoading(false);
    }, [activeTenantId]);

    useEffect(() => { loadData(); }, [loadData]);

    const handleOAuthConnect = () => {
        if (!sdkLoaded || !window.FB) {
            setMessage({ type: "error", text: t("messenger.sdkNotLoaded") });
            return;
        }
        if (!MESSENGER_CONFIG_ID) {
            setMessage({ type: "error", text: "Facebook Login Configuration ID not set. Contact support." });
            return;
        }

        setConnecting(true);
        setMessage({ type: "", text: "" });

        window.FB.login(
            (response: any) => {
                if (response.authResponse?.code) {
                    api.messengerOAuthConnect(response.authResponse.code)
                        .then((result: any) => {
                            if (result.success) {
                                setMessage({ type: "success", text: t("messenger.connectSuccess") });
                                loadData();
                            } else {
                                setMessage({ type: "error", text: result.error || t("messenger.connectFailed") });
                            }
                        })
                        .catch((err: any) => {
                            setMessage({ type: "error", text: err.message || t("messenger.connectFailed") });
                        })
                        .finally(() => setConnecting(false));
                } else {
                    setMessage({ type: "", text: "" });
                    setConnecting(false);
                }
            },
            {
                config_id: MESSENGER_CONFIG_ID,
                response_type: "code",
                override_default_response_type: true,
            }
        );
    };

    const handleDisconnect = async () => {
        if (!confirm(t("messenger.disconnectConfirm"))) return;
        setDisconnecting(true);
        setMessage({ type: "", text: "" });
        try {
            await api.fetch("/channels/messenger/disconnect", { method: "POST" });
            setMessage({ type: "success", text: t("messenger.disconnectSuccess") });
            await loadData();
        } catch (err: any) {
            setMessage({ type: "error", text: err.message || tc("connectionError") });
        } finally {
            setDisconnecting(false);
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
                {t("loading")}
            </div>
        );
    }

    const isConnected = status?.status === "connected";
    const connectedPages = status?.pages || (status?.channel ? [status.channel] : []);

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
                            <MessageCircle size={20} className="text-white" />
                        </div>
                        <h1 className="text-[28px] font-semibold m-0 text-foreground">
                            Facebook Messenger
                        </h1>
                    </div>
                    <p className="text-[var(--text-secondary)] mt-1">
                        {t("messengerDesc")}
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
                    {isConnected ? t("connected") : t("disconnected")}
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

            {!isConnected ? (
                /* ── Not Connected: OAuth Button ── */
                <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                    <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                        <LinkIcon size={18} style={{ color: BRAND_COLOR }} />
                        <h2 className="text-base font-semibold m-0 text-foreground">
                            {t("messenger.connectTitle")}
                        </h2>
                    </div>
                    <div className="p-6">
                        <p className="text-sm text-[var(--text-secondary)] mb-6">
                            {t("messenger.connectDesc")}
                        </p>
                        <button
                            onClick={handleOAuthConnect}
                            disabled={connecting || !sdkLoaded}
                            className={cn(
                                "flex items-center justify-center gap-2 w-full py-3 rounded-[10px] border-none text-white font-semibold text-sm cursor-pointer transition-opacity",
                                (connecting || !sdkLoaded) && "opacity-70 cursor-not-allowed"
                            )}
                            style={{ background: BRAND_COLOR }}
                        >
                            {connecting ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    {t("messenger.oauthConnecting")}
                                </>
                            ) : (
                                <>
                                    <MessageCircle size={16} />
                                    {t("messenger.connectWithFacebook")}
                                </>
                            )}
                        </button>
                        {!sdkLoaded && (
                            <p className="text-xs text-[var(--text-secondary)] mt-2 text-center">
                                {t("messenger.loadingSdk")}
                            </p>
                        )}
                    </div>
                </div>
            ) : (
                /* ── Connected State ── */
                <>
                    {/* Connected Pages */}
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                        <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                            <User size={18} style={{ color: BRAND_COLOR }} />
                            <h2 className="text-base font-semibold m-0 text-foreground">
                                {t("messenger.connectedPage")}
                            </h2>
                            <span className="text-xs text-[var(--text-secondary)] ml-auto">
                                {t("messenger.pagesConnected", { count: connectedPages.length })}
                            </span>
                        </div>
                        <div className="p-6">
                            <div className="flex flex-col gap-4">
                                {connectedPages.map((page: any, idx: number) => (
                                    <div key={page.page_id || page.account_id || idx} className="flex items-center gap-4 p-4 rounded-xl bg-[var(--bg-tertiary)] border border-border">
                                        {page.profile_picture_url ? (
                                            <img
                                                src={page.profile_picture_url}
                                                alt={page.display_name || "Page"}
                                                className="w-12 h-12 rounded-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: BRAND_COLOR }}>
                                                <MessageCircle size={20} className="text-white" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-foreground truncate">
                                                {page.display_name || "\u2014"}
                                            </p>
                                            <p className="text-xs font-mono text-[var(--text-secondary)] mt-0.5">
                                                ID: {page.page_id || page.account_id || "\u2014"}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[rgba(0,214,143,0.1)] text-[var(--success)] border border-[rgba(0,214,143,0.2)]">
                                            <CheckCircle size={12} />
                                            {t("connected")}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Webhook Config Card */}
                    {config?.webhookUrl && (
                        <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                            <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                                <Shield size={18} className="text-[#e67e22]" />
                                <h2 className="text-base font-semibold m-0 text-foreground">
                                    Webhook
                                </h2>
                            </div>
                            <div className="p-6">
                                <label className="text-[13px] font-semibold mb-2 block text-foreground">
                                    Callback URL
                                </label>
                                <div
                                    className="relative bg-[var(--bg-tertiary)] p-3 px-4 rounded-lg border border-border font-mono text-xs text-primary break-all cursor-pointer"
                                    onClick={() => config?.webhookUrl && copyToClipboard(config.webhookUrl, "url")}
                                    title="Click to copy"
                                >
                                    {config.webhookUrl}
                                    <Copy size={14} className="absolute right-3 top-3.5 opacity-50" />
                                </div>
                                {copied === "url" && <span className="text-[11px] text-[var(--success)]">{tc("copied")}</span>}
                            </div>
                        </div>
                    )}

                    {/* Disconnect */}
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                        <div className="p-6 flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-semibold text-foreground mb-1">
                                    {t("messenger.disconnectTitle")}
                                </h3>
                                <p className="text-xs text-[var(--text-secondary)]">
                                    {t("messenger.disconnectDesc")}
                                </p>
                            </div>
                            <button
                                onClick={handleDisconnect}
                                disabled={disconnecting}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2 rounded-[10px] border border-[rgba(255,71,87,0.3)] text-[var(--danger)] bg-transparent text-[13px] font-semibold cursor-pointer transition-opacity",
                                    disconnecting && "opacity-70 cursor-not-allowed"
                                )}
                            >
                                {disconnecting ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <LogOut size={14} />
                                )}
                                {t("messenger.disconnect")}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
