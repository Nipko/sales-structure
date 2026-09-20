"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Icon } from "../ui/Icon";
import { PAYMENT_PARTIES } from "../../data/payment-model";
import { useSubscriptionPaymentText } from "../../hooks/useSubscriptionPaymentText";

/**
 * The three payments, side by side, each one naming its own payee.
 *
 * Rendered identically on /costos-whatsapp and /precios so a reader who arrives
 * by either door gets the same three cards in the same order. The order is the
 * order of PAYMENT_PARTIES and is not cosmetic: subscription first because it is
 * the only one we charge, Meta second because it is the one that surprises
 * people, customer payments last because it flows the other way.
 */

const PARTY_ICON = {
  subscription: Icon.zap,
  whatsappDelivery: Icon.mail,
  customerPayments: Icon.users,
} as const;

const PARTY_ACCENT = {
  subscription: "border-accent/25 bg-accent/10 text-accent",
  whatsappDelivery: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  customerPayments: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
} as const;

export function ThreePaymentsPanel({ headingLevel = "h2" }: { headingLevel?: "h2" | "h3" }) {
  const t = useTranslations("payments");
  const payment = useSubscriptionPaymentText();
  const reduceMotion = useReducedMotion();
  const Heading = headingLevel;

  return (
    <div>
      <div className="mx-auto max-w-3xl text-center">
        <Heading className="text-3xl font-bold tracking-tight sm:text-4xl">
          {t("sectionTitle")}
        </Heading>
        <p className="mt-4 leading-relaxed text-text-secondary">{t("sectionSubtitle")}</p>
      </div>

      <ol className="mt-12 grid gap-5 lg:grid-cols-3">
        {PAYMENT_PARTIES.map((party, index) => (
          <motion.li
            key={party.id}
            className="glass-card flex h-full flex-col rounded-2xl p-6"
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: index * 0.07 }}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-xl border ${PARTY_ACCENT[party.id]}`}
                aria-hidden="true"
              >
                {PARTY_ICON[party.id]("h-5 w-5")}
              </span>
              <span className="text-xs font-semibold tabular-nums text-text-muted">
                {index + 1} / {PAYMENT_PARTIES.length}
              </span>
            </div>

            <h3 className="mt-5 text-base font-semibold leading-snug text-text-primary">
              {t(`${party.i18nKey}Title`)}
            </h3>
            <p className="mt-1.5 text-sm font-medium text-text-primary">
              {t(`${party.i18nKey}Who`)}
            </p>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-text-secondary">
              {party.id === "subscription" ? payment.body : t(`${party.i18nKey}Body`)}
            </p>

            <p className="mt-5 flex items-start gap-2 border-t border-border/70 pt-3 text-xs leading-relaxed text-text-primary">
              <span className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true">
                {Icon.shield("h-3.5 w-3.5")}
              </span>
              {t(`${party.i18nKey}Note`)}
            </p>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
