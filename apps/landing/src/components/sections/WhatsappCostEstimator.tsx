"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Icon } from "../ui/Icon";
import {
  ESTIMATOR_CATEGORIES,
  ESTIMATOR_CURRENCIES,
  RATE_ALLOWANCE,
  estimateWhatsappCost,
  formatRateFromMicros,
  formatTotalFromMinorUnits,
  localIsoDate,
  marketsOf,
  minorUnitsFromMicros,
  estimationCard,
  type WhatsAppMessageCategory,
} from "../../data/whatsapp-cost-estimate";

/**
 * ═══ AN ESTIMATE THAT CANNOT BE MISTAKEN FOR AN INVOICE ═════════════════════
 *
 * The previous version of this page published no estimator at all, on the
 * reasoning that a total rendered beside a real subscription price reads as a
 * bill. That reasoning is right about the RISK and wrong about the remedy: a
 * business that cannot see the order of magnitude of Meta's charge before
 * 1 October budgets nothing for it, and learns the number from Meta.
 *
 * So the estimator exists, and every property that made the old objection valid
 * is answered structurally rather than by a disclaimer nobody reads:
 *
 *   - THE RATES ARE DERIVED, NOT TYPED. Every figure comes from
 *     `whatsapp-rate-projection.generated.ts`, which the build re-derives from
 *     the same rate table the engine prices against. There is no literal rate
 *     anywhere in this file, so nothing here can go stale on its own, and the
 *     frozen "hard-coded Meta per-message rate" rule stays in force against
 *     copy — which is what it was written to protect.
 *
 *   - THE CARD IS NAMED. Its id, its effective date and the file its numbers
 *     were read from are printed under the result. A price you cannot argue
 *     with is a price you should not publish.
 *
 *   - THE MARKET IS CHOSEN, NOT INFERRED. Meta prices by the RECIPIENT's
 *     country. Turning a phone number into one of Meta's markets requires a
 *     mapping the preserved sources do not contain, and two calling codes span
 *     markets Meta prices differently — so the reader picks the market and the
 *     page says why it does not guess.
 *
 *   - AN UNPUBLISHED RATE POISONS THE TOTAL. Before the charge begins the card
 *     in force prices no service message; the estimator answers with the rule
 *     that STARTS on the effective date and labels it as future. Where the card
 *     genuinely prints no rate, the total is withheld instead of summing the
 *     blank as zero.
 *
 *   - NOTHING LEAVES THE BROWSER. No fetch, no analytics call, no field that
 *     asks who the reader is. Volumes only.
 */

const DEFAULT_DELIVERIES: Record<WhatsAppMessageCategory, number> = {
  service: 3000,
  marketing: 0,
  utility: 0,
  authentication: 0,
  authentication_international: 0,
};

/** Meta's regional buckets get a translated label; countries keep their proper noun. */
function useMarketLabel() {
  const t = useTranslations("whatsappCosts");
  return (market: string, aggregateKey?: string) =>
    aggregateKey && t.has(`market${aggregateKey.charAt(0).toUpperCase()}${aggregateKey.slice(1)}`)
      ? t(`market${aggregateKey.charAt(0).toUpperCase()}${aggregateKey.slice(1)}`)
      : market;
}

export function WhatsappCostEstimator() {
  const t = useTranslations("whatsappCosts");
  const locale = useLocale();
  const marketLabel = useMarketLabel();

  // Resolved once per mount. The page is a static export, so the build date is
  // not the reading date, and the before/after rule has to follow the reader's
  // clock rather than whenever the site was last deployed.
  const today = useMemo(() => localIsoDate(), []);

  const [currency, setCurrency] = useState(ESTIMATOR_CURRENCIES[0] ?? "USD");
  const [phoneNumbers, setPhoneNumbers] = useState(1);
  const [deliveries, setDeliveries] = useState<Record<WhatsAppMessageCategory, number>>(
    () => ({ ...DEFAULT_DELIVERIES }),
  );

  const markets = useMemo(
    () => marketsOf(estimationCard(currency, today).card),
    [currency, today],
  );
  const [market, setMarket] = useState("Colombia");
  const activeMarket = markets.some((entry) => entry.market === market)
    ? market
    : (markets[0]?.market ?? "");

  const estimate = useMemo(
    () => estimateWhatsappCost({ currency, market: activeMarket, phoneNumbers, deliveries, onDate: today }),
    [currency, activeMarket, phoneNumbers, deliveries, today],
  );

  const card = estimate.card;
  // `useGrouping: "always"` rather than the default. Spanish and Portuguese
  // omit the thousands separator on four-digit integers, so the allowance would
  // print as "1000" here and as "1.000" three paragraphs above it on the same
  // page — the sort of mismatch that makes a reader wonder which one is the rule.
  const countFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { useGrouping: "always" }),
    [locale],
  );

  const setCategory = (category: WhatsAppMessageCategory, raw: string) => {
    const parsed = Math.floor(Number(raw));
    setDeliveries((current) => ({
      ...current,
      [category]: Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10_000_000) : 0,
    }));
  };

  const fieldClass =
    "w-full rounded-xl border border-border bg-bg/60 px-3 py-2.5 text-sm text-text-primary "
    + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent "
    + "focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
  const labelClass = "block text-xs font-semibold uppercase tracking-wider text-text-muted";

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("estimatorTitle")}</h2>
      <p className="mt-4 leading-relaxed text-text-secondary">{t("estimatorIntro")}</p>

      {/* The versioned rule. Which of the two states applies is read from the
          reader's date against the card's own effective date — never typed. */}
      <div
        className="mt-6 rounded-2xl border border-accent/25 bg-accent/5 p-5"
        data-charge-state={estimate.state}
      >
        <h3 className="text-base font-semibold text-text-primary">
          {t(estimate.state === "before" ? "estimatorStateBeforeTitle" : "estimatorStateActiveTitle")}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          {t(estimate.state === "before" ? "estimatorStateBeforeBody" : "estimatorStateActiveBody")}
        </p>
      </div>

      <div className="mt-8 rounded-3xl border border-border bg-surface/60 p-5 sm:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="estimator-market">
              {t("estimatorMarketLabel")}
            </label>
            <select
              id="estimator-market"
              className={`mt-2 ${fieldClass}`}
              value={activeMarket}
              onChange={(event) => setMarket(event.target.value)}
              aria-describedby="estimator-market-hint"
            >
              {markets.map((entry) => (
                <option key={entry.market} value={entry.market}>
                  {marketLabel(entry.market, entry.aggregateKey)}
                </option>
              ))}
            </select>
            <p id="estimator-market-hint" className="mt-2 text-xs leading-relaxed text-text-muted">
              {t("estimatorMarketHint")}
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor="estimator-currency">
              {t("estimatorCurrencyLabel")}
            </label>
            <select
              id="estimator-currency"
              className={`mt-2 ${fieldClass}`}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              aria-describedby="estimator-currency-hint"
            >
              {ESTIMATOR_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <p id="estimator-currency-hint" className="mt-2 text-xs leading-relaxed text-text-muted">
              {t("estimatorCurrencyHint")}
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor="estimator-numbers">
              {t("estimatorNumbersLabel")}
            </label>
            <input
              id="estimator-numbers"
              className={`mt-2 ${fieldClass}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={200}
              step={1}
              value={phoneNumbers}
              onChange={(event) => {
                const parsed = Math.floor(Number(event.target.value));
                setPhoneNumbers(Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 1);
              }}
              aria-describedby="estimator-numbers-hint"
            />
            <p id="estimator-numbers-hint" className="mt-2 text-xs leading-relaxed text-text-muted">
              {t("estimatorNumbersHint")}
            </p>
          </div>
        </div>

        <fieldset className="mt-7 border-t border-border/60 pt-6">
          <legend className="text-sm font-semibold text-text-primary">
            {t("estimatorVolumeLegend")}
          </legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {ESTIMATOR_CATEGORIES.map((category) => (
              <div key={category}>
                <label className={labelClass} htmlFor={`estimator-${category}`}>
                  {t(`estimatorCategory${category.charAt(0).toUpperCase()}${category.slice(1)}`)}
                </label>
                <input
                  id={`estimator-${category}`}
                  className={`mt-2 ${fieldClass}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={100}
                  value={deliveries[category]}
                  onChange={(event) => setCategory(category, event.target.value)}
                />
              </div>
            ))}
          </div>
        </fieldset>
      </div>

      {/* ── The result ──────────────────────────────────────────────────────
          A table, not a headline number: the arithmetic is the disclosure. A
          reader who sees the free thousand subtracted and the per-message rate
          beside it can check the total, which is the difference between an
          estimate and an assertion. */}
      <div className="mt-8 overflow-hidden rounded-3xl border border-border bg-surface/40">
        <div className="border-b border-border/60 px-5 py-4 sm:px-7">
          <h3 className="text-lg font-semibold text-text-primary">{t("estimatorResultTitle")}</h3>
          <p className="mt-1 text-sm font-semibold text-amber-300">{t("estimatorNotInvoice")}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <caption className="sr-only">{t("estimatorResultTitle")}</caption>
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-text-muted">
                <th scope="col" className="px-5 py-3 font-semibold sm:px-7">
                  {t("estimatorColCategory")}
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  {t("estimatorColDeliveries")}
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  {t("estimatorColFree")}
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  {t("estimatorColRate")}
                </th>
                <th scope="col" className="px-5 py-3 text-right font-semibold sm:px-7">
                  {t("estimatorColSubtotal")}
                </th>
              </tr>
            </thead>
            <tbody>
              {estimate.lines.map((line) => (
                <tr key={line.category} className="border-b border-border/40">
                  <th scope="row" className="px-5 py-3 text-left font-medium text-text-primary sm:px-7">
                    {t(
                      `estimatorCategory${line.category.charAt(0).toUpperCase()}${line.category.slice(1)}`,
                    )}
                  </th>
                  <td className="px-3 py-3 text-right text-text-secondary">
                    {countFormatter.format(line.deliveries)}
                  </td>
                  <td className="px-3 py-3 text-right text-text-secondary">
                    {line.freeDeliveries > 0 ? countFormatter.format(line.freeDeliveries) : "—"}
                  </td>
                  <td className="px-3 py-3 text-right text-text-secondary">
                    {typeof line.rateMicros === "number"
                      ? formatRateFromMicros(line.rateMicros, currency, locale)
                      : t("estimatorUnpriced")}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-text-primary sm:px-7">
                    {line.subtotalMicros === null
                      ? t("estimatorUnpriced")
                      : formatTotalFromMinorUnits(
                          minorUnitsFromMicros(line.subtotalMicros, currency) ?? 0,
                          currency,
                          locale,
                        )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="px-5 py-4 text-left font-semibold text-text-primary sm:px-7">
                  {t("estimatorTotalLabel")}
                </th>
                <td colSpan={3} />
                <td
                  className="px-5 py-4 text-right text-lg font-bold text-text-primary sm:px-7"
                  data-estimate-total={estimate.totalMinorUnits ?? "incomplete"}
                >
                  {estimate.totalMinorUnits === null
                    ? t("estimatorIncompleteTotal")
                    : formatTotalFromMinorUnits(estimate.totalMinorUnits, currency, locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="space-y-2 border-t border-border/60 px-5 py-5 text-xs leading-relaxed text-text-muted sm:px-7">
          {card && (
            <p data-rate-card={card.rateVersion}>
              {t("estimatorSourceLine", {
                card: card.rateVersion,
                date: card.effectiveFrom,
                file: card.sourceFile,
              })}
            </p>
          )}
          {estimate.unpricedCategories.length > 0 && <p>{t("estimatorUnpricedNote")}</p>}
          <p>{t("estimatorAllowanceNote", { deliveries: countFormatter.format(RATE_ALLOWANCE.deliveries) })}</p>
          <p>{t("estimatorMixNote")}</p>
          <p>{t("estimatorRoundingNote")}</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-surface/60 p-5">
        <div className="flex items-center gap-3">
          <span className="text-text-muted" aria-hidden="true">
            {Icon.minus("h-5 w-5")}
          </span>
          <h3 className="text-base font-semibold text-text-primary">
            {t("estimatorExclusionsTitle")}
          </h3>
        </div>
        <ul className="mt-4 space-y-2">
          {["estimatorExclusion1", "estimatorExclusion2", "estimatorExclusion3", "estimatorExclusion4"].map(
            (key) => (
              <li key={key} className="flex items-start gap-3 text-sm leading-relaxed text-text-secondary">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
                {t(key)}
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}
