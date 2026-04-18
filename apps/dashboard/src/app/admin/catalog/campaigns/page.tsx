"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Megaphone, Plus, Edit2, Power, Clock, Layers, X, Play, Pause
} from "lucide-react";

const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: "#95a5a622", text: "#95a5a6", label: "Borrador" },
    active: { bg: "#2ecc7122", text: "#2ecc71", label: "Activa" },
    paused: { bg: "#f39c1222", text: "#f39c12", label: "Pausada" },
    finished: { bg: "#e74c3c22", text: "#e74c3c", label: "Finalizada" },
};

export default function CampaignsPage() {
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [courses, setCourses] = useState<any[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ name: "", course_id: "", channel: "whatsapp", wa_template_name: "", source_type: "landing", fallback_email: false });
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            try {
                const [campRes, courseRes] = await Promise.all([
                    api.fetch(`/catalog/campaigns/${activeTenantId}`),
                    api.fetch(`/catalog/courses/${activeTenantId}`),
                ]);
                if (Array.isArray(campRes)) setCampaigns(campRes);
                if (Array.isArray(courseRes)) setCourses(courseRes);
            } catch (err) { console.error(err); }
        }
        load();
    }, [activeTenantId]);

    const handleCreate = async () => {
        if (!form.name || !activeTenantId) return;
        setSaving(true);
        try {
            const created = await api.fetch(`/catalog/campaigns/${activeTenantId}`, {
                method: "POST",
                body: JSON.stringify(form),
            });
            if (created?.id) {
                setCampaigns(prev => [created, ...prev]);
                setShowModal(false);
                setForm({ name: "", course_id: "", channel: "whatsapp", wa_template_name: "", source_type: "landing", fallback_email: false });
                setToast("Campana creada exitosamente");
                setTimeout(() => setToast(null), 2500);
            }
        } catch (err) { console.error(err); } finally { setSaving(false); }
    };

    const activeCount = campaigns.filter(c => c.status === "active").length;

    return (
        <>
            <div>
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-[28px] font-semibold m-0 flex items-center gap-2.5">
                            <Megaphone size={28} className="text-primary" /> Campanas
                        </h1>
                        <p className="text-muted-foreground mt-1">{activeCount} activas · {campaigns.length} total</p>
                    </div>
                    <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer">
                        <Plus size={18} /> Nueva Campana
                    </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                    {Object.entries(statusColors).map(([key, config]) => {
                        const count = campaigns.filter(c => c.status === key).length;
                        return (
                            <div key={key} className="px-4 py-3.5 rounded-xl border border-border bg-card flex items-center gap-3">
                                <div className="w-10 h-10 rounded-[10px] flex items-center justify-center" style={{ background: config.bg }}>
                                    {key === "active" ? <Play size={20} color={config.text} /> : key === "paused" ? <Pause size={20} color={config.text} /> : <Layers size={20} color={config.text} />}
                                </div>
                                <div>
                                    <div className="text-lg font-semibold">{count}</div>
                                    <div className="text-xs text-muted-foreground">{config.label}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* List */}
                <div className="flex flex-col gap-2.5">
                    {campaigns.map(camp => {
                        const s = statusColors[camp.status] || statusColors.draft;
                        return (
                            <div key={camp.id} className="px-5 py-4 rounded-[14px] border border-border bg-card flex justify-between items-center">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-[15px]">{camp.name}</span>
                                        <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold" style={{ background: s.bg, color: s.text }}>{s.label}</span>
                                    </div>
                                    <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
                                        <span>Canal: {camp.channel}</span>
                                        {camp.course_name && <span>Curso: {camp.course_name}</span>}
                                        {camp.wa_template_name && <span>Template: {camp.wa_template_name}</span>}
                                        <span>Fuente: {camp.source_type || "landing"}</span>
                                    </div>
                                </div>
                                <button className="bg-transparent border-none text-muted-foreground cursor-pointer p-1"><Edit2 size={16} /></button>
                            </div>
                        );
                    })}
                    {campaigns.length === 0 && (
                        <div className="text-center py-10 text-muted-foreground">
                            No hay campanas registradas. Crea la primera.
                        </div>
                    )}
                </div>
            </div>

            {/* Create Modal */}
            {showModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} className="w-[480px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-semibold m-0">Nueva Campana</h2>
                            <button onClick={() => setShowModal(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>
                        {[
                            { label: "Nombre", key: "name", el: "input" },
                            { label: "Curso Principal", key: "course_id", el: "select", options: [{ value: "", label: "— Sin curso —" }, ...courses.map(c => ({ value: c.id, label: c.name }))] },
                            { label: "Canal", key: "channel", el: "select", options: [{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }, { value: "mixed", label: "Mixto" }] },
                            { label: "Template WhatsApp", key: "wa_template_name", el: "input" },
                            { label: "Fuente de Entrada", key: "source_type", el: "select", options: [{ value: "landing", label: "Landing Page" }, { value: "csv", label: "Importacion CSV" }, { value: "api", label: "API Externa" }, { value: "meta_ads", label: "Meta Lead Ads" }] },
                        ].map(f => (
                            <div key={f.key} className="mb-3">
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{f.label}</label>
                                {f.el === "select" ? (
                                    <select value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border">
                                        {f.options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                ) : (
                                    <input value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                                )}
                            </div>
                        ))}
                        <div className="mb-3 flex items-center gap-2">
                            <input type="checkbox" checked={form.fallback_email} onChange={e => setForm(p => ({ ...p, fallback_email: e.target.checked }))} id="fallback" />
                            <label htmlFor="fallback" className="text-[13px] text-muted-foreground">Activar fallback a Email si falla WhatsApp</label>
                        </div>
                        <div className="flex gap-2.5 mt-5">
                            <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer">Cancelar</button>
                            <button onClick={handleCreate} disabled={saving || !form.name} className={cn("flex-1 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold", saving ? "bg-muted cursor-wait" : "bg-primary cursor-pointer")}>{saving ? tc("saving") : tc("create")}</button>
                        </div>
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
