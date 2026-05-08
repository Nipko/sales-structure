"use client";

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import {
  motion,
  useInView,
  AnimatePresence,
  useMotionValue,
  useTransform,
  animate,
} from "motion/react";
import { useTranslations } from "next-intl";
import { useLang } from "@/components/LangProvider";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SIGNUP = "https://admin.parallly-chat.cloud/signup";
const LOGIN = "https://admin.parallly-chat.cloud/login";

/* ------------------------------------------------------------------ */
/*  Verticals (11 con color/emoji/datos diferenciados)                 */
/* ------------------------------------------------------------------ */

type ChannelKey = "whatsapp" | "instagram" | "messenger" | "telegram";

interface ChannelSkin {
  key: ChannelKey;
  name: string;
  headerBg: string;       // header background (color or gradient)
  bodyBg: string;          // chat body background
  outgoingBg: string;      // customer (outgoing on real device — appears right side here)
  outgoingText: string;
  incomingBg: string;      // AI agent reply (appears left)
  incomingText: string;
  accent: string;          // brand accent color
  statusText: string;      // "online" / "active now" / etc.
  logoSrc: string;
}

const CHANNELS: Record<ChannelKey, ChannelSkin> = {
  whatsapp: {
    key: "whatsapp", name: "WhatsApp",
    headerBg: "#075e54",
    bodyBg: "#0b141a",
    outgoingBg: "#005c4b", outgoingText: "#fff",
    incomingBg: "#1f2c33", incomingText: "#e9edef",
    accent: "#25D366",
    statusText: "en línea",
    logoSrc: "/logos/whatsapp.svg",
  },
  instagram: {
    key: "instagram", name: "Instagram DM",
    headerBg: "linear-gradient(135deg, #833AB4 0%, #C13584 50%, #F77737 100%)",
    bodyBg: "#000000",
    outgoingBg: "linear-gradient(135deg, #5851DB, #C13584)", outgoingText: "#fff",
    incomingBg: "#262626", incomingText: "#f5f5f5",
    accent: "#E1306C",
    statusText: "Activa hace 2m",
    logoSrc: "/logos/instagram.svg",
  },
  messenger: {
    key: "messenger", name: "Messenger",
    headerBg: "#0084FF",
    bodyBg: "#18191a",
    outgoingBg: "#0084FF", outgoingText: "#fff",
    incomingBg: "#3a3b3c", incomingText: "#e4e6eb",
    accent: "#0084FF",
    statusText: "Activo ahora",
    logoSrc: "/logos/messenger.svg",
  },
  telegram: {
    key: "telegram", name: "Telegram",
    headerBg: "#517da2",
    bodyBg: "#0e1621",
    outgoingBg: "#2b5278", outgoingText: "#fff",
    incomingBg: "#182533", incomingText: "#e9edef",
    accent: "#0088CC",
    statusText: "en línea",
    logoSrc: "",  // no oficial local; usamos solo nombre
  },
};

interface VerticalDef {
  key: string;
  emoji: string;
  color: string;
  glow: string;
  textOnColor: string;
  channel: ChannelKey;     // canal donde se muestra esta vertical
  demoMessages: { from: "customer" | "ai"; text: string }[];
  agentName: string;
}

const VERTICALS: VerticalDef[] = [
  {
    key: "salud", emoji: "🩺", color: "#f43f5e", glow: "rgba(244,63,94,0.35)", textOnColor: "#fff",
    channel: "whatsapp",
    agentName: "Sofía",
    demoMessages: [
      { from: "customer", text: "Hola, necesito agendar una limpieza dental para esta semana 🦷" },
      { from: "ai", text: "¡Hola! Soy Sofía, encantada de atenderte. Tenemos disponible jueves 10am, 3pm o viernes 9am. ¿Cuál te queda mejor?" },
      { from: "customer", text: "Jueves 3pm" },
      { from: "ai", text: "Perfecto ✅ Cita confirmada: Limpieza dental, jueves 3pm con Dr. García. Te envío recordatorio el miércoles." },
    ],
  },
  {
    key: "veterinaria", emoji: "🐶", color: "#ec4899", glow: "rgba(236,72,153,0.35)", textOnColor: "#fff",
    channel: "instagram",
    agentName: "Toby",
    demoMessages: [
      { from: "customer", text: "¿Cuándo le toca la vacuna a Max?" },
      { from: "ai", text: "Hola! Revisé la ficha de Max 🐶. Le toca refuerzo de antirrábica el 15 de mayo (en 12 días). ¿Te agendo?" },
      { from: "customer", text: "Sí porfa, en la mañana" },
      { from: "ai", text: "Listo ✅ 15 de mayo, 9:30am con Dra. Pérez. Llevá el carnet. Te recuerdo 1 día antes." },
    ],
  },
  {
    key: "restaurantes", emoji: "🍕", color: "#f97316", glow: "rgba(249,115,22,0.35)", textOnColor: "#fff",
    channel: "whatsapp",
    agentName: "Luca",
    demoMessages: [
      { from: "customer", text: "Buenas! Tienen pizza margarita? Para delivery 🍕" },
      { from: "ai", text: "¡Hola! Sí, pizza margarita personal $18.000 o familiar $32.000. Delivery 30-40 min. ¿Cuál te llevo?" },
      { from: "customer", text: "Familiar y una gaseosa 1.5L" },
      { from: "ai", text: "Anotado ✅ Pizza margarita familiar + gaseosa 1.5L = $35.000. ¿Confirmás dirección Calle 50 #12-34?" },
    ],
  },
  {
    key: "gimnasios", emoji: "💪", color: "#ef4444", glow: "rgba(239,68,68,0.35)", textOnColor: "#fff",
    channel: "messenger",
    agentName: "Coach",
    demoMessages: [
      { from: "customer", text: "Hay clase de yoga mañana?" },
      { from: "ai", text: "Sí! Yoga con Vale: 7am (4 cupos), 9am (lleno) y 6pm (8 cupos). ¿Te reservo alguna?" },
      { from: "customer", text: "6pm" },
      { from: "ai", text: "Reservado ✅ Yoga 6pm mañana. Te dejo recordatorio. Para cancelar respondé hasta 2h antes." },
    ],
  },
  {
    key: "inmobiliaria", emoji: "🏠", color: "#10b981", glow: "rgba(16,185,129,0.35)", textOnColor: "#fff",
    channel: "telegram",
    agentName: "Carlos",
    demoMessages: [
      { from: "customer", text: "Busco apto en Chapinero, 3 habitaciones, hasta 800M" },
      { from: "ai", text: "Tengo 4 opciones que cumplen. Te muestro 2: 1) Apto 95m² $750M, 3hab/2baños · 2) Apto 110m² $790M, 3hab/3baños. ¿Más info?" },
      { from: "customer", text: "El segundo, agendamos visita?" },
      { from: "ai", text: "Disponible mañana 10am o sábado 4pm. ¿Cuál te queda?" },
    ],
  },
  {
    key: "turismo", emoji: "🏝️", color: "#06b6d4", glow: "rgba(6,182,212,0.35)", textOnColor: "#fff",
    channel: "instagram",
    agentName: "Maya",
    demoMessages: [
      { from: "customer", text: "Tienen tour para el sábado? Somos 4 personas" },
      { from: "ai", text: "¡Sí! 3 opciones para sábado: 🌊 Snorkel ($120k/persona), 🪂 Parapente ($180k), 🚤 Islas ($95k). ¿Cuál te llama más?" },
      { from: "customer", text: "Snorkel" },
      { from: "ai", text: "Reservado para 4 ✅ Sábado 8am, recogida en hotel. Total $480k. Te paso link de pago seguro." },
    ],
  },
  {
    key: "educacion", emoji: "🎓", color: "#6366f1", glow: "rgba(99,102,241,0.35)", textOnColor: "#fff",
    channel: "messenger",
    agentName: "Ana",
    demoMessages: [
      { from: "customer", text: "Quiero aprender inglés desde cero, qué cursos tienen?" },
      { from: "ai", text: "Te recomiendo nuestro curso A1 Inicial (3 meses, lun-mié-vie 6pm). Próxima cohorte arranca 15 de mayo, $450k total." },
      { from: "customer", text: "Hay opción virtual?" },
      { from: "ai", text: "Sí! Misma cohorte tiene modalidad virtual o híbrida. ¿Te apunto a alguna?" },
    ],
  },
  {
    key: "seguros", emoji: "🛡️", color: "#3b82f6", glow: "rgba(59,130,246,0.35)", textOnColor: "#fff",
    channel: "whatsapp",
    agentName: "Roberto",
    demoMessages: [
      { from: "customer", text: "Quiero cotizar seguro de auto. Renault Logan 2020" },
      { from: "ai", text: "Para Logan 2020 tengo 3 planes: Básico $89k/mes, Plus $145k, Total $210k. ¿Tu edad y ciudad?" },
      { from: "customer", text: "32 años, Bogotá" },
      { from: "ai", text: "Genial. Plus es ideal para tu perfil ($145k/mes incluye colisión + asistencia). ¿Te emito la póliza?" },
    ],
  },
  {
    key: "hogar", emoji: "🔧", color: "#f59e0b", glow: "rgba(245,158,11,0.35)", textOnColor: "#fff",
    channel: "telegram",
    agentName: "Iván",
    demoMessages: [
      { from: "customer", text: "URGENTE! Se rompió un caño y hay agua por todos lados 💧" },
      { from: "ai", text: "Te entiendo, marco como EMERGENCIA 🚨. ¿Calle 100 #15-20? Mando técnico ahora, llega en 30-45 min." },
      { from: "customer", text: "Sí, esa dirección" },
      { from: "ai", text: "Despachado ✅ Carlos llega 11:15am. Cierra la llave general por mientras. Cualquier cosa avisame." },
    ],
  },
  {
    key: "fotografia", emoji: "📸", color: "#a855f7", glow: "rgba(168,85,247,0.35)", textOnColor: "#fff",
    channel: "instagram",
    agentName: "Diego",
    demoMessages: [
      { from: "customer", text: "Hola! Cuánto vale una sesión de boda?" },
      { from: "ai", text: "¡Hola! Tenemos 3 paquetes: Esencial $1.5M (4h, 80 fotos), Pro $2.8M (8h + video), Premium $4.5M (full day + álbum). ¿Cuándo es?" },
      { from: "customer", text: "15 de junio. Pro suena bien" },
      { from: "ai", text: "Disponible 15 de junio ✅ Reservo con depósito de $700k. Te paso link de pago seguro." },
    ],
  },
  {
    key: "belleza", emoji: "💅", color: "#d946ef", glow: "rgba(217,70,239,0.35)", textOnColor: "#fff",
    channel: "instagram",
    agentName: "Camila",
    demoMessages: [
      { from: "customer", text: "Cuánto vale el semipermanente con diseño? 💅" },
      { from: "ai", text: "Semipermanente con diseño $65.000 COP. Esta semana tengo lunes 10am, miércoles 3pm o sábado 11am. ¿Cuál preferís?" },
      { from: "customer", text: "Sábado 11am" },
      { from: "ai", text: "Listo ✅ Sábado 11am con Vale. Llegá 5min antes. ¿Algún diseño que te guste?" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  SVG Icons (inline, no external deps)                                */
/* ------------------------------------------------------------------ */

const Icon = {
  bot: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="8" width="18" height="12" rx="3" /><path d="M9 14h.01M15 14h.01M12 4v4M8 8h8" strokeLinecap="round" />
    </svg>
  ),
  inbox: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  users: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  calendar: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
    </svg>
  ),
  zap: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" strokeLinejoin="round" />
    </svg>
  ),
  chart: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M3 3v18h18M7 14l4-4 4 4 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  book: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5a2.5 2.5 0 01-2.5-2.5v-15z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  layers: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" strokeLinejoin="round" />
    </svg>
  ),
  fingerprint: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 11a3 3 0 00-3 3v4M12 7v6M9 19c0-1.5.4-3 1.5-4M15 19c0-1.5-.4-3-1.5-4M3 12a9 9 0 0118 0v3" strokeLinecap="round" />
    </svg>
  ),
  mail: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  shield: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" strokeLinejoin="round" />
    </svg>
  ),
  lock: (cls = "w-6 h-6") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" />
    </svg>
  ),
  check: (cls = "w-5 h-5") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  x: (cls = "w-5 h-5") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" /><line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
    </svg>
  ),
  arrow: (cls = "w-5 h-5") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  plus: (cls = "w-5 h-5") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  ),
  minus: (cls = "w-5 h-5") => (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  ),
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function Section({ children, id, className = "", noPad = false }: { children: ReactNode; id?: string; className?: string; noPad?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.section
      ref={ref}
      id={id}
      className={`${noPad ? "" : "py-24"} px-6 ${className}`}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </motion.section>
  );
}

function CountUp({ target, suffix = "" }: { target: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => {
    if (target >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
    if (target >= 1_000) return Math.round(v / 100) / 10 + "K";
    return v % 1 === 0 ? Math.round(v).toString() : v.toFixed(1);
  });
  useEffect(() => {
    if (isInView) animate(count, target, { duration: 1.8, ease: "easeOut" });
  }, [isInView, count, target]);
  return <span ref={ref} className="tabular"><motion.span>{rounded}</motion.span>{suffix}</span>;
}

/* ------------------------------------------------------------------ */
/*  Vertical Chat Demo (per-vertical color/agent · per-channel skin)   */
/* ------------------------------------------------------------------ */

function VerticalChatDemo({ vertical }: { vertical: VerticalDef }) {
  const skin = CHANNELS[vertical.channel];
  const [visibleCount, setVisibleCount] = useState(0);
  const [cycle, setCycle] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runAnimation = useCallback(() => {
    setVisibleCount(0);
    const total = vertical.demoMessages.length;
    const showNext = (i: number) => {
      if (i > total) {
        timerRef.current = setTimeout(() => setCycle((c) => c + 1), 2500);
        return;
      }
      timerRef.current = setTimeout(() => {
        setVisibleCount(i);
        showNext(i + 1);
      }, i === 0 ? 200 : 700);
    };
    showNext(1);
  }, [vertical.demoMessages.length]);

  useEffect(() => {
    runAnimation();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [cycle, runAnimation, vertical.key]);

  return (
    <div
      className="bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl w-full"
      style={{ boxShadow: `0 0 60px ${vertical.glow}` }}
    >
      {/* Channel-skinned header */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ background: skin.headerBg }}>
        <div className="w-9 h-9 rounded-full bg-white/25 flex items-center justify-center text-lg backdrop-blur-sm">
          {vertical.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">{vertical.agentName}</p>
          <p className="text-white/80 text-[11px]">{skin.statusText} · responde en segundos</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-white text-[10px] font-semibold tracking-wide">IA</span>
        </div>
        {skin.logoSrc && (
          <img src={skin.logoSrc} alt={skin.name} className="w-5 h-5 ml-1 opacity-90" />
        )}
      </div>

      {/* Body — channel-themed background */}
      <div className="p-4 min-h-[320px] flex flex-col gap-2" style={{ backgroundColor: skin.bodyBg }}>
        {vertical.demoMessages.map((msg, i) => (
          <AnimatePresence key={`${cycle}-${i}`}>
            {i < visibleCount && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className={`flex ${msg.from === "customer" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[82%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed shadow-sm ${
                    msg.from === "customer" ? "rounded-br-sm" : "rounded-bl-sm"
                  }`}
                  style={{
                    background: msg.from === "customer" ? skin.outgoingBg : skin.incomingBg,
                    color: msg.from === "customer" ? skin.outgoingText : skin.incomingText,
                  }}
                >
                  {msg.text}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        ))}
      </div>

      {/* Footer — Channel + response time badge */}
      <div className="bg-surface border-t border-border px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: skin.accent }}>
          {skin.name}
        </span>
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke={vertical.color} strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
          </svg>
          <span className="text-[11px] font-medium" style={{ color: vertical.color }}>
            Respondió en 3 segundos
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Verticals Picker — interactive showcase                            */
/* ------------------------------------------------------------------ */

function VerticalsShowcase() {
  const t = useTranslations("verticals");
  const [active, setActive] = useState<string>(VERTICALS[0].key);
  const current = VERTICALS.find(v => v.key === active) || VERTICALS[0];

  return (
    <div className="space-y-8">
      {/* Industry pills */}
      <div className="flex flex-wrap gap-2 justify-center">
        {VERTICALS.map((v) => {
          const isActive = v.key === active;
          return (
            <button
              key={v.key}
              onClick={() => setActive(v.key)}
              className={`relative inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all border ${
                isActive
                  ? "text-white border-transparent"
                  : "bg-surface border-border text-text-secondary hover:border-border-light hover:text-text-primary"
              }`}
              style={isActive ? { backgroundColor: v.color, boxShadow: `0 0 24px ${v.glow}` } : {}}
            >
              <span className="text-base">{v.emoji}</span>
              <span>{t(`${v.key}.name`)}</span>
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
                style={{ backgroundColor: `${current.color}20`, color: current.color }}
              >
                <span>{current.emoji}</span>
                <span>{t(`${active}.subtitle`)}</span>
              </span>
              <h3 className="text-2xl font-bold mb-2">{t(`${active}.name`)}</h3>
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
                    style={{ backgroundColor: `${current.color}20`, color: current.color }}
                  >
                    {Icon.check("w-3.5 h-3.5")}
                  </span>
                  <span className="text-text-secondary">{t(`${active}.feature${n}`)}</span>
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
                <span className="text-xs text-text-muted font-normal">· Pre-configurado</span>
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trust Badges Row                                                   */
/* ------------------------------------------------------------------ */

function TrustRow() {
  const t = useTranslations("trust");
  const items = [
    {
      key: "meta",
      titleKey: "metaTitle",
      descKey: "metaDesc",
      logo: "/logos/meta-tech-provider.svg",
      logoAlt: "Meta Tech Provider",
      badge: t("metaBadge"),
      bg: "bg-[#0064E0]/5",
      ring: "ring-[#0064E0]/20",
    },
    {
      key: "mp",
      titleKey: "mpTitle",
      descKey: "mpDesc",
      logo: "/logos/mercadopago.svg",
      logoAlt: "MercadoPago",
      badge: t("mpBadge"),
      bg: "bg-[#00B1EA]/5",
      ring: "ring-[#00B1EA]/20",
    },
    {
      key: "latam",
      titleKey: "latamTitle",
      descKey: "latamDesc",
      logo: null,
      icon: <span className="text-4xl">🌎</span>,
      badge: t("latamBadge"),
      bg: "bg-emerald-500/5",
      ring: "ring-emerald-500/20",
    },
    {
      key: "enc",
      titleKey: "encTitle",
      descKey: "encDesc",
      logo: null,
      icon: Icon.lock("w-9 h-9 text-emerald-400"),
      badge: "AES-256-GCM",
      bg: "bg-emerald-500/5",
      ring: "ring-emerald-500/20",
    },
  ];

  return (
    <Section id="confianza" className="bg-surface/30 border-y border-border/50">
      <div className="text-center mb-12">
        <h2 className="text-2xl sm:text-3xl font-bold">{t("title")}</h2>
      </div>

      {/* Logo strip — top of the trust row */}
      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 mb-12 opacity-90">
        <img src="/logos/whatsapp.svg" alt="WhatsApp" className="h-7 w-auto" />
        <img src="/logos/instagram.svg" alt="Instagram" className="h-7 w-auto" />
        <img src="/logos/messenger.svg" alt="Messenger" className="h-7 w-auto" />
        <span className="w-px h-7 bg-border" aria-hidden />
        <img src="/logos/meta.svg" alt="Meta" className="h-6 w-auto" />
        <img src="/logos/mercadopago.svg" alt="MercadoPago" className="h-9 w-auto" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {items.map((item, i) => (
          <motion.div
            key={item.key}
            className={`bg-surface border border-border rounded-2xl p-5 hover:border-border-light transition-colors ring-1 ${item.ring}`}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          >
            <div className={`mb-4 flex items-center justify-center w-full h-16 rounded-xl ${item.bg} px-4`}>
              {item.logo ? (
                <img src={item.logo} alt={item.logoAlt} className="h-9 w-auto" />
              ) : (
                item.icon
              )}
            </div>
            <h3 className="font-semibold text-text-primary leading-tight mb-2">{t(item.titleKey)}</h3>
            <p className="text-sm text-text-secondary leading-relaxed mb-3">{t(item.descKey)}</p>
            <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
              {item.badge}
            </span>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  FAQ Item                                                           */
/* ------------------------------------------------------------------ */

function FAQItem({ question, answer, idx }: { question: string; answer: string; idx: number }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-30px" }}
      transition={{ delay: idx * 0.05, duration: 0.35 }}
      className="bg-surface border border-border rounded-xl overflow-hidden"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-surface-light/50 transition-colors cursor-pointer"
        aria-expanded={open}
      >
        <span className="font-medium text-text-primary">{question}</span>
        <span className="flex-shrink-0 text-text-muted">
          {open ? Icon.minus() : Icon.plus()}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <div className="px-5 pb-5 text-text-secondary leading-relaxed">{answer}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Multi-Channel Showcase — same scenario in 4 channel skins          */
/* ------------------------------------------------------------------ */

const CHANNEL_SCENARIOS: Array<{
  channel: ChannelKey;
  emoji: string;
  agentName: string;
  business: string;
  messages: { from: "customer" | "ai"; text: string }[];
}> = [
  {
    channel: "whatsapp", emoji: "🩺", agentName: "Sofía", business: "Clínica Dental",
    messages: [
      { from: "customer", text: "Quiero agendar limpieza dental" },
      { from: "ai", text: "¡Hola! Tengo jueves 10am o viernes 9am. ¿Cuál preferís?" },
      { from: "customer", text: "Jueves 10am" },
      { from: "ai", text: "Confirmado ✅ Te recuerdo el miércoles." },
    ],
  },
  {
    channel: "instagram", emoji: "📸", agentName: "Diego", business: "Foto Studio",
    messages: [
      { from: "customer", text: "Vi tu trabajo, cuánto vale una sesión de boda?" },
      { from: "ai", text: "¡Gracias! Tenemos 3 paquetes. ¿Cuándo es la fecha?" },
      { from: "customer", text: "15 de junio" },
      { from: "ai", text: "Disponible 🙌 Te paso opciones por aquí." },
    ],
  },
  {
    channel: "messenger", emoji: "💪", agentName: "Coach", business: "FitPro Gym",
    messages: [
      { from: "customer", text: "Hola, info sobre membresías" },
      { from: "ai", text: "¡Hola! Mensual $89k, trimestral $240k (ahorrás $27k). ¿Visitamos?" },
      { from: "customer", text: "Sí, mañana puedo" },
      { from: "ai", text: "Te agendo a las 10am ✅" },
    ],
  },
  {
    channel: "telegram", emoji: "🔧", agentName: "Iván", business: "ServicioYA",
    messages: [
      { from: "customer", text: "Se me tapó el desagüe, urgente" },
      { from: "ai", text: "Marco como prioridad alta 🚨 Dirección por favor" },
      { from: "customer", text: "Calle 50 #15-20" },
      { from: "ai", text: "Carlos llega en 35min. Te aviso cuando salga." },
    ],
  },
];

function MiniChannelDemo({ scenario, delay }: { scenario: typeof CHANNEL_SCENARIOS[number]; delay: number }) {
  const skin = CHANNELS[scenario.channel];
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
      timerRef.current = setTimeout(() => {
        setVisibleCount(i);
        showNext(i + 1);
      }, i === 0 ? delay : 800);
    };
    showNext(1);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [cycle, isInView, scenario.messages.length, delay]);

  return (
    <div ref={ref} className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xl">
      {/* Header */}
      <div className="px-3 py-2.5 flex items-center gap-2.5" style={{ background: skin.headerBg }}>
        <div className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center text-sm">
          {scenario.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs font-semibold truncate">{scenario.business}</p>
          <p className="text-white/75 text-[10px] truncate">{skin.statusText}</p>
        </div>
        {skin.logoSrc && <img src={skin.logoSrc} alt={skin.name} className="w-4 h-4 opacity-90" />}
      </div>
      {/* Body */}
      <div className="p-3 min-h-[200px] flex flex-col gap-1.5" style={{ backgroundColor: skin.bodyBg }}>
        {scenario.messages.map((msg, i) => (
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
                    background: msg.from === "customer" ? skin.outgoingBg : skin.incomingBg,
                    color: msg.from === "customer" ? skin.outgoingText : skin.incomingText,
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
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: skin.accent }}>
          {skin.name}
        </span>
        <span className="text-[9px] text-text-muted">IA respondiendo</span>
      </div>
    </div>
  );
}

function MultiChannelShowcase() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
  );
}

/* ------------------------------------------------------------------ */
/*  Tools Showcase — animated mini-demos of key features               */
/* ------------------------------------------------------------------ */

/** Pipeline kanban with a card moving through stages */
function PipelineDemo() {
  const [stage, setStage] = useState(0); // 0=new, 1=qualified, 2=won
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });

  useEffect(() => {
    if (!isInView) return;
    let timeouts: ReturnType<typeof setTimeout>[] = [];
    const cycle = () => {
      timeouts.push(setTimeout(() => setStage(1), 1500));
      timeouts.push(setTimeout(() => setStage(2), 3000));
      timeouts.push(setTimeout(() => setStage(0), 4800));
      timeouts.push(setTimeout(cycle, 6300));
    };
    cycle();
    return () => timeouts.forEach(clearTimeout);
  }, [isInView]);

  const stages = [
    { name: "Nuevo", color: "#3b82f6" },
    { name: "Calificado", color: "#f59e0b" },
    { name: "Ganado", color: "#10b981" },
  ];

  return (
    <div ref={ref} className="grid grid-cols-3 gap-2 p-3 bg-bg/60 rounded-xl border border-border h-full">
      {stages.map((s, i) => (
        <div key={i} className="bg-surface border border-border rounded-lg p-2 min-h-[140px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: s.color }}>
              {s.name}
            </span>
            <span className="text-[10px] text-text-muted">{i === stage ? "1" : "0"}</span>
          </div>
          <AnimatePresence>
            {i === stage && (
              <motion.div
                layoutId="pipeline-card"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                className="bg-bg border-l-2 rounded p-2"
                style={{ borderColor: s.color }}
              >
                <p className="text-[11px] font-semibold text-text-primary truncate">María González</p>
                <p className="text-[10px] text-text-secondary truncate">Pediatría · WA</p>
                <div className="flex items-center gap-1 mt-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[9px] text-text-muted">Score 87</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

/** Inbox with messages arriving from different channels */
function InboxDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    let timeouts: ReturnType<typeof setTimeout>[] = [];
    const cycle = () => {
      [1, 2, 3, 4].forEach((n, i) => {
        timeouts.push(setTimeout(() => setCount(n), i * 700));
      });
      timeouts.push(setTimeout(() => setCount(0), 4500));
      timeouts.push(setTimeout(cycle, 5500));
    };
    cycle();
    return () => timeouts.forEach(clearTimeout);
  }, [isInView]);

  const items = [
    { logo: "/logos/whatsapp.svg", name: "Carlos R.", msg: "Hola, tienen apto en arriendo en Chapinero?", time: "ahora" },
    { logo: "/logos/instagram.svg", name: "@valeria.foto", msg: "Vi su trabajo, info de bodas?", time: "1m" },
    { logo: "/logos/messenger.svg", name: "Daniel M.", msg: "Información de membresías mensuales", time: "2m" },
    { logo: "", name: "Telegram · Anita", msg: "Necesito plomero urgente", time: "3m" },
  ];

  return (
    <div ref={ref} className="bg-bg/60 rounded-xl border border-border p-3 h-full overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-text-primary">Bandeja unificada</span>
        <span className="text-[10px] text-text-muted">{count} sin leer</span>
      </div>
      <div className="space-y-1.5">
        {items.slice(0, count).map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2.5 bg-surface border border-border rounded-lg p-2"
          >
            <div className="w-7 h-7 rounded-full bg-surface-elevated flex items-center justify-center flex-shrink-0">
              {item.logo ? (
                <img src={item.logo} alt="" className="w-4 h-4" />
              ) : (
                <svg className="w-4 h-4 text-[#0088CC]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.05-.2-.07-.05-.18-.04-.25-.02-.11.03-1.77 1.12-4.99 3.27-.47.32-.9.48-1.28.47-.42-.01-1.23-.24-1.83-.44-.74-.24-1.32-.37-1.27-.78.03-.21.32-.43.86-.65 3.36-1.46 5.6-2.42 6.72-2.89 3.21-1.35 3.87-1.59 4.31-1.59.09 0 .31.02.45.13.12.09.16.21.18.3.02.09.04.31.02.48z"/>
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-text-primary truncate">{item.name}</p>
                <span className="text-[9px] text-text-muted ml-2 flex-shrink-0">{item.time}</span>
              </div>
              <p className="text-[10px] text-text-secondary truncate">{item.msg}</p>
            </div>
            <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** Calendar booking — slot pulses, then confirmation appears */
function CalendarDemo() {
  const [step, setStep] = useState(0); // 0=idle, 1=hover slot, 2=confirmed
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });

  useEffect(() => {
    if (!isInView) return;
    let timeouts: ReturnType<typeof setTimeout>[] = [];
    const cycle = () => {
      timeouts.push(setTimeout(() => setStep(1), 800));
      timeouts.push(setTimeout(() => setStep(2), 2000));
      timeouts.push(setTimeout(() => setStep(0), 4500));
      timeouts.push(setTimeout(cycle, 5500));
    };
    cycle();
    return () => timeouts.forEach(clearTimeout);
  }, [isInView]);

  const slots = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];
  const selectedIdx = 2; // 11:00

  return (
    <div ref={ref} className="bg-bg/60 rounded-xl border border-border p-3 h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-text-primary">Jueves 15 de mayo</span>
        <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
        </svg>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {slots.map((slot, i) => (
          <motion.button
            key={i}
            className={`py-2 px-2 rounded-lg text-xs font-medium border transition-all ${
              i === selectedIdx
                ? step >= 1
                  ? "bg-accent text-white border-accent shadow-[0_0_20px_rgba(56,151,240,0.4)]"
                  : "bg-surface border-border text-text-primary"
                : "bg-surface border-border text-text-secondary"
            }`}
            animate={i === selectedIdx && step === 1 ? { scale: [1, 1.05, 1] } : {}}
            transition={{ duration: 0.4, repeat: step === 1 ? Infinity : 0, repeatType: "loop" }}
          >
            {slot}
          </motion.button>
        ))}
      </div>
      <AnimatePresence>
        {step === 2 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5 flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-emerald-400">Cita confirmada</p>
              <p className="text-[10px] text-text-secondary truncate">11:00 · María González</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Analytics — counter + mini bar chart that animates in */
function AnalyticsDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });
  const bars = [40, 65, 50, 80, 60, 90, 75]; // mock weekly data

  return (
    <div ref={ref} className="bg-bg/60 rounded-xl border border-border p-3 h-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-text-primary">Esta semana</span>
        <span className="text-[10px] text-emerald-400 font-bold">↑ 23%</span>
      </div>
      <p className="text-2xl font-bold tabular mb-1">
        {isInView ? <CountUp target={1247} suffix="" /> : "0"}
      </p>
      <p className="text-[10px] text-text-muted mb-3">conversaciones</p>
      <div className="flex items-end gap-1.5 h-14">
        {bars.map((h, i) => (
          <motion.div
            key={i}
            className="flex-1 bg-gradient-to-t from-accent to-cyan-400 rounded-sm"
            initial={{ height: 0 }}
            animate={isInView ? { height: `${h}%` } : { height: 0 }}
            transition={{ delay: i * 0.07, duration: 0.6, ease: "easeOut" }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-[9px] text-text-muted">
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
    </div>
  );
}

/** Knowledge base — question typed, then snippet appears */
function KnowledgeBaseDemo() {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });

  useEffect(() => {
    if (!isInView) return;
    let timeouts: ReturnType<typeof setTimeout>[] = [];
    const cycle = () => {
      timeouts.push(setTimeout(() => setStep(1), 600));
      timeouts.push(setTimeout(() => setStep(2), 2000));
      timeouts.push(setTimeout(() => setStep(0), 5000));
      timeouts.push(setTimeout(cycle, 6000));
    };
    cycle();
    return () => timeouts.forEach(clearTimeout);
  }, [isInView]);

  return (
    <div ref={ref} className="bg-bg/60 rounded-xl border border-border p-3 h-full">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5a2.5 2.5 0 01-2.5-2.5v-15z" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-semibold text-text-primary">Base de conocimiento</span>
      </div>
      {/* Question */}
      <div className="bg-surface rounded-lg p-2.5 mb-2 border border-border">
        <p className="text-[11px] text-text-secondary mb-1">Cliente pregunta:</p>
        <p className="text-[12px] text-text-primary">¿Aceptan tarjeta sodexo?</p>
      </div>
      <AnimatePresence>
        {step >= 1 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-[10px] text-text-muted mb-2 flex items-center gap-1.5"
          >
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-accent"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            <span>Buscando en KB...</span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {step === 2 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-accent/10 border border-accent/30 rounded-lg p-2.5"
          >
            <p className="text-[10px] text-accent font-semibold uppercase tracking-wider mb-1">Encontrado en políticas.pdf</p>
            <p className="text-[11px] text-text-primary leading-snug">
              Sí, aceptamos tarjetas Sodexo, Big Pass y Edenred. Pago en sitio, no acumulan puntos.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** AI Agent config — sliders that animate */
function AgentConfigDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });

  return (
    <div ref={ref} className="bg-bg/60 rounded-xl border border-border p-3 h-full">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
          <span className="text-base">🩺</span>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-primary">Sofía · Asistente médica</p>
          <p className="text-[10px] text-text-muted">Plantilla: Salud · Dental</p>
        </div>
      </div>

      <div className="space-y-2.5">
        {[
          { label: "Tono", value: "Empático", color: "#10b981", width: "85%" },
          { label: "Modelo IA", value: "Claude Opus", color: "#a855f7", width: "100%" },
          { label: "Canal", value: "WhatsApp", color: "#25D366", width: "70%" },
        ].map((s, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-text-muted">{s.label}</span>
              <span className="text-[10px] font-semibold" style={{ color: s.color }}>{s.value}</span>
            </div>
            <div className="h-1.5 bg-surface rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: s.color }}
                initial={{ width: 0 }}
                animate={isInView ? { width: s.width } : { width: 0 }}
                transition={{ delay: i * 0.15, duration: 0.8, ease: "easeOut" }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] text-emerald-400 font-semibold">Activa · 24/7</span>
      </div>
    </div>
  );
}

/* ====================================================================
   MAIN
   ==================================================================== */

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [annual, setAnnual] = useState(true);
  const t = useTranslations();
  const { locale, setLocale, localeNames } = useLang();

  /* ---------------- Header ---------------- */
  const header = (
    <motion.header
      className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-bg/80 backdrop-blur-xl"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="mx-auto max-w-6xl flex items-center justify-between px-6 h-16">
        <a href="/" className="flex items-center gap-2">
          <img src="/parallly-logo.svg" alt="Parallly" className="h-9 w-auto" />
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm text-text-secondary">
          <a href="#verticales" className="hover:text-text-primary transition-colors">{t("nav.verticals")}</a>
          <a href="#herramientas" className="hover:text-text-primary transition-colors">{t("nav.tools")}</a>
          <a href="#caracteristicas" className="hover:text-text-primary transition-colors">{t("nav.features")}</a>
          <a href="#precios" className="hover:text-text-primary transition-colors">{t("nav.pricing")}</a>
          <a href="#preguntas" className="hover:text-text-primary transition-colors">{t("nav.contact")}</a>
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="bg-transparent text-xs text-text-secondary border border-border rounded-lg px-2 py-1.5 outline-none cursor-pointer hover:border-border-light transition-colors"
          >
            {Object.entries(localeNames).map(([code, name]) => (
              <option key={code} value={code} className="text-black">{name}</option>
            ))}
          </select>
          <a href={LOGIN} className="text-sm text-text-secondary hover:text-text-primary transition-colors">
            {t("nav.login")}
          </a>
          <a
            href={SIGNUP}
            className="text-sm bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg font-semibold transition-colors"
          >
            {t("nav.startFree")}
          </a>
        </div>

        <button
          className="md:hidden text-text-secondary cursor-pointer"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Menu"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {mobileMenuOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />}
          </svg>
        </button>
      </div>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden border-t border-border bg-bg overflow-hidden"
          >
            <div className="px-6 py-4 flex flex-col gap-4">
              {[
                ["#verticales", t("nav.verticals")],
                ["#caracteristicas", t("nav.features")],
                ["#como-funciona", t("nav.howItWorks")],
                ["#precios", t("nav.pricing")],
                ["#preguntas", t("nav.contact")],
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-text-secondary hover:text-text-primary transition-colors"
                >
                  {label}
                </a>
              ))}
              <hr className="border-border" />
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="bg-transparent text-sm border border-border rounded-lg px-2 py-1 outline-none cursor-pointer"
              >
                {Object.entries(localeNames).map(([code, name]) => (
                  <option key={code} value={code} className="text-black">{name}</option>
                ))}
              </select>
              <a href={LOGIN} className="text-text-secondary">{t("nav.login")}</a>
              <a href={SIGNUP} className="bg-accent text-white px-4 py-2.5 rounded-lg font-semibold text-center">
                {t("nav.startFree")}
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );

  /* ---------------- Hero ---------------- */
  const hero = (
    <section className="relative pt-28 pb-20 px-6 overflow-hidden">
      {/* Backdrop glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[800px] bg-accent/10 blur-3xl pointer-events-none" />

      <div className="mx-auto max-w-6xl relative">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
          {/* Left text */}
          <motion.div
            className="flex-1 text-center lg:text-left"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <motion.span
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/30 text-accent text-xs font-semibold mb-6"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              {t("hero.badge")}
            </motion.span>

            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold leading-[1.05] tracking-tight">
              {t.rich("hero.title", {
                em: () => (
                  <span className="bg-gradient-to-r from-accent via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                    {t("hero.titleHighlight")}
                  </span>
                ),
              })}
            </h1>

            <p className="mt-6 text-lg text-text-secondary max-w-xl mx-auto lg:mx-0 leading-relaxed">
              {t("hero.subtitle")}
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <a
                href={SIGNUP}
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl text-base transition-all shadow-[0_0_40px_rgba(56,151,240,0.35)] hover:shadow-[0_0_60px_rgba(56,151,240,0.5)] cursor-pointer"
              >
                {t("hero.cta")} {Icon.arrow()}
              </a>
              <a
                href="#como-funciona"
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-border hover:border-border-light text-text-primary rounded-xl text-base font-medium transition-colors cursor-pointer"
              >
                {t("hero.ctaSecondary")}
              </a>
            </div>

            <p className="mt-5 text-xs text-text-muted">{t("hero.noCard")}</p>

            <div className="mt-8 pt-6 border-t border-border/50 max-w-md mx-auto lg:mx-0">
              <p className="text-xs text-text-muted">{t("hero.trustline")}</p>
            </div>
          </motion.div>

          {/* Right demo */}
          <motion.div
            className="flex-1 w-full max-w-md"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            <VerticalChatDemo vertical={VERTICALS[0]} />
          </motion.div>
        </div>
      </div>
    </section>
  );

  /* ---------------- Stats ---------------- */
  const stats = (
    <Section className="border-t border-border/50">
      <p className="text-center text-text-muted text-xs uppercase tracking-widest mb-10">
        {t("socialProof.trust")}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
        {[
          { num: 2_000_000, suffix: "+", labelKey: "socialProof.stat1Label" },
          { num: 4.9, suffix: "/5", labelKey: "socialProof.stat2Label" },
          { num: 45, suffix: "%", labelKey: "socialProof.stat3Label" },
          { num: 16, suffix: "", labelKey: "socialProof.stat4Label" },
        ].map((s, i) => (
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

  /* ---------------- Verticals ---------------- */
  const verticalsSection = (
    <Section id="verticales">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 tracking-tight">
          {t("verticals.title")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto">
          {t("verticals.subtitle")}
        </p>
      </div>
      <VerticalsShowcase />
    </Section>
  );

  /* ---------------- Multi-Channel Showcase ---------------- */
  const channelsSection = (
    <Section id="canales" className="bg-surface/30">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
          {t("channels.title")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto">
          {t("channels.subtitle")}
        </p>
      </div>
      <MultiChannelShowcase />
      <p className="text-center text-xs text-text-muted mt-8 max-w-2xl mx-auto">
        {t("channels.note")}
      </p>
    </Section>
  );

  /* ---------------- Tools Showcase ---------------- */
  const toolsSection = (
    <Section id="herramientas">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
          {t("tools.title")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto">
          {t("tools.subtitle")}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {[
          { titleKey: "tool1Title", descKey: "tool1Desc", icon: Icon.users(), demo: <PipelineDemo /> },
          { titleKey: "tool2Title", descKey: "tool2Desc", icon: Icon.inbox(), demo: <InboxDemo /> },
          { titleKey: "tool3Title", descKey: "tool3Desc", icon: Icon.calendar(), demo: <CalendarDemo /> },
          { titleKey: "tool4Title", descKey: "tool4Desc", icon: Icon.chart(), demo: <AnalyticsDemo /> },
          { titleKey: "tool5Title", descKey: "tool5Desc", icon: Icon.book(), demo: <KnowledgeBaseDemo /> },
          { titleKey: "tool6Title", descKey: "tool6Desc", icon: Icon.bot(), demo: <AgentConfigDemo /> },
        ].map((tool, i) => (
          <motion.div
            key={i}
            className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 hover:border-accent/30 transition-colors"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: (i % 3) * 0.08, duration: 0.5 }}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
                {tool.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-text-primary mb-1">{t(`tools.${tool.titleKey}`)}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{t(`tools.${tool.descKey}`)}</p>
              </div>
            </div>
            <div className="flex-1 min-h-[200px]">
              {tool.demo}
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );

  /* ---------------- How it works ---------------- */
  const steps = [
    { num: "1", icon: Icon.inbox(), titleKey: "step1", descKey: "step1Desc", tagKey: "step1Tag" },
    { num: "2", icon: Icon.layers(), titleKey: "step2", descKey: "step2Desc", tagKey: "step2Tag" },
    { num: "3", icon: Icon.zap(), titleKey: "step3", descKey: "step3Desc", tagKey: "step3Tag" },
  ];

  const howItWorks = (
    <Section id="como-funciona" className="bg-surface/30">
      <div className="text-center mb-16">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
          {t("howItWorks.sectionTitle")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto">{t("howItWorks.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
        {/* Connector line entre cards en desktop */}
        <div className="hidden md:block absolute top-12 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border-light to-transparent" />

        {steps.map((step, i) => (
          <motion.div
            key={i}
            className="relative bg-surface border border-border rounded-2xl p-7 hover:border-accent/40 transition-colors"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.12, duration: 0.5 }}
          >
            <div className="flex items-start justify-between mb-5">
              <div className="relative inline-flex items-center justify-center w-12 h-12 bg-accent/10 text-accent rounded-xl">
                {step.icon}
              </div>
              <span className="text-xs font-mono text-accent bg-accent/10 px-2.5 py-1 rounded-full">
                {t(`howItWorks.${step.tagKey}`)}
              </span>
            </div>
            <p className="text-sm font-mono text-text-muted mb-2">PASO {step.num}</p>
            <h3 className="text-xl font-bold mb-2.5">{t(`howItWorks.${step.titleKey}`)}</h3>
            <p className="text-text-secondary text-sm leading-relaxed">{t(`howItWorks.${step.descKey}`)}</p>
          </motion.div>
        ))}
      </div>
    </Section>
  );

  /* ---------------- Features grid ---------------- */
  const features = [
    { icon: Icon.bot(), key: "f1" }, { icon: Icon.inbox(), key: "f2" },
    { icon: Icon.users(), key: "f3" }, { icon: Icon.calendar(), key: "f4" },
    { icon: Icon.zap(), key: "f5" }, { icon: Icon.chart(), key: "f6" },
    { icon: Icon.book(), key: "f7" }, { icon: Icon.layers(), key: "f8" },
    { icon: Icon.fingerprint(), key: "f9" }, { icon: Icon.mail(), key: "f10" },
    { icon: Icon.shield(), key: "f11" }, { icon: Icon.lock(), key: "f12" },
  ];

  const featuresSection = (
    <Section id="caracteristicas">
      <div className="text-center mb-14">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">{t("features.title")}</h2>
        <p className="text-text-secondary max-w-2xl mx-auto">{t("features.subtitle")}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((f, i) => (
          <motion.div
            key={i}
            className="bg-surface border border-border rounded-2xl p-6 hover:border-accent/30 hover:bg-surface-light transition-all group"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: (i % 6) * 0.06, duration: 0.4 }}
          >
            <div className="inline-flex items-center justify-center w-11 h-11 bg-accent/10 text-accent rounded-xl mb-4 group-hover:scale-105 transition-transform">
              {f.icon}
            </div>
            <h3 className="text-base font-semibold mb-1.5">{t(`features.${f.key}Title`)}</h3>
            <p className="text-text-secondary text-sm leading-relaxed">{t(`features.${f.key}Desc`)}</p>
          </motion.div>
        ))}
      </div>
    </Section>
  );

  /* ---------------- Comparison ---------------- */
  const compRows = [
    { key: "row1", manual: false, basic: true, parallly: true },
    { key: "row2", manual: false, basic: false, parallly: true },
    { key: "row3", manual: false, basic: false, parallly: true },
    { key: "row4", manual: false, basic: false, parallly: true },
    { key: "row5", manual: true, basic: false, parallly: true },
    { key: "row6", manual: true, basic: false, parallly: true },
    { key: "row7", manual: false, basic: false, parallly: true },
    { key: "row8", manual: false, basic: false, parallly: true },
  ];

  const comparison = (
    <Section className="bg-surface/30">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-14 tracking-tight">
        {t("comparison.title")}
      </h2>
      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full max-w-3xl mx-auto text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-4 pr-4 text-text-secondary font-medium"></th>
              <th className="py-4 px-4 text-text-secondary font-medium text-center">{t("comparison.manual")}</th>
              <th className="py-4 px-4 text-text-secondary font-medium text-center">{t("comparison.basicBots")}</th>
              <th className="py-4 px-4 text-text-primary font-bold text-center bg-accent/10 rounded-t-xl border-x border-t border-accent/30">
                Parallly
              </th>
            </tr>
          </thead>
          <tbody>
            {compRows.map((row, i) => (
              <tr key={i} className="border-b border-border/40">
                <td className="py-3.5 pr-4 text-text-secondary">{t(`comparison.${row.key}`)}</td>
                <td className="py-3.5 px-4 text-center">
                  {row.manual ? <span className="text-emerald-400 inline-block">{Icon.check()}</span> : <span className="text-zinc-600 inline-block">{Icon.x()}</span>}
                </td>
                <td className="py-3.5 px-4 text-center">
                  {row.basic ? <span className="text-emerald-400 inline-block">{Icon.check()}</span> : <span className="text-zinc-600 inline-block">{Icon.x()}</span>}
                </td>
                <td className="py-3.5 px-4 text-center bg-accent/10 border-x border-accent/30">
                  <span className="text-emerald-400 inline-block">{Icon.check()}</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}></td>
              <td className="bg-accent/10 border-x border-b border-accent/30 rounded-b-xl h-2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );

  /* ---------------- Testimonials ---------------- */
  const testimonials = [
    { prefix: "t1", initials: "ML", color: "#f43f5e" },
    { prefix: "t2", initials: "CG", color: "#3b82f6" },
    { prefix: "t3", initials: "VR", color: "#f97316" },
  ];

  const testimonialsSection = (
    <Section>
      <div className="text-center mb-14">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">{t("testimonials.title")}</h2>
        <p className="text-text-secondary">{t("testimonials.subtitle")}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {testimonials.map((tm, i) => (
          <motion.div
            key={i}
            className="bg-surface border border-border rounded-2xl p-7 flex flex-col"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.1, duration: 0.5 }}
          >
            <svg className="w-8 h-8 text-accent/30 mb-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
            </svg>
            <p className="text-text-secondary leading-relaxed flex-1 mb-6 italic">
              {t(`testimonials.${tm.prefix}Quote`)}
            </p>
            <div className="flex items-center gap-3 pt-4 border-t border-border/50">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                style={{ backgroundColor: tm.color }}
              >
                {tm.initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{t(`testimonials.${tm.prefix}Name`)}</p>
                <p className="text-xs text-text-muted truncate">
                  {t(`testimonials.${tm.prefix}Role`)} · {t(`testimonials.${tm.prefix}Company`)}
                </p>
              </div>
              <span className="text-[11px] bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full font-bold flex-shrink-0">
                {t(`testimonials.${tm.prefix}Stat`)}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );

  /* ---------------- Pricing ---------------- */
  const plans = [
    {
      nameKey: "starterName", priceCOP: annual ? "$199.000" : "$239.000", priceUSD: annual ? "~$49 USD" : "~$59 USD",
      descKey: "starterDesc", featuresKey: "starterFeatures", ctaKey: "starterCta", highlighted: false,
    },
    {
      nameKey: "proName", priceCOP: annual ? "$499.000" : "$599.000", priceUSD: annual ? "~$119 USD" : "~$149 USD",
      descKey: "proDesc", featuresKey: "proFeatures", ctaKey: "proCta", highlighted: true, badgeKey: "popular",
    },
    {
      nameKey: "enterpriseName", priceCOP: null, priceUSD: "",
      descKey: "enterpriseDesc", featuresKey: "enterpriseFeatures", ctaKey: "enterpriseCta", highlighted: false,
    },
  ];

  const pricing = (
    <Section id="precios" className="bg-surface/30">
      <div className="text-center mb-10">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">{t("pricing.title")}</h2>
        <p className="text-text-secondary max-w-2xl mx-auto">{t("pricing.freeTrial")}</p>
      </div>

      {/* Toggle anual/mensual */}
      <div className="flex items-center justify-center gap-3 mb-12">
        <span className={`text-sm transition-colors ${!annual ? "text-text-primary font-medium" : "text-text-muted"}`}>
          {t("pricing.monthly")}
        </span>
        <button
          onClick={() => setAnnual(!annual)}
          className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${annual ? "bg-accent" : "bg-border-light"}`}
          aria-label="Toggle billing cycle"
        >
          <motion.div
            className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow"
            animate={{ left: annual ? "26px" : "2px" }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        </button>
        <span className={`text-sm transition-colors ${annual ? "text-text-primary font-medium" : "text-text-muted"}`}>
          {t("pricing.annual")}
          <span className="ml-1.5 text-emerald-400 text-xs font-bold">{t("pricing.annualDiscount")}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
        {plans.map((plan, i) => (
          <motion.div
            key={i}
            className={`relative rounded-2xl p-7 border flex flex-col ${
              plan.highlighted
                ? "bg-surface border-accent/40 shadow-[0_0_60px_rgba(56,151,240,0.12)] md:-mt-4"
                : "bg-surface border-border"
            }`}
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.08, duration: 0.45 }}
          >
            {plan.badgeKey && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                {t(`pricing.${plan.badgeKey}`)}
              </span>
            )}
            <h3 className="text-xl font-bold mb-1">{t(`pricing.${plan.nameKey}`)}</h3>
            <p className="text-text-muted text-sm mb-5">{t(`pricing.${plan.descKey}`)}</p>

            <div className="mb-6 min-h-[80px]">
              {plan.priceCOP !== null ? (
                <>
                  <span className="text-4xl font-bold tabular">{plan.priceCOP}</span>
                  <span className="text-sm text-text-muted ml-1">{t("pricing.perMonth")}</span>
                  <p className="text-xs text-text-muted mt-1.5">{plan.priceUSD}</p>
                </>
              ) : (
                <span className="text-4xl font-bold">{t("pricing.enterprisePrice")}</span>
              )}
            </div>

            <ul className="space-y-2.5 mb-7 flex-1">
              {(t.raw(`pricing.${plan.featuresKey}`) as string[]).map((f, fi) => (
                <li key={fi} className="flex items-start gap-2.5 text-sm">
                  <span className="text-accent flex-shrink-0 mt-0.5">{Icon.check("w-4 h-4")}</span>
                  <span className="text-text-secondary">{f}</span>
                </li>
              ))}
            </ul>

            <a
              href={SIGNUP}
              className={`block text-center py-3 px-6 rounded-xl font-semibold transition-colors cursor-pointer ${
                plan.highlighted
                  ? "bg-accent hover:bg-accent-hover text-white shadow-[0_0_30px_rgba(56,151,240,0.3)]"
                  : "bg-surface-light hover:bg-border border border-border text-text-primary"
              }`}
            >
              {t(`pricing.${plan.ctaKey}`)}
            </a>
          </motion.div>
        ))}
      </div>

      <p className="text-center text-xs text-text-muted mt-8">{t("pricing.currencyHint")}</p>
    </Section>
  );

  /* ---------------- FAQ ---------------- */
  const faqs = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ q: t(`faq.q${n}`), a: t(`faq.a${n}`) }));

  const faqSection = (
    <Section id="preguntas">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">{t("faq.title")}</h2>
        <p className="text-text-secondary">{t("faq.subtitle")}</p>
      </div>
      <div className="max-w-3xl mx-auto space-y-3">
        {faqs.map((faq, i) => (
          <FAQItem key={i} idx={i} question={faq.q} answer={faq.a} />
        ))}
      </div>
    </Section>
  );

  /* ---------------- Final CTA ---------------- */
  const finalCTA = (
    <Section>
      <div className="relative bg-gradient-to-br from-surface via-surface to-accent/10 border border-accent/30 rounded-3xl py-16 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[600px] h-[600px] bg-accent/15 rounded-full blur-3xl" />
        </div>
        <div className="relative">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-5 tracking-tight">
            {t("cta.title")}
          </h2>
          <p className="text-text-secondary text-base sm:text-lg mb-9 max-w-xl mx-auto">
            {t("cta.subtitle")}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={SIGNUP}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl text-base transition-colors shadow-[0_0_60px_rgba(56,151,240,0.4)] cursor-pointer"
            >
              {t("cta.button")} {Icon.arrow()}
            </a>
            <a
              href="mailto:it.executive@parallext.com"
              className="inline-flex items-center justify-center px-8 py-4 border border-border-light hover:border-accent text-text-primary font-medium rounded-xl text-base transition-colors cursor-pointer"
            >
              {t("cta.secondaryButton")}
            </a>
          </div>
          <p className="mt-7 text-xs text-text-muted">{t("cta.guarantees")}</p>
        </div>
      </div>
    </Section>
  );

  /* ---------------- Footer ---------------- */
  const footer = (
    <footer className="border-t border-border bg-surface/30">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          <div className="col-span-2 md:col-span-1">
            <img src="/parallly-logo.svg" alt="Parallly" className="h-9 w-auto mb-4" />
            <p className="text-text-muted text-sm leading-relaxed">{t("footer.brandDesc")}</p>
            <div className="mt-5 space-y-3">
              <div className="flex items-center gap-3">
                <img src="/logos/meta-tech-provider.svg" alt="Meta Tech Provider" className="h-7 w-auto" />
              </div>
              <div className="flex items-center gap-3">
                <img src="/logos/mercadopago.svg" alt="MercadoPago Partner" className="h-7 w-auto" />
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-4">{t("footer.product")}</h4>
            <ul className="space-y-2 text-sm text-text-muted">
              <li><a href="#verticales" className="hover:text-text-secondary transition-colors">{t("footer.verticals")}</a></li>
              <li><a href="#caracteristicas" className="hover:text-text-secondary transition-colors">{t("footer.features")}</a></li>
              <li><a href="#precios" className="hover:text-text-secondary transition-colors">{t("footer.pricing")}</a></li>
              <li><a href="#como-funciona" className="hover:text-text-secondary transition-colors">{t("footer.demo")}</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-4">{t("footer.company")}</h4>
            <ul className="space-y-2 text-sm text-text-muted">
              <li><a href="#" className="hover:text-text-secondary transition-colors">{t("footer.about")}</a></li>
              <li><a href="#" className="hover:text-text-secondary transition-colors">{t("footer.blog")}</a></li>
              <li><a href="mailto:it.executive@parallext.com" className="hover:text-text-secondary transition-colors">{t("footer.support")}</a></li>
              <li><a href="mailto:it.executive@parallext.com" className="hover:text-text-secondary transition-colors">{t("footer.contact")}</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-4">{t("footer.legal")}</h4>
            <ul className="space-y-2 text-sm text-text-muted">
              <li><a href="/privacy" className="hover:text-text-secondary transition-colors">{t("footer.privacy")}</a></li>
              <li><a href="/terms" className="hover:text-text-secondary transition-colors">{t("footer.terms")}</a></li>
              <li><a href="/data-policy" className="hover:text-text-secondary transition-colors">{t("footer.dataPolicy")}</a></li>
              <li><a href="/data-deletion" className="hover:text-text-secondary transition-colors">Eliminar datos</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-7 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-text-muted">{t("footer.madeBy")}</p>
          <p className="text-xs text-text-muted">{t("footer.copyright", { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );

  /* ---------------- Render ---------------- */
  return (
    <>
      {header}
      <main>
        {hero}
        <TrustRow />
        {verticalsSection}
        {channelsSection}
        {toolsSection}
        {howItWorks}
        {featuresSection}
        {comparison}
        {stats}
        {testimonialsSection}
        {pricing}
        {faqSection}
        {finalCTA}
      </main>
      {footer}
    </>
  );
}
