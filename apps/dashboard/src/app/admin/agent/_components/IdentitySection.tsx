"use client";

import { cn } from "@/lib/utils";
import { inputCls, selectCls, labelCls } from "../_types";
import type { PersonaConfig } from "../_types";

interface IdentitySectionProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
}

export function IdentitySection({ config, onChange }: IdentitySectionProps) {
  function updatePersona(field: string, value: string) {
    onChange({ persona: { ...config.persona, [field]: value } });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
      <div>
        <label className={labelCls}>Agent name</label>
        <input
          className={inputCls}
          placeholder="E.g.: Sofia Henao"
          value={config.persona.name}
          onChange={e => updatePersona("name", e.target.value)}
        />
      </div>
      <div>
        <label className={labelCls}>Role</label>
        <input
          className={inputCls}
          placeholder="E.g.: Sales advisor"
          value={config.persona.role}
          onChange={e => updatePersona("role", e.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={labelCls}>Welcome message</label>
        <textarea
          className={cn(inputCls, "min-h-20 resize-y")}
          placeholder="Write the greeting the agent will send when starting a conversation..."
          value={config.persona.greeting}
          onChange={e => updatePersona("greeting", e.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={labelCls}>Message when unable to respond</label>
        <textarea
          className={cn(inputCls, "min-h-20 resize-y")}
          placeholder="Fallback message when the agent doesn't know how to respond..."
          value={config.persona.fallbackMessage}
          onChange={e => updatePersona("fallbackMessage", e.target.value)}
        />
      </div>
      <div>
        <label className={labelCls}>Language</label>
        <select
          className={selectCls}
          value={config.language}
          onChange={e => onChange({ language: e.target.value })}
        >
          <option value="es-CO">Spanish (Colombia)</option>
          <option value="es-MX">Spanish (Mexico)</option>
          <option value="en-US">English (US)</option>
          <option value="pt-BR">Portuguese (Brazil)</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Industry</label>
        <select
          className={selectCls}
          value={config.industry}
          onChange={e => onChange({ industry: e.target.value })}
        >
          <option value="general">General</option>
          <option value="tourism">Tourism</option>
          <option value="education">Education</option>
          <option value="ecommerce">E-commerce</option>
          <option value="health">Health</option>
          <option value="services">Services</option>
        </select>
      </div>
    </div>
  );
}
