"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Instagram, Facebook, Send, Mail, Globe, ArrowRight, ChevronDown, Loader2 } from "lucide-react";

// Canales que se conectan en su propia página (OAuth / setup dedicado). Navegan en la
// MISMA pestaña (no _blank): el wizard persiste su estado y se restaura al volver.
const NAV_CHANNELS = [
    { id: "instagram", href: "/admin/channels/instagram", icon: Instagram, color: "#E4405F" },
    { id: "messenger", href: "/admin/channels/messenger", icon: Facebook, color: "#0084FF" },
    { id: "email", href: "/admin/channels/email", icon: Mail, color: "#6c5ce7" },
    { id: "webchat", href: "/admin/settings/integrations/web-chat", icon: Globe, color: "#00b894" },
];

export default function SecondaryChannels({ onConnected }: { onConnected?: () => void }) {
    const t = useTranslations("setupWizard.connect");
    const tc = useTranslations("common");
    const router = useRouter();

    // Telegram se conecta INLINE (form de bot token, sin OAuth) → no saca al usuario del wizard.
    const [tgOpen, setTgOpen] = useState(false);
    const [botToken, setBotToken] = useState("");
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState("");

    const connectTelegram = async () => {
        if (!botToken.trim()) return;
        setConnecting(true);
        setError("");
        try {
            await api.fetch("/channels/telegram/connect", {
                method: "POST",
                body: JSON.stringify({ botToken: botToken.trim() }),
            });
            setBotToken("");
            setTgOpen(false);
            onConnected?.(); // el wizard avanza a "Descúbrelo" sin salir
        } catch (err: any) {
            setError(err?.message || err?.data?.message || tc("connectionError"));
        } finally {
            setConnecting(false);
        }
    };

    const cardCls = "flex items-center gap-3 p-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] hover:border-indigo-500/30 text-left transition-all cursor-pointer";

    return (
        <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Telegram — inline */}
                <button onClick={() => setTgOpen((v) => !v)} className={cardCls}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: "#0088CC" }}>
                        <Send size={16} />
                    </div>
                    <span className="text-[13px] text-foreground flex-1">{t("channel_telegram")}</span>
                    <ChevronDown size={14} className={`text-muted-foreground shrink-0 transition-transform ${tgOpen ? "rotate-180" : ""}`} />
                </button>

                {/* Resto de canales — navegan en la misma pestaña */}
                {NAV_CHANNELS.map((ch) => {
                    const Icon = ch.icon;
                    return (
                        <button key={ch.id} onClick={() => router.push(ch.href)} className={cardCls}>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: ch.color }}>
                                <Icon size={16} />
                            </div>
                            <span className="text-[13px] text-foreground flex-1">{t(`channel_${ch.id}`)}</span>
                            <ArrowRight size={14} className="text-muted-foreground shrink-0" />
                        </button>
                    );
                })}
            </div>

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
                            disabled={connecting || !botToken.trim()}
                            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white transition-colors"
                        >
                            {connecting ? <Loader2 size={14} className="animate-spin" /> : t("telegramConnect")}
                        </button>
                    </div>
                    {error && <p className="text-[12px] text-rose-500 mt-1.5">{error}</p>}
                </div>
            )}

            <p className="text-[11px] text-muted-foreground mt-2">{t("otherChannelsHint")}</p>
        </div>
    );
}
