"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import {
  TESTIMONIALS_PUBLICATION_ENABLED,
  VERIFIED_TESTIMONIAL_EVIDENCE,
} from "../../data/testimonial-evidence";

const COLORS = ["#f43f5e", "#3b82f6", "#f97316"] as const;

export function TestimonialsSection() {
  const t = useTranslations("testimonials");

  if (!TESTIMONIALS_PUBLICATION_ENABLED || VERIFIED_TESTIMONIAL_EVIDENCE.length === 0) {
    return null;
  }

  return (
    <Section>
      <div className="text-center mb-14">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-text-secondary">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {VERIFIED_TESTIMONIAL_EVIDENCE.map((tm, i) => (
          <motion.div
            key={tm.id}
            className="glass-card rounded-2xl p-7 flex flex-col"
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
              {t(tm.quoteKey)}
            </p>

            {/* Divider + author info */}
            <div className="flex items-center gap-3 pt-4 border-t border-border/50">
              {/* Avatar circle with colored initials */}
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              >
                {tm.authorName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {tm.authorName}
                </p>
                <p className="text-xs text-text-muted truncate">
                  {tm.authorRole} · {tm.companyName}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
