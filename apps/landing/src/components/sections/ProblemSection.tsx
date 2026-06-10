"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";

// Problem → agitation backbone. Copy lives in `problem.*` (was written but never
// rendered). Sits right after the hero so the visitor recognizes the pain before
// we pitch the solution.
const CARDS = [
  { key: "card1", iconFn: () => Icon.inbox("w-6 h-6") },
  { key: "card2", iconFn: () => Icon.users("w-6 h-6") },
  { key: "card3", iconFn: () => Icon.chart("w-6 h-6") },
];

export function ProblemSection() {
  const t = useTranslations("problem");

  return (
    <Section id="problema">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {CARDS.map((c, i) => (
          <motion.div
            key={c.key}
            className="glass-card rounded-2xl p-6"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          >
            <div className="inline-flex items-center justify-center w-11 h-11 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl mb-4">
              {c.iconFn()}
            </div>
            <p className="text-text-secondary text-sm leading-relaxed">{t(c.key)}</p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
