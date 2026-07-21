"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { usePlanLimits } from "@/hooks/usePlanLimits";
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
    Trash2,
    Plus,
} from "lucide-react";
import { DisconnectChannelModal } from "@/components/ui/disconnect-channel-modal";
import { HelpPanel } from "@/components/ui/help-panel";

const BRAND_COLOR = "#E4405F";
const INSTAGRAM_APP_ID = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID || "1472258884595741";
const INSTAGRAM_REDIRECT_URI = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI || "https://admin.parallly-chat.cloud/admin/channels/instagram/callback";

/**
 * IG avatar with graceful fallback. Instagram profile-picture URLs are signed CDN
 * links that expire (there's no stable public-by-id endpoint like Facebook pages
 * have), so if the image fails we degrade to the channel icon instead of a broken
 * thumbnail. (A permanent fix would self-host the avatar at connect time.)
 */
function IgAvatar({ src, alt }: { src?: string; alt: string }) {
    const [errored, setErrored] = useState(false);
    if (!src || errored) {
        return (
            <div className="w-16 h-16 rounded-full flex items-center justify-center border-2 border-border" style={{ background: BRAND_COLOR }}>
                <Instagram size={28} className="text-white" />
            </div>
        );
    }
    return (
        <img
            src={src}
            alt={alt}
            onError={() => setErrored(true)}
            referrerPolicy="no-referrer"
            className="w-16 h-16 rounded-full object-cover border-2 border-border"
        />
    );
}

export default function InstagramSetupPage() {
    const t = useTranslations("channels");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();
    const { canAddChannelAccount } = usePlanLimits();

    const [status, setStatus] = useState<any>(null);
    const [config, setConfig] = useState<{ webhookUrl?: string; verifyToken?: string } | null>(null);

    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [copied, setCopied] = useState("");
    const [message, setMessage] = useState({ type: "", text: "" });
    const [showDisconnectModal, setShowDisconnectModal] = useState(false);

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

    // Listen for OAuth result via BroadcastChannel (works across same-origin windows)
    useEffect(() => {
        const channel = new BroadcastChannel("ig_oauth");
        channel.onmessage = (event) => {
            if (event.data?.type === "ig_oauth_success") {
                setMessage({ type: "success", text: t("instagram.connectSuccess") });
                setConnecting(false);
                loadData();
            } else if (event.data?.type === "ig_oauth_error") {
                setMessage({ type: "error", text: event.data.message || t("instagram.connectFailed") });
                setConnecting(false);
            }
        };
        return () => channel.close();
    }, [loadData, t]);

    const handleOAuthConnect = () => {
        const state = crypto.randomUUID();
        localStorage.setItem("ig_oauth_state", state);

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

        if (!popup) {
            // Popup blocked — fall back to same-window redirect
            window.location.href = url;
        }
    };

    const handleDisconnect = async () => {
        setDisconnecting(true);
        setMessage({ type: "", text: "" });
        try {
            const res = await api.fetch("/channels/instagram/disconnect", { method: "DELETE" });
            setShowDisconnectModal(false);
            if (res?.providerOk === false) {
                setMessage({ type: "warning", text: res.message || t("instagram.disconnectPartial") });
            } else if (res?.providerExpired) {
                // Soft success: IG token was already expired, nothing to revoke
                setMessage({ type: "info", text: res.message || t("instagram.disconnectSuccess") });
            } else {
                setMessage({ type: "success", text: t("instagram.disconnectSuccess") });
            }
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

    const handleDisconnectOne = async (accountId: string) => {
        if (!accountId) return;
        if (!window.confirm(t("disconnectAccountConfirm"))) return;
        try {
            const res = await api.disconnectChannelAccount("instagram", accountId);
            if (res?.success) await loadData();
            else setMessage({ type: "error", text: (res as any)?.error || tc("connectionError") });
        } catch { setMessage({ type: "error", text: tc("connectionError") }); }
    };

    const statusData = status?.data || status;
    const isConnected = statusData?.connected === true;
    const channel = statusData?.account;
    const accounts: any[] = statusData?.accounts?.length ? statusData.accounts : (channel ? [channel] : []);
    const canAddInstagram = canAddChannelAccount("instagram", accounts.length);

    // Token expiration — read from API's tokenExpiresAt field
    const rawExpiry = statusData?.tokenExpiresAt || channel?.token_expires_at;
    const tokenExpiresAt = rawExpiry ? new Date(rawExpiry) : null;
    const now = new Date();
    const daysUntilExpiry = tokenExpiresAt
        ? Math.ceil((tokenExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;
    const isTokenExpired = daysUntilExpiry !== null && daysUntilExpiry <= 0;
    const isTokenExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 7;
    const hasTokenError = statusData?.status === "error" || isTokenExpired;

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

            <HelpPanel
                title={tHelp("channelsInstagram.title")}
                description={tHelp("channelsInstagram.description")}
                tips={tHelp.raw("channelsInstagram.tips") as string[]}
                mediaKey="channelsInstagram"
            />

            {/* Alert Message */}
            {message.text && (
                <div
                    className={cn(
                        "p-4 rounded-xl mb-6 text-sm border",
                        message.type === "error"
                            ? "bg-[rgba(255,71,87,0.1)] text-[var(--danger)] border-[rgba(255,71,87,0.2)]"
                            : message.type === "warning"
                            ? "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900"
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
                            <div className="flex flex-col gap-4">
                                {accounts.map((acc: any, idx: number) => (
                                    <div key={acc.accountId || acc.account_id || idx} className="flex items-center gap-4">
                                        <IgAvatar
                                            src={acc?.metadata?.profilePicture || acc?.profile_picture_url}
                                            alt={acc.displayName || acc.display_name || "Instagram"}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-base font-semibold text-foreground">
                                                {acc?.displayName || acc?.display_name || "\u2014"}
                                            </p>
                                            {(acc?.metadata?.accountType || acc?.metadata?.account_type) && (
                                                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                                                    {acc.metadata.accountType || acc.metadata.account_type}
                                                </p>
                                            )}
                                            <p className="text-xs font-mono text-[var(--text-secondary)] mt-1">
                                                ID: {acc?.accountId || acc?.account_id || "\u2014"}
                                            </p>
                                        </div>
                                        {accounts.length > 1 ? (
                                            <button
                                                onClick={() => handleDisconnectOne(acc?.accountId || acc?.account_id)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(255,71,87,0.3)] bg-transparent text-[var(--danger)] text-[12px] font-semibold cursor-pointer hover:bg-[rgba(255,71,87,0.1)] transition-colors shrink-0"
                                            >
                                                <Trash2 size={13} /> {t("disconnectAccount")}
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[rgba(0,214,143,0.1)] text-[var(--success)] border border-[rgba(0,214,143,0.2)]">
                                                <CheckCircle size={12} />
                                                {t("connected")}
                                            </div>
                                        )}
                                    </div>
                                ))}
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

                    {/* Connect another account (plan-gated) */}
                    {canAddInstagram && (
                        <button
                            onClick={handleOAuthConnect}
                            disabled={connecting}
                            className="w-full mb-6 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-border bg-[var(--bg-secondary)] text-foreground text-[13px] font-semibold cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-60"
                        >
                            <Plus size={16} style={{ color: BRAND_COLOR }} /> {t("addAnother")}
                        </button>
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
                                onClick={() => setShowDisconnectModal(true)}
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

            <DisconnectChannelModal
                open={showDisconnectModal}
                onClose={() => setShowDisconnectModal(false)}
                onConfirm={handleDisconnect}
                channelName="Instagram"
                description={t("instagram.disconnectDesc")}
                loading={disconnecting}
            />
        </div>
    );
}
