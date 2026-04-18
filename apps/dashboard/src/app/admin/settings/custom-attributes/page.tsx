"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { Database, Plus, Pencil, Trash2, X, Check, AlertCircle } from "lucide-react";

interface CustomAttribute { id: string; entity_type: string; attribute_key: string; label: string; data_type: string; is_required: boolean; options: string[] | null; }

const ENTITY_TYPES = [{ value: "contact", label: "Contacto" }, { value: "lead", label: "Lead" }, { value: "company", label: "Empresa" }, { value: "conversation", label: "Conversacion" }];
const DATA_TYPES = [{ value: "text", label: "Texto" }, { value: "number", label: "Numero" }, { value: "date", label: "Date" }, { value: "boolean", label: "Booleano" }, { value: "list", label: "Lista" }, { value: "url", label: "URL" }];

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border";
const labelCls = "block text-xs font-semibold text-muted-foreground mb-1";

function toSnakeCase(str: string): string { return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
const emptyForm = () => ({ entity_type: "contact", attribute_key: "", label: "", data_type: "text", options: "", is_required: false });

export default function CustomAttributesPage() {
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [attributes, setAttributes] = useState<CustomAttribute[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("contact");
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(emptyForm());

    useEffect(() => { loadAttributes(); }, [activeTenantId, activeTab]);

    async function loadAttributes() { if (!activeTenantId) return; setLoading(true); try { const res = await api.getCustomAttributes(activeTenantId, activeTab); if (res.success && Array.isArray(res.data)) setAttributes(res.data); } catch (err) { console.error(err); } finally { setLoading(false); } }
    function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }
    function openCreate() { setEditingId(null); setForm(emptyForm()); setModalOpen(true); }
    function openEdit(attr: CustomAttribute) { setEditingId(attr.id); setForm({ entity_type: attr.entity_type, attribute_key: attr.attribute_key, label: attr.label, data_type: attr.data_type, options: attr.options ? attr.options.join(", ") : "", is_required: attr.is_required }); setModalOpen(true); }
    function handleLabelChange(val: string) { setForm(prev => ({ ...prev, label: val, attribute_key: editingId ? prev.attribute_key : toSnakeCase(val) })); }

    async function handleSave() {
        if (!activeTenantId || !form.label.trim()) return;
        const payload: any = { entity_type: form.entity_type, attribute_key: form.attribute_key || toSnakeCase(form.label), label: form.label, data_type: form.data_type, is_required: form.is_required, options: form.data_type === "list" ? form.options.split(",").map(o => o.trim()).filter(Boolean) : null };
        try {
            const res = editingId ? await api.updateCustomAttribute(activeTenantId, editingId, payload) : await api.createCustomAttribute(activeTenantId, payload);
            if (res.success) { showToast(editingId ? "Atributo actualizado" : "Atributo creado"); setModalOpen(false); loadAttributes(); } else { showToast(res.error || tc("errorSaving")); }
        } catch { showToast(tc("connectionError")); }
    }

    async function handleDelete(id: string) { if (!activeTenantId) return; if (!confirm(tc("deleteConfirm"))) return; try { await api.fetch(`/crm/custom-attributes/${activeTenantId}/${id}`, { method: "DELETE" }); showToast(tc("success")); loadAttributes(); } catch { showToast(tc("errorSaving")); } }

    return (
        <div className="p-8 max-w-[1100px] mx-auto">
            {toast && <div className={cn("fixed top-6 right-6 z-[9999] text-white px-6 py-3 rounded-[10px] text-sm font-semibold shadow-lg", toast.includes("Error") ? "bg-destructive" : "bg-[var(--success)]")}>{toast}</div>}

            <div className="flex justify-between items-center mb-7">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center"><Database size={22} className="text-primary" /></div>
                    <div>
                        <h1 className="text-[22px] font-semibold text-foreground m-0">Atributos Personalizados</h1>
                        <p className="text-[13px] text-muted-foreground m-0">Define campos adicionales para tus entidades</p>
                    </div>
                </div>
                <button onClick={openCreate} className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold"><Plus size={16} /> Nuevo Atributo</button>
            </div>

            <div className="flex gap-2 mb-6">
                {ENTITY_TYPES.map(et => (
                    <button key={et.value} onClick={() => setActiveTab(et.value)} className={cn("px-[18px] py-2 rounded-lg font-semibold text-[13px] cursor-pointer", activeTab === et.value ? "bg-primary/20 text-primary border border-primary/40" : "bg-transparent text-muted-foreground border border-border")}>{et.label}</button>
                ))}
            </div>

            <div className="bg-card rounded-[14px] border border-border overflow-hidden">
                {loading ? <div className="p-10 text-center text-muted-foreground">Cargando...</div>
                    : attributes.length === 0 ? <div className="p-10 text-center text-muted-foreground"><Database size={32} className="mb-2 opacity-40" /><p>No hay atributos para esta entidad</p></div>
                        : (
                            <table className="w-full border-collapse">
                                <thead><tr className="border-b border-border">{["Clave", "Etiqueta", "Tipo", "Requerido", "Opciones", "Acciones"].map(h => <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>)}</tr></thead>
                                <tbody>
                                    {attributes.map(attr => (
                                        <tr key={attr.id} className="border-b border-border">
                                            <td className="px-4 py-3 text-[13px] text-foreground font-mono">{attr.attribute_key}</td>
                                            <td className="px-4 py-3 text-[13px] text-foreground font-semibold">{attr.label}</td>
                                            <td className="px-4 py-3"><span className="px-2.5 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-semibold">{DATA_TYPES.find(d => d.value === attr.data_type)?.label || attr.data_type}</span></td>
                                            <td className="px-4 py-3">{attr.is_required ? <span className="px-2.5 py-0.5 rounded-md bg-[var(--success)]/10 text-[var(--success)] text-xs font-semibold">Si</span> : <span className="text-xs text-muted-foreground">No</span>}</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">{attr.options && attr.options.length > 0 ? attr.options.join(", ") : "—"}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex gap-1.5">
                                                    <button onClick={() => openEdit(attr)} className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 text-primary cursor-pointer flex items-center justify-center"><Pencil size={14} /></button>
                                                    <button onClick={() => handleDelete(attr.id)} className="w-8 h-8 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive cursor-pointer flex items-center justify-center"><Trash2 size={14} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
            </div>

            {modalOpen && (
                <div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center" onClick={() => setModalOpen(false)}>
                    <div className="bg-secondary rounded-xl border border-border p-7 w-[480px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-lg font-semibold text-foreground m-0">{editingId ? tc("edit") : tc("create")}</h2>
                            <button onClick={() => setModalOpen(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={18} /></button>
                        </div>
                        <div className="flex flex-col gap-4">
                            <div><label className={labelCls}>Tipo de entidad</label><select value={form.entity_type} onChange={e => setForm(prev => ({ ...prev, entity_type: e.target.value }))} className={inputCls}>{ENTITY_TYPES.map(et => <option key={et.value} value={et.value}>{et.label}</option>)}</select></div>
                            <div><label className={labelCls}>Etiqueta *</label><input value={form.label} onChange={e => handleLabelChange(e.target.value)} placeholder="Ej: Fecha de cumpleanos" className={inputCls} /></div>
                            <div><label className={labelCls}>Clave (auto-generada)</label><input value={form.attribute_key} onChange={e => setForm(prev => ({ ...prev, attribute_key: e.target.value }))} placeholder="fecha_de_cumpleanos" className={cn(inputCls, "font-mono text-muted-foreground")} /></div>
                            <div><label className={labelCls}>Tipo de dato</label><select value={form.data_type} onChange={e => setForm(prev => ({ ...prev, data_type: e.target.value }))} className={inputCls}>{DATA_TYPES.map(dt => <option key={dt.value} value={dt.value}>{dt.label}</option>)}</select></div>
                            {form.data_type === "list" && <div><label className={labelCls}>Opciones (separadas por coma)</label><textarea value={form.options} onChange={e => setForm(prev => ({ ...prev, options: e.target.value }))} placeholder="opcion1, opcion2, opcion3" rows={3} className={cn(inputCls, "resize-y")} /></div>}
                            <div className="flex items-center gap-3">
                                <button onClick={() => setForm(prev => ({ ...prev, is_required: !prev.is_required }))} className="w-11 h-6 rounded-xl border-none cursor-pointer relative transition-colors duration-200" style={{ background: form.is_required ? "var(--accent-hex)" : "var(--border)" }}>
                                    <div className="w-[18px] h-[18px] rounded-full bg-white absolute top-[3px] transition-[left] duration-200" style={{ left: form.is_required ? 23 : 3 }} />
                                </button>
                                <span className="text-[13px] text-foreground">Campo requerido</span>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2.5 mt-6">
                            <button onClick={() => setModalOpen(false)} className="px-5 py-2.5 rounded-lg bg-transparent border border-border text-muted-foreground cursor-pointer text-sm">Cancelar</button>
                            <button onClick={handleSave} className="px-5 py-2.5 rounded-lg bg-primary border-none text-white cursor-pointer text-sm font-semibold"><span className="flex items-center gap-1.5"><Check size={16} /> {editingId ? tc("saveChanges") : "Crear"}</span></button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
