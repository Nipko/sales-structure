"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Shield, AlertTriangle, MessageSquare, Plus, X, ChevronDown,
  ClipboardList, Folder, Lock, FileText, Lightbulb,
} from "lucide-react";
import { inputCls } from "../_types";
import type { PersonaConfig } from "../_types";
import { UNIVERSAL_FORBIDDEN_TOPICS, normalizeRequiredFields } from "@parallext/shared";
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

      {/* ── Safety Guardrails: always on, folded. A red list of abuse and
          terrorism under the first empty box read as work to do. ── */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-neutral-600 dark:text-neutral-300">
          <Lock size={14} /> {t("safetyGuardrails")}
        </summary>
        <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900/60">
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-2">{t("safetyGuardrailsDesc")}</p>
          <div className="flex flex-col gap-1">
            {UNIVERSAL_FORBIDDEN_TOPICS.map(topic => (
              <div key={topic.key} className="flex items-center gap-2 text-[12px] text-neutral-600 dark:text-neutral-300">
                <Lock size={10} className="shrink-0 opacity-50" />
                {/* Localized: these were hardcoded to Spanish, so a Brazilian or
                    French tenant read the platform guardrails in Spanish. */}
                <span>{(topic.label as Record<string, string>)[locale] ?? topic.label.es}</span>
              </div>
            ))}
          </div>
        </div>
      </details>

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

// Editor-only adapter: show every supported author field without Agenda filtering.
function requiredFieldsForEditor(raw: Record<string, any>, language: string) {
  const fields = normalizeRequiredFields(raw, { language });
  const passthrough: Record<string, any> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (Array.isArray(entry) && entry.every(value => value && typeof value === "object"
      && typeof value.field === "string" && typeof value.question === "string")) {
      // Runtime drops empty contexts; they are intentional editable rows here.
      if (!entry.length && !Object.prototype.hasOwnProperty.call(fields, key)) fields[key] = entry;
      continue;
    }
    // Convert only supported required legacy keys. Preserve optional/unknown
    // declarations and unknown invalid arrays exactly as received.
    if (!Object.keys(normalizeRequiredFields({ [key]: entry }, { language })).length) passthrough[key] = entry;
  }
  // A preserved entry may already own general: do not overwrite it on conversion.
  if (Object.prototype.hasOwnProperty.call(passthrough, "general")
    && Object.prototype.hasOwnProperty.call(fields, "general")) {
    let key = "general_legacy", i = 1;
    while (Object.prototype.hasOwnProperty.call(raw, key) || Object.prototype.hasOwnProperty.call(fields, key)) key = "general_legacy_" + i++;
    fields[key] = fields.general;
    delete fields.general;
  }
  return { fields, passthrough };
}

function RequiredFieldsSection({ config, onChange }: BehaviorSectionProps) {
  const t = useTranslations("agent.behaviorSection.requiredFields");
  const [contextError, setContextError] = useState(false);
  const rawFields = useMemo(() => (config.behavior.requiredFields || {}) as Record<string, any>, [config.behavior.requiredFields]);
  const { fields, passthrough } = useMemo(() => requiredFieldsForEditor(rawFields, config.language), [rawFields, config.language]);
  const contexts = useMemo(() => Object.keys(fields), [fields]);
  const [contextIdentity, setContextIdentity] = useState<{ next: number; byName: Record<string, string> }>(() => {
    const byName: Record<string, string> = Object.create(null);
    contexts.forEach((name, index) => { byName[name] = "required-context-" + index; });
    return { next: contexts.length, byName };
  });
  // External author configuration may add/remove names. Keep surviving ids;
  // return the same state when the identity mapping is already synchronized.
  useEffect(() => {
    setContextIdentity(previous => {
      const byName: Record<string, string> = Object.create(null);
      let next = previous.next;
      let changed = Object.keys(previous.byName).length !== contexts.length;
      for (const name of contexts) {
        const existing = previous.byName[name];
        if (existing === undefined) { byName[name] = "required-context-" + next++; changed = true; }
        else byName[name] = existing;
      }
      return changed ? { next, byName } : previous;
    });
  }, [contexts]);
  const hasContext = (name: string) => Object.prototype.hasOwnProperty.call(fields, name)
    || Object.prototype.hasOwnProperty.call(passthrough, name);
  const commitFields = (next: Record<string, RequiredField[]>) => {
    setContextError(false);
    onChange({ behavior: { ...config.behavior, requiredFields: { ...passthrough, ...next } } });
  };

  const updateContextName = (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;
    if (hasContext(newName)) { setContextError(true); return; }
    setContextIdentity(previous => {
      const byName = Object.assign(Object.create(null), previous.byName) as Record<string, string>;
      const existing = byName[oldName];
      delete byName[oldName];
      byName[newName] = existing ?? "required-context-" + previous.next;
      return { next: previous.next + (existing === undefined ? 1 : 0), byName };
    });
    const next: Record<string, RequiredField[]> = {};
    for (const k of contexts) next[k === oldName ? newName : k] = fields[k];
    commitFields(next);
  };

  const addContext = () => {
    const baseName = "nuevo_contexto";
    let name = baseName;
    let i = 1;
    while (hasContext(name)) { name = `${baseName}_${i++}`; }
    setContextIdentity(previous => ({
      next: previous.next + 1,
      byName: Object.assign(Object.create(null), previous.byName, { [name]: "required-context-" + previous.next }) as Record<string, string>,
    }));
    commitFields({ ...fields, [name]: [] });
  };

  const removeContext = (name: string) => {
    setContextIdentity(previous => {
      if (!Object.prototype.hasOwnProperty.call(previous.byName, name)) return previous;
      const byName = Object.assign(Object.create(null), previous.byName) as Record<string, string>;
      delete byName[name];
      return { ...previous, byName };
    });
    const next = { ...fields };
    delete next[name];
    commitFields(next);
  };

  const updateField = (ctx: string, idx: number, patch: Partial<RequiredField>) => {
    const list = [...(fields[ctx] || [])];
    list[idx] = { ...list[idx], ...patch };
    commitFields({ ...fields, [ctx]: list });
  };

  const addField = (ctx: string) => {
    const list = [...(fields[ctx] || []), { field: "", question: "" }];
    commitFields({ ...fields, [ctx]: list });
  };

  const removeField = (ctx: string, idx: number) => {
    const list = (fields[ctx] || []).filter((_, i) => i !== idx);
    commitFields({ ...fields, [ctx]: list });
  };

  return (
    <section className="pt-4 border-t border-neutral-200 dark:border-neutral-700">
      <h4 className="text-[13px] font-semibold text-neutral-600 dark:text-neutral-300 mb-1 flex items-center gap-1.5">
        <ClipboardList size={14} className="text-indigo-500" /> {t("title")}
      </h4>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-3">{t("hint")}</p>
      {contextError && <p role="alert" className="text-[12px] text-red-600 dark:text-red-400 mb-3">{t("contextExists")}</p>}

      <div className="flex flex-col gap-3">
        {contexts.map((ctx) => (
          <div key={contextIdentity.byName[ctx] ?? "pending-context:" + ctx} className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
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
