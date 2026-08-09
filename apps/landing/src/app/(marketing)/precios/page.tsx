"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { FEATURE_MATRIX, FEATURE_CATEGORIES, resolveFeatureValue } from "../../../data/pricing";
import {
  formatMoney,
  PRICING_COUNTRIES,
  pricingCountryName,
  type ApiPlan,
  type PricingCountry,
} from "../../../lib/api";
import { usePlanCatalog } from "../../../hooks/usePlanCatalog";
import { Section } from "../../../components/ui/Section";
import { Icon } from "../../../components/ui/Icon";
import { FAQItem } from "../../../components/ui/FAQItem";
import { CTABanner } from "../../../components/layout/CTABanner";
import { JsonLd } from "../../../components/ui/JsonLd";
import { pricingJsonLd, breadcrumbJsonLd } from "../../../lib/seo";
import { CONTACT_EMAIL, planContactUrl, planSignupUrl } from "../../../lib/constants";

function renderValue(val: string, t: ReturnType<typeof useTranslations>) {
  if (val === "true") return (
    <span className="text-emerald-400">
      <span aria-hidden="true">{Icon.check("w-5 h-5")}</span>
      <span className="sr-only">{t("valueIncluded")}</span>
    </span>
  );
  if (val === "false") return (
    <span className="text-zinc-600">
      <span aria-hidden="true">{Icon.x("w-5 h-5")}</span>
      <span className="sr-only">{t("valueNotIncluded")}</span>
    </span>
  );
  if (val === "unlimited") return <span className="text-accent font-semibold">{t("valueUnlimited")}</span>;
  if (val === "basic") return <span className="text-text-muted">{t("valueBasic")}</span>;
  if (val === "good") return <span className="text-text-secondary">{t("valueGood")}</span>;
  if (val === "advanced") return <span className="text-accent">{t("valueAdvanced")}</span>;
  if (val === "premium") return <span className="text-emerald-400 font-semibold">{t("valuePremium")}</span>;
  if (val === "custom") return <span className="text-text-muted">{t("valueCustomOnly")}</span>;
  if (val === "—") return <span className="text-zinc-600">—</span>;
  return <span>{val}</span>;
}

function isSalesLed(plan: ApiPlan): boolean {
  return plan.features?.salesLed === true || plan.slug === "custom";
}

function formatLimit(value: unknown, locale: string, unlimited: string): string {
  const number = Number(value);
  if (number === -1) return unlimited;
  return Number.isFinite(number) ? new Intl.NumberFormat(locale).format(number) : "—";
}

export default function PricingPage() {
  const [annual, setAnnual] = useState(false);
  const [expandedCat, setExpandedCat] = useState<string | null>("communication");
  const [quizStep, setQuizStep] = useState(0);
  const [quizScores, setQuizScores] = useState([0, 0, 0]);
  const t = useTranslations("pricingPage");
  const locale = useLocale();
  const { country, setCountry, plans, status, retry } = usePlanCatalog();
  const selfServePlans = useMemo(() => plans.filter((plan) => !isSalesLed(plan)), [plans]);
  const annualAvailable = selfServePlans.some(
    (plan) => plan.annualAvailable
      && typeof plan.displayPriceAnnualCents === "number"
      && plan.displayPriceAnnualCents > 0,
  );

  useEffect(() => setAnnual(false), [country]);

  const quizAnswer = (step: number, score: number) => {
    const next = [...quizScores];
    next[step] = score;
    setQuizScores(next);
    setQuizStep(step + 1);
  };

  const quizResult = (): ApiPlan | null => {
    const total = quizScores.reduce((a, b) => a + b, 0);
    if (selfServePlans.length === 0) return null;
    const planIndex = Math.min(
      selfServePlans.length - 1,
      Math.round((total / 6) * (selfServePlans.length - 1)),
    );
    return selfServePlans[planIndex];
  };

  const recommendedPlan = quizStep >= 3 ? quizResult() : null;
  const recommendedCycle = annual ? "annual" : "monthly";
  const recommendedCycleAvailable = recommendedPlan
    ? (annual ? recommendedPlan.annualAvailable : recommendedPlan.monthlyAvailable)
    : false;
  const recommendedCanSignup = Boolean(
    recommendedPlan?.signupAvailable
    && (recommendedCycleAvailable || (!annual && recommendedPlan.trialAvailable)),
  );

  return (
    <>
      <JsonLd data={pricingJsonLd()} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Inicio", url: "/" },
          { name: "Precios", url: "/precios" },
        ])}
      />

      {/* Hero */}
      <section className="pt-12 pb-8 px-6 text-center">
        <div className="mx-auto max-w-4xl">
          <motion.h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-5"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {t("heroTitle")}
          </motion.h1>
          <motion.p
            className="text-lg text-text-secondary mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            {t("heroSubtitle")}
          </motion.p>

          <div className="flex flex-wrap items-center justify-center gap-4">
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
                <span className={`text-sm transition-colors ${!annual ? "text-text-primary font-medium" : "text-text-muted"}`}>
                  {t("monthly")}
                </span>
                <button
                  type="button"
                  onClick={() => setAnnual((value) => !value)}
                  className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${annual ? "bg-accent" : "bg-border-light"}`}
                  aria-label={t("toggleBilling")}
                  role="switch"
                  aria-checked={annual}
                >
                  <motion.div
                    className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow"
                    animate={{ left: annual ? "26px" : "2px" }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                </button>
                <span className={`text-sm transition-colors ${annual ? "text-text-primary font-medium" : "text-text-muted"}`}>
                  {t("annual")}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Plan Cards */}
      <Section>
        {status === "loading" && (
          <div className="rounded-2xl border border-border bg-surface py-12 text-center text-text-secondary" aria-live="polite">
            {t("loadingPlans")}
          </div>
        )}
        {(status === "error" || status === "empty") && (
          <div className="rounded-2xl border border-border bg-surface py-10 px-6 text-center" role="alert">
            <p className="text-text-secondary mb-4">{status === "empty" ? t("noPlans") : t("plansError")}</p>
            <button type="button" onClick={retry} className="text-accent hover:text-accent-hover font-semibold">
              {t("retry")}
            </button>
          </div>
        )}
        {status === "ready" && (
          <div className={`grid grid-cols-1 md:grid-cols-2 ${plans.length >= 5 ? "lg:grid-cols-3" : "lg:grid-cols-4"} gap-5 items-start`}>
            {plans.map((plan, index) => {
              const salesLed = isSalesLed(plan);
              const highlighted = plan.slug === "pro";
              const annualTotal = annual && typeof plan.displayPriceAnnualCents === "number"
                ? plan.displayPriceAnnualCents
                : null;
              const displayPrice = salesLed
                ? t("customPrice")
                : formatMoney(
                    annualTotal !== null ? Math.round(annualTotal / 12) : plan.displayPriceCents,
                    plan.displayCurrency,
                    locale,
                  );
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
                  key={plan.id ?? plan.slug}
                  className={`relative rounded-2xl p-7 border flex flex-col ${
                    highlighted
                      ? "bg-surface border-accent/40 shadow-[0_0_28px_rgba(56,151,240,0.1)] xl:-mt-4"
                      : "bg-surface border-border"
                  }`}
                  initial={{ opacity: 0, y: 25 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.06, duration: 0.45 }}
                >
                  {highlighted && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                      {t("mostPopular")}
                    </span>
                  )}
                  <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                  <p className="text-text-muted text-sm mb-5">
                    {t("planSubtitle", {
                      agents: formatLimit(plan.maxAgents, locale, t("valueUnlimited")),
                      messages: formatLimit(plan.maxAiMessages, locale, t("valueUnlimited")),
                    })}
                  </p>

                  <div className="mb-6 min-h-[72px]">
                    <span className={`${salesLed ? "text-3xl" : "text-4xl"} font-bold tabular`}>{displayPrice}</span>
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

                  {availabilityHint && (
                    <p className="mb-4 text-xs leading-relaxed text-amber-300/90" role="status">
                      {availabilityHint}
                    </p>
                  )}

                  <a
                    href={ctaHref}
                    className={`block text-center py-3 px-6 rounded-xl font-semibold transition-colors cursor-pointer mt-auto ${
                      highlighted
                        ? "bg-accent hover:bg-accent-hover text-white shadow-[0_0_16px_rgba(56,151,240,0.2)]"
                        : "bg-surface-light hover:bg-border border border-border text-text-primary"
                    }`}
                  >
                    {salesLed
                      ? t("contactSales")
                      : canSignup
                        ? t("startWith", { plan: plan.name })
                        : t("requestAccess")}
                  </a>
                </motion.div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Full Comparison Matrix */}
      <Section className="bg-surface/30">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">{t("comparisonTitle")}</h2>
          <p className="text-text-secondary max-w-2xl mx-auto">{t("comparisonSubtitle")}</p>
        </div>

        {status === "ready" && <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full min-w-[700px]">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="text-left py-4 pr-4 text-sm text-text-secondary font-medium w-[40%]">
                  {t("featureColumn")}
                </th>
                {plans.map((plan) => (
                  <th
                    key={plan.id ?? plan.slug}
                    scope="col"
                    className={`py-4 px-3 text-sm font-bold text-center ${
                      plan.slug === "pro" ? "text-accent" : "text-text-primary"
                    }`}
                  >
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            {FEATURE_CATEGORIES.map((cat) => {
              const isOpen = expandedCat === cat.key;
              const rows = FEATURE_MATRIX.filter((r) => r.category === cat.key);

              return (
                <tbody key={cat.key} id={`feature-category-${cat.key}`}>
                  <tr className="border-b border-border hover:bg-surface-light/30 transition-colors">
                    <td className="py-1 pr-4 font-semibold text-text-primary">
                      <button
                        type="button"
                        onClick={() => setExpandedCat(isOpen ? null : cat.key)}
                        aria-expanded={isOpen}
                        aria-controls={`feature-category-${cat.key}`}
                        className="flex w-full items-center gap-2 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <span className="text-text-muted transition-transform" style={{ transform: isOpen ? "rotate(180deg)" : "" }} aria-hidden="true">
                          {Icon.chevronDown("w-4 h-4")}
                        </span>
                        {t(cat.labelKey)}
                        <span className="text-xs text-text-muted font-normal">({rows.length})</span>
                      </button>
                    </td>
                    <td colSpan={plans.length}></td>
                  </tr>
                  {isOpen &&
                    rows.map((row) => (
                      <tr key={row.key} className="border-b border-border/40">
                        <td className="py-3 pr-4 pl-8 text-sm text-text-secondary">
                          {t(`feature${row.key.charAt(0).toUpperCase() + row.key.slice(1)}`)}
                        </td>
                        {plans.map((plan) => (
                          <td
                            key={plan.id ?? plan.slug}
                            className={`py-3 px-3 text-center text-sm ${
                              plan.slug === "pro" ? "bg-accent/5" : ""
                            }`}
                          >
                            {renderValue(resolveFeatureValue(plan, row, locale), t)}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              );
            })}
          </table>
        </div>}
      </Section>

      {/* Plan Quiz */}
      {status === "ready" && <Section>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-3">{t("quizTitle")}</h2>
          <p className="text-text-secondary mb-8">{t("quizSubtitle")}</p>

          {quizStep < 3 ? (
            <div className="bg-surface border border-border rounded-2xl p-8">
              <p className="text-sm text-text-muted mb-2">
                {quizStep + 1} / 3
              </p>
              <AnimatePresence mode="wait">
                <motion.div
                  key={quizStep}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  <p className="text-lg font-semibold mb-6">{t(`quizQ${quizStep + 1}`)}</p>
                  <div className="flex flex-col gap-3">
                    {["a", "b", "c"].map((letter, li) => (
                      <button
                        type="button"
                        key={letter}
                        onClick={() => quizAnswer(quizStep, li)}
                        className="w-full text-left px-5 py-3 bg-bg border border-border rounded-xl hover:border-accent/40 transition-colors cursor-pointer"
                      >
                        {t(`quizA${quizStep + 1}${letter}`)}
                      </button>
                    ))}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-surface border border-accent/30 rounded-2xl p-8"
            >
              <p className="text-text-muted mb-2">{t("quizResult")}</p>
              <p className="text-4xl font-bold text-accent mb-4">{recommendedPlan?.name ?? "—"}</p>
              <a
                href={recommendedPlan
                  ? (recommendedCanSignup
                      ? planSignupUrl(recommendedPlan.slug, recommendedPlan.displayCountry, recommendedCycle)
                      : planContactUrl(recommendedPlan.name, recommendedPlan.displayCountry, recommendedCycle))
                  : planContactUrl("Catalog", country ?? "CO", recommendedCycle)}
                className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-6 py-3 rounded-xl font-semibold transition-colors"
              >
                {recommendedCanSignup ? t("startFree") : t("requestAccess")} {Icon.arrow()}
              </a>
              <button
                type="button"
                onClick={() => { setQuizStep(0); setQuizScores([0, 0, 0]); }}
                className="block mx-auto mt-3 text-sm text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              >
                {t("quizRetry")}
              </button>
            </motion.div>
          )}
        </div>
      </Section>}

      {/* Enterprise CTA */}
      <Section className="bg-surface/30">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-3">{t("enterpriseCtaTitle")}</h2>
          <p className="text-text-secondary mb-8">{t("enterpriseCtaSubtitle")}</p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-8 py-4 rounded-xl font-bold text-lg transition-colors"
          >
            {t("enterpriseCtaButton")} {Icon.arrow()}
          </a>
        </div>
      </Section>

      {/* Pricing FAQ */}
      <Section>
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">{t("faqTitle")}</h2>
        </div>
        <div className="max-w-3xl mx-auto space-y-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <FAQItem
              key={n}
              idx={n}
              question={t(`faqQ${n}`)}
              answer={t(`faqA${n}`)}
            />
          ))}
        </div>
      </Section>

      <CTABanner />
    </>
  );
}
