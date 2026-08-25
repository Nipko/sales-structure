"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useInView } from "motion/react";
import { useTranslations } from "next-intl";
import { CHANNELS, type ChannelKey } from "../../data/channels";
import { Section } from "../ui/Section";

/* ------------------------------------------------------------------ */
/*  Scenario data (inline, industry-specific per channel)              */
/* ------------------------------------------------------------------ */

export interface ChannelScenario {
  channel: ChannelKey;
  /** i18n key under `channels.scenarios.*` — text below is the es fallback. */
  key: string;
  emoji: string;
  agentName: string;
  business: string;
  messages: { from: "customer" | "ai"; text: string }[];
}

export const CHANNEL_SCENARIOS: ChannelScenario[] = [
  {
    channel: "whatsapp",
    key: "dental",
    emoji: "\u{1FA7A}",
    agentName: "Sofía",
    business: "Clínica Dental",
    messages: [
      { from: "customer", text: "Quiero agendar limpieza dental" },
      {
        from: "ai",
        text: "¡Hola! Puedo consultar los horarios cargados por la clínica. ¿Qué día prefieres?",
      },
      { from: "customer", text: "Jueves" },
      { from: "ai", text: "Perfecto. Revisaré disponibilidad antes de confirmar la cita." },
    ],
  },
  {
    channel: "instagram",
    key: "photo",
    emoji: "📸",
    agentName: "Diego",
    business: "Foto Studio",
    messages: [
      {
        from: "customer",
        text: "Vi tu trabajo, cuánto vale una sesión de boda?",
      },
      {
        from: "ai",
        text: "¡Gracias! Puedo consultar los paquetes configurados. ¿Cuándo es la fecha?",
      },
      { from: "customer", text: "15 de junio" },
      {
        from: "ai",
        text: "Revisaré disponibilidad y te compartiré las opciones vigentes.",
      },
    ],
  },
  {
    channel: "messenger",
    key: "gym",
    emoji: "💪",
    agentName: "Coach",
    business: "FitPro Gym",
    messages: [
      { from: "customer", text: "Hola, info sobre membresías" },
      {
        from: "ai",
        text: "¡Hola! Puedo mostrarte los planes vigentes del gimnasio. ¿Quieres agendar una visita?",
      },
      { from: "customer", text: "Sí, mañana puedo" },
      { from: "ai", text: "Claro. ¿Qué horario prefieres para que consulte disponibilidad?" },
    ],
  },
  {
    channel: "telegram",
    key: "service",
    emoji: "🔧",
    agentName: "Iván",
    business: "ServicioYA",
    messages: [
      { from: "customer", text: "Se me tapó el desagüe, urgente" },
      {
        from: "ai",
        text: "Registraré la urgencia. ¿Cuál es la dirección?",
      },
      { from: "customer", text: "Calle 50 #15-20" },
      {
        from: "ai",
        text: "El equipo confirmará disponibilidad, tarifa y hora de llegada.",
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  MiniChannelDemo — compact animated chat for one channel            */
/* ------------------------------------------------------------------ */

export function MiniChannelDemo({
  scenario,
  delay,
}: {
  scenario: ChannelScenario;
  delay: number;
}) {
  const skin = CHANNELS[scenario.channel];
  const t = useTranslations("channels");
  // Localized text with the inline es content as fallback (next-intl t.has guard —
  // {defaultValue} is interpolation-only and would render the raw key if missing).
  const L = (field: string, fallback: string) => {
    const k = `scenarios.${scenario.key}.${field}`;
    return t.has(k) ? t(k) : fallback;
  };
  const business = L("business", scenario.business);
  const messages = scenario.messages.map((m, i) => ({ ...m, text: L(`m${i + 1}`, m.text) }));
  const statusText = t.has(`status.${scenario.channel}`) ? t(`status.${scenario.channel}`) : skin.statusText;
  const respondingLabel = t.has("respondingLabel") ? t("respondingLabel") : "IA respondiendo";
  const [visibleCount, setVisibleCount] = useState(0);
  const [cycle, setCycle] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-100px" });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isInView) return;
    setVisibleCount(0);
    const total = scenario.messages.length;
    const showNext = (i: number) => {
      if (i > total) {
        timerRef.current = setTimeout(() => setCycle((c) => c + 1), 3500);
        return;
      }
      timerRef.current = setTimeout(
        () => {
          setVisibleCount(i);
          showNext(i + 1);
        },
        i === 0 ? delay : 800,
      );
    };
    showNext(1);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cycle, isInView, scenario.messages.length, delay]);

  return (
    <div
      ref={ref}
      className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xl"
    >
      {/* Header */}
      <div
        className="px-3 py-2.5 flex items-center gap-2.5"
        style={{ background: skin.headerBg }}
      >
        <div className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center text-sm">
          {scenario.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs font-semibold truncate">
            {business}
          </p>
          <p className="text-white/75 text-[10px] truncate">
            {statusText}
          </p>
        </div>
        {skin.logoSrc && (
          <img
            src={skin.logoSrc}
            alt={skin.name}
            className="w-4 h-4 opacity-90"
          />
        )}
      </div>
      {/* Body */}
      <div
        className="p-3 min-h-[200px] flex flex-col gap-1.5"
        style={{ backgroundColor: skin.bodyBg }}
      >
        {messages.map((msg, i) => (
          <AnimatePresence key={`${cycle}-${i}`}>
            {i < visibleCount && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.25 }}
                className={`flex ${msg.from === "customer" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-2.5 py-1.5 rounded-xl text-[11px] leading-snug ${
                    msg.from === "customer" ? "rounded-br-sm" : "rounded-bl-sm"
                  }`}
                  style={{
                    background:
                      msg.from === "customer"
                        ? skin.outgoingBg
                        : skin.incomingBg,
                    color:
                      msg.from === "customer"
                        ? skin.outgoingText
                        : skin.incomingText,
                  }}
                >
                  {msg.text}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        ))}
      </div>
      {/* Footer */}
      <div className="bg-surface border-t border-border px-2.5 py-1.5 flex items-center justify-between">
        <span
          className="text-[9px] font-bold uppercase tracking-wider"
          style={{ color: skin.accent }}
        >
          {skin.name}
        </span>
        <span className="text-[9px] text-text-muted">{respondingLabel}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MultiChannelShowcase — section wrapper                             */
/* ------------------------------------------------------------------ */

export function MultiChannelShowcase() {
  const t = useTranslations("channels");

  return (
    <Section id="canales">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
        {t("note")}
      </p>
      <p className="text-center text-[11px] text-text-muted mt-2 max-w-2xl mx-auto">
        {t("demoDisclaimer")}
      </p>
    </Section>
  );
}
