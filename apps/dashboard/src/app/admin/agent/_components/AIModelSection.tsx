"use client";

import { Sparkles } from "lucide-react";
import { inputCls, labelCls } from "../_types";
import type { PersonaConfig } from "../_types";

interface AIModelSectionProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
}

export function AIModelSection({ config, onChange }: AIModelSectionProps) {
  return (
    <div className="mt-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Temperature: {config.llm.temperature}</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={config.llm.temperature}
            onChange={e =>
              onChange({ llm: { ...config.llm, temperature: parseFloat(e.target.value) } })
            }
            className="w-full accent-indigo-500"
          />
          <div className="flex justify-between text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">
            <span>Precise (0)</span>
            <span>Creative (1)</span>
          </div>
        </div>
        <div>
          <label className={labelCls}>Max tokens</label>
          <input
            type="number"
            className={inputCls}
            min={100}
            max={4000}
            value={config.llm.maxTokens}
            onChange={e =>
              onChange({ llm: { ...config.llm, maxTokens: parseInt(e.target.value) || 800 } })
            }
          />
        </div>
      </div>

      {/* Explanation card */}
      <div className="mt-4 p-3.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
        <div className="flex items-start gap-2.5">
          <Sparkles size={16} className="text-indigo-500 mt-0.5 shrink-0" />
          <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
            <strong className="text-neutral-800 dark:text-neutral-200">Temperature</strong> controls creativity. Low (0-0.3) = consistent. High (0.7-1) = creative.{" "}
            <strong className="text-neutral-800 dark:text-neutral-200">Max tokens</strong> limits response length. 800 tokens ~ 2-3 paragraphs.
          </p>
        </div>
      </div>
    </div>
  );
}
