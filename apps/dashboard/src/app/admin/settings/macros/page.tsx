"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import {
    Zap,
    Plus,
    Pencil,
    Trash2,
    X,
    Check,
    UserPlus,
    Tag,
    RefreshCw,
    FileText,
    Send,
    Eye,
    EyeOff,
} from "lucide-react";

// ── Types ──
interface Macro {
    id: string;
    name: string;
    description: string;
    actions: MacroAction[];
    visibility: string;
}

interface MacroAction {
    type: string;
    config: Record<string, any>;
}

const ACTION_TYPES = [
    { value: "assign", label: "Asignar a agente", icon: UserPlus },
    { value: "tag", label: "Agregar etiqueta", icon: Tag },
    { value: "change_status", label: "Cambiar estado", icon: RefreshCw },
    { value: "add_note", label: "Agregar nota", icon: FileText },
    { value: "send_canned", label: "Enviar respuesta predefinida", icon: Send },
];

const STATUS_OPTIONS = [
    { value: "active", label: "Activa" },
    { value: "resolved", label: "Resuelta" },
    { value: "waiting_human", label: "Esperando agente" },
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
    visibility: "personal",
    actions: [{ type: "assign", config: {} }] as MacroAction[],
});

export default function MacrosPage() {
    const { activeTenantId } = useTenant();

    const [macros, setMacros] = useState<Macro[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<string | null>(null);

    // Modal
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(emptyForm());

    useEffect(() => { loadMacros(); }, [activeTenantId]);

    async function loadMacros() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res = await api.getMacros(activeTenantId);
            if (res.success && Array.isArray(res.data)) {
                setMacros(res.data);
            }
        } catch (err) {
            console.error("Error loading macros", err);
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

    function openEdit(macro: Macro) {
        setEditingId(macro.id);
        setForm({
            name: macro.name,
            description: macro.description || "",
            visibility: macro.visibility || "personal",
            actions: macro.actions && macro.actions.length > 0
                ? macro.actions
                : [{ type: "assign", config: {} }],
        });
        setModalOpen(true);
    }

    // ── Actions builder ──
    function addAction() {
        setForm(prev => ({
            ...prev,
            actions: [...prev.actions, { type: "assign", config: {} }],
        }));
    }

    function removeAction(idx: number) {
        setForm(prev => ({
            ...prev,
            actions: prev.actions.filter((_, i) => i !== idx),
        }));
    }

    function updateActionType(idx: number, type: string) {
        setForm(prev => ({
            ...prev,
            actions: prev.actions.map((a, i) => i === idx ? { type, config: {} } : a),
        }));
    }

    function updateActionConfig(idx: number, key: string, value: string) {
        setForm(prev => ({
            ...prev,
            actions: prev.actions.map((a, i) =>
                i === idx ? { ...a, config: { ...a.config, [key]: value } } : a
            ),
        }));
    }

    async function handleSave() {
        if (!activeTenantId || !form.name.trim()) return;
        try {
            let res;
            if (editingId) {
                res = await api.updateMacro(activeTenantId, editingId, form);
            } else {
                res = await api.createMacro(activeTenantId, form);
            }
            if (res.success) {
                showToast(editingId ? "Macro actualizada" : "Macro creada");
                setModalOpen(false);
                loadMacros();
            } else {
                showToast(res.error || "Error al guardar");
            }
        } catch {
            showToast("Error de conexion");
        }
    }

    async function handleDelete(id: string) {
        if (!activeTenantId) return;
        if (!confirm("Eliminar esta macro?")) return;
        try {
            await api.fetch(`/agent-console/macros/${activeTenantId}/${id}`, { method: "DELETE" });
            showToast("Macro eliminada");
            loadMacros();
        } catch {
            showToast("Error al eliminar");
        }
    }

    function renderActionConfig(action: MacroAction, idx: number) {
        switch (action.type) {
            case "assign":
                return (
                    <div>
                        <label style={labelStyle}>ID o nombre del agente</label>
                        <input
                            value={action.config.agentId || ""}
                            onChange={e => updateActionConfig(idx, "agentId", e.target.value)}
                            placeholder="agente@empresa.com"
                            style={inputStyle}
                        />
                    </div>
                );
            case "tag":
                return (
                    <div>
                        <label style={labelStyle}>Nombre de la etiqueta</label>
                        <input
                            value={action.config.tagName || ""}
                            onChange={e => updateActionConfig(idx, "tagName", e.target.value)}
                            placeholder="vip, urgente, etc."
                            style={inputStyle}
                        />
                    </div>
                );
            case "change_status":
                return (
                    <div>
                        <label style={labelStyle}>Nuevo estado</label>
                        <select
                            value={action.config.status || "active"}
                            onChange={e => updateActionConfig(idx, "status", e.target.value)}
                            style={selectStyle}
                        >
                            {STATUS_OPTIONS.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                    </div>
                );
            case "add_note":
                return (
                    <div>
                        <label style={labelStyle}>Contenido de la nota</label>
                        <textarea
                            value={action.config.content || ""}
                            onChange={e => updateActionConfig(idx, "content", e.target.value)}
                            placeholder="Nota interna..."
                            rows={2}
                            style={{ ...inputStyle, resize: "vertical" }}
                        />
                    </div>
                );
            case "send_canned":
                return (
                    <div>
                        <label style={labelStyle}>Shortcode de respuesta predefinida</label>
                        <input
                            value={action.config.shortcode || ""}
                            onChange={e => updateActionConfig(idx, "shortcode", e.target.value)}
                            placeholder="/saludo"
                            style={inputStyle}
                        />
                    </div>
                );
            default:
                return null;
        }
    }

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
                        <Zap size={22} color="#6c5ce7" />
                    </div>
                    <div>
                        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e8e8f0", margin: 0 }}>
                            Macros
                        </h1>
                        <p style={{ fontSize: 13, color: "#9898b0", margin: 0 }}>
                            Automatiza acciones repetitivas con un solo clic
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
                    <Plus size={16} /> Nueva Macro
                </button>
            </div>

            {/* Macros list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {loading ? (
                    <div style={{ padding: 40, textAlign: "center", color: "#9898b0" }}>Cargando...</div>
                ) : macros.length === 0 ? (
                    <div style={{
                        padding: 48, textAlign: "center",
                        background: "#1a1a2e", borderRadius: 14, border: "1px solid #2a2a45",
                    }}>
                        <Zap size={36} style={{ color: "#9898b0", opacity: 0.4, marginBottom: 12 }} />
                        <p style={{ color: "#9898b0", fontSize: 14 }}>No hay macros creadas</p>
                    </div>
                ) : (
                    macros.map(macro => (
                        <div
                            key={macro.id}
                            style={{
                                background: "#1a1a2e", borderRadius: 14,
                                border: "1px solid #2a2a45", padding: "18px 22px",
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                <div style={{
                                    width: 38, height: 38, borderRadius: 10,
                                    background: "rgba(108, 92, 231, 0.1)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                }}>
                                    <Zap size={18} color="#6c5ce7" />
                                </div>
                                <div>
                                    <div style={{ fontSize: 15, fontWeight: 700, color: "#e8e8f0" }}>{macro.name}</div>
                                    <div style={{ fontSize: 12, color: "#9898b0", marginTop: 2 }}>
                                        {macro.description || "Sin descripcion"}
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                {/* Action count badge */}
                                <span style={{
                                    padding: "4px 12px", borderRadius: 20,
                                    background: "rgba(108, 92, 231, 0.12)", color: "#6c5ce7",
                                    fontSize: 12, fontWeight: 700,
                                }}>
                                    {macro.actions?.length || 0} acciones
                                </span>
                                {/* Visibility badge */}
                                <span style={{
                                    padding: "4px 12px", borderRadius: 20,
                                    background: macro.visibility === "team"
                                        ? "rgba(0, 214, 143, 0.12)" : "rgba(152, 152, 176, 0.12)",
                                    color: macro.visibility === "team" ? "#00d68f" : "#9898b0",
                                    fontSize: 12, fontWeight: 600,
                                    display: "flex", alignItems: "center", gap: 4,
                                }}>
                                    {macro.visibility === "team" ? <Eye size={12} /> : <EyeOff size={12} />}
                                    {macro.visibility === "team" ? "Equipo" : "Personal"}
                                </span>
                                {/* Edit */}
                                <button
                                    onClick={() => openEdit(macro)}
                                    style={{
                                        width: 32, height: 32, borderRadius: 8,
                                        background: "rgba(108, 92, 231, 0.1)", border: "1px solid rgba(108, 92, 231, 0.2)",
                                        color: "#6c5ce7", cursor: "pointer",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                    }}
                                >
                                    <Pencil size={14} />
                                </button>
                                {/* Delete */}
                                <button
                                    onClick={() => handleDelete(macro.id)}
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
                        </div>
                    ))
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
                            width: 540, maxHeight: "85vh", overflowY: "auto",
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#e8e8f0", margin: 0 }}>
                                {editingId ? "Editar Macro" : "Nueva Macro"}
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
                                    placeholder="Ej: Escalar a supervisor"
                                    style={inputStyle}
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label style={labelStyle}>Descripcion</label>
                                <input
                                    value={form.description}
                                    onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="Descripcion opcional"
                                    style={inputStyle}
                                />
                            </div>

                            {/* Visibility */}
                            <div>
                                <label style={labelStyle}>Visibilidad</label>
                                <select
                                    value={form.visibility}
                                    onChange={e => setForm(prev => ({ ...prev, visibility: e.target.value }))}
                                    style={selectStyle}
                                >
                                    <option value="personal">Personal</option>
                                    <option value="team">Equipo</option>
                                </select>
                            </div>

                            {/* Actions builder */}
                            <div>
                                <label style={labelStyle}>Acciones</label>
                                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                    {form.actions.map((action, idx) => {
                                        const actionDef = ACTION_TYPES.find(a => a.value === action.type);
                                        const Icon = actionDef?.icon || Zap;
                                        return (
                                            <div key={idx} style={{
                                                background: "#0a0a12", borderRadius: 12,
                                                border: "1px solid #2a2a45", padding: 14,
                                            }}>
                                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                        <Icon size={14} color="#6c5ce7" />
                                                        <span style={{ fontSize: 12, color: "#9898b0", fontWeight: 600 }}>
                                                            Accion {idx + 1}
                                                        </span>
                                                    </div>
                                                    <button
                                                        onClick={() => removeAction(idx)}
                                                        style={{
                                                            width: 26, height: 26, borderRadius: 6,
                                                            background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.2)",
                                                            color: "#ff4757", cursor: "pointer",
                                                            display: "flex", alignItems: "center", justifyContent: "center",
                                                        }}
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>

                                                <div style={{ marginBottom: 10 }}>
                                                    <label style={labelStyle}>Tipo</label>
                                                    <select
                                                        value={action.type}
                                                        onChange={e => updateActionType(idx, e.target.value)}
                                                        style={selectStyle}
                                                    >
                                                        {ACTION_TYPES.map(at => (
                                                            <option key={at.value} value={at.value}>{at.label}</option>
                                                        ))}
                                                    </select>
                                                </div>

                                                {renderActionConfig(action, idx)}
                                            </div>
                                        );
                                    })}
                                </div>
                                <button
                                    onClick={addAction}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 6,
                                        marginTop: 10, padding: "8px 14px", borderRadius: 8,
                                        background: "transparent", border: "1px dashed #2a2a45",
                                        color: "#6c5ce7", cursor: "pointer", fontSize: 13, fontWeight: 600,
                                    }}
                                >
                                    <Plus size={14} /> Agregar accion
                                </button>
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
