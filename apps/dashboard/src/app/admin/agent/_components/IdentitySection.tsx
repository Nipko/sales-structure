"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { inputCls, selectCls, labelCls } from "../_types";
import type { PersonaConfig } from "../_types";

interface IdentitySectionProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
}

export function IdentitySection({ config, onChange }: IdentitySectionProps) {
  const t = useTranslations("agent.identity");

  function updatePersona(field: string, value: string) {
    onChange({ persona: { ...config.persona, [field]: value } });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
      <div>
        <label className={labelCls}>{t("agentName")}</label>
        <input
          className={inputCls}
          placeholder={t("agentNamePlaceholder")}
          value={config.persona.name}
          onChange={e => updatePersona("name", e.target.value)}
        />
      </div>
      <div>
        <label className={labelCls}>{t("role")}</label>
        <input
          className={inputCls}
          placeholder={t("rolePlaceholder")}
          value={config.persona.role}
          onChange={e => updatePersona("role", e.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={labelCls}>{t("welcomeMessage")}</label>
        <textarea
          className={cn(inputCls, "min-h-20 resize-y")}
          placeholder={t("welcomePlaceholder")}
          value={config.persona.greeting}
          onChange={e => updatePersona("greeting", e.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={labelCls}>{t("fallbackMessage")}</label>
        <textarea
          className={cn(inputCls, "min-h-20 resize-y")}
          placeholder={t("fallbackPlaceholder")}
          value={config.persona.fallbackMessage}
          onChange={e => updatePersona("fallbackMessage", e.target.value)}
        />
      </div>
      <div>
        <label className={labelCls}>{t("language")}</label>
        <select
          className={selectCls}
          value={config.language}
          onChange={e => onChange({ language: e.target.value })}
        >
          <option value="es-CO">{t("langEsCO")}</option>
          <option value="es-MX">{t("langEsMX")}</option>
          <option value="en-US">{t("langEnUS")}</option>
          <option value="pt-BR">{t("langPtBR")}</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>{t("industry")}</label>
        <select
          className={selectCls}
          value={config.industry}
          onChange={e => onChange({ industry: e.target.value })}
        >
          <option value="general">{t("industryGeneral")}</option>
          <option value="turismo">{t("industryTourism")}</option>
          <option value="education">{t("industryEducation")}</option>
          <option value="salud">{t("industryHealth")}</option>
          <option value="veterinaria">{t("industryVeterinaria")}</option>
          <option value="retail">{t("industryRetail")}</option>
          <option value="technology">{t("industryTechnology")}</option>
          <option value="servicios_profesionales">{t("industryServiciosProfesionales")}</option>
          <option value="restaurantes">{t("industryRestaurantes")}</option>
          <option value="inmobiliaria">{t("industryInmobiliaria")}</option>
          <option value="automotriz">{t("industryAutomotriz")}</option>
          <option value="finanzas">{t("industryFinanzas")}</option>
          <option value="moda_belleza">{t("industryModaBelleza")}</option>
          <option value="gimnasios">{t("industryGimnasios")}</option>
          <option value="seguros">{t("industrySeguros")}</option>
          <option value="servicios_hogar">{t("industryServiciosHogar")}</option>
          <option value="pet_services">{t("industryPetServices")}</option>
          <option value="fotografia">{t("industryFotografia")}</option>
          <option value="otro">{t("industryOtro")}</option>
        </select>
      </div>
    </div>
  );
}
