"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Bot, User, Smile, Shield, Cpu, Wrench, Brain, Sparkles,
  Save, CheckCircle, AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

import type { PersonaConfig } from "./_types";
import { defaultConfig } from "./_types";
import { AgentProfileCard } from "./_components/AgentProfileCard";
import { ConfigCard } from "./_components/ConfigCard";
import { IdentitySection } from "./_components/IdentitySection";
import { PersonalitySection } from "./_components/PersonalitySection";
import { BehaviorSection } from "./_components/BehaviorSection";
import { ScheduleCard } from "./_components/ScheduleCard";
import { AIModelSection } from "./_components/AIModelSection";
import { CapabilitiesSection } from "./_components/CapabilitiesSection";
import { CustomPromptMode } from "./_components/CustomPromptMode";

// ── Helpers ──────────────────────────────────────────────────

function deepMerge(target: any, source: any): any {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) && target[key]) {
      output[key] = deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      output[key] = source[key];
    }
  }
  return output;
}

// ── Component ────────────────────────────────────────────────

export default function AgentConfigPage() {
  const t = useTranslations("agent");
  const tc = useTranslations("common");
  const { activeTenantId } = useTenant();

  const [mode, setMode] = useState<"guided" | "prompt">("guided");
  const [config, setConfig] = useState<PersonaConfig>(structuredClone(defaultConfig));
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>("identity");
  const [apptReadiness, setApptReadiness] = useState<{ services: number; slots: number; loaded: boolean }>({
    services: 0,
    slots: 0,
    loaded: false,
  });

  // ── Load existing config ────────────────────────────────────

  useEffect(() => {
    if (!activeTenantId) return;
    setLoading(true);
    api.getPersonaConfig(activeTenantId)
      .then((res: any) => {
        if (res?.success && res.data) {
          const data = res.data;
          setConfig(deepMerge(structuredClone(defaultConfig), data));
          if (data._customPrompt) {
            setCustomPrompt(data._customPrompt);
            setMode("prompt");
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeTenantId]);

  // ── Load appointments readiness ─────────────────────────────

  useEffect(() => {
    if (!activeTenantId) return;
    let cancelled = false;
    Promise.all([
      api.getServices(activeTenantId).catch(() => null),
      api.getAvailability(activeTenantId).catch(() => null),
    ]).then(([svcRes, availRes]: any[]) => {
      if (cancelled) return;
      const services = Array.isArray(svcRes?.data) ? svcRes.data.filter((s: any) => s.isActive !== false).length : 0;
      const slots = Array.isArray(availRes?.data?.slots) ? availRes.data.slots.length : 0;
      setApptReadiness({ services, slots, loaded: true });
    });
    return () => { cancelled = true; };
  }, [activeTenantId]);

  // ── Toast auto-dismiss ──────────────────────────────────────

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  // ── Update helper (merges partial updates into config) ──────

  const updateConfig = useCallback((updates: Partial<PersonaConfig>) => {
    setConfig(prev => deepMerge(prev, updates));
  }, []);

  // ── Toggle section ──────────────────────────────────────────

  const toggleSection = useCallback((section: string) => {
    setExpandedSection(prev => (prev === section ? null : section));
  }, []);

  // ── Save ────────────────────────────────────────────────────

  async function handleSave() {
    if (!activeTenantId) return;
    setSaving(true);
    try {
      let payload: any;
      if (mode === "prompt") {
        payload = { ...config, _customPrompt: customPrompt, _mode: "prompt" };
      } else {
        payload = { ...config, _customPrompt: undefined, _mode: "wizard" };
      }
      const res = await api.savePersonaConfig(activeTenantId, payload);
      if (res?.success) {
        setToast("Configuration saved successfully");
      } else {
        setToast((res as any)?.error || tc("errorSaving"));
      }
    } catch {
      setToast(tc("errorSaving"));
    } finally {
      setSaving(false);
    }
  }

  // ── Computed values ─────────────────────────────────────────

  const ruleCount = config.behavior.rules.filter(Boolean).length
    + config.behavior.forbiddenTopics.filter(Boolean).length
    + config.behavior.handoffTriggers.filter(Boolean).length;

  const toolCount = config.tools?.appointments?.enabled ? 1 : 0;

  // ── Summaries for collapsed cards ───────────────────────────

  const identitySummary = config.persona.name
    ? `${config.persona.name} - ${config.persona.role || "No role"}`
    : "Name, role, greeting, language...";

  const personalitySummary = `${config.persona.personality.tone} tone, ${config.persona.personality.formality}`;

  const behaviorSummary = ruleCount > 0
    ? `${config.behavior.rules.filter(Boolean).length} rules, ${config.behavior.forbiddenTopics.filter(Boolean).length} forbidden, ${config.behavior.handoffTriggers.filter(Boolean).length} triggers`
    : "Rules, forbidden topics, handoff triggers...";

  const aiModelSummary = `Temperature ${config.llm.temperature}, max ${config.llm.maxTokens} tokens`;

  const capabilitiesSummary = toolCount > 0
    ? `${toolCount} tool${toolCount > 1 ? "s" : ""} active`
    : "No tools enabled";

  // ── Loading state ───────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <Bot size={40} className="text-indigo-500 mx-auto mb-3" />
          <div className="text-neutral-500 dark:text-neutral-400 text-sm">Loading agent configuration...</div>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        icon={Bot}
        title={t("title")}
        subtitle="Configure your conversational agent's behavior"
        action={
          mode === "guided" ? (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={cn(
                "px-5 py-2.5 rounded-lg border-none text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5 transition-colors",
                saving
                  ? "bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed"
                  : "bg-indigo-500 hover:bg-indigo-600"
              )}
            >
              <Save size={16} /> {saving ? tc("saving") : tc("saveChanges")}
            </button>
          ) : undefined
        }
      />

      {/* Mode toggle */}
      <div className="flex gap-2 mb-6">
        <button
          type="button"
          onClick={() => setMode("guided")}
          className={cn(
            "flex-1 py-3 px-5 rounded-xl border-2 text-sm font-semibold cursor-pointer flex items-center justify-center gap-2 transition-all",
            mode === "guided"
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
              : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400"
          )}
        >
          <Sparkles size={16} /> Guided Setup
        </button>
        <button
          type="button"
          onClick={() => setMode("prompt")}
          className={cn(
            "flex-1 py-3 px-5 rounded-xl border-2 text-sm font-semibold cursor-pointer flex items-center justify-center gap-2 transition-all",
            mode === "prompt"
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
              : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400"
          )}
        >
          <Brain size={16} /> Custom Prompt
        </button>
      </div>

      {mode === "prompt" ? (
        <CustomPromptMode
          customPrompt={customPrompt}
          onChangePrompt={setCustomPrompt}
          saving={saving}
          onSave={handleSave}
          saveLabel={tc("saveChanges")}
          savingLabel={tc("saving")}
        />
      ) : (
        <>
          <AgentProfileCard
            config={config}
            toolCount={toolCount}
            ruleCount={ruleCount}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ConfigCard
              icon={User}
              iconColor="text-indigo-500 bg-indigo-500/10"
              title="Identity"
              summary={identitySummary}
              expanded={expandedSection === "identity"}
              onToggle={() => toggleSection("identity")}
            >
              <IdentitySection config={config} onChange={updateConfig} />
            </ConfigCard>

            <ConfigCard
              icon={Smile}
              iconColor="text-violet-500 bg-violet-500/10"
              title="Personality"
              summary={personalitySummary}
              expanded={expandedSection === "personality"}
              onToggle={() => toggleSection("personality")}
            >
              <PersonalitySection config={config} onChange={updateConfig} />
            </ConfigCard>

            <ConfigCard
              icon={Shield}
              iconColor="text-rose-500 bg-rose-500/10"
              title="Behavior"
              summary={behaviorSummary}
              expanded={expandedSection === "behavior"}
              onToggle={() => toggleSection("behavior")}
            >
              <BehaviorSection config={config} onChange={updateConfig} />
            </ConfigCard>

            <ScheduleCard config={config} />

            <ConfigCard
              icon={Cpu}
              iconColor="text-cyan-500 bg-cyan-500/10"
              title="AI Model"
              summary={aiModelSummary}
              expanded={expandedSection === "ai-model"}
              onToggle={() => toggleSection("ai-model")}
            >
              <AIModelSection config={config} onChange={updateConfig} />
            </ConfigCard>

            <ConfigCard
              icon={Wrench}
              iconColor="text-amber-500 bg-amber-500/10"
              title="Capabilities"
              summary={capabilitiesSummary}
              expanded={expandedSection === "capabilities"}
              onToggle={() => toggleSection("capabilities")}
            >
              <CapabilitiesSection
                config={config}
                onChange={updateConfig}
                apptReadiness={apptReadiness}
              />
            </ConfigCard>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 px-5 py-3 rounded-lg text-white text-sm font-semibold shadow-lg z-[9999] flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2",
            toast.includes("Error") || toast.includes("error") ? "bg-red-500" : "bg-emerald-500"
          )}
        >
          {toast.includes("Error") || toast.includes("error") ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
          {toast}
        </div>
      )}
    </div>
  );
}
