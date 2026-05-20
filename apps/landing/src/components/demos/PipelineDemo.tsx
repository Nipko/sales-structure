"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useInView } from "motion/react";

export function PipelineDemo() {
  const [stage, setStage] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });

  useEffect(() => {
    if (!isInView) return;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
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
    <div
      ref={ref}
      className="grid grid-cols-3 gap-2 p-3 bg-bg/60 rounded-xl border border-border h-full"
    >
      {stages.map((s, i) => (
        <div
          key={i}
          className="bg-surface border border-border rounded-lg p-2 min-h-[140px]"
        >
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: s.color }}
            >
              {s.name}
            </span>
            <span className="text-[10px] text-text-muted">
              {i === stage ? "1" : "0"}
            </span>
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
                <p className="text-[11px] font-semibold text-text-primary truncate">
                  María González
                </p>
                <p className="text-[10px] text-text-secondary truncate">
                  Pediatría · WA
                </p>
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
