"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";

// Category-positioning band ("Vibe Selling") — disputes the "it's just a chatbot /
// a CRM with a bot" narrative right after the industries showcase, where the
// visitor has just seen that the agent is industry-specific.
export function VibeSellingBand() {
  const t = useTranslations("vibeSelling");

  return (
    <Section className="border-y border-border/50">
      <motion.div
        className="max-w-3xl mx-auto text-center"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
      >
        <span className="text-accent text-xs font-semibold tracking-widest uppercase mb-4 block">
          {t("eyebrow")}
        </span>
        <p className="text-lg sm:text-xl text-text-secondary leading-relaxed">
          {t("lead")}
        </p>
        <p className="mt-3 text-2xl sm:text-4xl font-bold tracking-tight text-text-primary leading-tight">
          {t("punch")}
        </p>
        <p className="mt-5 text-sm sm:text-base text-text-muted max-w-2xl mx-auto leading-relaxed">
          {t("sub")}
        </p>
      </motion.div>
    </Section>
  );
}
