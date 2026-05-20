"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import { VERTICALS } from "../../data/verticals";
import { VerticalChatDemo } from "../demos/VerticalChatDemo";
import { Icon } from "../ui/Icon";

/** Only the first 11 verticals have i18n keys in es.json */
const SHOWCASE_VERTICALS = VERTICALS.slice(0, 11);

export function VerticalsShowcase() {
  const t = useTranslations("verticals");
  const [active, setActive] = useState<string>(SHOWCASE_VERTICALS[0].slug);
  const current =
    SHOWCASE_VERTICALS.find((v) => v.slug === active) || SHOWCASE_VERTICALS[0];

  return (
    <div className="space-y-8">
      {/* Industry pills */}
      <div className="flex flex-wrap gap-2 justify-center">
        {SHOWCASE_VERTICALS.map((v) => {
          const isActive = v.slug === active;
          return (
            <button
              key={v.slug}
              onClick={() => setActive(v.slug)}
              className={`relative inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all border cursor-pointer ${
                isActive
                  ? "text-white border-transparent"
                  : "bg-surface border-border text-text-secondary hover:border-border-light hover:text-text-primary"
              }`}
              style={
                isActive
                  ? {
                      backgroundColor: v.color,
                      boxShadow: `0 0 24px ${v.glow}`,
                    }
                  : {}
              }
            >
              <span className="text-base">{v.emoji}</span>
              <span>{t(`${v.slug}.name`)}</span>
              {isActive && (
                <motion.span
                  layoutId="vertical-pill-glow"
                  className="absolute inset-0 rounded-full ring-2"
                  style={{ borderColor: v.color }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Detail: side-by-side chat demo + features */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Chat demo (left) */}
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.3 }}
          >
            <VerticalChatDemo vertical={current} />
          </motion.div>
        </AnimatePresence>

        {/* Features (right) */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${active}-info`}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.3 }}
            className="space-y-5"
          >
            <div>
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold mb-3"
                style={{
                  backgroundColor: `${current.color}20`,
                  color: current.color,
                }}
              >
                <span>{current.emoji}</span>
                <span>{t(`${active}.subtitle`)}</span>
              </span>
              <h3 className="text-2xl font-bold mb-2">
                {t(`${active}.name`)}
              </h3>
              <p className="text-text-secondary leading-relaxed">
                {t(`${active}.tagline`)}
              </p>
            </div>

            <ul className="space-y-3">
              {[1, 2, 3, 4].map((n) => (
                <motion.li
                  key={n}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: n * 0.05 }}
                  className="flex items-start gap-3"
                >
                  <span
                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
                    style={{
                      backgroundColor: `${current.color}20`,
                      color: current.color,
                    }}
                  >
                    {Icon.check("w-3.5 h-3.5")}
                  </span>
                  <span className="text-text-secondary">
                    {t(`${active}.feature${n}`)}
                  </span>
                </motion.li>
              ))}
            </ul>

            <div
              className="p-4 rounded-xl border-l-4 bg-surface/60"
              style={{ borderColor: current.color }}
            >
              <p className="text-xs uppercase tracking-wider text-text-muted mb-1">
                Agente IA recomendado
              </p>
              <p className="font-semibold flex items-center gap-2">
                <span className="text-xl">{current.emoji}</span>
                <span>{t(`${active}.agentName`)}</span>
                <span className="text-xs text-text-muted font-normal">
                  · Pre-configurado
                </span>
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
