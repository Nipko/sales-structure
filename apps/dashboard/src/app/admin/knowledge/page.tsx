"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    BookOpen, Search, Plus, CheckCircle, Clock, X, FileText, Globe, Key, File
} from "lucide-react";

type Tab = "library" | "search";

const iconMap: Record<string, any> = { manual: FileText, pdf: File, url: Globe };
const statusColors: Record<string, string> = { draft: "#f39c12", approved: "#2ecc71", archived: "#95a5a6" };
const statusLabels: Record<string, string> = { draft: "Borrador", approved: "Aprobado", archived: "Archivado" };

export default function KnowledgePage() {
    const t = useTranslations('knowledge');
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [tab, setTab] = useState<Tab>("library");
    const [resources, setResources] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ title: "", type: "manual", content: "", source_url: "" });

    useEffect(() => {
        if (!activeTenantId) return;
        api.fetch(`/knowledge/resources/${activeTenantId}`)
            .then(d => { if (Array.isArray(d)) setResources(d); })
            .catch(() => []);
    }, [activeTenantId]);

    const handleCreate = async () => {
        if (!form.title || !activeTenantId) return;
        setSaving(true);
        try {
            const created = await api.fetch(`/knowledge/resources/${activeTenantId}`, { method: "POST", body: JSON.stringify(form) });
            if (created?.id) { setResources([created, ...resources]); setShowModal(false); setForm({ title: "", type: "manual", content: "", source_url: "" }); }
        } catch (e) { console.error(e); } finally { setSaving(false); }
    };

    const handleApprove = async (id: string) => {
        try {
            await api.fetch(`/knowledge/resources/${activeTenantId}/${id}/approve`, { method: "POST", body: JSON.stringify({ approved_by: user?.email }) });
            setResources(resources.map(r => r.id === id ? { ...r, status: "approved" } : r));
        } catch (e) { console.error(e); }
    };

    const handleSearch = async () => {
        if (!searchQuery) return setSearchResults([]);
        try {
            const data = await api.fetch(`/knowledge/search/${activeTenantId}?query=${encodeURIComponent(searchQuery)}`);
            setSearchResults(Array.isArray(data) ? data : []);
        } catch (e) { console.error(e); }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-[28px] font-bold m-0 flex items-center gap-2.5">
                        <BookOpen size={28} className="text-primary" /> {t('title')}
                    </h1>
                    <p className="text-muted-foreground mt-1">Bases de conocimiento, FAQs y documentos comerciales para Carla AI</p>
                </div>
                {tab === "library" && (
                    <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer">
                        <Plus size={18} /> Nuevo Recurso
                    </button>
                )}
            </div>

            <div className="flex gap-1 mb-5 bg-card rounded-xl p-1 border border-border w-[300px]">
                <button onClick={() => setTab("library")} className={cn("flex-1 px-3 py-2 rounded-lg border-none font-semibold text-[13px] cursor-pointer flex items-center gap-1.5 transition-all duration-200", tab === "library" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground")}>
                    <BookOpen size={16} /> Biblioteca
                </button>
                <button onClick={() => setTab("search")} className={cn("flex-1 px-3 py-2 rounded-lg border-none font-semibold text-[13px] cursor-pointer flex items-center gap-1.5 transition-all duration-200", tab === "search" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground")}>
                    <Search size={16} /> Buscar en Contexto
                </button>
            </div>

            {tab === "library" && (
                <div className="flex flex-col gap-3">
                    {resources.map(r => {
                        const Icon = iconMap[r.type] || FileText;
                        return (
                            <div key={r.id} className="flex items-center justify-between px-5 py-4 rounded-[14px] border border-border bg-card">
                                <div className="flex items-center gap-3.5">
                                    <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-background">
                                        <Icon size={20} className="text-primary" />
                                    </div>
                                    <div>
                                        <div className="font-semibold text-[15px] flex items-center gap-2">
                                            {r.title}
                                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-background text-muted-foreground font-semibold">v{r.version}</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                                            <span className="uppercase">{r.type}</span> • {new Date(r.created_at).toLocaleDateString()}
                                            {r.content_hash && <span>• Hash: {r.content_hash.substring(0, 8)}</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ color: statusColors[r.status] || undefined, background: `${statusColors[r.status] || "#95a5a6"}22` }}>
                                        {statusLabels[r.status] || r.status}
                                    </span>
                                    {r.status === "draft" && (
                                        <button onClick={() => handleApprove(r.id)} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border-none bg-emerald-500 text-white font-semibold text-xs cursor-pointer">
                                            <CheckCircle size={14} /> Aprobar
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {resources.length === 0 && <div className="text-center py-10 text-muted-foreground">No hay recursos en la base de conocimiento.</div>}
                </div>
            )}

            {tab === "search" && (
                <div>
                    <div className="flex gap-2.5 mb-5">
                        <div className="flex-1 relative">
                            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} placeholder="Busca conocimiento tal como lo haria Carla AI (ej. 'medios de pago')..." className="w-full py-3.5 pl-11 pr-4 rounded-xl border border-border bg-card text-foreground text-[15px] outline-none box-border" />
                        </div>
                        <button onClick={handleSearch} className="px-6 rounded-xl border-none bg-primary text-white font-semibold text-sm cursor-pointer">Buscar</button>
                    </div>
                    <div className="flex flex-col gap-2.5">
                        {searchResults.map(s => (
                            <div key={s.id} className="p-4 rounded-xl border border-border bg-card">
                                <div className="flex items-center gap-1.5 mb-2">
                                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary">{s.resource_title}</span>
                                    <span className="text-[11px] text-muted-foreground">Chunk #{s.chunk_index}</span>
                                </div>
                                <p className="text-sm text-foreground m-0 leading-relaxed">"{s.content}"</p>
                            </div>
                        ))}
                        {searchResults.length === 0 && searchQuery && <div className="text-center py-10 text-muted-foreground">No se encontraron coincidencias.</div>}
                    </div>
                </div>
            )}

            {showModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} className="w-[520px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-bold m-0">Nuevo Recurso de Conocimiento</h2>
                            <button onClick={() => setShowModal(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">Titulo del Recurso</label>
                            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="FAQ Curso React Native..." className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                        </div>
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">Contenido Texto</label>
                            <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} rows={10} placeholder="Pega el contenido del documento o la respuesta a la FAQ aqui. Se dividira automaticamente en chunks..." className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border resize-y" />
                        </div>
                        <div className="flex gap-2.5 mt-6">
                            <button onClick={() => setShowModal(false)} className="flex-1 py-3 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer font-semibold">Cancelar</button>
                            <button onClick={handleCreate} disabled={saving || !form.title || !form.content} className={cn("flex-1 py-3 rounded-[10px] border-none text-white text-sm font-semibold", saving ? "bg-muted cursor-wait" : "bg-primary cursor-pointer")}>{saving ? "Procesando Chunks..." : "Crear e Indexar"}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
