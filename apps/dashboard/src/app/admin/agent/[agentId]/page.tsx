"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Bot, User, Smile, Shield, Cpu, Wrench, Brain, Sparkles,
  Save, CheckCircle, AlertTriangle, ArrowLeft, MoreVertical,
  BookmarkPlus, Star, Radio, Clock,
  MessageSquare, Instagram, Facebook, Send, Phone,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";

import type { PersonaConfig } from "../_types";
import { defaultConfig, labelCls } from "../_types";
import { AgentProfileCard } from "../_components/AgentProfileCard";
import { ConfigCard } from "../_components/ConfigCard";
import { IdentitySection } from "../_components/IdentitySection";
import { PersonalitySection } from "../_components/PersonalitySection";
import { BehaviorSection } from "../_components/BehaviorSection";
import { ScheduleCard } from "../_components/ScheduleCard";
import { AIModelSection } from "../_components/AIModelSection";
import { CapabilitiesSection } from "../_components/CapabilitiesSection";
import { CustomPromptMode } from "../_components/CustomPromptMode";

// ── Channel metadata ────────────────────────────────────────

const CHANNEL_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  whatsapp:  { label: "WhatsApp",  icon: MessageSquare, color: "text-emerald-500" },
  instagram: { label: "Instagram", icon: Instagram,     color: "text-pink-500" },
  messenger: { label: "Facebook",  icon: Facebook,      color: "text-blue-500" },
  telegram:  { label: "Telegram",  icon: Send,          color: "text-sky-500" },
  sms:       { label: "SMS",       icon: Phone,         color: "text-violet-500" },
};

const ALL_CHANNELS = ["whatsapp", "instagram", "messenger", "telegram", "sms"];

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

// ── Types ────────────────────────────────────────────────────

interface AgentData {
  id: string;
  name: string;
  role?: string;
  is_active: boolean;
  is_default: boolean;
  channels: string[];
  schedule_mode?: string;
  config_json: PersonaConfig;
}

interface ChannelAssignment {
  channel: string;
  current_agent_id?: string;
  current_agent_name?: string;
}

// ── Component ────────────────────────────────────────────────

export default function AgentEditorPage() {
  const t = useTranslations("agent");
  const tc = useTranslations("common");
  const { activeTenantId } = useTenant();
  const params = useParams();
  const router = useRouter();
  const agentId = params.agentId as string;

  const [mode, setMode] = useState<"guided" | "prompt">("guided");
  const [config, setConfig] = useState<PersonaConfig>(structuredClone(defaultConfig));
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>("identity");
  const [isDefault, setIsDefault] = useState(false);
  const [assignedChannels, setAssignedChannels] = useState<string[]>([]);
  const [allAgents, setAllAgents] = useState<AgentData[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [apptReadiness, setApptReadiness] = useState<{ services: number; slots: number; loaded: boolean }>({
    services: 0,
    slots: 0,
    loaded: false,
  });

  // ── Load agent data ────────────────────────────────────────

  useEffect(() => {
    if (!activeTenantId || !agentId) return;
    setLoading(true);

    Promise.all([
      api.getAgent(activeTenantId, agentId),
      api.listAgents(activeTenantId),
    ])
      .then(([agentRes, agentsRes]: any[]) => {
        if (agentRes?.success && agentRes.data) {
          const data = agentRes.data;
          const configData = data.config_json || {};
          setConfig(deepMerge(structuredClone(defaultConfig), configData));
          setIsDefault(data.is_default ?? false);
          setAssignedChannels(data.channels || []);
          if (configData._customPrompt) {
            setCustomPrompt(configData._customPrompt);
            setMode("prompt");
          }
        }
        if (agentsRes?.success && Array.isArray(agentsRes.data)) {
          setAllAgents(agentsRes.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeTenantId, agentId]);

  // ── Load appointments readiness ────────────────────────────

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

  // ── Toast auto-dismiss ─────────────────────────────────────

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  // ── Update helper ──────────────────────────────────────────

  const updateConfig = useCallback((updates: Partial<PersonaConfig>) => {
    setConfig(prev => deepMerge(prev, updates));
  }, []);

  const toggleSection = useCallback((section: string) => {
    setExpandedSection(prev => (prev === section ? null : section));
  }, []);

  // ── Channel assignment ─────────────────────────────────────

  function getChannelOwner(channel: string): AgentData | undefined {
    return allAgents.find(a => a.id !== agentId && a.channels?.includes(channel));
  }

  function toggleChannel(channel: string) {
    setAssignedChannels(prev =>
      prev.includes(channel)
        ? prev.filter(c => c !== channel)
        : [...prev, channel]
    );
  }

  // ── Save ───────────────────────────────────────────────────

  async function handleSave() {
    if (!activeTenantId || !agentId) return;
    setSaving(true);
    try {
      let payload: any;
      if (mode === "prompt") {
        payload = {
          configJson: { ...config, _customPrompt: customPrompt, _mode: "prompt" },
          channels: assignedChannels,
          isDefault,
        };
      } else {
        payload = {
          configJson: { ...config, _customPrompt: undefined, _mode: "wizard" },
          channels: assignedChannels,
          isDefault,
        };
      }
      const res = await api.updateAgent(activeTenantId, agentId, payload);
      if (res?.success) {
        setToast(t("savedSuccess"));
      } else {
        setToast((res as any)?.error || tc("errorSaving"));
      }
    } catch {
      setToast(tc("errorSaving"));
    } finally {
      setSaving(false);
    }
  }

  // ── Save as template ───────────────────────────────────────

  async function handleSaveAsTemplate() {
    if (!activeTenantId) return;
    try {
      const res = await api.saveAgentAsTemplate(
        activeTenantId,
        agentId,
        t("templateName", { name: config.persona.name || "Agent" }),
        t("templateDescription", { name: config.persona.name || "agent" })
      );
      if (res?.success) {
        setToast(t("templateSaved"));
      } else {
        setToast((res as any)?.error || t("errorSavingTemplate"));
      }
    } catch {
      setToast(t("errorSavingTemplate"));
    }
    setMenuOpen(false);
  }

  // ── Set as default ─────────────────────────────────────────

  async function handleSetDefault() {
    if (!activeTenantId) return;
    try {
      const res = await api.updateAgent(activeTenantId, agentId, { isDefault: true });
      if (res?.success) {
        setIsDefault(true);
        setToast(t("defaultUpdated"));
      }
    } catch {
      setToast(t("errorUpdatingAgent"));
    }
    setMenuOpen(false);
  }

  // ── Computed values ────────────────────────────────────────

  const ruleCount = config.behavior.rules.filter(Boolean).length
    + config.behavior.forbiddenTopics.filter(Boolean).length
    + config.behavior.handoffTriggers.filter(Boolean).length;

  const toolCount = config.tools?.appointments?.enabled ? 1 : 0;

  const te = useTranslations("agent.editor");

  const identitySummary = config.persona.name
    ? `${config.persona.name} - ${config.persona.role || te("noRoleSummary")}`
    : te("identitySummary");

  const personalitySummary = `${config.persona.personality.tone} tone, ${config.persona.personality.formality}`;

  const behaviorSummary = ruleCount > 0
    ? `${te("rulesSummary", { count: config.behavior.rules.filter(Boolean).length })}, ${te("forbiddenSummary", { count: config.behavior.forbiddenTopics.filter(Boolean).length })}, ${te("triggersSummary", { count: config.behavior.handoffTriggers.filter(Boolean).length })}`
    : te("behaviorSummary");

  const aiModelSummary = te("temperatureSummary", { value: config.llm.temperature, tokens: config.llm.maxTokens });

  const capabilitiesSummary = toolCount > 0
    ? te("toolsActiveSummary", { count: toolCount })
    : te("noToolsEnabled");

  const is247 = Object.values(config.hours.schedule).every(
    v => v !== null && (v as { start: string; end: string }).start === "00:00" && (v as { start: string; end: string }).end === "23:59"
  );
  const scheduleSummary = is247
    ? te("always247")
    : (() => {
        const activeDays = Object.entries(config.hours.schedule)
          .filter(([, v]) => v !== null)
          .length;
        return te("daysActive", { count: activeDays, timezone: config.hours.timezone });
      })();

  // ── Loading state ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <Bot size={40} className="text-indigo-500 mx-auto mb-3" />
          <div className="text-neutral-500 dark:text-neutral-400 text-sm">{t("loading")}</div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        icon={Bot}
        title={config.persona.name || t("title")}
        subtitle={config.persona.role || t("subtitle")}
        breadcrumbs={
          <button
            type="button"
            onClick={() => router.push("/admin/agent")}
            className="inline-flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer transition-colors"
          >
            <ArrowLeft size={14} /> {t("backToAgents")}
          </button>
        }
        action={
          <div className="flex items-center gap-2">
            {mode === "guided" && (
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
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              >
                <MoreVertical size={16} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg py-1">
                    <button
                      type="button"
                      onClick={handleSaveAsTemplate}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer text-left"
                    >
                      <BookmarkPlus size={14} /> {t("saveAsTemplate")}
                    </button>
                    {!isDefault && (
                      <button
                        type="button"
                        onClick={handleSetDefault}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer text-left"
                      >
                        <Star size={14} /> {t("setAsDefault")}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        }
      />

      {/* Default badge */}
      {isDefault && (
        <div className="mb-4">
          <Badge
            variant="secondary"
            className="text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400"
          >
            <Star size={12} className="mr-1" /> {t("defaultAgent")}
          </Badge>
        </div>
      )}

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
          <Sparkles size={16} /> {t("guidedSetup")}
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
          <Brain size={16} /> {t("customPromptMode")}
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
              title={te("identityTitle")}
              summary={identitySummary}
              expanded={expandedSection === "identity"}
              onToggle={() => toggleSection("identity")}
            >
              <IdentitySection config={config} onChange={updateConfig} />
            </ConfigCard>

            <ConfigCard
              icon={Smile}
              iconColor="text-violet-500 bg-violet-500/10"
              title={te("personalityTitle")}
              summary={personalitySummary}
              expanded={expandedSection === "personality"}
              onToggle={() => toggleSection("personality")}
            >
              <PersonalitySection config={config} onChange={updateConfig} />
            </ConfigCard>

            <ConfigCard
              icon={Shield}
              iconColor="text-rose-500 bg-rose-500/10"
              title={te("behaviorTitle")}
              summary={behaviorSummary}
              expanded={expandedSection === "behavior"}
              onToggle={() => toggleSection("behavior")}
            >
              <BehaviorSection config={config} onChange={updateConfig} />
            </ConfigCard>

            <ConfigCard
              icon={Clock}
              iconColor="text-amber-500 bg-amber-500/10"
              title={te("scheduleTitle")}
              summary={scheduleSummary}
              expanded={expandedSection === "schedule"}
              onToggle={() => toggleSection("schedule")}
            >
              <ScheduleCard config={config} onChange={updateConfig} />
            </ConfigCard>

            <ConfigCard
              icon={Cpu}
              iconColor="text-cyan-500 bg-cyan-500/10"
              title={te("aiModelTitle")}
              summary={aiModelSummary}
              expanded={expandedSection === "ai-model"}
              onToggle={() => toggleSection("ai-model")}
            >
              <AIModelSection config={config} onChange={updateConfig} />
            </ConfigCard>

            <ConfigCard
              icon={Wrench}
              iconColor="text-amber-500 bg-amber-500/10"
              title={te("capabilitiesTitle")}
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

            {/* Channel Assignment */}
            <ConfigCard
              icon={Radio}
              iconColor="text-emerald-500 bg-emerald-500/10"
              title={t("channelAssignment")}
              summary={
                assignedChannels.length > 0
                  ? assignedChannels.map(ch => CHANNEL_META[ch]?.label || ch).join(", ")
                  : t("noChannelsAssigned")
              }
              expanded={expandedSection === "channels"}
              onToggle={() => toggleSection("channels")}
            >
              <div className="mt-3 space-y-3">
                {ALL_CHANNELS.map(ch => {
                  const meta = CHANNEL_META[ch];
                  if (!meta) return null;
                  const Icon = meta.icon;
                  const owner = getChannelOwner(ch);
                  const isAssigned = assignedChannels.includes(ch);

                  return (
                    <div key={ch} className="flex items-start gap-3">
                      <label className="flex items-center gap-3 flex-1 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          onChange={() => toggleChannel(ch)}
                          className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                        />
                        <Icon size={16} className={meta.color} />
                        <span className="text-sm text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-neutral-100 transition-colors">
                          {meta.label}
                        </span>
                      </label>
                      {owner && !isAssigned && (
                        <span className="text-xs text-neutral-400 dark:text-neutral-500 shrink-0">
                          {t("assignedTo")} {owner.name || t("unnamedAgent")}
                        </span>
                      )}
                      {owner && isAssigned && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0 flex items-center gap-1">
                          <AlertTriangle size={12} />
                          {t("willReassignFrom")} {owner.name || t("unnamedAgent")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
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
