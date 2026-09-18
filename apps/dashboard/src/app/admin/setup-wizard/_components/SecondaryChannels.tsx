"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { META_CONNECT_ERROR } from "@parallext/shared";
import { api } from "@/lib/api";
import { buildDemoLinkUrl } from "@/lib/widget-snippet";
import type { SetupStatusDemoLink } from "@/lib/onboarding-guide";
import { Link2, ArrowRight, ChevronDown, Loader2, ExternalLink, Lock } from "lucide-react";
import { ConnectFailureCard } from "../../channels/_components/ConnectFailureCard";
import { readConnectErrorCode, readConnectEvidence, readConnectRetryable } from "../../channels/_components/connect-errors";
import {
    isChannelInPlan,
    planNamesIncluding,
    readInstagramCallback,
    readMessengerConnected,
    readTelegramConnected,
    wizardConnectFailure,
    type ConnectedChannelDetails,
    type SecondaryChannel,
    type WizardChannel,
    type WizardConnectFailure,
} from "../connect-channels";
import { CHANNEL_VISUALS } from "./channel-visuals";
import { EmailGateNotice } from "./EmailGateNotice";

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || "";
const MESSENGER_CONFIG_ID = process.env.NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID || "1288798860026149";
const INSTAGRAM_APP_ID = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID || "1472258884595741";
const INSTAGRAM_REDIRECT_URI = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI || "https://admin.parallly-chat.cloud/admin/channels/instagram/callback";

interface Props {
    /** Kept for the caller's sake; every connection here is tenant-scoped by the session already. */
    tenantId: string;
    /** Instagram, Messenger and Telegram, in the order the business recipe put them. */
    channels: readonly SecondaryChannel[];
    /** The recipe's first recommendation, which wears the "Recomendado" mark. */
    recommended?: WizardChannel | null;
    /** The plan's channel list; `null` = not known, which locks nothing. */
    planChannels: readonly string[] | null;
    /** True when the API will refuse these three for an unconfirmed email. */
    emailBlocked?: boolean;
    /** Only shown to name where the code went, when `emailBlocked`. */
    email?: string;
    /** Names the notice and the list use for each channel, already translated. */
    channelName: (channel: SecondaryChannel) => string;
    /** "El enlace de {Nombre}", from setup-status. Null hides the entry: nothing is created here. */
    demoLink?: SetupStatusDemoLink | null;
    /** The name the wizard is showing; it wins over what setup-status returned. */
    agentName?: string;
    onConnected?: (details: ConnectedChannelDetails) => void;
}

/**
 * Instagram, Messenger and Telegram, connected WITHOUT leaving the wizard:
 *  - Telegram: the key BotFather gives, pasted inline.
 *  - Messenger: FB.login() through the SDK (Meta's own window; the wizard stays mounted).
 *  - Instagram: OAuth window + BroadcastChannel("ig_oauth") for the result.
 *  - El enlace de {Nombre}: opens the public page in a new tab. Nothing is created here.
 *
 * Everything that can be known before a window opens is said before it opens:
 * a channel the plan does not include is shown as "incluido desde {plan}" and
 * has no button, and an unconfirmed email is said above the three it blocks.
 * Everything that goes wrong after is ONE card with ONE action — the same
 * cards the channel pages render — and never the provider's sentence.
 */
export default function SecondaryChannels({
    channels, recommended, planChannels, emailBlocked = false, email = "", channelName,
    demoLink, agentName, onConnected,
}: Props) {
    const t = useTranslations("setupWizard.connect");
    const tw = useTranslations("setupWizard");
    const tTelegram = useTranslations("channels.telegram");
    const locale = useLocale();

    const [busy, setBusy] = useState<SecondaryChannel | null>(null);
    const [tgOpen, setTgOpen] = useState(false);
    const [botToken, setBotToken] = useState("");
    const [failure, setFailure] = useState<WizardConnectFailure | null>(null);
    const [planNames, setPlanNames] = useState<Partial<Record<SecondaryChannel, string>>>({});

    const available = channels.filter((channel) => isChannelInPlan(channel, planChannels));
    const locked = channels.filter((channel) => !isChannelInPlan(channel, planChannels));
    const lockedKey = locked.join(",");

    // "Incluido desde {plan}" names a plan from the runtime catalogue, read
    // only when something is actually locked — a tenant whose plan covers all
    // three never makes this request.
    useEffect(() => {
        if (!lockedKey) return;
        let cancelled = false;
        void api.getBillingPlans().catch(() => null).then((body) => {
            if (!cancelled) setPlanNames(planNamesIncluding(body, lockedKey.split(",") as SecondaryChannel[]));
        });
        return () => { cancelled = true; };
    }, [lockedKey]);

    // The callback window posts `{type, code}`. The code is mapped to the same
    // card the Instagram page shows; there is no sentence to print.
    const onConnectedRef = useRef(onConnected);
    useEffect(() => { onConnectedRef.current = onConnected; }, [onConnected]);
    useEffect(() => {
        if (typeof BroadcastChannel === "undefined") return;
        const channel = new BroadcastChannel("ig_oauth");
        channel.onmessage = (event) => {
            const result = readInstagramCallback(event.data);
            if (!result) return;
            setBusy((current) => (current === "instagram" ? null : current));
            if (result.kind === "success") {
                setFailure(null);
                onConnectedRef.current?.({ channel: "instagram", label: null, href: null });
            } else {
                setFailure(wizardConnectFailure("instagram", result.code));
            }
        };
        return () => channel.close();
    }, []);

    /**
     * Losing focus is the proof Facebook's window opened. `FB.login` reports a
     * blocked pop-up and a closed one identically, and they have different
     * fixes ("allow pop-ups" vs "finish the window") — same signal the
     * Messenger page uses.
     */
    const windowOpenedRef = useRef(false);
    useEffect(() => {
        const onBlur = () => { windowOpenedRef.current = true; };
        window.addEventListener("blur", onBlur);
        return () => window.removeEventListener("blur", onBlur);
    }, []);

    /** Refused before any window: the API would say the same after it. */
    const refuseForEmail = (channel: SecondaryChannel): boolean => {
        if (!emailBlocked) return false;
        setFailure(wizardConnectFailure(channel, "email_not_verified"));
        return true;
    };

    const connectTelegram = async () => {
        if (!botToken.trim() || busy) return;
        if (refuseForEmail("telegram")) return;
        setBusy("telegram"); setFailure(null);
        try {
            const result = await api.connectTelegram(botToken.trim());
            if (result?.success) {
                setBotToken(""); setTgOpen(false);
                onConnected?.(readTelegramConnected(result));
                return;
            }
            // The card is built from the code (a key Telegram does not accept,
            // an unconfirmed email, a plan without Telegram); the server's
            // sentence beside it only goes to the console.
            console.warn("[setup-wizard] Telegram connect refused:", result?.errorCode ?? result?.error);
            setFailure(wizardConnectFailure("telegram", result?.errorCode ?? null));
        } catch (err) {
            console.warn("[setup-wizard] Telegram connect failed:", err);
            setFailure(wizardConnectFailure("telegram", null));
        } finally { setBusy(null); }
    };

    const connectMessenger = () => {
        if (refuseForEmail("messenger")) return;
        const w = window as any;
        setBusy("messenger"); setFailure(null);
        windowOpenedRef.current = false;
        const doLogin = () => {
            if (!w.FB) {
                setFailure(wizardConnectFailure("messenger", "sdk_not_loaded"));
                setBusy(null);
                return;
            }
            w.FB.login((response: any) => {
                const token = response?.authResponse?.accessToken;
                if (!token) {
                    setFailure(wizardConnectFailure(
                        "messenger",
                        windowOpenedRef.current ? META_CONNECT_ERROR.WINDOW_CANCELLED : "popup_blocked",
                    ));
                    setBusy(null);
                    return;
                }
                api.messengerOAuthConnect(token)
                    .then((result: any) => {
                        if (result?.success) {
                            onConnected?.(readMessengerConnected(result));
                            return;
                        }
                        // `result.error` is the service's prose on a non-2xx;
                        // the code beside it is what the card is built from.
                        console.warn("[setup-wizard] Messenger connect refused:", readConnectEvidence(result) ?? result);
                        setFailure(wizardConnectFailure("messenger", readConnectErrorCode(result), readConnectRetryable(result)));
                    })
                    .catch(() => setFailure(wizardConnectFailure("messenger", META_CONNECT_ERROR.UNAVAILABLE)))
                    .finally(() => setBusy(null));
            }, { config_id: MESSENGER_CONFIG_ID, response_type: "token", override_default_response_type: true, auth_type: "rerequest" });
        };
        // The SDK loads on demand (not on mount) so it does not step on the
        // WhatsApp panel's fbAsyncInit.
        if (w.FB) { doLogin(); return; }
        w.fbAsyncInit = function () {
            try { w.FB.init({ appId: META_APP_ID, cookie: true, xfbml: false, version: "v21.0" }); } catch { /* ya inicializado */ }
            doLogin();
        };
        if (!document.querySelector('script[src*="connect.facebook.net"]')) {
            const s = document.createElement("script");
            s.src = "https://connect.facebook.net/en_US/sdk.js";
            s.async = true; s.defer = true;
            s.onerror = () => {
                setFailure(wizardConnectFailure("messenger", "sdk_not_loaded"));
                setBusy(null);
            };
            document.body.appendChild(s);
        }
    };

    const connectInstagram = () => {
        if (refuseForEmail("instagram")) return;
        setFailure(null); setBusy("instagram");
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
            // Not a redirect: it would take her out of the wizard, and the
            // callback reports to a page that would no longer be listening.
            setFailure(wizardConnectFailure("instagram", "popup_blocked"));
            setBusy(null);
            return;
        }
        // Closed without finishing: release the "connecting" state.
        const poll = setInterval(() => {
            if (popup.closed) { clearInterval(poll); setBusy((b) => (b === "instagram" ? null : b)); }
        }, 600);
    };

    const openTelegram = () => {
        if (refuseForEmail("telegram")) return;
        setFailure((current) => (current?.channel === "telegram" ? null : current));
        setTgOpen((open) => !open);
    };

    const start: Record<SecondaryChannel, () => void> = {
        instagram: connectInstagram,
        messenger: connectMessenger,
        telegram: openTelegram,
    };

    const demoName = (agentName ?? "").trim() || demoLink?.agentName || tw("demoLink.agentFallback");
    const joinNames = (names: string[]) => {
        try { return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names); }
        catch { return names.join(", "); }
    };
    const lockedNote = locked.length > 0 ? wizardConnectFailure(locked[0], "channel_not_available") : null;

    const cardCls = "flex items-center gap-3 p-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-left transition-all";

    return (
        <div>
            {emailBlocked && available.length > 0 && (
                <EmailGateNotice channels={joinNames(available.map(channelName))} email={email} />
            )}

            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-channel-order={channels.join(",")}>
                {channels.map((channel) => {
                    const { icon: Icon, color } = CHANNEL_VISUALS[channel];
                    const name = channelName(channel);
                    if (!isChannelInPlan(channel, planChannels)) {
                        const plan = planNames[channel];
                        return (
                            <li key={channel} data-channel-locked={channel} className={`${cardCls} opacity-80`}>
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 grayscale" style={{ background: color }}>
                                    <Icon size={16} aria-hidden="true" />
                                </div>
                                <span className="flex-1 min-w-0">
                                    <span className="block text-[13px] text-foreground">{name}</span>
                                    <span className="block text-[11px] text-muted-foreground">
                                        {plan ? t("plan.includedFrom", { plan }) : t("plan.notInPlan")}
                                    </span>
                                </span>
                                <Lock size={14} aria-hidden="true" className="text-muted-foreground shrink-0" />
                            </li>
                        );
                    }
                    const isBusy = busy === channel;
                    return (
                        <li key={channel} className="list-none">
                            <button
                                type="button"
                                onClick={start[channel]}
                                disabled={isBusy}
                                aria-expanded={channel === "telegram" ? tgOpen : undefined}
                                className={`${cardCls} w-full hover:border-indigo-500/30 cursor-pointer disabled:opacity-60 disabled:cursor-default`}
                            >
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: color }}>
                                    <Icon size={16} aria-hidden="true" />
                                </div>
                                <span className="text-[13px] text-foreground flex-1">
                                    {name}
                                    {recommended === channel && (
                                        <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">{t("recommended")}</span>
                                    )}
                                </span>
                                {isBusy ? <Loader2 size={14} aria-hidden="true" className="text-muted-foreground shrink-0 animate-spin" />
                                    : channel === "telegram" ? <ChevronDown size={14} aria-hidden="true" className={`text-muted-foreground shrink-0 transition-transform ${tgOpen ? "rotate-180" : ""}`} />
                                        : <ArrowRight size={14} aria-hidden="true" className="text-muted-foreground shrink-0" />}
                            </button>
                        </li>
                    );
                })}
                {demoLink && (
                    <li className="list-none">
                        {/* A real link: it opens the public page in a new tab and posts nothing. */}
                        <a
                            href={buildDemoLinkUrl(demoLink.path)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${tw("demoLink.openLink", { agentName: demoName })} (${tw("discover.opensInNewTab")})`}
                            className={`${cardCls} hover:border-indigo-500/30`}
                        >
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: "#00b894" }}>
                                <Link2 size={16} aria-hidden="true" />
                            </div>
                            <span className="text-[13px] text-foreground flex-1">{tw("demoLink.openLink", { agentName: demoName })}</span>
                            <ExternalLink size={14} aria-hidden="true" className="text-muted-foreground shrink-0" />
                        </a>
                    </li>
                )}
            </ul>

            {/* One line for every locked channel, with the one place it is fixed. */}
            {lockedNote && (
                <LockedNote namespace={lockedNote.namespace} actionKey={`${lockedNote.failure.key}.action`}
                    href={lockedNote.failure.href} hrefLabelKey={lockedNote.failure.hrefLabelKey} />
            )}

            {failure && (
                <div className="mt-3" data-connect-failure={`${failure.channel}:${failure.failure.key}`}>
                    <ConnectFailureCard
                        namespace={failure.namespace}
                        failure={failure.failure}
                        // Telegram's retry re-sends the key already in the form; the
                        // card only offers it when the same key is the fix.
                        onRetry={failure.channel === "telegram" ? () => void connectTelegram() : start[failure.channel]}
                    />
                </div>
            )}

            {tgOpen && isChannelInPlan("telegram", planChannels) && (
                <div className="mt-2.5 p-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-500/5">
                    <label htmlFor="setup-telegram-key" className="block text-[12px] text-muted-foreground mb-2">{t("telegramHint")}</label>
                    <a
                        href="https://t.me/BotFather"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                    >
                        {tTelegram("openBotFather")} <ExternalLink size={12} aria-hidden="true" />
                    </a>
                    <div className="flex gap-2">
                        <input
                            id="setup-telegram-key"
                            type="text"
                            autoComplete="off"
                            value={botToken}
                            onChange={(e) => setBotToken(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") void connectTelegram(); }}
                            placeholder={t("telegramPlaceholder")}
                            className="flex-1 min-w-0 py-2 px-3 rounded-lg border border-neutral-300 dark:border-white/10 bg-white dark:bg-neutral-800 text-foreground text-[13px] outline-none focus:border-indigo-500"
                        />
                        <button
                            type="button"
                            onClick={() => void connectTelegram()}
                            disabled={busy === "telegram" || !botToken.trim()}
                            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white transition-colors"
                        >
                            {busy === "telegram" && <Loader2 size={14} aria-hidden="true" className="animate-spin" />}
                            {t("telegramConnect")}
                        </button>
                    </div>
                </div>
            )}

            {available.length > 0 && <p className="text-[11px] text-muted-foreground mt-2">{t("otherChannelsHint")}</p>}
        </div>
    );
}

function LockedNote({ namespace, actionKey, href, hrefLabelKey }: {
    namespace: string;
    actionKey: string;
    href?: string;
    hrefLabelKey?: string;
}) {
    const tn = useTranslations(namespace);
    return (
        <p className="mt-2 text-[12px] text-muted-foreground" data-plan-note>
            {tn(actionKey)}{" "}
            {href && hrefLabelKey && (
                <Link href={href} className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
                    {tn(hrefLabelKey)}
                </Link>
            )}
        </p>
    );
}
