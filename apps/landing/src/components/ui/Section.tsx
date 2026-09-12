"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

interface SectionProps {
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Section({ id, className = "", children }: SectionProps) {
  // Every section on this site slides up as it enters the viewport. For a
  // reader who has asked their system for reduced motion, that is the whole
  // page moving underneath them — so for them the section is simply there.
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      id={id}
      className={`py-20 sm:py-28 px-6 ${className}`}
      initial={reduceMotion ? false : { opacity: 0, y: 40 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </motion.section>
  );
}
