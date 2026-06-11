"use client";

import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { FAQItem } from "../ui/FAQItem";
import { WHATSAPP_URL } from "../../lib/constants";

const FAQ_COUNT = 8;

export function FAQSection() {
  const t = useTranslations("faq");

  const faqs = Array.from({ length: FAQ_COUNT }, (_, i) => ({
    q: t(`q${i + 1}`),
    a: t(`a${i + 1}`),
  }));

  return (
    <Section id="preguntas">
      {/* Header */}
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-text-secondary">{t("subtitle")}</p>
      </div>

      {/* Accordion list */}
      <div className="max-w-3xl mx-auto space-y-3">
        {faqs.map((faq, i) => (
          <FAQItem key={i} idx={i} question={faq.q} answer={faq.a} />
        ))}
      </div>

      {/* CTA footer */}
      <div className="max-w-3xl mx-auto mt-10 text-center">
        <p className="text-text-secondary text-sm mb-4">{t("ctaText")}</p>
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-accent hover:text-accent-hover font-medium text-sm transition-colors"
        >
          {t("ctaLink")}
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
        </a>
      </div>
    </Section>
  );
}
