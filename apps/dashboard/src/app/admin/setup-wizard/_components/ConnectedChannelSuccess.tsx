"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import type { ConnectedChannelDetails } from "../connect-channels";

/**
 * The victory for Instagram, Messenger and Telegram.
 *
 * Connecting one of them used to set a flag and nothing else: the list of
 * channels vanished, the WhatsApp question stayed on screen as if nothing had
 * happened, and nobody said "Instagram conectado". This is the same moment
 * WhatsApp's connected state gives: what is connected, how to see the agent
 * answer there, and the one button that moves on.
 */
export function ConnectedChannelSuccess({ connected, channelName, onContinue }: {
    connected: ConnectedChannelDetails;
    /** "Instagram", already translated. */
    channelName: string;
    onContinue: () => void;
}) {
    const t = useTranslations("setupWizard.connect");

    return (
        <div
            role="status"
            data-connected-channel={connected.channel}
            className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10"
        >
            <div className="flex items-start gap-2.5">
                <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{t("connectedChannel.title", { channel: channelName })}</p>
                    {connected.label && (
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{connected.label}</p>
                    )}
                    <p className="mt-2 text-[13px] leading-relaxed text-foreground">
                        {t(`connectedChannel.test.${connected.channel}`)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={onContinue}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700 cursor-pointer"
                        >
                            {t("continue")} <ArrowRight size={14} aria-hidden="true" />
                        </button>
                        {connected.href && (
                            <a
                                href={connected.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/5"
                            >
                                {t(`connectedChannel.open.${connected.channel}`)} <ExternalLink size={13} aria-hidden="true" />
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
