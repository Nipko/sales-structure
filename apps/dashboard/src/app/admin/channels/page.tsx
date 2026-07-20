"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { HelpPanel } from "@/components/ui/help-panel";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { cn } from "@/lib/utils";
import {
    Globe,
    MessageSquare,
    Instagram,
    MessageCircle,
    Send,
    Phone,
    Mail,
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
        description: "whatsappDesc",
    },
    {
        key: "instagram",
        name: "Instagram DM",
        color: "#E4405F",
        Icon: Instagram,
        href: "/admin/channels/instagram",
        description: "instagramDesc",
    },
    {
        key: "messenger",
        name: "Facebook Messenger",
        color: "#0084FF",
        Icon: MessageCircle,
        href: "/admin/channels/messenger",
        description: "messengerDesc",
    },
    {
        key: "telegram",
        name: "Telegram",
        color: "#0088cc",
        Icon: Send,
        href: "/admin/channels/telegram",
        description: "telegramDesc",
    },
    {
        key: "email",
        name: "Email",
        color: "#6c5ce7",
        Icon: Mail,
        href: "/admin/channels/email",
        description: "emailDesc",
    },
    // SMS hidden until integration is ready
    // { key: "sms", name: "SMS (Twilio)", color: "#0D9B47", Icon: Phone, href: "/admin/channels/sms", description: "smsDesc" },
];

export default function ChannelsOverviewPage() {
    const t = useTranslations('channels');
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();
    const { getChannelAccountLimit } = usePlanLimits();
    const router = useRouter();
    const [connectedChannels, setConnectedChannels] = useState<string[]>([]);
    const [accountCounts, setAccountCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const res = await api.fetch("/channels/overview");
                const list = res?.data || res;
                if (Array.isArray(list)) {
                    setConnectedChannels(list.map((ch: any) => ch.channel_type || ch.channelType));
                    const counts: Record<string, number> = {};
                    for (const ch of list) {
                        const type = ch.channel_type || ch.channelType;
                        if (type) counts[type] = (counts[type] || 0) + 1;
                    }
                    setAccountCounts(counts);
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
                {t('loading')}
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
                    <h1 className="text-[28px] font-semibold m-0 text-foreground">
                        {t('title')}
                    </h1>
                </div>
                <p className="text-[var(--text-secondary)] mt-1 ml-[50px]">
                    {t('subtitle')}
                </p>
            </div>

            <HelpPanel
                title={tHelp("channels.title")}
                description={tHelp("channels.description")}
                tips={tHelp.raw("channels.tips") as string[]}
                mediaKey="channels"
            />

            {/* Channel Cards Grid */}
            <div className="grid grid-cols-3 gap-6">
                {channels.map((ch) => {
                    const isConnected = connectedChannels.includes(ch.key);
                    const MULTI = ["whatsapp", "instagram", "messenger", "telegram", "sms"];
                    const showCount = MULTI.includes(ch.key);
                    const count = accountCounts[ch.key] || 0;
                    const limit = getChannelAccountLimit(ch.key); // null = unlimited
                    const limitStr = limit === null ? "∞" : String(limit);
                    const canAddMore = isConnected && (limit === null || count < limit);
                    return (
                        <div
                            key={ch.key}
                            className="rounded-xl border border-border bg-card overflow-hidden cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
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
                                    <h2 className="text-lg font-semibold m-0 text-foreground">
                                        {ch.name}
                                    </h2>
                                    <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                                        {t(ch.description)}
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
                                    {isConnected ? t('connected') : t('disconnected')}
                                </div>

                                {/* Multi-account count / plan limit */}
                                {showCount && isConnected && (
                                    <div className="flex flex-col items-center gap-0.5">
                                        <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                                            {t('accountsUsed', { count, limit: limitStr })}
                                        </span>
                                        {canAddMore && (
                                            <span className="text-[10px] text-primary font-semibold">{t('addAnother')}</span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Card Footer */}
                            <div className="px-6 py-3.5 border-t border-border flex items-center justify-center gap-2 text-primary text-[13px] font-semibold">
                                {t('configure')}
                                <ArrowRight size={14} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
