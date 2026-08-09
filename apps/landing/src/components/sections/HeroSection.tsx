"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { SIGNUP_URL } from "../../lib/constants";
import { Icon } from "../ui/Icon";

export function HeroSection() {
  const t = useTranslations("hero");

  return (
    <section
      className="relative overflow-hidden px-6 pb-20 pt-28 sm:pb-24 lg:flex lg:min-h-[90vh] lg:items-center"
      aria-labelledby="hero-title"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-[8%] top-[-15%] h-[620px] w-[620px] rounded-full bg-[radial-gradient(circle,rgba(56,151,240,0.16),transparent_68%)] blur-3xl" />
        <div className="absolute right-[-8%] top-[8%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(6,182,212,0.1),transparent_68%)] blur-3xl" />
        <div className="absolute bottom-[-22%] left-[42%] h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.08),transparent_68%)] blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(420px,0.98fr)] lg:gap-16">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3.5 py-1.5 text-xs font-semibold text-accent backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              {t("badge")}
            </span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.05 }}
          >
            <h1
              id="hero-title"
              className="mt-6 max-w-3xl text-4xl font-black leading-[1.04] tracking-tight sm:text-5xl lg:text-[3.7rem]"
            >
              {t.rich("title", {
                em: (chunks) => (
                  <span className="bg-gradient-to-r from-accent via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                    {chunks}
                  </span>
                ),
              })}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">
              {t("subtitle")}
            </p>
          </motion.div>

          <motion.div
            className="mt-8 flex flex-col gap-3 sm:flex-row"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <a
              href={SIGNUP_URL}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-base font-semibold text-white shadow-[0_0_22px_rgba(56,151,240,0.28)] transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t("cta")}
              <span aria-hidden="true">{Icon.arrow("h-5 w-5")}</span>
            </a>
            <a
              href="#flujo"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-surface/60 px-7 py-3.5 text-base font-semibold text-text-primary transition-colors hover:border-border-light hover:bg-surface-light/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t("ctaSecondary")}
            </a>
          </motion.div>

          <motion.div
            className="mt-6 space-y-2 text-sm text-text-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.45, delay: 0.25 }}
          >
            <p className="flex items-center gap-2">
              <span className="text-emerald-400" aria-hidden="true">
                {Icon.check("h-4 w-4")}
              </span>
              {t("noCard")}
            </p>
            <p className="flex items-start gap-2">
              <span className="mt-0.5 text-accent" aria-hidden="true">
                {Icon.shield("h-4 w-4")}
              </span>
              {t("trustline")}
            </p>
          </motion.div>
        </div>

        <motion.div
          className="relative mx-auto w-full max-w-xl"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.65, delay: 0.12 }}
          aria-label={t("visualLabel")}
        >
          <div className="absolute -inset-5 rounded-[2rem] bg-accent/10 blur-3xl" aria-hidden="true" />
          <div className="glass-card relative overflow-hidden rounded-3xl border border-white/10 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-surface/80 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#25D366]/10">
                  <img src="/logos/whatsapp.svg" alt="" className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-primary">{t("visualTitle")}</p>
                  <p className="text-xs text-text-muted">{t("visualChannel")}</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                {t("visualLive")}
              </span>
            </div>

            <div className="space-y-4 p-5 sm:p-6">
              <div className="ml-auto max-w-[86%] rounded-2xl rounded-br-sm bg-accent px-4 py-3 text-sm leading-relaxed text-white">
                {t("visualCustomer")}
              </div>
              <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-surface-light/70 px-4 py-3 text-sm leading-relaxed text-text-primary">
                {t("visualAssistant")}
                <div className="mt-3 flex items-center gap-2 border-t border-border/70 pt-2 text-[11px] text-text-muted">
                  <span className="text-accent" aria-hidden="true">{Icon.book("h-3.5 w-3.5")}</span>
                  {t("visualSource")}
                </div>
              </div>

              <div className="grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-bg/35 p-3.5">
                  <div className="mb-2 flex items-center gap-2 text-accent">
                    <span aria-hidden="true">{Icon.users("h-4 w-4")}</span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider">CRM</span>
                  </div>
                  <p className="text-xs leading-relaxed text-text-secondary">{t("visualCrm")}</p>
                </div>
                <div className="rounded-xl border border-border bg-bg/35 p-3.5">
                  <div className="mb-2 flex items-center gap-2 text-cyan-300">
                    <span aria-hidden="true">{Icon.calendar("h-4 w-4")}</span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider">{t("visualAgendaLabel")}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-text-secondary">{t("visualAgenda")}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300" aria-hidden="true">
                  {Icon.inbox("h-4 w-4")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-text-primary">{t("visualTeam")}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{t("visualTeamDesc")}</p>
                </div>
                <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-[10px] font-semibold text-text-secondary">
                  {t("visualDevices")}
                </span>
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-text-muted">{t("visualDisclaimer")}</p>
        </motion.div>
      </div>
    </section>
  );
}
