"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";
import { useSpotlight } from "../../hooks/useSpotlight";

const FEATURES = [
  { iconFn: () => Icon.bot("w-6 h-6"), key: "f1" },
  { iconFn: () => Icon.inbox("w-6 h-6"), key: "f2" },
  { iconFn: () => Icon.users("w-6 h-6"), key: "f3" },
  { iconFn: () => Icon.calendar("w-6 h-6"), key: "f4" },
  { iconFn: () => Icon.zap("w-6 h-6"), key: "f5" },
  { iconFn: () => Icon.chart("w-6 h-6"), key: "f6" },
  { iconFn: () => Icon.book("w-6 h-6"), key: "f7" },
  { iconFn: () => Icon.layers("w-6 h-6"), key: "f8" },
  { iconFn: () => Icon.fingerprint("w-6 h-6"), key: "f9" },
  { iconFn: () => Icon.mail("w-6 h-6"), key: "f10" },
  { iconFn: () => Icon.shield("w-6 h-6"), key: "f11" },
  { iconFn: () => Icon.lock("w-6 h-6"), key: "f12" },
];

interface FeatureCardProps {
  feature: typeof FEATURES[0];
  index: number;
  t: any;
}

function FeatureCard({ feature, index, t }: FeatureCardProps) {
  const spotlightRef = useSpotlight();

  return (
    <motion.div
      ref={spotlightRef}
      className="glass-card rounded-2xl p-6 spotlight-card transition-all group"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: (index % 3) * 0.05, duration: 0.4 }}
    >
      <div className="inline-flex items-center justify-center w-11 h-11 bg-accent/10 text-accent border border-accent/20 rounded-xl mb-4 group-hover:scale-105 transition-transform duration-300">
        {feature.iconFn()}
      </div>
      <h3 className="text-base font-bold mb-1.5 text-white">
        {t(`${feature.key}Title`)}
      </h3>
      <p className="text-text-secondary text-sm leading-relaxed">
        {t(`${feature.key}Desc`)}
      </p>
    </motion.div>
  );
}

export function FeaturesGrid() {
  const t = useTranslations("features");

  return (
    <Section id="caracteristicas">
      <div className="text-center mb-14">
        <h2 className="text-3xl sm:text-5xl font-extrabold mb-4 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-7xl mx-auto">
        {FEATURES.map((f, i) => (
          <FeatureCard key={f.key} feature={f} index={i} t={t} />
        ))}
      </div>
    </Section>
  );
}
