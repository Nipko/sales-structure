"use client";

import { inputCls, selectCls, labelCls } from "../_types";
import type { PersonaConfig } from "../_types";

interface PersonalitySectionProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
}

export function PersonalitySection({ config, onChange }: PersonalitySectionProps) {
  function updatePersonality(field: string, value: string) {
    onChange({
      persona: {
        ...config.persona,
        personality: { ...config.persona.personality, [field]: value },
      },
    });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
      <div>
        <label className={labelCls}>Tone</label>
        <select
          className={selectCls}
          value={config.persona.personality.tone}
          onChange={e => updatePersonality("tone", e.target.value)}
        >
          <option value="friendly">Friendly</option>
          <option value="profesional">Professional</option>
          <option value="formal">Formal</option>
          <option value="casual">Casual</option>
          <option value="empatico">Empathetic</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Formality</label>
        <select
          className={selectCls}
          value={config.persona.personality.formality}
          onChange={e => updatePersonality("formality", e.target.value)}
        >
          <option value="formal">Formal</option>
          <option value="casual-professional">Casual-Professional</option>
          <option value="casual">Casual</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Emoji usage</label>
        <select
          className={selectCls}
          value={config.persona.personality.emojiUsage}
          onChange={e => updatePersonality("emojiUsage", e.target.value)}
        >
          <option value="none">None</option>
          <option value="minimal">Minimal</option>
          <option value="moderate">Moderate</option>
          <option value="heavy">Heavy</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Humor</label>
        <input
          className={inputCls}
          placeholder="E.g.: light, adventure themed"
          value={config.persona.personality.humor}
          onChange={e => updatePersonality("humor", e.target.value)}
        />
      </div>
    </div>
  );
}
