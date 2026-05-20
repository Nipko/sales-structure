"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useInView } from "motion/react";

export function KnowledgeBaseDemo() {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });

  useEffect(() => {
    if (!isInView) return;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
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
    <div
      ref={ref}
      className="bg-bg/60 rounded-xl border border-border p-3 h-full"
    >
      <div className="flex items-center gap-2 mb-2">
        <svg
          className="w-4 h-4 text-accent"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            d="M4 19.5A2.5 2.5 0 016.5 17H20M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5a2.5 2.5 0 01-2.5-2.5v-15z"
            strokeLinecap="round"
          />
        </svg>
        <span className="text-xs font-semibold text-text-primary">
          Base de conocimiento
        </span>
      </div>

      {/* Question */}
      <div className="bg-surface rounded-lg p-2.5 mb-2 border border-border">
        <p className="text-[11px] text-text-secondary mb-1">
          Cliente pregunta:
        </p>
        <p className="text-[12px] text-text-primary">
          ¿Aceptan tarjeta sodexo?
        </p>
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
            <p className="text-[10px] text-accent font-semibold uppercase tracking-wider mb-1">
              Encontrado en políticas.pdf
            </p>
            <p className="text-[11px] text-text-primary leading-snug">
              Sí, aceptamos tarjetas Sodexo, Big Pass y Edenred. Pago en sitio,
              no acumulan puntos.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
