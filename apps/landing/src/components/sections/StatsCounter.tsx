"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { CountUp } from "../ui/CountUp";
import { PRODUCT_CAPABILITY_COUNTS } from "../../data/product-capabilities";

const STATS = [
  { num: PRODUCT_CAPABILITY_COUNTS.verticals, suffix: "", labelKey: "stat1Label" },
  { num: PRODUCT_CAPABILITY_COUNTS.channels, suffix: "", labelKey: "stat2Label" },
  { num: PRODUCT_CAPABILITY_COUNTS.interfaceLanguages, suffix: "", labelKey: "stat3Label" },
  { num: PRODUCT_CAPABILITY_COUNTS.knowledgeTiers, suffix: "", labelKey: "stat4Label" },
  { num: PRODUCT_CAPABILITY_COUNTS.promptLayers, suffix: "", labelKey: "stat5Label" },
] as const;

export function StatsCounter() {
  const t = useTranslations("socialProof");

  return (
    <Section className="border-t border-border/50">
      <p className="text-center text-text-muted text-xs uppercase tracking-widest mb-10">
        {t("trust")}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6 text-center">
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
