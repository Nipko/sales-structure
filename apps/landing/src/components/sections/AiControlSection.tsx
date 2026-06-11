"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";

// "Tu IA bajo control" — answers the non-technical owner's #1 objection: can I
// trust what the AI tells my customers? Each promise maps to a real capability
// (RAG threshold, configured handoff, output guardrails, trace view).
const PROMISES = [
  { key: "promise1", iconFn: () => Icon.book("w-6 h-6") },
  { key: "promise2", iconFn: () => Icon.users("w-6 h-6") },
  { key: "promise3", iconFn: () => Icon.fingerprint("w-6 h-6") },
];

export function AiControlSection() {
  const t = useTranslations("aiControl");

  return (
    <Section id="control" className="bg-surface/30">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {PROMISES.map((p, i) => (
          <motion.div
            key={p.key}
            className="glass-card rounded-2xl p-6"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          >
            <div className="inline-flex items-center justify-center w-11 h-11 bg-accent/10 text-accent border border-accent/20 rounded-xl mb-4">
              {p.iconFn()}
            </div>
            <h3 className="text-base font-bold mb-1.5 text-white">{t(`${p.key}Title`)}</h3>
            <p className="text-text-secondary text-sm leading-relaxed">{t(`${p.key}Desc`)}</p>
          </motion.div>
        ))}
      </div>

      {/* Reassurance FAQ */}
      <div className="max-w-3xl mx-auto mt-8 glass-card rounded-2xl p-6 flex gap-4 items-start">
        <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-accent/10 text-accent border border-accent/20 flex items-center justify-center">
          {Icon.shieldCheck("w-5 h-5")}
        </span>
        <div>
          <p className="font-bold mb-1.5">{t("faqQ")}</p>
          <p className="text-text-secondary text-sm leading-relaxed">{t("faqA")}</p>
        </div>
      </div>
    </Section>
  );
}
