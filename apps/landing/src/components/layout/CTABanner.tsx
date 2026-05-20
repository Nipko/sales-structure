"use client";

import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";
import { SIGNUP_URL, CONTACT_EMAIL } from "../../lib/constants";

export function CTABanner() {
  const t = useTranslations("cta");

  return (
    <Section>
      <div className="relative bg-gradient-to-br from-surface via-surface to-accent/10 border border-accent/30 rounded-3xl py-16 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[600px] h-[600px] bg-accent/15 rounded-full blur-3xl" />
        </div>
        <div className="relative">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-5 tracking-tight">
            {t("title")}
          </h2>
          <p className="text-text-secondary text-base sm:text-lg mb-9 max-w-xl mx-auto">
            {t("subtitle")}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={SIGNUP_URL}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl text-base transition-colors shadow-[0_0_60px_rgba(56,151,240,0.4)] cursor-pointer"
            >
              {t("button")} {Icon.arrow()}
            </a>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex items-center justify-center px-8 py-4 border border-border-light hover:border-accent text-text-primary font-medium rounded-xl text-base transition-colors cursor-pointer"
            >
              {t("secondaryButton")}
            </a>
          </div>
          <p className="mt-7 text-xs text-text-muted">{t("guarantees")}</p>
        </div>
      </div>
    </Section>
  );
}
