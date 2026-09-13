"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Wallet } from "lucide-react";
import { formatMinor } from "@/lib/whatsapp-spend";

/**
 * ═══ A CAMPAIGN TO FOUR THOUSAND PEOPLE IS A PURCHASE ═══
 *
 * From 1 October 2026 Meta charges the business's own WhatsApp account per
 * delivered message. Until now the product asked somebody to confirm a send
 * with no number attached to it — in fact it asked nothing at all: "Enviar
 * ahora" fired on one click — and the first time anybody saw a figure was on
 * Meta's invoice.
 *
 * ── THE THREE THINGS THIS MUST NOT DO ───────────────────────────────────────
 *
 *   · present the estimate as a forecast. It is an UPPER BOUND on deliveries:
 *     a message that is not delivered is not charged, and Meta applies the rate
 *     in force at delivery, which a campaign spanning midnight can cross;
 *   · fold the recipients it could not price into the total. A destination the
 *     rate card cannot place is NOT free, and dropping it is the single easiest
 *     way to make a campaign look cheaper than it is. They are counted, named
 *     by reason, and shown BESIDE the figure;
 *   · show a zero when the total could not be expressed. `totalMinorUnits` is
 *     `null` for "the parts priced and the whole did not", and a zero there is
 *     a lie that reads like good news.
 *
 * And the free allowance is not applied. The thousand free deliveries per number
 * per calendar month are for SERVICE messages; a campaign goes out as an
 * approved template, so subtracting them would promise a discount Meta does not
 * give and would spend, on paper, an allowance the tenant still needs for the
 * replies the campaign provokes.
 */

/** A recipient the estimate could not price, and precisely why. */
export interface UnpricedRecipient {
    recipientRef: string;
    reason: string;
    detail: string;
}

/** The API's `CampaignEstimate`, as the browser receives it. */
export interface CampaignEstimate {
    category: string | null;
    categoryDetail?: string;
    channelAccountId: string;
    /** The currency the billed WhatsApp account is charged in. */
    currency: string;
    calendarMonth: string | null;
    recipients: number;
    priced: number;
    /** `null` when the parts priced and the whole did not. Never a silent zero. */
    totalMinorUnits: number | null;
    byMarket: Array<{ market: string; recipients: number; micros: number; unitMicros: number }>;
    unpriced: UnpricedRecipient[];
    unpricedByReason: Record<string, number>;
    freeAllowanceApplies: false;
}

export function CampaignCostNotice({ recipients, estimate }: {
    /** How many people this send is for, or `null` when nobody has counted. */
    recipients: number | null;
    /**
     * The priced estimate, when one is available.
     *
     * `null` or absent means no figure is known — which is rendered as the
     * sentence saying so, never as a zero and never as silence. The rate a
     * message is charged at depends on the recipient's country and on the
     * template's approved Meta category, and neither can be resolved in the
     * browser without shipping the rate card into it, which would let the
     * estimate and the reservation disagree about what a message costs.
     */
    estimate?: CampaignEstimate | null;
}) {
    const t = useTranslations("whatsappSpend");
    const locale = useLocale();
    const unpricedEntries = Object.entries(estimate?.unpricedByReason ?? {});

    return (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3">
            <p className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                <Wallet className="h-4 w-4 text-[var(--accent)]" aria-hidden />
                {t("campaignIsAPurchase")}
            </p>

            {recipients !== null && (
                <p className="text-sm text-[var(--text-secondary)]">
                    {/* "Up to", because an undelivered message is not charged.
                        A campaign figure stated flat is a figure somebody will
                        hold us to. */}
                    {t("campaignUpTo", { count: recipients })}
                </p>
            )}

            {estimate ? (
                <div className="space-y-2">
                    <p className="text-sm text-[var(--text-primary)]">
                        {estimate.totalMinorUnits === null
                            // The parts priced and the whole did not. Said in
                            // words rather than shown as a zero, which is the
                            // one wrong number that reads like good news.
                            ? t("campaignTotalNotRepresentable", { currency: estimate.currency })
                            : t("campaignUpToMoney", {
                                money: formatMinor(estimate.totalMinorUnits, estimate.currency, locale),
                                currency: estimate.currency,
                            })}
                    </p>
                    {estimate.byMarket.length > 0 && (
                        <ul className="space-y-1">
                            {estimate.byMarket.map(market => (
                                <li key={market.market}
                                    className="flex flex-wrap items-baseline justify-between gap-3
                                               text-xs text-[var(--text-secondary)]">
                                    <span>{market.market}</span>
                                    <span className="tabular-nums">
                                        {t("campaignMarketRecipients", { count: market.recipients })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : (
                // No figure, and the reason for it, rather than a blank or a
                // zero. Somebody deciding whether to send four thousand
                // messages is owed the fact that we cannot price them here.
                <p className="text-sm text-[var(--text-secondary)]">{t("campaignNoEstimate")}</p>
            )}

            {/* ── BESIDE the total, never inside it ───────────────────────── */}
            {estimate && estimate.unpriced.length > 0 && (
                <div role="note"
                    className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3 space-y-1">
                    <p className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <AlertTriangle className="h-4 w-4 text-[var(--warning)]" aria-hidden />
                        {t("campaignUnpriced", { count: estimate.unpriced.length })}
                    </p>
                    <ul className="space-y-0.5">
                        {unpricedEntries.map(([reason, count]) => (
                            <li key={reason} className="text-xs text-[var(--text-secondary)]">
                                {count}
                                {" — "}
                                {/* A reason the server knows and this build does
                                    not is shown as the reason itself rather than
                                    as a blank line. */}
                                {t.has(`unpricedReason.${reason}`) ? t(`unpricedReason.${reason}`) : reason}
                            </li>
                        ))}
                    </ul>
                    {/* The sentence that stops somebody reading the total as the
                        whole cost: a destination without a rate is not free. */}
                    <p className="text-xs text-[var(--text-primary)]">{t("campaignUnpricedNotFree")}</p>
                </div>
            )}

            {/* The free allowance does not apply, and this says why rather than
                leaving somebody to assume the first thousand are covered. */}
            <p className="text-xs text-[var(--text-secondary)]">{t("campaignNoFreeAllowance")}</p>
            <p className="text-xs text-[var(--text-secondary)]">{t("whoCharges")}</p>
            {/* Where the figures actually live. A dialogue that explains a
                charge and leaves somebody to go looking for the panel is a
                dialogue that gets closed and forgotten. */}
            <a
                href="/admin/channels/whatsapp"
                className="inline-block text-xs text-[var(--accent)] underline underline-offset-2
                           focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
                {t("seeSpendPanel")}
            </a>
        </div>
    );
}
