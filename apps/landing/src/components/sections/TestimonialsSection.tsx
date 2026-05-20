"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";

const TESTIMONIALS = [
  { prefix: "t1", initials: "ML", color: "#f43f5e" },
  { prefix: "t2", initials: "CG", color: "#3b82f6" },
  { prefix: "t3", initials: "VR", color: "#f97316" },
];

export function TestimonialsSection() {
  const t = useTranslations("testimonials");

  return (
    <Section>
      <div className="text-center mb-14">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-text-secondary">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {TESTIMONIALS.map((tm, i) => (
          <motion.div
            key={tm.prefix}
            className="bg-surface border border-border rounded-2xl p-7 flex flex-col"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.1, duration: 0.5 }}
          >
            {/* Quote icon */}
            <svg
              className="w-8 h-8 text-accent/30 mb-4"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
            </svg>

            {/* Quote text */}
            <p className="text-text-secondary leading-relaxed flex-1 mb-6 italic">
              {t(`${tm.prefix}Quote`)}
            </p>

            {/* Divider + author info */}
            <div className="flex items-center gap-3 pt-4 border-t border-border/50">
              {/* Avatar circle with colored initials */}
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                style={{ backgroundColor: tm.color }}
              >
                {tm.initials}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {t(`${tm.prefix}Name`)}
                </p>
                <p className="text-xs text-text-muted truncate">
                  {t(`${tm.prefix}Role`)} · {t(`${tm.prefix}Company`)}
                </p>
              </div>

              {/* Stat badge */}
              <span className="text-[11px] bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full font-bold flex-shrink-0">
                {t(`${tm.prefix}Stat`)}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
