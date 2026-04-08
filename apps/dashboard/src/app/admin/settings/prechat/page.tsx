"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { MessageSquare, Plus, Trash2, X, Check, Save, GripVertical, Eye, Smartphone } from "lucide-react";

interface PrechatField { key: string; label: string; type: string; required: boolean; options: string; map_to: string; }
interface PrechatConfig { is_active: boolean; greeting_message: string; fields: PrechatField[]; }

const FIELD_TYPES = [{ value: "text", label: "Texto" }, { value: "email", label: "Email" }, { value: "phone", label: "Telefono" }, { value: "select", label: "Seleccion" }];
const MAP_TO_OPTIONS = [{ value: "contact.name", label: "Nombre del contacto" }, { value: "contact.email", label: "Email del contacto" }, { value: "contact.phone", label: "Telefono del contacto" }, { value: "lead.stage", label: "Etapa del lead" }, { value: "metadata", label: "Metadata personalizada" }];

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border";
const labelCls = "block text-xs font-semibold text-muted-foreground mb-1";

function toSnakeCase(str: string): string { return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
const defaultConfig = (): PrechatConfig => ({ is_active: false, greeting_message: "Hola! Antes de comenzar, necesitamos algunos datos.", fields: [] });
const emptyField = (): PrechatField => ({ key: "", label: "", type: "text", required: false, options: "", map_to: "metadata" });

export default function PrechatPage() {
    const { activeTenantId } = useTenant();
    const [config, setConfig] = useState<PrechatConfig>(defaultConfig());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    useEffect(() => { loadConfig(); }, [activeTenantId]);

    async function loadConfig() {
        if (!activeTenantId) return; setLoading(true);
        try {
            const res = await api.fetch(`/conversations/prechat-form/${activeTenantId}`);
            if (res.success && res.data) {
                const d = res.data;
                setConfig({ is_active: d.is_active ?? false, greeting_message: d.greeting_message || "", fields: Array.isArray(d.fields) ? d.fields.map((f: any) => ({ key: f.key || "", label: f.label || "", type: f.type || "text", required: f.required ?? false, options: Array.isArray(f.options) ? f.options.join(", ") : (f.options || ""), map_to: f.map_to || "metadata" })) : [] });
            }
        } catch { } finally { setLoading(false); }
    }

    function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }
    function addField() { setConfig(prev => ({ ...prev, fields: [...prev.fields, emptyField()] })); }
    function removeField(idx: number) { setConfig(prev => ({ ...prev, fields: prev.fields.filter((_, i) => i !== idx) })); }
    function updateField(idx: number, key: keyof PrechatField, value: any) { setConfig(prev => ({ ...prev, fields: prev.fields.map((f, i) => { if (i !== idx) return f; const updated = { ...f, [key]: value }; if (key === "label") updated.key = toSnakeCase(value as string); return updated; }) })); }

    async function handleSave() {
        if (!activeTenantId) return; setSaving(true);
        try {
            const payload = { is_active: config.is_active, greeting_message: config.greeting_message, fields: config.fields.map(f => ({ key: f.key || toSnakeCase(f.label), label: f.label, type: f.type, required: f.required, options: f.type === "select" ? f.options.split(",").map(o => o.trim()).filter(Boolean) : [], map_to: f.map_to === "metadata" ? `metadata.${f.key || toSnakeCase(f.label)}` : f.map_to })) };
            const res = await api.fetch(`/conversations/prechat-form/${activeTenantId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            if (res.success) showToast("Configuracion guardada"); else showToast("Error al guardar");
        } catch { showToast("Error de conexion"); } finally { setSaving(false); }
    }

    if (loading) return <div className="p-8 text-center text-muted-foreground">Cargando...</div>;

    return (
        <div className="p-8 max-w-[1100px] mx-auto">
            {toast && <div className={cn("fixed top-6 right-6 z-[9999] text-white px-6 py-3 rounded-[10px] text-sm font-semibold shadow-lg", toast.includes("Error") ? "bg-destructive" : "bg-[var(--success)]")}>{toast}</div>}

            <div className="flex justify-between items-center mb-7">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center"><MessageSquare size={22} className="text-primary" /></div>
                    <div><h1 className="text-[22px] font-bold text-foreground m-0">Formulario Pre-Chat</h1><p className="text-[13px] text-muted-foreground m-0">Recopila informacion del cliente antes de la primera respuesta del agente</p></div>
                </div>
                <button onClick={handleSave} disabled={saving} className={cn("flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold", saving && "opacity-60 cursor-not-allowed")}>
                    <Save size={16} /> {saving ? "Guardando..." : "Guardar"}
                </button>
            </div>

            <div className="grid grid-cols-[1fr_360px] gap-6">
                <div className="flex flex-col gap-5">
                    {/* Active toggle */}
                    <div className="bg-card rounded-[14px] border border-border px-[22px] py-[18px] flex items-center justify-between">
                        <div>
                            <div className="text-[15px] font-bold text-foreground">Formulario activo</div>
                            <div className="text-xs text-muted-foreground mt-0.5">Activa para recopilar datos antes de la conversacion</div>
                        </div>
                        <button onClick={() => setConfig(prev => ({ ...prev, is_active: !prev.is_active }))} className="w-12 h-[26px] rounded-[13px] border-none cursor-pointer relative transition-colors duration-200" style={{ background: config.is_active ? "var(--accent-hex)" : "var(--border)" }}>
                            <div className="w-5 h-5 rounded-full bg-white absolute top-[3px] transition-[left] duration-200" style={{ left: config.is_active ? 25 : 3 }} />
                        </button>
                    </div>

                    {/* Greeting */}
                    <div className="bg-card rounded-[14px] border border-border px-[22px] py-[18px]">
                        <label className={labelCls}>Mensaje de bienvenida</label>
                        <textarea value={config.greeting_message} onChange={e => setConfig(prev => ({ ...prev, greeting_message: e.target.value }))} placeholder="Hola! Antes de comenzar..." rows={3} className={cn(inputCls, "resize-y")} />
                    </div>

                    {/* Fields builder */}
                    <div className="bg-card rounded-[14px] border border-border px-[22px] py-[18px]">
                        <div className="flex justify-between items-center mb-4">
                            <label className={cn(labelCls, "mb-0 text-sm")}>Campos del formulario</label>
                            <span className="text-xs text-muted-foreground">{config.fields.length} campos</span>
                        </div>
                        <div className="flex flex-col gap-3.5">
                            {config.fields.map((field, idx) => (
                                <div key={idx} className="bg-background rounded-xl border border-border p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <GripVertical size={14} className="text-muted-foreground opacity-50" />
                                            <span className="text-xs text-muted-foreground font-semibold">Campo {idx + 1}</span>
                                            {field.key && <span className="text-[11px] text-primary font-mono bg-primary/[0.08] px-2 py-0.5 rounded">{field.key}</span>}
                                        </div>
                                        <button onClick={() => removeField(idx)} className="w-[26px] h-[26px] rounded-md bg-destructive/10 border border-destructive/20 text-destructive cursor-pointer flex items-center justify-center"><X size={12} /></button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                                        <div><label className={labelCls}>Etiqueta *</label><input value={field.label} onChange={e => updateField(idx, "label", e.target.value)} placeholder="Ej: Nombre completo" className={inputCls} /></div>
                                        <div><label className={labelCls}>Tipo</label><select value={field.type} onChange={e => updateField(idx, "type", e.target.value)} className={inputCls}>{FIELD_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}</select></div>
                                    </div>
                                    {field.type === "select" && <div className="mb-2.5"><label className={labelCls}>Opciones (separadas por coma)</label><input value={field.options} onChange={e => updateField(idx, "options", e.target.value)} placeholder="opcion1, opcion2, opcion3" className={inputCls} /></div>}
                                    <div className="grid grid-cols-[1fr_auto] gap-2.5 items-end">
                                        <div><label className={labelCls}>Mapear a</label><select value={field.map_to.startsWith("metadata") ? "metadata" : field.map_to} onChange={e => updateField(idx, "map_to", e.target.value)} className={inputCls}>{MAP_TO_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
                                        <div className="flex items-center gap-2 pb-1">
                                            <button onClick={() => updateField(idx, "required", !field.required)} className="w-10 h-[22px] rounded-[11px] border-none cursor-pointer relative transition-colors duration-200" style={{ background: field.required ? "var(--accent-hex)" : "var(--border)" }}>
                                                <div className="w-4 h-4 rounded-full bg-white absolute top-[3px] transition-[left] duration-200" style={{ left: field.required ? 21 : 3 }} />
                                            </button>
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">Requerido</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button onClick={addField} className="flex items-center gap-1.5 mt-3.5 px-4 py-2.5 rounded-lg bg-transparent border border-dashed border-border text-primary cursor-pointer text-[13px] font-semibold w-full justify-center">
                            <Plus size={14} /> Agregar campo
                        </button>
                    </div>
                </div>

                {/* Preview */}
                <div className="sticky top-8 h-fit">
                    <div className="bg-card rounded-[14px] border border-border px-[22px] py-[18px]">
                        <div className="flex items-center gap-2 mb-4">
                            <Smartphone size={16} className="text-primary" />
                            <span className="text-sm font-bold text-foreground">Vista previa WhatsApp</span>
                        </div>
                        <div className="bg-[#0b141a] rounded-xl p-3.5 min-h-[300px]">
                            {config.greeting_message && (
                                <div className="bg-[#005c4b] rounded-[10px_10px_10px_0] px-3 py-2 mb-2 max-w-[85%]">
                                    <p className="text-[13px] text-[#e9edef] m-0 leading-snug">{config.greeting_message}</p>
                                    <span className="text-[10px] text-[#e9edef]/50 float-right mt-1">12:00</span>
                                </div>
                            )}
                            {config.fields.length > 0 ? config.fields.map((field, idx) => (
                                <div key={idx} className="mb-2">
                                    <div className="bg-[#005c4b] rounded-[10px_10px_10px_0] px-3 py-2 max-w-[85%] mb-1">
                                        <p className="text-[13px] text-[#e9edef] m-0">{field.label || `Pregunta ${idx + 1}`}{field.required && <span className="text-red-400"> *</span>}</p>
                                        {field.type === "select" && field.options && (
                                            <div className="mt-1.5">{field.options.split(",").map((opt, oi) => <div key={oi} className="text-xs text-[#e9edef]/70 py-0.5">{oi + 1}. {opt.trim()}</div>)}</div>
                                        )}
                                        <span className="text-[10px] text-[#e9edef]/50 float-right mt-1">12:{String(idx + 1).padStart(2, "0")}</span>
                                    </div>
                                    <div className="bg-[#1d282f] rounded-[10px_10px_0_10px] px-3 py-2 max-w-[70%] ml-auto">
                                        <p className="text-[13px] text-[#e9edef]/40 m-0 italic">
                                            {field.type === "email" ? "cliente@email.com" : field.type === "phone" ? "+57 300 123 4567" : field.type === "select" ? (field.options.split(",")[0]?.trim() || "...") : "Respuesta del cliente..."}
                                        </p>
                                    </div>
                                </div>
                            )) : (
                                <div className="text-center py-10 px-5 text-[#e9edef]/30 text-[13px]">Agrega campos para ver la vista previa</div>
                            )}
                        </div>
                        {!config.is_active && (
                            <div className="mt-3 px-3 py-2 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/20 text-xs text-[var(--warning)] text-center">Formulario desactivado</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
