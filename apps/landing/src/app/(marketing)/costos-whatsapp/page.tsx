"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Section } from "../../../components/ui/Section";
import { Icon } from "../../../components/ui/Icon";
import { FAQItem } from "../../../components/ui/FAQItem";
import { JsonLd } from "../../../components/ui/JsonLd";
import { ThreePaymentsPanel } from "../../../components/sections/ThreePaymentsPanel";
import { breadcrumbJsonLd, faqJsonLd } from "../../../lib/seo";
import { routes } from "../../../lib/routes";
import {
  CHANNELS_WITHOUT_PER_MESSAGE_CHARGE,
  META_WHATSAPP_CHARGE,
} from "../../../data/payment-model";

/**
 * ═══ THE PAGE THAT EXISTS SO NOBODY LEARNS THIS FROM AN INVOICE ═════════════
 *
 * Three things this page is careful NOT to do, each of which would be easy and
 * would make it read better:
 *
 *   - print a per-message rate. Meta prices by the RECIPIENT's country and
 *     revises the cards quarterly, so any number here is wrong at the next
 *     revision and right for almost nobody in between;
 *   - show an estimated monthly maximum. An estimate rendered next to a real
 *     subscription price is read as an invoice, and this one would be built
 *     from assumptions the reader never made;
 *   - suggest that coming back from Meta means the account is funded. The most
 *     we can honestly say is that we re-read what Meta reports, and that an
 *     attached method is not balance and not delivery.
 */

const CATEGORY_KEYS = ["Service", "Marketing", "Utility", "Authentication"] as const;
const SETUP_STEPS = [1, 2, 3, 4, 5] as const;
const SECURITY_POINTS = ["security1", "security2", "security3"] as const;
const LIMIT_POINTS = ["limits1", "limits2", "limits3"] as const;
const FAQ_NUMBERS = [1, 2, 3, 4, 5] as const;

export default function WhatsappCostsPage() {
  const t = useTranslations("whatsappCosts");
  const faqs = FAQ_NUMBERS.map((n) => ({ question: t(`faqQ${n}`), answer: t(`faqA${n}`) }));

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Inicio", url: routes.home },
          { name: "Costos de WhatsApp", url: routes.whatsappCosts },
        ])}
      />
      <JsonLd data={faqJsonLd(faqs)} />

      {/* Hero */}
      <section className="px-6 pb-8 pt-12">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            {t("heroEyebrow")}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{t("heroTitle")}</h1>
          <p className="mt-5 text-lg leading-relaxed text-text-secondary">{t("heroSubtitle")}</p>
          <p className="mt-6 text-sm text-text-muted">{t("heroReviewed")}</p>
          <p className="mt-1 text-sm text-text-muted">{t("heroReviewedNote")}</p>
        </div>
      </section>

      {/* The three payments — the same panel /precios renders */}
      <Section className="border-y border-border/50 bg-surface/20">
        <ThreePaymentsPanel />
      </Section>

      {/* How Meta's charge works */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("ruleTitle")}</h2>
          <p className="mt-4 leading-relaxed text-text-secondary">{t("ruleIntro")}</p>

          <div className="mt-8 rounded-2xl border border-accent/25 bg-accent/5 p-6">
            <h3 className="text-base font-semibold text-text-primary">{t("allowanceTitle")}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{t("allowanceBody")}</p>
          </div>

          <div className="mt-10">
            <h3 className="text-xl font-semibold text-text-primary">{t("categoriesTitle")}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{t("categoriesIntro")}</p>
            <ul className="mt-5 space-y-3">
              {CATEGORY_KEYS.map((key) => (
                <li
                  key={key}
                  className="flex items-start gap-3 rounded-xl border border-border bg-surface/60 p-4"
                >
                  <span className="mt-0.5 shrink-0 text-accent" aria-hidden="true">
                    {Icon.check("h-4 w-4")}
                  </span>
                  <p className="text-sm leading-relaxed text-text-secondary">
                    {t(`category${key}`)}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface/60 p-5">
              <h3 className="text-base font-semibold text-text-primary">{t("countryTitle")}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{t("countryBody")}</p>
            </div>
            <div className="rounded-2xl border border-border bg-surface/60 p-5">
              <h3 className="text-base font-semibold text-text-primary">{t("noEstimateTitle")}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                {t("noEstimateBody")}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-surface/60 p-5">
            <h3 className="text-base font-semibold text-text-primary">{t("ratesTitle")}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{t("ratesBody")}</p>
            <a
              href={META_WHATSAPP_CHARGE.officialRatesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t("ratesLink")}
              <span aria-hidden="true">{Icon.externalLink("h-4 w-4")}</span>
            </a>
          </div>

          <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5">
            <h3 className="text-base font-semibold text-text-primary">{t("deadlineTitle")}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{t("deadlineBody")}</p>
          </div>
        </div>
      </Section>

      {/* Setting up Meta billing — five steps, two of which are not ours */}
      <Section className="border-y border-border/50 bg-surface/20">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("setupTitle")}</h2>
          <p className="mt-4 leading-relaxed text-text-secondary">{t("setupIntro")}</p>

          <ol className="mt-8 space-y-4">
            {SETUP_STEPS.map((number) => (
              <li key={number} className="glass-card rounded-2xl p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                  {t("setupStep", { number })}
                </p>
                <h3 className="mt-2 text-base font-semibold text-text-primary">
                  {t(`setupStep${number}Title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  {t(`setupStep${number}Body`)}
                </p>
              </li>
            ))}
          </ol>

          <p className="mt-6 flex items-start gap-2 text-sm text-text-muted">
            <span className="mt-0.5 shrink-0" aria-hidden="true">
              {Icon.externalLink("h-4 w-4")}
            </span>
            {t("setupExternalNotice")}
          </p>
          <a
            href={META_WHATSAPP_CHARGE.addPaymentMethodHelpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {t("setupOpenMeta")}
            <span aria-hidden="true">{Icon.externalLink("h-4 w-4")}</span>
          </a>
        </div>
      </Section>

      {/* What we never touch, and what we cannot control */}
      <Section>
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
            <div className="flex items-center gap-3">
              <span className="text-emerald-300" aria-hidden="true">
                {Icon.lock("h-5 w-5")}
              </span>
              <h2 className="text-xl font-semibold text-text-primary">{t("securityTitle")}</h2>
            </div>
            <ul className="mt-5 space-y-3">
              {SECURITY_POINTS.map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true">
                    {Icon.check("h-4 w-4")}
                  </span>
                  <p className="text-sm leading-relaxed text-text-secondary">{t(key)}</p>
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-emerald-500/20 pt-4 text-xs leading-relaxed text-text-muted">
              {t("securityNote")}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface/60 p-6">
            <div className="flex items-center gap-3">
              <span className="text-text-muted" aria-hidden="true">
                {Icon.shield("h-5 w-5")}
              </span>
              <h2 className="text-xl font-semibold text-text-primary">{t("limitsTitle")}</h2>
            </div>
            <ul className="mt-5 space-y-3">
              {LIMIT_POINTS.map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true">
                    {Icon.minus("h-4 w-4")}
                  </span>
                  <p className="text-sm leading-relaxed text-text-secondary">{t(key)}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-5xl rounded-2xl border border-border bg-surface/40 p-6">
          <h2 className="text-xl font-semibold text-text-primary">{t("otherChannelsTitle")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {t("otherChannelsBody")}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {CHANNELS_WITHOUT_PER_MESSAGE_CHARGE.map((channel) => (
              <li
                key={channel}
                className="rounded-full border border-border bg-bg/50 px-3 py-1 text-xs font-medium text-text-secondary"
              >
                {channel}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* FAQ */}
      <Section className="border-t border-border/50 bg-surface/20">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight">{t("faqTitle")}</h2>
        </div>
        <div className="mx-auto max-w-3xl space-y-3">
          {faqs.map((faq, index) => (
            <FAQItem key={index} idx={index} question={faq.question} answer={faq.answer} />
          ))}
        </div>
      </Section>

      {/* Close */}
      <Section>
        <div className="mx-auto max-w-3xl rounded-3xl border border-accent/30 bg-gradient-to-br from-surface via-surface to-accent/10 px-6 py-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight">{t("ctaTitle")}</h2>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-text-secondary">{t("ctaBody")}</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href={routes.pricing}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t("ctaPricing")}
              <span aria-hidden="true">{Icon.arrow("h-5 w-5")}</span>
            </Link>
            <a
              href={META_WHATSAPP_CHARGE.officialRatesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface/60 px-7 py-3.5 text-base font-semibold text-text-primary transition-colors hover:border-border-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t("ctaRates")}
              <span aria-hidden="true">{Icon.externalLink("h-4 w-4")}</span>
            </a>
          </div>
        </div>
      </Section>
    </>
  );
}
