"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import { SIGNUP_URL } from "../../lib/constants";
import { Icon, getVerticalIcon } from "../ui/Icon";
import { VerticalChatDemo } from "../demos/VerticalChatDemo";
import { VERTICALS } from "../../data/verticals";

const HERO_VERTICALS = VERTICALS.filter((v) => v.tier === 1).slice(0, 6);

export function HeroSection() {
  const t = useTranslations("hero");
  const [activeIdx, setActiveIdx] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent) => {
    const { clientX, clientY } = e;
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Calculate position from center (-0.5 to 0.5)
    const x = (clientX / width) - 0.5;
    const y = (clientY / height) - 0.5;
    setMousePos({ x, y });
  };

  return (
    <section 
      onMouseMove={handleMouseMove}
      className="relative pt-28 pb-20 px-6 overflow-hidden min-h-[90vh] flex items-center justify-center"
    >
      {/* Interactive Aurora mesh background — Parallax drift reactive to mouse */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div
          className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] rounded-full blur-[120px] opacity-[0.14] pointer-events-none"
          style={{ 
            background: "radial-gradient(circle, #3897f0 0%, transparent 70%)", 
            transform: `translate(${mousePos.x * 40}px, ${mousePos.y * 40}px)`,
            transition: "transform 0.4s cubic-bezier(0.1, 0.8, 0.2, 1)",
            animation: "aurora-drift 18s ease-in-out infinite"
          }}
        />
        <div
          className="absolute top-[10%] right-[10%] w-[500px] h-[500px] rounded-full blur-[100px] opacity-[0.09] pointer-events-none"
          style={{ 
            background: "radial-gradient(circle, #06b6d4 0%, transparent 70%)", 
            transform: `translate(${mousePos.x * -35}px, ${mousePos.y * -35}px)`,
            transition: "transform 0.4s cubic-bezier(0.1, 0.8, 0.2, 1)",
            animation: "aurora-drift-reverse 20s ease-in-out infinite"
          }}
        />
        <div
          className="absolute bottom-[-5%] left-[40%] w-[400px] h-[400px] rounded-full blur-[100px] opacity-[0.07] pointer-events-none"
          style={{ 
            background: "radial-gradient(circle, #10b981 0%, transparent 70%)", 
            transform: `translate(${mousePos.x * 25}px, ${mousePos.y * -25}px)`,
            transition: "transform 0.4s cubic-bezier(0.1, 0.8, 0.2, 1)",
            animation: "aurora-drift 22s ease-in-out infinite 2s"
          }}
        />
      </div>

      <div className="mx-auto max-w-5xl relative z-10 w-full">
        {/* Badge */}
        <motion.div
          className="text-center mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-accent/10 border border-accent/25 text-accent text-xs font-semibold backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            {t("badge")}
          </span>
        </motion.div>

        {/* Headline — centered */}
        <motion.div
          className="text-center max-w-3xl mx-auto mb-6"
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
        >
          <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-black leading-[1.05] tracking-tight">
            {t.rich("title", {
              em: () => (
                <span className="bg-gradient-to-r from-accent via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                  {t("titleHighlight")}
                </span>
              ),
            })}
          </h1>
          <p className="mt-5 text-base sm:text-lg text-text-secondary max-w-2xl mx-auto leading-relaxed">
            {t("subtitle")}
          </p>
        </motion.div>

        {/* Before/After transformation strip */}
        <motion.div
          className="flex items-center justify-center gap-3 mb-8"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          <div className="glass-card rounded-xl px-4 py-2.5 flex items-center gap-2 border border-white/5 shadow-md">
            <span className="w-2 h-2 rounded-full bg-danger" />
            <span className="text-xs text-text-muted">{t("beforeLabel")}</span>
            <span className="text-sm font-semibold text-text-primary tabular">{t("beforeStat")}</span>
          </div>
          <svg className="w-5 h-5 text-accent flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="glass-card rounded-xl px-4 py-2.5 flex items-center gap-2 border border-accent/20 shadow-md">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span className="text-xs text-text-muted">{t("afterLabel")}</span>
            <span className="text-sm font-semibold text-accent tabular">{t("afterStat")}</span>
          </div>
        </motion.div>

        {/* Industry picker pills */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <p className="text-center text-xs text-text-muted mb-3 font-medium uppercase tracking-wider">{t("pickIndustry")}</p>
          <div className="flex flex-wrap gap-2 justify-center max-w-3xl mx-auto">
            {HERO_VERTICALS.map((v, i) => (
              <motion.button
                key={v.slug}
                onClick={() => setActiveIdx(i)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 15 }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition-all border cursor-pointer ${
                  i === activeIdx
                    ? "bg-accent text-white border-transparent shadow-lg shadow-accent/25"
                    : "bg-surface-light/50 text-text-muted border-border hover:border-border-light hover:text-text-secondary"
                }`}
              >
                <span className="w-3.5 h-3.5" style={{ color: i === activeIdx ? "white" : v.color }}>{getVerticalIcon(v.slug, "w-3.5 h-3.5")}</span>
                <span>{t(`verticalName.${v.slug}`)}</span>
              </motion.button>
            ))}
          </div>
          <p className="text-center text-xs text-accent/80 mt-3 font-medium max-w-xl mx-auto">
            {t("vibeSelling")}
          </p>
        </motion.div>

        {/* Demo — the star of the hero */}
        <motion.div
          className="mx-auto max-w-sm relative"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25 }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent z-20 pointer-events-none h-full w-full" />
          <p className="text-center text-xs text-text-muted mb-3 font-semibold uppercase tracking-wider">{t("demoLabel")}</p>
          <div className="relative z-10 shadow-2xl rounded-2xl">
            <AnimatePresence mode="wait">
              <motion.div
                key={HERO_VERTICALS[activeIdx].slug}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.3 }}
              >
                <VerticalChatDemo vertical={HERO_VERTICALS[activeIdx]} />
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>

        {/* CTAs below demo */}
        <motion.div
          className="mt-10 flex flex-col sm:flex-row gap-4 justify-center relative z-30"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
        >
          <motion.a
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
            href={SIGNUP_URL}
            className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl text-base transition-all shadow-[0_0_20px_rgba(56,151,240,0.25)] hover:shadow-[0_0_28px_rgba(56,151,240,0.35)] cursor-pointer"
          >
            {t("cta")} {Icon.arrow()}
          </motion.a>
          <motion.a
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
            href="#como-funciona"
            className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-border hover:border-border-light text-text-primary rounded-xl text-base font-semibold transition-colors cursor-pointer"
          >
            {t("ctaSecondary")}
          </motion.a>
        </motion.div>

        {/* Trust line */}
        <motion.div
          className="mt-8 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <p className="text-xs text-text-muted">{t("noCard")}</p>
          <p className="text-xs text-text-muted mt-2">{t("trustline")}</p>
        </motion.div>
      </div>
    </section>
  );
}
