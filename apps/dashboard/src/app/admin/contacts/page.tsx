"use client";

import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import { useVerticalTerms } from "@/hooks/useVerticalTerms";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { UpgradeBanner } from "@/components/ui/upgrade-banner";
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
    Instagram,
    Send as SendIcon,
    SlidersHorizontal,
    FileSpreadsheet,
    UploadCloud,
} from "lucide-react";
import * as XLSX from "xlsx";

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
    const tEmpty = useTranslations("verticalEmptyStates");
    const tHelp = useTranslations("help");
    const vt = useVerticalTerms();
    const { canCreate, getLimit } = usePlanLimits();
    const { activeTenantId } = useTenant();
    const router = useRouter();
    const [contacts, setContacts] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeSegment, setActiveSegment] = useState<string>("all");
    const [isLive, setIsLive] = useState(false);
    const [loading, setLoading] = useState(true);
    const [showImportModal, setShowImportModal] = useState(false);
    const [showFormatGuide, setShowFormatGuide] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [csvContent, setCsvContent] = useState("");
    const [importResult, setImportResult] = useState<any>(null);
    const [importing, setImporting] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createForm, setCreateForm] = useState({ first_name: "", last_name: "", phone: "", email: "", stage: "nuevo" });
    const [creating, setCreating] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

    // Bulk selection
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkAction, setBulkAction] = useState("");
    const [bulkPayload, setBulkPayload] = useState("");
    const [bulking, setBulking] = useState(false);

    // Advanced filters
    const [showFilterDrawer, setShowFilterDrawer] = useState(false);
    const [filterScoreMin, setFilterScoreMin] = useState("");
    const [filterScoreMax, setFilterScoreMax] = useState("");
    const [filterDateFrom, setFilterDateFrom] = useState("");
    const [filterDateTo, setFilterDateTo] = useState("");
    const [filterTags, setFilterTags] = useState("");
    // Applied filters (only set when user clicks Apply)
    const [appliedFilters, setAppliedFilters] = useState<{
        scoreMin?: string; scoreMax?: string; dateFrom?: string; dateTo?: string; tags?: string;
    }>({});

    // Build query string from applied filters
    const buildFilterQuery = useCallback(() => {
        const params = new URLSearchParams();
        if (appliedFilters.scoreMin) params.set("scoreMin", appliedFilters.scoreMin);
        if (appliedFilters.scoreMax) params.set("scoreMax", appliedFilters.scoreMax);
        if (appliedFilters.dateFrom) params.set("dateFrom", appliedFilters.dateFrom);
        if (appliedFilters.dateTo) params.set("dateTo", appliedFilters.dateTo);
        if (appliedFilters.tags) {
            appliedFilters.tags.split(",").map(t => t.trim()).filter(Boolean).forEach(tag => params.append("tags[]", tag));
        }
        const qs = params.toString();
        return qs ? `?${qs}` : "";
    }, [appliedFilters]);

    const activeFilterCount = [
        appliedFilters.scoreMin || appliedFilters.scoreMax,
        appliedFilters.dateFrom || appliedFilters.dateTo,
        appliedFilters.tags,
    ].filter(Boolean).length;

    // Load contacts from API
    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            setLoading(true);
            try {
                // Fetch leads matching the API model
                const qs = buildFilterQuery();
                const data = await api.fetch(`/crm/leads/${activeTenantId}${qs}`);

                if (data.success && Array.isArray(data.data)) {
                    // Map Real Lead data to UI variables we use
                    const mappedLeads = data.data.map((l: any) => {
                       let segmentType = "new";
                       if (["calificado", "tibio", "caliente", "listo_cierre"].includes(l.stage)) segmentType = "qualified";
                       if (["ganado"].includes(l.stage)) segmentType = "customer";
                       if (["perdido", "no_interesado"].includes(l.stage)) segmentType = "churned";
                       if (["contactado", "respondio"].includes(l.stage)) segmentType = "lead";

                       // channels: array of channel types from all linked contacts, or single channel
                       const channelList: string[] = l.channels && Array.isArray(l.channels) && l.channels.length > 0
                           ? l.channels
                           : [l.contact_channel || 'whatsapp'];

                       return {
                           id: l.id,
                           name: `${l.first_name || ''} ${l.last_name || ''}`.trim() || t('unknown'),
                           phone: l.phone || '',
                           email: l.email || '',
                           tags: l.tags?.map((tg:any) => tg.name) || [],
                           segment: segmentType,
                           channels: channelList,
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
    }, [activeTenantId, buildFilterQuery]);

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
    const totalCount = contacts.length;

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

    const handleExcelUpload = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e: any) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: "array" });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                // Convert the sheet to CSV string
                const csv = XLSX.utils.sheet_to_csv(worksheet);
                setCsvContent(csv);
                showToast("Archivo cargado con éxito");
            } catch (err) {
                console.error("Failed to parse Excel file:", err);
                showToast("Error al procesar el archivo Excel");
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const handleExport = async () => {
        if (!activeTenantId) return;
        setExporting(true);
        try {
            const csvData = await api.fetch(`/crm/export/${activeTenantId}`);
            if (typeof csvData !== "string") throw new Error("Invalid data returned");

            // Parse CSV text to SheetJS workbook
            const workbook = XLSX.read(csvData, { type: "string", raw: true });
            
            // Format sheet styles or rename sheet to 'Contactos'
            const originalSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[originalSheetName];
            
            // If the worksheet exists, set title beautifully
            if (worksheet) {
                workbook.SheetNames[0] = "Contactos";
                workbook.Sheets["Contactos"] = worksheet;
                delete workbook.Sheets[originalSheetName];
            }

            // Generate clean .xlsx binary buffer
            const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `contactos_${new Date().toISOString().slice(0, 10)}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            showToast("Exportado correctamente en Excel");
        } catch (err) {
            console.error("Export failed:", err);
            showToast(tc("errorSaving"));
        } finally {
            setExporting(false);
        }
    };

    const handleDownloadTemplate = async () => {
        try {
            const templateCsv = await api.fetch("/crm/import-template");
            if (typeof templateCsv !== "string") throw new Error("Invalid template data");

            // Parse and convert template CSV to SheetJS workbook
            const workbook = XLSX.read(templateCsv, { type: "string" });
            
            // Rename sheet to 'Plantilla de Importación'
            const originalSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[originalSheetName];
            if (worksheet) {
                workbook.SheetNames[0] = "Plantilla CRM";
                workbook.Sheets["Plantilla CRM"] = worksheet;
                delete workbook.Sheets[originalSheetName];
            }

            const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "plantilla_contactos.xlsx";
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Template download failed:", err);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title={vt.customerNounPlural.charAt(0).toUpperCase() + vt.customerNounPlural.slice(1)}
                subtitle={`${contacts.length} ${vt.customerNounPlural} · $${totalValue.toLocaleString()}`}
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
                            onClick={() => {
                                if (!canCreate("maxContacts", totalCount)) return;
                                setShowCreateModal(true);
                            }}
                            disabled={!canCreate("maxContacts", totalCount)}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <UserPlus size={16} /> {tc("create")}
                        </button>
                    </div>
                }
            />

            <HelpPanel
                title={tHelp("contacts.title")}
                description={tHelp("contacts.description")}
                tips={tHelp.raw("contacts.tips") as string[]}
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

            {/* Search + Filter Button */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <Input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder={t('search')}
                        className="h-10 rounded-lg border-neutral-200 bg-white pl-10 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                    />
                </div>
                <button
                    onClick={() => setShowFilterDrawer(true)}
                    className={cn(
                        "relative flex items-center gap-2 h-10 px-4 rounded-lg border text-sm font-medium cursor-pointer transition-colors",
                        activeFilterCount > 0
                            ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300"
                            : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800/50"
                    )}
                >
                    <SlidersHorizontal size={16} />
                    {t('advancedFilters')}
                    {activeFilterCount > 0 && (
                        <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[11px] font-semibold">
                            {activeFilterCount}
                        </span>
                    )}
                </button>
            </div>

            {/* Active Filter Chips */}
            {activeFilterCount > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        {activeFilterCount} {t('activeFilters')}:
                    </span>
                    {(appliedFilters.scoreMin || appliedFilters.scoreMax) && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-xs border border-indigo-500/20">
                            Score: {appliedFilters.scoreMin || '1'}-{appliedFilters.scoreMax || '10'}
                            <button onClick={() => {
                                setAppliedFilters(f => ({ ...f, scoreMin: undefined, scoreMax: undefined }));
                                setFilterScoreMin(""); setFilterScoreMax("");
                            }} className="bg-transparent border-none cursor-pointer p-0 text-indigo-400 hover:text-indigo-300">
                                <X size={12} />
                            </button>
                        </span>
                    )}
                    {(appliedFilters.dateFrom || appliedFilters.dateTo) && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-xs border border-indigo-500/20">
                            {appliedFilters.dateFrom && `${t('dateFrom')}: ${appliedFilters.dateFrom}`}
                            {appliedFilters.dateFrom && appliedFilters.dateTo && ' — '}
                            {appliedFilters.dateTo && `${t('dateTo')}: ${appliedFilters.dateTo}`}
                            <button onClick={() => {
                                setAppliedFilters(f => ({ ...f, dateFrom: undefined, dateTo: undefined }));
                                setFilterDateFrom(""); setFilterDateTo("");
                            }} className="bg-transparent border-none cursor-pointer p-0 text-indigo-400 hover:text-indigo-300">
                                <X size={12} />
                            </button>
                        </span>
                    )}
                    {appliedFilters.tags && appliedFilters.tags.split(",").map(t2 => t2.trim()).filter(Boolean).map(tag => (
                        <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-xs border border-indigo-500/20">
                            Tag: {tag}
                            <button onClick={() => {
                                const remaining = appliedFilters.tags!.split(",").map(t3 => t3.trim()).filter(t3 => t3 !== tag).join(", ");
                                setAppliedFilters(f => ({ ...f, tags: remaining || undefined }));
                                setFilterTags(remaining);
                            }} className="bg-transparent border-none cursor-pointer p-0 text-indigo-400 hover:text-indigo-300">
                                <X size={12} />
                            </button>
                        </span>
                    ))}
                    <button
                        onClick={() => {
                            setAppliedFilters({});
                            setFilterScoreMin(""); setFilterScoreMax("");
                            setFilterDateFrom(""); setFilterDateTo("");
                            setFilterTags("");
                        }}
                        className="bg-transparent border-none cursor-pointer p-0 text-xs text-neutral-500 underline hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                    >
                        {t('clearFilters')}
                    </button>
                </div>
            )}

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
                                {["nuevo","contactado","respondio","calificado","tibio","caliente","listo_cierre","ganado","perdido","no_interesado"].map(s => (
                                    <option key={s} value={s}>{tc(`stages.${s}`)}</option>
                                ))}
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
                                    showToast(tc("saved"));
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

            <UpgradeBanner
                current={totalCount}
                limit={getLimit("maxContacts")}
                resourceLabel="contactos"
            />

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
                                        <div className="flex items-center gap-1.5">
                                            <Badge variant="secondary" className={cn("rounded-md text-xs font-semibold", segClass)}>
                                                {t(`segments.${contact.segment}`)}
                                            </Badge>
                                            <div className="flex items-center gap-0.5">
                                                {contact.channels?.includes('whatsapp') && (
                                                    <div className="w-5 h-5 rounded-full bg-[#25D366]/15 flex items-center justify-center" title="WhatsApp">
                                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="#25D366"><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/></svg>
                                                    </div>
                                                )}
                                                {contact.channels?.includes('instagram') && (
                                                    <div className="w-5 h-5 rounded-full bg-pink-500/15 flex items-center justify-center" title="Instagram">
                                                        <Instagram size={11} className="text-pink-500" />
                                                    </div>
                                                )}
                                                {contact.channels?.includes('messenger') && (
                                                    <div className="w-5 h-5 rounded-full bg-blue-500/15 flex items-center justify-center" title="Messenger">
                                                        <MessageSquare size={11} className="text-blue-500" />
                                                    </div>
                                                )}
                                                {contact.channels?.includes('telegram') && (
                                                    <div className="w-5 h-5 rounded-full bg-sky-500/15 flex items-center justify-center" title="Telegram">
                                                        <SendIcon size={11} className="text-sky-500" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
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
                {filtered.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Users size={48} className="text-[var(--text-secondary)] opacity-20 mb-4" />
                        <p className="text-sm text-[var(--text-secondary)]">
                            {tEmpty(vt.industry !== 'otro' ? `${vt.industry}.contacts` : 'default.contacts')}
                        </p>
                    </div>
                )}
            </div>

            {/* Advanced Filter Drawer */}
            {showFilterDrawer && <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowFilterDrawer(false)} />}
            <div className={cn(
                "fixed inset-y-0 right-0 z-50 w-80 bg-white dark:bg-[var(--bg-secondary)] border-l border-neutral-200 dark:border-neutral-800 shadow-xl transform transition-transform duration-300",
                showFilterDrawer ? "translate-x-0" : "translate-x-full"
            )}>
                <div className="p-6 h-full flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('advancedFilters')}</h3>
                        <button onClick={() => setShowFilterDrawer(false)} className="bg-transparent border-none cursor-pointer p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="flex-1 space-y-5 overflow-y-auto">
                        {/* Score Range */}
                        <div>
                            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2 block">{t('scoreRange')}</label>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1 block">{t('scoreMin')}</label>
                                    <input
                                        type="number" min="1" max="10" value={filterScoreMin}
                                        onChange={e => setFilterScoreMin(e.target.value)}
                                        placeholder="1"
                                        className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1 block">{t('scoreMax')}</label>
                                    <input
                                        type="number" min="1" max="10" value={filterScoreMax}
                                        onChange={e => setFilterScoreMax(e.target.value)}
                                        placeholder="10"
                                        className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Date Range */}
                        <div>
                            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2 block">{t('dateRange')}</label>
                            <div className="space-y-2">
                                <div>
                                    <label className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1 block">{t('dateFrom')}</label>
                                    <input
                                        type="date" value={filterDateFrom}
                                        onChange={e => setFilterDateFrom(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1 block">{t('dateTo')}</label>
                                    <input
                                        type="date" value={filterDateTo}
                                        onChange={e => setFilterDateTo(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Tags */}
                        <div>
                            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2 block">{t('filterByTags')}</label>
                            <input
                                type="text" value={filterTags}
                                onChange={e => setFilterTags(e.target.value)}
                                placeholder="VIP, premium, nuevo"
                                className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                            />
                            <p className="text-[10px] text-neutral-400 mt-1">{t('bulkActions.tagName')}: tag1, tag2, tag3</p>
                        </div>
                    </div>

                    {/* Drawer Actions */}
                    <div className="pt-4 mt-auto border-t border-neutral-200 dark:border-neutral-800 space-y-2">
                        <button
                            onClick={() => {
                                setAppliedFilters({
                                    scoreMin: filterScoreMin || undefined,
                                    scoreMax: filterScoreMax || undefined,
                                    dateFrom: filterDateFrom || undefined,
                                    dateTo: filterDateTo || undefined,
                                    tags: filterTags.trim() || undefined,
                                });
                                setShowFilterDrawer(false);
                            }}
                            className="w-full px-4 py-2.5 rounded-lg border-none bg-indigo-600 text-white text-sm font-semibold cursor-pointer hover:bg-indigo-700"
                        >
                            {t('applyFilters')}
                        </button>
                        <button
                            onClick={() => {
                                setFilterScoreMin(""); setFilterScoreMax("");
                                setFilterDateFrom(""); setFilterDateTo("");
                                setFilterTags("");
                                setAppliedFilters({});
                                setShowFilterDrawer(false);
                            }}
                            className="w-full px-4 py-2 rounded-lg border border-neutral-200 bg-transparent text-sm text-neutral-600 cursor-pointer hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                        >
                            {t('clearFilters')}
                        </button>
                    </div>
                </div>
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
                                    {["nuevo","contactado","respondio","calificado"].map(s => (
                                        <option key={s} value={s}>{tc(`stages.${s}`)}</option>
                                    ))}
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
                                        showToast(tc("saved"));
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

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold bg-emerald-500 text-white shadow-lg animate-in">
                    {toast}
                </div>
            )}

            {/* Import CSV Modal */}
            {showImportModal && (
                <div
                    onClick={() => {
                        setShowImportModal(false);
                        setShowFormatGuide(false);
                    }}
                    className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        className="max-h-[90vh] w-[550px] overflow-auto rounded-2xl border border-neutral-200 bg-white p-8 dark:border-neutral-800 dark:bg-neutral-900 shadow-2xl transition-all duration-300"
                    >
                        <div className="mb-5 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                                <FileSpreadsheet className="text-indigo-600 dark:text-indigo-400" size={20} />
                                {t('importModal.title')}
                            </h2>
                            <button
                                onClick={() => {
                                    setShowImportModal(false);
                                    setShowFormatGuide(false);
                                }}
                                className="rounded-md border-none bg-transparent p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* File Dropzone */}
                        <div
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setIsDragging(false);
                                const file = e.dataTransfer.files?.[0];
                                if (file) handleExcelUpload(file);
                            }}
                            className={cn(
                                "flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-7 text-center cursor-pointer transition-all duration-200 select-none",
                                isDragging
                                    ? "border-indigo-500 bg-indigo-50/40 dark:border-indigo-400 dark:bg-indigo-950/10 shadow-inner"
                                    : "border-neutral-200 bg-neutral-50/30 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/30"
                            )}
                            onClick={() => {
                                const input = document.createElement("input");
                                input.type = "file";
                                input.accept = ".xlsx,.xls,.csv";
                                input.onchange = (e: any) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleExcelUpload(file);
                                };
                                input.click();
                            }}
                        >
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 mb-3 shadow-sm">
                                <UploadCloud size={22} />
                            </div>
                            <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
                                Arrastra tu archivo de Excel (.xlsx, .xls) o CSV aquí
                            </span>
                            <span className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-2 font-normal">
                                O haz clic para buscar en tus archivos
                            </span>
                        </div>

                        <div className="mt-3.5 mb-4 flex items-center justify-between">
                            <button
                                onClick={handleDownloadTemplate}
                                className="border-none bg-transparent p-0 text-xs font-semibold text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400"
                            >
                                {t('importModal.downloadTemplate')}
                            </button>
                        </div>

                        {/* Visual Help Legend / Formatting Guide */}
                        <div className="mb-5 rounded-xl border border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/10">
                            <button
                                onClick={() => setShowFormatGuide(!showFormatGuide)}
                                className="flex w-full items-center justify-between px-4 py-3 text-xs font-bold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/40 rounded-xl transition-colors outline-none"
                            >
                                <span className="flex items-center gap-1.5">
                                    💡 {t('importModal.formatGuideTitle')}
                                </span>
                                <ChevronDown size={14} className={cn("text-neutral-400 transition-transform duration-200", showFormatGuide && "rotate-180")} />
                            </button>

                            {showFormatGuide && (
                                <div className="px-4 pb-4 pt-1 text-[11px] space-y-3 border-t border-neutral-100/70 dark:border-neutral-800/60 animate-in fade-in slide-in-from-top-1 duration-150">
                                    <p className="text-neutral-500 dark:text-neutral-400 leading-relaxed font-normal">
                                        {t('importModal.formatGuideDesc')}
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
                                        <div className="space-y-1">
                                            <span className="font-semibold text-neutral-800 dark:text-neutral-200 block">
                                                📞 {t('importModal.phoneCol')}
                                            </span>
                                            <span className="text-neutral-500 dark:text-neutral-400 block leading-relaxed font-normal">
                                                {t('importModal.phoneColDesc')}
                                            </span>
                                        </div>
                                        <div className="space-y-1">
                                            <span className="font-semibold text-neutral-800 dark:text-neutral-200 block">
                                                ⚡ {t('importModal.stageCol')}
                                            </span>
                                            <span className="text-neutral-500 dark:text-neutral-400 block leading-relaxed font-normal">
                                                {t('importModal.stageColDesc')}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="border-t border-neutral-100 dark:border-neutral-800/80 pt-3">
                                        <span className="font-semibold text-neutral-800 dark:text-neutral-200 block mb-1.5">
                                            📋 {t('importModal.exampleHeader')}
                                        </span>
                                        <pre className="rounded bg-neutral-100 dark:bg-neutral-900 p-2.5 font-mono text-[10px] text-neutral-700 dark:text-neutral-300 overflow-x-auto leading-relaxed border border-neutral-200/40 dark:border-neutral-800/40 select-all">
                                            {t('importModal.exampleBody')}
                                        </pre>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Divider */}
                        <div className="flex items-center my-4">
                            <div className="flex-grow border-t border-neutral-100 dark:border-neutral-800" />
                            <span className="flex-shrink mx-3.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider select-none">
                                O copia y pega tus celdas directamente
                            </span>
                            <div className="flex-grow border-t border-neutral-100 dark:border-neutral-800" />
                        </div>

                        <textarea
                            value={csvContent}
                            onChange={e => setCsvContent(e.target.value)}
                            placeholder={t('importModal.placeholder')}
                            rows={5}
                            className="w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 font-mono text-xs text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                        />

                        {importResult && (
                            <div className={cn(
                                "mt-3.5 rounded-xl border p-3.5 text-xs",
                                importResult.success
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400"
                                    : "border-red-200 bg-red-50 text-red-600 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-400"
                            )}>
                                {importResult.success ? (
                                    <div>
                                        <strong>¡Importación completada con éxito!</strong>
                                        <div className="mt-1.5 text-neutral-600 dark:text-neutral-300 space-y-0.5">
                                            <div>✅ {t('importModal.imported')}: {importResult.imported ?? 0}</div>
                                            <div>⏭️ {t('importModal.skipped')}: {importResult.skipped ?? 0}</div>
                                            <div>⚠️ {t('importResult.errors.length') || (importResult.errors && importResult.errors.length) || 0} errores encontrados.</div>
                                        </div>
                                        {importResult.errors && importResult.errors.length > 0 && (
                                            <ul className="mt-2.5 list-disc pl-4 text-[10px] text-red-500 space-y-1">
                                                {importResult.errors.slice(0, 5).map((err: string, idx: number) => (
                                                    <li key={idx}>{err}</li>
                                                ))}
                                                {importResult.errors.length > 5 && (
                                                    <li className="list-none font-semibold text-neutral-400 mt-1">... y {importResult.errors.length - 5} errores más.</li>
                                                )}
                                            </ul>
                                        )}
                                    </div>
                                ) : (
                                    <div>{importResult.error || tc("errorSaving")}</div>
                                )}
                            </div>
                        )}

                        <Button
                            onClick={handleImport}
                            disabled={importing || !csvContent.trim()}
                            className="mt-5 w-full rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 press-effect h-10 border-none"
                        >
                            {importing ? t('importModal.importing') : t('importModal.import')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
