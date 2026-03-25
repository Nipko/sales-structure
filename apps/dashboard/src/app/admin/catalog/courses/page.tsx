"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    BookOpen, Plus, Edit2, Power, DollarSign, Clock, Globe, X
} from "lucide-react";

export default function CoursesPage() {
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

    const modalityLabel: Record<string, string> = { presencial: "Presencial", virtual: "Virtual", hibrido: "Híbrido" };

    return (
        <>
            <div>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                            <BookOpen size={28} color="var(--accent)" /> Catálogo de Cursos
                        </h1>
                        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>{courses.length} cursos registrados</p>
                    </div>
                    <button onClick={() => setShowModal(true)} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
                        borderRadius: 10, border: "none", background: "var(--accent)", color: "white",
                        fontWeight: 600, fontSize: 14, cursor: "pointer",
                    }}><Plus size={18} /> Nuevo Curso</button>
                </div>

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
                    {[
                        { icon: BookOpen, color: "#3498db", label: "Total", value: courses.length },
                        { icon: Power, color: "#2ecc71", label: "Activos", value: courses.filter(c => c.is_active).length },
                        { icon: DollarSign, color: "#f1c40f", label: "Precio Promedio", value: courses.length > 0 ? `$${(courses.reduce((s, c) => s + parseFloat(c.price || 0), 0) / courses.length).toFixed(0)}` : "$0" },
                    ].map((s, i) => {
                        const Icon = s.icon;
                        return (
                            <div key={i} style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-secondary)", display: "flex", alignItems: "center", gap: 12 }}>
                                <div style={{ width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: `${s.color}22` }}>
                                    <Icon size={20} color={s.color} />
                                </div>
                                <div>
                                    <div style={{ fontSize: 18, fontWeight: 700 }}>{s.value}</div>
                                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.label}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {courses.map(course => (
                        <div key={course.id} style={{
                            padding: "16px 20px", borderRadius: 14, border: "1px solid var(--border)",
                            background: "var(--bg-secondary)", display: "flex", justifyContent: "space-between", alignItems: "center",
                            opacity: course.is_active ? 1 : 0.5
                        }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontWeight: 600, fontSize: 15 }}>{course.name}</span>
                                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: course.is_active ? "#2ecc7122" : "#e74c3c22", color: course.is_active ? "#2ecc71" : "#e74c3c", fontWeight: 600 }}>
                                        {course.is_active ? "Activo" : "Inactivo"}
                                    </span>
                                </div>
                                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{course.description || "Sin descripción"}</div>
                                <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>
                                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><DollarSign size={12} /> ${parseFloat(course.price || 0).toLocaleString()} {course.currency}</span>
                                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Globe size={12} /> {modalityLabel[course.modality] || course.modality}</span>
                                    {course.duration_hours && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Clock size={12} /> {course.duration_hours}h</span>}
                                </div>
                            </div>
                            <button style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4 }}><Edit2 size={16} /></button>
                        </div>
                    ))}
                    {courses.length === 0 && (
                        <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
                            No hay cursos registrados aún. Crea el primero.
                        </div>
                    )}
                </div>
            </div>

            {/* Create Modal */}
            {showModal && (
                <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 480, padding: 28, borderRadius: 18, background: "var(--bg-secondary)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Nuevo Curso</h2>
                            <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}><X size={20} /></button>
                        </div>
                        {[
                            { label: "Nombre", key: "name", placeholder: "Ej: Diplomado en Marketing Digital" },
                            { label: "Slug (URL)", key: "slug", placeholder: "marketing-digital" },
                            { label: "Descripción", key: "description", placeholder: "Descripción breve del curso..." },
                            { label: "Precio", key: "price", placeholder: "2500000", type: "number" },
                            { label: "Duración (horas)", key: "duration_hours", placeholder: "120", type: "number" },
                            { label: "URL Brochure", key: "brochure_url", placeholder: "https://..." },
                        ].map(f => (
                            <div key={f.key} style={{ marginBottom: 12 }}>
                                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>{f.label}</label>
                                <input
                                    value={(form as any)[f.key]}
                                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                                    placeholder={f.placeholder}
                                    type={f.type || "text"}
                                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                                />
                            </div>
                        ))}
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Modalidad</label>
                            <select value={form.modality} onChange={e => setForm(p => ({ ...p, modality: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                                <option value="presencial">Presencial</option>
                                <option value="virtual">Virtual</option>
                                <option value="hibrido">Híbrido</option>
                            </select>
                        </div>
                        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                            <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer" }}>Cancelar</button>
                            <button onClick={handleCreate} disabled={saving || !form.name} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: saving ? "var(--border)" : "var(--accent)", color: "white", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}>{saving ? "Guardando..." : "Crear Curso"}</button>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1100, padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, background: "#2ecc71", color: "white", boxShadow: "0 4px 20px rgba(0,0,0,0.2)", animation: "slideUp 0.3s ease" }}>
                    ✓ {toast}
                </div>
            )}
            <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </>
    );
}
