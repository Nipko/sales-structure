"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import {
    Megaphone, Plus, Edit2, Power, Clock, Layers, X, Play, Pause
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1";

const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: "#95a5a622", text: "#95a5a6", label: "Borrador" },
    active: { bg: "#2ecc7122", text: "#2ecc71", label: "Activa" },
    paused: { bg: "#f39c1222", text: "#f39c12", label: "Pausada" },
    finished: { bg: "#e74c3c22", text: "#e74c3c", label: "Finalizada" },
};

export default function CampaignsPage() {
    const { user } = useAuth();
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
                    fetch(`${API}/catalog/campaigns/${activeTenantId}`),
                    fetch(`${API}/catalog/courses/${activeTenantId}`)
                ]);
                const campData = await campRes.json();
                const courseData = await courseRes.json();
                if (Array.isArray(campData)) setCampaigns(campData);
                if (Array.isArray(courseData)) setCourses(courseData);
            } catch (err) { console.error(err); }
        }
        load();
    }, [activeTenantId]);

    const handleCreate = async () => {
        if (!form.name || !activeTenantId) return;
        setSaving(true);
        try {
            const res = await fetch(`${API}/catalog/campaigns/${activeTenantId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form)
            });
            const created = await res.json();
            if (created?.id) {
                setCampaigns(prev => [created, ...prev]);
                setShowModal(false);
                setForm({ name: "", course_id: "", channel: "whatsapp", wa_template_name: "", source_type: "landing", fallback_email: false });
                setToast("Campaña creada exitosamente");
                setTimeout(() => setToast(null), 2500);
            }
        } catch (err) { console.error(err); } finally { setSaving(false); }
    };

    const activeCount = campaigns.filter(c => c.status === "active").length;

    return (
        <>
            <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                            <Megaphone size={28} color="var(--accent)" /> Campañas
                        </h1>
                        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>{activeCount} activas · {campaigns.length} total</p>
                    </div>
                    <button onClick={() => setShowModal(true)} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
                        borderRadius: 10, border: "none", background: "var(--accent)", color: "white",
                        fontWeight: 600, fontSize: 14, cursor: "pointer",
                    }}><Plus size={18} /> Nueva Campaña</button>
                </div>

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
                    {Object.entries(statusColors).map(([key, config]) => {
                        const count = campaigns.filter(c => c.status === key).length;
                        return (
                            <div key={key} style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-secondary)", display: "flex", alignItems: "center", gap: 12 }}>
                                <div style={{ width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: config.bg }}>
                                    {key === "active" ? <Play size={20} color={config.text} /> : key === "paused" ? <Pause size={20} color={config.text} /> : <Layers size={20} color={config.text} />}
                                </div>
                                <div>
                                    <div style={{ fontSize: 18, fontWeight: 700 }}>{count}</div>
                                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{config.label}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {campaigns.map(camp => {
                        const s = statusColors[camp.status] || statusColors.draft;
                        return (
                            <div key={camp.id} style={{
                                padding: "16px 20px", borderRadius: 14, border: "1px solid var(--border)",
                                background: "var(--bg-secondary)", display: "flex", justifyContent: "space-between", alignItems: "center"
                            }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontWeight: 600, fontSize: 15 }}>{camp.name}</span>
                                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: s.bg, color: s.text, fontWeight: 600 }}>{s.label}</span>
                                    </div>
                                    <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>
                                        <span>Canal: {camp.channel}</span>
                                        {camp.course_name && <span>Curso: {camp.course_name}</span>}
                                        {camp.wa_template_name && <span>Template: {camp.wa_template_name}</span>}
                                        <span>Fuente: {camp.source_type || "landing"}</span>
                                    </div>
                                </div>
                                <button style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4 }}><Edit2 size={16} /></button>
                            </div>
                        );
                    })}
                    {campaigns.length === 0 && (
                        <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
                            No hay campañas registradas. Crea la primera.
                        </div>
                    )}
                </div>
            </div>

            {/* Create Modal */}
            {showModal && (
                <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 480, padding: 28, borderRadius: 18, background: "var(--bg-secondary)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Nueva Campaña</h2>
                            <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}><X size={20} /></button>
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Nombre</label>
                            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Campaña Enero 2026" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Curso Principal</label>
                            <select value={form.course_id} onChange={e => setForm(p => ({ ...p, course_id: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                                <option value="">— Sin curso —</option>
                                {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Canal</label>
                            <select value={form.channel} onChange={e => setForm(p => ({ ...p, channel: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                                <option value="whatsapp">WhatsApp</option>
                                <option value="email">Email</option>
                                <option value="mixed">Mixto</option>
                            </select>
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Template WhatsApp</label>
                            <input value={form.wa_template_name} onChange={e => setForm(p => ({ ...p, wa_template_name: e.target.value }))} placeholder="welcome_message" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Fuente de Entrada</label>
                            <select value={form.source_type} onChange={e => setForm(p => ({ ...p, source_type: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                                <option value="landing">Landing Page</option>
                                <option value="csv">Importación CSV</option>
                                <option value="api">API Externa</option>
                                <option value="meta_ads">Meta Lead Ads</option>
                            </select>
                        </div>
                        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                            <input type="checkbox" checked={form.fallback_email} onChange={e => setForm(p => ({ ...p, fallback_email: e.target.checked }))} id="fallback" />
                            <label htmlFor="fallback" style={{ fontSize: 13, color: "var(--text-secondary)" }}>Activar fallback a Email si falla WhatsApp</label>
                        </div>
                        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                            <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer" }}>Cancelar</button>
                            <button onClick={handleCreate} disabled={saving || !form.name} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: saving ? "var(--border)" : "var(--accent)", color: "white", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}>{saving ? "Guardando..." : "Crear Campaña"}</button>
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
