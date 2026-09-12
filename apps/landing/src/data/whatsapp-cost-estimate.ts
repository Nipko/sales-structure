/**
 * ═══ THE ARITHMETIC OF SOMEBODY ELSE'S INVOICE ══════════════════════════════
 *
 * Pure functions over `whatsapp-rate-projection.generated.ts`, which is derived
 * from the rate table the engine prices against. Nothing here reads a clock, a
 * network or a person: the caller passes the date, so the same inputs always
 * produce the same estimate and the component stays renderable in a static
 * export.
 *
 * Four rules this module exists to keep, each of which the obvious
 * implementation gets wrong:
 *
 *   1. `'unavailable'` IS NOT ZERO. The July cards price no service message at
 *      all. Summing an unavailable rate as zero produces a confident total of
 *      "free" for a period in which the price simply is not published, so an
 *      unpriced line poisons the total: `totalMicros` becomes `null` and the
 *      page has to say the estimate is incomplete instead of reassuring.
 *
 *   2. THE FREE THOUSAND IS PER NUMBER, NOT PER COUNTRY. The preserved
 *      evidence is explicit — `max(serviceDeliveries − 1000, 0) × rate` for one
 *      number and one market, and for a mix of countries you do NOT subtract a
 *      thousand from each. So the allowance is subtracted ONCE, scaled by how
 *      many numbers the business has, and never once per market.
 *
 *   3. THE ALLOWANCE DOES NOT EXIST BEFORE THE CHARGE DOES. Both begin on the
 *      same date. Applying it to an earlier month invents a discount against a
 *      price that was not being charged.
 *
 *   4. THE CARD IS CHOSEN BY DATE, NOT BY PREFERENCE. `cardInForce` takes the
 *      latest card whose `effectiveFrom` is on or before the date, exactly as
 *      the engine's `rateCardInForce` does, and ISO dates compare
 *      lexicographically. Before 1 October that lands on a card with no service
 *      rate — which is the honest answer, not a bug to paper over.
 *
 * WHAT THIS MODULE CANNOT DO, and the page says so: turn a phone number into a
 * market. Meta assigns unlisted countries to its regional buckets by calling
 * code, on a page the preserved sources link to but do not contain, and two
 * calling codes are shared by markets Meta prices differently (+1 across the
 * North American Numbering Plan, +7 across Russia and Kazakhstan). The engine
 * refuses to guess there and returns `unknown`; this estimator asks the reader
 * to pick the market instead of pretending to derive it.
 */

import {
  WHATSAPP_RATE_PROJECTION,
  type ProjectedRateCard,
  type ProjectedRateEntry,
  type WhatsAppMessageCategory,
} from "./whatsapp-rate-projection.generated";

export type { WhatsAppMessageCategory, ProjectedRateCard, ProjectedRateEntry };

/** Categories the estimator lets a reader enter. Order is the reading order. */
export const ESTIMATOR_CATEGORIES: readonly WhatsAppMessageCategory[] = Object.freeze([
  "service",
  "marketing",
  "utility",
  "authentication",
]);

/** Currencies a rate card is published in — the currency of the billed account. */
export const ESTIMATOR_CURRENCIES: readonly string[] = Object.freeze(
  Object.keys(WHATSAPP_RATE_PROJECTION.currencyMinorExponent),
);

export const RATE_ALLOWANCE = WHATSAPP_RATE_PROJECTION.allowance;
export const RATE_TABLE_VERSION = WHATSAPP_RATE_PROJECTION.rateTableVersion;

/** Before the charge begins, or on and after it. Resolved from a date, never typed. */
export type MetaChargeState = "before" | "active";

export function metaChargeState(isoDate: string): MetaChargeState {
  return isoDate >= RATE_ALLOWANCE.effectiveFrom ? "active" : "before";
}

/** Today in the viewer's own zone as an ISO date. The WABA's zone is the one that bills. */
export function localIsoDate(at: Date = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The card that applies to a date, mirroring the engine's `rateCardInForce`.
 *
 * Returns `null` rather than the nearest card when the date precedes every
 * card: an estimate for a period with no published card is not an estimate.
 */
export function cardInForce(currency: string, isoDate: string): ProjectedRateCard | null {
  const wanted = String(currency || "").toUpperCase();
  let chosen: ProjectedRateCard | null = null;
  for (const card of WHATSAPP_RATE_PROJECTION.cards) {
    if (card.currency !== wanted) continue;
    if (card.effectiveFrom > isoDate) continue;
    if (!chosen || card.effectiveFrom > chosen.effectiveFrom) chosen = card;
  }
  return chosen;
}

/** The first card of a currency that takes effect on or after a date. */
export function cardTakingEffect(currency: string, isoDate: string): ProjectedRateCard | null {
  const wanted = String(currency || "").toUpperCase();
  let chosen: ProjectedRateCard | null = null;
  for (const card of WHATSAPP_RATE_PROJECTION.cards) {
    if (card.currency !== wanted) continue;
    if (card.effectiveFrom < isoDate) continue;
    if (!chosen || card.effectiveFrom < chosen.effectiveFrom) chosen = card;
  }
  return chosen;
}

/**
 * The card an estimate should be built on, and which state the reader is in.
 *
 * Before the charge starts, the card in force prices no service message, so an
 * estimate built on it is a row of blanks. The useful answer is the rule that
 * begins on the effective date — labelled as future, never as current.
 */
export function estimationCard(currency: string, isoDate: string): {
  card: ProjectedRateCard | null;
  state: MetaChargeState;
} {
  const state = metaChargeState(isoDate);
  if (state === "active") return { card: cardInForce(currency, isoDate), state };
  return { card: cardTakingEffect(currency, RATE_ALLOWANCE.effectiveFrom), state };
}

export function marketsOf(card: ProjectedRateCard | null): readonly ProjectedRateEntry[] {
  return card ? card.entries : [];
}

export function entryFor(card: ProjectedRateCard | null, market: string): ProjectedRateEntry | null {
  if (!card) return null;
  return card.entries.find((entry) => entry.market === market) ?? null;
}

export interface EstimateInput {
  currency: string;
  market: string;
  /** How many business phone numbers the allowance is multiplied across. */
  phoneNumbers: number;
  /** Deliveries per category for one calendar month. */
  deliveries: Readonly<Partial<Record<WhatsAppMessageCategory, number>>>;
  /** The date the estimate is anchored to. The caller owns the clock. */
  onDate: string;
}

export interface EstimateLine {
  category: WhatsAppMessageCategory;
  deliveries: number;
  /** Deliveries covered by the free allowance. Only ever non-zero for service. */
  freeDeliveries: number;
  billableDeliveries: number;
  /** Micro-units per delivered message, or the card's own `'unavailable'`. */
  rateMicros: number | "unavailable";
  /** `null` when the card publishes no rate — never 0, which would read as free. */
  subtotalMicros: number | null;
}

export interface CostEstimate {
  card: ProjectedRateCard | null;
  entry: ProjectedRateEntry | null;
  state: MetaChargeState;
  lines: readonly EstimateLine[];
  /** Free deliveries applied in total: allowance × numbers, once, not per market. */
  allowanceApplied: number;
  allowanceInForce: boolean;
  /** `null` when any entered category has no published rate. */
  totalMicros: number | null;
  /** Total rounded up to the currency's minor units, as the engine rounds. */
  totalMinorUnits: number | null;
  /** Categories the reader entered volume for and the card does not price. */
  unpricedCategories: readonly WhatsAppMessageCategory[];
}

/**
 * Micro-units in one minor unit of a currency, or `null` when the currency's
 * exponent is unknown — which is the correct answer rather than assuming two
 * decimal places for a currency the cards were never published in.
 */
export function microsPerMinorUnit(currency: string): number | null {
  const exponent =
    WHATSAPP_RATE_PROJECTION.currencyMinorExponent[
      String(currency || "").toUpperCase() as keyof typeof WHATSAPP_RATE_PROJECTION.currencyMinorExponent
    ];
  return typeof exponent === "number"
    ? WHATSAPP_RATE_PROJECTION.microsPerUnit / 10 ** exponent
    : null;
}

/** Micro-units billed as whole minor units, rounded UP once, as the engine does. */
export function minorUnitsFromMicros(micros: number, currency: string): number | null {
  const per = microsPerMinorUnit(currency);
  return per ? Math.ceil(micros / per) : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function estimateWhatsappCost(input: EstimateInput): CostEstimate {
  const { card, state } = estimationCard(input.currency, input.onDate);
  const entry = entryFor(card, input.market);
  const phoneNumbers = Math.max(1, nonNegativeInteger(input.phoneNumbers));

  // Both the charge and its allowance begin on the same date. Anchoring the
  // estimate to the effective date is exactly when the allowance applies.
  const allowanceInForce = Boolean(card) && card!.effectiveFrom >= RATE_ALLOWANCE.effectiveFrom;
  const allowancePool = allowanceInForce ? RATE_ALLOWANCE.deliveries * phoneNumbers : 0;

  const lines: EstimateLine[] = [];
  const unpriced: WhatsAppMessageCategory[] = [];
  let total = 0;
  let complete = true;

  for (const category of ESTIMATOR_CATEGORIES) {
    const deliveries = nonNegativeInteger(input.deliveries?.[category]);
    // The allowance covers one category and one only. A utility template inside
    // the 24-hour window is chargeable and does not eat a free service message.
    const free = category === RATE_ALLOWANCE.category ? Math.min(deliveries, allowancePool) : 0;
    const billable = deliveries - free;
    const rate = entry ? entry.micros[category] : "unavailable";

    let subtotal: number | null;
    if (typeof rate === "number") {
      subtotal = billable * rate;
      total += subtotal;
    } else {
      subtotal = null;
      if (deliveries > 0) {
        complete = false;
        unpriced.push(category);
      }
    }

    lines.push({
      category,
      deliveries,
      freeDeliveries: free,
      billableDeliveries: billable,
      rateMicros: rate,
      subtotalMicros: subtotal,
    });
  }

  return {
    card,
    entry,
    state,
    lines,
    allowanceApplied: allowanceInForce
      ? lines.reduce((sum, line) => sum + line.freeDeliveries, 0)
      : 0,
    allowanceInForce,
    totalMicros: complete ? total : null,
    // Meta bills in whole minor units. Rounding up once over the batch is what
    // the engine does, and rounding down would make Colombia's rate vanish.
    totalMinorUnits: complete ? minorUnitsFromMicros(total, input.currency) : null,
    unpricedCategories: unpriced,
  };
}

/**
 * Micro-units rendered as money.
 *
 * Per-message rates need up to six decimals — Colombia's service rate is eight
 * ten-thousandths of a dollar, and two decimals would print it as nothing.
 * Totals are rendered from the already-rounded minor units so the figure on
 * screen is the figure the engine would charge for.
 */
export function formatRateFromMicros(micros: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(micros / WHATSAPP_RATE_PROJECTION.microsPerUnit);
}

export function formatTotalFromMinorUnits(
  minorUnits: number,
  currency: string,
  locale: string,
): string {
  const exponent =
    WHATSAPP_RATE_PROJECTION.currencyMinorExponent[
      currency as keyof typeof WHATSAPP_RATE_PROJECTION.currencyMinorExponent
    ] ?? 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minorUnits / 10 ** exponent);
}
