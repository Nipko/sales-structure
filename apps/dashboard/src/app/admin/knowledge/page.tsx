"use client";

import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { UpgradeBanner, UpgradeModal } from "@/components/ui/upgrade-banner";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
    BookOpen, Search, Plus, X, FileText, Globe, HelpCircle,
    RefreshCw, Edit3, Trash2, BarChart3, ExternalLink, CheckCircle2,
    AlertCircle, TrendingUp, Target, Zap, Eye, Tag, GlobeLock, PlusCircle,
    Upload, Sparkles, Award, Loader2, History, Filter, Languages, RotateCcw,
    Calendar, ChevronDown,
} from "lucide-react";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

type Tab = "library" | "search" | "analytics" | "quality";

interface KBDocument {
    id: string;
    name: string;
    title?: string;
    content_text?: string;
    source_type?: string;
    source_url?: string;
    chunk_count?: number;
    last_crawled_at?: string;
    category?: string;
    is_public?: boolean;
    auto_recrawl?: boolean;
    language?: string;
    version?: number;
    created_at: string;
    updated_at?: string;
}

interface KBAnalytics {
    overview: {
        uniqueQueries: number;
        totalRetrievals: number;
        hitRate: number;
        avgScore: number;
        medianScore: number;
    };
    topDocuments: Array<{ document_id: string; document_name: string; retrieval_count: number; used_count: number }>;
    unansweredQueries: Array<{ id: string; query: string; occurrences: number; last_seen_at: string; resolved: boolean }>;
    dailyVolume: Array<{ date: string; queries: number; hits: number }>;
}

const statusColors: Record<string, string> = { draft: "#f39c12", approved: "#2ecc71", archived: "#95a5a6", ready: "#2ecc71", processing: "#f39c12", error: "#ff4757" };

export default function KnowledgePage() {
    const t = useTranslations("knowledge");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const { canCreate, getLimit } = usePlanLimits();

    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [tab, setTab] = useState<Tab>("library");

    // Documents
    const [documents, setDocuments] = useState<KBDocument[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(true);

    // Search
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);

    // Legacy resources (for plan limit counting)
    const [resources, setResources] = useState<any[]>([]);

    // Crawl modal
    const [showCrawlModal, setShowCrawlModal] = useState(false);
    const [crawlForm, setCrawlForm] = useState({ url: "", title: "", category: "" });
    const [crawling, setCrawling] = useState(false);

    // Edit modal
    const [editDoc, setEditDoc] = useState<KBDocument | null>(null);
    const [editForm, setEditForm] = useState({ name: "", content: "", category: "" });
    const [editSaving, setEditSaving] = useState(false);

    // Create modal (legacy)
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createForm, setCreateForm] = useState({ title: "", content: "", category: "" });
    const [createSaving, setCreateSaving] = useState(false);

    // Categories
    const [categories, setCategories] = useState<string[]>([]);
    const [activeCategory, setActiveCategory] = useState<string | null>(null);

    // Re-crawl state
    const [recrawlingId, setRecrawlingId] = useState<string | null>(null);

    // Analytics
    const [analytics, setAnalytics] = useState<KBAnalytics | null>(null);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);
    const [analyticsError, setAnalyticsError] = useState<string | null>(null);

    // Bulk upload
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkFiles, setBulkFiles] = useState<Array<{ name: string; content?: string; fileBase64?: string; mimeType?: string }>>([]);
    const [bulkUploading, setBulkUploading] = useState(false);
    const [bulkResults, setBulkResults] = useState<any>(null);
    const [bulkCategory, setBulkCategory] = useState("");

    // Quality scores
    const [qualityScores, setQualityScores] = useState<any[]>([]);
    const [qualityLoading, setQualityLoading] = useState(false);

    // AI Suggestions
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [suggestionsLoading, setSuggestionsLoading] = useState(false);

    // Language filter
    const [activeLanguage, setActiveLanguage] = useState<string | null>(null);

    // Version history
    const [versionDoc, setVersionDoc] = useState<KBDocument | null>(null);
    const [versions, setVersions] = useState<any[]>([]);
    const [versionsLoading, setVersionsLoading] = useState(false);

    // Advanced search
    const [showAdvFilters, setShowAdvFilters] = useState(false);
    const [advFilters, setAdvFilters] = useState({ category: "", sourceType: "", language: "", dateFrom: "", dateTo: "" });
    const [advResults, setAdvResults] = useState<any[]>([]);

    // Toast
    const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
    const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    // Load documents
    useEffect(() => {
        if (!activeTenantId) return;
        setLoadingDocs(true);

        Promise.all([
            api.fetch("/knowledge/documents").catch(() => []),
            api.fetch(`/knowledge/resources/${activeTenantId}`).catch(() => []),
            api.fetch("/knowledge/documents/categories").catch(() => []),
        ]).then(([docs, res, cats]) => {
            if (Array.isArray(docs)) setDocuments(docs);
            if (Array.isArray(res)) setResources(res);
            if (Array.isArray(cats)) setCategories(cats);
        }).finally(() => setLoadingDocs(false));
    }, [activeTenantId]);

    // Load analytics when tab changes
    useEffect(() => {
        if (tab !== "analytics" || !activeTenantId) return;
        setAnalyticsLoading(true);
        setAnalyticsError(null);
        api.fetch(`/knowledge/analytics/${activeTenantId}`)
            .then(result => {
                if (result?.success === false) {
                    setAnalyticsError(result.error === "plan_upgrade_required" ? t("analytics.planRequired") : (result.message || result.error));
                } else if (result?.success && result.data) {
                    setAnalytics(result.data);
                } else {
                    setAnalytics(result);
                }
            })
            .catch(() => setAnalyticsError("Error loading analytics"))
            .finally(() => setAnalyticsLoading(false));
    }, [tab, activeTenantId, t]);

    // Crawl URL
    const handleCrawl = async () => {
        if (!crawlForm.url) return;
        setCrawling(true);
        try {
            const result = await api.fetch("/knowledge/documents/crawl", {
                method: "POST",
                body: JSON.stringify({ url: crawlForm.url, title: crawlForm.title || undefined, category: crawlForm.category || undefined }),
            });
            if (result?.success && result.data) {
                setDocuments(prev => [result.data, ...prev]);
                setShowCrawlModal(false);
                setCrawlForm({ url: "", title: "", category: "" });
                showToast(t("crawl.success"));
            } else {
                showToast(result?.message || result?.error || "Error", "error");
            }
        } catch (e: any) {
            showToast(e.message || "Error", "error");
        } finally {
            setCrawling(false);
        }
    };

    // Re-crawl
    const handleRecrawl = async (docId: string) => {
        setRecrawlingId(docId);
        try {
            const result = await api.fetch(`/knowledge/documents/${docId}/recrawl`, { method: "POST" });
            if (result?.success) {
                if (result.data?.changed === false) {
                    showToast(t("crawl.noChanges"));
                } else {
                    setDocuments(prev => prev.map(d => d.id === docId ? { ...d, ...result.data } : d));
                    showToast(t("crawl.updated"));
                }
            } else {
                showToast(result?.message || "Error", "error");
            }
        } catch (e: any) {
            showToast(e.message || "Error", "error");
        } finally {
            setRecrawlingId(null);
        }
    };

    // Edit document
    const handleEdit = (doc: KBDocument) => {
        setEditDoc(doc);
        setEditForm({ name: doc.name || doc.title || "", content: doc.content_text || "", category: doc.category || "" });
    };

    const handleEditSave = async () => {
        if (!editDoc) return;
        setEditSaving(true);
        try {
            const result = await api.fetch(`/knowledge/documents/${editDoc.id}`, {
                method: "PUT",
                body: JSON.stringify({ name: editForm.name, content: editForm.content, category: editForm.category || undefined }),
            });
            if (result?.id) {
                setDocuments(prev => prev.map(d => d.id === editDoc.id ? { ...d, name: editForm.name, content_text: editForm.content, ...result } : d));
                setEditDoc(null);
                showToast(t("edit.success"));
            }
        } catch (e: any) {
            showToast(e.message || "Error", "error");
        } finally {
            setEditSaving(false);
        }
    };

    // Create document (legacy)
    const handleCreate = async () => {
        if (!createForm.title || !createForm.content || !activeTenantId) return;
        setCreateSaving(true);
        try {
            const created = await api.fetch(`/knowledge/resources/${activeTenantId}`, {
                method: "POST",
                body: JSON.stringify({ title: createForm.title, content: createForm.content }),
            });
            if (created?.id) {
                setResources(prev => [created, ...prev]);
                setShowCreateModal(false);
                setCreateForm({ title: "", content: "", category: "" });
            }
        } catch (e) {
            console.error(e);
        } finally {
            setCreateSaving(false);
        }
    };

    // Delete document
    const handleDeleteDoc = async (docId: string) => {
        try {
            await api.fetch(`/knowledge/documents/${docId}`, { method: "DELETE" });
            setDocuments(prev => prev.filter(d => d.id !== docId));
        } catch (e: any) {
            showToast(e.message || "Error", "error");
        }
    };

    // Toggle public
    const handleTogglePublic = async (doc: KBDocument) => {
        try {
            await api.fetch(`/knowledge/documents/${doc.id}/meta`, {
                method: "PUT",
                body: JSON.stringify({ isPublic: !doc.is_public }),
            });
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, is_public: !doc.is_public } : d));
            showToast(doc.is_public ? tc("disabled") : tc("enabled"));
        } catch (e: any) {
            showToast(e.message || "Error", "error");
        }
    };

    // Set category on document
    const handleSetCategory = async (docId: string, category: string) => {
        try {
            await api.fetch(`/knowledge/documents/${docId}/meta`, {
                method: "PUT",
                body: JSON.stringify({ category: category || null }),
            });
            setDocuments(prev => prev.map(d => d.id === docId ? { ...d, category: category || undefined } : d));
            if (category && !categories.includes(category)) {
                setCategories(prev => [...prev, category].sort());
            }
        } catch (e: any) {
            showToast(e.message || "Error", "error");
        }
    };

    // Create article from unanswered query
    const handleCreateFromQuery = (query: string) => {
        setCreateForm({ title: query, content: "", category: "" });
        setShowCreateModal(true);
    };

    // Search
    const handleSearch = async () => {
        if (!searchQuery) return setSearchResults([]);
        try {
            const data = await api.fetch("/knowledge/search", {
                method: "POST",
                body: JSON.stringify({ query: searchQuery, topK: 10 }),
            });
            setSearchResults(Array.isArray(data) ? data : []);
        } catch {
            setSearchResults([]);
        }
    };

    // Resolve unanswered query
    const handleResolve = async (queryId: string) => {
        if (!activeTenantId) return;
        try {
            await api.fetch(`/knowledge/analytics/${activeTenantId}/resolve/${queryId}`, { method: "POST" });
            if (analytics) {
                setAnalytics({
                    ...analytics,
                    unansweredQueries: analytics.unansweredQueries.map(q =>
                        q.id === queryId ? { ...q, resolved: true } : q
                    ),
                });
            }
        } catch (e: any) {
            showToast(e.message || "Error", "error");
        }
    };

    // Bulk file selection
    const handleBulkFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        if (!fileList) return;
        const entries: typeof bulkFiles = [];
        Array.from(fileList).forEach(file => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = (reader.result as string).split(",")[1];
                entries.push({ name: file.name, fileBase64: base64, mimeType: file.type });
                if (entries.length === fileList.length) setBulkFiles(entries);
            };
            reader.readAsDataURL(file);
        });
    };

    const handleBulkUpload = async () => {
        if (!bulkFiles.length) return;
        setBulkUploading(true);
        setBulkResults(null);
        try {
            const payload = bulkFiles.map(f => ({ ...f, category: bulkCategory || undefined }));
            const res = await api.fetch("/knowledge/documents/bulk", {
                method: "POST",
                body: JSON.stringify({ files: payload }),
            });
            if (res?.success && res.data) {
                setBulkResults(res.data);
                showToast(t("bulk.successCount", { count: res.data.succeeded }));
                // Reload docs
                const docs = await api.fetch("/knowledge/documents").catch(() => []);
                if (Array.isArray(docs)) setDocuments(docs);
            } else {
                showToast(res?.error || "Error", "error");
            }
        } catch (e: any) {
            showToast(e.message || "Error", "error");
        } finally {
            setBulkUploading(false);
        }
    };

    // Load quality scores
    useEffect(() => {
        if (tab !== "quality") return;
        setQualityLoading(true);
        api.fetch("/knowledge/documents/quality")
            .then(res => {
                if (res?.success && res.data) setQualityScores(res.data);
            })
            .catch(() => {})
            .finally(() => setQualityLoading(false));
    }, [tab]);

    // AI suggestions
    const handleGenerateSuggestions = async () => {
        if (!activeTenantId) return;
        setSuggestionsLoading(true);
        try {
            const res = await api.fetch(`/knowledge/suggestions/${activeTenantId}`, { method: "POST", body: JSON.stringify({}) });
            if (res?.success && res.data?.suggestions) {
                setSuggestions(res.data.suggestions);
            } else if (res?.error === "plan_upgrade_required") {
                showToast(t("analytics.planRequired"), "error");
            }
        } catch (e: any) {
            showToast(e.message || "Error", "error");
        } finally {
            setSuggestionsLoading(false);
        }
    };

    // Load version history
    const handleViewVersions = async (doc: KBDocument) => {
        setVersionDoc(doc);
        setVersionsLoading(true);
        try {
            const res = await api.fetch(`/knowledge/documents/${doc.id}/versions`);
            if (res?.success && res.data) setVersions(res.data);
            else setVersions([]);
        } catch {
            setVersions([]);
        } finally {
            setVersionsLoading(false);
        }
    };

    // Restore version
    const handleRestoreVersion = async (versionId: string) => {
        if (!versionDoc) return;
        try {
            const res = await api.fetch(`/knowledge/documents/${versionDoc.id}/restore`, {
                method: "POST",
                body: JSON.stringify({ versionId }),
            });
            if (res?.success) {
                showToast(t("versions.restored"));
                setVersionDoc(null);
                const docs = await api.fetch("/knowledge/documents").catch(() => []);
                if (Array.isArray(docs)) setDocuments(docs);
            } else {
                showToast(res?.error || "Error", "error");
            }
        } catch (e: any) {
            showToast(e.message || "Error", "error");
        }
    };

    // Advanced search
    const handleAdvancedSearch = async () => {
        if (!searchQuery) return setAdvResults([]);
        try {
            const data = await api.fetch("/knowledge/search/advanced", {
                method: "POST",
                body: JSON.stringify({
                    query: searchQuery, topK: 15,
                    category: advFilters.category || undefined,
                    sourceType: advFilters.sourceType || undefined,
                    language: advFilters.language || undefined,
                    dateFrom: advFilters.dateFrom || undefined,
                    dateTo: advFilters.dateTo || undefined,
                }),
            });
            if (data?.success && data.data) setAdvResults(data.data);
            else setAdvResults([]);
        } catch {
            setAdvResults([]);
        }
    };

    const langLabels: Record<string, string> = { es: "Español", en: "English", pt: "Português", fr: "Français", auto: t("language.auto") };

    const totalDocs = documents.length + resources.length;

    return (
        <div>
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={BookOpen}
                action={tab === "library" ? (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowBulkModal(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-foreground font-medium text-sm cursor-pointer hover:bg-muted press-effect"
                        >
                            <Upload size={16} /> {t("bulk.button")}
                        </button>
                        <button
                            onClick={() => setShowCrawlModal(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-foreground font-medium text-sm cursor-pointer hover:bg-muted press-effect"
                        >
                            <Globe size={16} /> {t("crawl.button")}
                        </button>
                        <button
                            onClick={() => canCreate("knowledgeArticles", totalDocs) ? setShowCreateModal(true) : setShowUpgradeModal(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect"
                        >
                            <Plus size={16} /> {tc("create")}
                        </button>
                    </div>
                ) : undefined}
            />

            <HelpPanel
                title={tHelp("knowledge.title")}
                description={tHelp("knowledge.description")}
                tips={tHelp.raw("knowledge.tips") as string[]}
            />

            {/* Tabs */}
            <div className="flex gap-1 mb-5 bg-card rounded-xl p-1 border border-border w-fit">
                <button onClick={() => setTab("library")} className={cn("px-4 py-2 rounded-lg border-none font-semibold text-[13px] cursor-pointer flex items-center gap-1.5 transition-all duration-200", tab === "library" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground")}>
                    <BookOpen size={16} /> {t("tabs.library")}
                </button>
                <Link href="/admin/knowledge/faqs" className="px-4 py-2 rounded-lg border-none font-semibold text-[13px] cursor-pointer flex items-center gap-1.5 transition-all duration-200 bg-transparent text-muted-foreground hover:text-foreground no-underline">
                    <HelpCircle size={16} /> {t("tabs.faqs")}
                </Link>
                <button onClick={() => setTab("search")} className={cn("px-4 py-2 rounded-lg border-none font-semibold text-[13px] cursor-pointer flex items-center gap-1.5 transition-all duration-200", tab === "search" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground")}>
                    <Search size={16} /> {t("tabs.search")}
                </button>
                <button onClick={() => setTab("quality")} className={cn("px-4 py-2 rounded-lg border-none font-semibold text-[13px] cursor-pointer flex items-center gap-1.5 transition-all duration-200", tab === "quality" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground")}>
                    <Award size={16} /> {t("quality.tab")}
                </button>
                <button onClick={() => setTab("analytics")} className={cn("px-4 py-2 rounded-lg border-none font-semibold text-[13px] cursor-pointer flex items-center gap-1.5 transition-all duration-200", tab === "analytics" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground")}>
                    <BarChart3 size={16} /> {t("analytics.tab")}
                </button>
            </div>

            {/* Library Tab */}
            {tab === "library" && (
                <div className="flex flex-col gap-3">
                    <UpgradeBanner
                        current={totalDocs}
                        limit={getLimit("knowledgeArticles")}
                        resourceLabel="documentos de conocimiento"
                    />

                    {/* Category filter */}
                    {categories.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap mb-1">
                            <button
                                onClick={() => setActiveCategory(null)}
                                className={cn("px-3 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all",
                                    !activeCategory ? "bg-primary text-primary-foreground border-primary" : "bg-transparent text-muted-foreground border-border hover:text-foreground")}
                            >
                                {tc("all")}
                            </button>
                            {categories.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                                    className={cn("px-3 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all",
                                        activeCategory === cat ? "bg-primary text-primary-foreground border-primary" : "bg-transparent text-muted-foreground border-border hover:text-foreground")}
                                >
                                    <Tag size={11} className="inline mr-1" />{cat}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Language filter */}
                    {(() => {
                        const docLangs = [...new Set(documents.map(d => d.language).filter(Boolean))] as string[];
                        return docLangs.length > 1 ? (
                            <div className="flex gap-1.5 flex-wrap mb-1">
                                <button
                                    onClick={() => setActiveLanguage(null)}
                                    className={cn("px-3 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all",
                                        !activeLanguage ? "bg-primary text-primary-foreground border-primary" : "bg-transparent text-muted-foreground border-border hover:text-foreground")}
                                >
                                    <Languages size={11} className="inline mr-1" />{tc("all")}
                                </button>
                                {docLangs.map(lang => (
                                    <button
                                        key={lang}
                                        onClick={() => setActiveLanguage(activeLanguage === lang ? null : lang)}
                                        className={cn("px-3 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all",
                                            activeLanguage === lang ? "bg-primary text-primary-foreground border-primary" : "bg-transparent text-muted-foreground border-border hover:text-foreground")}
                                    >
                                        {langLabels[lang] || lang}
                                    </button>
                                ))}
                            </div>
                        ) : null;
                    })()}

                    {/* RAG Documents (new system) */}
                    {documents.filter(d => (!activeCategory || d.category === activeCategory) && (!activeLanguage || d.language === activeLanguage)).map(doc => (
                        <div key={doc.id} className="flex items-center justify-between px-5 py-4 rounded-[14px] border border-border bg-card">
                            <div className="flex items-center gap-3.5">
                                <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-background">
                                    {doc.source_type === "url" ? <Globe size={20} className="text-blue-400" /> : <FileText size={20} className="text-primary" />}
                                </div>
                                <div>
                                    <div className="font-semibold text-[15px] flex items-center gap-2 flex-wrap">
                                        {doc.name || doc.title}
                                        <span className={cn("text-[10px] px-2 py-0.5 rounded-md font-semibold", doc.source_type === "url" ? "bg-blue-500/10 text-blue-400" : "bg-primary/10 text-primary")}>
                                            {t(`sourceType.${doc.source_type || "upload"}`)}
                                        </span>
                                        {doc.category && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-500 font-semibold">
                                                {doc.category}
                                            </span>
                                        )}
                                        {doc.is_public && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 font-semibold">
                                                {tc("public")}
                                            </span>
                                        )}
                                        {doc.chunk_count != null && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-background text-muted-foreground font-semibold">
                                                {doc.chunk_count} chunks
                                            </span>
                                        )}
                                        {doc.language && doc.language !== "auto" && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-400 font-semibold uppercase">
                                                {doc.language}
                                            </span>
                                        )}
                                        {(doc.version ?? 1) > 1 && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-background text-muted-foreground font-semibold">
                                                v{doc.version}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                                        {new Date(doc.created_at).toLocaleDateString()}
                                        {doc.source_url && (
                                            <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline flex items-center gap-0.5 no-underline">
                                                <ExternalLink size={11} /> {new URL(doc.source_url).hostname}
                                            </a>
                                        )}
                                        {doc.last_crawled_at && <span>• {tc("lastUpdated")}: {new Date(doc.last_crawled_at).toLocaleDateString()}</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handleTogglePublic(doc)}
                                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-semibold text-xs cursor-pointer",
                                        doc.is_public ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "border-border bg-transparent text-muted-foreground")}
                                    title={doc.is_public ? "Public" : "Private"}
                                >
                                    <GlobeLock size={13} />
                                </button>
                                {doc.source_type === "url" && (
                                    <button
                                        onClick={() => handleRecrawl(doc.id)}
                                        disabled={recrawlingId === doc.id}
                                        className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-transparent text-foreground font-semibold text-xs cursor-pointer", recrawlingId === doc.id && "opacity-50 cursor-wait")}
                                    >
                                        <RefreshCw size={13} className={recrawlingId === doc.id ? "animate-spin" : ""} />
                                        {recrawlingId === doc.id ? t("crawl.recrawling") : t("crawl.recrawl")}
                                    </button>
                                )}
                                <button onClick={() => handleViewVersions(doc)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-transparent text-foreground font-semibold text-xs cursor-pointer" title={t("versions.title")}>
                                    <History size={13} />
                                </button>
                                <button onClick={() => handleEdit(doc)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-transparent text-foreground font-semibold text-xs cursor-pointer">
                                    <Edit3 size={13} />
                                </button>
                                <button onClick={() => handleDeleteDoc(doc.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-transparent text-danger font-semibold text-xs cursor-pointer hover:bg-danger/10">
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        </div>
                    ))}

                    {/* Legacy resources */}
                    {resources.map(r => (
                        <div key={r.id} className="flex items-center justify-between px-5 py-4 rounded-[14px] border border-border bg-card">
                            <div className="flex items-center gap-3.5">
                                <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-background">
                                    <FileText size={20} className="text-primary" />
                                </div>
                                <div>
                                    <div className="font-semibold text-[15px] flex items-center gap-2">
                                        {r.title}
                                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-background text-muted-foreground font-semibold">v{r.version}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                                        <span className="uppercase">{r.type}</span> • {new Date(r.created_at).toLocaleDateString()}
                                        {r.content_hash && <span>• {t("hash")}: {r.content_hash.substring(0, 8)}</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ color: statusColors[r.status] || undefined, background: `${statusColors[r.status] || "#95a5a6"}22` }}>
                                    {t(`status.${r.status}`)}
                                </span>
                            </div>
                        </div>
                    ))}

                    {totalDocs === 0 && !loadingDocs && (
                        <div className="text-center py-10 text-muted-foreground">{t("empty.library")}</div>
                    )}
                    {loadingDocs && totalDocs === 0 && (
                        <div className="text-center py-10 text-muted-foreground">{tc("loading")}</div>
                    )}
                </div>
            )}

            {/* Search Tab */}
            {tab === "search" && (
                <div>
                    <div className="flex gap-2.5 mb-3">
                        <div className="flex-1 relative">
                            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && (showAdvFilters ? handleAdvancedSearch() : handleSearch())}
                                placeholder={t("searchPlaceholder")}
                                className="w-full py-3.5 pl-11 pr-4 rounded-xl border border-border bg-card text-foreground text-[15px] outline-none box-border"
                            />
                        </div>
                        <button
                            onClick={() => setShowAdvFilters(!showAdvFilters)}
                            className={cn("px-4 rounded-xl border font-semibold text-sm cursor-pointer flex items-center gap-1.5",
                                showAdvFilters ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground")}
                        >
                            <Filter size={15} /> {t("advSearch.filters")}
                            <ChevronDown size={13} className={cn("transition-transform", showAdvFilters && "rotate-180")} />
                        </button>
                        <button onClick={showAdvFilters ? handleAdvancedSearch : handleSearch} className="px-6 rounded-xl border-none bg-primary text-white font-semibold text-sm cursor-pointer">{t("searchButton")}</button>
                    </div>

                    {/* Advanced Filters Panel */}
                    {showAdvFilters && (
                        <div className="mb-5 p-4 rounded-xl border border-border bg-card">
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                <div>
                                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{tc("category")}</label>
                                    <select
                                        value={advFilters.category}
                                        onChange={e => setAdvFilters({ ...advFilters, category: e.target.value })}
                                        className="w-full px-2.5 py-2 rounded-lg border border-border bg-background text-foreground text-xs outline-none"
                                    >
                                        <option value="">{tc("all")}</option>
                                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{t("advSearch.sourceType")}</label>
                                    <select
                                        value={advFilters.sourceType}
                                        onChange={e => setAdvFilters({ ...advFilters, sourceType: e.target.value })}
                                        className="w-full px-2.5 py-2 rounded-lg border border-border bg-background text-foreground text-xs outline-none"
                                    >
                                        <option value="">{tc("all")}</option>
                                        <option value="upload">{t("sourceType.upload")}</option>
                                        <option value="url">{t("sourceType.url")}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{t("advSearch.language")}</label>
                                    <select
                                        value={advFilters.language}
                                        onChange={e => setAdvFilters({ ...advFilters, language: e.target.value })}
                                        className="w-full px-2.5 py-2 rounded-lg border border-border bg-background text-foreground text-xs outline-none"
                                    >
                                        <option value="">{tc("all")}</option>
                                        <option value="es">Español</option>
                                        <option value="en">English</option>
                                        <option value="pt">Português</option>
                                        <option value="fr">Français</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{t("advSearch.dateFrom")}</label>
                                    <input
                                        type="date"
                                        value={advFilters.dateFrom}
                                        onChange={e => setAdvFilters({ ...advFilters, dateFrom: e.target.value })}
                                        className="w-full px-2.5 py-2 rounded-lg border border-border bg-background text-foreground text-xs outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{t("advSearch.dateTo")}</label>
                                    <input
                                        type="date"
                                        value={advFilters.dateTo}
                                        onChange={e => setAdvFilters({ ...advFilters, dateTo: e.target.value })}
                                        className="w-full px-2.5 py-2 rounded-lg border border-border bg-background text-foreground text-xs outline-none"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col gap-2.5">
                        {(showAdvFilters ? advResults : searchResults).map((s, i) => (
                            <div key={s.id || i} className="p-4 rounded-xl border border-border bg-card">
                                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary">{s.title || s.document_name || s.resource_title}</span>
                                    {s.score != null && <span className="text-[11px] text-muted-foreground">score: {(s.score * 100).toFixed(0)}%</span>}
                                    {s.category && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 font-semibold">{s.category}</span>}
                                    {s.language && s.language !== "auto" && <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 font-semibold uppercase">{s.language}</span>}
                                    {s.sourceType && <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-semibold">{s.sourceType}</span>}
                                </div>
                                <p className="text-sm text-foreground m-0 leading-relaxed">&ldquo;{s.chunk_text || s.content}&rdquo;</p>
                            </div>
                        ))}
                        {(showAdvFilters ? advResults : searchResults).length === 0 && searchQuery && (
                            <div className="text-center py-10 text-muted-foreground">{t("empty.search")}</div>
                        )}
                    </div>
                </div>
            )}

            {/* Analytics Tab */}
            {tab === "analytics" && (
                <div>
                    {analyticsLoading && <div className="text-center py-10 text-muted-foreground">{tc("loading")}</div>}

                    {analyticsError && (
                        <div className="text-center py-10">
                            <AlertCircle size={40} className="mx-auto mb-3 text-warning" />
                            <p className="text-muted-foreground">{analyticsError}</p>
                        </div>
                    )}

                    {!analyticsLoading && !analyticsError && !analytics && (
                        <div className="text-center py-10 text-muted-foreground">{t("analytics.noData")}</div>
                    )}

                    {analytics && (
                        <div className="flex flex-col gap-6">
                            {/* KPI Cards */}
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                <KPICard icon={Search} label={t("analytics.overview.uniqueQueries")} value={analytics.overview.uniqueQueries} />
                                <KPICard icon={Zap} label={t("analytics.overview.totalRetrievals")} value={analytics.overview.totalRetrievals} />
                                <KPICard icon={Target} label={t("analytics.overview.hitRate")} value={`${(analytics.overview.hitRate * 100).toFixed(1)}%`} />
                                <KPICard icon={TrendingUp} label={t("analytics.overview.avgScore")} value={`${(analytics.overview.avgScore * 100).toFixed(0)}%`} />
                                <KPICard icon={Eye} label={t("analytics.overview.medianScore")} value={`${(analytics.overview.medianScore * 100).toFixed(0)}%`} />
                            </div>

                            {/* Daily Volume Chart */}
                            {analytics.dailyVolume.length > 0 && (
                                <div className="p-5 rounded-[14px] border border-border bg-card">
                                    <h3 className="text-sm font-semibold mb-4 m-0">{t("analytics.dailyVolume")}</h3>
                                    <div className="h-[250px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={analytics.dailyVolume}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={d => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
                                                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                                                <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                                                <Legend />
                                                <Bar dataKey="queries" name={t("analytics.queries")} fill="var(--accent)" radius={[4, 4, 0, 0]} />
                                                <Bar dataKey="hits" name={t("analytics.hits")} fill="var(--success)" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* Top Documents */}
                                <div className="p-5 rounded-[14px] border border-border bg-card">
                                    <h3 className="text-sm font-semibold mb-4 m-0">{t("analytics.topDocuments")}</h3>
                                    <div className="flex flex-col gap-2">
                                        {analytics.topDocuments.map((doc, i) => (
                                            <div key={doc.document_id || i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-background">
                                                <span className="text-sm truncate flex-1 mr-3">{doc.document_name}</span>
                                                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                                                    <span>{t("analytics.retrievalCount")}: <strong className="text-foreground">{doc.retrieval_count}</strong></span>
                                                    <span>{t("analytics.usedCount")}: <strong className="text-foreground">{doc.used_count}</strong></span>
                                                </div>
                                            </div>
                                        ))}
                                        {analytics.topDocuments.length === 0 && (
                                            <div className="text-center py-4 text-muted-foreground text-sm">{t("analytics.noData")}</div>
                                        )}
                                    </div>
                                </div>

                                {/* Unanswered Queries */}
                                <div className="p-5 rounded-[14px] border border-border bg-card">
                                    <h3 className="text-sm font-semibold mb-4 m-0">{t("analytics.unanswered")}</h3>
                                    <div className="flex flex-col gap-2">
                                        {analytics.unansweredQueries.map((q, i) => (
                                            <div key={q.id || i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-background">
                                                <div className="flex-1 mr-3">
                                                    <span className={cn("text-sm", q.resolved && "line-through text-muted-foreground")}>{q.query}</span>
                                                    <div className="text-[11px] text-muted-foreground mt-0.5">
                                                        {t("analytics.occurrences")}: {q.occurrences} • {t("analytics.lastSeen")}: {new Date(q.last_seen_at).toLocaleDateString()}
                                                    </div>
                                                </div>
                                                {!q.resolved ? (
                                                    <div className="flex items-center gap-1.5">
                                                        <button onClick={() => handleCreateFromQuery(q.query)} className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-primary/30 bg-primary/10 text-xs font-semibold cursor-pointer text-primary hover:bg-primary/20" title={tc("create")}>
                                                            <PlusCircle size={12} />
                                                        </button>
                                                        <button onClick={() => handleResolve(q.id)} className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-transparent text-xs font-semibold cursor-pointer text-foreground hover:bg-muted">
                                                            <CheckCircle2 size={12} /> {t("analytics.resolve")}
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className="text-[11px] text-success font-semibold">{t("analytics.resolved")}</span>
                                                )}
                                            </div>
                                        ))}
                                        {analytics.unansweredQueries.length === 0 && (
                                            <div className="text-center py-4 text-muted-foreground text-sm">{t("analytics.noData")}</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* AI Article Suggestions */}
                            <div className="p-5 rounded-[14px] border border-border bg-card">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-semibold m-0 flex items-center gap-2">
                                        <Sparkles size={16} className="text-amber-500" /> {t("suggestions.title")}
                                    </h3>
                                    <button
                                        onClick={handleGenerateSuggestions}
                                        disabled={suggestionsLoading}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs font-semibold cursor-pointer hover:bg-amber-500/20 disabled:opacity-50"
                                    >
                                        {suggestionsLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                                        {suggestionsLoading ? t("suggestions.generating") : t("suggestions.generate")}
                                    </button>
                                </div>

                                {suggestions.length > 0 ? (
                                    <div className="flex flex-col gap-3">
                                        {suggestions.map((s, i) => (
                                            <div key={i} className="p-3.5 rounded-xl bg-background border border-border">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1">
                                                        <div className="font-semibold text-sm flex items-center gap-2">
                                                            {s.title}
                                                            <span className={cn(
                                                                "text-[10px] px-2 py-0.5 rounded-md font-semibold",
                                                                s.priority === "high" ? "bg-red-500/10 text-red-500" :
                                                                s.priority === "medium" ? "bg-amber-500/10 text-amber-500" :
                                                                "bg-blue-500/10 text-blue-400"
                                                            )}>
                                                                {s.priority}
                                                            </span>
                                                        </div>
                                                        {s.category && (
                                                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-primary/10 text-primary font-semibold inline-block mt-1">
                                                                {s.category}
                                                            </span>
                                                        )}
                                                        {s.outline?.length > 0 && (
                                                            <ul className="mt-2 ml-4 text-xs text-muted-foreground list-disc space-y-0.5">
                                                                {s.outline.map((item: string, j: number) => <li key={j}>{item}</li>)}
                                                            </ul>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={() => handleCreateFromQuery(s.title)}
                                                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-xs font-semibold cursor-pointer text-primary hover:bg-primary/20 shrink-0"
                                                    >
                                                        <PlusCircle size={12} /> {tc("create")}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-4 text-muted-foreground text-sm">
                                        {t("suggestions.hint")}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Quality Tab */}
            {tab === "quality" && (
                <div>
                    {qualityLoading && <div className="text-center py-10 text-muted-foreground">{tc("loading")}</div>}
                    {!qualityLoading && qualityScores.length === 0 && (
                        <div className="text-center py-10 text-muted-foreground">{t("quality.noData")}</div>
                    )}
                    {!qualityLoading && qualityScores.length > 0 && (
                        <div className="flex flex-col gap-3">
                            {qualityScores.sort((a, b) => b.qualityScore - a.qualityScore).map(doc => (
                                <div key={doc.id} className="p-5 rounded-[14px] border border-border bg-card">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-[15px] font-semibold truncate flex-1 mr-3">{doc.title}</span>
                                        <div className={cn(
                                            "text-lg font-semibold px-3 py-1 rounded-lg",
                                            doc.qualityScore >= 70 ? "bg-emerald-500/10 text-emerald-500" :
                                            doc.qualityScore >= 40 ? "bg-amber-500/10 text-amber-500" :
                                            "bg-red-500/10 text-red-500"
                                        )}>
                                            {doc.qualityScore}/100
                                        </div>
                                    </div>
                                    <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
                                        <div
                                            className={cn("h-full rounded-full transition-all",
                                                doc.qualityScore >= 70 ? "bg-emerald-500" :
                                                doc.qualityScore >= 40 ? "bg-amber-500" : "bg-red-500"
                                            )}
                                            style={{ width: `${doc.qualityScore}%` }}
                                        />
                                    </div>
                                    <div className="grid grid-cols-5 gap-2 text-xs">
                                        {[
                                            { key: "contentLength", label: t("quality.contentLength"), max: 25 },
                                            { key: "chunkCount", label: t("quality.chunkCount"), max: 20 },
                                            { key: "categorized", label: t("quality.categorized"), max: 10 },
                                            { key: "retrievals", label: t("quality.retrievals"), max: 25 },
                                            { key: "relevance", label: t("quality.relevance"), max: 20 },
                                        ].map(f => (
                                            <div key={f.key} className="text-center">
                                                <div className="text-muted-foreground mb-1">{f.label}</div>
                                                <div className="font-semibold">{doc.factors[f.key]}/{f.max}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Upgrade Modal */}
            <UpgradeModal
                open={showUpgradeModal}
                onClose={() => setShowUpgradeModal(false)}
                title={t("limitReachedTitle")}
                description={t("limitReachedDesc")}
            />

            {/* Crawl URL Modal */}
            {showCrawlModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCrawlModal(false)}>
                    <div onClick={e => e.stopPropagation()} className="w-[520px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-semibold m-0">{t("crawl.title")}</h2>
                            <button onClick={() => setShowCrawlModal(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("crawl.urlLabel")}</label>
                            <input
                                value={crawlForm.url}
                                onChange={e => setCrawlForm({ ...crawlForm, url: e.target.value })}
                                placeholder={t("crawl.urlPlaceholder")}
                                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                            />
                        </div>
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("crawl.titleLabel")}</label>
                            <input
                                value={crawlForm.title}
                                onChange={e => setCrawlForm({ ...crawlForm, title: e.target.value })}
                                placeholder={t("crawl.titlePlaceholder")}
                                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                            />
                        </div>
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{tc("category")}</label>
                            <input
                                value={crawlForm.category}
                                onChange={e => setCrawlForm({ ...crawlForm, category: e.target.value })}
                                list="kb-categories"
                                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                            />
                            <datalist id="kb-categories">
                                {categories.map(c => <option key={c} value={c} />)}
                            </datalist>
                        </div>
                        <div className="flex gap-2.5 mt-6">
                            <button onClick={() => setShowCrawlModal(false)} className="flex-1 py-3 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer font-semibold">{tc("cancel")}</button>
                            <button onClick={handleCrawl} disabled={crawling || !crawlForm.url} className={cn("flex-1 py-3 rounded-[10px] border-none text-white text-sm font-semibold", crawling ? "bg-muted cursor-wait" : "bg-primary cursor-pointer")}>
                                {crawling ? t("crawl.importing") : t("crawl.button")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Document Modal */}
            {editDoc && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setEditDoc(null)}>
                    <div onClick={e => e.stopPropagation()} className="w-[600px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-semibold m-0">{t("edit.title")}</h2>
                            <button onClick={() => setEditDoc(null)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.titleLabel")}</label>
                            <input
                                value={editForm.name}
                                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                            />
                        </div>
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.contentLabel")}</label>
                            <textarea
                                value={editForm.content}
                                onChange={e => setEditForm({ ...editForm, content: e.target.value })}
                                rows={14}
                                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border resize-y"
                            />
                        </div>
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{tc("category")}</label>
                            <input
                                value={editForm.category}
                                onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                                list="kb-edit-categories"
                                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                            />
                            <datalist id="kb-edit-categories">
                                {categories.map(c => <option key={c} value={c} />)}
                            </datalist>
                        </div>
                        <div className="flex gap-2.5 mt-6">
                            <button onClick={() => setEditDoc(null)} className="flex-1 py-3 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer font-semibold">{tc("cancel")}</button>
                            <button onClick={handleEditSave} disabled={editSaving || !editForm.name} className={cn("flex-1 py-3 rounded-[10px] border-none text-white text-sm font-semibold", editSaving ? "bg-muted cursor-wait" : "bg-primary cursor-pointer")}>
                                {editSaving ? t("edit.saving") : t("edit.save")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Resource Modal (legacy) */}
            {showCreateModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
                    <div onClick={e => e.stopPropagation()} className="w-[520px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-semibold m-0">{t("modal.title")}</h2>
                            <button onClick={() => setShowCreateModal(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.titleLabel")}</label>
                            <input value={createForm.title} onChange={e => setCreateForm({ ...createForm, title: e.target.value })} placeholder={t("modal.titlePlaceholder")} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                        </div>
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.contentLabel")}</label>
                            <textarea value={createForm.content} onChange={e => setCreateForm({ ...createForm, content: e.target.value })} rows={10} placeholder={t("modal.contentPlaceholder")} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border resize-y" />
                        </div>
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{tc("category")}</label>
                            <input value={createForm.category} onChange={e => setCreateForm({ ...createForm, category: e.target.value })} list="kb-create-categories" className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                            <datalist id="kb-create-categories">
                                {categories.map(c => <option key={c} value={c} />)}
                            </datalist>
                        </div>
                        <div className="flex gap-2.5 mt-6">
                            <button onClick={() => setShowCreateModal(false)} className="flex-1 py-3 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer font-semibold">{tc("cancel")}</button>
                            <button onClick={handleCreate} disabled={createSaving || !createForm.title || !createForm.content} className={cn("flex-1 py-3 rounded-[10px] border-none text-white text-sm font-semibold", createSaving ? "bg-muted cursor-wait" : "bg-primary cursor-pointer")}>{createSaving ? tc("saving") : tc("create")}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Upload Modal */}
            {showBulkModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { setShowBulkModal(false); setBulkResults(null); setBulkFiles([]); }}>
                    <div onClick={e => e.stopPropagation()} className="w-[520px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-semibold m-0">{t("bulk.title")}</h2>
                            <button onClick={() => { setShowBulkModal(false); setBulkResults(null); setBulkFiles([]); }} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>

                        {!bulkResults ? (
                            <>
                                <div className="mb-4">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-2">{t("bulk.selectFiles")}</label>
                                    <input
                                        type="file"
                                        multiple
                                        accept=".pdf,.docx,.doc,.txt,.md,.csv"
                                        onChange={handleBulkFileSelect}
                                        className="w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-border file:bg-background file:text-foreground file:font-semibold file:text-xs file:cursor-pointer"
                                    />
                                    <div className="text-[11px] text-muted-foreground mt-1">{t("bulk.formats")}</div>
                                </div>

                                {bulkFiles.length > 0 && (
                                    <div className="mb-4 p-3 rounded-xl bg-background border border-border">
                                        <div className="text-xs font-semibold text-muted-foreground mb-2">
                                            {t("bulk.filesSelected", { count: bulkFiles.length })}
                                        </div>
                                        <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                                            {bulkFiles.map((f, i) => (
                                                <div key={i} className="text-xs text-foreground flex items-center gap-1.5">
                                                    <FileText size={12} className="text-muted-foreground shrink-0" />
                                                    <span className="truncate">{f.name}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="mb-4">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">{tc("category")}</label>
                                    <input
                                        value={bulkCategory}
                                        onChange={e => setBulkCategory(e.target.value)}
                                        list="kb-bulk-categories"
                                        placeholder={t("bulk.categoryHint")}
                                        className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                                    />
                                    <datalist id="kb-bulk-categories">
                                        {categories.map(c => <option key={c} value={c} />)}
                                    </datalist>
                                </div>

                                <div className="flex gap-2.5 mt-5">
                                    <button onClick={() => { setShowBulkModal(false); setBulkFiles([]); }} className="flex-1 py-3 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer font-semibold">{tc("cancel")}</button>
                                    <button
                                        onClick={handleBulkUpload}
                                        disabled={bulkUploading || bulkFiles.length === 0}
                                        className={cn("flex-1 py-3 rounded-[10px] border-none text-white text-sm font-semibold flex items-center justify-center gap-2",
                                            bulkUploading || !bulkFiles.length ? "bg-muted cursor-wait" : "bg-primary cursor-pointer")}
                                    >
                                        {bulkUploading && <Loader2 size={14} className="animate-spin" />}
                                        {bulkUploading ? t("bulk.uploading") : t("bulk.upload")}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="mb-4 text-center">
                                    <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" />
                                    <div className="text-lg font-semibold">{t("bulk.complete")}</div>
                                    <div className="text-sm text-muted-foreground mt-1">
                                        {t("bulk.resultSummary", { succeeded: bulkResults.succeeded, failed: bulkResults.failed, total: bulkResults.total })}
                                    </div>
                                </div>
                                {bulkResults.results?.filter((r: any) => r.status === "error").length > 0 && (
                                    <div className="mb-4 p-3 rounded-xl bg-red-500/5 border border-red-500/20">
                                        <div className="text-xs font-semibold text-red-500 mb-2">{t("bulk.errors")}</div>
                                        {bulkResults.results.filter((r: any) => r.status === "error").map((r: any, i: number) => (
                                            <div key={i} className="text-xs text-muted-foreground">{r.name}: {r.error}</div>
                                        ))}
                                    </div>
                                )}
                                <button
                                    onClick={() => { setShowBulkModal(false); setBulkResults(null); setBulkFiles([]); setBulkCategory(""); }}
                                    className="w-full py-3 rounded-[10px] border-none bg-primary text-white text-sm font-semibold cursor-pointer"
                                >
                                    {tc("close")}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Version History Modal */}
            {versionDoc && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setVersionDoc(null)}>
                    <div onClick={e => e.stopPropagation()} className="w-[560px] max-h-[80vh] p-7 rounded-[18px] bg-card border border-border shadow-2xl flex flex-col">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-semibold m-0 flex items-center gap-2">
                                <History size={20} className="text-primary" /> {t("versions.title")}
                            </h2>
                            <button onClick={() => setVersionDoc(null)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="text-sm text-muted-foreground mb-4">
                            {versionDoc.name || versionDoc.title} — {t("versions.current")}: v{versionDoc.version || 1}
                        </div>

                        {versionsLoading && <div className="text-center py-10 text-muted-foreground">{tc("loading")}</div>}

                        {!versionsLoading && versions.length === 0 && (
                            <div className="text-center py-10 text-muted-foreground">{t("versions.noVersions")}</div>
                        )}

                        {!versionsLoading && versions.length > 0 && (
                            <div className="flex flex-col gap-2.5 overflow-y-auto flex-1">
                                {versions.map(v => (
                                    <div key={v.id} className="flex items-center justify-between p-4 rounded-xl bg-background border border-border">
                                        <div className="flex-1 mr-3">
                                            <div className="font-semibold text-sm flex items-center gap-2">
                                                v{v.version}
                                                {v.title && <span className="text-muted-foreground font-normal truncate">{v.title}</span>}
                                            </div>
                                            <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2">
                                                <Calendar size={11} /> {new Date(v.created_at).toLocaleString()}
                                                {v.chunk_count != null && <span>• {v.chunk_count} chunks</span>}
                                                {v.changed_by && <span>• {v.changed_by}</span>}
                                            </div>
                                            {v.change_summary && (
                                                <div className="text-[11px] text-muted-foreground mt-0.5 italic">{v.change_summary}</div>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => handleRestoreVersion(v.id)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs font-semibold cursor-pointer hover:bg-amber-500/20 shrink-0"
                                        >
                                            <RotateCcw size={12} /> {t("versions.restore")}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className={cn(
                    "fixed bottom-6 right-6 z-[2000] px-5 py-3 rounded-xl text-sm font-semibold text-white shadow-lg transition-all",
                    toast.type === "success" ? "bg-emerald-500" : "bg-red-500",
                )}>
                    {toast.msg}
                </div>
            )}
        </div>
    );
}

function KPICard({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
    return (
        <div className="p-4 rounded-[14px] border border-border bg-card flex flex-col gap-2">
            <div className="flex items-center gap-2 text-muted-foreground">
                <Icon size={16} />
                <span className="text-xs font-semibold">{label}</span>
            </div>
            <div className="text-2xl font-semibold text-foreground">{value}</div>
        </div>
    );
}
