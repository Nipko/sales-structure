"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import {
    BookOpen, FileText, Upload, Search, Trash2, Eye, Plus, X,
    File, FileSpreadsheet, Globe, Clock, HardDrive, CheckCircle2,
    AlertCircle, RefreshCw, Database, Layers,
} from "lucide-react";

// No mock data — loaded from API

const typeConfig: Record<string, { icon: any; color: string; label: string }> = {
    pdf: { icon: FileText, color: "#e74c3c", label: "PDF" },
    md: { icon: File, color: "#3498db", label: "Markdown" },
    xlsx: { icon: FileSpreadsheet, color: "#2ecc71", label: "Excel" },
    url: { icon: Globe, color: "#9b59b6", label: "Web URL" },
    txt: { icon: File, color: "#95a5a6", label: "Text" },
};

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
    indexed: { label: "Indexado", color: "#2ecc71", icon: CheckCircle2 },
    processing: { label: "Procesando", color: "#f39c12", icon: RefreshCw },
    failed: { label: "Error", color: "#e74c3c", icon: AlertCircle },
};

export default function KnowledgeBasePage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [documents, setDocuments] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [showUpload, setShowUpload] = useState(false);
    const [newDoc, setNewDoc] = useState({ name: "", description: "", type: "pdf", url: "" });
    const [toast, setToast] = useState<string | null>(null);
    const [isLive, setIsLive] = useState(false);

    // Load documents from API
    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            try {
                const result = await api.fetch(`/knowledge/${activeTenantId}`);
                if (Array.isArray(result?.data) && result.data.length > 0) {
                    setDocuments(result.data.map((d: any) => ({
                        id: d.id,
                        name: d.name || d.title || 'Untitled',
                        type: d.type || 'pdf',
                        size: d.size || '—',
                        chunks: d.chunks || d.chunk_count || 0,
                        status: d.status || 'indexed',
                        uploadedAt: d.uploadedAt?.split('T')[0] || d.created_at?.split('T')[0] || '—',
                        lastSynced: d.lastSynced || d.last_synced || null,
                        description: d.description || '',
                    })));
                    setIsLive(true);
                }
            } catch (err) {
                console.error('Failed to load knowledge docs:', err);
            }
        }
        load();
    }, [activeTenantId]);

    const filtered = documents.filter(d =>
        searchQuery ? `${d.name} ${d.description}`.toLowerCase().includes(searchQuery.toLowerCase()) : true
    );

    const stats = {
        total: documents.length,
        indexed: documents.filter(d => d.status === "indexed").length,
        totalChunks: documents.reduce((s, d) => s + d.chunks, 0),
        processing: documents.filter(d => d.status === "processing").length,
    };

    function handleUpload() {
        if (!newDoc.name) return;
        setDocuments(prev => [...prev, {
            id: `d${Date.now()}`,
            name: newDoc.name,
            type: newDoc.type as any,
            size: "—",
            chunks: 0,
            status: "processing" as const,
            uploadedAt: new Date().toISOString().split("T")[0],
            lastSynced: null,
            description: newDoc.description,
        }]);
        setShowUpload(false);
        setNewDoc({ name: "", description: "", type: "pdf", url: "" });
        setToast("Documento agregado — procesando vectorización...");
        setTimeout(() => setToast(null), 3000);
    }

    function handleDelete(id: string) {
        setDocuments(prev => prev.filter(d => d.id !== id));
        setToast("Documento eliminado");
        setTimeout(() => setToast(null), 2000);
    }

    return (
        <>
            <div>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                            <BookOpen size={28} color="var(--accent)" /> Knowledge Base
                            <DataSourceBadge isLive={isLive} />
                        </h1>
                        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                            {stats.total} documentos · {stats.totalChunks} chunks vectorizados
                        </p>
                    </div>
                    <button onClick={() => setShowUpload(true)} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
                        borderRadius: 10, border: "none", background: "var(--accent)", color: "white",
                        fontWeight: 600, fontSize: 14, cursor: "pointer",
                    }}>
                        <Upload size={18} /> Subir Documento
                    </button>
                </div>

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                    {[
                        { label: "Documentos", value: stats.total, color: "var(--accent)", icon: BookOpen },
                        { label: "Indexados", value: stats.indexed, color: "#2ecc71", icon: Database },
                        { label: "Chunks", value: stats.totalChunks, color: "#3498db", icon: Layers },
                        { label: "Procesando", value: stats.processing, color: "#f39c12", icon: RefreshCw },
                    ].map(stat => (
                        <div key={stat.label} style={{ padding: 20, borderRadius: 14, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>{stat.label}</div>
                                    <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{stat.value}</div>
                                </div>
                                <div style={{ width: 44, height: 44, borderRadius: 12, background: `${stat.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <stat.icon size={22} color={stat.color} />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Search */}
                <div style={{ position: "relative", maxWidth: 400, marginBottom: 20 }}>
                    <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }} />
                    <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar documentos..."
                        style={{ width: "100%", padding: "10px 10px 10px 36px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>

                {/* Documents Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
                    {filtered.map(doc => {
                        const tc = typeConfig[doc.type] || typeConfig.txt;
                        const sc = statusConfig[doc.status];
                        const TypeIcon = tc.icon;
                        const StatusIcon = sc.icon;

                        return (
                            <div key={doc.id} style={{
                                padding: 20, borderRadius: 14, background: "var(--bg-secondary)",
                                border: "1px solid var(--border)", transition: "border-color 0.2s ease",
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                    <div style={{ display: "flex", gap: 12, flex: 1 }}>
                                        <div style={{
                                            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                                            background: `${tc.color}15`, display: "flex", alignItems: "center", justifyContent: "center",
                                        }}>
                                            <TypeIcon size={22} color={tc.color} />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>{doc.name}</div>
                                            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>{doc.description}</div>
                                        </div>
                                    </div>
                                    <button onClick={() => handleDelete(doc.id)} style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", padding: 4, opacity: 0.5 }}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>

                                <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 12, color: "var(--text-secondary)", flexWrap: "wrap" }}>
                                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <StatusIcon size={12} color={sc.color} /> <span style={{ color: sc.color, fontWeight: 600 }}>{sc.label}</span>
                                    </span>
                                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <Layers size={12} /> {doc.chunks} chunks
                                    </span>
                                    {doc.size !== "—" && (
                                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                            <HardDrive size={12} /> {doc.size}
                                        </span>
                                    )}
                                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <Clock size={12} /> {doc.uploadedAt}
                                    </span>
                                    <span style={{ padding: "2px 6px", borderRadius: 4, background: `${tc.color}15`, color: tc.color, fontWeight: 600, fontSize: 10 }}>
                                        {tc.label}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* RAG Architecture Info */}
                <div style={{ marginTop: 24, padding: 20, borderRadius: 14, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🧠 Cómo funciona la Knowledge Base</div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                        Los documentos se procesan con <strong>text-embedding-3-small</strong> para generar vectores
                        almacenados en <strong>pgvector</strong>. Cuando un cliente hace una pregunta, el sistema
                        busca los chunks más relevantes y los incluye como contexto para que el LLM genere
                        respuestas precisas basadas en tu información real.
                    </div>
                    <div style={{ display: "flex", gap: 12, marginTop: 12, fontFamily: "monospace", fontSize: 12, flexWrap: "wrap" }}>
                        <span style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(108,92,231,0.1)", color: "var(--accent)" }}>📄 Upload</span>
                        <span>→</span>
                        <span style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(52,152,219,0.1)", color: "#3498db" }}>✂️ Chunk</span>
                        <span>→</span>
                        <span style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(155,89,182,0.1)", color: "#9b59b6" }}>🧮 Embed</span>
                        <span>→</span>
                        <span style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(46,204,113,0.1)", color: "#2ecc71" }}>💾 pgvector</span>
                        <span>→</span>
                        <span style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(241,196,15,0.1)", color: "#f1c40f" }}>🔍 RAG Query</span>
                    </div>
                </div>
            </div>

            {/* Upload Modal */}
            {showUpload && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 1000, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
                }} onClick={() => setShowUpload(false)}>
                    <div onClick={e => e.stopPropagation()} style={{
                        width: 460, padding: 28, borderRadius: 18,
                        background: "var(--bg-secondary)", border: "1px solid var(--border)",
                        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Subir Documento</h2>
                            <button onClick={() => setShowUpload(false)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}><X size={20} /></button>
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Nombre del documento</label>
                            <input value={newDoc.name} onChange={e => setNewDoc(p => ({ ...p, name: e.target.value }))} placeholder="Catálogo de precios 2026" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Descripción</label>
                            <textarea value={newDoc.description} onChange={e => setNewDoc(p => ({ ...p, description: e.target.value }))} placeholder="Descripción breve del contenido..." rows={2} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box", resize: "vertical" }} />
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Tipo</label>
                            <select value={newDoc.type} onChange={e => setNewDoc(p => ({ ...p, type: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                                <option value="pdf">📄 PDF</option>
                                <option value="md">📝 Markdown</option>
                                <option value="xlsx">📊 Excel</option>
                                <option value="txt">📃 Texto</option>
                                <option value="url">🌐 Web URL</option>
                            </select>
                        </div>
                        {newDoc.type === "url" && (
                            <div style={{ marginBottom: 14 }}>
                                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>URL</label>
                                <input value={newDoc.url} onChange={e => setNewDoc(p => ({ ...p, url: e.target.value }))} placeholder="https://example.com" type="url" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                            </div>
                        )}
                        {newDoc.type !== "url" && (
                            <div style={{ marginBottom: 14, padding: 20, borderRadius: 10, border: "2px dashed var(--border)", textAlign: "center" }}>
                                <Upload size={24} color="var(--text-secondary)" style={{ marginBottom: 8 }} />
                                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                                    Arrastra un archivo aquí o haz clic para seleccionar
                                </div>
                                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                                    PDF, XLSX, MD, TXT — máx. 10MB
                                </div>
                            </div>
                        )}
                        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                            <button onClick={() => setShowUpload(false)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer" }}>Cancelar</button>
                            <button onClick={handleUpload} disabled={!newDoc.name} style={{
                                flex: 1, padding: "10px", borderRadius: 10, border: "none",
                                background: !newDoc.name ? "var(--border)" : "var(--accent)", color: "white",
                                fontSize: 14, fontWeight: 600, cursor: !newDoc.name ? "not-allowed" : "pointer",
                            }}>Subir y Procesar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div style={{
                    position: "fixed", bottom: 24, right: 24, zIndex: 1100,
                    padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600,
                    background: toast.includes("eliminado") ? "#e74c3c" : "#2ecc71", color: "white",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.2)", animation: "slideUp 0.3s ease",
                }}>
                    ✓ {toast}
                </div>
            )}
            <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </>
    );
}
