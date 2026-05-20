"use client";

import { motion } from "motion/react";

interface HeroVisualProps {
  className?: string;
}

export function HeroVisual({ className }: HeroVisualProps) {
  // Particle positions
  const particles = [
    { cx: 60, cy: 80, r: 1.5, delay: 0 },
    { cx: 420, cy: 60, r: 1, delay: 0.5 },
    { cx: 100, cy: 320, r: 1.2, delay: 1.2 },
    { cx: 440, cy: 300, r: 1.8, delay: 0.8 },
    { cx: 200, cy: 50, r: 1, delay: 1.5 },
    { cx: 350, cy: 370, r: 1.3, delay: 0.3 },
    { cx: 50, cy: 200, r: 1, delay: 2.0 },
    { cx: 460, cy: 180, r: 1.4, delay: 1.0 },
  ];

  return (
    <svg
      viewBox="0 0 500 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        {/* Central hub glow */}
        <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3897f0" stopOpacity="0.4" />
          <stop offset="60%" stopColor="#3897f0" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#3897f0" stopOpacity="0" />
        </radialGradient>

        {/* Instagram gradient */}
        <linearGradient id="igGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E4405F" />
          <stop offset="100%" stopColor="#C13584" />
        </linearGradient>

        {/* Card shadow filter */}
        <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.4" />
        </filter>

        {/* Hub ring glow */}
        <filter id="ringGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
        </filter>
      </defs>

      {/* Background subtle grid dots */}
      {Array.from({ length: 8 }).map((_, row) =>
        Array.from({ length: 10 }).map((_, col) => (
          <circle
            key={`grid-${row}-${col}`}
            cx={25 + col * 50}
            cy={25 + row * 50}
            r="0.8"
            fill="#3897f0"
            opacity="0.08"
          />
        ))
      )}

      {/* Floating particles */}
      {particles.map((p, i) => (
        <motion.circle
          key={`particle-${i}`}
          cx={p.cx}
          cy={p.cy}
          r={p.r}
          fill="#3897f0"
          initial={{ opacity: 0.1 }}
          animate={{
            opacity: [0.1, 0.6, 0.1],
            cy: [p.cy, p.cy - 12, p.cy],
          }}
          transition={{
            duration: 3,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Connection lines — dashed, animated */}
      {/* WhatsApp card to center */}
      <motion.line
        x1="120" y1="110" x2="230" y2="190"
        stroke="#25D366"
        strokeWidth="1"
        strokeDasharray="4 4"
        strokeOpacity="0.4"
        initial={{ pathLength: 0 }}
        animate={{ strokeDashoffset: [0, -16] }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
      />

      {/* Instagram card to center */}
      <motion.line
        x1="380" y1="95" x2="280" y2="185"
        stroke="#E4405F"
        strokeWidth="1"
        strokeDasharray="4 4"
        strokeOpacity="0.4"
        initial={{ pathLength: 0 }}
        animate={{ strokeDashoffset: [0, -16] }}
        transition={{ duration: 2, delay: 0.4, repeat: Infinity, ease: "linear" }}
      />

      {/* Messenger card to center */}
      <motion.line
        x1="110" y1="310" x2="225" y2="225"
        stroke="#0084FF"
        strokeWidth="1"
        strokeDasharray="4 4"
        strokeOpacity="0.4"
        initial={{ pathLength: 0 }}
        animate={{ strokeDashoffset: [0, -16] }}
        transition={{ duration: 2, delay: 0.8, repeat: Infinity, ease: "linear" }}
      />

      {/* Telegram card to center */}
      <motion.line
        x1="395" y1="310" x2="280" y2="225"
        stroke="#0088CC"
        strokeWidth="1"
        strokeDasharray="4 4"
        strokeOpacity="0.4"
        initial={{ pathLength: 0 }}
        animate={{ strokeDashoffset: [0, -16] }}
        transition={{ duration: 2, delay: 1.2, repeat: Infinity, ease: "linear" }}
      />

      {/* Data pulse dots traveling along lines */}
      <motion.circle
        r="2.5"
        fill="#25D366"
        initial={{ opacity: 0 }}
        animate={{
          cx: [120, 175, 230],
          cy: [110, 150, 190],
          opacity: [0, 1, 0],
        }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.circle
        r="2.5"
        fill="#E4405F"
        initial={{ opacity: 0 }}
        animate={{
          cx: [380, 330, 280],
          cy: [95, 140, 185],
          opacity: [0, 1, 0],
        }}
        transition={{ duration: 2, delay: 0.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.circle
        r="2.5"
        fill="#0084FF"
        initial={{ opacity: 0 }}
        animate={{
          cx: [110, 167, 225],
          cy: [310, 267, 225],
          opacity: [0, 1, 0],
        }}
        transition={{ duration: 2, delay: 1.0, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.circle
        r="2.5"
        fill="#0088CC"
        initial={{ opacity: 0 }}
        animate={{
          cx: [395, 337, 280],
          cy: [310, 267, 225],
          opacity: [0, 1, 0],
        }}
        transition={{ duration: 2, delay: 1.5, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* ===== Central AI Hub ===== */}
      {/* Outer pulsing glow */}
      <motion.circle
        cx="250"
        cy="205"
        r="60"
        fill="url(#hubGlow)"
        animate={{ r: [55, 65, 55], opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Outer ring */}
      <motion.circle
        cx="250"
        cy="205"
        r="42"
        fill="none"
        stroke="#3897f0"
        strokeWidth="1"
        strokeOpacity="0.3"
        filter="url(#ringGlow)"
        animate={{ r: [40, 44, 40] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Core circle */}
      <circle cx="250" cy="205" r="32" fill="#0c0c0f" stroke="#3897f0" strokeWidth="1.5" strokeOpacity="0.6" />

      {/* AI brain icon — simple neural pattern */}
      <motion.circle cx="250" cy="198" r="4" fill="#3897f0" opacity="0.9"
        animate={{ scale: [1, 1.15, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <circle cx="240" cy="210" r="2.5" fill="#3897f0" opacity="0.7" />
      <circle cx="260" cy="210" r="2.5" fill="#3897f0" opacity="0.7" />
      <circle cx="245" cy="220" r="2" fill="#3897f0" opacity="0.5" />
      <circle cx="255" cy="220" r="2" fill="#3897f0" opacity="0.5" />
      {/* Neural connections */}
      <line x1="250" y1="198" x2="240" y2="210" stroke="#3897f0" strokeWidth="0.8" opacity="0.5" />
      <line x1="250" y1="198" x2="260" y2="210" stroke="#3897f0" strokeWidth="0.8" opacity="0.5" />
      <line x1="240" y1="210" x2="245" y2="220" stroke="#3897f0" strokeWidth="0.6" opacity="0.4" />
      <line x1="260" y1="210" x2="255" y2="220" stroke="#3897f0" strokeWidth="0.6" opacity="0.4" />
      <line x1="240" y1="210" x2="260" y2="210" stroke="#3897f0" strokeWidth="0.6" opacity="0.3" />

      {/* ===== Floating Channel Cards ===== */}

      {/* WhatsApp Card — top left */}
      <motion.g
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: [0, -6, 0] }}
        transition={{ duration: 4, delay: 0.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <rect x="60" y="65" width="100" height="60" rx="8" fill="#0f1012" stroke="#25D366" strokeWidth="1" strokeOpacity="0.4" filter="url(#cardShadow)" />
        {/* WA icon circle */}
        <circle cx="85" cy="85" r="10" fill="#25D366" opacity="0.15" />
        <circle cx="85" cy="85" r="5" fill="#25D366" opacity="0.8" />
        {/* Fake text lines */}
        <rect x="100" y="79" width="45" height="3" rx="1.5" fill="#25D366" opacity="0.3" />
        <rect x="100" y="87" width="35" height="3" rx="1.5" fill="#25D366" opacity="0.15" />
        {/* Status indicator */}
        <circle cx="150" cy="75" r="3" fill="#25D366" opacity="0.6" />
      </motion.g>

      {/* Instagram Card — top right */}
      <motion.g
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: [0, -8, 0] }}
        transition={{ duration: 4.5, delay: 0.5, repeat: Infinity, ease: "easeInOut" }}
      >
        <rect x="330" y="50" width="100" height="60" rx="8" fill="#0f1012" stroke="#E4405F" strokeWidth="1" strokeOpacity="0.4" filter="url(#cardShadow)" />
        <circle cx="355" cy="72" r="10" fill="url(#igGradient)" opacity="0.15" />
        <circle cx="355" cy="72" r="5" fill="url(#igGradient)" opacity="0.8" />
        <rect x="370" y="66" width="45" height="3" rx="1.5" fill="#E4405F" opacity="0.3" />
        <rect x="370" y="74" width="35" height="3" rx="1.5" fill="#E4405F" opacity="0.15" />
        <circle cx="420" cy="60" r="3" fill="#C13584" opacity="0.6" />
      </motion.g>

      {/* Messenger Card — bottom left */}
      <motion.g
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: [0, 6, 0] }}
        transition={{ duration: 4.2, delay: 0.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <rect x="50" y="280" width="100" height="60" rx="8" fill="#0f1012" stroke="#0084FF" strokeWidth="1" strokeOpacity="0.4" filter="url(#cardShadow)" />
        <circle cx="75" cy="302" r="10" fill="#0084FF" opacity="0.15" />
        <circle cx="75" cy="302" r="5" fill="#0084FF" opacity="0.8" />
        <rect x="90" y="296" width="45" height="3" rx="1.5" fill="#0084FF" opacity="0.3" />
        <rect x="90" y="304" width="35" height="3" rx="1.5" fill="#0084FF" opacity="0.15" />
        <circle cx="140" cy="290" r="3" fill="#0084FF" opacity="0.6" />
      </motion.g>

      {/* Telegram Card — bottom right */}
      <motion.g
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: [0, 7, 0] }}
        transition={{ duration: 3.8, delay: 1.0, repeat: Infinity, ease: "easeInOut" }}
      >
        <rect x="345" y="275" width="100" height="60" rx="8" fill="#0f1012" stroke="#0088CC" strokeWidth="1" strokeOpacity="0.4" filter="url(#cardShadow)" />
        <circle cx="370" cy="297" r="10" fill="#0088CC" opacity="0.15" />
        <circle cx="370" cy="297" r="5" fill="#0088CC" opacity="0.8" />
        <rect x="385" y="291" width="45" height="3" rx="1.5" fill="#0088CC" opacity="0.3" />
        <rect x="385" y="299" width="35" height="3" rx="1.5" fill="#0088CC" opacity="0.15" />
        <circle cx="435" cy="285" r="3" fill="#0088CC" opacity="0.6" />
      </motion.g>

      {/* Orbiting accent ring */}
      <motion.circle
        cx="250"
        cy="205"
        r="85"
        fill="none"
        stroke="#3897f0"
        strokeWidth="0.5"
        strokeDasharray="3 8"
        strokeOpacity="0.2"
        animate={{ rotate: 360 }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        style={{ transformOrigin: "250px 205px" }}
      />
    </svg>
  );
}
