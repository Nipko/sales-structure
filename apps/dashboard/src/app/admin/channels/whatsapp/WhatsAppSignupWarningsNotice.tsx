"use client";

import { useFormatter, useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { isKnownWhatsAppWarning } from "./WhatsAppEmbeddedSignup";
import { signupBlockers } from "./connected-readiness";
import type { SignupWarningGroup } from "./signup-warnings";

/**
 * "Conectado, con algunas cosas pendientes" on Canales → WhatsApp.
 *
 * It used to render only the warnings of a signup run on this page, and was
 * gone after a reload: a number Meta did not register, or whose webhooks it
 * did not confirm, then sat under a green "Conectado" with nothing on screen
 * saying its agent cannot answer. It now renders what the server kept for
 * every connected number (`signupWarningGroups`), says which number when there
 * is more than one, says so when what is open stops replies, and dates what
 * came from an earlier signup.
 */
export default function WhatsAppSignupWarningsNotice({
    groups,
    numberLabel,
    showNumbers,
    className,
}: {
    groups: readonly SignupWarningGroup[];
    /** The label of a number, as the page shows it elsewhere. */
    numberLabel: (phoneNumberId: string) => string;
    /** Name each number: the page lists more than one. */
    showNumbers: boolean;
    className?: string;
}) {
    const twn = useTranslations("channels.whatsapp.warnings");
    const ta = useTranslations("channels.whatsapp.afterConnect");
    const format = useFormatter();
    if (groups.length === 0) return null;
    const named = showNumbers || groups.length > 1;

    return (
        <div className={`rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 ${className ?? ""}`}>
            <div className="flex items-start gap-2.5">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{twn("title")}</p>
                    <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">{twn("subtitle")}</p>
                    {groups.map((group) => (
                        <div key={group.phoneNumberId || "this-signup"} className="mt-3">
                            {named && group.phoneNumberId && (
                                <p className="m-0 text-[12px] font-semibold text-amber-900 dark:text-amber-200">
                                    {numberLabel(group.phoneNumberId)}
                                </p>
                            )}
                            <ul className="mt-1 space-y-2">
                                {group.warnings.map((warning) => (
                                    <li key={warning} className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
                                        • {isKnownWhatsAppWarning(warning) ? twn(`codes.${warning}`) : warning}
                                    </li>
                                ))}
                            </ul>
                            {signupBlockers(group.warnings).length > 0 && (
                                <p className="mt-2 text-xs font-semibold text-amber-900 dark:text-amber-200">{ta("signupBlocksReplies")}</p>
                            )}
                            {group.recordedAt && (
                                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400/80">
                                    {twn("recordedOn", { date: format.dateTime(new Date(group.recordedAt), { dateStyle: "long" }) })}
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
