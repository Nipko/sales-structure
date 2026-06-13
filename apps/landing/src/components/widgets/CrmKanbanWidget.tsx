"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";

interface CrmKanbanWidgetProps {
  active: boolean;
  color: string;
  verticalSlug: string;
  step: number;
}

export function CrmKanbanWidget({ active, color, verticalSlug, step }: CrmKanbanWidgetProps) {
  const t = useTranslations("widgets");
  const L = (k: string, fb: string) => (t.has(k) ? t(k) : fb);

  const getCustomerName = () => {
    switch (verticalSlug) {
      case "salud":
      case "belleza":
        return L("crm.nameSalud", "Camila Restrepo");
      case "restaurantes":
        return L("crm.nameRestaurantes", "Santiago Restrepo");
      case "inmobiliaria":
        return L("crm.nameInmobiliaria", "Mateo Gómez");
      case "turismo":
        return L("crm.nameTurismo", "Sofía Silva");
      default:
        return L("crm.nameDefault", "Juan Pérez");
    }
  };

  const name = getCustomerName();

  // Dynamic values depending on step
  let score = 25;
  let status = L("crm.statusEntrante", "Entrante");
  let statusColor = "rgba(255, 255, 255, 0.4)";

  if (step === 2) {
    score = 55;
    status = L("crm.statusInteresado", "Interesado");
    statusColor = "rgba(56, 151, 240, 0.6)"; // Meta blue
  } else if (step >= 3) {
    score = active ? 95 : 75;
    status = active
      ? L("crm.statusCitaAgendada", "Cita Agendada")
      : L("crm.statusCalificado", "Calificado");
    statusColor = active ? color : "rgba(16, 185, 129, 0.8)"; // Success green
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
      className="glass-card w-[210px] p-3.5 rounded-xl border border-white/10 shadow-2xl relative overflow-hidden text-left"
    >
      <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <span className="text-[10px] uppercase font-bold tracking-wider text-text-secondary">
            Parallly CRM
          </span>
        </div>
        <span
          className="text-[8px] px-1.5 py-0.5 rounded font-semibold transition-all duration-300"
          style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
        >
          {status}
        </span>
      </div>

      <div className="space-y-3">
        {/* Lead card detail */}
        <div>
          <h4 className="text-[11px] font-bold text-white leading-tight mb-0.5">
            {name}
          </h4>
          <p className="text-[9px] text-text-muted font-mono leading-none">
            +57 312 456 7890
          </p>
        </div>

        {/* Dynamic scoring indicator */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[8px] font-semibold text-text-secondary">
            <span>{L("crm.scoreLabel", "Score de Lead")}</span>
            <motion.span
              key={score}
              initial={{ scale: 0.8, opacity: 0.5 }}
              animate={{ scale: 1, opacity: 1 }}
              className="font-mono"
              style={{ color }}
            >
              {score}/100
            </motion.span>
          </div>
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              initial={{ width: "25%" }}
              animate={{ width: `${score}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 15 }}
              style={{
                backgroundColor: color,
                boxShadow: `0 0 8px ${color}`,
              }}
            />
          </div>
        </div>

        {/* AI Insight message */}
        <div className="bg-white/2 border border-white/5 rounded p-2 text-[9px] text-text-secondary leading-relaxed">
          <span className="text-text-muted font-bold block mb-0.5 uppercase tracking-wider text-[7px]">
            AI Insight
          </span>
          {step <= 1
            ? L("crm.insightWaiting", "Esperando datos...")
            : step === 2
            ? L("crm.insightInterested", "Interés alto en agenda")
            : active
            ? L("crm.insightConfirmed", "Cita confirmada en Google Calendar, enviando recordatorio")
            : L("crm.insightPending", "Datos recolectados, agendamiento pendiente")}
        </div>
      </div>
    </motion.div>
  );
}
