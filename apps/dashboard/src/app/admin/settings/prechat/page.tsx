"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import {
    MessageSquare,
    Plus,
    Trash2,
    X,
    Check,
    Save,
    GripVertical,
    Eye,
    Smartphone,
} from "lucide-react";

// ── Types ──
interface PrechatField {
    key: string;
    label: string;
    type: string;
    required: boolean;
    options: string;
    map_to: string;
}

interface PrechatConfig {
    is_active: boolean;
    greeting_message: string;
    fields: PrechatField[];
}

const FIELD_TYPES = [
    { value: "text", label: "Texto" },
    { value: "email", label: "Email" },
    { value: "phone", label: "Telefono" },
    { value: "select", label: "Seleccion" },
];

const MAP_TO_OPTIONS = [
    { value: "contact.name", label: "Nombre del contacto" },
    { value: "contact.email", label: "Email del contacto" },
    { value: "contact.phone", label: "Telefono del contacto" },
    { value: "lead.stage", label: "Etapa del lead" },
    { value: "metadata", label: "Metadata personalizada" },
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

const defaultConfig = (): PrechatConfig => ({
    is_active: false,
    greeting_message: "Hola! Antes de comenzar, necesitamos algunos datos.",
    fields: [],
});

const emptyField = (): PrechatField => ({
    key: "",
    label: "",
    type: "text",
    required: false,
    options: "",
    map_to: "metadata",
});

export default function PrechatPage() {
    const { activeTenantId } = useTenant();

    const [config, setConfig] = useState<PrechatConfig>(defaultConfig());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    useEffect(() => { loadConfig(); }, [activeTenantId]);

    async function loadConfig() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res = await api.fetch(`/conversations/prechat-form/${activeTenantId}`);
            if (res.success && res.data) {
                const d = res.data;
                setConfig({
                    is_active: d.is_active ?? false,
                    greeting_message: d.greeting_message || "",
                    fields: Array.isArray(d.fields) ? d.fields.map((f: any) => ({
                        key: f.key || "",
                        label: f.label || "",
                        type: f.type || "text",
                        required: f.required ?? false,
                        options: Array.isArray(f.options) ? f.options.join(", ") : (f.options || ""),
                        map_to: f.map_to || "metadata",
                    })) : [],
                });
            }
        } catch {
            // No config yet, use defaults
        } finally {
            setLoading(false);
        }
    }

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(null), 2500);
    }

    function addField() {
        setConfig(prev => ({
            ...prev,
            fields: [...prev.fields, emptyField()],
        }));
    }

    function removeField(idx: number) {
        setConfig(prev => ({
            ...prev,
            fields: prev.fields.filter((_, i) => i !== idx),
        }));
    }

    function updateField(idx: number, key: keyof PrechatField, value: any) {
        setConfig(prev => ({
            ...prev,
            fields: prev.fields.map((f, i) => {
                if (i !== idx) return f;
                const updated = { ...f, [key]: value };
                if (key === "label") {
                    updated.key = toSnakeCase(value as string);
                }
                return updated;
            }),
        }));
    }

    async function handleSave() {
        if (!activeTenantId) return;
        setSaving(true);
        try {
            const payload = {
                is_active: config.is_active,
                greeting_message: config.greeting_message,
                fields: config.fields.map(f => ({
                    key: f.key || toSnakeCase(f.label),
                    label: f.label,
                    type: f.type,
                    required: f.required,
                    options: f.type === "select" ? f.options.split(",").map(o => o.trim()).filter(Boolean) : [],
                    map_to: f.map_to === "metadata" ? `metadata.${f.key || toSnakeCase(f.label)}` : f.map_to,
                })),
            };
            const res = await api.fetch(`/conversations/prechat-form/${activeTenantId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (res.success) {
                showToast("Configuracion guardada");
            } else {
                showToast("Error al guardar");
            }
        } catch {
            showToast("Error de conexion");
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div style={{ padding: 32, textAlign: "center", color: "#9898b0" }}>Cargando...</div>
        );
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
                        <MessageSquare size={22} color="#6c5ce7" />
                    </div>
                    <div>
                        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e8e8f0", margin: 0 }}>
                            Formulario Pre-Chat
                        </h1>
                        <p style={{ fontSize: 13, color: "#9898b0", margin: 0 }}>
                            Recopila informacion del cliente antes de la primera respuesta del agente
                        </p>
                    </div>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "10px 20px", borderRadius: 10,
                        background: "#6c5ce7", color: "#fff",
                        border: "none", cursor: saving ? "not-allowed" : "pointer",
                        fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1,
                    }}
                >
                    <Save size={16} /> {saving ? "Guardando..." : "Guardar"}
                </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24 }}>
                {/* Left: Config */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {/* Active toggle */}
                    <div style={{
                        background: "#1a1a2e", borderRadius: 14,
                        border: "1px solid #2a2a45", padding: "18px 22px",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                        <div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "#e8e8f0" }}>Formulario activo</div>
                            <div style={{ fontSize: 12, color: "#9898b0", marginTop: 2 }}>
                                Activa para recopilar datos antes de la conversacion
                            </div>
                        </div>
                        <button
                            onClick={() => setConfig(prev => ({ ...prev, is_active: !prev.is_active }))}
                            style={{
                                width: 48, height: 26, borderRadius: 13,
                                background: config.is_active ? "#6c5ce7" : "#2a2a45",
                                border: "none", cursor: "pointer", position: "relative",
                                transition: "background 0.2s",
                            }}
                        >
                            <div style={{
                                width: 20, height: 20, borderRadius: "50%",
                                background: "#fff", position: "absolute", top: 3,
                                left: config.is_active ? 25 : 3,
                                transition: "left 0.2s",
                            }} />
                        </button>
                    </div>

                    {/* Greeting message */}
                    <div style={{
                        background: "#1a1a2e", borderRadius: 14,
                        border: "1px solid #2a2a45", padding: "18px 22px",
                    }}>
                        <label style={labelStyle}>Mensaje de bienvenida</label>
                        <textarea
                            value={config.greeting_message}
                            onChange={e => setConfig(prev => ({ ...prev, greeting_message: e.target.value }))}
                            placeholder="Hola! Antes de comenzar..."
                            rows={3}
                            style={{ ...inputStyle, resize: "vertical" }}
                        />
                    </div>

                    {/* Fields builder */}
                    <div style={{
                        background: "#1a1a2e", borderRadius: 14,
                        border: "1px solid #2a2a45", padding: "18px 22px",
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                            <label style={{ ...labelStyle, marginBottom: 0, fontSize: 14 }}>Campos del formulario</label>
                            <span style={{ fontSize: 12, color: "#9898b0" }}>{config.fields.length} campos</span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                            {config.fields.map((field, idx) => (
                                <div key={idx} style={{
                                    background: "#0a0a12", borderRadius: 12,
                                    border: "1px solid #2a2a45", padding: 16,
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <GripVertical size={14} color="#9898b0" style={{ opacity: 0.5 }} />
                                            <span style={{ fontSize: 12, color: "#9898b0", fontWeight: 600 }}>
                                                Campo {idx + 1}
                                            </span>
                                            {field.key && (
                                                <span style={{
                                                    fontSize: 11, color: "#6c5ce7", fontFamily: "monospace",
                                                    background: "rgba(108,92,231,0.08)", padding: "2px 8px",
                                                    borderRadius: 4,
                                                }}>
                                                    {field.key}
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => removeField(idx)}
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

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                                        <div>
                                            <label style={labelStyle}>Etiqueta *</label>
                                            <input
                                                value={field.label}
                                                onChange={e => updateField(idx, "label", e.target.value)}
                                                placeholder="Ej: Nombre completo"
                                                style={inputStyle}
                                            />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Tipo</label>
                                            <select
                                                value={field.type}
                                                onChange={e => updateField(idx, "type", e.target.value)}
                                                style={selectStyle}
                                            >
                                                {FIELD_TYPES.map(ft => (
                                                    <option key={ft.value} value={ft.value}>{ft.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {field.type === "select" && (
                                        <div style={{ marginBottom: 10 }}>
                                            <label style={labelStyle}>Opciones (separadas por coma)</label>
                                            <input
                                                value={field.options}
                                                onChange={e => updateField(idx, "options", e.target.value)}
                                                placeholder="opcion1, opcion2, opcion3"
                                                style={inputStyle}
                                            />
                                        </div>
                                    )}

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                                        <div>
                                            <label style={labelStyle}>Mapear a</label>
                                            <select
                                                value={field.map_to.startsWith("metadata") ? "metadata" : field.map_to}
                                                onChange={e => updateField(idx, "map_to", e.target.value)}
                                                style={selectStyle}
                                            >
                                                {MAP_TO_OPTIONS.map(m => (
                                                    <option key={m.value} value={m.value}>{m.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 4 }}>
                                            <button
                                                onClick={() => updateField(idx, "required", !field.required)}
                                                style={{
                                                    width: 40, height: 22, borderRadius: 11,
                                                    background: field.required ? "#6c5ce7" : "#2a2a45",
                                                    border: "none", cursor: "pointer", position: "relative",
                                                    transition: "background 0.2s",
                                                }}
                                            >
                                                <div style={{
                                                    width: 16, height: 16, borderRadius: "50%",
                                                    background: "#fff", position: "absolute", top: 3,
                                                    left: field.required ? 21 : 3,
                                                    transition: "left 0.2s",
                                                }} />
                                            </button>
                                            <span style={{ fontSize: 12, color: "#9898b0", whiteSpace: "nowrap" }}>Requerido</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <button
                            onClick={addField}
                            style={{
                                display: "flex", alignItems: "center", gap: 6,
                                marginTop: 14, padding: "10px 16px", borderRadius: 8,
                                background: "transparent", border: "1px dashed #2a2a45",
                                color: "#6c5ce7", cursor: "pointer", fontSize: 13, fontWeight: 600,
                                width: "100%", justifyContent: "center",
                            }}
                        >
                            <Plus size={14} /> Agregar campo
                        </button>
                    </div>
                </div>

                {/* Right: Preview */}
                <div style={{ position: "sticky", top: 32, height: "fit-content" }}>
                    <div style={{
                        background: "#1a1a2e", borderRadius: 14,
                        border: "1px solid #2a2a45", padding: "18px 22px",
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                            <Smartphone size={16} color="#6c5ce7" />
                            <span style={{ fontSize: 14, fontWeight: 700, color: "#e8e8f0" }}>Vista previa WhatsApp</span>
                        </div>

                        {/* Mock WhatsApp chat */}
                        <div style={{
                            background: "#0b141a", borderRadius: 12,
                            padding: 14, minHeight: 300,
                            backgroundImage: "url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%230b141a%22 width=%22100%22 height=%22100%22/%3E%3Cg opacity=%220.03%22%3E%3Ccircle cx=%2250%22 cy=%2250%22 r=%222%22 fill=%22%23fff%22/%3E%3C/g%3E%3C/svg%3E')",
                        }}>
                            {/* Greeting */}
                            {config.greeting_message && (
                                <div style={{
                                    background: "#005c4b", borderRadius: "10px 10px 10px 0",
                                    padding: "8px 12px", marginBottom: 8, maxWidth: "85%",
                                }}>
                                    <p style={{ fontSize: 13, color: "#e9edef", margin: 0, lineHeight: 1.4 }}>
                                        {config.greeting_message}
                                    </p>
                                    <span style={{ fontSize: 10, color: "rgba(233,237,239,0.5)", float: "right", marginTop: 4 }}>
                                        12:00
                                    </span>
                                </div>
                            )}

                            {/* Fields as questions */}
                            {config.fields.length > 0 ? (
                                config.fields.map((field, idx) => (
                                    <div key={idx} style={{ marginBottom: 8 }}>
                                        {/* Bot question */}
                                        <div style={{
                                            background: "#005c4b", borderRadius: "10px 10px 10px 0",
                                            padding: "8px 12px", maxWidth: "85%", marginBottom: 4,
                                        }}>
                                            <p style={{ fontSize: 13, color: "#e9edef", margin: 0 }}>
                                                {field.label || `Pregunta ${idx + 1}`}
                                                {field.required && <span style={{ color: "#ff6b6b" }}> *</span>}
                                            </p>
                                            {field.type === "select" && field.options && (
                                                <div style={{ marginTop: 6 }}>
                                                    {field.options.split(",").map((opt, oi) => (
                                                        <div key={oi} style={{
                                                            fontSize: 12, color: "rgba(233,237,239,0.7)",
                                                            padding: "2px 0",
                                                        }}>
                                                            {oi + 1}. {opt.trim()}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            <span style={{ fontSize: 10, color: "rgba(233,237,239,0.5)", float: "right", marginTop: 4 }}>
                                                12:{String(idx + 1).padStart(2, "0")}
                                            </span>
                                        </div>
                                        {/* User response placeholder */}
                                        <div style={{
                                            background: "#1d282f", borderRadius: "10px 10px 0 10px",
                                            padding: "8px 12px", maxWidth: "70%", marginLeft: "auto",
                                        }}>
                                            <p style={{ fontSize: 13, color: "rgba(233,237,239,0.4)", margin: 0, fontStyle: "italic" }}>
                                                {field.type === "email" ? "cliente@email.com"
                                                    : field.type === "phone" ? "+57 300 123 4567"
                                                    : field.type === "select" ? (field.options.split(",")[0]?.trim() || "...")
                                                    : "Respuesta del cliente..."}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div style={{
                                    textAlign: "center", padding: "40px 20px",
                                    color: "rgba(233,237,239,0.3)", fontSize: 13,
                                }}>
                                    Agrega campos para ver la vista previa
                                </div>
                            )}
                        </div>

                        {!config.is_active && (
                            <div style={{
                                marginTop: 12, padding: "8px 12px", borderRadius: 8,
                                background: "rgba(255, 170, 0, 0.1)", border: "1px solid rgba(255, 170, 0, 0.2)",
                                fontSize: 12, color: "#ffaa00", textAlign: "center",
                            }}>
                                Formulario desactivado
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
