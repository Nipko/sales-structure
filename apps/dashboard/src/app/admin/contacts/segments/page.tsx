"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import {
    Users,
    Plus,
    X,
    Search,
    Eye,
    ArrowLeft,
    Filter,
    Calendar,
    Check,
    Trash2,
} from "lucide-react";

// ── Types ──
interface Segment {
    id: string;
    name: string;
    description: string;
    filter_rules: FilterRule[];
    contact_count: number;
    created_at: string;
}

interface FilterRule {
    field: string;
    operator: string;
    value: string;
}

interface Contact {
    id: string;
    name: string;
    phone: string;
    email: string;
    stage: string;
    score: number;
}

const FIELDS = [
    { value: "stage", label: "Etapa" },
    { value: "score", label: "Score" },
    { value: "phone", label: "Telefono" },
    { value: "email", label: "Email" },
    { value: "source", label: "Fuente" },
    { value: "is_vip", label: "VIP" },
    { value: "created_at", label: "Fecha de creacion" },
];

const OPERATORS = [
    { value: "eq", label: "es igual a" },
    { value: "neq", label: "no es igual a" },
    { value: "gt", label: "mayor que" },
    { value: "gte", label: "mayor o igual que" },
    { value: "lt", label: "menor que" },
    { value: "lte", label: "menor o igual que" },
    { value: "contains", label: "contiene" },
    { value: "in", label: "es uno de" },
];

// ── Styles ──
const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", borderRadius: 8,
    border: "1px solid #2a2a45", background: "#0a0a12",
    color: "#e8e8f0", fontSize: 14, outline: "none", boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, fontWeight: 600,
    color: "#9898b0", marginBottom: 4,
};

const emptyForm = () => ({
    name: "",
    description: "",
    filterRules: [{ field: "stage", operator: "eq", value: "" }] as FilterRule[],
});

export default function SegmentsPage() {
    const { activeTenantId } = useTenant();

    const [segments, setSegments] = useState<Segment[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<string | null>(null);

    // Modal
    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState(emptyForm());
    const [previewCount, setPreviewCount] = useState<number | null>(null);

    // Detail view
    const [viewingSegment, setViewingSegment] = useState<Segment | null>(null);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [contactsLoading, setContactsLoading] = useState(false);

    useEffect(() => { loadSegments(); }, [activeTenantId]);

    async function loadSegments() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res = await api.getSegments(activeTenantId);
            if (res.success && Array.isArray(res.data)) {
                setSegments(res.data);
            }
        } catch (err) {
            console.error("Error loading segments", err);
        } finally {
            setLoading(false);
        }
    }

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(null), 2500);
    }

    function openCreate() {
        setForm(emptyForm());
        setPreviewCount(null);
        setModalOpen(true);
    }

    // ── Filter builder ──
    function addFilter() {
        setForm(prev => ({
            ...prev,
            filterRules: [...prev.filterRules, { field: "stage", operator: "eq", value: "" }],
        }));
    }

    function removeFilter(idx: number) {
        setForm(prev => ({
            ...prev,
            filterRules: prev.filterRules.filter((_, i) => i !== idx),
        }));
    }

    function updateFilter(idx: number, key: keyof FilterRule, value: string) {
        setForm(prev => ({
            ...prev,
            filterRules: prev.filterRules.map((f, i) => i === idx ? { ...f, [key]: value } : f),
        }));
    }

    async function handlePreview() {
        if (!activeTenantId) return;
        try {
            const res = await api.createSegment(activeTenantId, {
                ...form,
                preview: true,
            });
            if (res.success && res.data) {
                setPreviewCount((res.data as any).count ?? 0);
            }
        } catch {
            showToast("Error al obtener vista previa");
        }
    }

    async function handleSave() {
        if (!activeTenantId || !form.name.trim()) return;
        try {
            const res = await api.createSegment(activeTenantId, form);
            if (res.success) {
                showToast("Segmento creado");
                setModalOpen(false);
                loadSegments();
            } else {
                showToast(res.error || "Error al crear segmento");
            }
        } catch {
            showToast("Error de conexion");
        }
    }

    async function viewSegmentContacts(segment: Segment) {
        if (!activeTenantId) return;
        setViewingSegment(segment);
        setContactsLoading(true);
        try {
            const res = await api.getSegmentContacts(activeTenantId, segment.id);
            if (res.success && Array.isArray(res.data)) {
                setContacts(res.data);
            }
        } catch {
            showToast("Error al cargar contactos");
        } finally {
            setContactsLoading(false);
        }
    }

    function formatDate(d: string) {
        try { return new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }); }
        catch { return d; }
    }

    // ── Detail View ──
    if (viewingSegment) {
        return (
            <div style={{ padding: 32, maxWidth: 1100, margin: "0 auto" }}>
                {toast && (
                    <div style={{
                        position: "fixed", top: 24, right: 24, zIndex: 9999,
                        background: toast.includes("Error") ? "#ff4757" : "#00d68f",
                        color: "#fff", padding: "12px 24px", borderRadius: 10,
                        fontSize: 14, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                    }}>
                        {toast}
                    </div>
                )}

                <button
                    onClick={() => { setViewingSegment(null); setContacts([]); }}
                    style={{
                        display: "flex", alignItems: "center", gap: 6,
                        background: "transparent", border: "none",
                        color: "#6c5ce7", cursor: "pointer", fontSize: 14, fontWeight: 600,
                        marginBottom: 20, padding: 0,
                    }}
                >
                    <ArrowLeft size={16} /> Volver a segmentos
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: "rgba(108, 92, 231, 0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <Users size={22} color="#6c5ce7" />
                    </div>
                    <div>
                        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e8e8f0", margin: 0 }}>
                            {viewingSegment.name}
                        </h1>
                        <p style={{ fontSize: 13, color: "#9898b0", margin: 0 }}>
                            {viewingSegment.description || "Sin descripcion"}
                        </p>
                    </div>
                    <span style={{
                        marginLeft: "auto", padding: "4px 14px", borderRadius: 20,
                        background: "rgba(108, 92, 231, 0.12)", color: "#6c5ce7",
                        fontSize: 13, fontWeight: 700,
                    }}>
                        {contacts.length} contactos
                    </span>
                </div>

                <div style={{
                    background: "#1a1a2e", borderRadius: 14,
                    border: "1px solid #2a2a45", overflow: "hidden",
                }}>
                    {contactsLoading ? (
                        <div style={{ padding: 40, textAlign: "center", color: "#9898b0" }}>Cargando contactos...</div>
                    ) : contacts.length === 0 ? (
                        <div style={{ padding: 40, textAlign: "center", color: "#9898b0" }}>
                            No se encontraron contactos
                        </div>
                    ) : (
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr style={{ borderBottom: "1px solid #2a2a45" }}>
                                    {["Nombre", "Telefono", "Email", "Etapa", "Score"].map(h => (
                                        <th key={h} style={{
                                            padding: "12px 16px", textAlign: "left",
                                            fontSize: 11, fontWeight: 700, color: "#9898b0",
                                            textTransform: "uppercase", letterSpacing: 0.5,
                                        }}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {contacts.map(c => (
                                    <tr key={c.id} style={{ borderBottom: "1px solid #2a2a45" }}>
                                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#e8e8f0", fontWeight: 600 }}>{c.name || "—"}</td>
                                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#9898b0" }}>{c.phone || "—"}</td>
                                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#9898b0" }}>{c.email || "—"}</td>
                                        <td style={{ padding: "12px 16px" }}>
                                            <span style={{
                                                padding: "3px 10px", borderRadius: 6,
                                                background: "rgba(108, 92, 231, 0.12)", color: "#6c5ce7",
                                                fontSize: 12, fontWeight: 600,
                                            }}>
                                                {c.stage || "—"}
                                            </span>
                                        </td>
                                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#e8e8f0", fontWeight: 700 }}>{c.score ?? "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        );
    }

    // ── Main List ──
    return (
        <div style={{ padding: 32, maxWidth: 1100, margin: "0 auto" }}>
            {/* Toast */}
            {toast && (
                <div style={{
                    position: "fixed", top: 24, right: 24, zIndex: 9999,
                    background: toast.includes("Error") ? "#ff4757" : "#00d68f",
                    color: "#fff", padding: "12px 24px", borderRadius: 10,
                    fontSize: 14, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                }}>
                    {toast}
                </div>
            )}

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: "rgba(108, 92, 231, 0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <Users size={22} color="#6c5ce7" />
                    </div>
                    <div>
                        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e8e8f0", margin: 0 }}>
                            Segmentos
                        </h1>
                        <p style={{ fontSize: 13, color: "#9898b0", margin: 0 }}>
                            Agrupa contactos con filtros dinamicos
                        </p>
                    </div>
                </div>
                <button
                    onClick={openCreate}
                    style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "10px 20px", borderRadius: 10,
                        background: "#6c5ce7", color: "#fff",
                        border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600,
                    }}
                >
                    <Plus size={16} /> Nuevo Segmento
                </button>
            </div>

            {/* Segments list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {loading ? (
                    <div style={{ padding: 40, textAlign: "center", color: "#9898b0" }}>Cargando...</div>
                ) : segments.length === 0 ? (
                    <div style={{
                        padding: 48, textAlign: "center",
                        background: "#1a1a2e", borderRadius: 14, border: "1px solid #2a2a45",
                    }}>
                        <Users size={36} style={{ color: "#9898b0", opacity: 0.4, marginBottom: 12 }} />
                        <p style={{ color: "#9898b0", fontSize: 14 }}>No hay segmentos creados</p>
                    </div>
                ) : (
                    segments.map(seg => (
                        <div
                            key={seg.id}
                            onClick={() => viewSegmentContacts(seg)}
                            style={{
                                background: "#1a1a2e", borderRadius: 14,
                                border: "1px solid #2a2a45", padding: "18px 22px",
                                cursor: "pointer", transition: "border-color 0.2s",
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(108,92,231,0.4)")}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = "#2a2a45")}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                <div style={{
                                    width: 38, height: 38, borderRadius: 10,
                                    background: "rgba(108, 92, 231, 0.1)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                }}>
                                    <Filter size={18} color="#6c5ce7" />
                                </div>
                                <div>
                                    <div style={{ fontSize: 15, fontWeight: 700, color: "#e8e8f0" }}>{seg.name}</div>
                                    <div style={{ fontSize: 12, color: "#9898b0", marginTop: 2 }}>
                                        {seg.description || "Sin descripcion"}
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                                <span style={{
                                    padding: "4px 14px", borderRadius: 20,
                                    background: "rgba(0, 214, 143, 0.12)", color: "#00d68f",
                                    fontSize: 13, fontWeight: 700,
                                }}>
                                    {seg.contact_count ?? 0} contactos
                                </span>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#9898b0", fontSize: 12 }}>
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
                <div style={{
                    position: "fixed", inset: 0, zIndex: 1000,
                    background: "rgba(0,0,0,0.6)", display: "flex",
                    alignItems: "center", justifyContent: "center",
                }} onClick={() => setModalOpen(false)}>
                    <div
                        style={{
                            background: "#12121e", borderRadius: 16,
                            border: "1px solid #2a2a45", padding: 28,
                            width: 560, maxHeight: "85vh", overflowY: "auto",
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#e8e8f0", margin: 0 }}>
                                Nuevo Segmento
                            </h2>
                            <button onClick={() => setModalOpen(false)} style={{
                                background: "transparent", border: "none", color: "#9898b0", cursor: "pointer",
                            }}>
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            {/* Name */}
                            <div>
                                <label style={labelStyle}>Nombre *</label>
                                <input
                                    value={form.name}
                                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="Ej: Leads calientes"
                                    style={inputStyle}
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label style={labelStyle}>Descripcion</label>
                                <input
                                    value={form.description}
                                    onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="Descripcion opcional del segmento"
                                    style={inputStyle}
                                />
                            </div>

                            {/* Filter builder */}
                            <div>
                                <label style={labelStyle}>Filtros</label>
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    {form.filterRules.map((rule, idx) => (
                                        <div key={idx} style={{
                                            display: "flex", gap: 8, alignItems: "center",
                                            background: "#0a0a12", borderRadius: 10,
                                            border: "1px solid #2a2a45", padding: "10px 12px",
                                        }}>
                                            <select
                                                value={rule.field}
                                                onChange={e => updateFilter(idx, "field", e.target.value)}
                                                style={{ ...selectStyle, width: "30%" }}
                                            >
                                                {FIELDS.map(f => (
                                                    <option key={f.value} value={f.value}>{f.label}</option>
                                                ))}
                                            </select>
                                            <select
                                                value={rule.operator}
                                                onChange={e => updateFilter(idx, "operator", e.target.value)}
                                                style={{ ...selectStyle, width: "30%" }}
                                            >
                                                {OPERATORS.map(o => (
                                                    <option key={o.value} value={o.value}>{o.label}</option>
                                                ))}
                                            </select>
                                            <input
                                                value={rule.value}
                                                onChange={e => updateFilter(idx, "value", e.target.value)}
                                                placeholder={rule.operator === "in" ? "val1, val2, val3" : "Valor"}
                                                style={{ ...inputStyle, width: "30%" }}
                                            />
                                            <button
                                                onClick={() => removeFilter(idx)}
                                                style={{
                                                    width: 30, height: 30, borderRadius: 6,
                                                    background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.2)",
                                                    color: "#ff4757", cursor: "pointer",
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                    flexShrink: 0,
                                                }}
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <button
                                    onClick={addFilter}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 6,
                                        marginTop: 10, padding: "8px 14px", borderRadius: 8,
                                        background: "transparent", border: "1px dashed #2a2a45",
                                        color: "#6c5ce7", cursor: "pointer", fontSize: 13, fontWeight: 600,
                                    }}
                                >
                                    <Plus size={14} /> Agregar filtro
                                </button>
                            </div>

                            {/* Preview */}
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <button
                                    onClick={handlePreview}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 6,
                                        padding: "8px 16px", borderRadius: 8,
                                        background: "rgba(108, 92, 231, 0.1)", border: "1px solid rgba(108, 92, 231, 0.3)",
                                        color: "#6c5ce7", cursor: "pointer", fontSize: 13, fontWeight: 600,
                                    }}
                                >
                                    <Eye size={14} /> Vista previa
                                </button>
                                {previewCount !== null && (
                                    <span style={{ fontSize: 13, color: "#00d68f", fontWeight: 600 }}>
                                        {previewCount} contactos coinciden
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
                            <button
                                onClick={() => setModalOpen(false)}
                                style={{
                                    padding: "10px 20px", borderRadius: 8,
                                    background: "transparent", border: "1px solid #2a2a45",
                                    color: "#9898b0", cursor: "pointer", fontSize: 14,
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSave}
                                style={{
                                    padding: "10px 20px", borderRadius: 8,
                                    background: "#6c5ce7", border: "none",
                                    color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
                                }}
                            >
                                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <Check size={16} /> Crear Segmento
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
