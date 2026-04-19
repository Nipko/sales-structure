"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Bot, Plus, Copy, MoreVertical, Star, Trash2,
  MessageSquare, Instagram, Facebook, Send, Phone,
  Clock, Shield, Wrench, BookmarkPlus, CheckCircle, AlertTriangle, X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SetupBanner } from "@/components/SetupBanner";
import { Badge } from "@/components/ui/badge";

// ── Channel metadata ────────────────────────────────────────

const CHANNEL_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  whatsapp:  { label: "WhatsApp",  icon: MessageSquare, color: "text-emerald-500" },
  instagram: { label: "Instagram", icon: Instagram,     color: "text-pink-500" },
  messenger: { label: "Facebook",  icon: Facebook,      color: "text-blue-500" },
  telegram:  { label: "Telegram",  icon: Send,          color: "text-sky-500" },
  sms:       { label: "SMS",       icon: Phone,         color: "text-violet-500" },
};

// ── Types ───────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  role?: string;
  is_active: boolean;
  is_default: boolean;
  channels: string[];
  schedule_mode?: string;
  config_json?: any;
  rule_count?: number;
  tool_count?: number;
}

interface PlanFeatures {
  maxAgents: number;
  templates: boolean;
  customPrompt: boolean;
}

interface AgentTemplate {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  config_json?: any;
  is_builtin: boolean;
}

const STARTER_LIMITS: PlanFeatures = { maxAgents: 1, templates: false, customPrompt: false };

// ── Component ───────────────────────────────────────────────

export default function AgentListPage() {
  const t = useTranslations("agent");
  const tc = useTranslations("common");
  const { activeTenantId } = useTenant();
  const router = useRouter();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [planFeatures, setPlanFeatures] = useState<PlanFeatures>(STARTER_LIMITS);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // ── Load agents + plan ─────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      const [agentsRes, planRes] = await Promise.all([
        api.listAgents(activeTenantId),
        api.getPlanFeatures(activeTenantId).catch(() => null),
      ]);
      if (agentsRes?.success && Array.isArray(agentsRes.data)) {
        setAgents(agentsRes.data);
      }
      if (planRes?.success && planRes.data) {
        setPlanFeatures(planRes.data);
      }
    } catch {
      // fallback: empty state
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Toast auto-dismiss ─────────────────────────────────────

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  // ── Actions ────────────────────────────────────────────────

  function handleNewAgent() {
    if (agents.length >= planFeatures.maxAgents) {
      setShowUpgradeModal(true);
      return;
    }
    openTemplatePicker();
  }

  async function openTemplatePicker() {
    setShowTemplatePicker(true);
    if (templates.length === 0 && activeTenantId) {
      setTemplatesLoading(true);
      try {
        const res = await api.listAgentTemplates(activeTenantId);
        if (res?.success && Array.isArray(res.data)) {
          setTemplates(res.data);
        }
      } catch {
        // no templates available
      } finally {
        setTemplatesLoading(false);
      }
    }
  }

  async function handleCreateFromTemplate(template: AgentTemplate) {
    if (!activeTenantId) return;
    try {
      const res = await api.createAgent(activeTenantId, {
        name: template.name,
        templateId: template.id,
        configJson: template.config_json || {},
        channels: agents.length === 0 ? ['whatsapp', 'instagram', 'messenger', 'telegram', 'sms'] : [],
        isDefault: agents.length === 0,
      });
      if (res?.success && res.data) {
        const newId = res.data.id || res.data[0]?.id;
        if (newId) {
          setShowTemplatePicker(false);
          router.push(`/admin/agent/${newId}`);
        } else {
          // Agent created but no ID returned — reload list
          setShowTemplatePicker(false);
          loadData();
          setToast({ message: t("agentCreated") || "Agent created", type: "success" });
        }
      } else {
        setToast({ message: (res as any)?.error || (res as any)?.message || t("errorCreatingAgent"), type: "error" });
      }
    } catch (err: any) {
      console.error("Create agent error:", err);
      setToast({ message: err?.message || t("errorCreatingAgent"), type: "error" });
    }
  }

  async function handleDuplicate(agentId: string) {
    if (!activeTenantId) return;
    if (agents.length >= planFeatures.maxAgents) {
      setShowUpgradeModal(true);
      return;
    }
    try {
      const res = await api.duplicateAgent(activeTenantId, agentId);
      if (res?.success) {
        setToast({ message: t("agentDuplicated"), type: "success" });
        loadData();
      } else {
        setToast({ message: (res as any)?.error || t("errorDuplicatingAgent"), type: "error" });
      }
    } catch {
      setToast({ message: t("errorDuplicatingAgent"), type: "error" });
    }
    setMenuOpen(null);
  }

  async function handleSetDefault(agentId: string) {
    if (!activeTenantId) return;
    try {
      const res = await api.updateAgent(activeTenantId, agentId, { isDefault: true });
      if (res?.success) {
        setToast({ message: t("defaultUpdated"), type: "success" });
        loadData();
      }
    } catch {
      setToast({ message: t("errorUpdatingAgent"), type: "error" });
    }
    setMenuOpen(null);
  }

  async function handleDelete(agentId: string) {
    if (!activeTenantId) return;
    const agent = agents.find(a => a.id === agentId);
    if (agent?.is_default) {
      setToast({ message: t("cannotDeleteDefault"), type: "error" });
      setMenuOpen(null);
      return;
    }
    try {
      const res = await api.deleteAgent(activeTenantId, agentId);
      if (res?.success) {
        setToast({ message: t("agentDeleted"), type: "success" });
        loadData();
      } else {
        setToast({ message: (res as any)?.error || t("errorDeletingAgent"), type: "error" });
      }
    } catch {
      setToast({ message: t("errorDeletingAgent"), type: "error" });
    }
    setMenuOpen(null);
  }

  async function handleSaveAsTemplate(agentId: string) {
    if (!activeTenantId) return;
    const agent = agents.find(a => a.id === agentId);
    try {
      const res = await api.saveAgentAsTemplate(
        activeTenantId,
        agentId,
        t("templateName", { name: agent?.name || t("title") }),
        t("templateDescription", { name: agent?.name || t("title") })
      );
      if (res?.success) {
        setToast({ message: t("templateSaved"), type: "success" });
        setTemplates([]); // reset cache
      } else {
        setToast({ message: (res as any)?.error || t("errorSavingTemplate"), type: "error" });
      }
    } catch {
      setToast({ message: t("errorSavingTemplate"), type: "error" });
    }
    setMenuOpen(null);
  }

  // ── Setup banner check ─────────────────────────────────────

  const TEMPLATE_NAMES = [
    "Sales Advisor", "Support Agent", "FAQ Assistant",
    "Scheduling Assistant", "Qualification Assistant", "Blank Agent",
    "Default Agent",
  ];
  const needsPersonalization = agents.length > 0 && agents.every(a => {
    const name = a.name || a.config_json?.persona?.name || "";
    return TEMPLATE_NAMES.includes(name) || name === "";
  });
  const needsSetup = agents.length === 0 || needsPersonalization;

  // ── Schedule summary ───────────────────────────────────────

  function getScheduleSummary(agent: Agent): string {
    if (agent.schedule_mode === "24/7" || !agent.config_json?.hours?.schedule) {
      return "24/7";
    }
    const schedule = agent.config_json.hours.schedule;
    const activeDays = Object.values(schedule).filter((v: any) => v !== null).length;
    if (activeDays === 7) {
      const allSame = Object.values(schedule).every((v: any) => {
        if (!v) return false;
        const first = Object.values(schedule).find((f: any) => f !== null) as any;
        return v && (v as any).start === first.start && (v as any).end === first.end;
      });
      if (allSame) {
        const sample = Object.values(schedule).find((v: any) => v !== null) as any;
        return t("scheduleDaily", { start: sample.start, end: sample.end });
      }
    }
    return t("scheduleDaysPerWeek", { count: activeDays });
  }

  // ── Loading state ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <Bot size={40} className="text-indigo-500 mx-auto mb-3" />
          <div className="text-neutral-500 dark:text-neutral-400 text-sm">
            {t("loading")}
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────

  if (agents.length === 0) {
    return (
      <div>
        <PageHeader
          icon={Bot}
          title={t("listTitle")}
          subtitle={t("listSubtitle")}
        />
        <SetupBanner show onAction={handleNewAgent} />
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-4">
            <Bot size={32} className="text-indigo-500" />
          </div>
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            {t("noAgents")}
          </h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6 text-center max-w-md">
            {t("noAgentsDesc")}
          </p>
          <button
            type="button"
            onClick={handleNewAgent}
            className="px-5 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5 transition-colors"
          >
            <Plus size={16} /> {t("createFirst")}
          </button>
        </div>

        {/* Template picker modal */}
        {showTemplatePicker && (
          <TemplatePickerModal
            templates={templates}
            loading={templatesLoading}
            onSelect={handleCreateFromTemplate}
            onClose={() => setShowTemplatePicker(false)}
            onDeleteTemplate={async (id) => {
              if (!activeTenantId) return;
              await api.deleteAgentTemplate(activeTenantId, id);
              setTemplates(prev => prev.filter(t => t.id !== id));
            }}
            t={t}
          />
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        icon={Bot}
        title={t("listTitle")}
        subtitle={t("listSubtitle")}
        action={
          <button
            type="button"
            onClick={handleNewAgent}
            className="px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5 transition-colors"
          >
            <Plus size={16} /> {t("newAgent")}
          </button>
        }
      />

      <SetupBanner show={needsSetup} onAction={() => {
        const first = agents[0];
        if (first) router.push(`/admin/agent/${first.id}`);
        else handleNewAgent();
      }} />

      {/* Agent count */}
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
        {agents.length} {t("of")} {planFeatures.maxAgents} {t("agentsCount")}
      </p>

      {/* Agent grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agents.map(agent => (
          <AgentCard
            key={agent.id}
            agent={agent}
            scheduleSummary={getScheduleSummary(agent)}
            menuOpen={menuOpen === agent.id}
            onMenuToggle={() => setMenuOpen(prev => prev === agent.id ? null : agent.id)}
            onEdit={() => router.push(`/admin/agent/${agent.id}`)}
            onDuplicate={() => handleDuplicate(agent.id)}
            onSetDefault={() => handleSetDefault(agent.id)}
            onSaveAsTemplate={() => handleSaveAsTemplate(agent.id)}
            onDelete={() => handleDelete(agent.id)}
            t={t}
          />
        ))}
      </div>

      {/* Template picker modal */}
      {showTemplatePicker && (
        <TemplatePickerModal
          templates={templates}
          loading={templatesLoading}
          onSelect={handleCreateFromTemplate}
          onClose={() => setShowTemplatePicker(false)}
          onDeleteTemplate={async (id) => {
            if (!activeTenantId) return;
            await api.deleteAgentTemplate(activeTenantId, id);
            setTemplates(prev => prev.filter(t => t.id !== id));
          }}
          t={t}
        />
      )}

      {/* Upgrade modal */}
      {showUpgradeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowUpgradeModal(false)}
        >
          <div
            className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-6 max-w-sm w-full mx-4 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle size={24} className="text-amber-500" />
              </div>
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                {t("agentLimitReached")}
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-5">
                {t("agentLimitDesc")}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowUpgradeModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-sm font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                >
                  {tc("cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUpgradeModal(false);
                    router.push("/admin/settings");
                  }}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold cursor-pointer transition-colors"
                >
                  {t("upgradePlan")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 px-5 py-3 rounded-lg text-white text-sm font-semibold shadow-lg z-[9999] flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2",
            toast.type === "error" ? "bg-red-500" : "bg-emerald-500"
          )}
        >
          {toast.type === "error" ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ── Agent Card ───────────────────────────────────────────────

interface AgentCardProps {
  agent: Agent;
  scheduleSummary: string;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onSetDefault: () => void;
  onSaveAsTemplate: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}

function AgentCard({
  agent, scheduleSummary, menuOpen,
  onMenuToggle, onEdit, onDuplicate, onSetDefault, onSaveAsTemplate, onDelete, t,
}: AgentCardProps) {
  const ruleCount = agent.rule_count ?? 0;
  const hasAppointments = agent.config_json?.tools?.appointments?.enabled;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors">
      {/* Top row: status + name + default badge */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 mt-0.5">
          <Bot size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "w-2 h-2 rounded-full shrink-0",
                agent.is_active ? "bg-emerald-500" : "bg-neutral-400"
              )}
            />
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {agent.name || t("unnamedAgent")}
            </h3>
            {agent.is_default && (
              <Badge
                variant="secondary"
                className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400"
              >
                {t("default")}
              </Badge>
            )}
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
            {agent.role || t("noRole")}
          </p>
        </div>
      </div>

      {/* Channel pills */}
      {agent.channels && agent.channels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {agent.channels.map(ch => {
            const meta = CHANNEL_META[ch];
            if (!meta) return null;
            const Icon = meta.icon;
            return (
              <span
                key={ch}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs text-neutral-600 dark:text-neutral-300"
              >
                <Icon size={12} className={meta.color} />
                {meta.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Summary row */}
      <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400 mb-4">
        <span className="flex items-center gap-1">
          <Clock size={12} /> {scheduleSummary}
        </span>
        <span className="flex items-center gap-1">
          <Shield size={12} /> {ruleCount} {t("rules")}
        </span>
        {hasAppointments && (
          <span className="flex items-center gap-1">
            <Wrench size={12} /> {t("appointmentsOn")}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-sm font-semibold text-neutral-700 dark:text-neutral-200 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors text-center"
        >
          {t("edit")}
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          className="px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
          title={t("duplicate")}
        >
          <Copy size={16} />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={onMenuToggle}
            className="px-2 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
          >
            <MoreVertical size={16} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={onMenuToggle} />
              <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg py-1">
                <button
                  type="button"
                  onClick={onSaveAsTemplate}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer text-left"
                >
                  <BookmarkPlus size={14} /> {t("saveAsTemplate")}
                </button>
                {!agent.is_default && (
                  <button
                    type="button"
                    onClick={onSetDefault}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer text-left"
                  >
                    <Star size={14} /> {t("setAsDefault")}
                  </button>
                )}
                {!agent.is_default && (
                  <button
                    type="button"
                    onClick={onDelete}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer text-left"
                  >
                    <Trash2 size={14} /> {t("deleteAgent")}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Template Picker Modal ────────────────────────────────────

interface TemplatePickerModalProps {
  templates: AgentTemplate[];
  loading: boolean;
  onSelect: (template: AgentTemplate) => void;
  onClose: () => void;
  onDeleteTemplate: (id: string) => Promise<void>;
  t: ReturnType<typeof useTranslations>;
}

function TemplatePickerModal({
  templates, loading, onSelect, onClose, onDeleteTemplate, t,
}: TemplatePickerModalProps) {
  const builtIn = templates.filter(tp => tp.is_builtin);
  const userTemplates = templates.filter(tp => !tp.is_builtin);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 max-w-2xl w-full mx-4 shadow-xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 dark:border-neutral-800">
          <div>
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {t("chooseTemplate")}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              {t("chooseTemplateDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-sm text-neutral-500 dark:text-neutral-400">
                {t("loading")}
              </div>
            </div>
          ) : (
            <>
              {builtIn.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
                    {t("builtInTemplates")}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {builtIn.map(tp => (
                      <TemplateCard key={tp.id} template={tp} onSelect={onSelect} t={t} />
                    ))}
                  </div>
                </div>
              )}

              {userTemplates.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
                    {t("myTemplates")}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {userTemplates.map(tp => (
                      <TemplateCard
                        key={tp.id}
                        template={tp}
                        onSelect={onSelect}
                        onDelete={() => onDeleteTemplate(tp.id)}
                        t={t}
                      />
                    ))}
                  </div>
                </div>
              )}

              {templates.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {t("noTemplates")}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Template Card ────────────────────────────────────────────

interface TemplateCardProps {
  template: AgentTemplate;
  onSelect: (template: AgentTemplate) => void;
  onDelete?: () => void;
  t: ReturnType<typeof useTranslations>;
}

// Map built-in template IDs to i18n keys
const TPL_I18N: Record<string, { name: string; desc: string }> = {
  tpl_sales: { name: "tplSalesName", desc: "tplSalesDesc" },
  tpl_support: { name: "tplSupportName", desc: "tplSupportDesc" },
  tpl_faq: { name: "tplFaqName", desc: "tplFaqDesc" },
  tpl_appointments: { name: "tplAppointmentsName", desc: "tplAppointmentsDesc" },
  tpl_lead_qualifier: { name: "tplLeadQualifierName", desc: "tplLeadQualifierDesc" },
  tpl_blank: { name: "tplBlankName", desc: "tplBlankDesc" },
};

function TemplateCard({ template, onSelect, onDelete, t }: TemplateCardProps) {
  const i18nKeys = template.is_builtin ? TPL_I18N[template.id] : null;
  const displayName = i18nKeys ? t(i18nKeys.name) : template.name;
  const displayDesc = i18nKeys ? t(i18nKeys.desc) : template.description;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 p-4 hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
          <Bot size={16} className="text-indigo-500" />
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded text-neutral-400 hover:text-red-500 cursor-pointer transition-colors"
            title={t("deleteTemplate")}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <h5 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-0.5">
        {displayName}
      </h5>
      {displayDesc && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3 line-clamp-2">
          {displayDesc}
        </p>
      )}
      <button
        type="button"
        onClick={() => onSelect(template)}
        className="w-full px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold cursor-pointer transition-colors"
      >
        {t("useTemplate")}
      </button>
    </div>
  );
}
