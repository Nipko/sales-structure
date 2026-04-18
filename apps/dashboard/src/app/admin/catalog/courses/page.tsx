"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    BookOpen, Plus, Edit2, Power, DollarSign, Clock, Globe, X
} from "lucide-react";

export default function CoursesPage() {
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [courses, setCourses] = useState<any[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ name: "", slug: "", description: "", price: "", currency: "COP", modality: "presencial", duration_hours: "", brochure_url: "" });
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            try {
                const data = await api.fetch(`/catalog/courses/${activeTenantId}`);
                if (Array.isArray(data)) setCourses(data);
            } catch (err) { console.error(err); }
        }
        load();
    }, [activeTenantId]);

    const handleCreate = async () => {
        if (!form.name || !activeTenantId) return;
        setSaving(true);
        try {
            const created = await api.fetch(`/catalog/courses/${activeTenantId}`, {
                method: "POST",
                body: JSON.stringify({
                    ...form,
                    price: parseFloat(form.price) || 0,
                    duration_hours: parseInt(form.duration_hours) || null,
                    slug: form.slug || form.name.toLowerCase().replace(/\s+/g, '-')
                }),
            });
            if (created?.id) {
                setCourses(prev => [created, ...prev]);
                setShowModal(false);
                setForm({ name: "", slug: "", description: "", price: "", currency: "COP", modality: "presencial", duration_hours: "", brochure_url: "" });
                setToast("Curso creado exitosamente");
                setTimeout(() => setToast(null), 2500);
            }
        } catch (err) { console.error(err); } finally { setSaving(false); }
    };

    const modalityLabel: Record<string, string> = { presencial: "Presencial", virtual: "Virtual", hibrido: "Hibrido" };

    return (
        <>
            <div>
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-[28px] font-semibold m-0 flex items-center gap-2.5">
                            <BookOpen size={28} className="text-primary" /> Catalogo de Cursos
                        </h1>
                        <p className="text-muted-foreground mt-1">{courses.length} cursos registrados</p>
                    </div>
                    <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer">
                        <Plus size={18} /> Nuevo Curso
                    </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mb-6">
                    {[
                        { icon: BookOpen, color: "#3498db", label: "Total", value: courses.length },
                        { icon: Power, color: "#2ecc71", label: "Activos", value: courses.filter(c => c.is_active).length },
                        { icon: DollarSign, color: "#f1c40f", label: "Precio Promedio", value: courses.length > 0 ? `$${(courses.reduce((s, c) => s + parseFloat(c.price || 0), 0) / courses.length).toFixed(0)}` : "$0" },
                    ].map((s, i) => {
                        const Icon = s.icon;
                        return (
                            <div key={i} className="px-4 py-3.5 rounded-xl border border-border bg-card flex items-center gap-3">
                                <div className="w-10 h-10 rounded-[10px] flex items-center justify-center" style={{ background: `${s.color}22` }}>
                                    <Icon size={20} color={s.color} />
                                </div>
                                <div>
                                    <div className="text-lg font-semibold">{s.value}</div>
                                    <div className="text-xs text-muted-foreground">{s.label}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* List */}
                <div className="flex flex-col gap-2.5">
                    {courses.map(course => (
                        <div key={course.id} className={cn("px-5 py-4 rounded-[14px] border border-border bg-card flex justify-between items-center", !course.is_active && "opacity-50")}>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-[15px]">{course.name}</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold" style={{ background: course.is_active ? "#2ecc7122" : "#e74c3c22", color: course.is_active ? "#2ecc71" : "#e74c3c" }}>
                                        {course.is_active ? "Activo" : "Inactivo"}
                                    </span>
                                </div>
                                <div className="text-[13px] text-muted-foreground mt-1">{course.description || tc("noData")}</div>
                                <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1"><DollarSign size={12} /> ${parseFloat(course.price || 0).toLocaleString()} {course.currency}</span>
                                    <span className="flex items-center gap-1"><Globe size={12} /> {modalityLabel[course.modality] || course.modality}</span>
                                    {course.duration_hours && <span className="flex items-center gap-1"><Clock size={12} /> {course.duration_hours}h</span>}
                                </div>
                            </div>
                            <button className="bg-transparent border-none text-muted-foreground cursor-pointer p-1"><Edit2 size={16} /></button>
                        </div>
                    ))}
                    {courses.length === 0 && (
                        <div className="text-center py-10 text-muted-foreground">No hay cursos registrados aun. Crea el primero.</div>
                    )}
                </div>
            </div>

            {/* Create Modal */}
            {showModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} className="w-[480px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-semibold m-0">Nuevo Curso</h2>
                            <button onClick={() => setShowModal(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>
                        {[
                            { label: "Nombre", key: "name", placeholder: "Ej: Diplomado en Marketing Digital" },
                            { label: "Slug (URL)", key: "slug", placeholder: "marketing-digital" },
                            { label: "Descripcion", key: "description", placeholder: "Descripcion breve del curso..." },
                            { label: "Precio", key: "price", placeholder: "2500000", type: "number" },
                            { label: "Duracion (horas)", key: "duration_hours", placeholder: "120", type: "number" },
                            { label: "URL Brochure", key: "brochure_url", placeholder: "https://..." },
                        ].map(f => (
                            <div key={f.key} className="mb-3">
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{f.label}</label>
                                <input
                                    value={(form as any)[f.key]}
                                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                                    placeholder={f.placeholder}
                                    type={f.type || "text"}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                                />
                            </div>
                        ))}
                        <div className="mb-3">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">Modalidad</label>
                            <select value={form.modality} onChange={e => setForm(p => ({ ...p, modality: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border">
                                <option value="presencial">Presencial</option>
                                <option value="virtual">Virtual</option>
                                <option value="hibrido">Hibrido</option>
                            </select>
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
