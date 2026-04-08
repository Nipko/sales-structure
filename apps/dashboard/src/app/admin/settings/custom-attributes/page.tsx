"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import {
    Database,
    Plus,
    Pencil,
    Trash2,
    X,
    Check,
    AlertCircle,
} from "lucide-react";

// ── Types ──
interface CustomAttribute {
    id: string;
    entity_type: string;
    attribute_key: string;
    label: string;
    data_type: string;
    is_required: boolean;
    options: string[] | null;
}

const ENTITY_TYPES = [
    { value: "contact", label: "Contacto" },
    { value: "lead", label: "Lead" },
    { value: "company", label: "Empresa" },
    { value: "conversation", label: "Conversacion" },
];

const DATA_TYPES = [
    { value: "text", label: "Texto" },
    { value: "number", label: "Numero" },
    { value: "date", label: "Fecha" },
    { value: "boolean", label: "Booleano" },
    { value: "list", label: "Lista" },
    { value: "url", label: "URL" },
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

function toSnakeCase(str: string): string {
    return str
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
}

const emptyForm = () => ({
    entity_type: "contact",
    attribute_key: "",
    label: "",
    data_type: "text",
    options: "",
    is_required: false,
});

export default function CustomAttributesPage() {
    const { activeTenantId } = useTenant();

    const [attributes, setAttributes] = useState<CustomAttribute[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("contact");

    // Modal
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(emptyForm());

    useEffect(() => { loadAttributes(); }, [activeTenantId, activeTab]);

    async function loadAttributes() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res = await api.getCustomAttributes(activeTenantId, activeTab);
            if (res.success && Array.isArray(res.data)) {
                setAttributes(res.data);
            }
        } catch (err) {
            console.error("Error loading attributes", err);
        } finally {
            setLoading(false);
        }
    }

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(null), 2500);
    }

    function openCreate() {
        setEditingId(null);
        setForm(emptyForm());
        setModalOpen(true);
    }

    function openEdit(attr: CustomAttribute) {
        setEditingId(attr.id);
        setForm({
            entity_type: attr.entity_type,
            attribute_key: attr.attribute_key,
            label: attr.label,
            data_type: attr.data_type,
            options: attr.options ? attr.options.join(", ") : "",
            is_required: attr.is_required,
        });
        setModalOpen(true);
    }

    function handleLabelChange(val: string) {
        setForm(prev => ({
            ...prev,
            label: val,
            attribute_key: editingId ? prev.attribute_key : toSnakeCase(val),
        }));
    }

    async function handleSave() {
        if (!activeTenantId || !form.label.trim()) return;
        const payload: any = {
            entity_type: form.entity_type,
            attribute_key: form.attribute_key || toSnakeCase(form.label),
            label: form.label,
            data_type: form.data_type,
            is_required: form.is_required,
            options: form.data_type === "list" ? form.options.split(",").map(o => o.trim()).filter(Boolean) : null,
        };

        try {
            let res;
            if (editingId) {
                res = await api.updateCustomAttribute(activeTenantId, editingId, payload);
            } else {
                res = await api.createCustomAttribute(activeTenantId, payload);
            }
            if (res.success) {
                showToast(editingId ? "Atributo actualizado" : "Atributo creado");
                setModalOpen(false);
                loadAttributes();
            } else {
                showToast(res.error || "Error al guardar");
            }
        } catch {
            showToast("Error de conexion");
        }
    }

    async function handleDelete(id: string) {
        if (!activeTenantId) return;
        if (!confirm("Eliminar este atributo personalizado?")) return;
        try {
            const res = await api.fetch(`/crm/custom-attributes/${activeTenantId}/${id}`, { method: "DELETE" });
            showToast("Atributo eliminado");
            loadAttributes();
        } catch {
            showToast("Error al eliminar");
        }
    }

    const filteredAttributes = attributes;

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
                        <Database size={22} color="#6c5ce7" />
                    </div>
                    <div>
                        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e8e8f0", margin: 0 }}>
                            Atributos Personalizados
                        </h1>
                        <p style={{ fontSize: 13, color: "#9898b0", margin: 0 }}>
                            Define campos adicionales para tus entidades
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
                    <Plus size={16} /> Nuevo Atributo
                </button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                {ENTITY_TYPES.map(et => (
                    <button
                        key={et.value}
                        onClick={() => setActiveTab(et.value)}
                        style={{
                            padding: "8px 18px", borderRadius: 8,
                            background: activeTab === et.value ? "rgba(108, 92, 231, 0.2)" : "transparent",
                            color: activeTab === et.value ? "#6c5ce7" : "#9898b0",
                            border: activeTab === et.value ? "1px solid rgba(108, 92, 231, 0.4)" : "1px solid #2a2a45",
                            cursor: "pointer", fontSize: 13, fontWeight: 600,
                        }}
                    >
                        {et.label}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div style={{
                background: "#1a1a2e", borderRadius: 14,
                border: "1px solid #2a2a45", overflow: "hidden",
            }}>
                {loading ? (
                    <div style={{ padding: 40, textAlign: "center", color: "#9898b0" }}>Cargando...</div>
                ) : filteredAttributes.length === 0 ? (
                    <div style={{ padding: 40, textAlign: "center", color: "#9898b0" }}>
                        <Database size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                        <p>No hay atributos para esta entidad</p>
                    </div>
                ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: "1px solid #2a2a45" }}>
                                {["Clave", "Etiqueta", "Tipo", "Requerido", "Opciones", "Acciones"].map(h => (
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
                            {filteredAttributes.map(attr => (
                                <tr key={attr.id} style={{ borderBottom: "1px solid #2a2a45" }}>
                                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#e8e8f0", fontFamily: "monospace" }}>
                                        {attr.attribute_key}
                                    </td>
                                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#e8e8f0", fontWeight: 600 }}>
                                        {attr.label}
                                    </td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span style={{
                                            padding: "3px 10px", borderRadius: 6,
                                            background: "rgba(108, 92, 231, 0.12)", color: "#6c5ce7",
                                            fontSize: 12, fontWeight: 600,
                                        }}>
                                            {DATA_TYPES.find(d => d.value === attr.data_type)?.label || attr.data_type}
                                        </span>
                                    </td>
                                    <td style={{ padding: "12px 16px" }}>
                                        {attr.is_required ? (
                                            <span style={{
                                                padding: "3px 10px", borderRadius: 6,
                                                background: "rgba(0, 214, 143, 0.12)", color: "#00d68f",
                                                fontSize: 12, fontWeight: 600,
                                            }}>
                                                Si
                                            </span>
                                        ) : (
                                            <span style={{ fontSize: 12, color: "#9898b0" }}>No</span>
                                        )}
                                    </td>
                                    <td style={{ padding: "12px 16px", fontSize: 12, color: "#9898b0", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {attr.options && attr.options.length > 0 ? attr.options.join(", ") : "—"}
                                    </td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <div style={{ display: "flex", gap: 6 }}>
                                            <button
                                                onClick={() => openEdit(attr)}
                                                style={{
                                                    width: 32, height: 32, borderRadius: 8,
                                                    background: "rgba(108, 92, 231, 0.1)", border: "1px solid rgba(108, 92, 231, 0.2)",
                                                    color: "#6c5ce7", cursor: "pointer",
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                }}
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(attr.id)}
                                                style={{
                                                    width: 32, height: 32, borderRadius: 8,
                                                    background: "rgba(255, 71, 87, 0.1)", border: "1px solid rgba(255, 71, 87, 0.2)",
                                                    color: "#ff4757", cursor: "pointer",
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                }}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Modal */}
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
                            width: 480, maxHeight: "85vh", overflowY: "auto",
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#e8e8f0", margin: 0 }}>
                                {editingId ? "Editar Atributo" : "Nuevo Atributo"}
                            </h2>
                            <button onClick={() => setModalOpen(false)} style={{
                                background: "transparent", border: "none", color: "#9898b0", cursor: "pointer",
                            }}>
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            {/* Entity type */}
                            <div>
                                <label style={labelStyle}>Tipo de entidad</label>
                                <select
                                    value={form.entity_type}
                                    onChange={e => setForm(prev => ({ ...prev, entity_type: e.target.value }))}
                                    style={selectStyle}
                                >
                                    {ENTITY_TYPES.map(et => (
                                        <option key={et.value} value={et.value}>{et.label}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Label */}
                            <div>
                                <label style={labelStyle}>Etiqueta *</label>
                                <input
                                    value={form.label}
                                    onChange={e => handleLabelChange(e.target.value)}
                                    placeholder="Ej: Fecha de cumpleanos"
                                    style={inputStyle}
                                />
                            </div>

                            {/* Key */}
                            <div>
                                <label style={labelStyle}>Clave (auto-generada)</label>
                                <input
                                    value={form.attribute_key}
                                    onChange={e => setForm(prev => ({ ...prev, attribute_key: e.target.value }))}
                                    placeholder="fecha_de_cumpleanos"
                                    style={{ ...inputStyle, fontFamily: "monospace", color: "#9898b0" }}
                                />
                            </div>

                            {/* Data type */}
                            <div>
                                <label style={labelStyle}>Tipo de dato</label>
                                <select
                                    value={form.data_type}
                                    onChange={e => setForm(prev => ({ ...prev, data_type: e.target.value }))}
                                    style={selectStyle}
                                >
                                    {DATA_TYPES.map(dt => (
                                        <option key={dt.value} value={dt.value}>{dt.label}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Options (only for list) */}
                            {form.data_type === "list" && (
                                <div>
                                    <label style={labelStyle}>Opciones (separadas por coma)</label>
                                    <textarea
                                        value={form.options}
                                        onChange={e => setForm(prev => ({ ...prev, options: e.target.value }))}
                                        placeholder="opcion1, opcion2, opcion3"
                                        rows={3}
                                        style={{ ...inputStyle, resize: "vertical" }}
                                    />
                                </div>
                            )}

                            {/* Required toggle */}
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <button
                                    onClick={() => setForm(prev => ({ ...prev, is_required: !prev.is_required }))}
                                    style={{
                                        width: 44, height: 24, borderRadius: 12,
                                        background: form.is_required ? "#6c5ce7" : "#2a2a45",
                                        border: "none", cursor: "pointer", position: "relative",
                                        transition: "background 0.2s",
                                    }}
                                >
                                    <div style={{
                                        width: 18, height: 18, borderRadius: "50%",
                                        background: "#fff", position: "absolute", top: 3,
                                        left: form.is_required ? 23 : 3,
                                        transition: "left 0.2s",
                                    }} />
                                </button>
                                <span style={{ fontSize: 13, color: "#e8e8f0" }}>Campo requerido</span>
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
                                    <Check size={16} /> {editingId ? "Guardar" : "Crear"}
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
