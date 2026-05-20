"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { SIGNUP_URL } from "../../lib/constants";
import { Icon } from "../ui/Icon";
import { VerticalChatDemo } from "../demos/VerticalChatDemo";
import { VERTICALS } from "../../data/verticals";

export function HeroSection() {
  const t = useTranslations("hero");

  return (
    <section className="relative pt-28 pb-20 px-6 overflow-hidden">
      {/* Backdrop glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[800px] bg-accent/10 blur-3xl pointer-events-none" />

      <div className="mx-auto max-w-6xl relative">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
          {/* Left text */}
          <motion.div
            className="flex-1 text-center lg:text-left"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <motion.span
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/30 text-accent text-xs font-semibold mb-6"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              {t("badge")}
            </motion.span>

            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold leading-[1.05] tracking-tight">
              {t.rich("title", {
                em: () => (
                  <span className="bg-gradient-to-r from-accent via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                    {t("titleHighlight")}
                  </span>
                ),
              })}
            </h1>

            <p className="mt-6 text-lg text-text-secondary max-w-xl mx-auto lg:mx-0 leading-relaxed">
              {t("subtitle")}
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <a
                href={SIGNUP_URL}
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl text-base transition-all shadow-[0_0_20px_rgba(56,151,240,0.25)] hover:shadow-[0_0_28px_rgba(56,151,240,0.35)] cursor-pointer"
              >
                {t("cta")} {Icon.arrow()}
              </a>
              <a
                href="#como-funciona"
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-border hover:border-border-light text-text-primary rounded-xl text-base font-medium transition-colors cursor-pointer"
              >
                {t("ctaSecondary")}
              </a>
            </div>

            <p className="mt-5 text-xs text-text-muted">{t("noCard")}</p>

            <div className="mt-8 pt-6 border-t border-border/50 max-w-md mx-auto lg:mx-0">
              <p className="text-xs text-text-muted">{t("trustline")}</p>
            </div>
          </motion.div>

          {/* Right demo */}
          <motion.div
            className="flex-1 w-full max-w-md"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            <VerticalChatDemo vertical={VERTICALS[0]} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
