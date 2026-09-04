"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Shield, AlertTriangle, MessageSquare, Plus, X, ChevronDown,
  ClipboardList, Folder, Lock, FileText, Lightbulb,
} from "lucide-react";
import { inputCls } from "../_types";
import type { PersonaConfig } from "../_types";
import { UNIVERSAL_FORBIDDEN_TOPICS } from "@parallext/shared";
import { guidedTourAnchorId } from "@/lib/guided-tours";

interface BehaviorSectionProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
  errors?: Partial<Record<string, string>>;
  focusField?: string | null;
}

type BehaviorField = "rules" | "forbiddenTopics" | "handoffTriggers";

/**
 * `handoffTriggers` is labelled "Cuando pasar a un humano" now: "Triggers de
 * escalado" is jargon for the person who has to fill it in.
 */
const sectionDefs: {
  key: BehaviorField;
  titleKey: string;
  placeholderKey: string;
  icon: typeof Shield;
  anchorId?: string;
  focus?: string;
  required?: boolean;
}[] = [
  { key: "rules", titleKey: "strictRules", placeholderKey: "rulesPlaceholder", icon: Shield, anchorId: guidedTourAnchorId("agent-rules"), focus: "rules", required: true },
  { key: "forbiddenTopics", titleKey: "forbiddenTopics", placeholderKey: "forbiddenPlaceholder", icon: AlertTriangle },
  { key: "handoffTriggers", titleKey: "handoffTriggersPlain", placeholderKey: "handoffPlaceholder", icon: MessageSquare, anchorId: guidedTourAnchorId("agent-handoff-triggers"), focus: "handoff", required: true },
];

export function BehaviorSection({ config, onChange, errors = {}, focusField = null }: BehaviorSectionProps) {
  const t = useTranslations("agent.behaviorSection");
  const tv = useTranslations("agent");
  const locale = useLocale();

  function updateList(field: BehaviorField, index: number, value: string) {
    const list = [...config.behavior[field]];
    list[index] = value;
    onChange({ behavior: { ...config.behavior, [field]: list } });
  }

  function addItem(field: BehaviorField) {
    onChange({ behavior: { ...config.behavior, [field]: [...config.behavior[field], ""] } });
  }

  function removeItem(field: BehaviorField, index: number) {
    onChange({
      behavior: {
        ...config.behavior,
        [field]: config.behavior[field].filter((_, i) => i !== index),
      },
    });
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* ── Main Instructions ── */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <FileText size={16} className="text-indigo-500" />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {t("mainInstructions")}
          </h3>
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">
          {t("mainInstructionsDesc")}
        </p>
        <textarea
          className={cn(
            inputCls,
            "min-h-[180px] resize-y leading-relaxed"
          )}
          placeholder={t("mainInstructionsPlaceholder")}
          value={config.behavior.mainInstructions || ""}
          onChange={e =>
            onChange({
              behavior: { ...config.behavior, mainInstructions: e.target.value },
            })
          }
        />
        <div className="flex items-start gap-2 mt-2 p-3 rounded-lg bg-indigo-50 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/10">
          <Lightbulb size={14} className="text-indigo-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-neutral-600 dark:text-neutral-400 leading-relaxed">
            {t("mainInstructionsTip")}
          </p>
        </div>
      </section>

      {/* ── Safety Guardrails ── */}
      <section>
        <h4 className="text-[13px] font-semibold text-red-600 dark:text-red-400 mb-2 flex items-center gap-1.5">
          <Lock size={14} /> {t("safetyGuardrails")}
        </h4>
        <div className="bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-lg p-3">
          <p className="text-[11px] text-red-600 dark:text-red-400/80 mb-2">{t("safetyGuardrailsDesc")}</p>
          <div className="flex flex-col gap-1">
            {UNIVERSAL_FORBIDDEN_TOPICS.map(topic => (
              <div key={topic.key} className="flex items-center gap-2 text-[12px] text-red-700 dark:text-red-300/90">
                <Lock size={10} className="shrink-0 opacity-50" />
                {/* Localized: these were hardcoded to Spanish, so a Brazilian or
                    French tenant read the platform guardrails in Spanish. */}
                <span>{(topic.label as Record<string, string>)[locale] ?? topic.label.es}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Structured Rules ── */}
      <section>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
          {t("structuredRulesTitle")}
        </h3>
        <div className="space-y-5">
          {sectionDefs.map(section => (
            <div
              key={section.key}
              id={section.anchorId}
              className={cn(
                "rounded-xl p-1 -m-1 transition-shadow",
                section.focus && focusField === section.focus
                  ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900"
                  : "",
              )}
            >
              <h4 className="text-[13px] font-semibold text-neutral-600 dark:text-neutral-300 mb-2 flex items-center gap-1.5">
                <section.icon size={14} className="text-indigo-500" /> {t(section.titleKey)}
                {section.required && <span className="text-red-500" aria-hidden="true">*</span>}
                {section.key === "forbiddenTopics" && (
                  <span className="text-[10px] text-muted-foreground font-normal ml-1">
                    ({t("additionalTopics")})
                  </span>
                )}
              </h4>
              {section.key === "handoffTriggers" && (
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-2">{t("handoffTriggersHint")}</p>
              )}
              {section.focus && errors[section.focus] && (
                <p role="alert" className="mb-2 text-[11.5px] font-medium text-red-600 dark:text-red-400">
                  {errors[section.focus]}
                </p>
              )}
              <div className="flex flex-col gap-2">
                {config.behavior[section.key].map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      className={cn(inputCls, "flex-1")}
                      placeholder={t(section.placeholderKey)}
                      value={item}
                      onChange={e => updateList(section.key, idx, e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(section.key, idx)}
                      className="w-8 h-8 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-red-500 cursor-pointer flex items-center justify-center shrink-0 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addItem(section.key)}
                  className="px-3.5 py-2 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-600 bg-transparent text-indigo-500 cursor-pointer text-[13px] font-semibold flex items-center gap-1.5 self-start hover:border-indigo-400 transition-colors"
                >
                  <Plus size={14} /> {t("add")}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Required Fields ── */}
      {/* Avanzado: "Informacion requerida por contexto" is a power feature with
          placeholders like nombre_del_contexto. It stays available, but a
          first-time owner should not meet it while filling in the basics. */}
      <AdvancedBehavior label={tv("advanced.title")} hint={tv("advanced.behaviorHint")}>
        <RequiredFieldsSection config={config} onChange={onChange} />
      </AdvancedBehavior>
    </div>
  );
}

function AdvancedBehavior({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="pt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-2 text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 cursor-pointer transition-colors bg-transparent border-none p-0"
      >
        <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} />
        {label}
      </button>
      {!open && <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">{hint}</p>}
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

type RequiredField = { field: string; question: string };

function RequiredFieldsSection({ config, onChange }: BehaviorSectionProps) {
  const t = useTranslations("agent.behaviorSection.requiredFields");
  const rawFields = (config.behavior.requiredFields || {}) as Record<string, any>;
  const fields: Record<string, RequiredField[]> = {};
  for (const [k, v] of Object.entries(rawFields)) {
    if (Array.isArray(v)) fields[k] = v;
  }
  const contexts = Object.keys(fields);

  const updateContextName = (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;
    const next: Record<string, RequiredField[]> = {};
    for (const k of contexts) next[k === oldName ? newName : k] = fields[k];
    onChange({ behavior: { ...config.behavior, requiredFields: next } });
  };

  const addContext = () => {
    const baseName = "nuevo_contexto";
    let name = baseName;
    let i = 1;
    while (fields[name]) { name = `${baseName}_${i++}`; }
    onChange({ behavior: { ...config.behavior, requiredFields: { ...fields, [name]: [] } } });
  };

  const removeContext = (name: string) => {
    const next = { ...fields };
    delete next[name];
    onChange({ behavior: { ...config.behavior, requiredFields: next } });
  };

  const updateField = (ctx: string, idx: number, patch: Partial<RequiredField>) => {
    const list = [...(fields[ctx] || [])];
    list[idx] = { ...list[idx], ...patch };
    onChange({ behavior: { ...config.behavior, requiredFields: { ...fields, [ctx]: list } } });
  };

  const addField = (ctx: string) => {
    const list = [...(fields[ctx] || []), { field: "", question: "" }];
    onChange({ behavior: { ...config.behavior, requiredFields: { ...fields, [ctx]: list } } });
  };

  const removeField = (ctx: string, idx: number) => {
    const list = (fields[ctx] || []).filter((_, i) => i !== idx);
    onChange({ behavior: { ...config.behavior, requiredFields: { ...fields, [ctx]: list } } });
  };

  return (
    <section className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
      <h4 className="text-[13px] font-semibold text-neutral-600 dark:text-neutral-300 mb-1 flex items-center gap-1.5">
        <ClipboardList size={14} className="text-indigo-500" /> {t("title")}
      </h4>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-3">{t("hint")}</p>

      <div className="flex flex-col gap-3">
        {contexts.map((ctx) => (
          <div key={ctx} className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Folder size={12} className="text-neutral-400" />
              <input
                className={cn(inputCls, "flex-1 h-8 text-[13px]")}
                value={ctx}
                onChange={e => updateContextName(ctx, e.target.value)}
                placeholder={t("contextPlaceholder")}
              />
              <button
                type="button"
                onClick={() => removeContext(ctx)}
                className="w-7 h-7 rounded-md border border-neutral-200 dark:border-neutral-700 text-red-500 flex items-center justify-center shrink-0 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
            <div className="flex flex-col gap-2 pl-5">
              {(fields[ctx] || []).map((f, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    className={cn(inputCls, "w-1/3 h-8 text-[12px]")}
                    placeholder={t("fieldNamePlaceholder")}
                    value={f.field}
                    onChange={e => updateField(ctx, idx, { field: e.target.value })}
                  />
                  <input
                    className={cn(inputCls, "flex-1 h-8 text-[12px]")}
                    placeholder={t("questionPlaceholder")}
                    value={f.question}
                    onChange={e => updateField(ctx, idx, { question: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => removeField(ctx, idx)}
                    className="w-7 h-7 rounded-md border border-neutral-200 dark:border-neutral-700 text-red-500 flex items-center justify-center shrink-0 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addField(ctx)}
                className="px-3 py-1.5 rounded-md border border-dashed border-neutral-300 dark:border-neutral-600 bg-transparent text-indigo-500 cursor-pointer text-[12px] font-semibold flex items-center gap-1.5 self-start hover:border-indigo-400 transition-colors"
              >
                <Plus size={12} /> {t("addField")}
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addContext}
          className="px-3.5 py-2 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-600 bg-transparent text-indigo-500 cursor-pointer text-[13px] font-semibold flex items-center gap-1.5 self-start hover:border-indigo-400 transition-colors"
        >
          <Plus size={14} /> {t("addContext")}
        </button>
      </div>
    </section>
  );
}
