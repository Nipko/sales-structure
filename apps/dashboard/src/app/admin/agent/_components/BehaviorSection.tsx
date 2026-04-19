"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Shield, AlertTriangle, MessageSquare, Plus, X } from "lucide-react";
import { inputCls } from "../_types";
import type { PersonaConfig } from "../_types";

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
      {sectionDefs.map(section => (
        <div key={section.key}>
          <h4 className="text-[13px] font-semibold text-neutral-600 dark:text-neutral-300 mb-2 flex items-center gap-1.5">
            <section.icon size={14} className="text-indigo-500" /> {t(section.titleKey)}
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
    </div>
  );
}
