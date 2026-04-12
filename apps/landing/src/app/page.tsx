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

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SIGNUP = "https://admin.parallly-chat.cloud/signup";
const LOGIN = "https://admin.parallly-chat.cloud/login";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function Section({
  children,
  id,
  className = "",
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.section
      ref={ref}
      id={id}
      className={`py-24 px-6 ${className}`}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: "easeOut" }}
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
    if (target >= 1000000) return (v / 1000000).toFixed(1) + "M";
    if (target >= 1000) return Math.round(v / 100) / 10 + "";
    return v % 1 === 0 ? Math.round(v).toString() : v.toFixed(1);
  });

  useEffect(() => {
    if (isInView) {
      animate(count, target, { duration: 2, ease: "easeOut" });
    }
  }, [isInView, count, target]);

  return (
    <span ref={ref}>
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  WhatsApp Demo Conversations                                        */
/* ------------------------------------------------------------------ */

interface ChatMessage {
  from: "customer" | "ai";
  text: string;
}

interface DemoConversation {
  businessName: string;
  businessEmoji: string;
  messages: ChatMessage[];
}

const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    businessName: "Bella Hair",
    businessEmoji: "\u{1F487}\u200D\u2640\uFE0F",
    messages: [
      { from: "customer", text: "Hola! Quiero una cita para corte y tinte para el s\u00E1bado \u{1F64F}" },
      { from: "ai", text: "\u00A1Hola! \u{1F487}\u200D\u2640\uFE0F Con gusto te ayudo. Tenemos disponibilidad el s\u00E1bado a las 10am, 2pm y 4pm. \u00BFCu\u00E1l te funciona?" },
      { from: "customer", text: "A las 2pm porfa" },
      { from: "ai", text: "\u00A1Perfecto! Tu cita queda para el s\u00E1bado a las 2pm. Corte + tinte por $85.000 COP. \u00BFA nombre de qui\u00E9n?" },
      { from: "customer", text: "Sandra L\u00F3pez" },
      { from: "ai", text: "\u00A1Listo Sandra! \u2705 Cita confirmada. Te enviar\u00E9 un recordatorio el viernes. \u00A1Te esperamos!" },
    ],
  },
  {
    businessName: "Nails Studio",
    businessEmoji: "\u{1F485}",
    messages: [
      { from: "customer", text: "Buenas! Cu\u00E1nto vale el semipermanente? \u{1F485}" },
      { from: "ai", text: "\u00A1Hola! Gracias por escribirnos \u{1F60A} El semipermanente est\u00E1 en $45.000 COP. Si quieres dise\u00F1o personalizado son $65.000 COP. \u00BFTe gustar\u00EDa agendar?" },
      { from: "customer", text: "Si! El de dise\u00F1o, para ma\u00F1ana tienen?" },
      { from: "ai", text: "Ma\u00F1ana tenemos espacio a las 11am y a las 3pm. \u00BFCu\u00E1l prefieres?" },
      { from: "customer", text: "11am" },
      { from: "ai", text: "\u00A1Agendado! Ma\u00F1ana a las 11am, dise\u00F1o personalizado ($65.000). Recuerda llegar 5 minutos antes. \u00BFAlguna referencia de dise\u00F1o que te guste? \u{1F3A8}" },
    ],
  },
];

function WhatsAppChatDemo({ conversation, delayOffset }: { conversation: DemoConversation; delayOffset: number }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [cycle, setCycle] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runAnimation = useCallback(() => {
    setVisibleCount(0);
    const totalMessages = conversation.messages.length;

    const showNext = (index: number) => {
      if (index > totalMessages) {
        // Pause 3 seconds after all messages, then restart
        timerRef.current = setTimeout(() => {
          setCycle((c) => c + 1);
        }, 3000);
        return;
      }
      timerRef.current = setTimeout(() => {
        setVisibleCount(index);
        showNext(index + 1);
      }, index === 0 ? delayOffset : 500);
    };

    showNext(1);
  }, [conversation.messages.length, delayOffset]);

  useEffect(() => {
    runAnimation();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cycle, runAnimation]);

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl flex-1 min-w-0">
      {/* WhatsApp-style header */}
      <div className="bg-[#075e54] px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm">
          {conversation.businessEmoji}
        </div>
        <div>
          <p className="text-white text-sm font-medium">{conversation.businessName}</p>
          <p className="text-green-200 text-[10px]">en l&iacute;nea</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          <span className="text-green-200 text-[10px] font-medium">IA activa</span>
        </div>
      </div>

      {/* Chat body */}
      <div className="bg-[#0b141a] p-3 min-h-[280px] flex flex-col gap-1.5">
        {conversation.messages.map((msg, i) => (
          <AnimatePresence key={`${cycle}-${i}`}>
            {i < visibleCount && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className={`flex ${msg.from === "customer" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-3 py-1.5 rounded-lg text-xs leading-relaxed ${
                    msg.from === "customer"
                      ? "bg-[#005c4b] text-white rounded-br-sm"
                      : "bg-[#1f2c33] text-gray-200 rounded-bl-sm"
                  }`}
                >
                  {msg.from === "ai" && (
                    <span className="text-[#3897f0] text-[10px] font-semibold block mb-0.5">
                      {conversation.businessName} (IA)
                    </span>
                  )}
                  {msg.text}
                  <span className="text-[9px] text-gray-400 ml-2 float-right mt-1">
                    {msg.from === "customer" ? "✓✓" : ""}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        ))}
      </div>

      {/* Footer badge */}
      <div className="bg-surface border-t border-border px-3 py-2 flex items-center justify-center gap-1.5">
        <svg className="w-3.5 h-3.5 text-[#3897f0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
        </svg>
        <span className="text-[11px] text-[#3897f0] font-medium">Respondi&oacute; en 3 segundos</span>
      </div>
    </div>
  );
}

function DemoSection() {
  return (
    <div className="flex flex-col md:flex-row gap-6">
      {DEMO_CONVERSATIONS.map((conv, i) => (
        <WhatsAppChatDemo key={conv.businessName} conversation={conv} delayOffset={i * 300} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SVG Icons (inline, no external deps)                               */
/* ------------------------------------------------------------------ */

const icons = {
  clock: (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"
      />
    </svg>
  ),
  users: (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  ),
  chart: (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
      />
    </svg>
  ),
  bot: (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
      />
    </svg>
  ),
  messageSquare: (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
      />
    </svg>
  ),
  zap: (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
      />
    </svg>
  ),
  barChart: (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z"
      />
    </svg>
  ),
  shield: (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  ),
  check: (
    <svg
      className="w-5 h-5 text-[#3897f0]"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 12.75l6 6 9-13.5"
      />
    </svg>
  ),
  x: (
    <svg
      className="w-5 h-5 text-text-muted"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  ),
  chevronDown: (
    <svg
      className="w-5 h-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 8.25l-7.5 7.5-7.5-7.5"
      />
    </svg>
  ),
  link: (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
      />
    </svg>
  ),
  cog: (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  ),
  rocket: (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"
      />
    </svg>
  ),
};

/* ------------------------------------------------------------------ */
/*  FAQ Item                                                           */
/* ------------------------------------------------------------------ */

function FAQItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-surface transition-colors"
      >
        <span className="font-medium text-text-primary pr-4">{question}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 text-text-secondary"
        >
          {icons.chevronDown}
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <div className="px-6 pb-6 text-text-secondary leading-relaxed">
              {answer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ================================================================== */
/*  PAGE                                                               */
/* ================================================================== */

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [annual, setAnnual] = useState(true);

  /* -------------------------------------------------------------- */
  /*  Section 1 — Header                                             */
  /* -------------------------------------------------------------- */

  const header = (
    <motion.header
      className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-bg/80 backdrop-blur-xl"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="mx-auto max-w-6xl flex items-center justify-between px-6 h-16">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2">
          <img
            src="/parallly-logo.svg"
            alt="Parallly"
            className="h-10 w-auto"
          />
        </a>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8 text-sm text-text-secondary">
          <a
            href="#caracteristicas"
            className="hover:text-text-primary transition-colors"
          >
            Caracter&iacute;sticas
          </a>
          <a
            href="#precios"
            className="hover:text-text-primary transition-colors"
          >
            Precios
          </a>
          <a
            href="#preguntas"
            className="hover:text-text-primary transition-colors"
          >
            Preguntas
          </a>
        </nav>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-4">
          <a
            href={LOGIN}
            className="text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Ingresar
          </a>
          <a
            href={SIGNUP}
            className="text-sm bg-[#3897f0] hover:bg-[#2b7fd4] text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Empezar gratis
          </a>
        </div>

        {/* Mobile burger */}
        <button
          className="md:hidden text-text-secondary"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Menu"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            {mobileMenuOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
              />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden border-t border-border bg-bg"
          >
            <div className="px-6 py-4 flex flex-col gap-4">
              <a
                href="#caracteristicas"
                onClick={() => setMobileMenuOpen(false)}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                Caracter&iacute;sticas
              </a>
              <a
                href="#precios"
                onClick={() => setMobileMenuOpen(false)}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                Precios
              </a>
              <a
                href="#preguntas"
                onClick={() => setMobileMenuOpen(false)}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                Preguntas
              </a>
              <hr className="border-border" />
              <a
                href={LOGIN}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                Ingresar
              </a>
              <a
                href={SIGNUP}
                className="bg-[#3897f0] hover:bg-[#2b7fd4] text-white px-4 py-2 rounded-lg font-medium text-center transition-colors"
              >
                Empezar gratis
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );

  /* -------------------------------------------------------------- */
  /*  Section 2 — Hero                                                */
  /* -------------------------------------------------------------- */

  const hero = (
    <section className="pt-32 pb-24 px-6 overflow-hidden">
      <div className="mx-auto max-w-6xl flex flex-col lg:flex-row items-center gap-16">
        {/* Left — text */}
        <motion.div
          className="flex-1 text-center lg:text-left"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
        >
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight">
            Tu IA que responde{" "}
            <span className="text-[#3897f0]">WhatsApp</span> y vende por ti, 24/7
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-text-secondary max-w-xl mx-auto lg:mx-0 leading-relaxed">
            Tu agente IA atiende todos tus canales en segundos. Sin c&oacute;digo, sin
            complicaciones. Configura en una hora y empieza a vender m&aacute;s.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
            <a
              href={SIGNUP}
              className="inline-flex items-center justify-center px-8 py-4 bg-[#3897f0] hover:bg-[#2b7fd4] text-white font-semibold rounded-xl text-lg transition-colors shadow-[0_0_40px_rgba(56,151,240,0.3)]"
            >
              Empezar gratis — 7 d&iacute;as
            </a>
            <a
              href="#como-funciona"
              className="inline-flex items-center justify-center px-8 py-4 border border-border hover:border-border-light text-text-primary rounded-xl text-lg font-medium transition-colors"
            >
              Mira c&oacute;mo funciona &darr;
            </a>
          </div>
          <p className="mt-6 text-sm text-text-muted">
            &check; Sin tarjeta de cr&eacute;dito &middot; &check; Listo en 1 hora &middot; &check; Soporte en espa&ntilde;ol 24/7
          </p>
        </motion.div>

        {/* Right — WhatsApp demo conversations */}
        <motion.div
          className="flex-1 w-full max-w-md"
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <WhatsAppChatDemo conversation={DEMO_CONVERSATIONS[0]} delayOffset={200} />
        </motion.div>
      </div>
    </section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 3 — Social Proof                                       */
  /* -------------------------------------------------------------- */

  const socialProof = (
    <Section>
      <p className="text-center text-text-muted text-sm uppercase tracking-widest mb-10">
        M&aacute;s de 500 empresas en Latinoam&eacute;rica conf&iacute;an en Parallly
      </p>

      {/* logos */}
      <div className="flex flex-wrap items-center justify-center gap-8 mb-16">
        {["TechCorp", "Ecomarket", "TurboVentas", "CloudShop", "DataPrime"].map(
          (name) => (
            <div
              key={name}
              className="px-6 py-3 rounded-lg bg-surface border border-border text-text-muted text-sm font-medium"
            >
              {name}
            </div>
          )
        )}
      </div>

      {/* stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
        <div>
          <p className="text-4xl font-bold text-text-primary">
            <CountUp target={2000000} suffix="+" />
          </p>
          <p className="mt-1 text-text-secondary text-sm">
            conversaciones/mes
          </p>
        </div>
        <div>
          <p className="text-4xl font-bold text-text-primary">
            <CountUp target={4.9} suffix="/5" />
          </p>
          <p className="mt-1 text-text-secondary text-sm">satisfacci&oacute;n</p>
        </div>
        <div>
          <p className="text-4xl font-bold text-text-primary">
            <CountUp target={45} suffix="%" />
          </p>
          <p className="mt-1 text-text-secondary text-sm">
            m&aacute;s conversiones
          </p>
        </div>
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 4 — Problem                                            */
  /* -------------------------------------------------------------- */

  const problemCards = [
    {
      icon: icons.clock,
      title: "Tus clientes escriben por WhatsApp, Instagram y Messenger... y t\u00FA respondes horas despu\u00E9s.",
    },
    {
      icon: icons.users,
      title:
        "Cada lead queda en un chat diferente. No sabes qui\u00E9n es qui\u00E9n ni qu\u00E9 le dijiste.",
    },
    {
      icon: icons.chart,
      title: "No tienes datos. No sabes qu\u00E9 canal vende m\u00E1s ni cu\u00E1nto te cuesta cada lead.",
    },
  ];

  const problem = (
    <Section id="problema" className="bg-surface/50">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
        &iquest;Cu&aacute;ntas ventas pierdes por no responder a tiempo?
      </h2>
      <p className="text-text-secondary text-center mb-16 max-w-2xl mx-auto">
        Cada minuto sin responder es un cliente que se va con tu competencia.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {problemCards.map((card, i) => (
          <motion.div
            key={i}
            className="bg-surface border border-border rounded-xl p-8 text-center"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: i * 0.15, duration: 0.5 }}
          >
            <div className="inline-flex items-center justify-center w-12 h-12 bg-red-500/10 text-red-400 rounded-xl mb-5">
              {card.icon}
            </div>
            <p className="text-text-primary font-medium leading-relaxed">
              {card.title}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 5 — Demo Conversations                                 */
  /* -------------------------------------------------------------- */

  const demoConversations = (
    <Section id="como-funciona">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
        As&iacute; se ve en acci&oacute;n
      </h2>
      <p className="text-text-secondary text-center mb-16 max-w-2xl mx-auto">
        Dos negocios reales. Dos conversaciones autom&aacute;ticas. Cero intervenci&oacute;n humana.
      </p>
      <DemoSection />
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 6 — How it Works                                       */
  /* -------------------------------------------------------------- */

  const steps = [
    {
      num: "1",
      icon: icons.link,
      title: "Conecta tus canales",
      desc: "WhatsApp, Instagram y Messenger en 5 minutos. Solo necesitas tu cuenta de Meta.",
    },
    {
      num: "2",
      icon: icons.cog,
      title: "Configura tu agente IA",
      desc: "Sube tu cat\u00E1logo, precios y preguntas frecuentes. Dale personalidad a tu asistente virtual.",
    },
    {
      num: "3",
      icon: icons.rocket,
      title: "Vende en piloto autom\u00E1tico",
      desc: "Tu IA responde al instante, califica leads y pasa los casos importantes a tu equipo.",
    },
  ];

  const howItWorks = (
    <Section>
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16">
        Automatiza en 3 pasos
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
        {steps.map((step, i) => (
          <motion.div
            key={i}
            className="text-center"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: i * 0.15, duration: 0.5 }}
          >
            <div className="relative inline-flex items-center justify-center w-16 h-16 bg-[#3897f0]/10 text-[#3897f0] rounded-2xl mb-6">
              {step.icon}
              <span className="absolute -top-2 -right-2 w-7 h-7 bg-[#3897f0] text-white text-xs font-bold rounded-full flex items-center justify-center">
                {step.num}
              </span>
            </div>
            <h3 className="text-xl font-semibold mb-3 text-text-primary">
              {step.title}
            </h3>
            <p className="text-text-secondary leading-relaxed">{step.desc}</p>
          </motion.div>
        ))}
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 7 — Features                                           */
  /* -------------------------------------------------------------- */

  const features = [
    {
      icon: icons.bot,
      title: "Agente IA que suena como t\u00FA",
      desc: "Configura el tono, el estilo y las reglas. Tu IA responde como si fueras t\u00FA, pero 24/7.",
    },
    {
      icon: icons.messageSquare,
      title: "Todos tus chats en un solo lugar",
      desc: "WhatsApp, Instagram y Messenger en una bandeja unificada. Nunca m\u00E1s saltes entre apps.",
    },
    {
      icon: icons.users,
      title: "CRM que se llena solo",
      desc: "Cada conversaci\u00F3n crea un lead autom\u00E1ticamente. Pipeline, scoring, seguimiento... todo autom\u00E1tico.",
    },
    {
      icon: icons.zap,
      title: "Automatizaciones sin c\u00F3digo",
      desc: "Reglas de negocio, nurturing, seguimiento... configura con clicks, no con c\u00F3digo.",
    },
    {
      icon: icons.barChart,
      title: "M\u00E9tricas que importan",
      desc: "Tiempo de respuesta, conversi\u00F3n por canal, CSAT, rendimiento de agentes. Todo en tiempo real.",
    },
    {
      icon: icons.shield,
      title: "Seguridad de verdad",
      desc: "Cifrado AES-256, datos por tenant, roles granulares. Tu info y la de tus clientes est\u00E1n protegidas.",
    },
  ];

  const featuresSection = (
    <Section id="caracteristicas" className="bg-surface/50">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
        Todo lo que necesitas para vender m&aacute;s
      </h2>
      <p className="text-text-secondary text-center mb-16 max-w-2xl mx-auto">
        Una plataforma completa que reemplaza 5 herramientas diferentes.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((f, i) => (
          <motion.div
            key={i}
            className="bg-surface border border-border rounded-xl p-8 hover:border-[#3897f0]/30 transition-colors"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: i * 0.1, duration: 0.5 }}
          >
            <div className="inline-flex items-center justify-center w-12 h-12 bg-[#3897f0]/10 text-[#3897f0] rounded-xl mb-5">
              {f.icon}
            </div>
            <h3 className="text-lg font-semibold mb-2 text-text-primary">
              {f.title}
            </h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              {f.desc}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 8 — Comparison                                         */
  /* -------------------------------------------------------------- */

  const compRows = [
    { label: "Respuesta 24/7", manual: false, basic: true, parallly: true },
    { label: "Entiende contexto", manual: false, basic: false, parallly: true },
    { label: "Multi-canal", manual: false, basic: false, parallly: true },
    { label: "CRM integrado", manual: false, basic: false, parallly: true },
    { label: "Sin c\u00F3digo", manual: true, basic: false, parallly: true },
    { label: "Escalada humana", manual: true, basic: false, parallly: true },
  ];

  const comparison = (
    <Section>
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16">
        &iquest;Por qu&eacute; Parallly?
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full max-w-3xl mx-auto">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-4 pr-4 text-text-secondary text-sm font-medium"></th>
              <th className="py-4 px-4 text-text-secondary text-sm font-medium text-center">
                Manual
              </th>
              <th className="py-4 px-4 text-text-secondary text-sm font-medium text-center">
                Chatbots b&aacute;sicos
              </th>
              <th className="py-4 px-4 text-text-primary text-sm font-semibold text-center bg-[#3897f0]/5 rounded-t-xl border-x border-t border-[#3897f0]/20">
                Parallly
              </th>
            </tr>
          </thead>
          <tbody>
            {compRows.map((row, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-4 pr-4 text-sm text-text-secondary">
                  {row.label}
                </td>
                <td className="py-4 px-4 text-center">
                  {row.manual ? icons.check : icons.x}
                </td>
                <td className="py-4 px-4 text-center">
                  {row.basic ? icons.check : icons.x}
                </td>
                <td className="py-4 px-4 text-center bg-[#3897f0]/5 border-x border-[#3897f0]/20">
                  {row.parallly ? icons.check : icons.x}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td></td>
              <td></td>
              <td className="bg-[#3897f0]/5 border-x border-b border-[#3897f0]/20 rounded-b-xl h-2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 9 — Testimonials                                       */
  /* -------------------------------------------------------------- */

  const testimonials = [
    {
      quote:
        "Antes tard\u00E1bamos horas en responder por WhatsApp. Ahora la IA responde en 3 segundos. Las ventas subieron 45% en el primer mes.",
      name: "Mar\u00EDa L\u00F3pez",
      role: "Fundadora",
      company: "Tienda Online Bogot\u00E1",
      stat: "+45% ventas",
      initials: "ML",
    },
    {
      quote:
        "Manejamos 15 clientes con WhatsApp e Instagram. Con Parallly todo llega a un solo panel. Mi equipo dej\u00F3 de volverse loco.",
      name: "Carlos G\u00F3mez",
      role: "Director Comercial",
      company: "Agencia Digital Medell\u00EDn",
      stat: "+60% productividad",
      initials: "CG",
    },
    {
      quote:
        "Los pedidos por WhatsApp los maneja la IA. Mi equipo se enfoca en cocinar, no en contestar mensajes.",
      name: "Valentina R\u00EDos",
      role: "Due\u00F1a",
      company: "Restaurante Cali",
      stat: "800+ pedidos/mes",
      initials: "VR",
    },
  ];

  const testimonialsSection = (
    <Section className="bg-surface/50">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16">
        Lo que dicen nuestros clientes
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {testimonials.map((t, i) => (
          <motion.div
            key={i}
            className="bg-surface border border-border rounded-xl p-8 flex flex-col"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: i * 0.15, duration: 0.5 }}
          >
            <p className="text-text-secondary leading-relaxed flex-1 mb-6">
              &ldquo;{t.quote}&rdquo;
            </p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#3897f0]/20 flex items-center justify-center text-[#3897f0] text-sm font-bold">
                {t.initials}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">
                  {t.name}
                </p>
                <p className="text-xs text-text-muted">
                  {t.role}, {t.company}
                </p>
              </div>
              <span className="text-xs bg-[#3897f0]/10 text-[#3897f0] px-2.5 py-1 rounded-full font-medium">
                {t.stat}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 10 — Pricing                                           */
  /* -------------------------------------------------------------- */

  const plans = [
    {
      name: "Starter",
      priceCOP: annual ? "$199.000" : "$239.000",
      priceUSD: annual ? "(~$49 USD)" : "(~$59 USD)",
      period: " COP/mes",
      desc: "Para emprendedores.",
      features: [
        "3 canales conectados",
        "5,000 conversaciones/mes",
        "1 agente IA",
        "CRM b\u00E1sico",
        "Soporte por email",
      ],
      cta: "Empezar con Starter",
      highlighted: false,
    },
    {
      name: "Pro",
      priceCOP: annual ? "$499.000" : "$599.000",
      priceUSD: annual ? "(~$119 USD)" : "(~$149 USD)",
      period: " COP/mes",
      desc: "Para equipos que quieren crecer.",
      features: [
        "Canales ilimitados",
        "Conversaciones ilimitadas",
        "5 agentes IA",
        "CRM avanzado + API",
        "Analytics completo",
        "Soporte prioritario",
      ],
      cta: "Empezar con Pro",
      highlighted: true,
      badge: "M\u00E1s popular",
    },
    {
      name: "Enterprise",
      priceCOP: null,
      priceUSD: "",
      period: "",
      desc: "Para empresas con necesidades especiales.",
      features: [
        "Todo ilimitado",
        "SLA garantizado",
        "Soporte dedicado 24/7",
        "White-label",
        "Integraciones custom",
        "Onboarding personalizado",
      ],
      cta: "Hablemos",
      highlighted: false,
    },
  ];

  const pricing = (
    <Section id="precios">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
        Planes que crecen contigo
      </h2>
      <p className="text-text-secondary text-center mb-10 max-w-2xl mx-auto">
        7 d&iacute;as gratis. Sin tarjeta. Sin letra peque&ntilde;a.
      </p>

      {/* Toggle */}
      <div className="flex items-center justify-center gap-3 mb-16">
        <span
          className={`text-sm ${!annual ? "text-text-primary" : "text-text-muted"}`}
        >
          Mensual
        </span>
        <button
          onClick={() => setAnnual(!annual)}
          className={`relative w-12 h-6 rounded-full transition-colors ${annual ? "bg-[#3897f0]" : "bg-border"}`}
        >
          <motion.div
            className="absolute top-0.5 w-5 h-5 bg-white rounded-full"
            animate={{ left: annual ? "26px" : "2px" }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        </button>
        <span
          className={`text-sm ${annual ? "text-text-primary" : "text-text-muted"}`}
        >
          Anual{" "}
          <span className="text-[#3897f0] text-xs font-medium">(-17%)</span>
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {plans.map((plan, i) => (
          <motion.div
            key={i}
            className={`relative rounded-2xl p-8 border flex flex-col ${
              plan.highlighted
                ? "bg-surface border-[#3897f0]/40 shadow-[0_0_60px_rgba(56,151,240,0.1)]"
                : "bg-surface border-border"
            }`}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: i * 0.1, duration: 0.5 }}
            whileHover={{ scale: 1.02 }}
          >
            {plan.badge && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#3897f0] text-white text-xs font-semibold px-3 py-1 rounded-full">
                {plan.badge}
              </span>
            )}
            <h3 className="text-xl font-semibold text-text-primary mb-2">
              {plan.name}
            </h3>
            <p className="text-text-muted text-sm mb-6">{plan.desc}</p>
            <div className="mb-6">
              {plan.priceCOP !== null ? (
                <div>
                  <span className="text-3xl font-bold text-text-primary">
                    {plan.priceCOP}
                  </span>
                  <span className="text-sm font-normal text-text-muted">
                    {plan.period}
                  </span>
                  <p className="text-xs text-text-muted mt-1">{plan.priceUSD}</p>
                </div>
              ) : (
                <span className="text-4xl font-bold text-text-primary">
                  Hablemos
                </span>
              )}
            </div>
            <ul className="space-y-3 mb-8 flex-1">
              {plan.features.map((f, fi) => (
                <li
                  key={fi}
                  className="flex items-center gap-3 text-sm text-text-secondary"
                >
                  {icons.check}
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <a
              href={SIGNUP}
              className={`block text-center py-3 px-6 rounded-xl font-medium transition-colors ${
                plan.highlighted
                  ? "bg-[#3897f0] hover:bg-[#2b7fd4] text-white"
                  : "bg-surface-light hover:bg-border border border-border text-text-primary"
              }`}
            >
              {plan.cta}
            </a>
          </motion.div>
        ))}
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 11 — FAQ                                               */
  /* -------------------------------------------------------------- */

  const faqs = [
    {
      q: "\u00BFNecesito saber programar?",
      a: "Para nada. Todo se configura con clicks. Si sabes usar WhatsApp, sabes usar Parallly.",
    },
    {
      q: "\u00BFC\u00F3mo funciona la IA?",
      a: "Subes tu info (cat\u00E1logo, preguntas frecuentes, reglas). La IA aprende y responde como si fueras t\u00FA. Usamos modelos avanzados como GPT-4 y Claude, entrenados con la informaci\u00F3n de tu negocio.",
    },
    {
      q: "\u00BFY si la IA mete la pata?",
      a: "Tranquilo. Si la IA no sabe qu\u00E9 decir, pasa la conversaci\u00F3n a tu equipo al instante. Nuestro sistema de handoff inteligente le env\u00EDa todo el contexto a tu agente humano para que no tenga que empezar de cero.",
    },
    {
      q: "\u00BFSe integra con mi sistema actual?",
      a: "S\u00ED. Tenemos API abierta y nos conectamos con los CRMs m\u00E1s usados. Parallly incluye su propio CRM, pero tambi\u00E9n se integra con HubSpot, Salesforce y m\u00E1s v\u00EDa webhooks.",
    },
    {
      q: "\u00BFEs seguro?",
      a: "100%. Cifrado militar (AES-256-GCM), datos aislados por empresa, backups diarios. Cumplimos con todas las normas. Tu info y la de tus clientes nunca se comparten entre tenants.",
    },
    {
      q: "\u00BFEn cu\u00E1nto tiempo lo tengo funcionando?",
      a: "En 1 hora ya tienes tu agente IA respondiendo. En serio, 1 hora. Solo conectas tu cuenta de Meta, subes tu informaci\u00F3n y listo.",
    },
  ];

  const faqSection = (
    <Section id="preguntas" className="bg-surface/50">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
        Preguntas frecuentes
      </h2>
      <p className="text-text-secondary text-center mb-16 max-w-2xl mx-auto">
        Todo lo que necesitas saber para empezar.
      </p>
      <div className="max-w-3xl mx-auto space-y-3">
        {faqs.map((faq, i) => (
          <FAQItem key={i} question={faq.q} answer={faq.a} />
        ))}
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 12 — Final CTA                                         */
  /* -------------------------------------------------------------- */

  const finalCTA = (
    <Section>
      <div className="text-center relative">
        {/* glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-96 h-96 bg-[#3897f0]/10 rounded-full blur-3xl" />
        </div>
        <div className="relative">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6">
            &iquest;Listo para dejar de perder ventas?
          </h2>
          <p className="text-text-secondary text-lg mb-10 max-w-xl mx-auto">
            Empieza tu prueba gratis hoy. 7 d&iacute;as, sin tarjeta, sin compromiso.
          </p>
          <a
            href={SIGNUP}
            className="inline-flex items-center justify-center px-10 py-5 bg-[#3897f0] hover:bg-[#2b7fd4] text-white font-semibold rounded-xl text-lg transition-colors shadow-[0_0_60px_rgba(56,151,240,0.3)]"
          >
            Empezar prueba gratis — 7 d&iacute;as
          </a>
          <p className="mt-8 text-sm text-text-muted">
            Configuraci&oacute;n en 1 hora &middot; Soporte en espa&ntilde;ol 24/7 &middot;
            Garant&iacute;a 30 d&iacute;as
          </p>
        </div>
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 13 — Footer                                            */
  /* -------------------------------------------------------------- */

  const footer = (
    <footer className="border-t border-border bg-surface/30">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          {/* brand */}
          <div className="col-span-2 md:col-span-1">
            <img
              src="/parallly-logo.svg"
              alt="Parallly"
              className="h-10 w-auto mb-4"
            />
            <p className="text-text-muted text-sm leading-relaxed">
              La plataforma de IA conversacional para ventas en Latinoam&eacute;rica.
            </p>
          </div>

          {/* Producto */}
          <div>
            <h4 className="text-sm font-semibold text-text-primary mb-4">
              Producto
            </h4>
            <ul className="space-y-2 text-sm text-text-muted">
              <li>
                <a
                  href="#caracteristicas"
                  className="hover:text-text-secondary transition-colors"
                >
                  Caracter&iacute;sticas
                </a>
              </li>
              <li>
                <a
                  href="#precios"
                  className="hover:text-text-secondary transition-colors"
                >
                  Precios
                </a>
              </li>
              <li>
                <a
                  href="#como-funciona"
                  className="hover:text-text-secondary transition-colors"
                >
                  Demo
                </a>
              </li>
            </ul>
          </div>

          {/* Empresa */}
          <div>
            <h4 className="text-sm font-semibold text-text-primary mb-4">
              Empresa
            </h4>
            <ul className="space-y-2 text-sm text-text-muted">
              <li>
                <a href="#" className="hover:text-text-secondary transition-colors">
                  Acerca de
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-text-secondary transition-colors">
                  Blog
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-text-secondary transition-colors">
                  Contacto
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-semibold text-text-primary mb-4">
              Legal
            </h4>
            <ul className="space-y-2 text-sm text-text-muted">
              <li>
                <a href="/privacy" className="hover:text-text-secondary transition-colors">
                  Privacidad
                </a>
              </li>
              <li>
                <a href="/terms" className="hover:text-text-secondary transition-colors">
                  T&eacute;rminos
                </a>
              </li>
              <li>
                <a href="/data-policy" className="hover:text-text-secondary transition-colors">
                  Datos personales
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-text-muted">
            Desarrollado con &hearts; por Parallext
          </p>
          <p className="text-xs text-text-muted">
            &copy; 2026 Parallly. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </footer>
  );

  /* -------------------------------------------------------------- */
  /*  Render                                                         */
  /* -------------------------------------------------------------- */

  return (
    <>
      {header}
      <main>
        {hero}
        {socialProof}
        {problem}
        {demoConversations}
        {howItWorks}
        {featuresSection}
        {comparison}
        {testimonialsSection}
        {pricing}
        {faqSection}
        {finalCTA}
      </main>
      {footer}
    </>
  );
}
