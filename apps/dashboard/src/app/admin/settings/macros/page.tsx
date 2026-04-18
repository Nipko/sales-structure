"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { Zap, Plus, Pencil, Trash2, X, Check, UserPlus, Tag, RefreshCw, FileText, Send, Eye, EyeOff } from "lucide-react";

interface Macro { id: string; name: string; description: string; actions: MacroAction[]; visibility: string; }
interface MacroAction { type: string; config: Record<string, any>; }

const ACTION_TYPES = [{ value: "assign", label: "Assign to agent", icon: UserPlus }, { value: "tag", label: "Add tag", icon: Tag }, { value: "change_status", label: "Change status", icon: RefreshCw }, { value: "add_note", label: "Add note", icon: FileText }, { value: "send_canned", label: "Send canned response", icon: Send }];
const STATUS_OPTIONS = [{ value: "active", label: "Active" }, { value: "resolved", label: "Resolved" }, { value: "waiting_human", label: "Waiting for agent" }];

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border";
const labelCls = "block text-xs font-semibold text-muted-foreground mb-1";
const emptyForm = () => ({ name: "", description: "", visibility: "personal", actions: [{ type: "assign", config: {} }] as MacroAction[] });

export default function MacrosPage() {
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [macros, setMacros] = useState<Macro[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(emptyForm());

    useEffect(() => { loadMacros(); }, [activeTenantId]);
    async function loadMacros() { if (!activeTenantId) return; setLoading(true); try { const res = await api.getMacros(activeTenantId); if (res.success && Array.isArray(res.data)) setMacros(res.data); } catch (err) { console.error(err); } finally { setLoading(false); } }
    function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }
    function openCreate() { setEditingId(null); setForm(emptyForm()); setModalOpen(true); }
    function openEdit(macro: Macro) { setEditingId(macro.id); setForm({ name: macro.name, description: macro.description || "", visibility: macro.visibility || "personal", actions: macro.actions?.length > 0 ? macro.actions : [{ type: "assign", config: {} }] }); setModalOpen(true); }
    function addAction() { setForm(prev => ({ ...prev, actions: [...prev.actions, { type: "assign", config: {} }] })); }
    function removeAction(idx: number) { setForm(prev => ({ ...prev, actions: prev.actions.filter((_, i) => i !== idx) })); }
    function updateActionType(idx: number, type: string) { setForm(prev => ({ ...prev, actions: prev.actions.map((a, i) => i === idx ? { type, config: {} } : a) })); }
    function updateActionConfig(idx: number, key: string, value: string) { setForm(prev => ({ ...prev, actions: prev.actions.map((a, i) => i === idx ? { ...a, config: { ...a.config, [key]: value } } : a) })); }

    async function handleSave() {
        if (!activeTenantId || !form.name.trim()) return;
        try {
            const res = editingId ? await api.updateMacro(activeTenantId, editingId, form) : await api.createMacro(activeTenantId, form);
            if (res.success) { showToast(editingId ? "Macro updated" : "Macro created"); setModalOpen(false); loadMacros(); } else showToast(res.error || tc("errorSaving"));
        } catch { showToast(tc("connectionError")); }
    }
    async function handleDelete(id: string) { if (!activeTenantId || !confirm(tc("deleteConfirm"))) return; try { await api.fetch(`/agent-console/macros/${activeTenantId}/${id}`, { method: "DELETE" }); showToast(tc("success")); loadMacros(); } catch { showToast(tc("errorSaving")); } }

    function renderActionConfig(action: MacroAction, idx: number) {
        switch (action.type) {
            case "assign": return <div><label className={labelCls}>Agent ID or name</label><input value={action.config.agentId || ""} onChange={e => updateActionConfig(idx, "agentId", e.target.value)} placeholder="agent@company.com" className={inputCls} /></div>;
            case "tag": return <div><label className={labelCls}>Tag name</label><input value={action.config.tagName || ""} onChange={e => updateActionConfig(idx, "tagName", e.target.value)} placeholder="vip, urgent, etc." className={inputCls} /></div>;
            case "change_status": return <div><label className={labelCls}>New status</label><select value={action.config.status || "active"} onChange={e => updateActionConfig(idx, "status", e.target.value)} className={inputCls}>{STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>;
            case "add_note": return <div><label className={labelCls}>Note content</label><textarea value={action.config.content || ""} onChange={e => updateActionConfig(idx, "content", e.target.value)} placeholder="Internal note..." rows={2} className={cn(inputCls, "resize-y")} /></div>;
            case "send_canned": return <div><label className={labelCls}>Canned response shortcode</label><input value={action.config.shortcode || ""} onChange={e => updateActionConfig(idx, "shortcode", e.target.value)} placeholder="/greeting" className={inputCls} /></div>;
            default: return null;
        }
    }

    return (
        <div className="p-8 max-w-[1100px] mx-auto">
            {toast && <div className={cn("fixed top-6 right-6 z-[9999] text-white px-6 py-3 rounded-[10px] text-sm font-semibold shadow-lg", toast.includes("Error") ? "bg-destructive" : "bg-[var(--success)]")}>{toast}</div>}

            <div className="flex justify-between items-center mb-7">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center"><Zap size={22} className="text-primary" /></div>
                    <div><h1 className="text-[22px] font-semibold text-foreground m-0">Macros</h1><p className="text-[13px] text-muted-foreground m-0">Automate repetitive actions with one click</p></div>
                </div>
                <button onClick={openCreate} className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold"><Plus size={16} /> New Macro</button>
            </div>

            <div className="flex flex-col gap-3">
                {loading ? <div className="p-10 text-center text-muted-foreground">Loading...</div>
                    : macros.length === 0 ? (
                        <div className="p-12 text-center bg-card rounded-[14px] border border-border">
                            <Zap size={36} className="text-muted-foreground opacity-40 mb-3" />
                            <p className="text-muted-foreground text-sm">No macros created</p>
                        </div>
                    ) : macros.map(macro => (
                        <div key={macro.id} className="bg-card rounded-[14px] border border-border px-[22px] py-[18px] flex items-center justify-between">
                            <div className="flex items-center gap-3.5">
                                <div className="w-[38px] h-[38px] rounded-[10px] bg-primary/10 flex items-center justify-center"><Zap size={18} className="text-primary" /></div>
                                <div>
                                    <div className="text-[15px] font-semibold text-foreground">{macro.name}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">{macro.description || tc("noData")}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5">
                                <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">{macro.actions?.length || 0} actions</span>
                                <span className={cn("px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1", macro.visibility === "team" ? "bg-[var(--success)]/10 text-[var(--success)]" : "bg-muted text-muted-foreground")}>
                                    {macro.visibility === "team" ? <Eye size={12} /> : <EyeOff size={12} />} {macro.visibility === "team" ? "Team" : "Personal"}
                                </span>
                                <button onClick={() => openEdit(macro)} className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 text-primary cursor-pointer flex items-center justify-center"><Pencil size={14} /></button>
                                <button onClick={() => handleDelete(macro.id)} className="w-8 h-8 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive cursor-pointer flex items-center justify-center"><Trash2 size={14} /></button>
                            </div>
                        </div>
                    ))}
            </div>

            {modalOpen && (
                <div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center" onClick={() => setModalOpen(false)}>
                    <div className="bg-secondary rounded-xl border border-border p-7 w-[540px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-lg font-semibold text-foreground m-0">{editingId ? tc("edit") : tc("create")}</h2>
                            <button onClick={() => setModalOpen(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={18} /></button>
                        </div>
                        <div className="flex flex-col gap-4">
                            <div><label className={labelCls}>Name *</label><input value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g.: Escalate to supervisor" className={inputCls} /></div>
                            <div><label className={labelCls}>Description</label><input value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Optional description" className={inputCls} /></div>
                            <div><label className={labelCls}>Visibility</label><select value={form.visibility} onChange={e => setForm(prev => ({ ...prev, visibility: e.target.value }))} className={inputCls}><option value="personal">Personal</option><option value="team">Team</option></select></div>
                            <div>
                                <label className={labelCls}>Actions</label>
                                <div className="flex flex-col gap-3">
                                    {form.actions.map((action, idx) => {
                                        const actionDef = ACTION_TYPES.find(a => a.value === action.type);
                                        const Icon = actionDef?.icon || Zap;
                                        return (
                                            <div key={idx} className="bg-background rounded-xl border border-border p-3.5">
                                                <div className="flex items-center justify-between mb-2.5">
                                                    <div className="flex items-center gap-2"><Icon size={14} className="text-primary" /><span className="text-xs text-muted-foreground font-semibold">Action {idx + 1}</span></div>
                                                    <button onClick={() => removeAction(idx)} className="w-[26px] h-[26px] rounded-md bg-destructive/10 border border-destructive/20 text-destructive cursor-pointer flex items-center justify-center"><X size={12} /></button>
                                                </div>
                                                <div className="mb-2.5"><label className={labelCls}>Type</label><select value={action.type} onChange={e => updateActionType(idx, e.target.value)} className={inputCls}>{ACTION_TYPES.map(at => <option key={at.value} value={at.value}>{at.label}</option>)}</select></div>
                                                {renderActionConfig(action, idx)}
                                            </div>
                                        );
                                    })}
                                </div>
                                <button onClick={addAction} className="flex items-center gap-1.5 mt-2.5 px-3.5 py-2 rounded-lg bg-transparent border border-dashed border-border text-primary cursor-pointer text-[13px] font-semibold"><Plus size={14} /> Add action</button>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2.5 mt-6">
                            <button onClick={() => setModalOpen(false)} className="px-5 py-2.5 rounded-lg bg-transparent border border-border text-muted-foreground cursor-pointer text-sm">Cancel</button>
                            <button onClick={handleSave} className="px-5 py-2.5 rounded-lg bg-primary border-none text-white cursor-pointer text-sm font-semibold"><span className="flex items-center gap-1.5"><Check size={16} /> {editingId ? tc("saveChanges") : "Create"}</span></button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
