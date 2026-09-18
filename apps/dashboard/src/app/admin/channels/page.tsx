"use client";

import { asCredentialHealth, CREDENTIAL_HEALTH_RANK,
    type ChannelCredentialHealth } from '@parallext/shared';
import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { HelpPanel } from "@/components/ui/help-panel";
import { LoadFailureNotice } from "@/components/ui/load-failure";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { guidedTourAnchorId } from "@/lib/guided-tours";
import { demoLinkPause, readSetupStatusFacts, type SetupStatusDemoLink } from "@/lib/onboarding-guide";
import { buildDemoLinkUrl } from "@/lib/widget-snippet";
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
    Link2,
    Link2Off,
    ExternalLink,
    Copy,
    Check,
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
    const { getChannelAccountLimit, features: planFeatures, loading: planLoading } = usePlanLimits();
    /**
     * What the public link IS for this plan, decided like the wizard's card
     * (`DemoLinkCard`) and like the chat decides each turn (`plan.widget`).
     * With the web chat in the plan it is a real channel; without it, a trial
     * the platform pays — capped, and no person ever takes over. "Cualquiera
     * puede escribirle" alone read as the first on every plan. `null` while
     * the plan is being read: neither story yet.
     */
    const linkIsChannel: boolean | null = planLoading ? null : planFeatures.widget === true;
    const router = useRouter();
    const searchParams = useSearchParams();
    /**
     * Parallly Assist sends people here already knowing which channel they came
     * to connect (`?type=whatsapp`). Landing on a grid of four and hunting for
     * the right card is the round trip that made the handoff worth building, so
     * the named card is marked and scrolled to. Nothing is opened for them: the
     * connection is theirs to make.
     */
    const focusedChannel = channels.some((ch) => ch.key === searchParams.get("type"))
        ? searchParams.get("type")
        : null;
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
    /**
     * "El enlace de {Nombre}": the agent's public page (D11). Not a channel
     * that connects or disconnects — it exists since day 0 and is always
     * reachable — so it gets its own card with no status badge. It comes from
     * setup-status; a read that fails simply shows no card, never a broken one.
     */
    const [demoLink, setDemoLink] = useState<SetupStatusDemoLink | null>(null);
    const [linkCopied, setLinkCopied] = useState(false);

    useEffect(() => {
        if (!activeTenantId) { setDemoLink(null); return; }
        let current = true;
        api.getSetupStatus(activeTenantId)
            .then((res) => { if (current) setDemoLink(readSetupStatusFacts(res)?.demoLink ?? null); })
            .catch(() => { if (current) setDemoLink(null); });
        return () => { current = false; };
    }, [activeTenantId, reloadToken]);

    useEffect(() => {
        if (!linkCopied) return;
        const timer = setTimeout(() => setLinkCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [linkCopied]);

    const copyDemoLink = async () => {
        if (!demoLink) return;
        try {
            await navigator.clipboard.writeText(buildDemoLinkUrl(demoLink.path));
            setLinkCopied(true);
        } catch { /* no clipboard: the link is visible on the card to copy by hand */ }
    };

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
                            data-channel-focus={focusedChannel === ch.key ? "true" : undefined}
                            ref={focusedChannel === ch.key
                                ? (node) => node?.scrollIntoView({ block: "center" })
                                : undefined}
                            className={cn(
                                "rounded-xl border bg-card overflow-hidden cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.3)]",
                                focusedChannel === ch.key
                                    ? "border-[var(--primary)] ring-2 ring-[var(--primary)]"
                                    : "border-border",
                            )}
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

                {/* The fifth card: the agent's public link. Never "connected"
                    or "disconnected" — there is nothing to connect. But it can
                    be PAUSED: the trial the platform pays stops when it is
                    switched off or the account used its free replies, and then
                    the card says so and offers nothing to open or copy. */}
                {demoLink && (() => {
                    const name = demoLink.agentName || t('demoLink.agentFallback');
                    const url = buildDemoLinkUrl(demoLink.path);
                    const pause = demoLinkPause(demoLink);
                    return (
                        <section
                            aria-labelledby="channel-demo-link-title"
                            className="rounded-xl border border-border bg-card overflow-hidden flex flex-col"
                        >
                            <div className="p-6 flex flex-col items-center gap-4 flex-1">
                                <div
                                    className="w-14 h-14 rounded-[14px] flex items-center justify-center"
                                    style={{ background: "#00b894" }}
                                >
                                    <Link2 size={28} className="text-white" aria-hidden="true" />
                                </div>
                                <div className="text-center">
                                    <h2 id="channel-demo-link-title" className="text-lg font-semibold m-0 text-foreground">
                                        {t('demoLink.title', { agentName: name })}
                                    </h2>
                                    {pause ? (
                                        <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                                            {t(`demoLink.paused.${pause}`, { agentName: name })}{" "}
                                            <Link href="/admin/settings/billing" className="font-semibold text-primary underline underline-offset-2">
                                                {t('demoLink.plans')}
                                            </Link>
                                        </p>
                                    ) : (
                                        <>
                                            {linkIsChannel !== null && (
                                                <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                                                    {linkIsChannel
                                                        ? t('demoLink.description')
                                                        : t('demoLink.descriptionTrial', { agentName: name })}
                                                </p>
                                            )}
                                            {/* On a trial: what a plan with the web chat changes,
                                                before anybody puts this link where customers use it. */}
                                            {linkIsChannel === false && (
                                                <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                                                    {t('demoLink.trialUpgrade')}{" "}
                                                    <Link href="/admin/settings/billing" className="font-semibold text-primary underline underline-offset-2">
                                                        {t('demoLink.plans')}
                                                    </Link>
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                                {pause ? (
                                    <div
                                        data-channel-status="paused"
                                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/30"
                                    >
                                        <Link2Off size={14} aria-hidden="true" />
                                        {t('demoLink.pausedBadge')}
                                    </div>
                                ) : (
                                    <div
                                        data-channel-status="always"
                                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border bg-[rgba(108,92,231,0.1)] text-primary border-[rgba(108,92,231,0.2)]"
                                    >
                                        <Link2 size={14} aria-hidden="true" />
                                        {t('demoLink.always')}
                                    </div>
                                )}
                                {!pause && <p className="select-all break-all text-center font-mono text-[11px] text-[var(--text-secondary)]">{url}</p>}
                            </div>
                            {!pause && (
                            <div className="px-6 py-3.5 border-t border-border flex items-center justify-center gap-2">
                                <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`${t('demoLink.open')} (${t('demoLink.opensInNewTab')})`}
                                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-primary text-[13px] font-semibold hover:bg-[rgba(108,92,231,0.08)]"
                                >
                                    <ExternalLink size={14} aria-hidden="true" /> {t('demoLink.open')}
                                </a>
                                <button
                                    type="button"
                                    onClick={() => void copyDemoLink()}
                                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-foreground hover:bg-[rgba(152,152,176,0.12)] cursor-pointer"
                                >
                                    {linkCopied
                                        ? <Check size={14} aria-hidden="true" className="text-[var(--success)]" />
                                        : <Copy size={14} aria-hidden="true" />}
                                    {linkCopied ? t('demoLink.copied') : t('demoLink.copy')}
                                </button>
                            </div>
                            )}
                        </section>
                    );
                })()}
            </div>
        </div>
    );
}
