"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Shield, AlertTriangle, MessageSquare, Plus, X, ClipboardList, Folder, Lock } from "lucide-react";
import { inputCls } from "../_types";
import type { PersonaConfig } from "../_types";
import { UNIVERSAL_FORBIDDEN_TOPICS } from "@parallext/shared";

interface BehaviorSectionProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
}

type BehaviorField = "rules" | "forbiddenTopics" | "handoffTriggers";

const sectionDefs: { key: BehaviorField; titleKey: string; placeholderKey: string; icon: typeof Shield }[] = [
  { key: "rules", titleKey: "strictRules", placeholderKey: "rulesPlaceholder", icon: Shield },
  { key: "forbiddenTopics", titleKey: "forbiddenTopics", placeholderKey: "forbiddenPlaceholder", icon: AlertTriangle },
  { key: "handoffTriggers", titleKey: "handoffTriggers", placeholderKey: "handoffPlaceholder", icon: MessageSquare },
];

export function BehaviorSection({ config, onChange }: BehaviorSectionProps) {
  const t = useTranslations("agent.behaviorSection");

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
    <div className="flex flex-col gap-4 mt-3">
      {/* Universal Safety Guardrails — always active, cannot be removed */}
      <div>
        <h4 className="text-[13px] font-semibold text-red-600 dark:text-red-400 mb-2 flex items-center gap-1.5">
          <Lock size={14} /> {t("safetyGuardrails")}
        </h4>
        <div className="bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-lg p-3">
          <p className="text-[11px] text-red-600 dark:text-red-400/80 mb-2">{t("safetyGuardrailsDesc")}</p>
          <div className="flex flex-col gap-1">
            {UNIVERSAL_FORBIDDEN_TOPICS.map(topic => (
              <div key={topic.key} className="flex items-center gap-2 text-[12px] text-red-700 dark:text-red-300/90">
                <Lock size={10} className="shrink-0 opacity-50" />
                <span>{topic.label.es}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {sectionDefs.map(section => (
        <div key={section.key}>
          <h4 className="text-[13px] font-semibold text-neutral-600 dark:text-neutral-300 mb-2 flex items-center gap-1.5">
            <section.icon size={14} className="text-indigo-500" /> {t(section.titleKey)}
            {section.key === 'forbiddenTopics' && <span className="text-[10px] text-muted-foreground font-normal ml-1">({t("additionalTopics")})</span>}
          </h4>
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

      <RequiredFieldsSection config={config} onChange={onChange} />
    </div>
  );
}

type RequiredField = { field: string; question: string };

function RequiredFieldsSection({ config, onChange }: BehaviorSectionProps) {
  const t = useTranslations("agent.behaviorSection.requiredFields");
  const fields = (config.behavior.requiredFields || {}) as Record<string, RequiredField[]>;
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
    <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
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
    </div>
  );
}
