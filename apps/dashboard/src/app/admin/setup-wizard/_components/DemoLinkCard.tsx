"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, Copy, ExternalLink, Globe, Instagram, Link2, Share2 } from "lucide-react";
import { buildDemoLinkUrl } from "@/lib/widget-snippet";
import type { SetupStatusDemoLink } from "@/lib/onboarding-guide";

/**
 * "El enlace de {Nombre}" inside the wizard's last step.
 *
 * Five things a person can do with the link, in the words they would use:
 * open it, copy it, put it in the Instagram bio, show it to a partner over
 * WhatsApp, and go set up the chat on their own website. Nothing here
 * creates anything — the link exists since day 0 — so every action is either
 * a navigation (a real link, keyboard-reachable by itself) or a copy.
 *
 * The website action is a LINK, never a copy: this card is about the DEMO
 * widget the platform pays for (daily cap, lifetime allowance, no human
 * handoff). Handing its embed snippet out would put the owner's real site on
 * the demo widget, which dies when the allowance runs out. The tenant's own
 * web chat is created — and its two lines copied — on the web-chat settings
 * page, so that is where this sends them.
 *
 * The copy that leads somewhere else leaves a one-line hint on screen that
 * stays until the next action: a "Copiado" that vanishes in two seconds is not
 * enough to tell somebody where to paste.
 */

/** Where the tenant's OWN web chat is created and its snippet copied. */
const WEB_CHAT_SETTINGS_PATH = "/admin/settings/integrations/web-chat";

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
    const name = (agentName ?? "").trim() || demoLink.agentName || t("demoLink.agentFallback");
    const url = buildDemoLinkUrl(demoLink.path);

    const [copied, setCopied] = useState<CopyTarget | null>(null);
    const [hint, setHint] = useState<"bio" | "failed" | null>(null);
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
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{t("demoLink.why")}</p>
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
                <button type="button" onClick={() => void copy("bio", url)} className={actionCls}>
                    {copied === "bio"
                        ? <Check size={13} aria-hidden="true" className="text-emerald-600" />
                        : <Instagram size={13} aria-hidden="true" />}
                    {copied === "bio" ? t("demoLink.copied") : t("demoLink.bio")}
                </button>
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
                    tenant's own widget, which is created on that page. */}
                <Link href={WEB_CHAT_SETTINGS_PATH} className={actionCls}>
                    <Globe size={13} aria-hidden="true" /> {t("demoLink.website")}
                </Link>
            </div>

            {/* Always on screen: it says what that page is for, before the click. */}
            <p className="mt-2 text-[12px] text-muted-foreground">{t("demoLink.websiteHint")}</p>

            {/* Announced, and left on screen: it says where to paste. */}
            <p role="status" aria-live="polite" className="mt-1 min-h-[1rem] text-[12px] text-muted-foreground">
                {hint === "bio" && t("demoLink.bioHint")}
                {hint === "failed" && t("demoLink.copyFailed")}
            </p>
        </section>
    );
}
