"use client";

import { useTranslations } from "next-intl";
import { inputCls, selectCls, labelCls } from "../_types";
import type { PersonaConfig } from "../_types";

interface PersonalitySectionProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
}

export function PersonalitySection({ config, onChange }: PersonalitySectionProps) {
  const t = useTranslations("agent.personality");

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
        <label className={labelCls}>{t("tone")}</label>
        <select
          className={selectCls}
          value={config.persona.personality.tone}
          onChange={e => updatePersonality("tone", e.target.value)}
        >
          <option value="friendly">{t("toneFriendly")}</option>
          <option value="profesional">{t("toneProfessional")}</option>
          <option value="formal">{t("toneFormal")}</option>
          <option value="casual">{t("toneCasual")}</option>
          <option value="empatico">{t("toneEmpathetic")}</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>{t("formality")}</label>
        <select
          className={selectCls}
          value={config.persona.personality.formality}
          onChange={e => updatePersonality("formality", e.target.value)}
        >
          <option value="formal">{t("formalityFormal")}</option>
          <option value="casual-professional">{t("formalityCasualPro")}</option>
          <option value="casual">{t("formalityCasual")}</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>{t("emojiUsage")}</label>
        <select
          className={selectCls}
          value={config.persona.personality.emojiUsage}
          onChange={e => updatePersonality("emojiUsage", e.target.value)}
        >
          <option value="none">{t("emojiNone")}</option>
          <option value="minimal">{t("emojiMinimal")}</option>
          <option value="moderate">{t("emojiModerate")}</option>
          <option value="heavy">{t("emojiHeavy")}</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>{t("humor")}</label>
        <input
          className={inputCls}
          placeholder={t("humorPlaceholder")}
          value={config.persona.personality.humor}
          onChange={e => updatePersonality("humor", e.target.value)}
        />
      </div>
    </div>
  );
}
