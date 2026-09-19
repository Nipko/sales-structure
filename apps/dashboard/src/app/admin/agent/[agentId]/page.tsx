"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { reviewModeFromWorkspace } from "@/lib/agent-review-mode";
import { isSessionInDayZero } from "@/lib/onboarding-session-facts";
import { demoLinkPause, readSetupStatusFacts, type DemoLinkPause } from "@/lib/onboarding-guide";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  Bot, User, Shield, Wrench, Save, CheckCircle, AlertTriangle,
  ArrowLeft, MoreVertical, BookmarkPlus, Star, Clock, TestTube2,
  MessageSquare, Instagram, Facebook, Send, X, Globe2, Plug,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { AgentAssessmentPanel } from "@/components/quality/AgentAssessmentPanel";
import { TabNav } from "@/components/ui/tab-nav";
import { Badge } from "@/components/ui/badge";
import { HelpPanel } from "@/components/ui/help-panel";
import { LoadFailureNotice } from "@/components/ui/load-failure";
import { AgentReadinessBanner } from "@/components/AgentReadinessBanner";
import { AGENT_CONFIGURATION_APPLIED_EVENT, requestQualityHealthRefresh } from "@/lib/quality-health-events";
import { guidedTourAnchorId } from "@/lib/guided-tours";
import { agentChannelAssignmentIssues, channelOverviewIsAuthoritative, normalizeAgentChannelAssignments } from "@/lib/agent-channel-assignment";
import type { AgentConfigurationWorkspace, AgentDraftBody, DiscardAgentDraftRequest } from '@parallext/shared';
import { AgentDraftStatus } from '@/components/quality/AgentDraftStatus';
import { agentDraftTestHref, prepareDraftSave, type DraftSaveAttempt } from '@/lib/agent-draft-save';

import type { PersonaConfig } from "../_types";
import { defaultConfig } from "../_types";
import { PersonaTab } from "../_components/PersonaTab";
import { BehaviorSection } from "../_components/BehaviorSection";
import { ScheduleCard } from "../_components/ScheduleCard";
import { CapabilitiesSection } from "../_components/CapabilitiesSection";
import { CustomPromptMode } from "../_components/CustomPromptMode";
import { PendingAgentChangesNotice, pendingAgentChanges } from "../_components/PendingAgentChangesNotice";
import { AskAssistChange } from "../_components/AskAssistChange";
import { AgentGuideCards } from "../_components/AgentGuideCards";

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

/** The API's `agent_invalid` field paths, in the editor's own field names. */
const SERVER_FIELD_TO_FOCUS: Record<string, FocusField> = {
  "persona.name": "name",
  "persona.role": "role",
  "persona.greeting": "greeting",
  "persona.fallbackMessage": "fallback",
  "behavior.rules": "rules",
  "behavior.handoffTriggers": "handoff",
};

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

// ── What the form edits ──────────────────────────────────────

/** Everything the editor turns into a save, as one value. */
interface EditorForm {
  config: PersonaConfig;
  mode: "guided" | "prompt";
  customPrompt: string;
  channels: string[];
  bindings: string[];
  isDefault: boolean;
}

/**
 * Which stored body the form edits.
 *
 * Reviewed mode is unchanged: the editor edits the draft when there is one.
 *
 * Immediate mode edits what is LIVE, even while an old draft saved before the
 * switch to immediate save is still stored. Those changes never reached the
 * agent. Showing them in the form would make the owner read them as her
 * agent's current behaviour, and her next Save would push all of them live
 * without her knowing they were there. So the form opens on the live agent,
 * the pending-changes line says the old changes exist, and they only reach the
 * form when she chooses "apply" (`view === "draft"`), which saves them through
 * the normal save path; if that save stops on a missing field, the form keeps
 * them so she can finish instead of losing them. Saving without applying saves
 * what she sees, and the old changes are left behind (the line says so). A
 * stale draft is never shown: its base moved, and applying it would roll back
 * whatever changed since — an agent switched on, a channel connected.
 */
function formBodyFor(workspace: AgentConfigurationWorkspace, view: "live" | "draft"): AgentDraftBody {
  if (!workspace.directCommit) return workspace.draft?.body ?? workspace.operational.body;
  if (view === "draft" && workspace.draft?.currentBase) return workspace.draft.body;
  return workspace.operational.body;
}

function formFromBody(data: AgentDraftBody, accounts: ChannelAccountLite[], overviewAvailable: boolean): EditorForm {
  const configData: any = data.configJson || {};
  const promptMode = (configData.editorMode ?? configData._mode) === "prompt";
  // Normalize the stored assignment against the CURRENT connected accounts so
  // the UI (and the next save) are consistent both ways:
  //  • a type with 2+ accounts uses per-account bindings (expand any legacy
  //    type-level channel into bindings for all its accounts);
  //  • a type with ≤1 account uses the type-level channel (fold any leftover
  //    binding back into `channels` so the assignment isn't lost when a second
  //    account gets disconnected).
  const normalized = normalizeAgentChannelAssignments({
    accounts,
    channels: data.channels || [],
    bindings: data.channelBindings || [],
    overviewAvailable,
    supportedTypes: CHANNEL_ORDER,
  });
  return {
    config: deepMerge(structuredClone(defaultConfig), configData),
    mode: promptMode ? "prompt" : "guided",
    customPrompt: promptMode ? (configData.customPrompt ?? configData._customPrompt ?? "") : "",
    channels: normalized.channels,
    bindings: normalized.bindings,
    isDefault: Boolean(data.isDefault),
  };
}

/** The sticky bar's explanation for a Save that is off; both Save buttons point at it. */
const SAVE_BLOCKED_REASON_ID = "agent-save-blocked-reason";

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

/**
 * The other agents that hold any of these connections: a channel type
 * (`whatsapp`) or one account (`whatsapp:<accountId>`). One agent serves each
 * connection; `activeOnly` keeps the agents that serve it right now.
 */
function connectionHolders(agents: AgentData[], selfId: string, channels: string[], bindings: string[], activeOnly = false): AgentData[] {
  return agents.filter(agent => agent.id !== selfId && (!activeOnly || agent.is_active)
    && (channels.some(channel => agent.channels?.includes(channel))
      || bindings.some(binding => agent.channel_bindings?.includes(binding))));
}

/** Everything the editor is built from, read together. */
interface EditorRead {
  state: AgentConfigurationWorkspace;
  agents: AgentData[];
  accounts: ChannelAccountLite[];
  overviewAvailable: boolean;
}

/**
 * The one read the editor is built from: the agent, who holds which channel,
 * and what is connected. On open, and again in place when Assist applies a
 * change to this agent. Throws without the agent or the agent list: an editor
 * built without them would offer a save the API has to refuse.
 */
async function readEditor(tenantId: string, agentId: string): Promise<EditorRead> {
  const [agentRes, agentsRes, overviewRes]: any[] = await Promise.all([
    api.getAgentConfiguration(tenantId, agentId),
    api.listAgents(tenantId),
    api.fetch('/channels/overview').catch(() => null),
  ]);
  if (!agentRes?.success || !agentRes.data
    || !agentsRes?.success || !Array.isArray(agentsRes.data)) {
    throw new Error('agent_editor_authority_unavailable');
  }
  const overviewAvailable = channelOverviewIsAuthoritative(overviewRes);
  const accounts: ChannelAccountLite[] = overviewAvailable
    ? overviewRes.data.map((a: any) => ({ channelType: a.channelType, accountId: a.accountId, displayName: a.displayName }))
    : [];
  return { state: agentRes.data, agents: agentsRes.data, accounts, overviewAvailable };
}

// ── Component ────────────────────────────────────────────────

export default function AgentEditorPage() {
  const t = useTranslations("agent");
  const tc = useTranslations("common");
  const tt = useTranslations("agent.tabs");
  const th = useTranslations("help");
  const tConfiguration = useTranslations("agentConfiguration");
  const tLearning = useTranslations("agentLearning");
  const tReleases = useTranslations('agentReleases');
  const tRegressions = useTranslations("qualityRegressions");
  const tPublications = useTranslations("agentPublications");
  const { activeTenantId } = useTenant();
  const { user } = useAuth();
  const { canEditAgent } = useRole();
  // Day 0 (until the agent's first real reply) the guided setup is the one
  // guide on screen. The quality passport named "1 bloqueo crítico" above an
  // amber box that said the same thing about channels — two guides for one
  // fact, and neither true about the agent's own link (audit #55). The channel
  // box stays, because it explains why there are no channels to tick.
  const dayZero = isSessionInDayZero(user);
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentId = params.agentId as string;
  const heroRef = useRef<HTMLDivElement | null>(null);
  const tDraft = useTranslations('agentDraft');
  const [workspace, setWorkspace] = useState<AgentConfigurationWorkspace | null>(null);
  const saveAttempt = useRef<DraftSaveAttempt | null>(null);
  const tPending = useTranslations("agentPendingChanges");
  // Immediate mode with changes saved before the switch: which body the form
  // shows (see `formBodyFor`) and what the pending-changes line is doing.
  const [pendingView, setPendingView] = useState<"live" | "draft">("live");
  const [pendingBusy, setPendingBusy] = useState<null | "apply" | "discard">(null);
  const [discardFailed, setDiscardFailed] = useState(false);
  const discardRequest = useRef<DiscardAgentDraftRequest | null>(null);
  const pending = pendingAgentChanges(workspace);
  // Immediate mode moves a channel only to an agent that is on: moving it to
  // one that is off would leave it with nobody. Reviewed mode keeps its line.
  const movesOnSave = !workspace?.directCommit || workspace.operational.body.isActive;

  const [activeTab, setActiveTab] = useState("persona");
  const [mode, setMode] = useState<"guided" | "prompt">("guided");
  const [config, setConfig] = useState<PersonaConfig>(structuredClone(defaultConfig));
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  // Assist's change was re-read into the form (see "Assist applied a change"
  // below); one quiet line says so until her next edit.
  const [assistApplied, setAssistApplied] = useState(false);
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  // A toast has a tone. Deciding the colour by grepping the text for "Error"
  // painted "Faltan datos obligatorios para guardar" green with a check mark.
  const [toastState, setToastState] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const toast = toastState?.message ?? null;
  const setToast = useCallback((message: string | null, tone: "success" | "error" = "success") => {
    setToastState(message ? { message, tone } : null);
  }, []);
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [activePending, setActivePending] = useState(false);
  const [confirmActive, setConfirmActive] = useState<null | boolean>(null);
  const [fieldErrors, setFieldErrors] = useState<AgentFieldErrors>({});
  const [focusField, setFocusField] = useState<FocusField | null>(null);
  const [assignedChannels, setAssignedChannels] = useState<string[]>([]);
  const [assignedBindings, setAssignedBindings] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<ChannelAccountLite[]>([]);
  const [channelOverviewAvailable, setChannelOverviewAvailable] = useState(false);
  const [allAgents, setAllAgents] = useState<AgentData[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [qualityRefreshKey, setQualityRefreshKey] = useState(0);
  const [apptReadiness, setApptReadiness] = useState<{ services: number; slots: number; loaded: boolean }>({
    services: 0, slots: 0, loaded: false,
  });

  // ── Load agent data ────────────────────────────────────────

  /** Puts a read on screen: the form, the workspace a save goes against, who holds which channel. */
  function showEditor({ state, agents, accounts: accts, overviewAvailable }: EditorRead): AgentDraftBody {
    setAccounts(accts);
    setChannelOverviewAvailable(overviewAvailable);
    setWorkspace(state);
    // Immediate mode opens on the live agent even with old changes
    // stored; see `formBodyFor`.
    const data = formBodyFor(state, "live");
    setLoadedVersion(state.operational.version);
    const form = formFromBody(data, accts, overviewAvailable);
    if (searchParams.get('draftDefault') === '1') form.isDefault = true;
    hydrateForm(form);
    // The `agent_active` quality check reads the COLUMN, not
    // `config_json.isActive`; the hero must show the same truth.
    setIsActive(state.operational.body.isActive);
    setAllAgents(agents);
    return data;
  }

  useEffect(() => {
    if (!activeTenantId || !agentId) return;
    setLoading(true);
    setLoadFailed(false);
    setChannelOverviewAvailable(false);
    setLoadedVersion(null); setExternalChange(false); setAssistApplied(false);
    setWorkspace(null); saveAttempt.current = null;
    setPendingView("live"); setPendingBusy(null); setDiscardFailed(false); discardRequest.current = null;
    let cancelled = false;

    readEditor(activeTenantId, agentId)
      .then((read) => {
        if (cancelled) return;
        const data = showEditor(read);
        if (searchParams.get('draftDefault') === '1' && !data.isDefault) setToast(tDraft(read.state.directCommit ? 'defaultNeedsSaveLive' : 'defaultNeedsSave'));
        setLoadFailed(false);
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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
      if (!svcRes?.success || !availRes?.success) {
        setApptReadiness({ services: 0, slots: 0, loaded: false });
        return;
      }
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

  // Fifteen minutes of edits were lost in the 14-sep recording by navigating
  // away after a save that had silently failed. Track dirtiness and guard both
  // the browser's unload and in-app links until the next successful save.
  const dirtyRef = useRef(false);
  // The same fact as state, for what the page shows: "Dime qué cambiar" waits
  // while there are unsaved edits, and a ref alone would not redraw it. Every
  // edit goes through here, so an in-place re-read (below) can trust it.
  const [dirty, setDirtyState] = useState(false);
  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirtyState(value);
    // Her next edit is newer than the change Assist applied: that line is done.
    if (value) setAssistApplied(false);
  }, []);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const onLinkClick = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") return;
      const href = anchor.getAttribute("href") || "";
      if (!href.startsWith("/") || href.startsWith(`/admin/agent/${agentId}`)) return;
      if (!window.confirm(t("unsavedLeaveConfirm"))) { event.preventDefault(); event.stopPropagation(); }
      else setDirty(false);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onLinkClick, true);
    };
  }, [agentId, t, setDirty]);

  // ── Assist applied a change to this agent ──────────────────
  //
  // With nothing unsaved, the editor re-reads the agent where it stands (the
  // same read as on load) and says the change is in. It used to raise "La
  // configuración cambió" and switch Save off, with "Descartar lo que
  // escribiste y recargar" as the only way out — over nothing written. With
  // unsaved edits the alert stays: a re-read would erase them. "Dime qué
  // cambiar" does not send in that state, so she only meets it when a change
  // arrives from somewhere else.
  useEffect(() => {
    if (!activeTenantId || !agentId) return;
    let cancelled = false;
    let reads = 0;
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.tenantId !== activeTenantId || detail?.agentId !== agentId) return;
      if (dirtyRef.current) { setExternalChange(true); return; }
      const read = ++reads;
      readEditor(activeTenantId, agentId)
        .then((result) => {
          if (cancelled || read !== reads) return;
          // She started writing while it was on its way: her edits win, and
          // the alert says the stored agent moved underneath them.
          if (dirtyRef.current) { setExternalChange(true); return; }
          saveAttempt.current = null;
          setPendingView("live");
          setFieldErrors({});
          showEditor(result);
          setExternalChange(false);
          setAssistApplied(true);
          setQualityRefreshKey((current) => current + 1);
        })
        // It could not show the new state: the page says it is behind.
        .catch(() => { if (!cancelled && read === reads) setExternalChange(true); });
    };
    window.addEventListener(AGENT_CONFIGURATION_APPLIED_EVENT, changed);
    return () => {
      cancelled = true;
      window.removeEventListener(AGENT_CONFIGURATION_APPLIED_EVENT, changed);
    };
  }, [activeTenantId, agentId]);

  const updateConfig = useCallback((updates: Partial<PersonaConfig>) => {
    setDirty(true);
    setConfig(prev => deepMerge(prev, updates));
  }, [setDirty]);

  function hydrateForm(form: EditorForm) {
    setConfig(form.config);
    setMode(form.mode);
    setCustomPrompt(form.customPrompt);
    setAssignedChannels(form.channels);
    setAssignedBindings(form.bindings);
    setIsDefault(form.isDefault);
  }

  function currentForm(): EditorForm {
    return { config, mode, customPrompt, channels: assignedChannels, bindings: assignedBindings, isDefault };
  }

  /** Re-read who holds which channel; the "Se reasignará de" line reads this list. */
  async function refreshAgents(): Promise<AgentData[] | null> {
    if (!activeTenantId) return null;
    try {
      const res = await api.listAgents(activeTenantId);
      if (res?.success && Array.isArray(res.data)) { setAllAgents(res.data); return res.data; }
    } catch { /* the line keeps what it knew */ }
    return null;
  }

  function agentNames(agents: AgentData[]): string {
    return Array.from(new Set(agents.map(agent => agent.name || t("unnamedAgent")))).join(", ");
  }

  /**
   * `agent_invalid` names the offending paths ("behavior.rules"); map them
   * onto the editor's fields so the message lands under a field. The local
   * check wins when it finds something, because it names the field in words.
   */
  function invalidFieldErrors(res: unknown, form: EditorForm): AgentFieldErrors {
    const fields = (res as { fields?: unknown })?.fields;
    const remote: string[] = (Array.isArray(fields) ? fields : [])
      .map((entry: any) => (typeof entry === "string" ? entry : entry?.path))
      .filter((path: unknown): path is string => typeof path === "string")
      .map((path: string) => SERVER_FIELD_TO_FOCUS[path] ?? path);
    const local = validateAgent(form);
    return Object.keys(local).length > 0
      ? local
      : remote.reduce<AgentFieldErrors>((acc, field) => {
          if (isFocusField(field)) acc[field] = t("validation.blocked");
          return acc;
        }, {});
  }

  // ── Channel assignment ─────────────────────────────────────

  function getChannelOwner(channel: string): AgentData | undefined {
    return allAgents.find(a => a.id !== agentId && a.channels?.includes(channel));
  }

  function toggleChannel(channel: string) {
    setDirty(true);
    setAssignedChannels(prev =>
      prev.includes(channel) ? prev.filter(c => c !== channel) : [...prev, channel]
    );
  }

  function toggleBinding(key: string) {
    setDirty(true);
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

  const assignmentIssues = agentChannelAssignmentIssues({
    accounts, channels: assignedChannels, bindings: assignedBindings,
    overviewAvailable: channelOverviewAvailable, supportedTypes: CHANNEL_ORDER,
  });

  /**
   * Whether the agent's public link is paused, for the one sentence that
   * mentions it: "Mientras tanto, cualquiera puede escribirle a tu agente
   * desde su enlace" under "Todavía no conectaste un canal". Read only while
   * that box is on screen. `null` = it answers, or nobody could tell — the
   * sentence it had before, as an API without the field means.
   */
  const noChannelConnected = channelOverviewAvailable && connectedChannelTypes.length === 0;
  const [linkPause, setLinkPause] = useState<DemoLinkPause | null>(null);
  useEffect(() => {
    if (!activeTenantId || !noChannelConnected) return;
    let current = true;
    api.getSetupStatus(activeTenantId)
      .then((res) => { if (current) setLinkPause(demoLinkPause(readSetupStatusFacts(res)?.demoLink)); })
      .catch(() => { /* unread: the sentence it had */ });
    return () => { current = false; };
  }, [activeTenantId, noChannelConnected]);

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

  // ── Validation (mirrors the canonical draft validator) ───────
  //
  // The editor used to save an agent with no name, no fallback, no rules and no
  // handoff reason, and the banner only said "1 critical blocker". Both halves
  // are fixed: we block the save AND we say which field.

  function validateAgent(form: EditorForm): AgentFieldErrors {
    const errors: AgentFieldErrors = {};
    const filled = (value: unknown) => typeof value === "string" && value.trim().length > 0;
    const anyFilled = (list: unknown) => Array.isArray(list) && list.some((item) => filled(item));
    const { config: candidate } = form;
    if (!filled(candidate.persona.name)) errors.name = t("validation.nameRequired");
    if (form.mode === "prompt") return errors;
    if (!filled(candidate.persona.role)) errors.role = t("validation.roleRequired");
    if (!filled(candidate.persona.fallbackMessage)) errors.fallback = t("validation.fallbackRequired");
    if (!anyFilled(candidate.behavior.rules)) errors.rules = t("validation.rulesRequired");
    if (!anyFilled(candidate.behavior.handoffTriggers)) errors.handoff = t("validation.handoffRequired");
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
    if (next && !workspace?.directCommit) { setToast(tDraft('activationReview'), "error"); return; }
    if (externalChange || loadedVersion === null) { setToast(tConfiguration('editorChanged'), "error"); return; }
    setConfirmActive(null);
    setActivePending(true);
    try {
      const res = await api.updateAgent(activeTenantId, agentId, { isActive: next, expectedVersion: loadedVersion });
      if (res?.success) {
        setLoadedVersion((res.data as any).version);
        setIsActive(next);
        const reread = await api.getAgentConfiguration(activeTenantId, agentId);
        if (reread.success && reread.data) setWorkspace(reread.data);
        setConfig((prev) => ({ ...prev, isActive: next }));
        setToast(next ? t("activation.activated") : t("activation.deactivated"));
        window.setTimeout(requestQualityHealthRefresh, 1_500);
        setQualityRefreshKey((current) => current + 1);
      } else if ((res as any)?.errorCode === "agent_connection_owned_by_other_agent") {
        // Another agent took one of its channels while it was off. Switching
        // it on would leave two agents on one channel, and that channel silent.
        const live = workspace?.operational.body;
        const owners = connectionHolders(await refreshAgents() ?? allAgents, agentId,
          live?.channels ?? [], live?.channelBindings ?? [], true);
        setToast(owners.length > 0
          ? t("activation.connectionOwned", { agents: agentNames(owners) })
          : t("activation.connectionOwnedUnknown"), "error");
      } else if ((res as any)?.errorCode === "agent_invalid" && workspace) {
        // What goes live must be complete, exactly as on a save.
        const errors = invalidFieldErrors(res, formFromBody(workspace.operational.body, accounts, channelOverviewAvailable));
        setFieldErrors(errors);
        revealFirstError(errors);
        setToast(t("activation.incomplete"), "error");
      } else {
        if ((res as any)?.errorCode === 'agent_version_conflict') setExternalChange(true);
        setToast((res as any)?.error || tc("errorSaving"), "error");
      }
    } catch {
      setToast(tc("errorSaving"), "error");
    } finally {
      setActivePending(false);
    }
  }

  // ── Save ───────────────────────────────────────────────────

  function handleSave() {
    // The Save button saves what the page shows, including the
    // "Se reasignará de …" line under the channels: those moves are promised.
    return saveForm(currentForm(), pendingView, { promiseMoves: true });
  }

  async function saveForm(form: EditorForm, view: "live" | "draft", { promiseMoves }: { promiseMoves: boolean }) {
    if (!activeTenantId || !agentId) return;
    if (!channelOverviewAvailable) { setToast(t('channelOverviewUnavailableHint'), "error"); return; }
    // Immediate mode refuses every save while a stale draft is stored; say
    // what to do about it instead of "the configuration changed".
    if (pending === "stale") { setToast(tPending("saveBlocked"), "error"); return; }
    if (externalChange || loadedVersion === null || !workspace || (workspace.draft && !workspace.draft.currentBase)) { setToast(tConfiguration('editorChanged'), "error"); return; }
    if (form.mode === "prompt" && !form.customPrompt.trim()) { setToast(tDraft('promptRequired'), "error"); return; }
    const errors = validateAgent(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      revealFirstError(errors);
      setToast(t("validation.blocked"), "error");
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
      const bindingsToSave = form.bindings.filter(b => multiAccountTypes.has(b.split(":")[0]));
      const foldedTypes = form.bindings.map(b => b.split(":")[0]).filter(t => !multiAccountTypes.has(t));
      const channelsToSave = Array.from(new Set([
        ...form.channels.filter(t => !multiAccountTypes.has(t)),
        ...foldedTypes,
      ]));
      const base = { ...form.config };
      const configJson = form.mode === "prompt"
        ? { ...base, customPrompt: form.customPrompt, editorMode: 'prompt', _customPrompt: form.customPrompt, _mode: "prompt" }
        : { ...base, customPrompt: undefined, editorMode: 'guided', _customPrompt: undefined, _mode: "wizard" };
      saveAttempt.current = prepareDraftSave(workspace, {
        ...formBodyFor(workspace, view), name: configJson.persona.name,
        configJson, channels: channelsToSave, channelBindings: bindingsToSave, isDefault: form.isDefault,
        // Immediate mode: this save IS the live agent, and switching it on or
        // off belongs to the switch in the hero. Old changes being applied
        // must never flip it.
        ...(workspace.directCommit ? { isActive: workspace.operational.body.isActive } : {}),
      }, saveAttempt.current);
      // Immediate mode keeps one agent per channel. A channel another agent
      // holds moves to this one only when the page said so (the line under the
      // channels); anything else — old changes applied with one click, a
      // channel someone took since this page loaded — is refused and named.
      // The consent authorises the commit, it is not content, so a retry
      // after that refusal reuses the same command with the move added.
      const reassignConnections = promiseMoves && movesOnSave && workspace.directCommit
        ? [...channelsToSave.filter(channel => getChannelOwner(channel)), ...bindingsToSave.filter(binding => getBindingOwner(binding))]
        : [];
      const request = reassignConnections.length > 0
        ? { ...saveAttempt.current.request, reassignConnections }
        : saveAttempt.current.request;
      const res = await api.saveAgentDraft(activeTenantId, agentId, request);
      if (res?.success && res.data) {
        const saved = res.data;
        setWorkspace(saved.workspace);
        setLoadedVersion(saved.workspace.operational.version);
        // Reviewed mode: what was saved must now be the draft. Immediate mode:
        // the commit clears the draft pointer in the same transaction, so the
        // saved revision is live and no draft remains. Comparing revision ids
        // there flagged every successful save as someone else's change and
        // switched Save off behind a "reload" warning.
        const savedIsCurrent = saved.workspace.directCommit
          ? !saved.workspace.draft
          : saved.savedRevision.id === saved.workspace.draft?.id;
        if (!savedIsCurrent) setExternalChange(true);
        saveAttempt.current = null;
        setDirty(false);
        setPendingView("live");
        setToast(tDraft(saved.workspace.directCommit ? 'savedLive' : 'saved'));
        // The other agent gave the channel away: the line has nothing left to say.
        if (reassignConnections.length > 0) void refreshAgents();
      } else if ((res as any)?.errorCode === "agent_connection_owned_by_other_agent") {
        // Nothing was saved. Show who holds it now; the line under the
        // channels appears, and Save again moves it as that line says.
        const owners = connectionHolders(await refreshAgents() ?? allAgents, agentId, channelsToSave, bindingsToSave, true);
        setToast(owners.length > 0
          ? tDraft("connectionOwned", { agents: agentNames(owners) })
          : tDraft("connectionOwnedUnknown"), "error");
      } else if (['agent_version_conflict', 'agent_operational_version_changed', 'agent_draft_revision_changed', 'agent_operational_configuration_changed'].includes((res as any)?.errorCode)) {
        setExternalChange(true); setToast(tConfiguration('editorChanged'), "error");
      } else if ((res as any)?.errorCode === "agent_invalid") {
        // The API enforces the same rules and names the offending paths; they
        // land under a field instead of in a toast nobody can act on.
        const errors = invalidFieldErrors(res, form);
        setFieldErrors(errors);
        revealFirstError(errors);
        setToast(t("validation.blocked"), "error");
      } else {
        setToast((res as any)?.error || tc("errorSaving"), "error");
      }
    } catch {
      setToast(tc("errorSaving"), "error");
    } finally {
      setSaving(false);
    }
  }

  // ── Changes saved before immediate save ────────────────────
  //
  // Apply goes through the same save path as the Save button, with the old
  // changes as the form; discard drops the stored pointer (its history stays)
  // and leaves the live agent untouched.

  async function applyPendingChanges() {
    if (!workspace?.draft || pending !== "pending" || pendingBusy || saving) return;
    setPendingBusy("apply");
    try {
      // She is already looking at them: "Guardar y aplicar" is the Save button.
      if (pendingView === "draft") { await handleSave(); return; }
      if (dirtyRef.current && !window.confirm(tPending("applyReplacesEdits"))) return;
      const form = formFromBody(workspace.draft.body, accounts, channelOverviewAvailable);
      form.config = { ...form.config, isActive: workspace.operational.body.isActive };
      hydrateForm(form);
      setPendingView("draft");
      setFieldErrors({});
      setDirty(true);
      // One click, and she has not seen these changes: nothing here promised
      // to take a channel from another agent. If they claim one, the save is
      // refused, the form stays on them with the line under the channels, and
      // "Guardar y aplicar" is the Save that moves it.
      await saveForm(form, "draft", { promiseMoves: false });
    } finally {
      setPendingBusy(null);
    }
  }

  async function discardPendingChanges() {
    if (!activeTenantId || !workspace?.draft || pending === "none" || pendingBusy || saving) return;
    const draft = workspace.draft;
    setPendingBusy("discard");
    setDiscardFailed(false);
    // A retry of the same discard reuses its key; another draft or base starts another.
    if (discardRequest.current?.expectedDraftRevision !== draft.id
      || discardRequest.current?.expectedOperationalHash !== workspace.operational.hash) {
      discardRequest.current = {
        requestKey: crypto.randomUUID(), expectedDraftRevision: draft.id,
        expectedOperationalVersion: workspace.operational.version, expectedOperationalHash: workspace.operational.hash,
      };
    }
    try {
      const result = await api.discardAgentDraft(activeTenantId, agentId, discardRequest.current);
      if (!result?.success || !result.data || result.data.draft) { setDiscardFailed(true); return; }
      discardRequest.current = null;
      saveAttempt.current = null;
      setWorkspace(result.data);
      setLoadedVersion(result.data.operational.version);
      // The form already shows the live agent, and her edits on top of it
      // stay. Only when she had opened the old changes does it go back.
      if (pendingView === "draft") {
        hydrateForm(formFromBody(result.data.operational.body, accounts, channelOverviewAvailable));
        setFieldErrors({});
        setDirty(false);
      }
      setPendingView("live");
      setToast(tPending("discarded"));
    } catch {
      setDiscardFailed(true);
    } finally {
      setPendingBusy(null);
    }
  }

  // ── Save as template ───────────────────────────────────────

  async function handleSaveAsTemplate() {
    if (!activeTenantId) return;
    // Reviewed mode only: in immediate mode the template copies the live
    // agent, which is what the form shows, and the old-draft message would
    // tell the owner to publish something.
    if (workspace?.draft && !workspace.directCommit) { setToast(tDraft('templateOperationalOnly')); setMenuOpen(false); return; }
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
    setDirty(true);
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
    if (externalChange || loadedVersion === null) { setToast(tConfiguration('editorChanged'), "error"); return; }
    setIsDefault(true); setDirty(true); setToast(tDraft(workspace?.directCommit ? 'defaultNeedsSaveLive' : 'defaultNeedsSave'));
    setMenuOpen(false);
  }

  // ── Computed values ────────────────────────────────────────

  const ruleCount = config.behavior.rules.filter(Boolean).length
    + config.behavior.forbiddenTopics.filter(Boolean).length
    + config.behavior.handoffTriggers.filter(Boolean).length;

  const enabledToolCount = Object.values(config.tools || {}).filter(
    (v: any) => v?.enabled === true
  ).length;

  // Save is never off without a reason on screen. A stale draft is the one
  // case with no other explanation visible next to the button.
  const saveBlockedReason = pending === "stale" ? tPending("saveBlocked") : null;
  const saveDisabled = saving || !workspace || externalChange || pendingBusy !== null
    || Boolean(workspace.draft && !workspace.draft.currentBase);
  // Immediate mode tests what answers customers: the live agent. An old
  // draft's revision would test changes the form is not showing.
  const testHref = workspace && !workspace.directCommit ? agentDraftTestHref(workspace) : `/admin/agent/${agentId}/test`;

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

  if (loadFailed) {
    return (
      <div className="pb-20">
        <PageHeader
          icon={Bot}
          title={t("title")}
          subtitle={t("subtitle")}
          breadcrumbs={
            <button type="button" onClick={() => router.push('/admin/agent')}
              className="inline-flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400">
              <ArrowLeft size={14} /> {t('backToAgents')}
            </button>
          }
        />
        <LoadFailureNotice onRetry={() => window.location.reload()} />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="pb-20">
      {/* Versions, candidates and the mission belong to reviewed changes. With
          immediate changes (the default) the editor is an editor. */}
      {workspace && !workspace.directCommit && <AgentDraftStatus workspace={workspace} tenantId={activeTenantId} />}
      {workspace && !workspace.directCommit && <AgentAssessmentPanel agentId={agentId} />}
      {pending !== "none" && (
        <PendingAgentChangesNotice
          state={pending}
          view={pendingView}
          busy={pendingBusy}
          saving={saving}
          discardFailed={discardFailed}
          onApply={() => void applyPendingChanges()}
          onDiscard={() => void discardPendingChanges()}
        />
      )}
      {/* The stored agent moved under this page. With edits nobody saved, a
          reload costs them and the button says so; without any (a re-read
          that failed, a switch refused as out of date) it is only a reload. */}
      {externalChange && <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <p>{dirty ? tConfiguration('editorChanged') : t('editorBehind.text')}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-2 min-h-10 rounded-lg border border-current px-3 py-2">{dirty ? tConfiguration('reloadEditor') : t('editorBehind.reload')}</button>
      </div>}
      {assistApplied && !externalChange && (
        <p role="status" data-assist-applied className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          <CheckCircle size={16} aria-hidden="true" className="flex-shrink-0" /> {t('askAssist.appliedInPlace')}
        </p>
      )}
      <PageHeader
        icon={Bot}
        title={config.persona.name || t("title")}
        subtitle={config.persona.role || t("subtitle")}
        breadcrumbs={
          <button
            type="button"
            onClick={() => { if (!dirtyRef.current || window.confirm(t("unsavedLeaveConfirm"))) { setDirty(false); router.push("/admin/agent"); } }}
            className="inline-flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer transition-colors"
          >
            <ArrowLeft size={14} /> {t("backToAgents")}
          </button>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {workspace && !workspace.directCommit && (
              <>
                <Link href={`/admin/agent/${agentId}/releases`} className="rounded-lg border px-3 py-2 text-sm font-medium">{tReleases('openWorkspace')}</Link>
                <Link href={`/admin/agent/${agentId}/publications`} className="rounded-lg border px-3 py-2 text-sm font-medium">{tPublications('openWorkspace')}</Link>
                <Link href={`/admin/agent/${agentId}/learning`} className="rounded-lg border px-3 py-2 text-sm font-medium">{tLearning('openWorkspace')}</Link>
                <Link href={`/admin/agent/${agentId}/regressions`} className="rounded-lg border px-3 py-2 text-sm font-medium">{tRegressions('openWorkspace')}</Link>
              </>
            )}
            <Link
              href={testHref}
              className="px-4 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 text-sm font-medium cursor-pointer flex items-center gap-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              title={t("testAgent")}
            >
              <TestTube2 size={16} /> {t("testAgent")}
            </Link>
            <button
              type="button"
              id={guidedTourAnchorId("agent-save")}
              onClick={handleSave}
              disabled={saveDisabled}
              aria-describedby={saveBlockedReason ? SAVE_BLOCKED_REASON_ID : undefined}
              className={cn(
                "px-5 py-2.5 rounded-lg border-none text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                saving
                  ? "bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed"
                  : "bg-indigo-500 hover:bg-indigo-600"
              )}
            >
              <Save size={16} /> {saving ? tc("saving") : (workspace?.directCommit ? tc("save") : tDraft('save'))}
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

      {/* Day 0: like the wizard, no help strip over the editor — the guided
          setup is the one guide, and "Dime qué cambiar" below is the way to
          ask. It comes back with the rest once the agent has answered. */}
      {!dayZero && (
        <HelpPanel
          title={th("agentEditor.title")}
          description={th("agentEditor.description")}
          tips={th.raw("agentEditor.tips") as string[]}
          tourId="agent_handoff_rules"
        />
      )}

      {/* ── Resumen persistente del pasaporte de calidad (after day 0; see `dayZero`) ── */}
      {!dayZero && <AgentReadinessBanner tenantId={activeTenantId} agentId={agentId} refreshKey={qualityRefreshKey} />}

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
              onClick={() => isActive ? setConfirmActive(false) : (workspace?.directCommit ? void applyActive(true) : setToast(tDraft('activationReview'), "error"))}
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

          {workspace && !workspace.directCommit && <p className="mb-3 text-xs text-neutral-500">{t("assignmentReview.draftScope")}</p>}
          {assignmentIssues.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10" role="status">
              <p className="text-sm font-semibold">{t("assignmentReview.title")}</p>
              <ul className="mt-2 space-y-2">
                {assignmentIssues.map(issue => (
                  <li key={`${issue.kind}:${issue.value}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="break-all">{t(`assignmentReview.${issue.reason}`, { assignment: issue.value })}</span>
                    {issue.kind === 'channel' && issue.reason === 'disconnected' && (
                      <Link href={`/admin/channels/${issue.value}`} className="min-h-8 rounded-md px-2 font-semibold underline">
                        {t("assignmentReview.connect")}
                      </Link>
                    )}
                    <button type="button" className="min-h-8 rounded-md px-2 font-semibold underline"
                      onClick={() => {
                        setDirty(true);
                        if (issue.kind === 'channel') setAssignedChannels(current => current.filter(value => value !== issue.value));
                        else setAssignedBindings(current => current.filter(value => value !== issue.value));
                      }}>
                      {t("assignmentReview.remove")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!channelOverviewAvailable ? (
            <div className="rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4" role="status">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t("channelOverviewUnavailable")}</p>
              <p className="text-xs text-amber-700 dark:text-amber-300/80 mt-1">{t("channelOverviewUnavailableHint")}</p>
            </div>
          ) : connectedChannelTypes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t("noConnectedChannels")}</p>
              <p className="text-xs text-amber-700 dark:text-amber-300/80 mt-1">
                {linkPause ? t(`noConnectedChannelsHintPaused.${linkPause}`) : t("noConnectedChannelsHint")}
              </p>
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
                    <button key={key} type="button" aria-pressed={isAssigned} onClick={() => toggleBinding(key)} className={chipCls(isAssigned)}>
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
                <button key={ch} type="button" aria-pressed={isAssigned} onClick={() => toggleChannel(ch)} className={chipCls(isAssigned)}>
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
          {movesOnSave && (assignedChannels.some(ch => getChannelOwner(ch)) || assignedBindings.some(k => getBindingOwner(k))) && (
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

      {/* ── "Dime qué cambiar": the editor's one way to ask for a change in
          words. Deliberately a single quiet line, not a card: during day 0
          the guided setup is the guide, and this must not become a second. ── */}
      {canEditAgent && (
        <AskAssistChange agentId={agentId} agentName={config.persona.name || undefined} unsavedChanges={dirty} />
      )}

      <AgentGuideCards agentId={agentId} agentName={config.persona.name || undefined} config={config} onSelectTab={setActiveTab} canAskAssist={canEditAgent} />

      {/* ── Prompt mode ── */}
      {mode === "prompt" && (
        <CustomPromptMode
          customPrompt={customPrompt}
          onChangePrompt={(value) => { setDirty(true); setCustomPrompt(value); }}
          saving={saving}
          onSave={handleSave}
          saveLabel={workspace?.directCommit ? tc("save") : tDraft('save')}
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
              reviewMode={reviewModeFromWorkspace(workspace)}
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
          href={testHref}
          className="px-4 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 text-sm font-medium no-underline flex items-center gap-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
        >
          <TestTube2 size={14} /> {t("testAgent")}
        </Link>
        {Object.keys(fieldErrors).length > 0 && (
          <span className="text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1">
            <AlertTriangle size={13} /> {t("validation.blocked")}
          </span>
        )}
        {saveBlockedReason && (
          <span id={SAVE_BLOCKED_REASON_ID} className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
            <AlertTriangle size={13} aria-hidden="true" /> {saveBlockedReason}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saveDisabled}
          aria-describedby={saveBlockedReason ? SAVE_BLOCKED_REASON_ID : undefined}
          className={cn(
            "px-5 py-2 rounded-lg border-none text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            saving ? "bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed" : "bg-indigo-500 hover:bg-indigo-600"
          )}
        >
          <Save size={14} /> {saving ? tc("saving") : (workspace?.directCommit ? tc("save") : tDraft('save'))}
        </button>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={cn(
          "fixed bottom-6 right-6 px-5 py-3 rounded-lg text-white text-sm font-semibold shadow-lg z-[9999] flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2",
          toastState?.tone === "error" ? "bg-red-500" : "bg-emerald-500"
        )}>
          {toastState?.tone === "error" ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
          {toast}
        </div>
      )}
    </div>
  );
}
