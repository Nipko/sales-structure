/**
 * ═══ THREE PAYMENTS, THREE PAYEES, ONE PAGE THAT MAY NOT BLUR THEM ══════════
 *
 * A business that starts with Parallly ends up inside three separate money
 * relationships, and only ONE of them is with us:
 *
 *   1. subscription       business  → Parallly   (card tokenised by Wompi)
 *   2. whatsappDelivery   business  → Meta       (its OWN WhatsApp Business
 *                                                 account, its own card, added
 *                                                 on Meta's own surface)
 *   3. customerPayments   customers → business   (the business's own gateway)
 *
 * Blurring any two of them produces a specific, expensive misunderstanding:
 * a reader who thinks (2) is inside (1) budgets nothing for Meta and loses
 * delivery on 1 October 2026; a reader who thinks (1) configures (2) never adds
 * the card at all; a reader who thinks (3) passes through Parallly expects us to
 * hold, reconcile or refund money we never touch.
 *
 * This module is the single projection every surface reads — the costs page,
 * the notice under the price, the notice under the CTA — so the three cannot
 * drift apart between pages. The copy lives in i18n; the STRUCTURE lives here,
 * and `scripts/validate-marketing-claims.cjs` pins the two numbers below to the
 * rate table the engine actually prices against.
 */

/** Who hands over money, who collects it, and where the method is entered. */
export type PaymentPartyId = "subscription" | "whatsappDelivery" | "customerPayments";

export interface PaymentParty {
  id: PaymentPartyId;
  /** i18n key prefix inside the `payments` namespace. */
  i18nKey: PaymentPartyId;
  /** Where the payment instrument is entered. Never more than one of these. */
  methodEnteredAt: "parallly" | "meta" | "business_provider";
  /**
   * Whether Parallly can read the state of this payment at all. `none` means we
   * cannot even confirm it exists — which is why no surface may print a
   * solvency or delivery guarantee for it.
   */
  parallelyVisibility: "authorized_charges" | "status_only" | "none";
  /** Repository evidence for the flow, checked to exist by the validator. */
  evidence: readonly string[];
}

export const PAYMENT_PARTIES: readonly PaymentParty[] = Object.freeze([
  Object.freeze({
    id: "subscription",
    i18nKey: "subscription",
    methodEnteredAt: "parallly",
    // We keep a payment source reference, brand, last four and expiry — never
    // the PAN or the CVC, which go from the browser straight to Wompi.
    parallelyVisibility: "authorized_charges",
    evidence: Object.freeze([
      "apps/api/src/modules/billing/recurring/payment-source.service.ts",
      "apps/api/src/modules/billing/adapters/wompi.adapter.ts",
    ]),
  }),
  Object.freeze({
    id: "whatsappDelivery",
    i18nKey: "whatsappDelivery",
    methodEnteredAt: "meta",
    // Meta's API can report whether a method is ATTACHED. It does not report
    // balance, debt or whether the next message will be delivered — so
    // `status_only` is the ceiling of what any screen may say.
    parallelyVisibility: "status_only",
    evidence: Object.freeze([
      "apps/api/src/modules/billing/whatsapp-rates/whatsapp-rate-table.generated.ts",
    ]),
  }),
  Object.freeze({
    id: "customerPayments",
    i18nKey: "customerPayments",
    methodEnteredAt: "business_provider",
    // The tenant's own provider credentials live encrypted per tenant; the
    // money settles into the tenant's account and never into ours.
    parallelyVisibility: "none",
    evidence: Object.freeze(["apps/api/src/modules/tenant-payments"]),
  }),
]);

/**
 * The two facts about Meta's charge that the landing is allowed to print.
 *
 * Both are read from `whatsapp-rate-table.generated.ts` by the validator and
 * compared against these values, so moving the date or the allowance in the
 * rate table turns the build red instead of leaving a stale sentence on a
 * public page. Everything else about the charge — the per-message rate — is
 * deliberately absent: Meta prices by the RECIPIENT's country and revises the
 * cards quarterly, so any figure here is wrong at the next revision and right
 * for almost nobody in between.
 */
export const META_WHATSAPP_CHARGE = Object.freeze({
  /** Midnight in the WABA's own time zone, not ours. */
  effectiveFrom: "2026-10-01",
  /** Service category only. Per phone number, per calendar month, no rollover. */
  freeServiceDeliveries: 1000,
  /**
   * Meta's own deadline for having a payment method on the account before
   * service delivery stops. Published by Meta, not a Parallly policy.
   */
  paymentMethodDeadline: "2026-09-30",
  /** Every category Meta bills separately. Naming a subset reads as exhaustive. */
  billedCategories: Object.freeze(["service", "marketing", "utility", "authentication"] as const),
  /**
   * The stable page to go back to. The signed CDN links to the individual rate
   * cards expire; this one does not.
   */
  officialRatesUrl: "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing",
  /** Where the business actually adds the card. Meta's surface, not ours. */
  billingManagerUrl: "https://business.facebook.com/wa/manage/home/",
  /** Meta's own step-by-step for adding the method, cited rather than retold. */
  addPaymentMethodHelpUrl: "https://www.facebook.com/business/help/488291839463771",
});

/**
 * Channels whose provider does not bill a per-service-message fee today.
 *
 * Stated as "no per-message service charge from its provider", never as "free":
 * a plan, a phone number and a connected account are still required, and this
 * says nothing about future pricing on those surfaces.
 */
export const CHANNELS_WITHOUT_PER_MESSAGE_CHARGE = Object.freeze([
  "Instagram",
  "Messenger",
  "Telegram",
  "Web Chat",
] as const);
