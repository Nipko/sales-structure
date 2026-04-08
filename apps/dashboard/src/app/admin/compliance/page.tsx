"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Shield, FileText, UserCheck, UserX, Trash2, Plus, X, Eye, Check
} from "lucide-react";

type Tab = "legal" | "consents" | "optouts" | "deletions";

export default function CompliancePage() {
    const { activeTenantId } = useTenant();
    const [tab, setTab] = useState<Tab>("legal");
    const [legalTexts, setLegalTexts] = useState<any[]>([]);
    const [consents, setConsents] = useState<any[]>([]);
    const [optOuts, setOptOuts] = useState<any[]>([]);
    const [deletions, setDeletions] = useState<any[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const [legalForm, setLegalForm] = useState({ channel: "web", version: 1, text: "" });
    const [optOutForm, setOptOutForm] = useState({ lead_id: "", channel: "whatsapp", reason: "" });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!activeTenantId) return;
        loadAll();
    }, [activeTenantId]);

    async function loadAll() {
        try {
            const [lt, co, oo, dr] = await Promise.all([
                api.fetch(`/compliance/legal-texts/${activeTenantId}`),
                api.fetch(`/compliance/consents/${activeTenantId}`),
                api.fetch(`/compliance/opt-outs/${activeTenantId}`),
                api.fetch(`/compliance/deletion-requests/${activeTenantId}`),
            ]);
            if (Array.isArray(lt)) setLegalTexts(lt);
            if (Array.isArray(co)) setConsents(co);
            if (Array.isArray(oo)) setOptOuts(oo);
            if (Array.isArray(dr)) setDeletions(dr);
        } catch (err) { console.error(err); }
    }

    const handleCreateLegal = async () => {
        if (!legalForm.text || !activeTenantId) return;
        setSaving(true);
        try {
            const created = await api.fetch(`/compliance/legal-texts/${activeTenantId}`, { method: "POST", body: JSON.stringify(legalForm) });
            if (created?.id) { setLegalTexts(prev => [created, ...prev]); setShowModal(false); setToast("Texto legal creado"); setTimeout(() => setToast(null), 2500); }
        } catch (err) { console.error(err); } finally { setSaving(false); }
    };

    const handleCreateOptOut = async () => {
        if (!optOutForm.lead_id || !activeTenantId) return;
        setSaving(true);
        try {
            const created = await api.fetch(`/compliance/opt-outs/${activeTenantId}`, { method: "POST", body: JSON.stringify(optOutForm) });
            if (created?.id) { setOptOuts(prev => [created, ...prev]); setShowModal(false); setToast("Opt-out registrado"); setTimeout(() => setToast(null), 2500); }
        } catch (err) { console.error(err); } finally { setSaving(false); }
    };

    const handleProcessDeletion = async (id: string) => {
        try {
            await api.fetch(`/compliance/deletion-requests/${activeTenantId}/${id}/process`, { method: "PUT" });
            setDeletions(prev => prev.map(d => d.id === id ? { ...d, status: "processed", processed_at: new Date().toISOString() } : d));
            setToast("Solicitud procesada"); setTimeout(() => setToast(null), 2500);
        } catch (err) { console.error(err); }
    };

    const tabs: { key: Tab; label: string; icon: any; count: number }[] = [
        { key: "legal", label: "Textos Legales", icon: FileText, count: legalTexts.length },
        { key: "consents", label: "Consentimientos", icon: UserCheck, count: consents.length },
        { key: "optouts", label: "Opt-Outs", icon: UserX, count: optOuts.length },
        { key: "deletions", label: "Solicitudes Borrado", icon: Trash2, count: deletions.length },
    ];

    return (
        <>
            <div>
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-[28px] font-bold m-0 flex items-center gap-2.5">
                            <Shield size={28} className="text-primary" /> Compliance & Audit
                        </h1>
                        <p className="text-muted-foreground mt-1">Trazabilidad legal, consentimiento y privacidad</p>
                    </div>
                    {(tab === "legal" || tab === "optouts") && (
                        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer">
                            <Plus size={18} /> {tab === "legal" ? "Nuevo Texto Legal" : "Registrar Opt-Out"}
                        </button>
                    )}
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-5 bg-card rounded-xl p-1 border border-border">
                    {tabs.map(t => {
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setTab(t.key)}
                                className={cn(
                                    "flex-1 px-3 py-2.5 rounded-lg border-none font-semibold text-[13px] cursor-pointer flex items-center justify-center gap-1.5 transition-all duration-200",
                                    tab === t.key ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground"
                                )}
                            >
                                <Icon size={16} /> {t.label} <span className="text-[11px] opacity-70">({t.count})</span>
                            </button>
                        );
                    })}
                </div>

                {/* Content */}
                {tab === "legal" && (
                    <div className="flex flex-col gap-2.5">
                        {legalTexts.map(lt => (
                            <div key={lt.id} className="px-5 py-3.5 rounded-xl border border-border bg-card">
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <FileText size={16} className="text-primary" />
                                        <span className="font-semibold">v{lt.version}</span>
                                        <span className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: "#3498db22", color: "#3498db" }}>{lt.channel}</span>
                                        <span className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: lt.active ? "#2ecc7122" : "#e74c3c22", color: lt.active ? "#2ecc71" : "#e74c3c" }}>{lt.active ? "Activo" : "Inactivo"}</span>
                                    </div>
                                    <span className="text-xs text-muted-foreground">{new Date(lt.created_at).toLocaleDateString()}</span>
                                </div>
                                <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">{lt.text?.substring(0, 200)}{lt.text?.length > 200 ? "..." : ""}</p>
                            </div>
                        ))}
                        {legalTexts.length === 0 && <div className="text-center py-10 text-muted-foreground">No hay textos legales configurados.</div>}
                    </div>
                )}

                {tab === "consents" && (
                    <div className="flex flex-col gap-2">
                        {consents.map(c => (
                            <div key={c.id} className="px-5 py-3 rounded-xl border border-border bg-card flex justify-between items-center">
                                <div>
                                    <span className="font-semibold text-[13px]">Lead: {c.lead_id?.substring(0, 8) || "N/A"}...</span>
                                    <span className="ml-3 text-xs text-muted-foreground">Canal: {c.channel} · v{c.legal_text_version}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{new Date(c.granted_at).toLocaleString()}</span>
                            </div>
                        ))}
                        {consents.length === 0 && <div className="text-center py-10 text-muted-foreground">No hay consentimientos registrados aun.</div>}
                    </div>
                )}

                {tab === "optouts" && (
                    <div className="flex flex-col gap-2">
                        {optOuts.map(o => (
                            <div key={o.id} className="px-5 py-3 rounded-xl border border-border bg-card flex justify-between items-center">
                                <div>
                                    <span className="font-semibold text-[13px]">Lead: {o.lead_id?.substring(0, 8) || "N/A"}...</span>
                                    <span className="ml-3 text-xs px-2 py-0.5 rounded-md" style={{ background: "#e74c3c22", color: "#e74c3c" }}>{o.channel}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">{o.scope} — {o.reason || "Sin razon"}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()}</span>
                            </div>
                        ))}
                        {optOuts.length === 0 && <div className="text-center py-10 text-muted-foreground">No hay opt-outs registrados.</div>}
                    </div>
                )}

                {tab === "deletions" && (
                    <div className="flex flex-col gap-2">
                        {deletions.map(d => (
                            <div key={d.id} className="px-5 py-3 rounded-xl border border-border bg-card flex justify-between items-center">
                                <div>
                                    <span className="font-semibold text-[13px]">Lead: {d.lead_id?.substring(0, 8) || "N/A"}...</span>
                                    <span className="ml-3 text-[11px] px-2 py-0.5 rounded-md" style={{ background: d.status === "processed" ? "#2ecc7122" : "#f39c1222", color: d.status === "processed" ? "#2ecc71" : "#f39c12" }}>{d.status}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">Solicitado por: {d.requested_by || "Sistema"}</span>
                                </div>
                                <div className="flex gap-2 items-center">
                                    <span className="text-xs text-muted-foreground">{new Date(d.requested_at).toLocaleDateString()}</span>
                                    {d.status === "pending" && (
                                        <button onClick={() => handleProcessDeletion(d.id)} className="px-3 py-1 rounded-md border-none bg-emerald-500 text-white text-xs cursor-pointer flex items-center gap-1">
                                            <Check size={12} /> Procesar
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {deletions.length === 0 && <div className="text-center py-10 text-muted-foreground">No hay solicitudes de borrado.</div>}
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} className="w-[480px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-bold m-0">{tab === "legal" ? "Nuevo Texto Legal" : "Registrar Opt-Out"}</h2>
                            <button onClick={() => setShowModal(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>

                        {tab === "legal" && (
                            <>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Canal</label>
                                    <select value={legalForm.channel} onChange={e => setLegalForm(p => ({ ...p, channel: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border">
                                        <option value="web">Web</option>
                                        <option value="whatsapp">WhatsApp</option>
                                        <option value="email">Email</option>
                                    </select>
                                </div>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Version</label>
                                    <input type="number" value={legalForm.version} onChange={e => setLegalForm(p => ({ ...p, version: parseInt(e.target.value) || 1 }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                                </div>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Texto Legal</label>
                                    <textarea value={legalForm.text} onChange={e => setLegalForm(p => ({ ...p, text: e.target.value }))} rows={5} placeholder="Acepto los terminos y condiciones de tratamiento de datos personales..." className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border resize-y" />
                                </div>
                                <div className="flex gap-2.5 mt-5">
                                    <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer">Cancelar</button>
                                    <button onClick={handleCreateLegal} disabled={saving || !legalForm.text} className={cn("flex-1 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold", saving ? "bg-muted cursor-wait" : "bg-primary cursor-pointer")}>{saving ? "Guardando..." : "Crear Texto"}</button>
                                </div>
                            </>
                        )}

                        {tab === "optouts" && (
                            <>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Lead ID</label>
                                    <input value={optOutForm.lead_id} onChange={e => setOptOutForm(p => ({ ...p, lead_id: e.target.value }))} placeholder="UUID del lead" className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                                </div>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Canal</label>
                                    <select value={optOutForm.channel} onChange={e => setOptOutForm(p => ({ ...p, channel: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border">
                                        <option value="whatsapp">WhatsApp</option>
                                        <option value="email">Email</option>
                                        <option value="sms">SMS</option>
                                    </select>
                                </div>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Razon</label>
                                    <input value={optOutForm.reason} onChange={e => setOptOutForm(p => ({ ...p, reason: e.target.value }))} placeholder="Solicitud del usuario" className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                                </div>
                                <div className="flex gap-2.5 mt-5">
                                    <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer">Cancelar</button>
                                    <button onClick={handleCreateOptOut} disabled={saving || !optOutForm.lead_id} className={cn("flex-1 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold", saving ? "bg-muted cursor-wait" : "bg-red-500 cursor-pointer")}>{saving ? "Guardando..." : "Registrar Opt-Out"}</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold bg-emerald-500 text-white shadow-lg animate-in">
                    ✓ {toast}
                </div>
            )}
        </>
    );
}
