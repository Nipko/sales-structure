"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Edit2, Loader2, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/format-money";
import {
    planPriceDisplay,
    planPriceErrorKey,
    type MembershipPlan,
    type PlanPriceChoice,
    type PlanPriceErrorKey,
} from "../plan-price";

/** What `onPriceStatusChange` resolves to: the API envelope, as `api.updateMembershipPlan` returns it. */
export interface PlanPriceChangeResult {
    success: boolean;
    error?: string;
    errorCode?: string;
}

interface PlanCardProps {
    plan: MembershipPlan;
    /**
     * The business currency (`useOperatingCurrency()` on the page), used only
     * when the row has none. Unknown means a bare number, never an invented
     * symbol.
     */
    operatingCurrency?: string | null;
    /** `focusPrice` opens the editor on the amount: "Escribir precio". */
    onEdit: (plan: MembershipPlan, options?: { focusPrice?: boolean }) => void;
    onDelete: (plan: MembershipPlan) => void;
    /** "Confirmar precio" / "Es gratis" / "Se cotiza" without the editor. */
    onPriceStatusChange: (plan: MembershipPlan, choice: PlanPriceChoice) => Promise<PlanPriceChangeResult>;
}

/**
 * One membership plan, with its price shown as what it is (D10).
 *
 * The agent never states a plan price the owner has not confirmed. So the card
 * says so next to the number, and gives the two ways out in place — the same
 * pair the services cards have: confirm the example as it is, or declare that
 * the plan is quoted case by case. A plan with no amount at all (the seed's
 * placeholder 0) reads "Sin precio" and offers to write one, or to say it is
 * free ("Es gratis", explicit: FX1): there is nothing to confirm, and the API
 * refuses to confirm it (`price_missing`). A plan the owner declared free
 * reads "Gratis", never "$0".
 */
export function PlanCard({ plan, operatingCurrency, onEdit, onDelete, onPriceStatusChange }: PlanCardProps) {
    const t = useTranslations("memberships");
    const ta = useTranslations("appointments");
    const tc = useTranslations("common");
    const locale = useLocale();
    const numLocale = locale === "pt" ? "pt-BR" : locale === "fr" ? "fr-FR" : locale === "en" ? "en-US" : undefined;

    const [pending, setPending] = useState(false);
    const [error, setError] = useState<{ key: PlanPriceErrorKey | null; message: string } | null>(null);

    const display = planPriceDisplay(plan);
    // The row's own currency is the one its amount was saved in.
    const currency = plan.currency || operatingCurrency || null;
    const nameId = `plan-${plan.id}-name`;
    const noteId = `plan-${plan.id}-price-note`;
    // A `price_missing` refusal means the screen was older than the row: the
    // way out is the same as for a plan that shows "Sin precio".
    const needsAmount = display.kind === "missing" || error?.key === "priceMissing";
    const unconfirmed = display.kind === "example" || display.kind === "missing";

    async function changeStatus(choice: PlanPriceChoice) {
        setPending(true);
        setError(null);
        try {
            const result = await onPriceStatusChange(plan, choice);
            if (!result?.success) {
                const key = planPriceErrorKey(result?.errorCode);
                setError({ key, message: key ? t(`planPrice.errors.${key}`) : result?.error || tc("errorSaving") });
            }
        } catch {
            setError({ key: null, message: tc("connectionError") });
        } finally {
            setPending(false);
        }
    }

    return (
        <article aria-labelledby={nameId} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                    <h3 id={nameId} className="font-semibold">{plan.name}</h3>
                    <p className="text-xs text-muted-foreground">{plan.duration_days} {t("days")}</p>
                </div>
                <div className="text-right shrink-0">
                    {display.kind === "quote" ? (
                        <p className="text-sm font-medium text-muted-foreground">{ta("priceStatus.quotePill")}</p>
                    ) : display.kind === "missing" ? (
                        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">{t("planPrice.noPrice")}</p>
                    ) : display.kind === "free" ? (
                        <p className="text-xl font-bold">{ta("priceStatus.freePill")}</p>
                    ) : (
                        <p className="text-xl font-bold font-mono">{formatMoney(display.amount, currency, { locale: numLocale })}</p>
                    )}
                    {display.kind === "example" && (
                        <span className="mt-1 inline-flex items-center px-2 py-0.5 rounded-md border border-dotted border-amber-500/70 text-amber-700 dark:text-amber-300 text-[11px] font-medium">
                            {ta("priceStatus.examplePill")}
                        </span>
                    )}
                </div>
            </div>

            {unconfirmed && (
                <div className="mb-3 rounded-lg border border-dotted border-amber-500/60 bg-amber-500/5 px-3 py-2">
                    <p id={noteId} className="text-xs text-amber-800 dark:text-amber-200">
                        {display.kind === "missing" ? t("planPrice.missingNote") : t("planPrice.exampleNote")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                        {needsAmount ? (
                            <>
                                <button
                                    type="button"
                                    aria-describedby={`${nameId} ${noteId}`}
                                    onClick={() => onEdit(plan, { focusPrice: true })}
                                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer border-none bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                                >
                                    {t("planPrice.writePrice")}
                                </button>
                                <button
                                    type="button"
                                    aria-describedby={`${nameId} ${noteId}`}
                                    disabled={pending}
                                    onClick={() => void changeStatus("free")}
                                    className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline cursor-pointer border-none bg-transparent p-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                                >
                                    {ta("priceStatus.free")}
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                aria-describedby={`${nameId} ${noteId}`}
                                disabled={pending}
                                onClick={() => void changeStatus("confirmed")}
                                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer border-none bg-transparent p-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                            >
                                {ta("priceStatus.confirmAction")}
                            </button>
                        )}
                        <button
                            type="button"
                            aria-describedby={`${nameId} ${noteId}`}
                            disabled={pending}
                            onClick={() => void changeStatus("quote")}
                            className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline cursor-pointer border-none bg-transparent p-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                        >
                            {ta("priceStatus.quoteAction")}
                        </button>
                        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
                    </div>
                </div>
            )}

            {error && (
                <p role="alert" className="mb-3 flex items-start gap-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden="true" />
                    <span>{error.message}</span>
                </p>
            )}

            {plan.description && <p className="text-xs text-muted-foreground mb-3">{plan.description}</p>}
            <dl className="space-y-1 text-xs border-t border-border pt-3 mb-3">
                <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t("classCredits")}</dt>
                    <dd className="font-mono">{plan.class_credits_per_period ?? "∞"}</dd>
                </div>
                {plan.personal_training_credits > 0 && (
                    <div className="flex justify-between">
                        <dt className="text-muted-foreground">{t("ptCredits")}</dt>
                        <dd className="font-mono">{plan.personal_training_credits}</dd>
                    </div>
                )}
                {plan.guest_passes > 0 && (
                    <div className="flex justify-between">
                        <dt className="text-muted-foreground">{t("guestPasses")}</dt>
                        <dd className="font-mono">{plan.guest_passes}</dd>
                    </div>
                )}
                <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t("freezeAllowance")}</dt>
                    <dd className="font-mono">{plan.freeze_allowance_days}d</dd>
                </div>
            </dl>
            <div className="flex gap-1 justify-end">
                <button
                    type="button"
                    aria-label={tc("edit")}
                    aria-describedby={nameId}
                    onClick={() => onEdit(plan)}
                    className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                >
                    <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    aria-label={tc("delete")}
                    aria-describedby={nameId}
                    onClick={() => onDelete(plan)}
                    className="p-1.5 hover:bg-red-500/10 rounded"
                >
                    <Trash2 className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                </button>
            </div>
        </article>
    );
}
