"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
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
/*  Multichannel Demo Animation                                        */
/* ------------------------------------------------------------------ */

function MultichannelDemo() {
  const channels = [
    {
      name: "WhatsApp",
      color: "bg-green-500",
      borderColor: "border-green-500/40",
      bgColor: "bg-green-500/10",
      textColor: "text-green-400",
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.146.565 4.157 1.549 5.897L0 24l6.304-1.654A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.82a9.78 9.78 0 01-5.202-1.49l-.373-.222-3.87 1.015 1.034-3.777-.244-.388A9.78 9.78 0 012.18 12 9.82 9.82 0 0112 2.18 9.82 9.82 0 0121.82 12 9.82 9.82 0 0112 21.82z" />
        </svg>
      ),
      message: "Hola, quiero info del plan Pro",
      delay: 0.5,
    },
    {
      name: "Instagram",
      color: "bg-pink-500",
      borderColor: "border-pink-500/40",
      bgColor: "bg-pink-500/10",
      textColor: "text-pink-400",
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      ),
      message: "Vi su story, tienen descuento?",
      delay: 1.0,
    },
    {
      name: "Messenger",
      color: "bg-blue-500",
      borderColor: "border-blue-500/40",
      bgColor: "bg-blue-500/10",
      textColor: "text-blue-400",
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.654V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.975 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8.2l3.131 3.259L19.752 8.2l-6.561 6.763z" />
        </svg>
      ),
      message: "Necesito cotizar para mi empresa",
      delay: 1.5,
    },
  ];

  const aiResponse = "Con gusto te ayudo. Nuestro plan Pro incluye canales ilimitados, 5 agentes IA y CRM avanzado por $199/mes.";

  return (
    <div className="space-y-3">
      {/* Three channel windows */}
      {channels.map((ch, i) => (
        <motion.div
          key={ch.name}
          className={`${ch.bgColor} border ${ch.borderColor} rounded-xl p-3`}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: ch.delay, duration: 0.4, ease: "easeOut" }}
        >
          {/* Channel header */}
          <div className="flex items-center gap-2 mb-2">
            <div className={`${ch.textColor}`}>{ch.icon}</div>
            <span className={`text-xs font-semibold ${ch.textColor}`}>
              {ch.name}
            </span>
          </div>

          {/* Customer message */}
          <motion.div
            className="mb-2"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: ch.delay + 0.2, duration: 0.3 }}
          >
            <div className="bg-white/10 text-text-primary text-xs px-3 py-1.5 rounded-lg rounded-br-sm inline-block max-w-[90%]">
              {ch.message}
            </div>
          </motion.div>

          {/* AI response — all appear at once at 2.0s */}
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2.0, duration: 0.4 }}
          >
            <div className="flex items-start gap-1.5">
              <div className="w-4 h-4 rounded-full bg-accent/30 flex items-center justify-center text-accent shrink-0 mt-0.5">
                <span className="text-[8px] font-bold">IA</span>
              </div>
              <div className="bg-accent/15 border border-accent/20 text-text-primary text-xs px-3 py-1.5 rounded-lg rounded-bl-sm max-w-[90%]">
                {aiResponse}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ))}

      {/* CRM notification */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 2.5, duration: 0.4 }}
        className="bg-accent/10 border border-accent/30 rounded-xl p-3"
      >
        <div className="flex items-center gap-2 text-accent text-xs font-medium">
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Nuevo lead capturado — 3 canales sincronizados
        </div>
      </motion.div>
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
      className="w-5 h-5 text-accent"
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
            Características
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
            className="text-sm bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg font-medium transition-colors"
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
                Características
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
                className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg font-medium text-center transition-colors"
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
            Respondé{" "}
            <span className="text-accent">WhatsApp</span>, Instagram y
            Messenger desde un solo lugar
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-text-secondary max-w-xl mx-auto lg:mx-0 leading-relaxed">
            Tu agente IA atiende todos tus canales en segundos. Sin código, sin
            complicaciones. Configuralo en una hora y empezá a vender más.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
            <a
              href={SIGNUP}
              className="inline-flex items-center justify-center px-8 py-4 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl text-lg transition-colors shadow-[0_0_40px_rgba(16,185,129,0.3)]"
            >
              Empezar gratis — 7 días
            </a>
            <a
              href="#como-funciona"
              className="inline-flex items-center justify-center px-8 py-4 border border-border hover:border-border-light text-text-primary rounded-xl text-lg font-medium transition-colors"
            >
              Mirá cómo funciona ↓
            </a>
          </div>
          <p className="mt-6 text-sm text-text-muted">
            ✓ Sin tarjeta de crédito · ✓ Listo en 1 hora · ✓ Soporte en español 24/7
          </p>
        </motion.div>

        {/* Right — multichannel demo mockup */}
        <motion.div
          className="flex-1 w-full max-w-md"
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-2xl">
            {/* header */}
            <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border">
              <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-bold">
                IA
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">
                  Bandeja Unificada
                </p>
                <p className="text-xs text-accent">3 canales activos</p>
              </div>
            </div>

            {/* Multichannel animation */}
            <MultichannelDemo />
          </div>
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
        Más de 500 empresas en Latinoamérica confían en Parallly
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
          <p className="mt-1 text-text-secondary text-sm">satisfacción</p>
        </div>
        <div>
          <p className="text-4xl font-bold text-text-primary">
            <CountUp target={45} suffix="%" />
          </p>
          <p className="mt-1 text-text-secondary text-sm">
            más conversiones
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
      title: "Tus clientes escriben por WhatsApp, Instagram y Messenger... y vos respondés horas después.",
    },
    {
      icon: icons.users,
      title:
        "Cada lead queda en un chat diferente. No sabés quién es quién ni qué le dijiste.",
    },
    {
      icon: icons.chart,
      title: "No tenés datos. No sabés qué canal vende más ni cuánto te cuesta cada lead.",
    },
  ];

  const problem = (
    <Section id="problema" className="bg-surface/50">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
        ¿Cuántas ventas perdés por no responder a tiempo?
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
  /*  Section 5 — How it Works                                       */
  /* -------------------------------------------------------------- */

  const steps = [
    {
      num: "1",
      icon: icons.link,
      title: "Conectá tus canales",
      desc: "WhatsApp, Instagram y Messenger en 5 minutos. Solo necesitás tu cuenta de Meta.",
    },
    {
      num: "2",
      icon: icons.cog,
      title: "Configurá tu agente IA",
      desc: "Subí tu catálogo, precios y preguntas frecuentes. Dale personalidad a tu asistente virtual.",
    },
    {
      num: "3",
      icon: icons.rocket,
      title: "Vendé en piloto automático",
      desc: "Tu IA responde al instante, califica leads y pasa los casos importantes a tu equipo.",
    },
  ];

  const howItWorks = (
    <Section id="como-funciona">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16">
        Automatizá en 3 pasos
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
            <div className="relative inline-flex items-center justify-center w-16 h-16 bg-accent/10 text-accent rounded-2xl mb-6">
              {step.icon}
              <span className="absolute -top-2 -right-2 w-7 h-7 bg-accent text-white text-xs font-bold rounded-full flex items-center justify-center">
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
  /*  Section 6 — Features                                           */
  /* -------------------------------------------------------------- */

  const features = [
    {
      icon: icons.bot,
      title: "Agente IA que suena como vos",
      desc: "Configurá el tono, el estilo y las reglas. Tu IA responde como si fueras vos, pero 24/7.",
    },
    {
      icon: icons.messageSquare,
      title: "Todos tus chats en un solo lugar",
      desc: "WhatsApp, Instagram y Messenger en una bandeja unificada. Nunca más saltés entre apps.",
    },
    {
      icon: icons.users,
      title: "CRM que se llena solo",
      desc: "Cada conversación crea un lead automáticamente. Pipeline, scoring, seguimiento... todo automático.",
    },
    {
      icon: icons.zap,
      title: "Automatizaciones sin código",
      desc: "Reglas de negocio, nurturing, seguimiento... configuralo con clicks, no con código.",
    },
    {
      icon: icons.barChart,
      title: "Métricas que importan",
      desc: "Tiempo de respuesta, conversión por canal, CSAT, rendimiento de agentes. Todo en tiempo real.",
    },
    {
      icon: icons.shield,
      title: "Seguridad de verdad",
      desc: "Cifrado AES-256, datos por tenant, roles granulares. Tu info y la de tus clientes están protegidas.",
    },
  ];

  const featuresSection = (
    <Section id="caracteristicas" className="bg-surface/50">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
        Todo lo que necesitás para vender más
      </h2>
      <p className="text-text-secondary text-center mb-16 max-w-2xl mx-auto">
        Una plataforma completa que reemplaza 5 herramientas diferentes.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((f, i) => (
          <motion.div
            key={i}
            className="bg-surface border border-border rounded-xl p-8 hover:border-accent/30 transition-colors"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: i * 0.1, duration: 0.5 }}
          >
            <div className="inline-flex items-center justify-center w-12 h-12 bg-accent/10 text-accent rounded-xl mb-5">
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
  /*  Section 7 — Comparison                                         */
  /* -------------------------------------------------------------- */

  const compRows = [
    { label: "Respuesta 24/7", manual: false, basic: true, parallly: true },
    { label: "Entiende contexto", manual: false, basic: false, parallly: true },
    { label: "Multi-canal", manual: false, basic: false, parallly: true },
    { label: "CRM integrado", manual: false, basic: false, parallly: true },
    { label: "Sin código", manual: true, basic: false, parallly: true },
    { label: "Escalada humana", manual: true, basic: false, parallly: true },
  ];

  const comparison = (
    <Section>
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16">
        ¿Por qué Parallly?
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
                Chatbots básicos
              </th>
              <th className="py-4 px-4 text-text-primary text-sm font-semibold text-center bg-accent/5 rounded-t-xl border-x border-t border-accent/20">
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
                <td className="py-4 px-4 text-center bg-accent/5 border-x border-accent/20">
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
              <td className="bg-accent/5 border-x border-b border-accent/20 rounded-b-xl h-2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 8 — Testimonials                                       */
  /* -------------------------------------------------------------- */

  const testimonials = [
    {
      quote:
        "Antes tardábamos horas en responder por WhatsApp. Ahora la IA responde en 3 segundos. Las ventas subieron 45% en el primer mes.",
      name: "María López",
      role: "Fundadora",
      company: "Tienda Online Bogotá",
      stat: "+45% ventas",
      initials: "ML",
    },
    {
      quote:
        "Manejamos 15 clientes con WhatsApp e Instagram. Con Parallly todo llega a un solo panel. Mi equipo dejó de volverse loco.",
      name: "Carlos Gómez",
      role: "Director Comercial",
      company: "Agencia Digital Medellín",
      stat: "+60% productividad",
      initials: "CG",
    },
    {
      quote:
        "Los pedidos por WhatsApp los maneja la IA. Mi equipo se enfoca en cocinar, no en contestar mensajes.",
      name: "Valentina Ríos",
      role: "Dueña",
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
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-bold">
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
              <span className="text-xs bg-accent/10 text-accent px-2.5 py-1 rounded-full font-medium">
                {t.stat}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 9 — Pricing                                            */
  /* -------------------------------------------------------------- */

  const plans = [
    {
      name: "Starter",
      price: annual ? 49 : 59,
      period: " USD/mes",
      desc: "Para emprendedores y equipos pequeños.",
      features: [
        "3 canales conectados",
        "5,000 conversaciones/mes",
        "1 agente IA",
        "CRM básico",
        "Soporte por email",
      ],
      cta: "Empezar con Starter",
      highlighted: false,
    },
    {
      name: "Pro",
      price: annual ? 199 : 239,
      period: " USD/mes",
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
      badge: "Más popular",
    },
    {
      name: "Enterprise",
      price: null,
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
        Planes que crecen con vos
      </h2>
      <p className="text-text-secondary text-center mb-10 max-w-2xl mx-auto">
        7 días gratis. Sin tarjeta. Sin letra pequeña.
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
          className={`relative w-12 h-6 rounded-full transition-colors ${annual ? "bg-accent" : "bg-border"}`}
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
          <span className="text-accent text-xs font-medium">(-17%)</span>
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {plans.map((plan, i) => (
          <motion.div
            key={i}
            className={`relative rounded-2xl p-8 border flex flex-col ${
              plan.highlighted
                ? "bg-surface border-accent/40 shadow-[0_0_60px_rgba(16,185,129,0.1)]"
                : "bg-surface border-border"
            }`}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: i * 0.1, duration: 0.5 }}
            whileHover={{ scale: 1.02 }}
          >
            {plan.badge && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-xs font-semibold px-3 py-1 rounded-full">
                {plan.badge}
              </span>
            )}
            <h3 className="text-xl font-semibold text-text-primary mb-2">
              {plan.name}
            </h3>
            <p className="text-text-muted text-sm mb-6">{plan.desc}</p>
            <div className="mb-6">
              {plan.price !== null ? (
                <span className="text-4xl font-bold text-text-primary">
                  ${plan.price}
                  <span className="text-lg font-normal text-text-muted">
                    {plan.period}
                  </span>
                </span>
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
                  ? "bg-accent hover:bg-accent-hover text-white"
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
  /*  Section 10 — FAQ                                               */
  /* -------------------------------------------------------------- */

  const faqs = [
    {
      q: "¿Necesito saber programar?",
      a: "Para nada. Todo se configura con clicks. Si sabés usar WhatsApp, sabés usar Parallly.",
    },
    {
      q: "¿Cómo funciona la IA?",
      a: "Subís tu info (catálogo, preguntas frecuentes, reglas). La IA aprende y responde como si fueras vos. Usamos modelos avanzados como GPT-4 y Claude, entrenados con la información de tu negocio.",
    },
    {
      q: "¿Y si la IA mete la pata?",
      a: "Tranqui. Si la IA no sabe qué decir, pasa la conversación a tu equipo al instante. Nuestro sistema de handoff inteligente le envía todo el contexto a tu agente humano para que no tenga que empezar de cero.",
    },
    {
      q: "¿Se integra con mi sistema actual?",
      a: "Sí. Tenemos API abierta y nos conectamos con los CRMs más usados. Parallly incluye su propio CRM, pero también se integra con HubSpot, Salesforce y más vía webhooks.",
    },
    {
      q: "¿Es seguro?",
      a: "100%. Cifrado militar (AES-256-GCM), datos aislados por empresa, backups diarios. Cumplimos con todas las normas. Tu info y la de tus clientes nunca se comparten entre tenants.",
    },
    {
      q: "¿En cuánto tiempo lo tengo funcionando?",
      a: "En 1 hora ya tenés tu agente IA respondiendo. En serio, 1 hora. Solo conectás tu cuenta de Meta, subís tu información y listo.",
    },
  ];

  const faqSection = (
    <Section id="preguntas" className="bg-surface/50">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
        Preguntas frecuentes
      </h2>
      <p className="text-text-secondary text-center mb-16 max-w-2xl mx-auto">
        Todo lo que necesitás saber para empezar.
      </p>
      <div className="max-w-3xl mx-auto space-y-3">
        {faqs.map((faq, i) => (
          <FAQItem key={i} question={faq.q} answer={faq.a} />
        ))}
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 11 — Final CTA                                         */
  /* -------------------------------------------------------------- */

  const finalCTA = (
    <Section>
      <div className="text-center relative">
        {/* glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
        </div>
        <div className="relative">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6">
            ¿Listo para dejar de perder ventas?
          </h2>
          <p className="text-text-secondary text-lg mb-10 max-w-xl mx-auto">
            Empezá tu prueba gratis hoy. 7 días, sin tarjeta, sin compromiso.
          </p>
          <a
            href={SIGNUP}
            className="inline-flex items-center justify-center px-10 py-5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl text-lg transition-colors shadow-[0_0_60px_rgba(16,185,129,0.3)]"
          >
            Empezar prueba gratis — 7 días
          </a>
          <p className="mt-8 text-sm text-text-muted">
            Configuración en 1 hora · Soporte en español 24/7 ·
            Garantía 30 días
          </p>
        </div>
      </div>
    </Section>
  );

  /* -------------------------------------------------------------- */
  /*  Section 12 — Footer                                            */
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
              La plataforma de IA conversacional para ventas en Latinoamérica.
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
                  Características
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
                <a href="#" className="hover:text-text-secondary transition-colors">
                  Privacidad
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-text-secondary transition-colors">
                  Términos
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-text-muted">
            Desarrollado con ❤️ por Parallext
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
