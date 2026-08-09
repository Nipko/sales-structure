"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";

const FLOW_STEPS = [
  {
    key: "channel",
    icon: Icon.inbox("h-5 w-5"),
    iconClass: "border-sky-400/20 bg-sky-400/10 text-sky-300",
  },
  {
    key: "ai",
    icon: Icon.sparkles("h-5 w-5"),
    iconClass: "border-violet-400/20 bg-violet-400/10 text-violet-300",
  },
  {
    key: "operation",
    icon: Icon.layers("h-5 w-5"),
    iconClass: "border-cyan-400/20 bg-cyan-400/10 text-cyan-300",
  },
  {
    key: "team",
    icon: Icon.users("h-5 w-5"),
    iconClass: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  },
] as const;

export function ResultsBand() {
  const t = useTranslations("flow");

  return (
    <Section id="flujo" className="border-y border-border/50 bg-surface/20">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          {t("eyebrow")}
        </p>
        <h2 id="flow-title" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          {t("title")}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl leading-relaxed text-text-secondary">
          {t("subtitle")}
        </p>
      </div>

      <ol
        className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4 lg:gap-6"
        aria-labelledby="flow-title"
      >
        {FLOW_STEPS.map((step, index) => (
          <motion.li
            key={step.key}
            className="relative"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: index * 0.07 }}
          >
            <div className="glass-card flex h-full flex-col rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border ${step.iconClass}`}
                  aria-hidden="true"
                >
                  {step.icon}
                </span>
                <span className="text-xs font-semibold tabular-nums text-text-muted">
                  {t("stepLabel", { number: index + 1 })}
                </span>
              </div>

              <h3 className="mt-5 text-base font-semibold leading-snug text-text-primary">
                {t(`${step.key}Title`)}
              </h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-text-secondary">
                {t(`${step.key}Desc`)}
              </p>

              <div className="mt-5 border-t border-border/70 pt-3">
                <p className="flex items-start gap-2 text-xs font-medium leading-relaxed text-text-primary">
                  <span className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true">
                    {Icon.check("h-3.5 w-3.5")}
                  </span>
                  {t(`${step.key}Output`)}
                </p>
              </div>
            </div>

            {index < FLOW_STEPS.length - 1 ? (
              <span
                className="absolute -right-[18px] top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg text-accent lg:flex"
                aria-hidden="true"
              >
                {Icon.arrow("h-4 w-4")}
              </span>
            ) : null}
          </motion.li>
        ))}
      </ol>

      <div className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-2xl border border-accent/20 bg-accent/5 px-5 py-4 text-center text-sm text-text-secondary">
        <span className="font-semibold text-text-primary">{t("summaryLead")}</span>
        <span aria-hidden="true" className="hidden text-accent sm:inline">→</span>
        <span>{t("summary")}</span>
      </div>
    </Section>
  );
}
