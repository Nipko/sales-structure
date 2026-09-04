"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Smile, Briefcase, GraduationCap, Coffee, Heart,
  ChevronDown, MessageCircle, AlignLeft, AlignCenter, AlignJustify,
} from "lucide-react";
import { inputCls, selectCls, labelCls } from "../_types";
import type { PersonaConfig } from "../_types";
import { guidedTourAnchorId } from "@/lib/guided-tours";

interface PersonaTabProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
  /** Per-field messages from the editor's validation (mirrors the API rules). */
  errors?: Partial<Record<string, string>>;
  /** Field the quality center deep-linked to; briefly ringed so it is findable. */
  focusField?: string | null;
}

/** Red asterisk + accessible marker for a field the agent cannot work without. */
function RequiredMark() {
  return <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-[11.5px] font-medium text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

const TONE_PRESETS = [
  {
    id: "friendly",
    icon: Smile,
    tone: "friendly",
    formality: "casual-professional" as const,
    emojiUsage: "minimal" as const,
    iconColor: "text-amber-500",
    bgColor: "bg-amber-500/10",
    ring: "ring-amber-500 border-amber-500 dark:border-amber-500",
  },
  {
    id: "professional",
    icon: Briefcase,
    tone: "profesional",
    formality: "formal" as const,
    emojiUsage: "none" as const,
    iconColor: "text-blue-500",
    bgColor: "bg-blue-500/10",
    ring: "ring-blue-500 border-blue-500 dark:border-blue-500",
  },
  {
    id: "formal",
    icon: GraduationCap,
    tone: "formal",
    formality: "formal" as const,
    emojiUsage: "none" as const,
    iconColor: "text-slate-500",
    bgColor: "bg-slate-500/10",
    ring: "ring-slate-500 border-slate-500 dark:border-slate-500",
  },
  {
    id: "casual",
    icon: Coffee,
    tone: "casual",
    formality: "casual" as const,
    emojiUsage: "moderate" as const,
    iconColor: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    ring: "ring-emerald-500 border-emerald-500 dark:border-emerald-500",
  },
  {
    id: "empathetic",
    icon: Heart,
    tone: "empatico",
    formality: "casual-professional" as const,
    emojiUsage: "minimal" as const,
    iconColor: "text-rose-500",
    bgColor: "bg-rose-500/10",
    ring: "ring-rose-500 border-rose-500 dark:border-rose-500",
  },
] as const;

const ANSWER_LENGTHS = [
  { id: "concise", icon: AlignLeft, temperature: 0.5, maxTokens: 400 },
  { id: "standard", icon: AlignCenter, temperature: 0.7, maxTokens: 800 },
  { id: "detailed", icon: AlignJustify, temperature: 0.8, maxTokens: 1200 },
] as const;

export function PersonaTab({ config, onChange, errors = {}, focusField = null }: PersonaTabProps) {
  const t = useTranslations("agent.persona");
  const tv = useTranslations("agent");
  const ti = useTranslations("agent.identity");
  const tp = useTranslations("agent.personality");
  const [showAdvanced, setShowAdvanced] = useState(false);

  function updatePersona(field: string, value: string) {
    onChange({ persona: { ...config.persona, [field]: value } });
  }

  function updatePersonality(field: string, value: string) {
    onChange({
      persona: {
        ...config.persona,
        personality: { ...config.persona.personality, [field]: value },
      },
    });
  }

  function applyTonePreset(preset: typeof TONE_PRESETS[number]) {
    onChange({
      persona: {
        ...config.persona,
        personality: {
          ...config.persona.personality,
          tone: preset.tone,
          formality: preset.formality,
          emojiUsage: preset.emojiUsage,
        },
      },
    });
  }

  function getActivePresetId(): string | null {
    const p = config.persona.personality;
    const match = TONE_PRESETS.find(
      pr => pr.tone === p.tone && pr.formality === p.formality
    );
    return match?.id ?? null;
  }

  function getAnswerLengthId(): string {
    const tokens = config.llm.maxTokens;
    if (tokens <= 500) return "concise";
    if (tokens <= 1000) return "standard";
    return "detailed";
  }

  function setAnswerLength(id: string) {
    const preset = ANSWER_LENGTHS.find(a => a.id === id);
    if (preset) {
      onChange({
        llm: { ...config.llm, temperature: preset.temperature, maxTokens: preset.maxTokens },
      });
    }
  }

  const activePresetId = getActivePresetId();
  const currentLength = getAnswerLengthId();

  const ringCls = (field: string) =>
    focusField === field ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900" : "";
  const errCls = (field: string) => (errors[field] ? "border-red-400 dark:border-red-500/60" : "");

  return (
    <div className="space-y-8 py-6">
      {/* ── Identity ── */}
      <section>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
          {t("identityTitle")}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div id={guidedTourAnchorId("agent-name")} className={cn("rounded-xl p-1 -m-1 transition-shadow", ringCls("name"), ringCls("role"))}>
            <label className={labelCls}>{ti("agentName")}<RequiredMark /></label>
            <input
              className={cn(inputCls, errCls("name"))}
              placeholder={ti("agentNamePlaceholder")}
              aria-required="true"
              aria-invalid={Boolean(errors.name)}
              value={config.persona.name}
              onChange={e => updatePersona("name", e.target.value)}
            />
            <FieldError message={errors.name} />
          </div>
          <div>
            <label className={labelCls}>{ti("role")}<RequiredMark /></label>
            <input
              className={cn(inputCls, errCls("role"))}
              placeholder={ti("rolePlaceholder")}
              aria-required="true"
              aria-invalid={Boolean(errors.role)}
              value={config.persona.role}
              onChange={e => updatePersona("role", e.target.value)}
            />
            <FieldError message={errors.role} />
          </div>
          <div id={guidedTourAnchorId("agent-greeting")} className={cn("sm:col-span-2 rounded-xl p-1 -m-1 transition-shadow", ringCls("greeting"))}>
            <label className={labelCls}>{ti("welcomeMessage")}</label>
            <textarea
              className={cn(inputCls, "min-h-20 resize-y")}
              placeholder={ti("welcomePlaceholder")}
              value={config.persona.greeting}
              onChange={e => updatePersona("greeting", e.target.value)}
            />
          </div>
          <div id={guidedTourAnchorId("agent-fallback")} className={cn("sm:col-span-2 rounded-xl p-1 -m-1 transition-shadow", ringCls("fallback"))}>
            <label className={labelCls}>{ti("fallbackMessage")}<RequiredMark /></label>
            <textarea
              className={cn(inputCls, "min-h-20 resize-y", errCls("fallback"))}
              placeholder={ti("fallbackPlaceholder")}
              aria-required="true"
              aria-invalid={Boolean(errors.fallback)}
              value={config.persona.fallbackMessage}
              onChange={e => updatePersona("fallbackMessage", e.target.value)}
            />
            <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">{tv("validation.fallbackHelp")}</p>
            <FieldError message={errors.fallback} />
          </div>
          <div>
            <label className={labelCls}>{ti("language")}</label>
            <select
              className={selectCls}
              value={config.language}
              onChange={e => onChange({ language: e.target.value })}
            >
              <option value="es-CO">{ti("langEsCO")}</option>
              <option value="es-MX">{ti("langEsMX")}</option>
              <option value="en-US">{ti("langEnUS")}</option>
              <option value="pt-BR">{ti("langPtBR")}</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>{ti("industry")}</label>
            <select
              className={selectCls}
              value={config.industry}
              onChange={e => onChange({ industry: e.target.value })}
            >
              <option value="general">{ti("industryGeneral")}</option>
              <option value="turismo">{ti("industryTourism")}</option>
              <option value="education">{ti("industryEducation")}</option>
              <option value="salud">{ti("industryHealth")}</option>
              <option value="veterinaria">{ti("industryVeterinaria")}</option>
              <option value="retail">{ti("industryRetail")}</option>
              <option value="technology">{ti("industryTechnology")}</option>
              <option value="servicios_profesionales">{ti("industryServiciosProfesionales")}</option>
              <option value="restaurantes">{ti("industryRestaurantes")}</option>
              <option value="inmobiliaria">{ti("industryInmobiliaria")}</option>
              <option value="automotriz">{ti("industryAutomotriz")}</option>
              <option value="finanzas">{ti("industryFinanzas")}</option>
              <option value="moda_belleza">{ti("industryModaBelleza")}</option>
              <option value="gimnasios">{ti("industryGimnasios")}</option>
              <option value="seguros">{ti("industrySeguros")}</option>
              <option value="servicios_hogar">{ti("industryServiciosHogar")}</option>
              <option value="pet_services">{ti("industryPetServices")}</option>
              <option value="fotografia">{ti("industryFotografia")}</option>
              <option value="otro">{ti("industryOtro")}</option>
            </select>
          </div>
        </div>
      </section>

      {/* ── Tone Presets ── */}
      <section>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
          {t("tonePresets")}
        </h3>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
          {t("tonePresetsDesc")}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {TONE_PRESETS.map(preset => {
            const Icon = preset.icon;
            const isActive = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyTonePreset(preset)}
                className={cn(
                  "flex flex-col items-center gap-2 p-4 rounded-xl border cursor-pointer transition-all",
                  isActive
                    ? `ring-2 ${preset.ring} bg-white dark:bg-neutral-900`
                    : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 bg-white dark:bg-neutral-900"
                )}
              >
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", preset.bgColor)}>
                  <Icon size={20} className={preset.iconColor} />
                </div>
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {t(`preset_${preset.id}`)}
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 text-center leading-tight">
                  {t(`preset_${preset.id}_desc`)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Answer Length ── */}
      <section>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
          {t("answerLength")}
        </h3>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
          {t("answerLengthDesc")}
        </p>
        <div className="grid grid-cols-3 gap-3">
          {ANSWER_LENGTHS.map(al => {
            const Icon = al.icon;
            const isActive = currentLength === al.id;
            return (
              <button
                key={al.id}
                type="button"
                onClick={() => setAnswerLength(al.id)}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-4 rounded-xl border cursor-pointer transition-all",
                  isActive
                    ? "border-indigo-500 ring-2 ring-indigo-500 bg-indigo-500/5 dark:bg-indigo-500/10"
                    : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 bg-white dark:bg-neutral-900"
                )}
              >
                <Icon
                  size={20}
                  className={cn(
                    isActive ? "text-indigo-500" : "text-neutral-400 dark:text-neutral-500"
                  )}
                />
                <span className={cn(
                  "text-sm font-medium",
                  isActive ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-700 dark:text-neutral-300"
                )}>
                  {t(`length_${al.id}`)}
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 text-center">
                  {t(`length_${al.id}_desc`)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Advanced Personality ── */}
      <section>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 cursor-pointer transition-colors"
        >
          <ChevronDown size={16} className={cn("transition-transform", showAdvanced && "rotate-180")} />
          {t("advancedPersonality")}
        </button>

        {showAdvanced && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/30">
            <div>
              <label className={labelCls}>{tp("tone")}</label>
              <select
                className={selectCls}
                value={config.persona.personality.tone}
                onChange={e => updatePersonality("tone", e.target.value)}
              >
                <option value="friendly">{tp("toneFriendly")}</option>
                <option value="profesional">{tp("toneProfessional")}</option>
                <option value="formal">{tp("toneFormal")}</option>
                <option value="casual">{tp("toneCasual")}</option>
                <option value="empatico">{tp("toneEmpathetic")}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{tp("formality")}</label>
              <select
                className={selectCls}
                value={config.persona.personality.formality}
                onChange={e => updatePersonality("formality", e.target.value)}
              >
                <option value="formal">{tp("formalityFormal")}</option>
                <option value="casual-professional">{tp("formalityCasualPro")}</option>
                <option value="casual">{tp("formalityCasual")}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{tp("emojiUsage")}</label>
              <select
                className={selectCls}
                value={config.persona.personality.emojiUsage}
                onChange={e => updatePersonality("emojiUsage", e.target.value)}
              >
                <option value="none">{tp("emojiNone")}</option>
                <option value="minimal">{tp("emojiMinimal")}</option>
                <option value="moderate">{tp("emojiModerate")}</option>
                <option value="heavy">{tp("emojiHeavy")}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{tp("humor")}</label>
              <input
                className={inputCls}
                placeholder={tp("humorPlaceholder")}
                value={config.persona.personality.humor}
                onChange={e => updatePersonality("humor", e.target.value)}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
