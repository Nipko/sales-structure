"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";
import { SIGNUP_URL } from "../../lib/constants";

interface PlanDef {
  nameKey: string;
  descKey: string;
  annualPrice: string;
  monthlyPrice: string;
  featuresKey: string;
  ctaKey: string;
  highlighted: boolean;
  badgeKey?: string;
}

const PLANS: PlanDef[] = [
  {
    nameKey: "emprendedorName",
    descKey: "emprendedorDesc",
    annualPrice: "$105.000",
    monthlyPrice: "$125.700",
    featuresKey: "emprendedorFeatures",
    ctaKey: "emprendedorCta",
    highlighted: false,
  },
  {
    nameKey: "starterName",
    descKey: "starterDesc",
    annualPrice: "$179.000",
    monthlyPrice: "$215.800",
    featuresKey: "starterFeatures",
    ctaKey: "starterCta",
    highlighted: false,
  },
  {
    nameKey: "proName",
    descKey: "proDesc",
    annualPrice: "$569.000",
    monthlyPrice: "$679.500",
    featuresKey: "proFeatures",
    ctaKey: "proCta",
    highlighted: true,
    badgeKey: "popular",
  },
  {
    nameKey: "enterpriseName",
    descKey: "enterpriseDesc",
    annualPrice: "$1.499.000",
    monthlyPrice: "$1.789.800",
    featuresKey: "enterpriseFeatures",
    ctaKey: "enterpriseCta",
    highlighted: false,
  },
];

export function PricingSection() {
  const [annual, setAnnual] = useState(true);
  const t = useTranslations("pricing");

  return (
    <Section id="precios" className="bg-surface/30">
      {/* Header */}
      <div className="text-center mb-10">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto">
          {t("freeTrial")}
        </p>
      </div>

      {/* Annual / Monthly toggle */}
      <div className="flex items-center justify-center gap-3 mb-12">
        <span
          className={`text-sm transition-colors ${
            !annual ? "text-text-primary font-medium" : "text-text-muted"
          }`}
        >
          {t("monthly")}
        </span>

        <button
          onClick={() => setAnnual(!annual)}
          className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${
            annual ? "bg-accent" : "bg-border-light"
          }`}
          aria-label="Toggle billing cycle"
        >
          <motion.div
            className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow"
            animate={{ left: annual ? "26px" : "2px" }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        </button>

        <span
          className={`text-sm transition-colors ${
            annual ? "text-text-primary font-medium" : "text-text-muted"
          }`}
        >
          {t("annual")}
          <span className="ml-1.5 text-emerald-400 text-xs font-bold">
            {t("annualDiscount")}
          </span>
        </span>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 items-start">
        {PLANS.map((plan, i) => {
          const price = annual ? plan.annualPrice : plan.monthlyPrice;

          return (
            <motion.div
              key={plan.nameKey}
              className={`relative rounded-2xl p-7 flex flex-col ${
                plan.highlighted
                  ? "glass-card border-accent/40 shadow-[0_0_28px_rgba(56,151,240,0.1)] lg:-mt-4"
                  : "glass-card"
              }`}
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.08, duration: 0.45 }}
            >
              {/* "Mas popular" badge */}
              {plan.badgeKey && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                  {t(plan.badgeKey)}
                </span>
              )}

              {/* Plan name & description */}
              <h3 className="text-xl font-bold mb-1">{t(plan.nameKey)}</h3>
              <p className="text-text-muted text-sm mb-5">{t(plan.descKey)}</p>

              {/* Price */}
              <div className="mb-6 min-h-[60px]">
                <span className="text-4xl font-bold tabular">{price}</span>
                <span className="text-sm text-text-muted ml-1">
                  {t("perMonth")}
                </span>
              </div>

              {/* Feature list */}
              <ul className="space-y-2.5 mb-7 flex-1">
                {(t.raw(plan.featuresKey) as string[]).map((f, fi) => (
                  <li key={fi} className="flex items-start gap-2.5 text-sm">
                    <span className="text-accent flex-shrink-0 mt-0.5">
                      {Icon.check("w-4 h-4")}
                    </span>
                    <span className="text-text-secondary">{f}</span>
                  </li>
                ))}
              </ul>

              {/* CTA button */}
              <a
                href={SIGNUP_URL}
                className={`block text-center py-3 px-6 rounded-xl font-semibold transition-colors cursor-pointer ${
                  plan.highlighted
                    ? "bg-accent hover:bg-accent-hover text-white shadow-[0_0_16px_rgba(56,151,240,0.2)]"
                    : "bg-surface-light hover:bg-border border border-border text-text-primary"
                }`}
              >
                {t(plan.ctaKey)}
              </a>
            </motion.div>
          );
        })}
      </div>

      {/* Currency hint */}
      <p className="text-center text-xs text-text-muted mt-8">
        {t("currencyHint")}
      </p>

      {/* Link to full comparison page */}
      <div className="text-center mt-6">
        <Link
          href="/precios"
          className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover font-medium transition-colors"
        >
          {t("fullComparison")}
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              d="M5 12h14M12 5l7 7-7 7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </div>
    </Section>
  );
}
