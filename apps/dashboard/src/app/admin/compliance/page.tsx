"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Shield, FileText, UserCheck, UserX, Trash2, Plus, X, Check,
  Pencil, ToggleLeft, ToggleRight, AlertTriangle, Info, Clock,
  History, ChevronDown, ChevronUp, Eye, EyeOff,
} from "lucide-react";

type Tab = "legal" | "consents" | "optouts" | "deletions" | "audit";

export default function CompliancePage() {
  const t = useTranslations("compliance");
  const tc = useTranslations("common");
  const { activeTenantId } = useTenant();
  const [tab, setTab] = useState<Tab>("legal");
  const [legalTexts, setLegalTexts] = useState<any[]>([]);
  const [consents, setConsents] = useState<any[]>([]);
  const [optOuts, setOptOuts] = useState<any[]>([]);
  const [deletions, setDeletions] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [showModal, setShowModal] = useState<"create-legal" | "edit-legal" | "optout" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingLegal, setEditingLegal] = useState<any | null>(null);

  const [legalForm, setLegalForm] = useState({ channel: "whatsapp", version: 1, text: "", active: true });
  const [optOutForm, setOptOutForm] = useState({ lead_id: "", channel: "whatsapp", reason: "" });
  const [saving, setSaving] = useState(false);
  const [optOutFilter, setOptOutFilter] = useState("");
  const [optOutStats, setOptOutStats] = useState<any>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [expandedLegal, setExpandedLegal] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const loadAll = useCallback(async () => {
    if (!activeTenantId) return;
    try {
      const [lt, co, oo, dr, stats] = await Promise.all([
        api.getLegalTexts(activeTenantId),
        api.getConsents(activeTenantId),
        api.getOptOuts(activeTenantId),
        api.getDeletionRequests(activeTenantId),
        api.getOptOutStats(activeTenantId),
      ]);
      if (Array.isArray(lt)) setLegalTexts(lt);
      if (Array.isArray(co)) setConsents(co);
      if (oo?.success && Array.isArray(oo.data)) setOptOuts(oo.data);
      if (Array.isArray(dr)) setDeletions(dr);
      if (stats?.success) setOptOutStats(stats.data);
    } catch (err) { console.error(err); }
  }, [activeTenantId]);

  const loadAuditLog = useCallback(async () => {
    if (!activeTenantId) return;
    try {
      const data = await api.getComplianceAuditLog(activeTenantId);
      if (Array.isArray(data)) setAuditLog(data);
    } catch { }
  }, [activeTenantId]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (tab === "audit") loadAuditLog(); }, [tab, loadAuditLog]);

  // ─── Legal text CRUD ───────────────────────────────────────────────────

  const openCreateLegal = () => {
    setEditingLegal(null);
    setLegalForm({ channel: "whatsapp", version: (legalTexts.length > 0 ? Math.max(...legalTexts.map(l => l.version || 0)) + 1 : 1), text: "", active: true });
    setShowModal("create-legal");
  };

  const openEditLegal = (lt: any) => {
    setEditingLegal(lt);
    setLegalForm({ channel: lt.channel, version: lt.version, text: lt.text, active: lt.active });
    setShowModal("edit-legal");
  };

  const handleSaveLegal = async () => {
    if (!legalForm.text || !activeTenantId) return;
    setSaving(true);
    try {
      if (editingLegal) {
        const res = await api.updateLegalText(activeTenantId, editingLegal.id, legalForm);
        if (res) {
          setLegalTexts(prev => prev.map(l => l.id === editingLegal.id ? { ...l, ...legalForm } : l));
          showToast(t("toast.legalUpdated"));
        }
      } else {
        const res = await api.createLegalText(activeTenantId, legalForm);
        const created = res?.data || res;
        if (created?.id) {
          setLegalTexts(prev => [created, ...prev]);
          showToast(t("toast.legalCreated"));
        }
      }
      setShowModal(null);
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const handleDeleteLegal = async (id: string) => {
    if (!activeTenantId) return;
    try {
      await api.deleteLegalText(activeTenantId, id);
      setLegalTexts(prev => prev.filter(l => l.id !== id));
      setConfirmDelete(null);
      showToast(t("toast.legalDeleted"));
    } catch (err) { console.error(err); }
  };

  const handleToggleLegalActive = async (lt: any) => {
    if (!activeTenantId) return;
    try {
      await api.updateLegalText(activeTenantId, lt.id, { active: !lt.active });
      setLegalTexts(prev => prev.map(l => l.id === lt.id ? { ...l, active: !l.active } : l));
    } catch (err) { console.error(err); }
  };

  // ─── Opt-out handlers ──────────────────────────────────────────────────

  const handleCreateOptOut = async () => {
    if (!optOutForm.lead_id || !activeTenantId) return;
    setSaving(true);
    try {
      const res = await api.createManualOptOut(activeTenantId, optOutForm);
      const created = res?.data || res;
      if (created?.id) { setOptOuts(prev => [created, ...prev]); setShowModal(null); showToast(t("toast.optOutRegistered")); }
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const handleProcessDeletion = async (id: string) => {
    if (!activeTenantId) return;
    try {
      await api.processDeletionRequest(activeTenantId, id);
      setDeletions(prev => prev.map(d => d.id === id ? { ...d, status: "processed", processed_at: new Date().toISOString() } : d));
      showToast(t("toast.requestProcessed"));
    } catch (err) { console.error(err); }
  };

  // ─── Tab config ────────────────────────────────────────────────────────

  const pendingDeletions = deletions.filter(d => d.status === "pending").length;
  const pendingOptOuts = optOutStats?.optOuts?.pending || 0;

  const tabs: { key: Tab; label: string; icon: any; badge?: number }[] = [
    { key: "legal", label: t("legalTexts"), icon: FileText },
    { key: "consents", label: t("consents"), icon: UserCheck },
    { key: "optouts", label: t("optOuts"), icon: UserX, badge: pendingOptOuts },
    { key: "deletions", label: t("deletionRequests"), icon: Trash2, badge: pendingDeletions },
    { key: "audit", label: t("auditLog"), icon: History },
  ];

  return (
    <>
      <div>
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          icon={Shield}
          action={
            tab === "legal" ? (
              <button onClick={openCreateLegal} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm cursor-pointer hover:opacity-90 border-none">
                <Plus size={16} /> {t("modal.newLegalText")}
              </button>
            ) : tab === "optouts" ? (
              <button onClick={() => { setOptOutForm({ lead_id: "", channel: "whatsapp", reason: "" }); setShowModal("optout"); }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm cursor-pointer hover:opacity-90 border-none">
                <Plus size={16} /> {t("modal.registerOptOut")}
              </button>
            ) : undefined
          }
        />

        {/* Info banner */}
        <div className="mb-5 px-4 py-3 rounded-xl bg-blue-500/5 border border-blue-500/20 flex items-start gap-3">
          <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
          <p className="text-[13px] text-muted-foreground leading-relaxed">{t("infoBanner")}</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-card rounded-xl p-1 border border-border overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon, badge }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex-1 px-3 py-2.5 rounded-lg border-none font-semibold text-[13px] cursor-pointer flex items-center justify-center gap-1.5 transition-all duration-200 whitespace-nowrap",
                tab === key ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon size={15} /> {label}
              {badge !== undefined && badge > 0 && (
                <span className="ml-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">{badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  TAB: TEXTOS LEGALES                                          */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === "legal" && (
          <div className="space-y-3">
            {/* Help text */}
            <div className="px-4 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-border">
              <p className="text-xs text-muted-foreground">{t("legalHelp")}</p>
            </div>

            {legalTexts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 rounded-xl bg-card border border-border">
                <div className="w-14 h-14 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
                  <FileText size={24} className="text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-1">{t("empty.legal")}</p>
                <p className="text-xs text-muted-foreground mb-4">{t("empty.legalHint")}</p>
                <button onClick={openCreateLegal} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium cursor-pointer border-none">
                  <Plus size={16} /> {t("modal.newLegalText")}
                </button>
              </div>
            )}

            {legalTexts.map(lt => (
              <div key={lt.id} className={cn(
                "rounded-xl border bg-card overflow-hidden transition-all",
                lt.active ? "border-border" : "border-border opacity-60"
              )}>
                <div className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText size={16} className="text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">v{lt.version}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-500">{lt.channel}</span>
                        <span className={cn("text-[11px] px-2 py-0.5 rounded-md font-medium",
                          lt.active ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-500"
                        )}>
                          {lt.active ? tc("active") : tc("inactive")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(lt.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => setExpandedLegal(expandedLegal === lt.id ? null : lt.id)}
                      className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer border-none bg-transparent text-muted-foreground">
                      {expandedLegal === lt.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <button onClick={() => handleToggleLegalActive(lt)}
                      className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer border-none bg-transparent text-muted-foreground"
                      title={lt.active ? tc("inactive") : tc("active")}
                    >
                      {lt.active ? <ToggleRight size={16} className="text-emerald-500" /> : <ToggleLeft size={16} />}
                    </button>
                    <button onClick={() => openEditLegal(lt)}
                      className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer border-none bg-transparent text-muted-foreground">
                      <Pencil size={14} />
                    </button>
                    {confirmDelete === lt.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleDeleteLegal(lt.id)}
                          className="px-2 py-1 rounded-md border-none bg-red-500 text-white text-[11px] font-semibold cursor-pointer">{tc("confirm")}</button>
                        <button onClick={() => setConfirmDelete(null)}
                          className="px-2 py-1 rounded-md border border-border bg-transparent text-muted-foreground text-[11px] cursor-pointer">{tc("cancel")}</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDelete(lt.id)}
                        className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer border-none bg-transparent text-red-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded text preview */}
                {expandedLegal === lt.id && (
                  <div className="px-5 pb-4 border-t border-border pt-3">
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{lt.text}</p>
                  </div>
                )}

                {/* Collapsed preview */}
                {expandedLegal !== lt.id && lt.text && (
                  <div className="px-5 pb-3">
                    <p className="text-[13px] text-muted-foreground truncate">{lt.text.substring(0, 120)}{lt.text.length > 120 ? "..." : ""}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  TAB: CONSENTIMIENTOS                                         */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === "consents" && (
          <div className="space-y-3">
            <div className="px-4 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-border">
              <p className="text-xs text-muted-foreground">{t("consentsHelp")}</p>
            </div>

            {consents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 rounded-xl bg-card border border-border">
                <div className="w-14 h-14 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
                  <UserCheck size={24} className="text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">{t("empty.consents")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("empty.consentsHint")}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Lead</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">{t("channel")}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">{t("version")}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">{t("consentDate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consents.map(c => (
                      <tr key={c.id} className="border-b border-border last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                        <td className="px-4 py-3 text-foreground font-medium">{c.lead_id?.substring(0, 8)}...</td>
                        <td className="px-4 py-3"><span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-500">{c.channel}</span></td>
                        <td className="px-4 py-3 text-muted-foreground">v{c.legal_text_version || c.legal_version}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(c.granted_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  TAB: OPT-OUTS                                                */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === "optouts" && (
          <div className="space-y-4">
            <div className="px-4 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-border">
              <p className="text-xs text-muted-foreground">{t("optOutsHelp")}</p>
            </div>

            {/* Stats */}
            {optOutStats?.optOuts && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: t("stats.pending"), value: optOutStats.optOuts.pending || 0, color: "text-amber-500", bg: "bg-amber-500/10" },
                  { label: t("stats.confirmed"), value: optOutStats.optOuts.confirmed || 0, color: "text-red-500", bg: "bg-red-500/10" },
                  { label: t("stats.rejected"), value: optOutStats.optOuts.rejected || 0, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                ].map(s => (
                  <div key={s.label} className={cn("rounded-xl border border-border p-4 text-center", s.bg)}>
                    <div className={cn("text-2xl font-semibold", s.color)}>{s.value}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Filter */}
            <div className="flex gap-1.5">
              {["", "pending", "confirmed", "rejected"].map(f => (
                <button key={f} onClick={async () => {
                  setOptOutFilter(f);
                  const res = await api.getOptOuts(activeTenantId!, f || undefined);
                  if (res?.success) setOptOuts(res.data);
                }} className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors",
                  optOutFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/50"
                )}>
                  {f === "" ? t("filterAll") : f === "pending" ? t("stats.pending") : f === "confirmed" ? t("stats.confirmed") : t("stats.rejected")}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="space-y-3">
              {optOuts.map(o => (
                <div key={o.id} className={cn(
                  "px-5 py-4 rounded-xl border bg-card",
                  o.status === "pending" ? "border-amber-500/30" : "border-border"
                )}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("text-[11px] px-2 py-0.5 rounded-md font-semibold",
                        o.status === "pending" ? "bg-amber-500/15 text-amber-500" :
                        o.status === "confirmed" ? "bg-red-500/15 text-red-500" :
                        "bg-emerald-500/15 text-emerald-500"
                      )}>
                        {o.status === "pending" ? tc("pending") : o.status === "confirmed" ? t("statusBadge.confirmed") : t("statusBadge.rejected")}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-500">{o.channel}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-neutral-500/10 text-muted-foreground">{o.detected_from || "keyword"}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{new Date(o.created_at).toLocaleString()}</span>
                  </div>

                  <div className="text-sm mb-2">
                    <span className="font-semibold text-foreground">{o.first_name || ""} {o.last_name || ""}</span>
                    <span className="text-muted-foreground ml-2">{o.phone || o.lead_phone || tc("noData")}</span>
                  </div>

                  {o.trigger_msg && (
                    <div className="bg-neutral-100 dark:bg-neutral-800 rounded-lg px-3 py-2 text-sm text-foreground mb-3 border-l-[3px] border-amber-500">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground block mb-1">{t("detectedMessage")}:</span>
                      &ldquo;{o.trigger_msg}&rdquo;
                    </div>
                  )}

                  {o.reviewed_at && (
                    <div className="text-xs text-muted-foreground mb-2">
                      {t("reviewedBy")} <span className="font-semibold">{o.reviewer_first} {o.reviewer_last}</span> — {new Date(o.reviewed_at).toLocaleString()}
                      {o.review_notes && <span className="ml-2">— &ldquo;{o.review_notes}&rdquo;</span>}
                    </div>
                  )}

                  {o.status === "pending" && (
                    <div className="flex items-center gap-2 mt-2">
                      <input value={reviewNotes} onChange={e => setReviewNotes(e.target.value)}
                        placeholder={t("noteOptional")}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-xs outline-none" />
                      <button onClick={async () => {
                        await api.confirmOptOut(activeTenantId!, o.id, reviewNotes);
                        setOptOuts(prev => prev.map(x => x.id === o.id ? { ...x, status: "confirmed", reviewed_at: new Date().toISOString() } : x));
                        setReviewNotes(""); showToast(t("toast.optOutConfirmed"));
                        const stats = await api.getOptOutStats(activeTenantId!); if (stats?.success) setOptOutStats(stats.data);
                      }} className="px-3 py-1.5 rounded-lg border-none bg-red-500 text-white text-xs font-semibold cursor-pointer flex items-center gap-1">
                        <UserX size={12} /> {t("confirmOptOut")}
                      </button>
                      <button onClick={async () => {
                        await api.rejectOptOut(activeTenantId!, o.id, reviewNotes);
                        setOptOuts(prev => prev.map(x => x.id === o.id ? { ...x, status: "rejected", reviewed_at: new Date().toISOString() } : x));
                        setReviewNotes(""); showToast(t("toast.markedFalsePositive"));
                        const stats = await api.getOptOutStats(activeTenantId!); if (stats?.success) setOptOutStats(stats.data);
                      }} className="px-3 py-1.5 rounded-lg border border-emerald-500 bg-transparent text-emerald-500 text-xs font-semibold cursor-pointer flex items-center gap-1">
                        <Check size={12} /> {t("rejectOptOut")}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {optOuts.length === 0 && <div className="text-center py-10 text-muted-foreground">{optOutFilter ? t("empty.optOutsFiltered", { status: optOutFilter }) : t("empty.optOuts")}</div>}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  TAB: SOLICITUDES DE ELIMINACIÓN                              */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === "deletions" && (
          <div className="space-y-3">
            <div className="px-4 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-border">
              <p className="text-xs text-muted-foreground">{t("deletionsHelp")}</p>
            </div>

            {deletions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 rounded-xl bg-card border border-border">
                <div className="w-14 h-14 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
                  <Trash2 size={24} className="text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">{t("empty.deletions")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("empty.deletionsHint")}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Lead</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">{t("requestedBy")}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Status</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">{t("consentDate")}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletions.map(d => (
                      <tr key={d.id} className="border-b border-border last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                        <td className="px-4 py-3 text-foreground font-medium">{d.lead_id?.substring(0, 8)}...</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{d.requested_by || t("system")}</td>
                        <td className="px-4 py-3">
                          <span className={cn("text-[11px] px-2 py-0.5 rounded-md font-medium",
                            d.status === "processed" || d.status === "completed" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-500"
                          )}>
                            {d.status === "processed" || d.status === "completed" ? t("statusBadge.confirmed") : tc("pending")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(d.requested_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-right">
                          {d.status === "pending" && (
                            <button onClick={() => handleProcessDeletion(d.id)}
                              className="px-3 py-1.5 rounded-lg border-none bg-emerald-500 text-white text-xs font-semibold cursor-pointer flex items-center gap-1">
                              <Check size={12} /> {t("process")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/*  TAB: AUDIT LOG                                               */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === "audit" && (
          <div className="space-y-3">
            <div className="px-4 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-border">
              <p className="text-xs text-muted-foreground">{t("auditHelp")}</p>
            </div>

            {auditLog.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 rounded-xl bg-card border border-border">
                <div className="w-14 h-14 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
                  <History size={24} className="text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">{t("empty.audit")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("empty.auditHint")}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">{t("auditAction")}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">{t("auditResource")}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">{t("auditDetails")}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-xs">{t("consentDate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry: any) => (
                      <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                        <td className="px-4 py-3">
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium">
                            {entry.action?.replace("compliance.", "")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{entry.resource}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[300px] truncate">
                          {typeof entry.details === "object" ? JSON.stringify(entry.details) : entry.details}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  MODALS                                                       */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {showModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(null)}>
          <div onClick={e => e.stopPropagation()} className="w-[520px] max-h-[90vh] overflow-y-auto rounded-xl bg-card border border-border shadow-2xl">
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">
                {showModal === "edit-legal" ? t("modal.editLegalText") : showModal === "create-legal" ? t("modal.newLegalText") : t("modal.registerOptOut")}
              </h2>
              <button onClick={() => setShowModal(null)} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer bg-transparent border-none text-muted-foreground">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {(showModal === "create-legal" || showModal === "edit-legal") && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t("channel")}</label>
                    <select value={legalForm.channel} onChange={e => setLegalForm(p => ({ ...p, channel: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-border text-foreground text-sm outline-none">
                      <option value="whatsapp">WhatsApp</option>
                      <option value="instagram">Instagram</option>
                      <option value="messenger">Messenger</option>
                      <option value="telegram">Telegram</option>
                      <option value="sms">SMS</option>
                      <option value="web">Web</option>
                      <option value="email">Email</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t("version")}</label>
                      <input type="number" min={1} value={legalForm.version}
                        onChange={e => setLegalForm(p => ({ ...p, version: parseInt(e.target.value) || 1 }))}
                        className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-border text-foreground text-sm outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-1.5">Status</label>
                      <div className="flex items-center gap-3 h-[42px]">
                        <button onClick={() => setLegalForm(p => ({ ...p, active: !p.active }))}
                          className={cn("flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer border transition-colors",
                            legalForm.active ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "bg-red-500/10 text-red-500 border-red-500/30"
                          )}>
                          {legalForm.active ? <Eye size={14} /> : <EyeOff size={14} />}
                          {legalForm.active ? tc("active") : tc("inactive")}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t("legalTextLabel")}</label>
                    <textarea value={legalForm.text} onChange={e => setLegalForm(p => ({ ...p, text: e.target.value }))}
                      rows={8} placeholder={t("legalTextPlaceholder")}
                      className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-border text-foreground text-sm outline-none resize-y leading-relaxed" />
                  </div>
                </>
              )}

              {showModal === "optout" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1.5">Lead ID</label>
                    <input value={optOutForm.lead_id} onChange={e => setOptOutForm(p => ({ ...p, lead_id: e.target.value }))}
                      placeholder={t("leadIdPlaceholder")}
                      className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-border text-foreground text-sm outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t("channel")}</label>
                    <select value={optOutForm.channel} onChange={e => setOptOutForm(p => ({ ...p, channel: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-border text-foreground text-sm outline-none">
                      <option value="whatsapp">WhatsApp</option>
                      <option value="instagram">Instagram</option>
                      <option value="messenger">Messenger</option>
                      <option value="telegram">Telegram</option>
                      <option value="sms">SMS</option>
                      <option value="email">Email</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t("reason")}</label>
                    <input value={optOutForm.reason} onChange={e => setOptOutForm(p => ({ ...p, reason: e.target.value }))}
                      placeholder={t("reasonPlaceholder")}
                      className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-border text-foreground text-sm outline-none" />
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
              <button onClick={() => setShowModal(null)}
                className="px-4 py-2.5 rounded-xl border border-border bg-transparent text-foreground text-sm font-medium cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
                {tc("cancel")}
              </button>
              <button
                onClick={showModal === "optout" ? handleCreateOptOut : handleSaveLegal}
                disabled={saving || (showModal === "optout" ? !optOutForm.lead_id : !legalForm.text)}
                className="px-5 py-2.5 rounded-xl border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity">
                {saving ? tc("saving") : showModal === "edit-legal" ? tc("save") : tc("create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-xl text-sm font-semibold bg-emerald-500 text-white shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
