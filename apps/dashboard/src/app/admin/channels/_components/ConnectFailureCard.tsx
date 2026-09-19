"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, RotateCw } from "lucide-react";
import type { ChannelConnectFailure } from "./connect-errors";

/**
 * The one card a failed connection is allowed to produce.
 *
 * Same anatomy as the WhatsApp card (`WhatsAppEmbeddedSignup.tsx`): a title
 * saying what happened, ONE line saying what to do, and at most one control —
 * retry when retrying is the fix, a link when the fix is elsewhere. Nothing the
 * provider wrote is rendered here; `namespace` points at copy we wrote.
 *
 * `role="alert"` because the card appears after a button press, often below the
 * fold on a phone: a screen reader has to hear it without being sent looking.
 */
export function ConnectFailureCard({
    namespace,
    failure,
    onRetry,
}: {
    /** e.g. `channels.instagram.errors`. */
    namespace: string;
    failure: ChannelConnectFailure;
    /** Omitted where retrying is impossible (the OAuth popup cannot relaunch itself). */
    onRetry?: () => void;
}) {
    const te = useTranslations(namespace);

    return (
        <div
            role="alert"
            className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10"
        >
            <div className="flex items-start gap-2.5">
                <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
                        {te(`${failure.key}.title`)}
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
                        {te(`${failure.key}.action`)}
                    </p>
                    {(failure.retryable && onRetry) || (failure.href && failure.hrefLabelKey) ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            {failure.retryable && onRetry && (
                                <button
                                    type="button"
                                    onClick={onRetry}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-amber-700"
                                >
                                    <RotateCw size={13} aria-hidden="true" /> {te("retry")}
                                </button>
                            )}
                            {failure.href && failure.hrefLabelKey && (
                                <Link
                                    href={failure.href}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/60 px-3 py-2 text-[12px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/10"
                                >
                                    {te(failure.hrefLabelKey)} <ArrowRight size={13} aria-hidden="true" />
                                </Link>
                            )}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
