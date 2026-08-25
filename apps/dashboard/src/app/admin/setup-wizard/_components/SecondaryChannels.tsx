"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Instagram, Facebook, Send, Globe, ArrowRight, ChevronDown, Loader2 } from "lucide-react";

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || "";
const MESSENGER_CONFIG_ID = process.env.NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID || "1288798860026149";
const INSTAGRAM_APP_ID = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID || "1472258884595741";
const INSTAGRAM_REDIRECT_URI = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI || "https://admin.parallly-chat.cloud/admin/channels/instagram/callback";

interface Props {
    tenantId: string;
    onConnected?: () => void;
}

/**
 * Conexión de canales secundarios DENTRO del wizard, sin sacar al usuario del flujo:
 *  - Telegram: form inline (bot token).
 *  - Messenger: FB.login() vía SDK (popup propio de Meta, el wizard sigue montado).
 *  - Instagram: popup OAuth + BroadcastChannel("ig_oauth") de retorno.
 *  - Webchat: 1 click crea el widget.
 * Todos los inline llaman onConnected() al conectar → el wizard avanza a "Descúbrelo".
 */
export default function SecondaryChannels({ tenantId, onConnected }: Props) {
    const t = useTranslations("setupWizard.connect");
    const tc = useTranslations("common");

    const [busy, setBusy] = useState<string | null>(null);       // canal conectándose
    const [tgOpen, setTgOpen] = useState(false);
    const [botToken, setBotToken] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});

    const setError = (id: string, msg: string) => setErrors((e) => ({ ...e, [id]: msg }));
    const clearError = (id: string) => setErrors((e) => { const n = { ...e }; delete n[id]; return n; });

    // --- Instagram retorno vía BroadcastChannel ---
    useEffect(() => {
        const ch = new BroadcastChannel("ig_oauth");
        ch.onmessage = (event) => {
            if (event.data?.type === "ig_oauth_success") {
                clearError("instagram");
                setBusy(null);
                onConnected?.();
            } else if (event.data?.type === "ig_oauth_error") {
                setError("instagram", event.data.message || tc("connectionError"));
                setBusy(null);
            }
        };
        return () => ch.close();
    }, [onConnected, tc]);

    const connectTelegram = async () => {
        if (!botToken.trim()) return;
        setBusy("telegram"); clearError("telegram");
        try {
            await api.fetch("/channels/telegram/connect", { method: "POST", body: JSON.stringify({ botToken: botToken.trim() }) });
            setBotToken(""); setTgOpen(false);
            onConnected?.();
        } catch (err: any) {
            setError("telegram", err?.message || err?.data?.message || tc("connectionError"));
        } finally { setBusy(null); }
    };

    const connectMessenger = () => {
        const w = window as any;
        setBusy("messenger"); clearError("messenger");
        const doLogin = () => {
            if (!w.FB) { setError("messenger", tc("connectionError")); setBusy(null); return; }
            w.FB.login((response: any) => {
                const token = response.authResponse?.accessToken;
                if (!token) { setBusy(null); return; } // usuario canceló
                api.messengerOAuthConnect(token)
                    .then((r: any) => {
                        if (r?.success) onConnected?.();
                        else setError("messenger", r?.error || tc("connectionError"));
                    })
                    .catch((e: any) => setError("messenger", e?.message || tc("connectionError")))
                    .finally(() => setBusy(null));
            }, { config_id: MESSENGER_CONFIG_ID, response_type: "token", override_default_response_type: true, auth_type: "rerequest" });
        };
        // Carga el SDK on-demand (no en mount) para no pisar el fbAsyncInit del panel de WhatsApp.
        if (w.FB) { doLogin(); return; }
        w.fbAsyncInit = function () {
            try { w.FB.init({ appId: META_APP_ID, cookie: true, xfbml: false, version: "v21.0" }); } catch { /* ya inicializado */ }
            doLogin();
        };
        if (!document.querySelector('script[src*="connect.facebook.net"]')) {
            const s = document.createElement("script");
            s.src = "https://connect.facebook.net/en_US/sdk.js";
            s.async = true; s.defer = true;
            document.body.appendChild(s);
        }
    };

    const connectInstagram = () => {
        clearError("instagram"); setBusy("instagram");
        const state = crypto.randomUUID();
        localStorage.setItem("ig_oauth_state", state);
        const params = new URLSearchParams({
            enable_fb_login: "0", force_authentication: "1",
            client_id: INSTAGRAM_APP_ID, redirect_uri: INSTAGRAM_REDIRECT_URI,
            response_type: "code", scope: "instagram_business_basic,instagram_business_manage_messages", state,
        });
        const url = `https://www.instagram.com/oauth/authorize?${params.toString()}`;
        const w = 600, h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top = window.screenY + (window.outerHeight - h) / 2;
        const popup = window.open(url, "instagram_oauth", `width=${w},height=${h},left=${left},top=${top},scrollbars=yes`);
        if (!popup) {
            // No redirigir (sacaría del wizard); pedir permitir popups.
            setError("instagram", t("popupBlocked"));
            setBusy(null);
            return;
        }
        // Si cierran el popup sin terminar, liberar el estado "conectando".
        const poll = setInterval(() => {
            if (popup.closed) { clearInterval(poll); setBusy((b) => (b === "instagram" ? null : b)); }
        }, 600);
    };

    const connectWebchat = async () => {
        setBusy("webchat"); clearError("webchat");
        try {
            await api.fetch(`/widgets/${tenantId}`, { method: "POST", body: JSON.stringify({ name: "Web Chat" }) });
            onConnected?.();
        } catch (err: any) {
            setError("webchat", err?.message || err?.data?.message || tc("connectionError"));
        } finally { setBusy(null); }
    };

    const cardCls = "flex items-center gap-3 p-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] hover:border-indigo-500/30 text-left transition-all cursor-pointer disabled:opacity-60 disabled:cursor-default";

    const ChannelButton = ({ id, icon: Icon, color, onClick, expandable }: { id: string; icon: any; color: string; onClick: () => void; expandable?: boolean }) => (
        <button onClick={onClick} disabled={busy === id} className={cardCls}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: color }}>
                <Icon size={16} />
            </div>
            <span className="text-[13px] text-foreground flex-1">{t(`channel_${id}`)}</span>
            {busy === id ? <Loader2 size={14} className="text-muted-foreground shrink-0 animate-spin" />
                : expandable ? <ChevronDown size={14} className={`text-muted-foreground shrink-0 transition-transform ${tgOpen ? "rotate-180" : ""}`} />
                : <ArrowRight size={14} className="text-muted-foreground shrink-0" />}
        </button>
    );

    return (
        <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <ChannelButton id="instagram" icon={Instagram} color="#E4405F" onClick={connectInstagram} />
                <ChannelButton id="messenger" icon={Facebook} color="#0084FF" onClick={connectMessenger} />
                <ChannelButton id="telegram" icon={Send} color="#0088CC" onClick={() => setTgOpen((v) => !v)} expandable />
                <ChannelButton id="webchat" icon={Globe} color="#00b894" onClick={connectWebchat} />
            </div>

            {/* Errores inline por canal */}
            {(["instagram", "messenger", "webchat"] as const).map((id) => errors[id] ? (
                <p key={id} className="text-[12px] text-rose-500 mt-1.5">{t(`channel_${id}`)}: {errors[id]}</p>
            ) : null)}

            {/* Form inline de Telegram */}
            {tgOpen && (
                <div className="mt-2.5 p-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-500/5">
                    <p className="text-[12px] text-muted-foreground mb-2">{t("telegramHint")}</p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={botToken}
                            onChange={(e) => setBotToken(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") connectTelegram(); }}
                            placeholder={t("telegramPlaceholder")}
                            className="flex-1 min-w-0 py-2 px-3 rounded-lg border border-neutral-300 dark:border-white/10 bg-white dark:bg-neutral-800 text-foreground text-[13px] outline-none focus:border-indigo-500"
                        />
                        <button
                            onClick={connectTelegram}
                            disabled={busy === "telegram" || !botToken.trim()}
                            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white transition-colors"
                        >
                            {busy === "telegram" ? <Loader2 size={14} className="animate-spin" /> : t("telegramConnect")}
                        </button>
                    </div>
                    {errors.telegram && <p className="text-[12px] text-rose-500 mt-1.5">{errors.telegram}</p>}
                </div>
            )}

            <p className="text-[11px] text-muted-foreground mt-2">{t("otherChannelsHint")}</p>
        </div>
    );
}
