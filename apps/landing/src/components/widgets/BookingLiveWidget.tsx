"use client";

import { motion } from "motion/react";

interface BookingLiveWidgetProps {
  active: boolean;
  color: string;
  verticalSlug: string;
}

export function BookingLiveWidget({ active, color, verticalSlug }: BookingLiveWidgetProps) {
  const getSlotDetails = () => {
    switch (verticalSlug) {
      case "salud":
        return { time: "09:00 AM", title: "Cita Dental - Sofía", desc: "Dr. Mendoza" };
      case "restaurantes":
        return { time: "08:30 PM", title: "Mesa 4 - Luca (2p)", desc: "Confirmado por Chat" };
      case "inmobiliaria":
        return { time: "10:30 AM", title: "Visita Apto Chapinero", desc: "Asesor Carlos" };
      case "belleza":
        return { time: "10:00 AM", title: "Balayage - Camila", desc: "Especialista Luna" };
      case "gimnasios":
        return { time: "10:00 AM", title: "Clase de Prueba - Coach", desc: "Tour Completo" };
      case "turismo":
        return { time: "09:00 AM", title: "Tour Cartagena (2p)", desc: "Maya Guides" };
      case "educacion":
        return { time: "04:00 PM", title: "Prueba Nivel Inglés", desc: "Evaluador Ana" };
      case "seguros":
        return { time: "11:00 AM", title: "Llamada Cotización", desc: "Roberto Seguros" };
      default:
        return { time: "09:00 AM", title: "Cita Confirmada", desc: "Agente IA Parallly" };
    }
  };

  const slot = getSlotDetails();

  const slots = [
    { time: "08:00 AM", label: "Disponible", isBooked: false },
    { time: slot.time, label: active ? slot.title : "Disponible", isBooked: active },
    { time: "10:00 AM", label: "Reunión de Equipo", isBooked: false, isBusy: true },
    { time: "11:30 AM", label: "Disponible", isBooked: false },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
      className="glass-card w-[200px] p-3.5 rounded-xl border border-white/10 shadow-2xl relative overflow-hidden text-left"
    >
      <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] uppercase font-bold tracking-wider text-text-secondary">
            Calendario
          </span>
        </div>
        <span className="text-[9px] text-text-muted font-mono font-medium">Hoy</span>
      </div>

      <div className="space-y-2">
        {slots.map((s, index) => {
          const isSlotActive = s.isBooked && active;
          return (
            <div
              key={index}
              className={`p-2 rounded-lg text-left transition-all duration-300 border flex items-center justify-between ${
                isSlotActive
                  ? "border-transparent text-white"
                  : s.isBusy
                  ? "bg-white/3 border-white/5 text-text-muted"
                  : "bg-white/1 border-white/5 text-text-secondary"
              }`}
              style={isSlotActive ? { backgroundColor: color, boxShadow: `0 0 16px ${color}35` } : {}}
            >
              <div className="min-w-0">
                <p className="text-[9px] font-mono leading-none font-semibold mb-0.5 opacity-80">
                  {s.time}
                </p>
                <p className="text-[10px] font-medium truncate max-w-[120px]">
                  {s.label}
                </p>
              </div>

              {isSlotActive ? (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 10 }}
                  className="w-4 h-4 rounded-full bg-white flex items-center justify-center flex-shrink-0"
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={4}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </motion.div>
              ) : s.isBusy ? (
                <span className="w-1.5 h-1.5 rounded-full bg-white/15 flex-shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/20 flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
