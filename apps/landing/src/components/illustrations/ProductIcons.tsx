"use client";

import { motion } from "motion/react";

/* ================================================================
   AgentIcon — Neural network / brain
   ================================================================ */
export function AgentIcon({ className }: { className?: string }) {
  // Node positions for neural network
  const nodes = [
    // Center
    { cx: 100, cy: 100, r: 10, color: "#a855f7", delay: 0 },
    // Inner ring
    { cx: 70, cy: 72, r: 5, color: "#a855f7", delay: 0.1 },
    { cx: 130, cy: 72, r: 5, color: "#3897f0", delay: 0.15 },
    { cx: 65, cy: 115, r: 5, color: "#3897f0", delay: 0.2 },
    { cx: 135, cy: 115, r: 5, color: "#a855f7", delay: 0.25 },
    { cx: 100, cy: 140, r: 5, color: "#3897f0", delay: 0.3 },
    { cx: 100, cy: 60, r: 5, color: "#a855f7", delay: 0.12 },
    // Outer ring
    { cx: 45, cy: 55, r: 3.5, color: "#a855f7", delay: 0.35 },
    { cx: 155, cy: 55, r: 3.5, color: "#3897f0", delay: 0.4 },
    { cx: 40, cy: 130, r: 3.5, color: "#3897f0", delay: 0.45 },
    { cx: 160, cy: 130, r: 3.5, color: "#a855f7", delay: 0.5 },
    { cx: 100, cy: 165, r: 3.5, color: "#a855f7", delay: 0.55 },
    { cx: 60, cy: 160, r: 3.5, color: "#3897f0", delay: 0.52 },
    { cx: 140, cy: 160, r: 3.5, color: "#3897f0", delay: 0.48 },
  ];

  // Connections from center to inner, inner to outer
  const connections = [
    // Center to inner
    { x1: 100, y1: 100, x2: 70, y2: 72 },
    { x1: 100, y1: 100, x2: 130, y2: 72 },
    { x1: 100, y1: 100, x2: 65, y2: 115 },
    { x1: 100, y1: 100, x2: 135, y2: 115 },
    { x1: 100, y1: 100, x2: 100, y2: 140 },
    { x1: 100, y1: 100, x2: 100, y2: 60 },
    // Inner to outer
    { x1: 70, y1: 72, x2: 45, y2: 55 },
    { x1: 130, y1: 72, x2: 155, y2: 55 },
    { x1: 65, y1: 115, x2: 40, y2: 130 },
    { x1: 135, y1: 115, x2: 160, y2: 130 },
    { x1: 100, y1: 140, x2: 100, y2: 165 },
    { x1: 100, y1: 140, x2: 60, y2: 160 },
    { x1: 100, y1: 140, x2: 140, y2: 160 },
    // Cross connections
    { x1: 70, y1: 72, x2: 100, y2: 60 },
    { x1: 130, y1: 72, x2: 100, y2: 60 },
    { x1: 65, y1: 115, x2: 100, y2: 140 },
    { x1: 135, y1: 115, x2: 100, y2: 140 },
  ];

  // Pulse paths — dots traveling along connections
  const pulses = [
    { x1: 100, y1: 100, x2: 45, y2: 55, mid: { x: 70, y: 72 }, delay: 0, color: "#a855f7" },
    { x1: 100, y1: 100, x2: 160, y2: 130, mid: { x: 135, y: 115 }, delay: 1.2, color: "#3897f0" },
    { x1: 100, y1: 100, x2: 100, y2: 165, mid: { x: 100, y: 140 }, delay: 2.4, color: "#a855f7" },
  ];

  return (
    <motion.svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
    >
      <defs>
        <radialGradient id="agentGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a855f7" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Background glow */}
      <circle cx="100" cy="110" r="80" fill="url(#agentGlow)" />

      {/* Connection lines */}
      {connections.map((c, i) => (
        <motion.line
          key={`conn-${i}`}
          x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
          stroke="#a855f7"
          strokeWidth="0.8"
          strokeOpacity="0.2"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 + i * 0.03 }}
        />
      ))}

      {/* Nodes */}
      {nodes.map((n, i) => (
        <motion.circle
          key={`node-${i}`}
          cx={n.cx} cy={n.cy} r={n.r}
          fill={n.color}
          fillOpacity={i === 0 ? 0.9 : 0.6}
          initial={{ scale: 0, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: n.delay, type: "spring", stiffness: 200 }}
          style={{ transformOrigin: `${n.cx}px ${n.cy}px` }}
        />
      ))}

      {/* Central node pulsing ring */}
      <motion.circle
        cx="100" cy="100" r="14"
        fill="none"
        stroke="#a855f7"
        strokeWidth="1"
        strokeOpacity="0.3"
        animate={{ r: [14, 18, 14], opacity: [0.3, 0.1, 0.3] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Traveling pulses */}
      {pulses.map((p, i) => (
        <motion.circle
          key={`pulse-${i}`}
          r="2.5"
          fill={p.color}
          initial={{ opacity: 0 }}
          animate={{
            cx: [p.x1, p.mid.x, p.x2],
            cy: [p.y1, p.mid.y, p.y2],
            opacity: [0, 0.9, 0],
          }}
          transition={{
            duration: 2,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </motion.svg>
  );
}

/* ================================================================
   ChannelsIcon — Chat bubbles merging into one
   ================================================================ */
export function ChannelsIcon({ className }: { className?: string }) {
  const channels = [
    { cx: 55, cy: 55, color: "#25D366", label: "WA" },
    { cx: 145, cy: 55, color: "#E4405F", label: "IG" },
    { cx: 55, cy: 130, color: "#0084FF", label: "FB" },
    { cx: 145, cy: 130, color: "#0088CC", label: "TG" },
  ];

  return (
    <motion.svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
    >
      <defs>
        <radialGradient id="channelGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3897f0" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#3897f0" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="100" cy="100" r="85" fill="url(#channelGlow)" />

      {/* Flow lines from small bubbles to center */}
      {channels.map((ch, i) => (
        <motion.line
          key={`flow-${i}`}
          x1={ch.cx} y1={ch.cy} x2="100" y2="100"
          stroke={ch.color}
          strokeWidth="1"
          strokeDasharray="3 3"
          strokeOpacity="0.3"
          animate={{ strokeDashoffset: [0, -12] }}
          transition={{ duration: 1.5, delay: i * 0.2, repeat: Infinity, ease: "linear" }}
        />
      ))}

      {/* Flow dots */}
      {channels.map((ch, i) => (
        <motion.circle
          key={`flowdot-${i}`}
          r="2"
          fill={ch.color}
          initial={{ opacity: 0 }}
          animate={{
            cx: [ch.cx, (ch.cx + 100) / 2, 100],
            cy: [ch.cy, (ch.cy + 100) / 2, 100],
            opacity: [0, 0.8, 0],
          }}
          transition={{
            duration: 1.8,
            delay: i * 0.4,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Small channel bubbles */}
      {channels.map((ch, i) => (
        <motion.g
          key={`bubble-${i}`}
          initial={{ scale: 0, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.1 + i * 0.1, type: "spring", stiffness: 180 }}
          style={{ transformOrigin: `${ch.cx}px ${ch.cy}px` }}
        >
          {/* Bubble shape */}
          <circle cx={ch.cx} cy={ch.cy} r="20" fill="#0f1012" stroke={ch.color} strokeWidth="1.2" strokeOpacity="0.5" />
          <circle cx={ch.cx} cy={ch.cy} r="20" fill={ch.color} fillOpacity="0.08" />
          {/* Inner dot */}
          <circle cx={ch.cx} cy={ch.cy} r="6" fill={ch.color} fillOpacity="0.7" />
          {/* Bubble tail */}
          <path
            d={`M${ch.cx + (ch.cx < 100 ? 12 : -12)},${ch.cy + (ch.cy < 100 ? 12 : -12)} l${ch.cx < 100 ? 6 : -6},${ch.cy < 100 ? 6 : -6} l${ch.cx < 100 ? -8 : 8},0 Z`}
            fill="#0f1012"
            stroke={ch.color}
            strokeWidth="1"
            strokeOpacity="0.3"
          />
        </motion.g>
      ))}

      {/* Central merged bubble */}
      <motion.g
        initial={{ scale: 0 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.5, type: "spring", stiffness: 150 }}
        style={{ transformOrigin: "100px 100px" }}
      >
        <circle cx="100" cy="100" r="28" fill="#0f1012" stroke="#3897f0" strokeWidth="1.5" strokeOpacity="0.6" />
        <circle cx="100" cy="100" r="28" fill="#3897f0" fillOpacity="0.06" />

        {/* Pulsing ring */}
        <motion.circle
          cx="100" cy="100" r="32"
          fill="none"
          stroke="#3897f0"
          strokeWidth="1"
          strokeOpacity="0.2"
          animate={{ r: [32, 38, 32], opacity: [0.2, 0.05, 0.2] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Parallly "P" abstract — three horizontal bars */}
        <rect x="90" y="88" width="20" height="2.5" rx="1" fill="#3897f0" opacity="0.8" />
        <rect x="90" y="96" width="15" height="2.5" rx="1" fill="#3897f0" opacity="0.6" />
        <rect x="90" y="104" width="18" height="2.5" rx="1" fill="#3897f0" opacity="0.7" />
      </motion.g>
    </motion.svg>
  );
}

/* ================================================================
   BookingIcon — Calendar with clock
   ================================================================ */
export function BookingIcon({ className }: { className?: string }) {
  // Calendar grid cells (4x4 for dates)
  const cells: { x: number; y: number; filled: boolean }[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      cells.push({
        x: 52 + col * 22,
        y: 82 + row * 20,
        filled: row === 1 && col === 2, // The "selected" date
      });
    }
  }

  return (
    <motion.svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
    >
      <defs>
        <radialGradient id="bookGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3897f0" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#3897f0" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="100" cy="105" r="85" fill="url(#bookGlow)" />

      {/* Calendar body */}
      <motion.g
        initial={{ y: 15, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        {/* Calendar outline */}
        <rect x="40" y="55" width="105" height="110" rx="8" fill="#0f1012" stroke="#3897f0" strokeWidth="1.2" strokeOpacity="0.4" />

        {/* Calendar header bar */}
        <rect x="40" y="55" width="105" height="22" rx="8" fill="#3897f0" fillOpacity="0.12" />
        <rect x="40" y="69" width="105" height="8" fill="#0f1012" />

        {/* Calendar binding dots */}
        <circle cx="65" cy="55" r="3" fill="#0f1012" stroke="#3897f0" strokeWidth="1" strokeOpacity="0.5" />
        <circle cx="92" cy="55" r="3" fill="#0f1012" stroke="#3897f0" strokeWidth="1" strokeOpacity="0.5" />
        <circle cx="119" cy="55" r="3" fill="#0f1012" stroke="#3897f0" strokeWidth="1" strokeOpacity="0.5" />

        {/* Grid cells */}
        {cells.map((cell, i) => (
          <motion.rect
            key={`cell-${i}`}
            x={cell.x}
            y={cell.y}
            width="16"
            height="14"
            rx="3"
            fill={cell.filled ? "#3897f0" : "#3897f0"}
            fillOpacity={cell.filled ? 0.25 : 0.04}
            stroke={cell.filled ? "#3897f0" : "transparent"}
            strokeWidth={cell.filled ? 1 : 0}
            strokeOpacity={0.5}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: 0.3 + i * 0.02 }}
          />
        ))}

        {/* Checkmark on selected date */}
        <motion.path
          d="M93,102 l3,3 l6,-6"
          stroke="#10b981"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.8 }}
        />
      </motion.g>

      {/* Clock overlay — bottom right */}
      <motion.g
        initial={{ scale: 0, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: 0.6, type: "spring", stiffness: 180 }}
        style={{ transformOrigin: "145px 140px" }}
      >
        {/* Clock background */}
        <circle cx="145" cy="140" r="26" fill="#0f1012" stroke="#3897f0" strokeWidth="1.2" strokeOpacity="0.5" />
        <circle cx="145" cy="140" r="26" fill="#3897f0" fillOpacity="0.05" />

        {/* Hour marks */}
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((angle, i) => {
          const rad = (angle * Math.PI) / 180;
          const x1 = 145 + Math.sin(rad) * 20;
          const y1 = 140 - Math.cos(rad) * 20;
          const x2 = 145 + Math.sin(rad) * 22;
          const y2 = 140 - Math.cos(rad) * 22;
          return (
            <line key={`tick-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3897f0" strokeWidth="1" strokeOpacity="0.3" />
          );
        })}

        {/* Clock center dot */}
        <circle cx="145" cy="140" r="2" fill="#3897f0" opacity="0.8" />

        {/* Hour hand */}
        <motion.line
          x1="145" y1="140" x2="145" y2="126"
          stroke="#3897f0"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeOpacity="0.7"
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: "145px 140px" }}
        />

        {/* Minute hand */}
        <motion.line
          x1="145" y1="140" x2="156" y2="133"
          stroke="#3897f0"
          strokeWidth="1"
          strokeLinecap="round"
          strokeOpacity="0.5"
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: "145px 140px" }}
        />
      </motion.g>

      {/* Emerald accent dot */}
      <motion.circle
        cx="152" cy="108"
        r="4"
        fill="#10b981"
        fillOpacity="0.6"
        animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0.9, 0.6] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "152px 108px" }}
      />
    </motion.svg>
  );
}

/* ================================================================
   CrmIcon — Funnel / pipeline with flowing dots
   ================================================================ */
export function CrmIcon({ className }: { className?: string }) {
  // Pipeline column positions
  const columns = [
    { x: 30, width: 35, height: 130, color: "#f59e0b", label: "1", dots: 4 },
    { x: 72, width: 35, height: 105, color: "#f59e0b", label: "2", dots: 3 },
    { x: 114, width: 35, height: 80, color: "#3897f0", label: "3", dots: 2 },
    { x: 156, width: 35, height: 55, color: "#3897f0", label: "4", dots: 1 },
  ];

  return (
    <motion.svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
    >
      <defs>
        <linearGradient id="funnelGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#3897f0" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      {/* Background funnel shape */}
      <motion.path
        d="M25,45 L175,45 L170,170 L30,170 Z"
        fill="url(#funnelGrad)"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      />

      {/* Column containers */}
      {columns.map((col, i) => (
        <motion.g
          key={`col-${i}`}
          initial={{ y: 20, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.15 + i * 0.1 }}
        >
          {/* Column background */}
          <rect
            x={col.x}
            y={170 - col.height}
            width={col.width}
            height={col.height}
            rx="6"
            fill="#0f1012"
            stroke={col.color}
            strokeWidth="1"
            strokeOpacity="0.3"
          />

          {/* Column header */}
          <rect
            x={col.x}
            y={170 - col.height}
            width={col.width}
            height="16"
            rx="6"
            fill={col.color}
            fillOpacity="0.12"
          />
          {/* Flat bottom of header */}
          <rect
            x={col.x}
            y={170 - col.height + 10}
            width={col.width}
            height="6"
            fill={col.color}
            fillOpacity="0.12"
          />

          {/* Dots (representing items) in each column */}
          {Array.from({ length: col.dots }).map((_, j) => (
            <motion.circle
              key={`dot-${i}-${j}`}
              cx={col.x + col.width / 2}
              cy={170 - col.height + 30 + j * 22}
              r="6"
              fill={col.color}
              fillOpacity={0.2 + j * 0.05}
              stroke={col.color}
              strokeWidth="0.8"
              strokeOpacity="0.3"
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: 0.4 + i * 0.1 + j * 0.06, type: "spring", stiffness: 200 }}
              style={{ transformOrigin: `${col.x + col.width / 2}px ${170 - col.height + 30 + j * 22}px` }}
            />
          ))}
        </motion.g>
      ))}

      {/* Animated dot moving through the pipeline */}
      <motion.circle
        r="4"
        fill="#f59e0b"
        initial={{ opacity: 0 }}
        animate={{
          cx: [47, 89, 131, 173],
          cy: [65, 82, 104, 130],
          opacity: [0, 0.9, 0.9, 0],
          fill: ["#f59e0b", "#f59e0b", "#3897f0", "#3897f0"],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
          times: [0, 0.33, 0.66, 1],
        }}
      />

      {/* Second traveling dot, offset */}
      <motion.circle
        r="3"
        fill="#f59e0b"
        initial={{ opacity: 0 }}
        animate={{
          cx: [47, 89, 131, 173],
          cy: [80, 95, 115, 140],
          opacity: [0, 0.7, 0.7, 0],
          fill: ["#f59e0b", "#f59e0b", "#3897f0", "#3897f0"],
        }}
        transition={{
          duration: 3,
          delay: 1.5,
          repeat: Infinity,
          ease: "easeInOut",
          times: [0, 0.33, 0.66, 1],
        }}
      />

      {/* Arrow indicators between columns */}
      {[0, 1, 2].map((i) => {
        const fromX = columns[i].x + columns[i].width + 2;
        const toX = columns[i + 1].x - 2;
        const midX = (fromX + toX) / 2;
        const y = 170 - Math.min(columns[i].height, columns[i + 1].height) / 2;
        return (
          <motion.g
            key={`arrow-${i}`}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 0.3 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: 0.6 + i * 0.1 }}
          >
            <line x1={fromX} y1={y} x2={toX - 2} y2={y} stroke="#ffffff" strokeWidth="0.8" />
            <path d={`M${toX - 5},${y - 3} L${toX - 1},${y} L${toX - 5},${y + 3}`} stroke="#ffffff" strokeWidth="0.8" fill="none" />
          </motion.g>
        );
      })}

      {/* Conversion percentage labels */}
      <motion.text
        x="100"
        y="185"
        textAnchor="middle"
        fill="#f59e0b"
        fontSize="10"
        fontFamily="monospace"
        opacity="0.4"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 0.4 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.8 }}
      >
        {"100% → 75% → 50% → 25%"}
      </motion.text>
    </motion.svg>
  );
}
