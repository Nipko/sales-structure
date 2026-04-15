"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import {
    Globe,
    MessageSquare,
    Instagram,
    MessageCircle,
    Send,
    CheckCircle,
    AlertCircle,
    ArrowRight,
} from "lucide-react";

const channels = [
    {
        key: "whatsapp",
        name: "WhatsApp",
        color: "#25D366",
        Icon: MessageSquare,
        href: "/admin/channels/whatsapp",
        description: "WhatsApp Business API via Meta Cloud API",
    },
    {
        key: "instagram",
        name: "Instagram DM",
        color: "#E4405F",
        Icon: Instagram,
        href: "/admin/channels/instagram",
        description: "Instagram Direct Messages via Graph API",
    },
    {
        key: "messenger",
        name: "Facebook Messenger",
        color: "#0084FF",
        Icon: MessageCircle,
        href: "/admin/channels/messenger",
        description: "Messenger via Facebook Page integration",
    },
    {
        key: "telegram",
        name: "Telegram",
        color: "#0088cc",
        Icon: Send,
        href: "/admin/channels/telegram",
        description: "Telegram Bot API — mensajes directos automatizados",
    },
];

export default function ChannelsOverviewPage() {
    const t = useTranslations('channels');
    const { activeTenantId } = useTenant();
    const router = useRouter();
    const [connectedChannels, setConnectedChannels] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const res = await api.fetch("/channels/overview");
                const list = res?.data || res;
                if (Array.isArray(list)) {
                    setConnectedChannels(list.map((ch: any) => ch.channel_type || ch.channelType));
                }
            } catch (err) {
                console.error("Failed to load channel overview", err);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [activeTenantId]);

    if (loading) {
        return (
            <div className="p-8 text-center text-[var(--text-secondary)]">
                Cargando canales...
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[960px]">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-2.5 mb-1">
                    <div className="flex items-center justify-center w-10 h-10 rounded-[10px] bg-primary">
                        <Globe size={20} className="text-white" />
                    </div>
                    <h1 className="text-[28px] font-bold m-0 text-foreground">
                        {t('title')}
                    </h1>
                </div>
                <p className="text-[var(--text-secondary)] mt-1 ml-[50px]">
                    Gestiona tus canales de comunicacion
                </p>
            </div>

            {/* Channel Cards Grid */}
            <div className="grid grid-cols-3 gap-6">
                {channels.map((ch) => {
                    const isConnected = connectedChannels.includes(ch.key);
                    return (
                        <div
                            key={ch.key}
                            className="rounded-2xl border border-border bg-card overflow-hidden cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                            onClick={() => router.push(ch.href)}
                        >
                            {/* Card Top */}
                            <div className="p-6 flex flex-col items-center gap-4">
                                <div
                                    className="w-14 h-14 rounded-[14px] flex items-center justify-center"
                                    style={{ background: ch.color }}
                                >
                                    <ch.Icon size={28} className="text-white" />
                                </div>
                                <div className="text-center">
                                    <h2 className="text-lg font-bold m-0 text-foreground">
                                        {ch.name}
                                    </h2>
                                    <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                                        {ch.description}
                                    </p>
                                </div>

                                {/* Status Badge */}
                                <div
                                    className={cn(
                                        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border",
                                        isConnected
                                            ? "bg-[rgba(0,214,143,0.1)] text-[var(--success)] border-[rgba(0,214,143,0.2)]"
                                            : "bg-[rgba(152,152,176,0.1)] text-[var(--text-secondary)] border-[rgba(152,152,176,0.15)]"
                                    )}
                                >
                                    {isConnected ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                                    {isConnected ? "Conectado" : "Desconectado"}
                                </div>
                            </div>

                            {/* Card Footer */}
                            <div className="px-6 py-3.5 border-t border-border flex items-center justify-center gap-2 text-primary text-[13px] font-semibold">
                                Configurar
                                <ArrowRight size={14} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
