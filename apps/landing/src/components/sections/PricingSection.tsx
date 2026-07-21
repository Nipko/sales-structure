"use client";

import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";
import { SIGNUP_URL } from "../../lib/constants";
import { useSpotlight } from "../../hooks/useSpotlight";
import { fetchPlans, formatCopPrice, type ApiPlan } from "../../lib/api";

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

const STATIC_FALLBACK: PlanDef[] = [
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
    annualPrice: "$229.800",
    monthlyPrice: "$276.900",
    featuresKey: "starterFeatures",
    ctaKey: "starterCta",
    highlighted: false,
  },
  {
    nameKey: "proName",
    descKey: "proDesc",
    annualPrice: "$628.900",
    monthlyPrice: "$757.700",
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

const SLUG_TO_PLAN_INDEX: Record<string, number> = {
  emprendedor: 0,
  starter: 1,
  pro: 2,
  enterprise: 3,
};

function mapApiPlans(apiPlans: ApiPlan[]): PlanDef[] {
  const result = [...STATIC_FALLBACK];
  for (const ap of apiPlans) {
    const idx = SLUG_TO_PLAN_INDEX[ap.slug];
    if (idx === undefined) continue;
    // displayPriceCents is the monthly price. The annual card shows the per-month
    // EQUIVALENT of the annual plan (suffix is always "/mes"), i.e. the yearly
    // total ÷ 12. Use the real annual price from billing_plans when present; fall
    // back to a ~-17% estimate only if the plan has no annual price configured.
    const monthlyCents = ap.displayPriceCents;
    const annualCents = ap.displayPriceAnnualCents
      ? Math.round(ap.displayPriceAnnualCents / 12)
      : Math.round(monthlyCents * 0.83);
    result[idx] = {
      ...result[idx],
      monthlyPrice: formatCopPrice(monthlyCents),
      annualPrice: formatCopPrice(annualCents),
    };
  }
  return result;
}

interface PricingCardProps {
  plan: PlanDef;
  annual: boolean;
  index: number;
  t: any;
}

function PricingCard({ plan, annual, index, t }: PricingCardProps) {
  const spotlightRef = useSpotlight();
  const price = annual ? plan.annualPrice : plan.monthlyPrice;

  return (
    <motion.div
      ref={spotlightRef}
      className={`relative rounded-2xl p-7 flex flex-col spotlight-card ${
        plan.highlighted
          ? "glass-card border-accent/40 shadow-[0_0_28px_rgba(56,151,240,0.12)] lg:-mt-4"
          : "glass-card"
      }`}
      initial={{ opacity: 0, y: 25 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: index * 0.08, duration: 0.45 }}
    >
      {plan.badgeKey && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-lg shadow-accent/25">
          {t(plan.badgeKey)}
        </span>
      )}

      <h3 className="text-xl font-bold mb-1 mt-1">{t(plan.nameKey)}</h3>
      <p className="text-text-muted text-sm mb-5 leading-snug">{t(plan.descKey)}</p>

      <div className="mb-6 min-h-[60px]">
        <span className="text-4xl font-extrabold tabular tracking-tight">{price}</span>
        <span className="text-sm text-text-muted ml-1">
          {t("perMonth")}
        </span>
      </div>

      <ul className="space-y-3 mb-8 flex-1">
        {(t.raw(plan.featuresKey) as string[]).map((f: string, fi: number) => (
          <li key={fi} className="flex items-start gap-2.5 text-sm leading-relaxed">
            <span className="text-accent flex-shrink-0 mt-0.5 shadow-sm">
              {Icon.check("w-4 h-4")}
            </span>
            <span className="text-text-secondary">{f}</span>
          </li>
        ))}
      </ul>

      <motion.a
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 400, damping: 15 }}
        href={SIGNUP_URL}
        className={`block text-center py-3 px-6 rounded-xl font-semibold transition-all cursor-pointer z-20 ${
          plan.highlighted
            ? "bg-accent hover:bg-accent-hover text-white shadow-[0_0_16px_rgba(56,151,240,0.2)]"
            : "bg-surface-light hover:bg-border border border-border/80 text-text-primary"
        }`}
      >
        {t(plan.ctaKey)}
      </motion.a>
    </motion.div>
  );
}

export function PricingSection() {
  const [annual, setAnnual] = useState(true);
  const [plans, setPlans] = useState<PlanDef[]>(STATIC_FALLBACK);
  const t = useTranslations("pricing");

  useEffect(() => {
    fetchPlans('CO').then(data => {
      if (data && data.length > 0) {
        setPlans(mapApiPlans(data));
      }
    });
  }, []);

  return (
    <Section id="precios" className="bg-surface/30">
      <div className="text-center mb-10">
        <h2 className="text-3xl sm:text-5xl font-bold mb-4 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto text-sm sm:text-base">
          {t("freeTrial")}
        </p>
      </div>

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
          aria-label={t("toggleBillingCycle")}
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
          <span className="ml-1.5 text-emerald-400 text-xs font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
            {t("annualDiscount")}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-start max-w-7xl mx-auto">
        {plans.map((plan, i) => (
          <PricingCard key={plan.nameKey} plan={plan} annual={annual} index={i} t={t} />
        ))}
      </div>

      <p className="text-center text-xs text-text-muted mt-8">
        {t("currencyHint")}
      </p>

      {/* Transparency strip — IA incluida + WhatsApp pass-through + sin permanencia */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5 max-w-3xl mx-auto">
        {["transparencyAiIncluded", "transparencyWhatsapp", "transparencyNoLockin"].map((k) => (
          <span
            key={k}
            className="inline-flex items-center gap-1.5 text-xs text-text-secondary glass-card rounded-full px-3 py-1.5 border border-border/60"
          >
            <span className="text-emerald-400 flex-shrink-0">{Icon.check("w-3.5 h-3.5")}</span>
            {t(k)}
          </span>
        ))}
      </div>

      <div className="text-center mt-6">
        <Link
          href="/precios"
          className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover font-semibold transition-colors"
        >
          {t("fullComparison")}
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
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
