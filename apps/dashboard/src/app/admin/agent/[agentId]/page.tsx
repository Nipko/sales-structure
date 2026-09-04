"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  Bot, User, Shield, Wrench, Save, CheckCircle, AlertTriangle,
  ArrowLeft, MoreVertical, BookmarkPlus, Star, Clock, TestTube2,
  MessageSquare, Instagram, Facebook, Send, X, Globe2, Plug,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { Badge } from "@/components/ui/badge";
import { HelpPanel } from "@/components/ui/help-panel";
import { AgentReadinessBanner } from "@/components/AgentReadinessBanner";
import { requestQualityHealthRefresh } from "@/lib/quality-health-events";
import { guidedTourAnchorId } from "@/lib/guided-tours";

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
  web_widget:{ label: "Chat web",  icon: Globe2,        color: "text-violet-500" },
  // `sms` is deliberately absent: SMS is a one-way notification product, never a
  // conversational channel an agent can be assigned to.
};

/**
 * Order the chips are shown in. Only types that actually have a CONNECTED
 * account are rendered — offering "assign Instagram" for a channel nobody
 * connected is exactly what leaves the agent with a critical connection
 * failure while the owner believes the setup is done.
 */
const CHANNEL_ORDER = ["whatsapp", "instagram", "messenger", "telegram", "web_widget"];

// ── Deep links from the quality center: ?tab=<id>&focus=<field> ──

type FocusField = "name" | "role" | "greeting" | "fallback" | "rules" | "handoff" | "channels" | "active";

const FOCUS_TAB: Record<FocusField, string | null> = {
  name: "persona",
  role: "persona",
  greeting: "persona",
  fallback: "persona",
  rules: "instructions",
  handoff: "instructions",
  channels: null,   // lives in the hero, above the tabs
  active: null,
};

const FOCUS_ANCHOR: Record<FocusField, string> = {
  name: "agent-name",
  role: "agent-name",
  greeting: "agent-greeting",
  fallback: "agent-fallback",
  rules: "agent-rules",
  handoff: "agent-handoff-triggers",
  channels: "agent-channels",
  active: "agent-active",
};

const TAB_IDS = ["persona", "instructions", "tools", "schedule"];

function isFocusField(value: string | null): value is FocusField {
  return !!value && value in FOCUS_TAB;
}

/** Fields the editor (and the API) require before an agent can be saved. */
export type AgentFieldErrors = Partial<Record<FocusField, string>>;

// A connected account of a channel (from /channels/overview).
interface ChannelAccountLite { channelType: string; accountId: string; displayName?: string }

// Binding key that ties an agent to a SPECIFIC connected account.
const bindingKey = (type: string, accountId: string) => `${type}:${accountId}`;

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
  channel_bindings?: string[];
  schedule_mode?: string;
  config_json: PersonaConfig;
}

// ── Component ────────────────────────────────────────────────

export default function AgentEditorPage() {
  const t = useTranslations("agent");
  const tc = useTranslations("common");
  const tt = useTranslations("agent.tabs");
  const th = useTranslations("help");
  const { activeTenantId } = useTenant();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentId = params.agentId as string;
  const heroRef = useRef<HTMLDivElement | null>(null);

  const [activeTab, setActiveTab] = useState("persona");
  const [mode, setMode] = useState<"guided" | "prompt">("guided");
  const [config, setConfig] = useState<PersonaConfig>(structuredClone(defaultConfig));
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [activePending, setActivePending] = useState(false);
  const [confirmActive, setConfirmActive] = useState<null | boolean>(null);
  const [fieldErrors, setFieldErrors] = useState<AgentFieldErrors>({});
  const [focusField, setFocusField] = useState<FocusField | null>(null);
  const [assignedChannels, setAssignedChannels] = useState<string[]>([]);
  const [assignedBindings, setAssignedBindings] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<ChannelAccountLite[]>([]);
  const [allAgents, setAllAgents] = useState<AgentData[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [qualityRefreshKey, setQualityRefreshKey] = useState(0);
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
      api.fetch('/channels/overview').catch(() => ({ data: [] })),
    ])
      .then(([agentRes, agentsRes, overviewRes]: any[]) => {
        const accts: ChannelAccountLite[] = Array.isArray(overviewRes?.data)
          ? overviewRes.data.map((a: any) => ({ channelType: a.channelType, accountId: a.accountId, displayName: a.displayName }))
          : [];
        setAccounts(accts);

        if (agentRes?.success && agentRes.data) {
          const data = agentRes.data;
          const configData = data.config_json || {};
          setConfig(deepMerge(structuredClone(defaultConfig), configData));
          setIsDefault(data.is_default ?? false);
          // The `agent_active` quality check reads the COLUMN, not
          // `config_json.isActive`; the hero must show the same truth.
          setIsActive(data.is_active !== false);
          if (configData._customPrompt) {
            setCustomPrompt(configData._customPrompt);
            setMode("prompt");
          }

          // Normalize the stored assignment against the CURRENT connected accounts so
          // the UI (and the next save) are consistent both ways:
          //  • a type with 2+ accounts uses per-account bindings (expand any legacy
          //    type-level channel into bindings for all its accounts);
          //  • a type with ≤1 account uses the type-level channel (fold any leftover
          //    binding back into `channels` so the assignment isn't lost when a second
          //    account gets disconnected).
          const srcChannels: string[] = data.channels || [];
          const srcBindings: string[] = data.channel_bindings || [];
          const countByType: Record<string, number> = {};
          for (const a of accts) countByType[a.channelType] = (countByType[a.channelType] || 0) + 1;
          const bindingTypes = srcBindings.map(b => b.split(":")[0]);
          // Drop anything that is not a certified conversational channel (`sms`
          // above all). The API rejects those on save, so keeping a legacy `sms`
          // assignment in state would make every save fail with a code the owner
          // has no control to clear.
          const allTypes = Array.from(new Set([...srcChannels, ...bindingTypes, ...Object.keys(countByType)]))
            .filter((type) => Boolean(CHANNEL_META[type]));
          const nextChannels: string[] = [];
          const nextBindings: string[] = [];
          for (const type of allTypes) {
            const cnt = countByType[type] || 0;
            const hadChannel = srcChannels.includes(type);
            const typeBindings = srcBindings.filter(b => b.split(":")[0] === type);
            if (cnt >= 2) {
              const keys = new Set(typeBindings);
              if (hadChannel) for (const a of accts.filter(x => x.channelType === type)) keys.add(bindingKey(type, a.accountId));
              nextBindings.push(...keys);
            } else if (hadChannel || typeBindings.length > 0) {
              nextChannels.push(type); // fold binding(s) → type-level
            }
          }
          setAssignedChannels(nextChannels);
          setAssignedBindings(nextBindings);
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

  function toggleBinding(key: string) {
    setAssignedBindings(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }

  function getBindingOwner(key: string): AgentData | undefined {
    return allAgents.find(a => a.id !== agentId && a.channel_bindings?.includes(key));
  }

  // Channel types with 2+ connected accounts are assigned per-account (bindings);
  // types with 0 or 1 keep the simple type-level toggle (backward compatible).
  const multiAccountTypes = (() => {
    const c: Record<string, number> = {};
    for (const a of accounts) c[a.channelType] = (c[a.channelType] || 0) + 1;
    return new Set(Object.keys(c).filter(t => c[t] >= 2));
  })();

  // Only channel types with a real, connected account are offered. A type the
  // agent still carries from an older assignment stays visible so it can be
  // unassigned instead of silently haunting the connection check.
  const connectedChannelTypes = (() => {
    const connected = new Set(accounts.map(a => a.channelType));
    const assignedTypes = new Set([
      ...assignedChannels,
      ...assignedBindings.map(b => b.split(":")[0]),
    ]);
    return CHANNEL_ORDER.filter(type =>
      CHANNEL_META[type] && (connected.has(type) || assignedTypes.has(type)));
  })();

  // ── Deep link: ?tab=<id>&focus=<field> ─────────────────────
  //
  // The quality center links straight to the field that fails. Landing on the
  // right tab is half the job; the other half is scrolling to the control and
  // ringing it, because "Revisar" that drops you at the top of a long form is
  // the same dead end as a page that says nothing.

  useEffect(() => {
    if (loading) return;
    const tab = searchParams.get("tab");
    const focus = searchParams.get("focus");
    const target = isFocusField(focus) ? focus : null;
    if (tab && TAB_IDS.includes(tab)) setActiveTab(tab);
    else if (target && FOCUS_TAB[target]) setActiveTab(FOCUS_TAB[target] as string);
    if (target) setFocusField(target);
  }, [loading, searchParams]);

  useEffect(() => {
    if (!focusField) return;
    const anchor = FOCUS_ANCHOR[focusField];
    // One frame so the tab we just selected has rendered its fields.
    const raf = window.requestAnimationFrame(() => {
      const element = document.getElementById(guidedTourAnchorId(anchor))
        ?? (focusField === "active" ? heroRef.current : null);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setFocusField(null), 4_000);
    return () => { window.cancelAnimationFrame(raf); window.clearTimeout(timer); };
  }, [focusField, activeTab]);

  const highlightCls = (field: FocusField) =>
    focusField === field ? "rounded-xl ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900" : "";

  // ── Validation (mirrors persona.service.updateAgent) ───────
  //
  // The editor used to save an agent with no name, no fallback, no rules and no
  // handoff reason, and the banner only said "1 critical blocker". Both halves
  // are fixed: we block the save AND we say which field.

  function validateAgent(): AgentFieldErrors {
    const errors: AgentFieldErrors = {};
    const filled = (value: unknown) => typeof value === "string" && value.trim().length > 0;
    const anyFilled = (list: unknown) => Array.isArray(list) && list.some((item) => filled(item));
    if (!filled(config.persona.name)) errors.name = t("validation.nameRequired");
    if (!filled(config.persona.role)) errors.role = t("validation.roleRequired");
    if (!filled(config.persona.fallbackMessage)) errors.fallback = t("validation.fallbackRequired");
    if (!anyFilled(config.behavior.rules)) errors.rules = t("validation.rulesRequired");
    if (!anyFilled(config.behavior.handoffTriggers)) errors.handoff = t("validation.handoffRequired");
    return errors;
  }

  /** Jump to the tab that owns the first invalid field so the message is visible. */
  function revealFirstError(errors: AgentFieldErrors) {
    const first = (Object.keys(errors) as FocusField[])[0];
    if (!first) return;
    const tab = FOCUS_TAB[first];
    if (tab) setActiveTab(tab);
    setFocusField(first);
  }

  // ── Active / inactive ──────────────────────────────────────

  async function applyActive(next: boolean) {
    if (!activeTenantId || !agentId) return;
    setConfirmActive(null);
    setActivePending(true);
    try {
      const res = await api.updateAgent(activeTenantId, agentId, { isActive: next });
      if (res?.success) {
        setIsActive(next);
        setConfig((prev) => ({ ...prev, isActive: next }));
        setToast(next ? t("activation.activated") : t("activation.deactivated"));
        window.setTimeout(requestQualityHealthRefresh, 1_500);
        setQualityRefreshKey((current) => current + 1);
      } else {
        setToast((res as any)?.error || tc("errorSaving"));
      }
    } catch {
      setToast(tc("errorSaving"));
    } finally {
      setActivePending(false);
    }
  }

  // ── Save ───────────────────────────────────────────────────

  async function handleSave() {
    if (!activeTenantId || !agentId) return;
    const errors = validateAgent();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      revealFirstError(errors);
      setToast(t("validation.blocked"));
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      // Multi-account types are driven by per-account bindings; keep them OUT of
      // the type-level `channels` so the type fallback doesn't claim every account.
      // A binding whose type is NOT multi-account (e.g. its second account was just
      // disconnected) is FOLDED into a type-level channel instead of being dropped —
      // otherwise the agent would silently lose that assignment on save.
      const bindingsToSave = assignedBindings.filter(b => multiAccountTypes.has(b.split(":")[0]));
      const foldedTypes = assignedBindings.map(b => b.split(":")[0]).filter(t => !multiAccountTypes.has(t));
      const channelsToSave = Array.from(new Set([
        ...assignedChannels.filter(t => !multiAccountTypes.has(t)),
        ...foldedTypes,
      ]));
      // `_personalizedAt` is what tells the agent list this agent was reviewed by
      // a person. Keying the "personalize your agent" banner on template NAMES
      // meant vertical tenants (almost all of them) never saw it.
      const base = { ...config, _personalizedAt: new Date().toISOString() };
      const configJson = mode === "prompt"
        ? { ...base, _customPrompt: customPrompt, _mode: "prompt" }
        : { ...base, _customPrompt: undefined, _mode: "wizard" };
      const payload: any = {
        configJson,
        channels: channelsToSave,
        channelBindings: bindingsToSave,
        isDefault,
      };
      const res = await api.updateAgent(activeTenantId, agentId, payload);
      if (res?.success) {
        setToast(t("savedSuccess"));
        setQualityRefreshKey((current) => current + 1);
        // The API recalculates signals asynchronously after agent.config.updated.
        // Refresh the global card/badge shortly after that reconciliation instead
        // of leaving the previous health snapshot visible for up to five minutes.
        window.setTimeout(requestQualityHealthRefresh, 1_500);
      } else if ((res as any)?.errorCode === "agent_invalid") {
        // The API enforces the same rules. Its `fields` list is not forwarded by
        // the HTTP wrapper today, so re-derive the per-field messages locally
        // instead of showing a bare code the person cannot act on.
        const remote: string[] = Array.isArray((res as any)?.fields) ? (res as any).fields : [];
        const local = validateAgent();
        const errors: AgentFieldErrors = Object.keys(local).length > 0
          ? local
          : remote.reduce<AgentFieldErrors>((acc, field) => {
              if (isFocusField(field)) acc[field] = t("validation.blocked");
              return acc;
            }, {});
        setFieldErrors(errors);
        revealFirstError(errors);
        setToast(t("validation.blocked"));
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
    setConfig(deepMerge(structuredClone(defaultConfig), {
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
              id={guidedTourAnchorId("agent-save")}
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

      <HelpPanel
        title={th("agentEditor.title")}
        description={th("agentEditor.description")}
        tips={th.raw("agentEditor.tips") as string[]}
        tourId="agent_handoff_rules"
      />

      {/* ── Resumen persistente del pasaporte de calidad ── */}
      <AgentReadinessBanner tenantId={activeTenantId} agentId={agentId} refreshKey={qualityRefreshKey} />

      {/* ── Agent profile hero + channels ── */}
      <div ref={heroRef} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 mb-6">
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
                variant={isActive ? "default" : "secondary"}
                className={cn("text-[11px]",
                  isActive
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                    : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                )}
              >
                {isActive ? t("profile.active") : t("profile.inactive")}
              </Badge>
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
              {config.persona.role || t("profile.noRoleDefined")}
            </p>
          </div>

          {/* Activo / Inactivo — the `agent_active` critical check had NO control
              anywhere in the panel: the owner saw "Inactivo" and a blocker that
              sent them to a page where nothing could be turned on. */}
          <div
            id={guidedTourAnchorId("agent-active")}
            className={cn("flex flex-col items-end gap-1 shrink-0 p-2", highlightCls("active"))}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {t("activation.label")}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              aria-label={t("activation.label")}
              disabled={activePending}
              onClick={() => setConfirmActive(!isActive)}
              className={cn(
                "relative w-12 h-6 rounded-full transition-colors cursor-pointer border-none",
                activePending && "opacity-60 cursor-not-allowed",
                isActive ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600",
              )}
            >
              <span className={cn(
                "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                isActive ? "translate-x-[26px]" : "translate-x-0.5",
              )} />
            </button>
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500 max-w-[190px] text-right leading-tight">
              {isActive ? t("activation.activeHint") : t("activation.inactiveHint")}
            </span>
          </div>
        </div>

        {/* Channel assignment — inline. Only CONNECTED accounts are offered. */}
        <div
          id={guidedTourAnchorId("agent-channels")}
          className={cn("mt-4 pt-4 border-t border-neutral-100 dark:border-neutral-800", highlightCls("channels"))}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
              {t("channelAssignment")}
            </span>
          </div>

          {connectedChannelTypes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t("noConnectedChannels")}</p>
              <p className="text-xs text-amber-700 dark:text-amber-300/80 mt-1">{t("noConnectedChannelsHint")}</p>
              <Link
                href="/admin/channels"
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold no-underline transition-colors"
              >
                <Plug size={14} /> {t("connectChannel")}
              </Link>
            </div>
          ) : (
          <div className="flex flex-wrap gap-2">
            {connectedChannelTypes.flatMap(ch => {
              const meta = CHANNEL_META[ch];
              if (!meta) return [];
              const Icon = meta.icon;
              const chipCls = (isAssigned: boolean) => cn(
                "inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-all",
                isAssigned
                  ? "border-indigo-500 bg-indigo-500/5 dark:bg-indigo-500/10 ring-1 ring-indigo-500"
                  : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600"
              );
              const labelCls = (isAssigned: boolean) => cn(
                "font-medium",
                isAssigned ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-600 dark:text-neutral-400"
              );

              // Multi-account type → one chip per connected account (per-connection binding).
              if (multiAccountTypes.has(ch)) {
                return accounts.filter(a => a.channelType === ch).map(a => {
                  const key = bindingKey(ch, a.accountId);
                  const isAssigned = assignedBindings.includes(key);
                  const owner = getBindingOwner(key);
                  return (
                    <button key={key} type="button" onClick={() => toggleBinding(key)} className={chipCls(isAssigned)}>
                      <Icon size={16} className={meta.color} />
                      <span className={labelCls(isAssigned)}>{meta.label}</span>
                      <span className="text-[11px] text-neutral-400 truncate max-w-[130px]">· {a.displayName || a.accountId}</span>
                      {isAssigned && <CheckCircle size={14} className="text-indigo-500" />}
                      {owner && isAssigned && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5"><AlertTriangle size={10} /></span>
                      )}
                    </button>
                  );
                });
              }

              // Single/no connected account → type-level toggle (backward compatible).
              const isAssigned = assignedChannels.includes(ch);
              const owner = getChannelOwner(ch);
              return [(
                <button key={ch} type="button" onClick={() => toggleChannel(ch)} className={chipCls(isAssigned)}>
                  <Icon size={16} className={meta.color} />
                  <span className={labelCls(isAssigned)}>{meta.label}</span>
                  {isAssigned && <CheckCircle size={14} className="text-indigo-500" />}
                  {owner && isAssigned && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5"><AlertTriangle size={10} /></span>
                  )}
                </button>
              )];
            })}
          </div>
          )}
          {(assignedChannels.some(ch => getChannelOwner(ch)) || assignedBindings.some(k => getBindingOwner(k))) && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
              <AlertTriangle size={12} />
              {t("willReassignFrom")} {[
                ...assignedChannels.filter(ch => getChannelOwner(ch)).map(ch => getChannelOwner(ch)?.name || t("unnamedAgent")),
                ...assignedBindings.filter(k => getBindingOwner(k)).map(k => getBindingOwner(k)?.name || t("unnamedAgent")),
              ].join(", ")}
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
          <PersonaTab config={config} onChange={updateConfig} errors={fieldErrors} focusField={focusField} />
        )}

        {activeTab === "instructions" && (
          <BehaviorSection config={config} onChange={updateConfig} errors={fieldErrors} focusField={focusField} />
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

      {/* ── Activate / deactivate confirmation ── */}
      {confirmActive !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setConfirmActive(null)}>
          <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 max-w-md w-full shadow-xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {confirmActive ? t("activation.confirmActivateTitle") : t("activation.confirmDeactivateTitle")}
            </h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5">
              {confirmActive ? t("activation.confirmActivateBody") : t("activation.confirmDeactivateBody")}
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setConfirmActive(null)}
                className="px-4 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-sm font-medium text-neutral-700 dark:text-neutral-200 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              >
                {tc("cancel")}
              </button>
              <button
                type="button"
                onClick={() => applyActive(confirmActive)}
                className={cn(
                  "px-4 py-2 rounded-lg border-none text-white text-sm font-semibold cursor-pointer transition-colors",
                  confirmActive ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-600 hover:bg-amber-700",
                )}
              >
                {confirmActive ? t("activation.confirmActivate") : t("activation.confirmDeactivate")}
              </button>
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
        {Object.keys(fieldErrors).length > 0 && (
          <span className="text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1">
            <AlertTriangle size={13} /> {t("validation.blocked")}
          </span>
        )}
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
