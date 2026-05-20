"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { CountUp } from "../ui/CountUp";

const STATS = [
  { num: 2_000_000, suffix: "+", labelKey: "stat1Label" },
  { num: 4.9, suffix: "/5", labelKey: "stat2Label" },
  { num: 45, suffix: "%", labelKey: "stat3Label" },
  { num: 16, suffix: "", labelKey: "stat4Label" },
] as const;

export function StatsCounter() {
  const t = useTranslations("socialProof");

  return (
    <Section className="border-t border-border/50">
      <p className="text-center text-text-muted text-xs uppercase tracking-widest mb-10">
        {t("trust")}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
        {STATS.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
          >
            <p className="text-3xl sm:text-4xl font-bold text-text-primary">
              <CountUp target={s.num} suffix={s.suffix} />
            </p>
            <p className="mt-1.5 text-xs sm:text-sm text-text-secondary leading-tight">
              {t(s.labelKey)}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
