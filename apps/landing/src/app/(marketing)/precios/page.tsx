"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import { PLANS, FEATURE_MATRIX, FEATURE_CATEGORIES, UPSELLS } from "../../../data/pricing";
import { Section } from "../../../components/ui/Section";
import { Icon } from "../../../components/ui/Icon";
import { FAQItem } from "../../../components/ui/FAQItem";
import { CTABanner } from "../../../components/layout/CTABanner";
import { JsonLd } from "../../../components/ui/JsonLd";
import { pricingJsonLd, breadcrumbJsonLd } from "../../../lib/seo";
import { SIGNUP_URL, CONTACT_EMAIL } from "../../../lib/constants";

function renderValue(val: string, t: ReturnType<typeof useTranslations>) {
  if (val === "true") return <span className="text-emerald-400">{Icon.check("w-5 h-5")}</span>;
  if (val === "false") return <span className="text-zinc-600">{Icon.x("w-5 h-5")}</span>;
  if (val === "unlimited") return <span className="text-accent font-semibold">{t("valueUnlimited")}</span>;
  if (val === "basic") return <span className="text-text-muted">{t("valueBasic")}</span>;
  if (val === "good") return <span className="text-text-secondary">{t("valueGood")}</span>;
  if (val === "advanced") return <span className="text-accent">{t("valueAdvanced")}</span>;
  if (val === "premium") return <span className="text-emerald-400 font-semibold">{t("valuePremium")}</span>;
  if (val === "custom") return <span className="text-text-muted">{t("valueCustomOnly")}</span>;
  if (val === "—") return <span className="text-zinc-600">—</span>;
  return <span>{val}</span>;
}

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);
  const [expandedCat, setExpandedCat] = useState<string | null>("communication");
  const [quizStep, setQuizStep] = useState(0);
  const [quizScores, setQuizScores] = useState([0, 0, 0]);
  const t = useTranslations("pricingPage");

  const quizAnswer = (step: number, score: number) => {
    const next = [...quizScores];
    next[step] = score;
    setQuizScores(next);
    setQuizStep(step + 1);
  };

  const quizResult = () => {
    const total = quizScores.reduce((a, b) => a + b, 0);
    if (total <= 2) return "Emprendedor";
    if (total <= 4) return "Starter";
    if (total <= 6) return "Pro";
    return "Enterprise";
  };

  return (
    <>
      <JsonLd
        data={pricingJsonLd(
          PLANS.map((p) => ({
            name: p.nameKey,
            price: p.priceUsd,
            currency: "USD",
            features: [],
          }))
        )}
      />
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

          {/* Toggle */}
          <div className="flex items-center justify-center gap-3 mb-2">
            <span className={`text-sm transition-colors ${!annual ? "text-text-primary font-medium" : "text-text-muted"}`}>
              {t("monthly")}
            </span>
            <button
              onClick={() => setAnnual(!annual)}
              className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${annual ? "bg-accent" : "bg-border-light"}`}
              aria-label="Toggle billing"
            >
              <motion.div
                className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow"
                animate={{ left: annual ? "26px" : "2px" }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            </button>
            <span className={`text-sm transition-colors ${annual ? "text-text-primary font-medium" : "text-text-muted"}`}>
              {t("annual")}
              <span className="ml-1.5 text-emerald-400 text-xs font-bold">{t("annualDiscount")}</span>
            </span>
          </div>
          <p className="text-xs text-text-muted">{t("saveAnnual")}</p>
        </div>
      </section>

      {/* Plan Cards */}
      <Section>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 items-start">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.slug}
              className={`relative rounded-2xl p-7 border flex flex-col ${
                plan.highlighted
                  ? "bg-surface border-accent/40 shadow-[0_0_60px_rgba(56,151,240,0.12)] lg:-mt-4"
                  : "bg-surface border-border"
              }`}
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.45 }}
            >
              {plan.badgeKey && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                  {t("mostPopular")}
                </span>
              )}
              <h3 className="text-xl font-bold mb-1">{plan.nameKey}</h3>
              <p className="text-text-muted text-sm mb-5">
                {plan.maxAgents} agente{plan.maxAgents > 1 ? "s" : ""} IA · {plan.maxAiMessages} msg/mes
              </p>

              <div className="mb-6">
                <span className="text-4xl font-bold tabular">
                  {annual ? plan.priceCopAnnual : plan.priceCopMonthly}
                </span>
                <span className="text-sm text-text-muted ml-1">{t("perMonth")}</span>
                <p className="text-xs text-text-muted mt-1">
                  USD ${plan.priceUsd}{t("perMonth")}
                </p>
              </div>

              <div className="flex items-center gap-2 mb-5">
                <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-semibold">
                  {t("trialBadge", { days: plan.trialDays })}
                </span>
                <span className="text-xs text-text-muted">
                  {plan.requiresCard ? t("requiresCard") : t("noCard")}
                </span>
              </div>

              <a
                href={SIGNUP_URL}
                className={`block text-center py-3 px-6 rounded-xl font-semibold transition-colors cursor-pointer mb-4 ${
                  plan.highlighted
                    ? "bg-accent hover:bg-accent-hover text-white shadow-[0_0_30px_rgba(56,151,240,0.3)]"
                    : "bg-surface-light hover:bg-border border border-border text-text-primary"
                }`}
              >
                {i === 0 ? t("startFree") : t("startWith", { plan: plan.nameKey })}
              </a>

              {/* Upsell nudge */}
              {i < PLANS.length - 1 && (
                <div className="mt-auto pt-4 border-t border-border/50">
                  <p className="text-xs text-text-muted mb-1">{t("needMore")}</p>
                  {UPSELLS.find((u) => u.fromPlan === plan.slug)?.highlightKeys.map((key) => (
                    <p key={key} className="text-xs text-accent">
                      {t(key)}
                    </p>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </Section>

      {/* Full Comparison Matrix */}
      <Section className="bg-surface/30">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">{t("comparisonTitle")}</h2>
          <p className="text-text-secondary max-w-2xl mx-auto">{t("comparisonSubtitle")}</p>
        </div>

        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-4 pr-4 text-sm text-text-secondary font-medium w-[40%]"></th>
                {PLANS.map((plan) => (
                  <th
                    key={plan.slug}
                    className={`py-4 px-3 text-sm font-bold text-center ${
                      plan.highlighted ? "text-accent" : "text-text-primary"
                    }`}
                  >
                    {plan.nameKey}
                  </th>
                ))}
              </tr>
            </thead>
            {FEATURE_CATEGORIES.map((cat) => {
              const isOpen = expandedCat === cat.key;
              const rows = FEATURE_MATRIX.filter((r) => r.category === cat.key);

              return (
                <tbody key={cat.key}>
                  <tr
                    className="border-b border-border cursor-pointer hover:bg-surface-light/30 transition-colors"
                    onClick={() => setExpandedCat(isOpen ? null : cat.key)}
                  >
                    <td className="py-3.5 pr-4 font-semibold text-text-primary flex items-center gap-2">
                      <span className="text-text-muted transition-transform" style={{ transform: isOpen ? "rotate(180deg)" : "" }}>
                        {Icon.chevronDown("w-4 h-4")}
                      </span>
                      {t(cat.labelKey)}
                      <span className="text-xs text-text-muted font-normal">({rows.length})</span>
                    </td>
                    <td colSpan={4}></td>
                  </tr>
                  {isOpen &&
                    rows.map((row) => (
                      <tr key={row.key} className="border-b border-border/40">
                        <td className="py-3 pr-4 pl-8 text-sm text-text-secondary">
                          {t(`feature${row.key.charAt(0).toUpperCase() + row.key.slice(1)}`)}
                        </td>
                        {row.values.map((val, vi) => (
                          <td
                            key={vi}
                            className={`py-3 px-3 text-center text-sm ${
                              PLANS[vi].highlighted ? "bg-accent/5" : ""
                            }`}
                          >
                            {renderValue(val, t)}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              );
            })}
          </table>
        </div>
      </Section>

      {/* Plan Quiz */}
      <Section>
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
              <p className="text-4xl font-bold text-accent mb-4">{quizResult()}</p>
              <a
                href={SIGNUP_URL}
                className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-6 py-3 rounded-xl font-semibold transition-colors"
              >
                {t("startFree")} {Icon.arrow()}
              </a>
              <button
                onClick={() => { setQuizStep(0); setQuizScores([0, 0, 0]); }}
                className="block mx-auto mt-3 text-sm text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              >
                Reintentar
              </button>
            </motion.div>
          )}
        </div>
      </Section>

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
