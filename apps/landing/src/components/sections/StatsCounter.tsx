"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { CountUp } from "../ui/CountUp";
import { PRODUCT_CAPABILITY_COUNTS } from "../../data/product-capabilities";
import { MARKETING_CLAIMS } from "../../data/marketing-claims";

/**
 * The three numbers this site is willing to stand behind, each rendered from
 * the registry rather than typed into copy.
 *
 * The middle one is a zero, and that is the point: five connectable channels
 * with nothing said about certification reads as five that finished it, which
 * the audited closure report explicitly refuses. Publishing the zero next to
 * the five is what keeps the five honest.
 */

const STATS = [
  {
    num: PRODUCT_CAPABILITY_COUNTS.selfServiceChannels,
    labelKey: "stat1Label",
    claimId: MARKETING_CLAIMS.selfServiceChannelCount.claimId,
  },
  {
    num: PRODUCT_CAPABILITY_COUNTS.certifiedChannels,
    labelKey: "stat2Label",
    claimId: MARKETING_CLAIMS.certifiedChannelCount.claimId,
  },
  {
    num: PRODUCT_CAPABILITY_COUNTS.interfaceLanguages,
    labelKey: "stat3Label",
    claimId: MARKETING_CLAIMS.interfaceLanguageCount.claimId,
  },
] as const;

export function StatsCounter() {
  const t = useTranslations("socialProof");
  const reduceMotion = useReducedMotion();

  return (
    <Section className="border-t border-border/50">
      <p className="text-center text-text-muted text-xs uppercase tracking-widest mb-10">
        {t("trust")}
      </p>
      <div className="grid grid-cols-1 gap-6 text-center sm:grid-cols-3">
        {STATS.map((stat, index) => (
          <motion.div
            key={stat.claimId}
            data-claim-id={stat.claimId}
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.08 }}
          >
            <p className="text-3xl sm:text-4xl font-bold text-text-primary">
              {/* A zero has nothing to count up to, and animating it looks broken. */}
              {stat.num === 0 ? "0" : <CountUp target={stat.num} />}
            </p>
            <p className="mt-1.5 text-xs sm:text-sm text-text-secondary leading-tight">
              {t(stat.labelKey)}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
