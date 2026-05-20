"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";

const STEPS = [
  { num: "1", iconFn: () => Icon.inbox("w-6 h-6"), titleKey: "step1", descKey: "step1Desc", tagKey: "step1Tag" },
  { num: "2", iconFn: () => Icon.layers("w-6 h-6"), titleKey: "step2", descKey: "step2Desc", tagKey: "step2Tag" },
  { num: "3", iconFn: () => Icon.zap("w-6 h-6"), titleKey: "step3", descKey: "step3Desc", tagKey: "step3Tag" },
];

export function HowItWorks() {
  const t = useTranslations("howItWorks");

  return (
    <Section id="como-funciona" className="bg-surface/30">
      <div className="text-center mb-16">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
          {t("sectionTitle")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
        {/* Connector line between cards on desktop */}
        <div className="hidden md:block absolute top-12 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border-light to-transparent" />

        {STEPS.map((step, i) => (
          <motion.div
            key={i}
            className="relative glass-card rounded-2xl p-7 hover:border-accent/40 transition-colors"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.12, duration: 0.5 }}
          >
            <div className="flex items-start justify-between mb-5">
              <div className="relative inline-flex items-center justify-center w-12 h-12 bg-accent/10 text-accent rounded-xl">
                {step.iconFn()}
              </div>
              <span className="text-xs font-mono text-accent bg-accent/10 px-2.5 py-1 rounded-full">
                {t(step.tagKey)}
              </span>
            </div>
            <p className="text-sm font-mono text-text-muted mb-2">PASO {step.num}</p>
            <h3 className="text-xl font-bold mb-2.5">{t(step.titleKey)}</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              {t(step.descKey)}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
