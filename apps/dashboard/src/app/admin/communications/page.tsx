"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { Mail, Plus, RefreshCw, Save, Eye, Send, Trash2, X, Loader2, FileText } from "lucide-react";
import { SuperAdminGuard } from "@/components/SuperAdminGuard";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import metaTemplate from "./meta-whatsapp-template.json";
import type { CommunicationLanguage, CommunicationDraft, PlatformCommunication, CommunicationRecipient } from "@/lib/platform-communications";

const LANGUAGES: CommunicationLanguage[] = ["es", "en", "pt", "fr"];
const ERROR_KEYS: Record<string, string> = {
  COMMUNICATION_REVISION_CONFLICT: "staleDraft", COMMUNICATION_PREVIEW_REQUIRED: "staleDraft",
  COMMUNICATION_ALREADY_STARTED: "errors.started", COMMUNICATION_NOT_COMPLETED: "errors.inProgress",
  COMMUNICATION_EMPTY_AUDIENCE: "errors.emptyAudience", COMMUNICATION_INVALID_TENANTS: "errors.tenants",
  COMMUNICATION_INVALID_TEST_RECIPIENT: "errors.testRecipient", COMMUNICATION_NO_RETRYABLE_RECIPIENTS: "errors.noRetry",
  COMMUNICATION_NOT_FOUND: "errors.notFound", COMMUNICATION_IMPERSONATION_FORBIDDEN: "errors.impersonation",
  COMMUNICATION_SMTP_FAILED: "errors.smtp", COMMUNICATION_TEST_NOT_ACCEPTED: "errors.smtp",
  SMTP_NOT_ACCEPTED: "errors.smtp", RECIPIENT_NO_LONGER_ELIGIBLE: "errors.ineligible",
  COMMUNICATION_SMTP_UNKNOWN: "errors.smtpUnknown", SMTP_OUTCOME_UNKNOWN: "errors.smtpUnknown",
  COMMUNICATION_INVALID_CTA: "invalidCta", COMMUNICATION_INVALID_INPUT: "errors.invalidInput",
};
const inputClass = "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-60";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800";
const cardClass = "rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";
const blank = (): CommunicationDraft => ({ name: "", audience: "all", recipientRole: "admins", tenantIds: [], content: { es: { subject: "", body: "", ctaLabel: "", ctaUrl: "" } } });
const toDraft = (campaign: PlatformCommunication): CommunicationDraft => ({ name: campaign.name, audience: campaign.audience, recipientRole: campaign.recipientRole, tenantIds: campaign.tenantIds || [], content: campaign.content });
const editable = (campaign: PlatformCommunication | null) => !campaign || campaign.status === "draft" || campaign.status === "ready";
const safeLink = (value?: string): string | null => {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && value.length <= 2048 ? url.href : null; } catch { return null; }
};

export default function CommunicationsPage() {
  return <SuperAdminGuard><CommunicationsContent /></SuperAdminGuard>;
}

function CommunicationsContent() {
  const t = useTranslations("platformCommunications");
  const locale = useLocale();
  const { user } = useAuth();
  const [items, setItems] = useState<PlatformCommunication[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [campaign, setCampaign] = useState<PlatformCommunication | null>(null);
  const [form, setForm] = useState<CommunicationDraft>(blank);
  const [saved, setSaved] = useState(JSON.stringify(blank()));
  const [language, setLanguage] = useState<CommunicationLanguage>("es");
  const [recipients, setRecipients] = useState<CommunicationRecipient[]>([]);
  const [recipientPage, setRecipientPage] = useState(1);
  const [recipientTotal, setRecipientTotal] = useState(0);
  const [recipientPageSize, setRecipientPageSize] = useState(20);
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [specificTenants, setSpecificTenants] = useState(false);
  const [savedSpecificTenants, setSavedSpecificTenants] = useState(false);
  const [tenantSearch, setTenantSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedId = useRef<string | null>(null);
  const selectionRequest = useRef(0);
  const dirty = JSON.stringify(form) !== saved || specificTenants !== savedSpecificTenants;
  const dirtyRef = useRef(dirty);
  const campaignRef = useRef(campaign);
  dirtyRef.current = dirty;
  campaignRef.current = campaign;
  const canEdit = editable(campaign);
  const currentContent = form.content[language];
  const displayContent = currentContent?.subject?.trim() && currentContent?.body?.trim() ? currentContent : form.content.es;
  const usesFallback = language !== "es" && displayContent === form.content.es;
  const ctaUrl = safeLink(displayContent?.ctaUrl);
  const counters = campaign?.counters;
  const canSend = campaign?.status === "ready" && !!campaign.previewVersion && !dirty && (!specificTenants || !!form.tenantIds?.length) && (counters?.total || 0) > 0;
  const errorText = (value: string) => {
    const code = value.match(/(?:COMMUNICATION|SMTP|RECIPIENT)_[A-Z_]+/)?.[0];
    return code ? t(ERROR_KEYS[code] || "requestFailed") : value;
  };

  const loadList = useCallback(async () => {
    const result = await api.listPlatformCommunications(page);
    if (!result.success || !result.data) throw new Error(result.error || t("requestFailed"));
    setItems(result.data.items);
    setTotal(result.data.total);
    setPageSize(result.data.pageSize);
  }, [page, t]);

  useEffect(() => {
    setLoading(true);
    loadList().catch((cause) => setError(cause.message)).finally(() => setLoading(false));
  }, [loadList]);

  useEffect(() => {
    let active = true;
    async function loadTenants() {
      const list: Array<{ id: string; name: string }> = [];
      for (let tenantPage = 1; ; tenantPage++) {
        const result = await api.getPlatformCommunicationTenants("", tenantPage);
        if (!result.success || !result.data) throw new Error(result.error || t("requestFailed"));
        list.push(...result.data.items);
        if (!active) return;
        if (tenantPage * result.data.pageSize >= result.data.total) break;
      }
      if (active) setTenants(list);
    }
    loadTenants().catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [t]);

  const refreshCampaign = useCallback(async (id: string) => {
    const result = await api.getPlatformCommunication(id);
    if (!result.success || !result.data) throw new Error(result.error || t("requestFailed"));
    if (selectedId.current === id) {
      const changed = result.data.revision !== campaignRef.current?.revision || result.data.previewVersion !== campaignRef.current?.previewVersion;
      if (changed) { setConfirmSend(false); setAcknowledged(false); }
      if (dirtyRef.current) {
        // Keep the revision that these edits were based on. The backend must
        // reject a stale save instead of overwriting another administrator.
        if (changed) setError(t("staleDraft"));
      } else {
        const draft = toDraft(result.data);
        setCampaign(result.data); setForm(draft); setSaved(JSON.stringify(draft));
        setSpecificTenants(!!draft.tenantIds?.length); setSavedSpecificTenants(!!draft.tenantIds?.length);
      }
    }
    return result.data;
  }, [t]);

  const loadRecipients = useCallback(async (id: string, requestedPage: number) => {
    const result = await api.getPlatformCommunicationRecipients(id, requestedPage);
    if (!result.success || !result.data) throw new Error(result.error || t("requestFailed"));
    if (selectedId.current === id) {
      setRecipients(result.data.items);
      setRecipientTotal(result.data.total);
      setRecipientPageSize(result.data.pageSize);
    }
  }, [t]);

  useEffect(() => {
    if (!campaign?.id) return;
    loadRecipients(campaign.id, recipientPage).catch((cause) => setError(cause.message));
  }, [campaign?.id, campaign?.revision, recipientPage, loadRecipients]);

  useEffect(() => {
    if (!campaign?.id || !["queued", "sending"].includes(campaign.status)) return;
    const id = campaign.id;
    const timer = setInterval(() => {
      Promise.all([refreshCampaign(id), loadRecipients(id, recipientPage), loadList()]).catch((cause) => setError(cause.message));
    }, 5000);
    return () => clearInterval(timer);
  }, [campaign?.id, campaign?.status, recipientPage, refreshCampaign, loadRecipients, loadList]);

  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);

  function changeForm(next: CommunicationDraft) {
    setForm(next); setConfirmSend(false); setAcknowledged(false); setNotice("");
  }

  function adopt(next: PlatformCommunication) {
    const draft = toDraft(next);
    selectedId.current = next.id;
    setCampaign(next); setForm(draft); setSaved(JSON.stringify(draft));
    setSpecificTenants(!!draft.tenantIds?.length); setSavedSpecificTenants(!!draft.tenantIds?.length); setConfirmSend(false); setAcknowledged(false);
  }

  async function run(action: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(action); setError(""); setNotice("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("requestFailed")); }
    finally { setBusy(null); }
  }

  function startDraft(template = false) {
    if (dirty && !window.confirm(t("discardChanges"))) return;
    selectionRequest.current++;
    selectedId.current = null; setCampaign(null); setRecipients([]); setRecipientTotal(0); setRecipientPage(1);
    setSaved(JSON.stringify(blank())); setSpecificTenants(false); setSavedSpecificTenants(false); setError(""); setNotice("");
    const draft = template ? { ...blank(), name: t("metaTemplateName"), content: metaTemplate } : blank();
    changeForm(draft);
  }

  async function selectCampaign(id: string) {
    if (dirty && !window.confirm(t("discardChanges"))) return;
    const request = ++selectionRequest.current;
    await run("select", async () => {
      const result = await api.getPlatformCommunication(id);
      if (!result.success || !result.data) throw new Error(result.error || t("requestFailed"));
      if (request !== selectionRequest.current) return;
      setRecipientPage(1); setRecipients([]); setRecipientTotal(0); adopt(result.data);
    });
  }

  function validateForm() {
    if (!form.name.trim() || !form.content.es.subject.trim() || !form.content.es.body.trim()) throw new Error(t("requiredFields"));
    if (specificTenants && !form.tenantIds?.length) throw new Error(t("chooseTenant"));
    for (const code of LANGUAGES) {
      const content = form.content[code];
      if (!content) continue;
      if (!!content.subject.trim() !== !!content.body.trim() || (!content.subject.trim() && (content.ctaLabel?.trim() || content.ctaUrl?.trim()))) throw new Error(t("completeTranslation", { language: t(`languages.${code}`) }));
      if (!!content.ctaLabel?.trim() !== !!content.ctaUrl?.trim() || (content.ctaUrl?.trim() && !safeLink(content.ctaUrl))) throw new Error(t("invalidCta"));
    }
  }

  async function saveDraft() {
    await run("save", async () => {
      validateForm();
      const content = { ...form.content };
      for (const code of LANGUAGES) {
        if (code !== "es" && !content[code]?.subject.trim() && !content[code]?.body.trim()) delete content[code];
      }
      const payload = { ...form, content, tenantIds: specificTenants ? form.tenantIds : [] };
      const result = campaign
        ? await api.updatePlatformCommunication(campaign.id, { ...payload, expectedRevision: campaign.revision })
        : await api.createPlatformCommunication(payload);
      if (!result.success || !result.data) throw new Error(result.error || t("requestFailed"));
      adopt(result.data); await loadList(); setNotice(t("saved"));
    });
  }

  async function previewAudience() {
    if (!campaign || dirty) return;
    await run("preview", async () => {
      const result = await api.previewPlatformCommunication(campaign.id, campaign.revision);
      if (!result.success || !result.data) throw new Error(result.error || t("requestFailed"));
      adopt(result.data); setRecipientPage(1);
      await loadRecipients(campaign.id, 1); await loadList(); setNotice(t("previewReady"));
    });
  }

  async function sendCampaign() {
    if (!campaign || !canSend || !acknowledged || !campaign.previewVersion) return;
    await run("send", async () => {
      const result = await api.sendPlatformCommunication(campaign.id, campaign.revision, campaign.previewVersion!);
      if (!result.success) throw new Error(result.error || t("requestFailed"));
      setConfirmSend(false); setAcknowledged(false);
      adopt(await refreshCampaign(campaign.id)); await loadList(); setNotice(t("queued"));
    });
  }

  const updateContent = (key: "subject" | "body" | "ctaLabel" | "ctaUrl", value: string) => changeForm({ ...form, content: { ...form.content, [language]: { subject: "", body: "", ...form.content[language], [key]: value } } });
  const formatDate = (value?: string | null) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString(locale) : "—";

  return <div className="mx-auto max-w-[1500px] space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="flex items-center gap-3 text-2xl font-semibold"><Mail className="text-blue-500" />{t("title")}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p></div>
      <div className="flex flex-wrap gap-2"><button disabled={!!busy} className={buttonClass} onClick={() => startDraft(true)}><FileText size={16} />{t("metaTemplate")}</button><button disabled={!!busy} className={buttonClass} onClick={() => startDraft()}><Plus size={16} />{t("newDraft")}</button></div>
    </header>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{errorText(error)}</div>}
    {notice && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">{notice}</div>}
    <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className={cn(cardClass, "h-fit")}>
        <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">{t("history")}</h2><button type="button" aria-label={t("refresh")} disabled={!!busy || loading} className={buttonClass} onClick={() => run("refresh", loadList)}><RefreshCw size={15} /></button></div>
        {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : !items.length ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : <div className="space-y-2">{items.map((item) => <button key={item.id} disabled={!!busy} type="button" onClick={() => selectCampaign(item.id)} className={cn("w-full rounded-lg border p-3 text-left transition-colors", campaign?.id === item.id ? "border-blue-400 bg-blue-50 dark:bg-blue-950" : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800")}><span className="block break-words text-sm font-medium">{item.name}</span><span className="mt-2 block text-xs text-muted-foreground">{t(`statuses.${item.status}`)} · {formatDate(item.createdAt)}</span></button>)}</div>}
        <div className="mt-4 flex items-center justify-between gap-2"><button className={buttonClass} disabled={page === 1 || !!busy} onClick={() => setPage(page - 1)}>{t("previous")}</button><span className="text-xs text-muted-foreground">{t("page", { page })}</span><button className={buttonClass} disabled={page * pageSize >= total || !!busy} onClick={() => setPage(page + 1)}>{t("next")}</button></div>
      </aside>
      <main className="min-w-0 space-y-6">
        <section className={cardClass}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{campaign ? t("campaign") : t("newDraft")}</h2><span className="rounded-full bg-neutral-100 px-3 py-1 text-xs dark:bg-neutral-800">{dirty ? t("unsaved") : t(`statuses.${campaign?.status || "draft"}`)}</span></div>
          <fieldset disabled={!canEdit || !!busy} className="space-y-5 disabled:opacity-80">
            <label className="block space-y-2 text-sm font-medium"><span>{t("name")}</span><input className={inputClass} value={form.name} maxLength={120} onChange={(event) => changeForm({ ...form, name: event.target.value })} /></label>
            <div className="grid gap-4 md:grid-cols-2"><label className="block space-y-2 text-sm font-medium"><span>{t("audience")}</span><select className={inputClass} value={form.audience} onChange={(event) => changeForm({ ...form, audience: event.target.value as CommunicationDraft["audience"] })}><option value="all">{t("audiences.all")}</option><option value="whatsapp_connected">{t("audiences.whatsapp_connected")}</option></select></label><label className="block space-y-2 text-sm font-medium"><span>{t("roles")}</span><select className={inputClass} value={form.recipientRole} onChange={(event) => changeForm({ ...form, recipientRole: event.target.value as CommunicationDraft["recipientRole"] })}><option value="admins">{t("recipientRoles.admins")}</option><option value="all">{t("recipientRoles.all")}</option></select></label></div>
            <p className="text-xs text-muted-foreground">{t("audienceHint")}</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={specificTenants} onChange={(event) => { setSpecificTenants(event.target.checked); changeForm({ ...form, tenantIds: [] }); }} />{t("specificTenants")}</label>
            {specificTenants && <div className="space-y-2"><input aria-label={t("searchTenants")} placeholder={t("searchTenants")} className={inputClass} value={tenantSearch} onChange={(event) => setTenantSearch(event.target.value)} /><div className="max-h-40 overflow-y-auto rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">{tenants.filter((tenant) => tenant.name.toLowerCase().includes(tenantSearch.toLowerCase())).map((tenant) => <label key={tenant.id} className="flex items-center gap-2 py-1.5 text-sm"><input type="checkbox" checked={form.tenantIds?.includes(tenant.id) || false} onChange={(event) => changeForm({ ...form, tenantIds: event.target.checked ? [...(form.tenantIds || []), tenant.id] : form.tenantIds?.filter((id) => id !== tenant.id) })} />{tenant.name}</label>)}</div><p className="text-xs text-muted-foreground">{t("selectedTenants", { count: form.tenantIds?.length || 0 })}</p></div>}
          </fieldset>
          <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label={t("language")}>
            {LANGUAGES.map((code) => <button key={code} className={cn(buttonClass, code === language && "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200")} aria-pressed={language === code} onClick={() => setLanguage(code)}>{t(`languages.${code}`)}{code === "es" && " *"}</button>)}
          </div>
          <p className="my-3 text-xs text-muted-foreground">{t("languageHint")}</p>
          <fieldset disabled={!canEdit || !!busy} className="space-y-4">
            <label className="block space-y-2 text-sm font-medium"><span>{t("subject")}</span><input className={inputClass} maxLength={180} value={currentContent?.subject || ""} onChange={(event) => updateContent("subject", event.target.value)} /></label>
            <label className="block space-y-2 text-sm font-medium"><span>{t("body")}</span><textarea className={cn(inputClass, "min-h-72 leading-6")} maxLength={30000} value={currentContent?.body || ""} onChange={(event) => updateContent("body", event.target.value)} /></label>
            <div className="grid gap-4 md:grid-cols-2"><label className="block space-y-2 text-sm font-medium"><span>{t("ctaLabel")}</span><input className={inputClass} maxLength={100} value={currentContent?.ctaLabel || ""} onChange={(event) => updateContent("ctaLabel", event.target.value)} /></label><label className="block space-y-2 text-sm font-medium"><span>{t("ctaUrl")}</span><input className={inputClass} type="url" placeholder="https://" value={currentContent?.ctaUrl || ""} onChange={(event) => updateContent("ctaUrl", event.target.value)} /></label></div>
          </fieldset>
          {canEdit && <div className="mt-5 flex flex-wrap gap-2"><button className={buttonClass} disabled={!!busy || (!dirty && !!campaign)} onClick={saveDraft}><Save size={16} />{t("save")}</button><button className={buttonClass} disabled={!!busy || !campaign || dirty} onClick={previewAudience}><Eye size={16} />{t("prepareAudience")}</button>{campaign?.status === "draft" && <button className={cn(buttonClass, "text-red-600")} disabled={!!busy} onClick={() => setConfirmDelete(true)}><Trash2 size={16} />{t("delete")}</button>}</div>}
          {dirty && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{t("saveFirst")}</p>}
        </section>
        <section className={cardClass}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{t("messagePreview")}</h2><button className={buttonClass} disabled={!campaign || dirty || !!busy || !canEdit} onClick={() => run("test", async () => { if (!campaign) return; const result = await api.testPlatformCommunication(campaign.id, language); if (!result.success) throw new Error(result.error || t("requestFailed")); setNotice(t("testAccepted", { email: user?.email || "" })); })}><Mail size={16} />{t("test")}</button></div>
          <p className="mb-4 text-xs text-muted-foreground">{t("testHint", { email: user?.email || "" })}</p>
          {usesFallback && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t("fallback")}</p>}
          <article className="mx-auto max-w-[600px] rounded-xl border border-neutral-200 bg-white p-6 text-neutral-900"><div className="mb-6 text-3xl font-bold tracking-tight text-[#3897f0]">Parallly</div><h3 className="mb-4 break-words text-xl font-semibold">{displayContent?.subject || t("emptySubject")}</h3><div className="whitespace-pre-wrap break-words text-sm leading-6">{displayContent?.body || t("emptyBody")}</div>{displayContent?.ctaLabel && ctaUrl && <a href={ctaUrl} target="_blank" rel="noopener noreferrer" className="mt-6 inline-block max-w-full break-words rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white">{displayContent.ctaLabel}</a>}</article>
        </section>
        {campaign && <section className={cardClass}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{t("recipients")}</h2><button className={buttonClass} disabled={!!busy} onClick={() => run("refresh", async () => { await refreshCampaign(campaign.id); await loadRecipients(campaign.id, recipientPage); })}><RefreshCw size={15} />{t("refresh")}</button></div>
          <p className="mb-4 text-sm text-muted-foreground">{campaign.previewVersion ? t("frozenAudience") : t("noAudience")}</p>
          {counters && <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{(["total", "pending", "processing", "accepted", "failed", "unknown", "skipped"] as const).map((key) => <div key={key} className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800"><div className="text-xs text-muted-foreground">{t(`recipientStatuses.${key}`)}</div><div className="mt-1 text-xl font-semibold">{counters[key] || 0}</div></div>)}</div>}
          <p className="mb-4 text-xs text-muted-foreground">{t("acceptedHint")}</p>
          {recipients.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b dark:border-neutral-700">{["email", "tenant", "language", "status", "attempts"].map((key) => <th key={key} className="px-3 py-2 font-medium">{t(key)}</th>)}</tr></thead><tbody>{recipients.map((recipient) => <tr key={recipient.id} className="border-b last:border-0 dark:border-neutral-800"><td className="px-3 py-3"><div>{recipient.email}</div><div className="text-xs text-muted-foreground">{recipient.name}</div></td><td className="px-3 py-3">{recipient.tenantName}</td><td className="px-3 py-3">{t(`languages.${LANGUAGES.includes(recipient.language) ? recipient.language : "es"}`)}</td><td className="px-3 py-3"><div>{t(`recipientStatuses.${recipient.status}`)}</div>{recipient.errorCode && <div className="max-w-56 break-words text-xs text-red-600 dark:text-red-300">{errorText(recipient.errorCode)}</div>}</td><td className="px-3 py-3">{recipient.attempts}</td></tr>)}</tbody></table></div>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><button className={buttonClass} disabled={recipientPage === 1 || !!busy} onClick={() => setRecipientPage(recipientPage - 1)}>{t("previous")}</button><span className="text-xs text-muted-foreground">{t("page", { page: recipientPage })}</span><button className={buttonClass} disabled={recipientPage * recipientPageSize >= recipientTotal || !!busy} onClick={() => setRecipientPage(recipientPage + 1)}>{t("next")}</button></div><div className="flex flex-wrap gap-2">{campaign.status === "completed" && (counters?.failed || 0) > 0 && <button className={buttonClass} disabled={!!busy} onClick={() => run("retry", async () => { const result = await api.retryPlatformCommunication(campaign.id, campaign.revision); if (!result.success) throw new Error(result.error || t("requestFailed")); adopt(await refreshCampaign(campaign.id)); await loadList(); setNotice(t("retryQueued")); })}><RefreshCw size={16} />{t("retry")}</button>}<button className={cn(buttonClass, "border-blue-700 bg-blue-700 text-white hover:bg-blue-800 dark:border-blue-600 dark:hover:bg-blue-800")} disabled={!canSend || !!busy} onClick={() => { setAcknowledged(false); setConfirmSend(true); }}><Send size={16} />{t("reviewSend")}</button></div></div>
          {(counters?.unknown || 0) > 0 && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{t("unknownHint")}</p>}
        </section>}
      </main>
    </div>
    {busy && <div role="status" className="fixed bottom-5 right-5 flex items-center gap-2 rounded-lg border bg-white px-4 py-3 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"><Loader2 className="animate-spin" size={16} />{t("working")}</div>}
    <Dialog.Root open={confirmSend} onOpenChange={(open) => { if (!busy) setConfirmSend(open); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-xl dark:bg-neutral-900"><Dialog.Title className="pr-8 text-xl font-semibold">{t("confirmTitle")}</Dialog.Title><Dialog.Description className="mt-3 text-sm text-muted-foreground">{t("confirmDescription", { count: counters?.total || 0, name: campaign?.name || "" })}</Dialog.Description><div className="my-4 rounded-lg bg-neutral-50 p-4 text-sm dark:bg-neutral-800"><p>{t(`audiences.${campaign?.audience || "all"}`)}</p><p className="mt-1">{t(`recipientRoles.${campaign?.recipientRole || "admins"}`)}</p>{!!campaign?.tenantIds?.length && <p className="mt-1">{t("selectedTenants", { count: campaign.tenantIds.length })}</p>}<p className="mt-2 font-semibold">{t("frozenCount", { count: counters?.total || 0 })}</p></div><label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" disabled={!!busy} checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>{t("confirmCheck")}</span></label><div className="mt-6 flex justify-end gap-2"><button className={buttonClass} disabled={!!busy} onClick={() => setConfirmSend(false)}>{t("cancel")}</button><button className={cn(buttonClass, "border-blue-700 bg-blue-700 text-white hover:bg-blue-800 dark:hover:bg-blue-800")} disabled={!acknowledged || !canSend || !!busy} onClick={sendCampaign}><Send size={16} />{t("sendNow")}</button></div><Dialog.Close asChild><button className="absolute right-4 top-4" disabled={!!busy} aria-label={t("close")}><X size={18} /></button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={confirmDelete} onOpenChange={(open) => { if (!busy) setConfirmDelete(open); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-xl dark:bg-neutral-900"><Dialog.Title className="text-lg font-semibold">{t("deleteTitle")}</Dialog.Title><Dialog.Description className="mt-3 text-sm text-muted-foreground">{t("deleteDescription")}</Dialog.Description><div className="mt-6 flex justify-end gap-2"><button className={buttonClass} disabled={!!busy} onClick={() => setConfirmDelete(false)}>{t("cancel")}</button><button className={cn(buttonClass, "text-red-600")} disabled={!!busy} onClick={() => run("delete", async () => { if (!campaign) return; const result = await api.deletePlatformCommunication(campaign.id, campaign.revision); if (!result.success) throw new Error(result.error || t("requestFailed")); setConfirmDelete(false); selectedId.current = null; setCampaign(null); setForm(blank()); setSaved(JSON.stringify(blank())); setSpecificTenants(false); setSavedSpecificTenants(false); setRecipients([]); setRecipientTotal(0); await loadList(); setNotice(t("deleted")); })}>{t("delete")}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
