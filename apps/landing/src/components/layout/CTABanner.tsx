"use client";

import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";
import { SIGNUP_URL, WHATSAPP_URL } from "../../lib/constants";

export function CTABanner() {
  const t = useTranslations("cta");

  return (
    <Section>
      <div className="relative bg-gradient-to-br from-surface via-surface to-accent/10 border border-accent/30 rounded-3xl py-16 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[500px] h-[500px] bg-accent/8 rounded-full blur-3xl" />
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
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl text-base transition-colors shadow-[0_0_24px_rgba(56,151,240,0.25)] cursor-pointer"
            >
              {t("button")} {Icon.arrow()}
            </a>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-[#25D366]/40 hover:border-[#25D366] text-text-primary font-medium rounded-xl text-base transition-colors cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="#25D366" className="w-5 h-5"><path d="M12 2C6.5 2 2 6.2 2 11.3c0 1.8.5 3.5 1.5 5L2 22l5.9-1.5c1.4.8 3 1.2 4.6 1.2 5.5 0 10-4.2 10-9.4S17.5 2 12 2Zm5.8 13.3c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.6-1.2-3s.7-2.1 1-2.4c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5.2.6.8 2 .9 2.1.1.1.1.3 0 .5-.1.2-.1.3-.3.5l-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.2.1 1.5.7 1.7.8.2.1.4.2.5.3.1.1.1.6-.1 1.3Z"/></svg>
              {t("secondaryButton")}
            </a>
          </div>
          <p className="mt-7 text-xs text-text-muted">{t("guarantees")}</p>
        </div>
      </div>
    </Section>
  );
}
