"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    BookOpen, Search, Plus, CheckCircle, Clock, X, FileText, Globe, Key, File
} from "lucide-react";

type Tab = "library" | "search";

const iconMap: Record<string, any> = {
    manual: FileText, pdf: File, url: Globe
};
const statusColors: Record<string, string> = {
    draft: "#f39c12", approved: "#2ecc71", archived: "#95a5a6"
};
const statusLabels: Record<string, string> = {
    draft: "Borrador", approved: "Aprobado", archived: "Archivado"
};

export default function KnowledgePage() {
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
            const created = await api.fetch(`/knowledge/resources/${activeTenantId}`, {
                method: "POST",
                body: JSON.stringify(form),
            });
            if (created?.id) {
                setResources([created, ...resources]);
                setShowModal(false);
                setForm({ title: "", type: "manual", content: "", source_url: "" });
            }
        } catch (e) { console.error(e); } finally { setSaving(false); }
    };

    const handleApprove = async (id: string) => {
        try {
            await api.fetch(`/knowledge/resources/${activeTenantId}/${id}/approve`, {
                method: "POST",
                body: JSON.stringify({ approved_by: user?.email })
            });
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
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                        <BookOpen size={28} color="var(--accent)" /> Knowledge Base / RAG
                    </h1>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>Bases de conocimiento, FAQs y documentos comerciales para Carla AI</p>
                </div>
                {tab === "library" && (
                    <button onClick={() => setShowModal(true)} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 10, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer"
                    }}><Plus size={18} /> Nuevo Recurso</button>
                )}
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--bg-secondary)", borderRadius: 12, padding: 4, border: "1px solid var(--border)", width: 300 }}>
                <button onClick={() => setTab("library")} style={{
                    flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", background: tab === "library" ? "var(--accent)" : "transparent", color: tab === "library" ? "white" : "var(--text-secondary)", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s ease"
                }}><BookOpen size={16} /> Biblioteca</button>
                <button onClick={() => setTab("search")} style={{
                    flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", background: tab === "search" ? "var(--accent)" : "transparent", color: tab === "search" ? "white" : "var(--text-secondary)", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s ease"
                }}><Search size={16} /> Buscar en Contexto</button>
            </div>

            {/* Library Tab */}
            {tab === "library" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {resources.map(r => {
                        const Icon = iconMap[r.type] || FileText;
                        return (
                            <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                    <div style={{ width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-primary)" }}>
                                        <Icon size={20} color="var(--accent)" />
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
                                            {r.title}
                                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "var(--bg-primary)", color: "var(--text-secondary)", fontWeight: 600 }}>v{r.version}</span>
                                        </div>
                                        <div style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                                            <span style={{ textTransform: "uppercase" }}>{r.type}</span> • {new Date(r.created_at).toLocaleDateString()}
                                            {r.content_hash && <span>• Hash: {r.content_hash.substring(0,8)}</span>}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: statusColors[r.status] || "var(--text-secondary)", padding: "4px 10px", borderRadius: 8, background: `${statusColors[r.status] || "#95a5a6"}22` }}>
                                        {statusLabels[r.status] || r.status}
                                    </span>
                                    {r.status === "draft" && (
                                        <button onClick={() => handleApprove(r.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: "none", background: "#2ecc71", color: "white", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                                            <CheckCircle size={14} /> Aprobar
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {resources.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>No hay recursos en la base de conocimiento.</div>}
                </div>
            )}

            {/* Search Tab */}
            {tab === "search" && (
                <div>
                    <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                        <div style={{ flex: 1, position: "relative" }}>
                            <Search size={18} color="var(--text-secondary)" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }} />
                            <input
                                value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
                                placeholder="Busca conocimiento tal como lo haría Carla AI (ej. 'medios de pago')..."
                                style={{ width: "100%", padding: "14px 16px 14px 44px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 15, outline: "none", boxSizing: "border-box" }}
                            />
                        </div>
                        <button onClick={handleSearch} style={{ padding: "0 24px", borderRadius: 12, border: "none", background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>Buscar</button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {searchResults.map(s => (
                            <div key={s.id} style={{ padding: "16px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "var(--accent)22", color: "var(--accent)" }}>{s.resource_title}</span>
                                    <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Chunk #{s.chunk_index}</span>
                                </div>
                                <p style={{ fontSize: 14, color: "var(--text-primary)", margin: 0, lineHeight: 1.5 }}>"{s.content}"</p>
                            </div>
                        ))}
                        {searchResults.length === 0 && searchQuery && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>No se encontraron coincidencias.</div>}
                    </div>
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 520, padding: 28, borderRadius: 18, background: "var(--bg-secondary)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Nuevo Recurso de Conocimiento</h2>
                            <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}><X size={20} /></button>
                        </div>
                        
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Título del Recurso</label>
                            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="FAQ Curso React Native..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Contenido Texto</label>
                            <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} rows={10} placeholder="Pega el contenido del documento o la respuesta a la FAQ aquí. Se dividirá automáticamente en chunks..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box", resize: "vertical" }} />
                        </div>

                        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                            <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
                            <button onClick={handleCreate} disabled={saving || !form.title || !form.content} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: saving ? "var(--border)" : "var(--accent)", color: "white", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}>{saving ? "Procesando Chunks..." : "Crear e Indexar"}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
