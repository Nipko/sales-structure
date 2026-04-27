"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
    Search,
    Filter,
    Phone,
    Mail,
    MessageSquare,
    Tag,
    User,
    UserPlus,
    Users,
    Upload,
    Download,
    MoreVertical,
    ChevronDown,
    ArrowUpDown,
    Eye,
    X,
    Loader2,
    CheckSquare,
    Square,
    Archive,
} from "lucide-react";

const segmentStyles: Record<string, string> = {
    new: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
    lead: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
    qualified: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400",
    customer: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
    churned: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400",
};

export default function ContactsPage() {
    const t = useTranslations('contacts');
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const router = useRouter();
    const [contacts, setContacts] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeSegment, setActiveSegment] = useState<string>("all");
    const [isLive, setIsLive] = useState(false);
    const [loading, setLoading] = useState(true);
    const [showImportModal, setShowImportModal] = useState(false);
    const [csvContent, setCsvContent] = useState("");
    const [importResult, setImportResult] = useState<any>(null);
    const [importing, setImporting] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createForm, setCreateForm] = useState({ first_name: "", last_name: "", phone: "", email: "", stage: "nuevo" });
    const [creating, setCreating] = useState(false);

    // Bulk selection
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkAction, setBulkAction] = useState("");
    const [bulkPayload, setBulkPayload] = useState("");
    const [bulking, setBulking] = useState(false);

    // Load contacts from API
    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            setLoading(true);
            try {
                // Fetch leads matching the API model
                const data = await api.fetch(`/crm/leads/${activeTenantId}`);

                if (data.success && Array.isArray(data.data)) {
                    // Map Real Lead data to UI variables we use
                    const mappedLeads = data.data.map((l: any) => {
                       // We extrapolate 'customer', 'qualified', 'new' from stages
                       let segmentType = "new";
                       if (["calificado", "tibio", "caliente", "listo_cierre"].includes(l.stage)) segmentType = "qualified";
                       if (["ganado"].includes(l.stage)) segmentType = "customer";
                       if (["perdido", "no_interesado"].includes(l.stage)) segmentType = "churned";
                       if (["contactado", "respondio"].includes(l.stage)) segmentType = "lead";

                       return {
                           id: l.id,
                           name: `${l.first_name || 'Desconocido'} ${l.last_name || ''}`.trim(),
                           phone: l.phone || tc('noData'),
                           email: l.email || '',
                           tags: l.tags?.map((t:any) => t.name) || [],
                           segment: segmentType,
                           conversations: Number(l.conversations_count ?? 0),
                           lifetimeValue: Number(l.lifetime_value ?? 0),
                           lastInteraction: l.last_message_at ? new Date(l.last_message_at).toLocaleDateString(undefined) : (l.created_at ? new Date(l.created_at).toLocaleDateString(undefined) : t('noInteraction')),
                           city: l.company_name || "",
                       }
                    });
                    setContacts(mappedLeads);
                    setIsLive(true);
                }
            } catch (err) {
                console.error("Failed fetching leads:", err);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [activeTenantId]);

    const segments = [
        { key: "all", label: t('segments.all'), count: contacts.length },
        { key: "lead", label: t('segments.lead'), count: contacts.filter(c => c.segment === "lead").length },
        { key: "qualified", label: t('segments.qualified'), count: contacts.filter(c => c.segment === "qualified").length },
        { key: "customer", label: t('segments.customer'), count: contacts.filter(c => c.segment === "customer").length },
    ];

    const filtered = contacts.filter(c => {
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return c.name.toLowerCase().includes(q) || c.phone.includes(q) || (c.email || "").toLowerCase().includes(q);
        }
        if (activeSegment !== "all") return c.segment === activeSegment;
        return true;
    });

    const totalValue = contacts.reduce((sum, contact) => sum + Number(contact.lifetimeValue || 0), 0);

    const handleImport = async () => {
        if (!activeTenantId || !csvContent.trim()) return;
        setImporting(true);
        setImportResult(null);
        try {
            const result = await api.fetch(`/crm/import/${activeTenantId}`, {
                method: "POST",
                body: JSON.stringify({ csvContent }),
            });
            setImportResult(result);
        } catch (err) {
            setImportResult({ success: false, error: tc("errorSaving") });
        } finally {
            setImporting(false);
        }
    };

    const handleExport = async () => {
        if (!activeTenantId) return;
        setExporting(true);
        try {
            const result = await api.fetch(`/crm/export/${activeTenantId}`);
            const blob = new Blob([typeof result === "string" ? result : JSON.stringify(result)], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `contactos_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Export failed:", err);
        } finally {
            setExporting(false);
        }
    };

    const handleDownloadTemplate = async () => {
        try {
            const result = await api.fetch("/crm/import-template");
            const blob = new Blob([typeof result === "string" ? result : JSON.stringify(result)], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "plantilla_contactos.csv";
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Template download failed:", err);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title={t('title')}
                subtitle={`${contacts.length} contacts · $${totalValue.toLocaleString()}`}
                badge={<DataSourceBadge isLive={isLive} />}
                action={
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => router.push("/admin/contacts/segments")}
                            className="gap-1.5 rounded-lg border-neutral-200 dark:border-neutral-700">
                            <Users size={16} /> {t('segmentsButton')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowImportModal(true)}
                            className="gap-1.5 rounded-lg border-neutral-200 dark:border-neutral-700">
                            <Upload size={16} /> {t('import')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}
                            className="gap-1.5 rounded-lg border-neutral-200 dark:border-neutral-700">
                            <Download size={16} /> {t('export')}
                        </Button>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect"
                        >
                            <UserPlus size={16} /> {tc("create")}
                        </button>
                    </div>
                }
            />

            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {segments.map(seg => (
                    <button
                        key={seg.key}
                        onClick={() => setActiveSegment(seg.key)}
                        className={cn(
                            "rounded-xl border p-4 text-left transition-colors",
                            activeSegment === seg.key
                                ? "border-indigo-500 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-500/10"
                                : "border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/50"
                        )}
                    >
                        <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{seg.count}</div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">{seg.label}</div>
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                <Input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={t('search')}
                    className="h-10 rounded-lg border-neutral-200 bg-white pl-10 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                />
            </div>

            {/* Bulk Actions Bar */}
            {selectedIds.size > 0 && (
                <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-500/30 dark:bg-indigo-500/10">
                    <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                        {selectedIds.size} {t('bulkActions.selected')}
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                        <select
                            value={bulkAction}
                            onChange={e => { setBulkAction(e.target.value); setBulkPayload(""); }}
                            className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 outline-none"
                        >
                            <option value="">{t('bulkActions.selectAction')}</option>
                            <option value="stage">{t('bulkActions.changeStage')}</option>
                            <option value="tag">{t('bulkActions.addTag')}</option>
                            <option value="archive">{t('bulkActions.archive')}</option>
                        </select>
                        {bulkAction === 'stage' && (
                            <select
                                value={bulkPayload}
                                onChange={e => setBulkPayload(e.target.value)}
                                className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 outline-none"
                            >
                                <option value="">—</option>
                                <option value="nuevo">Nuevo</option>
                                <option value="contactado">Contactado</option>
                                <option value="calificado">Calificado</option>
                                <option value="ganado">Ganado</option>
                                <option value="perdido">Perdido</option>
                            </select>
                        )}
                        {bulkAction === 'tag' && (
                            <input
                                type="text"
                                value={bulkPayload}
                                onChange={e => setBulkPayload(e.target.value)}
                                placeholder={t('bulkActions.tagName')}
                                className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 outline-none w-40"
                            />
                        )}
                        <button
                            onClick={async () => {
                                if (!activeTenantId || !bulkAction) return;
                                setBulking(true);
                                try {
                                    const payload = bulkAction === 'stage' ? { stage: bulkPayload }
                                        : bulkAction === 'tag' ? { tag: bulkPayload }
                                        : {};
                                    await api.fetch(`/crm/leads/${activeTenantId}/bulk-update`, {
                                        method: 'POST',
                                        body: JSON.stringify({ leadIds: Array.from(selectedIds), action: bulkAction, payload }),
                                    });
                                    setSelectedIds(new Set());
                                    setBulkAction("");
                                    setBulkPayload("");
                                    // Reload
                                    const data = await api.fetch(`/crm/leads/${activeTenantId}`);
                                    if (data.success && Array.isArray(data.data)) {
                                        const mapped = data.data.map((l: any) => {
                                            let seg = "new";
                                            if (["calificado", "tibio", "caliente", "listo_cierre"].includes(l.stage)) seg = "qualified";
                                            if (["ganado"].includes(l.stage)) seg = "customer";
                                            if (["perdido", "no_interesado"].includes(l.stage)) seg = "churned";
                                            if (["contactado", "respondio"].includes(l.stage)) seg = "lead";
                                            return { id: l.id, name: `${l.first_name || ''} ${l.last_name || ''}`.trim() || 'Unknown', phone: l.phone || '', email: l.email || '', tags: l.tags?.map((tg: any) => tg.name) || [], segment: seg, conversations: 0, lifetimeValue: 0, lastInteraction: l.created_at ? new Date(l.created_at).toLocaleDateString() : '', city: l.company_name || '' };
                                        });
                                        setContacts(mapped);
                                    }
                                } catch (err) {
                                    console.error("Bulk action failed:", err);
                                } finally {
                                    setBulking(false);
                                }
                            }}
                            disabled={bulking || !bulkAction || (bulkAction !== 'archive' && !bulkPayload)}
                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg border-none bg-indigo-600 text-white text-sm font-semibold cursor-pointer hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {bulking ? <Loader2 size={14} className="animate-spin" /> : null}
                            {t('bulkActions.apply')}
                        </button>
                        <button
                            onClick={() => { setSelectedIds(new Set()); setBulkAction(""); }}
                            className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-transparent text-sm text-neutral-600 cursor-pointer hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                        >
                            {tc("cancel")}
                        </button>
                    </div>
                </div>
            )}

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="border-b border-neutral-100 dark:border-neutral-800">
                            <th className="w-10 px-3 py-3">
                                <button
                                    onClick={() => {
                                        if (selectedIds.size === filtered.length) setSelectedIds(new Set());
                                        else setSelectedIds(new Set(filtered.map(c => c.id)));
                                    }}
                                    className="bg-transparent border-none cursor-pointer p-0 text-neutral-400 hover:text-primary"
                                >
                                    {selectedIds.size > 0 && selectedIds.size === filtered.length
                                        ? <CheckSquare size={16} className="text-primary" />
                                        : <Square size={16} />
                                    }
                                </button>
                            </th>
                            {[t('title'), t('segment'), t('conversations'), t('lifetimeValue'), t('lastInteraction'), t('tags'), ""].map(h => (
                                <th
                                    key={h}
                                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                                >
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(contact => {
                            const segClass = segmentStyles[contact.segment] || segmentStyles.new;
                            return (
                                <tr
                                    key={contact.id}
                                    className="border-b border-neutral-100 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
                                >
                                    <td className="w-10 px-3 py-3">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedIds(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(contact.id)) next.delete(contact.id);
                                                    else next.add(contact.id);
                                                    return next;
                                                });
                                            }}
                                            className="bg-transparent border-none cursor-pointer p-0 text-neutral-400 hover:text-primary"
                                        >
                                            {selectedIds.has(contact.id)
                                                ? <CheckSquare size={16} className="text-primary" />
                                                : <Square size={16} />
                                            }
                                        </button>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2.5">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-sm font-semibold text-white">
                                                {contact.name.charAt(0)}
                                            </div>
                                            <div>
                                                <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{contact.name}</div>
                                                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                                                    {contact.phone}
                                                    {contact.city && ` · ${contact.city}`}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <Badge variant="secondary" className={cn("rounded-md text-xs font-semibold", segClass)}>
                                            {contact.segment}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-1 text-sm text-neutral-700 dark:text-neutral-300">
                                            <MessageSquare size={14} className="text-neutral-400" />
                                            {contact.conversations}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                        {contact.lifetimeValue > 0 ? `$${contact.lifetimeValue.toLocaleString()}` : "—"}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
                                        {contact.lastInteraction}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            {contact.tags.slice(0, 3).map((tag: string) => (
                                                <Badge
                                                    key={tag}
                                                    variant="secondary"
                                                    className="rounded bg-indigo-100 px-1.5 py-0 text-[10px] text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400"
                                                >
                                                    {tag}
                                                </Badge>
                                            ))}
                                            {contact.tags.length > 3 && (
                                                <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                                                    +{contact.tags.length - 3}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <button
                                            onClick={() => router.push(`/admin/contacts/${contact.id}`)}
                                            className="rounded-md border-none bg-transparent p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                                        >
                                            <Eye size={16} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Create Lead Modal */}
            {showCreateModal && (
                <div onClick={() => setShowCreateModal(false)} className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div onClick={e => e.stopPropagation()} className="w-[480px] rounded-xl border border-neutral-200 bg-white p-7 dark:border-neutral-800 dark:bg-neutral-900">
                        <div className="mb-5 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t('createModal.title')}</h2>
                            <button onClick={() => setShowCreateModal(false)} className="rounded-md border-none bg-transparent p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="flex flex-col gap-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1 block">{t('createModal.firstName')}</label>
                                    <input type="text" value={createForm.first_name} onChange={e => setCreateForm(f => ({ ...f, first_name: e.target.value }))}
                                        className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
                                </div>
                                <div>
                                    <label className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1 block">{t('createModal.lastName')}</label>
                                    <input type="text" value={createForm.last_name} onChange={e => setCreateForm(f => ({ ...f, last_name: e.target.value }))}
                                        className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1 block">{t('createModal.phone')} *</label>
                                <input type="tel" value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                                    placeholder="+573001234567"
                                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
                            </div>
                            <div>
                                <label className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1 block">{t('createModal.email')}</label>
                                <input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
                            </div>
                            <div>
                                <label className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1 block">{t('createModal.stage')}</label>
                                <select value={createForm.stage} onChange={e => setCreateForm(f => ({ ...f, stage: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
                                    <option value="nuevo">Nuevo</option>
                                    <option value="contactado">Contactado</option>
                                    <option value="respondio">Respondió</option>
                                    <option value="calificado">Calificado</option>
                                </select>
                            </div>
                        </div>
                        <div className="mt-5 flex gap-3 justify-end">
                            <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-lg border border-neutral-200 bg-transparent text-sm text-neutral-700 dark:border-neutral-700 dark:text-neutral-300 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800">
                                {tc("cancel")}
                            </button>
                            <button
                                onClick={async () => {
                                    if (!activeTenantId || !createForm.phone.trim()) return;
                                    setCreating(true);
                                    try {
                                        await api.fetch(`/crm/leads/${activeTenantId}`, { method: "POST", body: JSON.stringify(createForm) });
                                        setShowCreateModal(false);
                                        setCreateForm({ first_name: "", last_name: "", phone: "", email: "", stage: "nuevo" });
                                        // Reload
                                        const data = await api.fetch(`/crm/leads/${activeTenantId}`);
                                        if (data.success && Array.isArray(data.data)) {
                                            const mappedLeads = data.data.map((l: any) => {
                                                let segmentType = "new";
                                                if (["calificado", "tibio", "caliente", "listo_cierre"].includes(l.stage)) segmentType = "qualified";
                                                if (["ganado"].includes(l.stage)) segmentType = "customer";
                                                if (["perdido", "no_interesado"].includes(l.stage)) segmentType = "churned";
                                                if (["contactado", "respondio"].includes(l.stage)) segmentType = "lead";
                                                return {
                                                    id: l.id,
                                                    name: `${l.first_name || ''} ${l.last_name || ''}`.trim() || 'Unknown',
                                                    phone: l.phone || tc('noData'),
                                                    email: l.email || '',
                                                    tags: l.tags?.map((tg: any) => tg.name) || [],
                                                    segment: segmentType,
                                                    conversations: Number(l.conversations_count ?? 0),
                                                    lifetimeValue: Number(l.lifetime_value ?? 0),
                                                    lastInteraction: l.created_at ? new Date(l.created_at).toLocaleDateString(undefined) : t('noInteraction'),
                                                    city: l.company_name || "",
                                                };
                                            });
                                            setContacts(mappedLeads);
                                        }
                                    } catch (err) {
                                        console.error("Create lead failed:", err);
                                    } finally {
                                        setCreating(false);
                                    }
                                }}
                                disabled={creating || !createForm.phone.trim()}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg border-none bg-indigo-600 text-white text-sm font-semibold cursor-pointer hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {creating && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                                {creating ? t('createModal.creating') : t('createModal.create')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Import CSV Modal */}
            {showImportModal && (
                <div
                    onClick={() => setShowImportModal(false)}
                    className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        className="max-h-[80vh] w-[520px] overflow-auto rounded-xl border border-neutral-200 bg-white p-7 dark:border-neutral-800 dark:bg-neutral-900"
                    >
                        <div className="mb-5 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t('importModal.title')}</h2>
                            <button
                                onClick={() => setShowImportModal(false)}
                                className="rounded-md border-none bg-transparent p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <button
                            onClick={handleDownloadTemplate}
                            className="mb-3 block border-none bg-transparent p-0 text-xs text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400"
                        >
                            {t('importModal.downloadTemplate')}
                        </button>

                        <textarea
                            value={csvContent}
                            onChange={e => setCsvContent(e.target.value)}
                            placeholder={t('importModal.placeholder')}
                            rows={8}
                            className="w-full resize-y rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                        />

                        {importResult && (
                            <div className={cn(
                                "mt-3 rounded-lg border p-3 text-xs",
                                importResult.success
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400"
                                    : "border-red-200 bg-red-50 text-red-600 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-400"
                            )}>
                                {importResult.success ? (
                                    <div>
                                        {t('importModal.imported')}: {importResult.imported ?? 0} |
                                        {' '}{t('importModal.skipped')}: {importResult.skipped ?? 0} |
                                        {' '}{t('importModal.errors')}: {importResult.errors ?? 0}
                                    </div>
                                ) : (
                                    <div>{importResult.error || tc("errorSaving")}</div>
                                )}
                            </div>
                        )}

                        <Button
                            onClick={handleImport}
                            disabled={importing || !csvContent.trim()}
                            className="mt-4 w-full rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                        >
                            {importing ? t('importModal.importing') : t('importModal.import')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
