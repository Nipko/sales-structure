"use client";

import { cn } from "@/lib/utils";
import { Brain, Save } from "lucide-react";

interface CustomPromptModeProps {
  customPrompt: string;
  onChangePrompt: (value: string) => void;
  saving: boolean;
  onSave: () => void;
  saveLabel: string;
  savingLabel: string;
}

export function CustomPromptMode({
  customPrompt,
  onChangePrompt,
  saving,
  onSave,
  saveLabel,
  savingLabel,
}: CustomPromptModeProps) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
      <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1 flex items-center gap-2">
        <Brain size={18} className="text-indigo-500" /> Custom System Prompt
      </h3>
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
        Write the complete prompt the AI model will receive as system instruction.
        This prompt replaces the entire guided configuration.
      </p>
      <textarea
        value={customPrompt}
        onChange={e => onChangePrompt(e.target.value)}
        placeholder={`You are Sofia Henao, a sales advisor at Gecko Extreme Adventure.\n\nYour personality:\n- Friendly and enthusiastic tone\n- Moderate emoji usage\n- Always respond in Colombian Spanish\n\nRules:\n1. Never make up prices\n2. If you can't resolve in 3 messages, offer to speak with a human\n3. Always confirm date and number of people before quoting\n\nSchedule: Monday to Friday 8am-6pm, Saturdays 8am-2pm (Colombia)`}
        className="w-full min-h-[400px] p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-foreground text-sm leading-relaxed font-mono outline-none resize-y focus:border-indigo-500 dark:focus:border-indigo-500 transition-colors"
      />
      <div className="flex justify-between items-center mt-3">
        <span className="text-neutral-400 dark:text-neutral-500 text-xs">
          {customPrompt.length} characters
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !customPrompt.trim()}
          className={cn(
            "px-5 py-2.5 rounded-lg border-none text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5 transition-colors",
            saving || !customPrompt.trim()
              ? "bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed"
              : "bg-indigo-500 hover:bg-indigo-600"
          )}
        >
          <Save size={16} /> {saving ? savingLabel : saveLabel}
        </button>
      </div>
    </div>
  );
}
