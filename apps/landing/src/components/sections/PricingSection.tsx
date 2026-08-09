"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";
import { planContactUrl, planSignupUrl } from "../../lib/constants";
import { useSpotlight } from "../../hooks/useSpotlight";
import {
  formatMoney,
  formatChannelNames,
  PRICING_COUNTRIES,
  pricingCountryName,
  type ApiPlan,
  type PricingCountry,
} from "../../lib/api";
import { usePlanCatalog } from "../../hooks/usePlanCatalog";

function isSalesLed(plan: ApiPlan): boolean {
  return plan.features?.salesLed === true || plan.slug === "custom";
}

function formatLimit(value: unknown, locale: string, unlimited: string): string {
  const number = Number(value);
  if (number === -1) return unlimited;
  return Number.isFinite(number) ? new Intl.NumberFormat(locale).format(number) : "—";
}

function planHighlights(plan: ApiPlan, locale: string, t: any): string[] {
  const highlights: string[] = [];
  const channels = Array.isArray(plan.features?.channels)
    ? plan.features.channels.filter((channel): channel is string => typeof channel === "string")
    : [];
  const unlimited = t("valueUnlimited");

  if (channels.length > 0) {
    highlights.push(t("liveChannels", { channels: formatChannelNames(channels) }));
  }
  highlights.push(t("liveAiMessages", {
    count: formatLimit(plan.maxAiMessages, locale, unlimited),
  }));
  highlights.push(t("liveAgents", {
    count: formatLimit(plan.maxAgents, locale, unlimited),
  }));

  const maxCalendars = plan.features?.maxCalendars;
  if (maxCalendars !== undefined && maxCalendars !== null) {
    highlights.push(t("liveCalendars", {
      count: formatLimit(maxCalendars, locale, unlimited),
    }));
  }
  if (plan.features?.customPrompt === true) highlights.push(t("liveCustomPrompt"));
  if (plan.features?.whiteLabel === true) highlights.push(t("liveWhiteLabel"));

  return highlights;
}

interface PricingCardProps {
  plan: ApiPlan;
  annual: boolean;
  index: number;
  locale: string;
  t: any;
}

function PricingCard({ plan, annual, index, locale, t }: PricingCardProps) {
  const spotlightRef = useSpotlight();
  const salesLed = isSalesLed(plan);
  const highlighted = plan.slug === "pro";
  const annualTotal = annual && typeof plan.displayPriceAnnualCents === "number"
    ? plan.displayPriceAnnualCents
    : null;
  const price = salesLed
    ? t("customPrice")
    : formatMoney(
        annualTotal !== null ? Math.round(annualTotal / 12) : plan.displayPriceCents,
        plan.displayCurrency,
        locale,
      );
  const highlights = planHighlights(plan, locale, t);
  const cycle = annual ? "annual" : "monthly";
  const selectedCycleAvailable = annual ? plan.annualAvailable : plan.monthlyAvailable;
  const canStartTrial = !annual && plan.trialAvailable;
  const canSignup = plan.signupAvailable && (selectedCycleAvailable || canStartTrial);
  const ctaHref = canSignup
    ? planSignupUrl(plan.slug, plan.displayCountry, cycle)
    : planContactUrl(plan.name, plan.displayCountry, cycle);
  const availabilityHint = salesLed
    ? null
    : plan.signupUnavailableReason === "card_trial_not_supported"
      ? t("cardTrialUnavailable")
      : canStartTrial && !plan.monthlyAvailable
        ? t("trialRenewalPending")
        : !selectedCycleAvailable
          ? t("checkoutUnavailable")
          : null;

  return (
    <motion.div
      ref={spotlightRef}
      className={`relative rounded-2xl p-7 flex flex-col spotlight-card ${
        highlighted
          ? "glass-card border-accent/40 shadow-[0_0_28px_rgba(56,151,240,0.12)] xl:-mt-4"
          : "glass-card"
      }`}
      initial={{ opacity: 0, y: 25 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: index * 0.06, duration: 0.45 }}
    >
      {highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-lg shadow-accent/25">
          {t("popular")}
        </span>
      )}

      <h3 className="text-xl font-bold mb-1 mt-1">{plan.name}</h3>
      <p className="text-text-muted text-sm mb-5 leading-snug">
        {t("planSummary", {
          agents: formatLimit(plan.maxAgents, locale, t("valueUnlimited")),
          messages: formatLimit(plan.maxAiMessages, locale, t("valueUnlimited")),
        })}
      </p>

      <div className="mb-5 min-h-[72px]">
        <span className={`${salesLed ? "text-3xl" : "text-4xl"} font-extrabold tabular tracking-tight`}>
          {price}
        </span>
        {!salesLed && <span className="text-sm text-text-muted ml-1">{t("perMonth")}</span>}
        {annualTotal !== null && (
          <p className="text-xs text-text-muted mt-1">
            {t("billedAnnually", {
              total: formatMoney(annualTotal, plan.displayCurrency, locale),
            })}
          </p>
        )}
      </div>

      {!salesLed && plan.trialDays > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-semibold">
            {t("trialBadge", { days: plan.trialDays })}
          </span>
          <span className="text-xs text-text-muted">
            {plan.requiresCardForTrial ? t("requiresCard") : t("noCard")}
          </span>
        </div>
      )}

      <ul className="space-y-3 mb-8 flex-1">
        {highlights.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm leading-relaxed">
            <span className="text-accent flex-shrink-0 mt-0.5 shadow-sm">
              {Icon.check("w-4 h-4")}
            </span>
            <span className="text-text-secondary">{feature}</span>
          </li>
        ))}
      </ul>

      {availabilityHint && (
        <p className="mb-4 text-xs leading-relaxed text-amber-300/90" role="status">
          {availabilityHint}
        </p>
      )}

      <motion.a
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 400, damping: 15 }}
        href={ctaHref}
        className={`block text-center py-3 px-6 rounded-xl font-semibold transition-all cursor-pointer z-20 ${
          highlighted
            ? "bg-accent hover:bg-accent-hover text-white shadow-[0_0_16px_rgba(56,151,240,0.2)]"
            : "bg-surface-light hover:bg-border border border-border/80 text-text-primary"
        }`}
      >
        {salesLed
          ? t("contactSales")
          : canSignup
            ? t("startWith", { plan: plan.name })
            : t("requestAccess")}
      </motion.a>
    </motion.div>
  );
}

export function PricingSection() {
  const [annual, setAnnual] = useState(false);
  const t = useTranslations("pricing");
  const locale = useLocale();
  const { country, setCountry, plans, status, retry } = usePlanCatalog();
  const selfServePlans = useMemo(() => plans.filter((plan) => !isSalesLed(plan)), [plans]);
  const annualAvailable = selfServePlans.some(
    (plan) => plan.annualAvailable
      && typeof plan.displayPriceAnnualCents === "number"
      && plan.displayPriceAnnualCents > 0,
  );

  useEffect(() => setAnnual(false), [country]);

  return (
    <Section id="precios" className="bg-surface/30">
      <div className="text-center mb-8">
        <h2 className="text-3xl sm:text-5xl font-bold mb-4 tracking-tight">{t("title")}</h2>
        <p className="text-text-secondary max-w-2xl mx-auto text-sm sm:text-base">{t("freeTrial")}</p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 mb-10">
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <span>{t("countryLabel")}</span>
          <select
            value={country ?? "CO"}
            onChange={(event) => setCountry(event.target.value as PricingCountry)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-text-primary focus:border-accent focus:outline-none"
          >
            {PRICING_COUNTRIES.map((code) => (
              <option key={code} value={code}>{pricingCountryName(code, locale)}</option>
            ))}
          </select>
        </label>

        {annualAvailable && status === "ready" && (
          <div className="flex items-center gap-3">
            <span className={`text-sm ${!annual ? "text-text-primary font-medium" : "text-text-muted"}`}>
              {t("monthly")}
            </span>
            <button
              type="button"
              onClick={() => setAnnual((value) => !value)}
              className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${annual ? "bg-accent" : "bg-border-light"}`}
              aria-label={t("toggleBillingCycle")}
              role="switch"
              aria-checked={annual}
            >
              <motion.div
                className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow"
                animate={{ left: annual ? "26px" : "2px" }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            </button>
            <span className={`text-sm ${annual ? "text-text-primary font-medium" : "text-text-muted"}`}>
              {t("annual")}
            </span>
          </div>
        )}
      </div>

      {status === "loading" && (
        <div className="glass-card rounded-2xl py-12 text-center text-text-secondary" aria-live="polite">
          {t("loadingPlans")}
        </div>
      )}
      {(status === "error" || status === "empty") && (
        <div className="glass-card rounded-2xl py-10 px-6 text-center" role="alert">
          <p className="text-text-secondary mb-4">{status === "empty" ? t("noPlans") : t("plansError")}</p>
          <button type="button" onClick={retry} className="text-accent hover:text-accent-hover font-semibold">
            {t("retry")}
          </button>
        </div>
      )}
      {status === "ready" && (
        <div className={`grid grid-cols-1 md:grid-cols-2 ${plans.length >= 5 ? "lg:grid-cols-3" : "lg:grid-cols-4"} gap-6 items-start mx-auto`}>
          {plans.map((plan, index) => (
            <PricingCard key={plan.id ?? plan.slug} plan={plan} annual={annual} index={index} locale={locale} t={t} />
          ))}
        </div>
      )}

      <p className="text-center text-xs text-text-muted mt-8">{t("currencyHint")}</p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5 max-w-3xl mx-auto">
        {["transparencyAiIncluded", "transparencyWhatsapp", "transparencyNoLockin"].map((key) => (
          <span
            key={key}
            className="inline-flex items-center gap-1.5 text-xs text-text-secondary glass-card rounded-full px-3 py-1.5 border border-border/60"
          >
            <span className="text-emerald-400 flex-shrink-0">{Icon.check("w-3.5 h-3.5")}</span>
            {t(key)}
          </span>
        ))}
      </div>

      <div className="text-center mt-6">
        <Link href="/precios" className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover font-semibold transition-colors">
          {t("fullComparison")}
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </Section>
  );
}
