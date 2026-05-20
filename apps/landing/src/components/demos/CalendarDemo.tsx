"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useInView } from "motion/react";

export function CalendarDemo() {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });

  useEffect(() => {
    if (!isInView) return;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
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
  const selectedIdx = 2;

  return (
    <div
      ref={ref}
      className="bg-bg/60 rounded-xl border border-border p-3 h-full"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-text-primary">
          Jueves 15 de mayo
        </span>
        <svg
          className="w-4 h-4 text-text-muted"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
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
            animate={
              i === selectedIdx && step === 1 ? { scale: [1, 1.05, 1] } : {}
            }
            transition={{
              duration: 0.4,
              repeat: step === 1 ? Infinity : 0,
              repeatType: "loop",
            }}
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
            <svg
              className="w-4 h-4 text-emerald-400 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <polyline
                points="20 6 9 17 4 12"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-emerald-400">
                Cita confirmada
              </p>
              <p className="text-[10px] text-text-secondary truncate">
                11:00 · María González
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
