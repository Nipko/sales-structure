"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Shield, FileText, UserCheck, UserX, Trash2, Plus, X, Eye, Check
} from "lucide-react";

type Tab = "legal" | "consents" | "optouts" | "deletions";

export default function CompliancePage() {
    const t = useTranslations('compliance');
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [tab, setTab] = useState<Tab>("legal");
    const [legalTexts, setLegalTexts] = useState<any[]>([]);
    const [consents, setConsents] = useState<any[]>([]);
    const [optOuts, setOptOuts] = useState<any[]>([]);
    const [deletions, setDeletions] = useState<any[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const [legalForm, setLegalForm] = useState({ channel: "web", version: 1, text: "" });
    const [optOutForm, setOptOutForm] = useState({ lead_id: "", channel: "whatsapp", reason: "" });
    const [saving, setSaving] = useState(false);
    const [optOutFilter, setOptOutFilter] = useState("");
    const [optOutStats, setOptOutStats] = useState<any>(null);
    const [reviewNotes, setReviewNotes] = useState("");

    useEffect(() => {
        if (!activeTenantId) return;
        loadAll();
    }, [activeTenantId]);

    async function loadAll() {
        try {
            const [lt, co, oo, dr, stats] = await Promise.all([
                api.fetch(`/compliance/legal-texts/${activeTenantId}`),
                api.fetch(`/compliance/consents/${activeTenantId}`),
                api.getOptOuts(activeTenantId!),
                api.fetch(`/compliance/deletion-requests/${activeTenantId}`),
                api.getOptOutStats(activeTenantId!),
            ]);
            if (Array.isArray(lt)) setLegalTexts(lt);
            if (Array.isArray(co)) setConsents(co);
            if (oo?.success && Array.isArray(oo.data)) setOptOuts(oo.data);
            if (Array.isArray(dr)) setDeletions(dr);
            if (stats?.success) setOptOutStats(stats.data);
        } catch (err) { console.error(err); }
    }

    const handleCreateLegal = async () => {
        if (!legalForm.text || !activeTenantId) return;
        setSaving(true);
        try {
            const created = await api.fetch(`/compliance/legal-texts/${activeTenantId}`, { method: "POST", body: JSON.stringify(legalForm) });
            if (created?.id) { setLegalTexts(prev => [created, ...prev]); setShowModal(false); setToast("Legal text created"); setTimeout(() => setToast(null), 2500); }
        } catch (err) { console.error(err); } finally { setSaving(false); }
    };

    const handleCreateOptOut = async () => {
        if (!optOutForm.lead_id || !activeTenantId) return;
        setSaving(true);
        try {
            const created = await api.fetch(`/compliance/opt-outs/${activeTenantId}`, { method: "POST", body: JSON.stringify(optOutForm) });
            if (created?.id) { setOptOuts(prev => [created, ...prev]); setShowModal(false); setToast("Opt-out registered"); setTimeout(() => setToast(null), 2500); }
        } catch (err) { console.error(err); } finally { setSaving(false); }
    };

    const handleProcessDeletion = async (id: string) => {
        try {
            await api.fetch(`/compliance/deletion-requests/${activeTenantId}/${id}/process`, { method: "PUT" });
            setDeletions(prev => prev.map(d => d.id === id ? { ...d, status: "processed", processed_at: new Date().toISOString() } : d));
            setToast("Request processed"); setTimeout(() => setToast(null), 2500);
        } catch (err) { console.error(err); }
    };

    const tabs: { key: Tab; label: string; icon: any; count: number }[] = [
        { key: "legal", label: t('legalTexts'), icon: FileText, count: legalTexts.length },
        { key: "consents", label: t('consents'), icon: UserCheck, count: consents.length },
        { key: "optouts", label: t('optOuts'), icon: UserX, count: optOuts.length },
        { key: "deletions", label: t('deletionRequests'), icon: Trash2, count: deletions.length },
    ];

    return (
        <>
            <div>
                {/* Header */}
                <PageHeader
                    title={t('title')}
                    subtitle={t('subtitle')}
                    icon={Shield}
                    action={(tab === "legal" || tab === "optouts") ? (
                        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect">
                            <Plus size={16} /> {tc("create")}
                        </button>
                    ) : undefined}
                />

                {/* Tabs */}
                <div className="flex gap-1 mb-5 bg-card rounded-xl p-1 border border-border">
                    {tabs.map(t => {
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setTab(t.key)}
                                className={cn(
                                    "flex-1 px-3 py-2.5 rounded-lg border-none font-semibold text-[13px] cursor-pointer flex items-center justify-center gap-1.5 transition-all duration-200",
                                    tab === t.key ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground"
                                )}
                            >
                                <Icon size={16} /> {t.label} <span className="text-[11px] opacity-70">({t.count})</span>
                            </button>
                        );
                    })}
                </div>

                {/* Content */}
                {tab === "legal" && (
                    <div className="flex flex-col gap-2.5">
                        {legalTexts.map(lt => (
                            <div key={lt.id} className="px-5 py-3.5 rounded-xl border border-border bg-card">
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <FileText size={16} className="text-primary" />
                                        <span className="font-semibold">v{lt.version}</span>
                                        <span className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: "#3498db22", color: "#3498db" }}>{lt.channel}</span>
                                        <span className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: lt.active ? "#2ecc7122" : "#e74c3c22", color: lt.active ? "#2ecc71" : "#e74c3c" }}>{lt.active ?  tc("active") : tc("inactive")}</span>
                                    </div>
                                    <span className="text-xs text-muted-foreground">{new Date(lt.created_at).toLocaleDateString()}</span>
                                </div>
                                <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">{lt.text?.substring(0, 200)}{lt.text?.length > 200 ? "..." : ""}</p>
                            </div>
                        ))}
                        {legalTexts.length === 0 && <div className="text-center py-10 text-muted-foreground">No legal texts configured.</div>}
                    </div>
                )}

                {tab === "consents" && (
                    <div className="flex flex-col gap-2">
                        {consents.map(c => (
                            <div key={c.id} className="px-5 py-3 rounded-xl border border-border bg-card flex justify-between items-center">
                                <div>
                                    <span className="font-semibold text-[13px]">Lead: {c.lead_id?.substring(0, 8) || "N/A"}...</span>
                                    <span className="ml-3 text-xs text-muted-foreground">Canal: {c.channel} · v{c.legal_text_version}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{new Date(c.granted_at).toLocaleString()}</span>
                            </div>
                        ))}
                        {consents.length === 0 && <div className="text-center py-10 text-muted-foreground">No consents registered yet.</div>}
                    </div>
                )}

                {tab === "optouts" && (
                    <div>
                        {/* Stats */}
                        {optOutStats?.optOuts && (
                            <div className="grid grid-cols-3 gap-3 mb-4">
                                {[
                                    { label: t('stats.pending'), value: optOutStats.optOuts.pending || 0, color: "text-amber-500", bg: "bg-amber-500/10" },
                                    { label: t('stats.confirmed'), value: optOutStats.optOuts.confirmed || 0, color: "text-red-500", bg: "bg-red-500/10" },
                                    { label: t('stats.rejected'), value: optOutStats.optOuts.rejected || 0, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                                ].map(s => (
                                    <div key={s.label} className={cn("rounded-xl border border-border p-4 text-center", s.bg)}>
                                        <div className={cn("text-2xl font-semibold", s.color)}>{s.value}</div>
                                        <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Filter */}
                        <div className="flex gap-1.5 mb-4">
                            {["", "pending", "confirmed", "rejected"].map(f => (
                                <button key={f} onClick={async () => {
                                    setOptOutFilter(f);
                                    const res = await api.getOptOuts(activeTenantId!, f || undefined);
                                    if (res?.success) setOptOuts(res.data);
                                }} className={cn(
                                    "px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors",
                                    optOutFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/50"
                                )}>
                                    {f === "" ? "All" : f === "pending" ? t('stats.pending') : f === "confirmed" ? t('stats.confirmed') : t('stats.rejected')}
                                </button>
                            ))}
                        </div>

                        {/* List */}
                        <div className="flex flex-col gap-2.5">
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
                                                {o.status === "pending" ? tc("pending") : o.status === "confirmed" ? "Confirmed" : "Rejected (false positive)"}
                                            </span>
                                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-500">{o.channel}</span>
                                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-neutral-500/10 text-muted-foreground">{o.detected_from || "keyword"}</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground shrink-0">{new Date(o.created_at).toLocaleString("es-CO")}</span>
                                    </div>

                                    {/* Contact info */}
                                    <div className="text-sm mb-2">
                                        <span className="font-semibold text-foreground">{o.first_name || ""} {o.last_name || ""}</span>
                                        <span className="text-muted-foreground ml-2">{o.phone || o.lead_phone || tc("noData")}</span>
                                    </div>

                                    {/* Trigger message */}
                                    <div className="bg-neutral-100 dark:bg-neutral-800 rounded-lg px-3 py-2 text-sm text-foreground mb-3 border-l-3 border-amber-500">
                                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground block mb-1">{t('detectedMessage')}:</span>
                                        &ldquo;{o.trigger_msg}&rdquo;
                                    </div>

                                    {/* Review info if reviewed */}
                                    {o.reviewed_at && (
                                        <div className="text-xs text-muted-foreground mb-2">
                                            Reviewed by <span className="font-semibold">{o.reviewer_first} {o.reviewer_last}</span> el {new Date(o.reviewed_at).toLocaleString("es-CO")}
                                            {o.review_notes && <span className="ml-2">— &ldquo;{o.review_notes}&rdquo;</span>}
                                        </div>
                                    )}

                                    {/* Actions for pending */}
                                    {o.status === "pending" && (
                                        <div className="flex items-center gap-2 mt-2">
                                            <input value={reviewNotes} onChange={e => setReviewNotes(e.target.value)}
                                                placeholder="Note (optional)..."
                                                className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-xs outline-none" />
                                            <button onClick={async () => {
                                                await api.confirmOptOut(activeTenantId!, o.id, reviewNotes);
                                                setOptOuts(prev => prev.map(x => x.id === o.id ? { ...x, status: "confirmed", reviewed_at: new Date().toISOString() } : x));
                                                setReviewNotes(""); setToast("Opt-out confirmed"); setTimeout(() => setToast(null), 2500);
                                                const stats = await api.getOptOutStats(activeTenantId!); if (stats?.success) setOptOutStats(stats.data);
                                            }} className="px-3 py-1.5 rounded-lg border-none bg-red-500 text-white text-xs font-semibold cursor-pointer flex items-center gap-1">
                                                <UserX size={12} /> {t('confirmOptOut')}
                                            </button>
                                            <button onClick={async () => {
                                                await api.rejectOptOut(activeTenantId!, o.id, reviewNotes);
                                                setOptOuts(prev => prev.map(x => x.id === o.id ? { ...x, status: "rejected", reviewed_at: new Date().toISOString() } : x));
                                                setReviewNotes(""); setToast("Marked as false positive"); setTimeout(() => setToast(null), 2500);
                                                const stats = await api.getOptOutStats(activeTenantId!); if (stats?.success) setOptOutStats(stats.data);
                                            }} className="px-3 py-1.5 rounded-lg border border-emerald-500 bg-transparent text-emerald-500 text-xs font-semibold cursor-pointer flex items-center gap-1">
                                                <Check size={12} /> {t('rejectOptOut')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {optOuts.length === 0 && <div className="text-center py-10 text-muted-foreground">No opt-outs {optOutFilter ? `with status "${optOutFilter}"` : "registered"}.</div>}
                        </div>
                    </div>
                )}

                {tab === "deletions" && (
                    <div className="flex flex-col gap-2">
                        {deletions.map(d => (
                            <div key={d.id} className="px-5 py-3 rounded-xl border border-border bg-card flex justify-between items-center">
                                <div>
                                    <span className="font-semibold text-[13px]">Lead: {d.lead_id?.substring(0, 8) || "N/A"}...</span>
                                    <span className="ml-3 text-[11px] px-2 py-0.5 rounded-md" style={{ background: d.status === "processed" ? "#2ecc7122" : "#f39c1222", color: d.status === "processed" ? "#2ecc71" : "#f39c12" }}>{d.status}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">Requested by: {d.requested_by || "System"}</span>
                                </div>
                                <div className="flex gap-2 items-center">
                                    <span className="text-xs text-muted-foreground">{new Date(d.requested_at).toLocaleDateString()}</span>
                                    {d.status === "pending" && (
                                        <button onClick={() => handleProcessDeletion(d.id)} className="px-3 py-1 rounded-md border-none bg-emerald-500 text-white text-xs cursor-pointer flex items-center gap-1">
                                            <Check size={12} /> Process
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {deletions.length === 0 && <div className="text-center py-10 text-muted-foreground">No deletion requests.</div>}
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} className="w-[480px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-semibold m-0">{tab === "legal" ? "New Legal Text" : "Register Opt-Out"}</h2>
                            <button onClick={() => setShowModal(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>

                        {tab === "legal" && (
                            <>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Channel</label>
                                    <select value={legalForm.channel} onChange={e => setLegalForm(p => ({ ...p, channel: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border">
                                        <option value="web">Web</option>
                                        <option value="whatsapp">WhatsApp</option>
                                        <option value="email">Email</option>
                                    </select>
                                </div>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Version</label>
                                    <input type="number" value={legalForm.version} onChange={e => setLegalForm(p => ({ ...p, version: parseInt(e.target.value) || 1 }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                                </div>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Legal Text</label>
                                    <textarea value={legalForm.text} onChange={e => setLegalForm(p => ({ ...p, text: e.target.value }))} rows={5} placeholder="I accept the terms and conditions for personal data processing..." className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border resize-y" />
                                </div>
                                <div className="flex gap-2.5 mt-5">
                                    <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer">Cancel</button>
                                    <button onClick={handleCreateLegal} disabled={saving || !legalForm.text} className={cn("flex-1 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold", saving ? "bg-muted cursor-wait" : "bg-primary cursor-pointer")}>{saving ? t("saving") || "..." : tc("create")}</button>
                                </div>
                            </>
                        )}

                        {tab === "optouts" && (
                            <>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Lead ID</label>
                                    <input value={optOutForm.lead_id} onChange={e => setOptOutForm(p => ({ ...p, lead_id: e.target.value }))} placeholder="Lead UUID" className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                                </div>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Channel</label>
                                    <select value={optOutForm.channel} onChange={e => setOptOutForm(p => ({ ...p, channel: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border">
                                        <option value="whatsapp">WhatsApp</option>
                                        <option value="email">Email</option>
                                        <option value="sms">SMS</option>
                                    </select>
                                </div>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Reason</label>
                                    <input value={optOutForm.reason} onChange={e => setOptOutForm(p => ({ ...p, reason: e.target.value }))} placeholder="User request" className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                                </div>
                                <div className="flex gap-2.5 mt-5">
                                    <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer">Cancel</button>
                                    <button onClick={handleCreateOptOut} disabled={saving || !optOutForm.lead_id} className={cn("flex-1 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold", saving ? "bg-muted cursor-wait" : "bg-red-500 cursor-pointer")}>{saving ? t("saving") || "..." : "Register Opt-Out"}</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold bg-emerald-500 text-white shadow-lg animate-in">
                    ✓ {toast}
                </div>
            )}
        </>
    );
}
