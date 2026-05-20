"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Icon } from "./Icon";

interface FAQItemProps {
  question: string;
  answer: string;
  idx: number;
}

export function FAQItem({ question, answer, idx }: FAQItemProps) {
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
