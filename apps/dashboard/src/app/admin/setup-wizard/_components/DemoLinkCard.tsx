"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, Copy, ExternalLink, Globe, Instagram, Link2, Link2Off, Loader2, Share2 } from "lucide-react";
import { buildDemoLinkUrl } from "@/lib/widget-snippet";
import { demoLinkPause, type SetupStatusDemoLink } from "@/lib/onboarding-guide";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";

/**
 * "El enlace de {Nombre}" inside the wizard's last step.
 *
 * Up to five things a person can do with the link, in the words they would
 * use: open it, copy it, put it in the Instagram bio, show it to a partner
 * over WhatsApp, and go set up the chat on their own website. Nothing here
 * creates anything — the link exists since day 0 — so every action is either
 * a navigation (a real link, keyboard-reachable by itself) or a copy.
 *
 * The website action is a LINK, never a copy: this card is about the public
 * link's widget, which on a trial is the one the platform pays for (daily
 * cap, lifetime allowance, no human handoff). Handing its embed snippet out
 * would put the owner's real site on that widget, which dies with the
 * allowance. The tenant's own web chat is created — and its two lines copied
 * — on the web-chat settings page, so that is where this sends them.
 *
 * The copy that leads somewhere else leaves a one-line hint on screen that
 * stays until the next action: a "Copiado" that vanishes in two seconds is not
 * enough to tell somebody where to paste.
 *
 * WHAT THE LINK IS depends on the plan, decided exactly like the chat decides
 * each turn (`plan.widget`). With the web chat in the plan it is a real
 * channel — the plan's quota, a person when the customer asks for one — and
 * the bio and the website are what it is for. Without it, the link is a
 * trial the platform pays: capped per day and in total, and no person ever
 * takes over. Selling that for an Instagram bio put real customers in front
 * of "En este canal todavía no puedo transferirte a una persona" and, at the
 * cap, of a chat that stops. So on a trial the card says what it is for —
 * trying the agent and showing it to someone — and what a plan with the web
 * chat changes; the bio and the website actions appear only when true.
 * Until the plan is read, neither story is told.
 *
 * AND WHETHER IT ANSWERS TODAY. That trial stops when the platform switches it
 * off or the account used its free replies (`demoLink.answers === false`).
 * Then "open it and write to it" is a promise of silence: the card says the
 * link is paused and why, with the two ways out (connect a channel, or a plan
 * with the web chat), and offers nothing to open, copy or share.
 */

/** Where the tenant's OWN web chat is created and its snippet copied. */
const WEB_CHAT_SETTINGS_PATH = "/admin/settings/integrations/web-chat";
/** Where a plan that includes the web chat is chosen. */
const PLANS_PATH = "/admin/settings/billing";

interface Props {
    demoLink: SetupStatusDemoLink;
    /** The name the wizard is showing; it wins over what setup-status returned. */
    agentName?: string;
}

type CopyTarget = "link" | "bio";

const COPIED_FOR_MS = 2000;

async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

export default function DemoLinkCard({ demoLink, agentName }: Props) {
    const t = useTranslations("setupWizard");
    const { activeTenantId } = useTenant();
    const [currentLink, setCurrentLink] = useState(demoLink);
    useEffect(() => setCurrentLink(demoLink), [demoLink]);
    const name = (agentName ?? "").trim() || currentLink.agentName || t("demoLink.agentFallback");
    const url = buildDemoLinkUrl(currentLink.path);
    const { features, loading } = usePlanLimits();
    const planCanOperate: boolean | null = loading ? null : features.widget === true;
    const isChannel = currentLink.usageMode === "operational";

    const [copied, setCopied] = useState<CopyTarget | null>(null);
    const [hint, setHint] = useState<"bio" | "failed" | null>(null);
    const [changingMode, setChangingMode] = useState(false);
    const [modeError, setModeError] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const copy = useCallback(async (target: CopyTarget, text: string) => {
        const ok = await copyText(text);
        if (!ok) { setCopied(null); setHint("failed"); return; }
        setCopied(target);
        setHint(target === "link" ? null : target);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(null), COPIED_FOR_MS);
    }, []);

    const changeMode = useCallback(async (usageMode: "trial" | "operational") => {
        if (!activeTenantId || changingMode) return;
        setChangingMode(true);
        setModeError(false);
        try {
            const response = await api.setDemoLinkUsageMode(activeTenantId, usageMode);
            const next = (response as any)?.data ?? response;
            setCurrentLink((previous) => ({
                ...previous,
                ...next,
                usageMode,
                answers: next?.answers !== false,
                unavailableReason: next?.answers === false ? next?.unavailableReason ?? null : null,
            }));
        } catch {
            setModeError(true);
        } finally {
            setChangingMode(false);
        }
    }, [activeTenantId, changingMode]);

    const pause = demoLinkPause(currentLink);
    if (pause) {
        return (
            <section
                aria-labelledby="setup-demo-link-title"
                data-demo-link-paused={pause}
                className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10"
            >
                <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-600 text-white">
                        <Link2Off size={16} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 id="setup-demo-link-title" className="text-[14px] font-semibold text-foreground">
                            {t("demoLink.title", { agentName: name })}
                        </h3>
                        <p className="mt-0.5 text-[12px] text-amber-900 dark:text-amber-200">
                            {t(`demoLink.paused.${pause}`, { agentName: name })}
                        </p>
                        <Link href={PLANS_PATH} className="mt-2 inline-flex text-[12px] font-semibold text-amber-900 underline underline-offset-2 dark:text-amber-200">
                            {t("demoLink.plans")}
                        </Link>
                        {currentLink.usageMode === "operational" && (
                            <button type="button" disabled={changingMode} onClick={() => void changeMode("trial")}
                                className="ml-3 mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-amber-900 underline underline-offset-2 disabled:opacity-50 dark:text-amber-200">
                                {changingMode && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                                {t("demoLink.useAsTrial")}
                            </button>
                        )}
                    </div>
                </div>
            </section>
        );
    }

    const shareHref = `https://wa.me/?text=${encodeURIComponent(t("demoLink.shareMessage", { agentName: name, url }))}`;
    const newTab = t("discover.opensInNewTab");

    const actionCls = "inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/5 cursor-pointer";

    return (
        <section
            aria-labelledby="setup-demo-link-title"
            className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-500/30 dark:bg-indigo-500/10"
        >
            <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-white">
                    <Link2 size={16} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 id="setup-demo-link-title" className="text-[14px] font-semibold text-foreground">
                        {t("demoLink.title", { agentName: name })}
                    </h3>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {isChannel ? t("demoLink.why") : t("demoLink.whyTrial", { agentName: name })}
                    </p>
                    <p className="mt-2 select-all break-all font-mono text-[12px] text-indigo-700 dark:text-indigo-300">{url}</p>
                </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${t("demoLink.open")} (${newTab})`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700"
                >
                    <ExternalLink size={13} aria-hidden="true" /> {t("demoLink.open")}
                </a>
                <button type="button" onClick={() => void copy("link", url)} className={actionCls}>
                    {copied === "link"
                        ? <Check size={13} aria-hidden="true" className="text-emerald-600" />
                        : <Copy size={13} aria-hidden="true" />}
                    {copied === "link" ? t("demoLink.copied") : t("demoLink.copy")}
                </button>
                {isChannel && (
                    <button type="button" onClick={() => void copy("bio", url)} className={actionCls}>
                        {copied === "bio"
                            ? <Check size={13} aria-hidden="true" className="text-emerald-600" />
                            : <Instagram size={13} aria-hidden="true" />}
                        {copied === "bio" ? t("demoLink.copied") : t("demoLink.bio")}
                    </button>
                )}
                <a
                    href={shareHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${t("demoLink.share")} (${newTab})`}
                    className={actionCls}
                >
                    <Share2 size={13} aria-hidden="true" /> {t("demoLink.share")}
                </a>
                {/* A navigation, not a copy: the snippet belongs to the
                    tenant's own widget, which is created on that page — and
                    that page exists only on a plan with the web chat. */}
                {isChannel && (
                    <Link href={WEB_CHAT_SETTINGS_PATH} className={actionCls}>
                        <Globe size={13} aria-hidden="true" /> {t("demoLink.website")}
                    </Link>
                )}
            </div>

            {/* Always on screen: it says what that page is for, before the click. */}
            {isChannel && <p className="mt-2 text-[12px] text-muted-foreground">{t("demoLink.websiteHint")}</p>}

            {planCanOperate === true && (
                <div className="mt-3 rounded-lg border border-indigo-200 bg-white/70 p-3 text-[12px] dark:border-indigo-500/20 dark:bg-black/10">
                    <p className="text-foreground">
                        {isChannel ? t("demoLink.operationalExplanation") : t("demoLink.activateExplanation")}
                    </p>
                    <button type="button" disabled={changingMode || !activeTenantId}
                        onClick={() => void changeMode(isChannel ? "trial" : "operational")}
                        className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                        {changingMode && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                        {t(isChannel ? "demoLink.useAsTrial" : "demoLink.useWithCustomers")}
                    </button>
                </div>
            )}

            {/* On a trial: what a plan with the web chat changes, said before
                anybody puts this link where customers will use it. */}
            {!isChannel && planCanOperate === false && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                    {t("demoLink.trialUpgrade")}{" "}
                    <Link href={PLANS_PATH} className="font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300">
                        {t("demoLink.plans")}
                    </Link>
                </p>
            )}

            {/* Announced, and left on screen: it says where to paste. */}
            <p role="status" aria-live="polite" className="mt-1 min-h-[1rem] text-[12px] text-muted-foreground">
                {hint === "bio" && t("demoLink.bioHint")}
                {hint === "failed" && t("demoLink.copyFailed")}
                {modeError && t("demoLink.modeError")}
            </p>
        </section>
    );
}
