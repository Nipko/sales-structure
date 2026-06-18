"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  Bot, User, Shield, Wrench, Save, CheckCircle, AlertTriangle,
  ArrowLeft, MoreVertical, BookmarkPlus, Star, Clock, TestTube2,
  MessageSquare, Instagram, Facebook, Send, X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { Badge } from "@/components/ui/badge";
import { AgentReadinessBanner } from "@/components/AgentReadinessBanner";

import type { PersonaConfig } from "../_types";
import { defaultConfig } from "../_types";
import { PersonaTab } from "../_components/PersonaTab";
import { BehaviorSection } from "../_components/BehaviorSection";
import { ScheduleCard } from "../_components/ScheduleCard";
import { CapabilitiesSection } from "../_components/CapabilitiesSection";
import { CustomPromptMode } from "../_components/CustomPromptMode";

// ── Channel metadata ────────────────────────────────────────

const CHANNEL_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  whatsapp:  { label: "WhatsApp",  icon: MessageSquare, color: "text-emerald-500" },
  instagram: { label: "Instagram", icon: Instagram,     color: "text-pink-500" },
  messenger: { label: "Facebook",  icon: Facebook,      color: "text-blue-500" },
  telegram:  { label: "Telegram",  icon: Send,          color: "text-sky-500" },
};

const ALL_CHANNELS = ["whatsapp", "instagram", "messenger", "telegram"];

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

// ── Component ────────────────────────────────────────────────

export default function AgentEditorPage() {
  const t = useTranslations("agent");
  const tc = useTranslations("common");
  const tt = useTranslations("agent.tabs");
  const { activeTenantId } = useTenant();
  const params = useParams();
  const router = useRouter();
  const agentId = params.agentId as string;

  const [activeTab, setActiveTab] = useState("persona");
  const [mode, setMode] = useState<"guided" | "prompt">("guided");
  const [config, setConfig] = useState<PersonaConfig>(structuredClone(defaultConfig));
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [assignedChannels, setAssignedChannels] = useState<string[]>([]);
  const [allAgents, setAllAgents] = useState<AgentData[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [apptReadiness, setApptReadiness] = useState<{ services: number; slots: number; loaded: boolean }>({
    services: 0, slots: 0, loaded: false,
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
      let services = 0;
      if (Array.isArray(svcRes?.data)) services = svcRes.data.length;
      else if (svcRes?.data?.services && Array.isArray(svcRes.data.services)) services = svcRes.data.services.length;

      let slots = 0;
      if (Array.isArray(availRes?.data)) slots = availRes.data.length;
      else if (Array.isArray(availRes?.data?.slots)) slots = availRes.data.slots.length;
      else if (typeof availRes?.data === "object" && availRes?.data) {
        const vals = Object.values(availRes.data);
        if (vals.length > 0 && Array.isArray(vals[0])) {
          slots = vals.reduce((sum: number, arr: any) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
        }
      }

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

  // ── Channel assignment ─────────────────────────────────────

  function getChannelOwner(channel: string): AgentData | undefined {
    return allAgents.find(a => a.id !== agentId && a.channels?.includes(channel));
  }

  function toggleChannel(channel: string) {
    setAssignedChannels(prev =>
      prev.includes(channel) ? prev.filter(c => c !== channel) : [...prev, channel]
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
        activeTenantId, agentId,
        t("templateName", { name: config.persona.name || "Agent" }),
        t("templateDescription", { name: config.persona.name || "agent" })
      );
      if (res?.success) setToast(t("templateSaved"));
      else setToast((res as any)?.error || t("errorSavingTemplate"));
    } catch { setToast(t("errorSavingTemplate")); }
    setMenuOpen(false);
  }

  // ── Template picker ────────────────────────────────────────

  async function openTemplatePicker() {
    if (templates.length === 0 && activeTenantId) {
      try {
        const res = await api.listAgentTemplates(activeTenantId);
        if (res?.success && Array.isArray(res.data)) setTemplates(res.data);
      } catch {}
    }
    setShowTemplatePicker(true);
    setMenuOpen(false);
  }

  function applyTemplate(template: any) {
    const tplConfig = template.config_json || {};
    const agentName = config.persona.name;
    const agentLang = config.language;
    setConfig(prev => deepMerge(structuredClone(defaultConfig), {
      ...tplConfig,
      persona: { ...tplConfig.persona, name: agentName || tplConfig.persona?.name },
      language: agentLang || tplConfig.language,
    }));
    setShowTemplatePicker(false);
    setToast(t("templateApplied") || "Template applied");
  }

  // ── Set as default ─────────────────────────────────────────

  async function handleSetDefault() {
    if (!activeTenantId) return;
    try {
      const res = await api.updateAgent(activeTenantId, agentId, { isDefault: true });
      if (res?.success) { setIsDefault(true); setToast(t("defaultUpdated")); }
    } catch { setToast(t("errorUpdatingAgent")); }
    setMenuOpen(false);
  }

  // ── Computed values ────────────────────────────────────────

  const ruleCount = config.behavior.rules.filter(Boolean).length
    + config.behavior.forbiddenTopics.filter(Boolean).length
    + config.behavior.handoffTriggers.filter(Boolean).length;

  const enabledToolCount = Object.values(config.tools || {}).filter(
    (v: any) => v?.enabled === true
  ).length;

  const TABS = [
    { id: "persona", label: tt("persona"), icon: User },
    { id: "instructions", label: tt("instructions"), icon: Shield, badge: ruleCount || undefined },
    { id: "tools", label: tt("tools"), icon: Wrench, badge: enabledToolCount || undefined },
    { id: "schedule", label: tt("schedule"), icon: Clock },
  ];

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
    <div className="pb-20">
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
            <Link
              href={`/admin/agent/${agentId}/test`}
              className="px-4 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 text-sm font-medium cursor-pointer flex items-center gap-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              title={t("testAgent")}
            >
              <TestTube2 size={16} /> {t("testAgent")}
            </Link>
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
                    <button type="button" onClick={openTemplatePicker} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer text-left">
                      <Wrench size={14} /> {t("changeTemplate") || "Change template"}
                    </button>
                    <button type="button" onClick={handleSaveAsTemplate} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer text-left">
                      <BookmarkPlus size={14} /> {t("saveAsTemplate")}
                    </button>
                    {!isDefault && (
                      <button type="button" onClick={handleSetDefault} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer text-left">
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

      {/* ── Readiness del agente (about/horarios/KB/canal) ── */}
      <AgentReadinessBanner tenantId={activeTenantId} channelAssigned={assignedChannels.length > 0} />

      {/* ── Agent profile hero + channels ── */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
            <Bot size={28} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className={cn(
                "text-lg font-semibold",
                config.persona.name
                  ? "text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-400 dark:text-neutral-500 italic"
              )}>
                {config.persona.name || t("profile.notConfigured")}
              </h2>
              {isDefault && (
                <Badge variant="secondary" className="text-[11px] bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400">
                  <Star size={10} className="mr-1" /> {t("defaultAgent")}
                </Badge>
              )}
              <Badge
                variant={config.isActive ? "default" : "secondary"}
                className={cn("text-[11px]",
                  config.isActive
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                    : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                )}
              >
                {config.isActive ? t("profile.active") : t("profile.inactive")}
              </Badge>
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
              {config.persona.role || t("profile.noRoleDefined")}
            </p>
          </div>
        </div>

        {/* Channel assignment — inline */}
        <div className="mt-4 pt-4 border-t border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
              {t("channelAssignment")}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_CHANNELS.map(ch => {
              const meta = CHANNEL_META[ch];
              if (!meta) return null;
              const Icon = meta.icon;
              const isAssigned = assignedChannels.includes(ch);
              const owner = getChannelOwner(ch);

              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleChannel(ch)}
                  className={cn(
                    "inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-all",
                    isAssigned
                      ? "border-indigo-500 bg-indigo-500/5 dark:bg-indigo-500/10 ring-1 ring-indigo-500"
                      : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600"
                  )}
                >
                  <Icon size={16} className={meta.color} />
                  <span className={cn(
                    "font-medium",
                    isAssigned ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-600 dark:text-neutral-400"
                  )}>
                    {meta.label}
                  </span>
                  {isAssigned && <CheckCircle size={14} className="text-indigo-500" />}
                  {owner && isAssigned && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                      <AlertTriangle size={10} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {assignedChannels.some(ch => getChannelOwner(ch)) && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
              <AlertTriangle size={12} />
              {t("willReassignFrom")} {assignedChannels
                .filter(ch => getChannelOwner(ch))
                .map(ch => getChannelOwner(ch)?.name || t("unnamedAgent"))
                .join(", ")}
            </p>
          )}
        </div>
      </div>

      {/* ── Prompt mode ── */}
      {mode === "prompt" && (
        <CustomPromptMode
          customPrompt={customPrompt}
          onChangePrompt={setCustomPrompt}
          saving={saving}
          onSave={handleSave}
          saveLabel={tc("saveChanges")}
          savingLabel={tc("saving")}
        />
      )}

      {/* ── Tab navigation ── */}
      <TabNav
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        className="mb-0"
      />

      <div className="rounded-b-xl border border-t-0 border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-6 min-h-[400px]">
        {activeTab === "persona" && (
          <PersonaTab config={config} onChange={updateConfig} />
        )}

        {activeTab === "instructions" && (
          <BehaviorSection config={config} onChange={updateConfig} />
        )}

        {activeTab === "tools" && (
          <div className="py-6">
            <CapabilitiesSection
              config={config}
              onChange={updateConfig}
              apptReadiness={apptReadiness}
            />
          </div>
        )}

        {activeTab === "schedule" && (
          <div className="py-6">
            <ScheduleCard config={config} onChange={updateConfig} />
          </div>
        )}
      </div>

      {/* ── Template Picker Modal ── */}
      {showTemplatePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowTemplatePicker(false)}>
          <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 max-w-lg w-full mx-4 shadow-xl max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800">
              <div>
                <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t("changeTemplate") || "Change Template"}</h3>
                <p className="text-xs text-neutral-500 mt-0.5">{t("changeTemplateDesc") || "Apply a template."}</p>
              </div>
              <button type="button" onClick={() => setShowTemplatePicker(false)} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {templates.map(tpl => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className="text-left rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 p-4 hover:border-indigo-400 dark:hover:border-indigo-500/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Bot size={16} className="text-indigo-500" />
                    <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{tpl.name}</span>
                  </div>
                  {tpl.description && (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">{tpl.description}</p>
                  )}
                </button>
              ))}
              {templates.length === 0 && (
                <p className="col-span-2 text-center text-sm text-neutral-400 py-8">{tc("loading")}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Sticky Save Bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur-sm px-6 py-3 flex items-center justify-end gap-3">
        <span className="text-xs text-neutral-400 mr-auto">{t("title")}</span>
        <Link
          href={`/admin/agent/${agentId}/test`}
          className="px-4 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 text-sm font-medium no-underline flex items-center gap-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
        >
          <TestTube2 size={14} /> {t("testAgent")}
        </Link>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "px-5 py-2 rounded-lg border-none text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5 transition-colors",
            saving ? "bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed" : "bg-indigo-500 hover:bg-indigo-600"
          )}
        >
          <Save size={14} /> {saving ? tc("saving") : tc("saveChanges")}
        </button>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={cn(
          "fixed bottom-6 right-6 px-5 py-3 rounded-lg text-white text-sm font-semibold shadow-lg z-[9999] flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2",
          toast.includes("Error") || toast.includes("error") ? "bg-red-500" : "bg-emerald-500"
        )}>
          {toast.includes("Error") || toast.includes("error") ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
          {toast}
        </div>
      )}
    </div>
  );
}
