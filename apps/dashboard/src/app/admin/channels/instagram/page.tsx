"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";
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
    LogOut,
    Loader2,
    RefreshCw,
    Clock,
} from "lucide-react";

const BRAND_COLOR = "#E4405F";
const INSTAGRAM_APP_ID = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID || "1472258884595741";
const INSTAGRAM_REDIRECT_URI = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI || "https://admin.parallly-chat.cloud/admin/channels/instagram/callback";

export default function InstagramSetupPage() {
    const t = useTranslations("channels");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [status, setStatus] = useState<any>(null);
    const [config, setConfig] = useState<{ webhookUrl?: string; verifyToken?: string } | null>(null);

    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [copied, setCopied] = useState("");
    const [message, setMessage] = useState({ type: "", text: "" });

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const statusRes = await api.fetch("/channels/instagram/status");
            setStatus(statusRes);
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
    }, [activeTenantId]);

    useEffect(() => { loadData(); }, [loadData]);

    // Listen for postMessage from the OAuth callback popup
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;

            if (event.data?.type === "ig_oauth_success") {
                setMessage({ type: "success", text: t("instagram.connectSuccess") });
                setConnecting(false);
                loadData();
            } else if (event.data?.type === "ig_oauth_error") {
                setMessage({ type: "error", text: event.data.message || t("instagram.connectFailed") });
                setConnecting(false);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [loadData, t]);

    const handleOAuthConnect = () => {
        const state = crypto.randomUUID();
        sessionStorage.setItem("ig_oauth_state", state);

        setConnecting(true);
        setMessage({ type: "", text: "" });

        const params = new URLSearchParams({
            enable_fb_login: "0",
            force_authentication: "1",
            client_id: INSTAGRAM_APP_ID,
            redirect_uri: INSTAGRAM_REDIRECT_URI,
            response_type: "code",
            scope: "instagram_business_basic,instagram_business_manage_messages",
            state,
        });

        const url = `https://www.instagram.com/oauth/authorize?${params.toString()}`;
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const popup = window.open(
            url,
            "instagram_oauth",
            `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
        );

        // If popup was blocked, fall back to redirect
        if (!popup) {
            window.location.href = url;
        }
    };

    const handleDisconnect = async () => {
        if (!confirm(t("instagram.disconnectConfirm"))) return;
        setDisconnecting(true);
        setMessage({ type: "", text: "" });
        try {
            await api.fetch("/channels/instagram/disconnect", { method: "POST" });
            setMessage({ type: "success", text: t("instagram.disconnectSuccess") });
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
    const channel = status?.channel;

    // Token expiration
    const tokenExpiresAt = channel?.token_expires_at ? new Date(channel.token_expires_at) : null;
    const now = new Date();
    const daysUntilExpiry = tokenExpiresAt
        ? Math.ceil((tokenExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;
    const isTokenExpired = daysUntilExpiry !== null && daysUntilExpiry <= 0;
    const isTokenExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 7;
    const hasTokenError = status?.status === "error" || isTokenExpired;

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
                            {t("instagramTitle")}
                        </h1>
                    </div>
                    <p className="text-[var(--text-secondary)] mt-1">
                        {t("instagramDesc")}
                    </p>
                </div>
                <div
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold border",
                        isConnected && !hasTokenError
                            ? "bg-[rgba(0,214,143,0.1)] text-[var(--success)] border-[rgba(0,214,143,0.2)]"
                            : "bg-[rgba(255,71,87,0.1)] text-[var(--danger)] border-[rgba(255,71,87,0.2)]"
                    )}
                >
                    {isConnected && !hasTokenError ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {isConnected && !hasTokenError ? t("connected") : t("disconnected")}
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

            {/* Token expired/error banner */}
            {isConnected && hasTokenError && (
                <div className="p-4 rounded-xl mb-6 text-sm border bg-[rgba(255,170,0,0.1)] text-[var(--warning)] border-[rgba(255,170,0,0.2)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AlertCircle size={16} />
                        <span>{t("instagram.tokenExpired")}</span>
                    </div>
                    <button
                        onClick={handleOAuthConnect}
                        disabled={connecting}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--warning)] text-black text-xs font-semibold cursor-pointer border-none"
                    >
                        <RefreshCw size={12} />
                        {t("instagram.reconnect")}
                    </button>
                </div>
            )}

            {!isConnected ? (
                /* ── Not Connected: OAuth Button ── */
                <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                    <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                        <LinkIcon size={18} style={{ color: BRAND_COLOR }} />
                        <h2 className="text-base font-semibold m-0 text-foreground">
                            {t("instagram.connectTitle")}
                        </h2>
                    </div>
                    <div className="p-6">
                        <p className="text-sm text-[var(--text-secondary)] mb-6">
                            {t("instagram.connectDesc")}
                        </p>
                        <button
                            onClick={handleOAuthConnect}
                            disabled={connecting}
                            className={cn(
                                "flex items-center justify-center gap-2 w-full py-3 rounded-[10px] border-none text-white font-semibold text-sm cursor-pointer transition-opacity",
                                connecting && "opacity-70 cursor-not-allowed"
                            )}
                            style={{ background: BRAND_COLOR }}
                        >
                            {connecting ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    {t("instagram.oauthConnecting")}
                                </>
                            ) : (
                                <>
                                    <Instagram size={16} />
                                    {t("instagram.connectWithInstagram")}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            ) : (
                /* ── Connected State ── */
                <>
                    {/* Account Info */}
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                        <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                            <User size={18} style={{ color: BRAND_COLOR }} />
                            <h2 className="text-base font-semibold m-0 text-foreground">
                                {t("instagram.connectedAccount")}
                            </h2>
                        </div>
                        <div className="p-6">
                            <div className="flex items-center gap-4">
                                {channel?.profile_picture_url ? (
                                    <img
                                        src={channel.profile_picture_url}
                                        alt={channel.display_name || "Instagram"}
                                        className="w-16 h-16 rounded-full object-cover border-2 border-border"
                                    />
                                ) : (
                                    <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: BRAND_COLOR }}>
                                        <Instagram size={28} className="text-white" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="text-base font-semibold text-foreground">
                                        {channel?.display_name ? `@${channel.display_name}` : "\u2014"}
                                    </p>
                                    {channel?.metadata?.account_type && (
                                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                                            {channel.metadata.account_type}
                                        </p>
                                    )}
                                    <p className="text-xs font-mono text-[var(--text-secondary)] mt-1">
                                        ID: {channel?.account_id || "\u2014"}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[rgba(0,214,143,0.1)] text-[var(--success)] border border-[rgba(0,214,143,0.2)]">
                                    <CheckCircle size={12} />
                                    {t("connected")}
                                </div>
                            </div>

                            {/* Token expiration info */}
                            {daysUntilExpiry !== null && !isTokenExpired && (
                                <div className={cn(
                                    "mt-4 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border",
                                    isTokenExpiringSoon
                                        ? "bg-[rgba(255,170,0,0.1)] text-[var(--warning)] border-[rgba(255,170,0,0.2)]"
                                        : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-border"
                                )}>
                                    <Clock size={14} />
                                    {t("instagram.tokenExpiresIn", { days: daysUntilExpiry })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Webhook Config Card */}
                    {config?.webhookUrl && (
                        <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-6">
                            <div className="px-6 py-5 border-b border-border flex items-center gap-2.5">
                                <Shield size={18} className="text-[#e67e22]" />
                                <h2 className="text-base font-semibold m-0 text-foreground">
                                    {t("webhook")}
                                </h2>
                            </div>
                            <div className="p-6">
                                <label className="text-[13px] font-semibold mb-2 block text-foreground">
                                    {t("callbackUrl")}
                                </label>
                                <div
                                    className="relative bg-[var(--bg-tertiary)] p-3 px-4 rounded-lg border border-border font-mono text-xs text-primary break-all cursor-pointer"
                                    onClick={() => config?.webhookUrl && copyToClipboard(config.webhookUrl, "url")}
                                    title={tc("clickToCopy")}
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
                                    {t("instagram.disconnectTitle")}
                                </h3>
                                <p className="text-xs text-[var(--text-secondary)]">
                                    {t("instagram.disconnectDesc")}
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
                                {t("instagram.disconnect")}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
