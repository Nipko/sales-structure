"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";

export function AgentConfigDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });

  const sliders = [
    { label: "Tono", value: "Empático", color: "#10b981", width: "85%" },
    { label: "Modelo IA", value: "Claude Opus", color: "#a855f7", width: "100%" },
    { label: "Canal", value: "WhatsApp", color: "#25D366", width: "70%" },
  ];

  return (
    <div
      ref={ref}
      className="bg-bg/60 rounded-xl border border-border p-3 h-full"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
          <span className="text-base">{"\u{1FA7A}"}</span>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-primary">
            Sofía · Asistente médica
          </p>
          <p className="text-[10px] text-text-muted">
            Plantilla: Salud · Dental
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        {sliders.map((s, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-text-muted">{s.label}</span>
              <span
                className="text-[10px] font-semibold"
                style={{ color: s.color }}
              >
                {s.value}
              </span>
            </div>
            <div className="h-1.5 bg-surface rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: s.color }}
                initial={{ width: 0 }}
                animate={isInView ? { width: s.width } : { width: 0 }}
                transition={{
                  delay: i * 0.15,
                  duration: 0.8,
                  ease: "easeOut",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] text-emerald-400 font-semibold">
          Activa · 24/7
        </span>
      </div>
    </div>
  );
}
