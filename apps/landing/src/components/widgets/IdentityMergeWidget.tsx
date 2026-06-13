"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";

interface IdentityMergeWidgetProps {
  active: boolean;
  color: string;
  verticalSlug: string;
  step: number;
}

export function IdentityMergeWidget({ active, color, verticalSlug, step }: IdentityMergeWidgetProps) {
  const t = useTranslations("widgets");
  const L = (k: string, fb: string) => (t.has(k) ? t(k) : fb);

  const getInitials = () => {
    switch (verticalSlug) {
      case "salud":
      case "belleza":
        return L("identity.initials.salud", "CR");
      case "restaurantes":
        return L("identity.initials.restaurantes", "SR");
      case "inmobiliaria":
        return L("identity.initials.inmobiliaria", "MG");
      case "turismo":
        return L("identity.initials.turismo", "SS");
      default:
        return L("identity.initials.default", "JP");
    }
  };

  const initials = getInitials();
  const hasMerged = step >= 3;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.2 }}
      className="glass-card w-[190px] p-3.5 rounded-xl border border-white/10 shadow-2xl relative overflow-hidden text-left"
    >
      <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="text-[10px] uppercase font-bold tracking-wider text-text-secondary">
            {L("identity.header", "Omnicanalidad")}
          </span>
        </div>
        {hasMerged && (
          <span className="text-[8px] text-emerald-400 font-bold font-mono">{L("identity.mergeOk", "Fusión OK")}</span>
        )}
      </div>

      <div className="flex flex-col items-center py-2.5">
        {/* Avatars area */}
        <div className="relative w-full h-12 flex items-center justify-center mb-3">
          {!hasMerged ? (
            /* Separated state */
            <div className="flex justify-between w-full px-4 items-center">
              {/* WhatsApp avatar */}
              <motion.div
                layoutId="avatar-wa"
                className="w-10 h-10 rounded-full bg-emerald-600/30 border border-emerald-500/50 flex items-center justify-center relative shadow-lg"
              >
                <span className="text-white text-xs font-bold">{initials}</span>
                {/* WA Badge */}
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center border border-surface">
                  <span className="text-[7px] text-white font-bold">W</span>
                </div>
              </motion.div>

              {/* Instagram avatar */}
              <motion.div
                layoutId="avatar-ig"
                className="w-10 h-10 rounded-full bg-pink-600/30 border border-pink-500/50 flex items-center justify-center relative shadow-lg"
              >
                <span className="text-white text-xs font-bold">{initials}</span>
                {/* IG Badge */}
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-pink-500 rounded-full flex items-center justify-center border border-surface">
                  <span className="text-[7px] text-white font-bold">I</span>
                </div>
              </motion.div>
            </div>
          ) : (
            /* Merged state */
            <motion.div
              layoutId="avatar-merged"
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 350, damping: 15 }}
              className="w-11 h-11 rounded-full flex items-center justify-center relative shadow-2xl"
              style={{
                background: `radial-gradient(circle, ${color}25 0%, rgba(255,255,255,0.02) 100%)`,
                border: `1.5px solid ${color}`,
                boxShadow: `0 0 20px ${color}35`,
              }}
            >
              <span className="text-white text-xs font-extrabold">{initials}</span>
              
              {/* Combined badge */}
              <div className="absolute -bottom-1 -right-1 flex gap-0.5 scale-90">
                <div className="w-3.5 h-3.5 bg-emerald-500 rounded-full flex items-center justify-center border border-surface">
                  <span className="text-[6px] text-white font-bold">W</span>
                </div>
                <div className="w-3.5 h-3.5 bg-pink-500 rounded-full flex items-center justify-center border border-surface">
                  <span className="text-[6px] text-white font-bold">I</span>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Status description */}
        <div className="text-center w-full">
          <p className="text-[10px] text-white font-semibold">
            {hasMerged
              ? L("identity.statusMerged", "Perfil Único Integrado")
              : L("identity.statusSearching", "Buscando Duplicados...")}
          </p>
          <p className="text-[8px] text-text-muted mt-0.5 leading-tight">
            {hasMerged
              ? L("identity.descMerged", "WhatsApp + Instagram unificados por coincidencia de teléfono")
              : L("identity.descSearching", "Contacto detectado en WhatsApp e Instagram DM separado")}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
