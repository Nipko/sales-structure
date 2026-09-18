"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, MailWarning } from "lucide-react";
import { api } from "@/lib/api";

/**
 * "Confirm your email first", said BEFORE a window opens.
 *
 * Instagram, Messenger and Telegram are refused by the API until the email is
 * confirmed; WhatsApp is not. The wizard used to let the owner go through
 * Meta's whole window and only then answer with a refusal. This notice sits
 * above those three and carries the two actions the email banner already has —
 * send the code again, and "ya lo tengo" to type it — so the fix is one press
 * away from where the question arises. Same copy as the banner, same endpoint.
 */
export function EmailGateNotice({ channels, email }: {
    /** The channel names this blocks, already joined for reading ("Instagram, Messenger y Telegram"). */
    channels: string;
    email: string;
}) {
    const t = useTranslations("setupWizard.connect.emailGate");
    const tv = useTranslations("emailVerification");
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [failed, setFailed] = useState(false);

    const resend = async () => {
        setSending(true);
        setFailed(false);
        try {
            const res = await api.sendVerification();
            if (res?.success) setSent(true);
            else setFailed(true);
        } catch {
            // 503 when the email did not go out: say so, never "sent".
            setFailed(true);
        } finally {
            setSending(false);
        }
    };

    return (
        <div
            data-email-gate
            className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10"
        >
            <div className="flex items-start gap-2.5">
                <MailWarning size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">{t("title", { channels })}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">{t("body", { email })}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        {sent ? (
                            <span role="status" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
                                <CheckCircle2 size={14} aria-hidden="true" /> {tv("sent")}
                            </span>
                        ) : (
                            <button
                                type="button"
                                onClick={() => void resend()}
                                disabled={sending}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/60 px-3 py-1.5 text-[12px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-500/10 cursor-pointer"
                            >
                                {sending && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}
                                {tv("resend")}
                            </button>
                        )}
                        <Link
                            href="/verify-email"
                            className="inline-flex items-center rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-amber-700"
                        >
                            {tv("enterCode")}
                        </Link>
                    </div>
                    {failed && (
                        <p role="alert" className="mt-2 text-[12px] text-red-700 dark:text-red-300">{tv("sendFailed")}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
