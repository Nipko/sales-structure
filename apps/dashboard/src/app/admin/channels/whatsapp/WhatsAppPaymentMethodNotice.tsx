"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { META_PAYMENT_METHOD_URL, paymentRequiredNow, type PaymentVerdict } from "./connected-readiness";

/**
 * The payment method on the WhatsApp account, said the way a business owner
 * needs to hear it on day 0: what it is, that Meta charges it and not us, and
 * the date after which Meta stops delivering replies without it.
 *
 * Healthy is one quiet line. Anything else — missing, refused, or simply not
 * established — is a clear next step, because the most common "we could not
 * tell" is an account with no card (the KNOWN GAP in the API's funding
 * reading). It never blocks anything: adding a card happens in Meta, on
 * Meta's schedule, and the owner may do it later from Canales → WhatsApp.
 *
 * Presentational. Reading and re-checking live with the caller, which also
 * decides whether the agent may be called "answering".
 */
export default function WhatsAppPaymentMethodNotice({
    verdict,
    now,
    rechecking,
    onRecheck,
}: {
    verdict: PaymentVerdict;
    now: number;
    rechecking: boolean;
    /** Absent for a person who may not ask Meta (the check is admin-only). */
    onRecheck?: () => void;
}) {
    const t = useTranslations("channels.whatsapp.afterConnect.payment");
    const tc = useTranslations("channels.whatsapp.afterConnect");
    const headingId = useId();

    // Only the FIRST reading collapses to one line. A re-check the person asked
    // for keeps the card, so the button she pressed does not vanish under her.
    if (verdict === "checking") {
        return (
            <p role="status" className="m-0 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin shrink-0" aria-hidden="true" />
                {t("checking")}
            </p>
        );
    }

    if (verdict === "ready") {
        return (
            <p className="m-0 flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {t("ready")}
            </p>
        );
    }

    const loud = verdict === "missing" || verdict === "restricted";
    const finding = verdict === "missing" ? t("missing") : verdict === "restricted" ? t("restricted") : t("unestablished");

    return (
        <section
            aria-labelledby={headingId}
            className={cn(
                "rounded-xl p-4",
                loud
                    ? "border-2 border-amber-400 dark:border-amber-500/50 bg-amber-50 dark:bg-amber-500/10"
                    : "border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04]",
            )}
        >
            <div className="flex items-start gap-2.5">
                {loud ? (
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                ) : (
                    <CreditCard size={18} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                    <h3 id={headingId} className="m-0 text-sm font-semibold text-foreground">{t("title")}</h3>
                    <p className={cn("mt-1 mb-0 text-xs font-semibold", loud ? "text-amber-900 dark:text-amber-200" : "text-foreground")}>
                        {finding}
                    </p>
                    <p className="mt-2 mb-0 text-xs leading-relaxed text-muted-foreground">{t("what")}</p>
                    {/* A refusal is already happening; the deadline is about adding
                        a method that is not there. */}
                    {verdict !== "restricted" && (
                        <p className="mt-2 mb-0 text-xs leading-relaxed text-muted-foreground">
                            {paymentRequiredNow(now) ? t("dateAfter") : t("dateBefore")}
                        </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <a
                            href={META_PAYMENT_METHOD_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700"
                        >
                            {t("open")}
                            <ExternalLink size={13} aria-hidden="true" />
                            <span className="sr-only">({tc("opensInNewTab")})</span>
                        </a>
                        {onRecheck && (
                            <button
                                type="button"
                                onClick={onRecheck}
                                disabled={rechecking}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5 cursor-pointer"
                            >
                                {rechecking && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
                                {rechecking ? t("rechecking") : t("recheck")}
                            </button>
                        )}
                    </div>
                    <p className="mt-2 mb-0 text-[12px] text-muted-foreground">{t("later")}</p>
                </div>
            </div>
        </section>
    );
}
