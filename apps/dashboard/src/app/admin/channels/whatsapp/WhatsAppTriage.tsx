"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, ChevronLeft, Smartphone, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { guidedTourAnchorId } from "@/lib/guided-tours";
import {
    WHATSAPP_TRIAGE_ANSWERS,
    getWhatsAppTriageAnswer,
    rememberTriage,
    whatsAppTriageKey,
    type WhatsAppTriageAnswer,
    type WhatsAppTriageAnswerId,
} from "./whatsapp-triage";

export interface WhatsAppTriageProps {
    tenantId?: string | null;
    /** The person chose a route: open Meta's window on it. */
    onRoute: (answer: WhatsAppTriageAnswer) => void;
    /** The person cannot connect today, with the reason. */
    onLater?: (answer: WhatsAppTriageAnswer) => void;
    /**
     * Shows the three routes anyway. Without it an answer that stays here ends
     * on a card with nothing to press, and the only way forward is to give an
     * answer that is not true.
     */
    onShowAllRoutes?: () => void;
    /** Rendered under the outcome: "mientras tanto {Nombre} ya atiende por su enlace". */
    meanwhile?: React.ReactNode;
    initialAnswerId?: WhatsAppTriageAnswerId | null;
}

/**
 * The question that replaces the three checkboxes nobody could fail.
 *
 * The old pre-check asked her to confirm she had a number, the verification
 * code and a Facebook account — it verified nothing, cost 48 seconds on the
 * recording, and she read its three items as three hard requirements. This
 * asks the one thing that actually decides the route, and only then shows the
 * three lines she needs and the time it takes her.
 *
 * It keeps the old tour anchor id so the guided tours that point at this step
 * keep landing on it.
 */
export default function WhatsAppTriage({ tenantId, onRoute, onLater, onShowAllRoutes, meanwhile, initialAnswerId = null }: WhatsAppTriageProps) {
    const t = useTranslations("channels.whatsapp.triage");
    const [answerId, setAnswerId] = useState<WhatsAppTriageAnswerId | null>(initialAnswerId);
    const answer = getWhatsAppTriageAnswer(answerId);

    function choose(next: WhatsAppTriageAnswer) {
        setAnswerId(next.id);
        rememberTriage(tenantId, next.id);
    }

    if (!answer) {
        return (
            <div id={guidedTourAnchorId("whatsapp-prerequisites")}>
                <div className="mb-4 flex items-center gap-3 border-b border-neutral-200 pb-4 dark:border-white/10">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <Smartphone size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">{t("question")}</p>
                        <p className="text-[12px] text-muted-foreground">{t("questionHint")}</p>
                    </div>
                </div>
                <div className="space-y-2" role="group" aria-label={t("question")}>
                    {WHATSAPP_TRIAGE_ANSWERS.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => choose(option)}
                            className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left transition-colors hover:border-emerald-500/40 dark:border-white/10 dark:bg-white/[0.04]"
                        >
                            <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-medium leading-snug text-foreground">{t(whatsAppTriageKey(option, "Title"))}</span>
                                <span className="block text-[12px] leading-snug text-muted-foreground">{t(whatsAppTriageKey(option, "Hint"))}</span>
                            </span>
                            <ArrowRight size={16} className="shrink-0 text-muted-foreground" />
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    const needs = Array.from({ length: answer.needCount }, (_, i) => i + 1);
    const later = answer.outcome.kind === "later";
    const install = answer.outcome.kind === "install_business_app";

    return (
        <div id={guidedTourAnchorId("whatsapp-prerequisites")}>
            <button
                type="button"
                onClick={() => { setAnswerId(null); rememberTriage(tenantId, null); }}
                className="mb-4 inline-flex cursor-pointer items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
            >
                <ChevronLeft size={14} /> {t("changeAnswer")}
            </button>

            <div className={cn(
                "rounded-xl border p-4",
                later ? "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10" : "border-neutral-200 bg-white dark:border-white/10 dark:bg-white/[0.04]",
            )}>
                <p className="text-sm font-semibold text-foreground">{t(whatsAppTriageKey(answer, "Title"))}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{t(whatsAppTriageKey(answer, "Lead"))}</p>

                {/* Three lines, never more: the long detail lives behind "Ver más"
                    in the route brief, where it belongs. */}
                <ul className="mt-3 space-y-1.5">
                    {needs.map((i) => (
                        <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-foreground">
                            <Check size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                            <span>{t(whatsAppTriageKey(answer, `Need${i}`))}</span>
                        </li>
                    ))}
                </ul>

                {/* The time is the person's own hands-on minutes, and it appears
                    only here — on the cards it used to read as the total wait. */}
                {answer.minutes !== null && (
                    <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Timer size={12} /> {t("minutes", { minutes: answer.minutes })}
                    </p>
                )}

                <div className="mt-4">
                    {answer.outcome.kind === "route" && (
                        <button
                            type="button"
                            onClick={() => onRoute(answer)}
                            className="w-full cursor-pointer rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                        >
                            {t("continue")}
                        </button>
                    )}
                    {install && (
                        <button
                            type="button"
                            onClick={() => onRoute(answer)}
                            className="w-full cursor-pointer rounded-xl border border-neutral-200 bg-white py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-emerald-500/40 dark:border-white/10 dark:bg-white/[0.04]"
                        >
                            {t("installDone")}
                        </button>
                    )}
                    {(later || answer.alsoPostpone) && onLater && (
                        <button
                            type="button"
                            onClick={() => onLater(answer)}
                            className={cn(
                                "w-full cursor-pointer rounded-xl border py-2.5 text-sm font-semibold transition-colors",
                                answer.alsoPostpone
                                    ? "mt-2 border-neutral-200 bg-white text-foreground hover:border-amber-400 dark:border-white/10 dark:bg-white/[0.04]"
                                    : "border-amber-300 bg-white text-amber-900 hover:bg-amber-50 dark:border-amber-500/30 dark:bg-transparent dark:text-amber-200",
                            )}
                        >
                            {t("later")}
                        </button>
                    )}
                    {later && onShowAllRoutes && (
                        <button
                            type="button"
                            onClick={onShowAllRoutes}
                            className="mt-2 w-full cursor-pointer text-[12px] font-medium text-muted-foreground underline hover:text-foreground"
                        >
                            {t("allRoutes")}
                        </button>
                    )}
                </div>
            </div>

            {(later || install) && meanwhile && <div className="mt-3">{meanwhile}</div>}
        </div>
    );
}
