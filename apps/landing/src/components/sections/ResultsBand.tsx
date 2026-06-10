"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";

// Results band on the home page — answers "¿qué gano?" before asking the visitor
// to explore features. Reuses the roiStat keys already used by the vertical pages.
const STATS = [
  { stat: "roiStat1", label: "roiStat1Label", iconFn: () => Icon.trendingUp("w-6 h-6") },
  { stat: "roiStat2", label: "roiStat2Label", iconFn: () => Icon.zap("w-6 h-6") },
  { stat: "roiStat3", label: "roiStat3Label", iconFn: () => Icon.calendar("w-6 h-6") },
];

export function ResultsBand() {
  const t = useTranslations("industryPage");

  return (
    <Section className="border-y border-border/50">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto text-center">
        {STATS.map((s, i) => (
          <motion.div
            key={s.stat}
            className="flex flex-col items-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
          >
            <div className="inline-flex items-center justify-center w-12 h-12 bg-accent/10 text-accent border border-accent/20 rounded-xl mb-3">
              {s.iconFn()}
            </div>
            <p className="text-4xl sm:text-5xl font-bold text-text-primary">{t(s.stat)}</p>
            <p className="mt-1.5 text-sm text-text-secondary">{t(s.label)}</p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
