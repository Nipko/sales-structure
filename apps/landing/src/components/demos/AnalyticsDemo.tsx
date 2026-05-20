"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { CountUp } from "../ui/CountUp";

export function AnalyticsDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });
  const bars = [40, 65, 50, 80, 60, 90, 75];

  return (
    <div
      ref={ref}
      className="bg-bg/60 rounded-xl border border-border p-3 h-full"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-text-primary">
          Esta semana
        </span>
        <span className="text-[10px] text-emerald-400 font-bold">↑ 23%</span>
      </div>
      <p className="text-2xl font-bold tabular mb-1">
        {isInView ? <CountUp target={1247} /> : "0"}
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
