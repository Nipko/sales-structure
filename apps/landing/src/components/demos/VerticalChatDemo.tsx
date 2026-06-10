"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, useInView } from "motion/react";
import { useTranslations } from "next-intl";
import { CHANNELS } from "../../data/channels";
import type { VerticalDef } from "../../data/verticals";

interface VerticalChatDemoProps {
  vertical: VerticalDef;
  onStepChange?: (step: number) => void;
}

export function VerticalChatDemo({ vertical, onStepChange }: VerticalChatDemoProps) {
  const t = useTranslations("verticals");
  const skin = CHANNELS[vertical.channel];
  const [visibleCount, setVisibleCount] = useState(0);
  const [cycle, setCycle] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });

  const runAnimation = useCallback(() => {
    setVisibleCount(0);
    if (onStepChange) onStepChange(0);
    const total = vertical.demoMessages.length;
    const showNext = (i: number) => {
      if (i > total) {
        if (onStepChange) onStepChange(total + 1);
        timerRef.current = setTimeout(() => setCycle((c) => c + 1), 3500);
        return;
      }
      timerRef.current = setTimeout(
        () => {
          setVisibleCount(i);
          if (onStepChange) onStepChange(i);
          showNext(i + 1);
        },
        i === 1 ? 200 : 1500, // slower cadence for realistic reading speed
      );
    };
    showNext(1);
  }, [vertical.demoMessages.length, onStepChange]);

  useEffect(() => {
    if (!isInView) return;
    runAnimation();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cycle, runAnimation, isInView, vertical.slug]);

  return (
    <div
      ref={ref}
      className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xl w-full"
      style={{ boxShadow: `0 0 24px ${vertical.glow}` }}
    >
      {/* Channel-skinned header */}
      <div
        className="px-4 py-3 flex items-center gap-3"
        style={{ background: skin.headerBg }}
      >
        <div className="w-9 h-9 rounded-full bg-white/25 flex items-center justify-center text-lg backdrop-blur-sm">
          {vertical.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">
            {vertical.slug}
          </p>
          <p className="text-white/80 text-[11px]">
            {skin.statusText} · {t("demoRespondsIn", { defaultValue: "responde en segundos" })}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-white text-[10px] font-semibold tracking-wide">
            IA
          </span>
        </div>
        {skin.logoSrc && (
          <img
            src={skin.logoSrc}
            alt={skin.name}
            className="w-5 h-5 ml-1 opacity-90"
          />
        )}
      </div>

      {/* Body -- channel-themed background */}
      <div
        className="p-4 min-h-[320px] flex flex-col gap-2"
        style={{ backgroundColor: skin.bodyBg }}
      >
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
                  {t(`${vertical.slug}.demo${i + 1}`, { defaultValue: msg.text })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        ))}
      </div>

      {/* Footer -- Channel + response time badge */}
      <div className="bg-surface border-t border-border px-3 py-2 flex items-center justify-between gap-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: skin.accent }}
        >
          {skin.name}
        </span>
        <div className="flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke={vertical.color}
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"
            />
          </svg>
          <span
            className="text-[11px] font-medium"
            style={{ color: vertical.color }}
          >
            {t("demoRespondedIn", { defaultValue: "Respondió en 3 segundos" })}
          </span>
        </div>
      </div>
    </div>
  );
}
