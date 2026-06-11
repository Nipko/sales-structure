"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import { VERTICALS, CLUSTER_LABELS, getVerticalsByCluster, VerticalCluster } from "../../data/verticals";
import { VerticalChatDemo } from "../demos/VerticalChatDemo";
import { MiniChannelDemo, CHANNEL_SCENARIOS } from "./MultiChannelShowcase";
import { Section } from "../ui/Section";
import { Icon, getVerticalIcon } from "../ui/Icon";

// Widgets flotantes
import { BookingLiveWidget } from "../widgets/BookingLiveWidget";
import { CrmKanbanWidget } from "../widgets/CrmKanbanWidget";
import { IdentityMergeWidget } from "../widgets/IdentityMergeWidget";

const CLUSTERS: VerticalCluster[] = [
  "salud-bienestar",
  "comercio-servicios",
  "profesional-finanzas",
  "lifestyle-creativos",
];

export function VerticalsShowcase() {
  const t = useTranslations("verticals");
  const tChannels = useTranslations("channels");
  const [view, setView] = useState<"industry" | "channel">("industry");
  const [activeCluster, setActiveCluster] = useState<VerticalCluster>("salud-bienestar");
  
  const clusterVerticals = getVerticalsByCluster(activeCluster);
  const [activeVertical, setActiveVertical] = useState<string>(clusterVerticals[0]?.slug || VERTICALS[0].slug);
  const [chatStep, setChatStep] = useState<number>(0);

  const CLUSTER_FALLBACKS: Record<VerticalCluster, string> = {
    "salud-bienestar": "Salud y Bienestar",
    "comercio-servicios": "Comercio y Servicios",
    "profesional-finanzas": "Profesional y Finanzas",
    "lifestyle-creativos": "Lifestyle y Creativos",
  };

  const handleClusterChange = (cluster: VerticalCluster) => {
    setActiveCluster(cluster);
    const verticals = getVerticalsByCluster(cluster);
    if (verticals.length > 0) {
      setActiveVertical(verticals[0].slug);
      setChatStep(0); // Reset chat state
    }
  };

  const current = VERTICALS.find((v) => v.slug === activeVertical) || VERTICALS[0];
  const isBookingConfirmed = chatStep >= 4;

  return (
    <Section id="industrias">
      <div className="text-center mb-12">
        <span className="text-accent text-xs font-semibold tracking-widest uppercase mb-2 block">
          {t("solutionsOmnichannel", { defaultValue: "Soluciones Omnicanal" })}
        </span>
        <h2 className="text-3xl sm:text-5xl font-bold mb-4 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">
          {t("subtitle")}
        </p>
      </div>

      {/* View tabs: por industria (las 18) / por canal */}
      <div className="flex justify-center gap-1.5 p-1 bg-surface-light/40 border border-border/40 rounded-2xl max-w-xs mx-auto mb-8 backdrop-blur-xl">
        {(["industry", "channel"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`relative flex-1 py-2.5 px-4 text-sm font-semibold rounded-xl transition-all cursor-pointer ${
              view === v ? "text-white" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {view === v && (
              <motion.span
                layoutId="active-view-bg"
                className="absolute inset-0 bg-white/10 border border-white/10 rounded-xl shadow-lg shadow-white/5"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative z-10">{v === "industry" ? t("tabIndustry") : t("tabChannel")}</span>
          </button>
        ))}
      </div>

      {view === "industry" ? (
      <>

      {/* Cluster Navigation (Premium Segmented Tabs with glassmorphic look) */}
      <div className="relative flex flex-wrap md:flex-nowrap gap-1.5 p-1 bg-surface-light/40 border border-border/40 rounded-2xl max-w-4xl mx-auto mb-8 backdrop-blur-xl shadow-inner shadow-white/5">
        {CLUSTERS.map((cluster) => {
          const isActive = activeCluster === cluster;
          return (
            <button
              key={cluster}
              onClick={() => handleClusterChange(cluster)}
              className={`relative flex-1 py-3 px-4 text-xs sm:text-sm font-semibold rounded-xl transition-all duration-300 cursor-pointer ${
                isActive
                  ? "text-white"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="active-cluster-bg"
                  className="absolute inset-0 bg-white/10 border border-white/10 rounded-xl shadow-lg shadow-white/5"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10">{t(CLUSTER_LABELS[cluster], { defaultValue: CLUSTER_FALLBACKS[cluster] })}</span>
            </button>
          );
        })}
      </div>

      {/* Vertical pills in the active cluster (spring entrance animations) */}
      <div className="flex flex-wrap gap-2 justify-center mb-12 max-w-5xl mx-auto">
        <AnimatePresence mode="popLayout">
          {clusterVerticals.map((v) => {
            const isActive = v.slug === activeVertical;
            return (
              <motion.button
                key={v.slug}
                layout
                initial={{ opacity: 0, scale: 0.9, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -8 }}
                transition={{ type: "spring", stiffness: 450, damping: 25 }}
                onClick={() => {
                  setActiveVertical(v.slug);
                  setChatStep(0); // Reset chat state
                }}
                className={`relative inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all border cursor-pointer ${
                  isActive
                    ? "text-white border-transparent"
                    : "bg-surface/40 border-border/60 text-text-secondary hover:border-border hover:text-text-primary backdrop-blur-md"
                }`}
                style={
                  isActive
                    ? {
                        backgroundColor: v.color,
                        boxShadow: `0 0 20px ${v.glow}`,
                      }
                    : {}
                }
              >
                <span className="w-4 h-4 flex items-center justify-center" style={isActive ? { color: "white" } : { color: v.color }}>
                  {getVerticalIcon(v.slug, "w-4 h-4")}
                </span>
                <span>{t(`${v.slug}.name`, { defaultValue: v.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })}</span>
                {isActive && (
                  <motion.span
                    layoutId="vertical-pill-glow"
                    className="absolute inset-0 rounded-full ring-2"
                    style={{ borderColor: v.color }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Detail Showcase: Phone with widgets (left) + feature breakdown (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center max-w-6xl mx-auto">
        {/* Left Col: Interactive Chat with Floating Glassmorphic Widgets */}
        <div className="relative flex items-center justify-center py-10 px-4 min-h-[460px]">
          {/* Background subtle radial gradient colored by active vertical */}
          <div
            className="absolute w-80 h-80 rounded-full blur-[110px] opacity-[0.16] transition-all duration-700 pointer-events-none"
            style={{ backgroundColor: current.color, transform: "scale(1.2)" }}
          />

          {/* 1. Google Calendar Booking Widget (Top Left) */}
          <div className="absolute -left-6 lg:-left-12 -top-4 z-20 hidden md:block">
            <BookingLiveWidget active={isBookingConfirmed} color={current.color} verticalSlug={current.slug} />
          </div>

          {/* 2. Identity Merge Widget (Bottom Left) */}
          <div className="absolute -left-10 lg:-left-16 bottom-2 z-20 hidden md:block">
            <IdentityMergeWidget active={isBookingConfirmed} color={current.color} verticalSlug={current.slug} step={chatStep} />
          </div>

          {/* Main Phone Chat Simulator */}
          <div className="relative z-10 w-full max-w-[320px] transition-transform duration-300 hover:scale-[1.01] shadow-2xl rounded-2xl">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeVertical}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.3 }}
              >
                <VerticalChatDemo vertical={current} onStepChange={setChatStep} />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* 3. CRM Kanban Lead Card (Right Side) */}
          <div className="absolute -right-6 lg:-right-12 top-16 z-20 hidden md:block">
            <CrmKanbanWidget active={isBookingConfirmed} color={current.color} verticalSlug={current.slug} step={chatStep} />
          </div>
        </div>

        {/* Right Col: Details / Features Breakdown */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeVertical}-info`}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            <div>
              <span
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold mb-4 shadow-sm"
                style={{
                  backgroundColor: `${current.color}15`,
                  color: current.color,
                  border: `1px solid ${current.color}30`,
                }}
              >
                {getVerticalIcon(current.slug, "w-4 h-4")}
                <span>{t(`${activeVertical}.subtitle`, { defaultValue: activeVertical.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })}</span>
              </span>
              <h3 className="text-2xl sm:text-4xl font-extrabold mb-3 tracking-tight">
                {t(`${activeVertical}.name`, { defaultValue: activeVertical.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })}
              </h3>
              <p className="text-text-secondary text-sm sm:text-base leading-relaxed">
                {t(`${activeVertical}.tagline`, { defaultValue: "" })}
              </p>
            </div>

            {/* Structured core capabilities */}
            <ul className="space-y-3.5">
              {[1, 2, 3, 4].map((n) => (
                <motion.li
                  key={n}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: n * 0.05 }}
                  className="flex items-start gap-3.5"
                >
                  <span
                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 shadow-sm"
                    style={{
                      backgroundColor: `${current.color}15`,
                      color: current.color,
                      border: `1px solid ${current.color}25`,
                    }}
                  >
                    {Icon.check("w-3.5 h-3.5")}
                  </span>
                  <span className="text-text-secondary text-sm sm:text-base">
                    {t(`${activeVertical}.feature${n}`, { defaultValue: `Feature ${n}` })}
                  </span>
                </motion.li>
              ))}
            </ul>

            {/* AI Agent Recommendation segment */}
            <div
              className="p-4 rounded-2xl border-l-4 bg-surface-light/40 backdrop-blur-sm border-t border-r border-b border-white/5 shadow-md flex items-center justify-between"
              style={{ borderLeftColor: current.color }}
            >
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-0.5">
                  {t("recommendedAgent", { defaultValue: "Agente IA Recomendado" })}
                </p>
                <p className="font-bold flex items-center gap-2 text-sm sm:text-base">
                  <span style={{ color: current.color }}>
                    {getVerticalIcon(current.slug, "w-4 h-4")}
                  </span>
                  <span>{t(`${activeVertical}.agentName`, { defaultValue: "Agente IA" })}</span>
                  <span className="text-xs text-text-muted font-normal">
                    · {t("preConfigured", { defaultValue: "Pre-configurado" })}
                  </span>
                </p>
              </div>
              <div
                className="w-1.5 h-1.5 rounded-full animate-ping"
                style={{ backgroundColor: current.color }}
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      </>
      ) : (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {CHANNEL_SCENARIOS.map((s, i) => (
              <motion.div
                key={s.channel}
                initial={{ opacity: 0, y: 25 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
              >
                <MiniChannelDemo scenario={s} delay={400 + i * 300} />
              </motion.div>
            ))}
          </div>
          <p className="text-center text-xs text-text-muted mt-8 max-w-2xl mx-auto">
            {tChannels("note")}
          </p>
        </div>
      )}
    </Section>
  );
}
