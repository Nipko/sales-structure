"use client";

import { motion } from "motion/react";

interface VerticalIconProps {
  color: string;
  emoji: string;
  className?: string;
}

export function VerticalIcon({ color, emoji, className }: VerticalIconProps) {
  // Generate concentric ring radii
  const rings = [48, 40, 32];

  // Grid dot positions (arranged in a honeycomb-like pattern)
  const dots: { cx: number; cy: number; delay: number }[] = [];
  for (let row = -2; row <= 2; row++) {
    for (let col = -2; col <= 2; col++) {
      const offsetX = row % 2 === 0 ? 0 : 6;
      const cx = 60 + col * 12 + offsetX;
      const cy = 60 + row * 10;
      const dist = Math.sqrt((cx - 60) ** 2 + (cy - 60) ** 2);
      if (dist < 30) {
        dots.push({ cx, cy, delay: dist * 0.02 });
      }
    }
  }

  return (
    <motion.svg
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      initial={{ opacity: 0, scale: 0.8 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <defs>
        {/* Radial gradient from color to transparent */}
        <radialGradient id={`vg-${color.replace("#", "")}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="70%" stopColor={color} stopOpacity="0.05" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Background glow */}
      <circle cx="60" cy="60" r="55" fill={`url(#vg-${color.replace("#", "")})`} />

      {/* Hexagonal frame */}
      <motion.polygon
        points="60,6 105,30 105,90 60,114 15,90 15,30"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeOpacity="0.5"
        initial={{ pathLength: 0, opacity: 0 }}
        whileInView={{ pathLength: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
      />

      {/* Inner hexagon, slightly rotated feeling via scale */}
      <motion.polygon
        points="60,18 96,38 96,82 60,102 24,82 24,38"
        fill="none"
        stroke={color}
        strokeWidth="0.8"
        strokeOpacity="0.2"
        strokeDasharray="3 3"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.5 }}
      />

      {/* Concentric rings */}
      {rings.map((r, i) => (
        <motion.circle
          key={`ring-${i}`}
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="0.5"
          strokeOpacity={0.15 - i * 0.03}
          initial={{ scale: 0.5, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 + i * 0.1 }}
          style={{ transformOrigin: "60px 60px" }}
        />
      ))}

      {/* Grid dots */}
      {dots.map((dot, i) => (
        <motion.circle
          key={`dot-${i}`}
          cx={dot.cx}
          cy={dot.cy}
          r="1.2"
          fill={color}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: [0, 0.5, 0.25] }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 + dot.delay }}
        />
      ))}

      {/* Corner accents on hexagon */}
      <circle cx="60" cy="6" r="2" fill={color} opacity="0.5" />
      <circle cx="105" cy="30" r="2" fill={color} opacity="0.4" />
      <circle cx="105" cy="90" r="2" fill={color} opacity="0.3" />
      <circle cx="60" cy="114" r="2" fill={color} opacity="0.5" />
      <circle cx="15" cy="90" r="2" fill={color} opacity="0.3" />
      <circle cx="15" cy="30" r="2" fill={color} opacity="0.4" />

      {/* Emoji via foreignObject */}
      <foreignObject x="30" y="32" width="60" height="56">
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "32px",
            lineHeight: 1,
          }}
        >
          {emoji}
        </div>
      </foreignObject>
    </motion.svg>
  );
}
