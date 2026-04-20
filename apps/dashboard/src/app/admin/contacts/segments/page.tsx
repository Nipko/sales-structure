"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import {
    Users, Plus, X, ArrowLeft, Filter, Calendar, Check, Eye,
} from "lucide-react";

interface Segment { id: string; name: string; description: string; filter_rules: FilterRule[]; contact_count: number; created_at: string; }
interface FilterRule { field: string; operator: string; value: string; }
interface Contact { id: string; name: string; phone: string; email: string; stage: string; score: number; }

const emptyForm = () => ({
    name: "", description: "",
    filterRules: [{ field: "stage", operator: "eq", value: "" }] as FilterRule[],
});

export default function SegmentsPage() {
    const tc = useTranslations("common");
    const t = useTranslations("contacts.segmentsPage");
    const { activeTenantId } = useTenant();
    const [segments, setSegments] = useState<Segment[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState(emptyForm());
    const [previewCount, setPreviewCount] = useState<number | null>(null);
    const [viewingSegment, setViewingSegment] = useState<Segment | null>(null);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [contactsLoading, setContactsLoading] = useState(false);

    const FIELDS = [
        { value: "stage", label: t("fields.stage") },
        { value: "score", label: t("fields.score") },
        { value: "phone", label: t("fields.phone") },
        { value: "email", label: t("fields.email") },
        { value: "source", label: t("fields.source") },
        { value: "is_vip", label: t("fields.isVip") },
        { value: "created_at", label: t("fields.createdAt") },
    ];

    const OPERATORS = [
        { value: "eq", label: t("operators.eq") },
        { value: "neq", label: t("operators.neq") },
        { value: "gt", label: t("operators.gt") },
        { value: "gte", label: t("operators.gte") },
        { value: "lt", label: t("operators.lt") },
        { value: "lte", label: t("operators.lte") },
        { value: "contains", label: t("operators.contains") },
        { value: "in", label: t("operators.in") },
    ];

    useEffect(() => { loadSegments(); }, [activeTenantId]);

    async function loadSegments() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res = await api.getSegments(activeTenantId);
            if (res.success && Array.isArray(res.data)) setSegments(res.data);
        } catch (err) { console.error("Error loading segments", err); }
        finally { setLoading(false); }
    }

    function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }
    function openCreate() { setForm(emptyForm()); setPreviewCount(null); setModalOpen(true); }
    function addFilter() { setForm(prev => ({ ...prev, filterRules: [...prev.filterRules, { field: "stage", operator: "eq", value: "" }] })); }
    function removeFilter(idx: number) { setForm(prev => ({ ...prev, filterRules: prev.filterRules.filter((_, i) => i !== idx) })); }
    function updateFilter(idx: number, key: keyof FilterRule, value: string) { setForm(prev => ({ ...prev, filterRules: prev.filterRules.map((f, i) => i === idx ? { ...f, [key]: value } : f) })); }

    async function handlePreview() {
        if (!activeTenantId) return;
        try {
            const res = await api.createSegment(activeTenantId, { ...form, preview: true });
            if (res.success && res.data) setPreviewCount((res.data as any).count ?? 0);
        } catch { showToast(tc("errorSaving")); }
    }

    async function handleSave() {
        if (!activeTenantId || !form.name.trim()) return;
        try {
            const res = await api.createSegment(activeTenantId, form);
            if (res.success) { showToast(t("created")); setModalOpen(false); loadSegments(); }
            else showToast(res.error || tc("errorSaving"));
        } catch { showToast(tc("connectionError")); }
    }

    async function viewSegmentContacts(segment: Segment) {
        if (!activeTenantId) return;
        setViewingSegment(segment); setContactsLoading(true);
        try {
            const res = await api.getSegmentContacts(activeTenantId, segment.id);
            if (res.success && Array.isArray(res.data)) setContacts(res.data);
        } catch { showToast(tc("errorSaving")); }
        finally { setContactsLoading(false); }
    }

    function formatDate(d: string) {
        try { return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); }
        catch { return d; }
    }

    // Detail View
    if (viewingSegment) {
        return (
            <div className="p-8 max-w-[1100px] mx-auto">
                {toast && (
                    <div className={cn("fixed top-6 right-6 z-[9999] text-white px-6 py-3 rounded-[10px] text-sm font-semibold shadow-lg", toast.includes("Error") ? "bg-destructive" : "bg-[var(--success)]")}>
                        {toast}
                    </div>
                )}
                <button onClick={() => { setViewingSegment(null); setContacts([]); }} className="flex items-center gap-1.5 bg-transparent border-none text-primary cursor-pointer text-sm font-semibold mb-5 p-0">
                    <ArrowLeft size={16} /> {t("backToSegments")}
                </button>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center">
                        <Users size={22} className="text-primary" />
                    </div>
                    <div>
                        <h1 className="text-[22px] font-semibold text-foreground m-0">{viewingSegment.name}</h1>
                        <p className="text-[13px] text-muted-foreground m-0">{viewingSegment.description || tc("noData")}</p>
                    </div>
                    <span className="ml-auto px-3.5 py-1 rounded-full bg-[var(--success)]/10 text-[var(--success)] text-[13px] font-semibold">
                        {contacts.length} {t("contacts")}
                    </span>
                </div>
                <div className="bg-card rounded-[14px] border border-border overflow-hidden">
                    {contactsLoading ? (
                        <div className="p-10 text-center text-muted-foreground">{t("loadingContacts")}</div>
                    ) : contacts.length === 0 ? (
                        <div className="p-10 text-center text-muted-foreground">{t("noContactsFound")}</div>
                    ) : (
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="border-b border-border">
                                    {[t("table.name"), t("table.phone"), t("table.email"), t("table.stage"), t("table.score")].map(h => (
                                        <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {contacts.map(c => (
                                    <tr key={c.id} className="border-b border-border">
                                        <td className="px-4 py-3 text-[13px] text-foreground font-semibold">{c.name || "\u2014"}</td>
                                        <td className="px-4 py-3 text-[13px] text-muted-foreground">{c.phone || "\u2014"}</td>
                                        <td className="px-4 py-3 text-[13px] text-muted-foreground">{c.email || "\u2014"}</td>
                                        <td className="px-4 py-3">
                                            <span className="px-2.5 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-semibold">{c.stage || "\u2014"}</span>
                                        </td>
                                        <td className="px-4 py-3 text-[13px] text-foreground font-semibold">{c.score ?? "\u2014"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        );
    }

    // Main List
    return (
        <div className="p-8 max-w-[1100px] mx-auto">
            {toast && (
                <div className={cn("fixed top-6 right-6 z-[9999] text-white px-6 py-3 rounded-[10px] text-sm font-semibold shadow-lg", toast.includes("Error") ? "bg-destructive" : "bg-[var(--success)]")}>
                    {toast}
                </div>
            )}
            <div className="flex justify-between items-center mb-7">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center">
                        <Users size={22} className="text-primary" />
                    </div>
                    <div>
                        <h1 className="text-[22px] font-semibold text-foreground m-0">{t("title")}</h1>
                        <p className="text-[13px] text-muted-foreground m-0">{t("subtitle")}</p>
                    </div>
                </div>
                <button onClick={openCreate} className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold">
                    <Plus size={16} /> {t("newSegment")}
                </button>
            </div>

            <div className="flex flex-col gap-3">
                {loading ? (
                    <div className="p-10 text-center text-muted-foreground">{t("loading")}</div>
                ) : segments.length === 0 ? (
                    <div className="p-12 text-center bg-card rounded-[14px] border border-border">
                        <Users size={36} className="text-muted-foreground opacity-40 mb-3" />
                        <p className="text-muted-foreground text-sm">{t("empty")}</p>
                    </div>
                ) : (
                    segments.map(seg => (
                        <div
                            key={seg.id}
                            onClick={() => viewSegmentContacts(seg)}
                            className="bg-card rounded-[14px] border border-border px-[22px] py-[18px] cursor-pointer transition-colors duration-200 flex items-center justify-between hover:border-primary/40"
                        >
                            <div className="flex items-center gap-3.5">
                                <div className="w-[38px] h-[38px] rounded-[10px] bg-primary/10 flex items-center justify-center">
                                    <Filter size={18} className="text-primary" />
                                </div>
                                <div>
                                    <div className="text-[15px] font-semibold text-foreground">{seg.name}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">{seg.description || tc("noData")}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="px-3.5 py-1 rounded-full bg-[var(--success)]/10 text-[var(--success)] text-[13px] font-semibold">
                                    {seg.contact_count ?? 0} {t("contacts")}
                                </span>
                                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                                    <Calendar size={12} />
                                    {formatDate(seg.created_at)}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Create Modal */}
            {modalOpen && (
                <div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center" onClick={() => setModalOpen(false)}>
                    <div className="bg-secondary rounded-xl border border-border p-7 w-[560px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-lg font-semibold text-foreground m-0">{t("newSegment")}</h2>
                            <button onClick={() => setModalOpen(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={18} /></button>
                        </div>
                        <div className="flex flex-col gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("form.name")} *</label>
                                <input value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder={t("form.namePlaceholder")} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("form.description")}</label>
                                <input value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} placeholder={t("form.descriptionPlaceholder")} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("form.filters")}</label>
                                <div className="flex flex-col gap-2.5">
                                    {form.filterRules.map((rule, idx) => (
                                        <div key={idx} className="flex gap-2 items-center bg-background rounded-[10px] border border-border px-3 py-2.5">
                                            <select value={rule.field} onChange={e => updateFilter(idx, "field", e.target.value)} className="w-[30%] px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border">
                                                {FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                            </select>
                                            <select value={rule.operator} onChange={e => updateFilter(idx, "operator", e.target.value)} className="w-[30%] px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border">
                                                {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                            <input value={rule.value} onChange={e => updateFilter(idx, "value", e.target.value)} placeholder={rule.operator === "in" ? t("form.valuePlaceholderIn") : t("form.valuePlaceholder")} className="w-[30%] px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                                            <button onClick={() => removeFilter(idx)} className="w-[30px] h-[30px] rounded-md bg-destructive/10 border border-destructive/20 text-destructive cursor-pointer flex items-center justify-center shrink-0">
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={addFilter} className="flex items-center gap-1.5 mt-2.5 px-3.5 py-2 rounded-lg bg-transparent border border-dashed border-border text-primary cursor-pointer text-[13px] font-semibold">
                                    <Plus size={14} /> {t("form.addFilter")}
                                </button>
                            </div>
                            <div className="flex items-center gap-3">
                                <button onClick={handlePreview} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary cursor-pointer text-[13px] font-semibold">
                                    <Eye size={14} /> {t("form.preview")}
                                </button>
                                {previewCount !== null && (
                                    <span className="text-[13px] text-[var(--success)] font-semibold">{previewCount} {t("form.contactsMatch")}</span>
                                )}
                            </div>
                        </div>
                        <div className="flex justify-end gap-2.5 mt-6">
                            <button onClick={() => setModalOpen(false)} className="px-5 py-2.5 rounded-lg bg-transparent border border-border text-muted-foreground cursor-pointer text-sm">{t("form.cancel")}</button>
                            <button onClick={handleSave} className="px-5 py-2.5 rounded-lg bg-primary border-none text-white cursor-pointer text-sm font-semibold">
                                <span className="flex items-center gap-1.5"><Check size={16} /> {t("form.create")}</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
