"use client";

import { asCredentialHealth, CREDENTIAL_HEALTH_RANK,
    type ChannelCredentialHealth } from '@parallext/shared';
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { HelpPanel } from "@/components/ui/help-panel";
import { LoadFailureNotice } from "@/components/ui/load-failure";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { guidedTourAnchorId } from "@/lib/guided-tours";
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
    HelpCircle,
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
];

export default function ChannelsOverviewPage() {
    const t = useTranslations('channels');
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();
    const { getChannelAccountLimit } = usePlanLimits();
    const router = useRouter();
    const [connectedChannels, setConnectedChannels] = useState<string[]>([]);
    const [accountCounts, setAccountCounts] = useState<Record<string, number>>({});
    // Credential health per channel: a channel can be "connected" and still be
    // unable to send (expired/revoked token), which used to be invisible here.
    const [credHealth, setCredHealth] = useState<Record<string, { status: ChannelCredentialHealth; days: number | null }>>({});
    // A failed read is its own state. It used to collapse into the initial
    // empty list, so a network blip painted every channel "Desconectado" —
    // the one word that makes a tenant go looking for a connection that never
    // broke. An unreadable overview is not an empty overview.
    const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
    const [reloadToken, setReloadToken] = useState(0);

    useEffect(() => {
        let current = true;
        async function load() {
            setStatus("loading");
            try {
                const res = await api.fetch("/channels/overview");
                const list = res?.data || res;
                // A response we cannot parse tells us nothing about the account
                // either, so it takes the same unreadable path as a rejection.
                if (!Array.isArray(list)) throw new Error("channel_overview_malformed");
                const counts: Record<string, number> = {};
                const health: Record<string, { status: ChannelCredentialHealth; days: number | null }> = {};
                for (const ch of list) {
                    const type = ch.channel_type || ch.channelType;
                    if (!type) continue;
                    counts[type] = (counts[type] || 0) + 1;
                    const st = asCredentialHealth(ch.credentialStatus);
                    // Worst-first, because a healthy sibling account must never
                    // hide an expired one. The previous version just kept the
                    // last row it saw, which is account order, not severity.
                    const worse = !health[type] || CREDENTIAL_HEALTH_RANK[st] > CREDENTIAL_HEALTH_RANK[health[type].status];
                    if (st !== 'ok' && worse) {
                        health[type] = { status: st, days: ch.credentialDaysToExpiry ?? null };
                    }
                }
                if (!current) return;
                setConnectedChannels(list.map((ch: any) => ch.channel_type || ch.channelType));
                setAccountCounts(counts);
                setCredHealth(health);
                setStatus("ready");
            } catch (err) {
                console.error("Failed to load channel overview", err);
                if (!current) return;
                // Drop the stale readings: showing last minute's answer next to
                // a "we could not read this" notice is worse than showing none.
                setConnectedChannels([]);
                setAccountCounts({});
                setCredHealth({});
                setStatus("unavailable");
            }
        }
        load();
        return () => { current = false; };
    }, [activeTenantId, reloadToken]);

    if (status === "loading") {
        return (
            <div className="p-8 text-center text-[var(--text-secondary)]">
                {t('loading')}
            </div>
        );
    }

    const unavailable = status === "unavailable";

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
                tourId="connect_channel"
            />

            {/* The read failed. Say so where the answer would have been, and
                offer the only useful action, instead of letting every card
                below quietly assert something we never verified. */}
            {unavailable && (
                <LoadFailureNotice
                    className="mb-6"
                    title={t('overviewUnavailable')}
                    hint={t('overviewUnavailableHint')}
                    onRetry={() => setReloadToken((token) => token + 1)}
                />
            )}

            {/* Channel Cards Grid */}
            <div id={guidedTourAnchorId("channel-cards")} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {channels.map((ch) => {
                    const isConnected = connectedChannels.includes(ch.key);
                    const MULTI = ["whatsapp", "instagram", "messenger", "telegram", "web_widget"];
                    const showCount = MULTI.includes(ch.key);
                    const count = accountCounts[ch.key] || 0;
                    const limit = getChannelAccountLimit(ch.key); // null = unlimited
                    const limitStr = limit === null ? "∞" : String(limit);
                    const canAddMore = isConnected && (limit === null || count < limit);
                    return (
                        <div
                            key={ch.key}
                            id={ch.key === "whatsapp"
                                ? guidedTourAnchorId("channel-card-whatsapp")
                                : guidedTourAnchorId(`channel-card-${ch.key}`)}
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

                                {/* Status Badge. Three states, not two: an
                                    unreadable overview must not borrow the word
                                    "Desconectado", which claims we looked. */}
                                <div
                                    // The three states the badge already tells apart,
                                    // said in something other than a colour: a guided
                                    // tour can read this, a class name it cannot.
                                    data-channel-status={unavailable ? "unknown" : isConnected ? "connected" : "disconnected"}
                                    className={cn(
                                        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border",
                                        unavailable
                                            ? "bg-[rgba(255,170,0,0.12)] text-[var(--warning)] border-[rgba(255,170,0,0.25)]"
                                            : isConnected
                                                ? "bg-[rgba(0,214,143,0.1)] text-[var(--success)] border-[rgba(0,214,143,0.2)]"
                                                : "bg-[rgba(152,152,176,0.1)] text-[var(--text-secondary)] border-[rgba(152,152,176,0.15)]"
                                    )}
                                    title={unavailable ? t('overviewUnavailableHint') : undefined}
                                >
                                    {unavailable
                                        ? <HelpCircle size={14} aria-hidden="true" />
                                        : isConnected
                                            ? <CheckCircle size={14} aria-hidden="true" />
                                            : <AlertCircle size={14} aria-hidden="true" />}
                                    {unavailable ? t('statusUnknown') : isConnected ? t('connected') : t('disconnected')}
                                </div>

                                {/* Credential health: "connected" is not the same as
                                    "able to send". An expired or revoked token kept
                                    showing a green badge while replies silently failed,
                                    and so did `unknown` — the API's own word for a
                                    credential table it could not read. */}
                                {isConnected && credHealth[ch.key] && (
                                    <div
                                        className={cn(
                                            "flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border",
                                            credHealth[ch.key].status === 'expiring' || credHealth[ch.key].status === 'unknown'
                                                ? "bg-[rgba(255,170,0,0.12)] text-[var(--warning)] border-[rgba(255,170,0,0.25)]"
                                                : "bg-[rgba(255,71,87,0.12)] text-[var(--danger)] border-[rgba(255,71,87,0.25)]"
                                        )}
                                        title={credHealth[ch.key].status === 'unknown'
                                            ? t('credentialUnknownHint')
                                            : t('credentialHint')}
                                    >
                                        {credHealth[ch.key].status === 'unknown'
                                            ? <HelpCircle size={12} aria-hidden="true" />
                                            : <AlertCircle size={12} aria-hidden="true" />}
                                        {credHealth[ch.key].status === 'unknown'
                                            ? t('credentialUnknown')
                                            : credHealth[ch.key].status === 'expiring'
                                                ? t('credentialExpiring', { days: credHealth[ch.key].days ?? 0 })
                                                : t('credentialNeedsReauth')}
                                    </div>
                                )}

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
