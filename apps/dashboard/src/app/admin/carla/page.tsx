"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    Bot, UserCircle, FileText, Plus, Edit2, Power, X, Sparkles, MessageSquare
} from "lucide-react";

type Tab = "profiles" | "prompts" | "contexts";

const toneLabels: Record<string, string> = {
    professional: "Profesional", friendly: "Amigable", formal: "Formal", casual: "Casual", empathetic: "Empática"
};

export default function CarlaPage() {
    const { activeTenantId } = useTenant();
    const [tab, setTab] = useState<Tab>("profiles");
    const [profiles, setProfiles] = useState<any[]>([]);
    const [prompts, setPrompts] = useState<any[]>([]);
    const [contexts, setContexts] = useState<any[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [profileForm, setProfileForm] = useState({ name: "", tone: "professional", disclaimers: "" });
    const [promptForm, setPromptForm] = useState({ name: "", template_type: "system", content: "" });

    useEffect(() => {
        if (!activeTenantId) return;
        Promise.all([
            api.fetch(`/carla/profiles/${activeTenantId}`).catch(() => []),
            api.fetch(`/carla/prompts/${activeTenantId}`).catch(() => []),
            api.fetch(`/carla/context/${activeTenantId}`).catch(() => []),
        ]).then(([p, t, c]) => {
            if (Array.isArray(p)) setProfiles(p);
            if (Array.isArray(t)) setPrompts(t);
            if (Array.isArray(c)) setContexts(c);
        });
    }, [activeTenantId]);

    const handleCreateProfile = async () => {
        if (!profileForm.name || !activeTenantId) return;
        setSaving(true);
        try {
            const created = await api.fetch(`/carla/profiles/${activeTenantId}`, {
                method: "POST",
                body: JSON.stringify(profileForm),
            });
            if (created?.id) { setProfiles(prev => [created, ...prev]); setShowModal(false); setToast("Perfil creado"); setTimeout(() => setToast(null), 2500); }
        } catch (e) { console.error(e); } finally { setSaving(false); }
    };

    const handleCreatePrompt = async () => {
        if (!promptForm.name || !promptForm.content || !activeTenantId) return;
        setSaving(true);
        try {
            const created = await api.fetch(`/carla/prompts/${activeTenantId}`, {
                method: "POST",
                body: JSON.stringify(promptForm),
            });
            if (created?.id) { setPrompts(prev => [created, ...prev]); setShowModal(false); setToast("Prompt creado"); setTimeout(() => setToast(null), 2500); }
        } catch (e) { console.error(e); } finally { setSaving(false); }
    };

    const tabs = [
        { key: "profiles" as Tab, label: "Personalidad", icon: UserCircle, count: profiles.length },
        { key: "prompts" as Tab, label: "Prompt Templates", icon: FileText, count: prompts.length },
        { key: "contexts" as Tab, label: "Contextos Recientes", icon: MessageSquare, count: contexts.length },
    ];

    return (
        <>
            <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                            <Bot size={28} color="var(--accent)" /> Carla AI — Sales Agent
                        </h1>
                        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>Configuración de personalidad, prompts y contextos de conversación</p>
                    </div>
                    {(tab === "profiles" || tab === "prompts") && (
                        <button onClick={() => setShowModal(true)} style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
                            borderRadius: 10, border: "none", background: "var(--accent)", color: "white",
                            fontWeight: 600, fontSize: 14, cursor: "pointer",
                        }}><Plus size={18} /> {tab === "profiles" ? "Nuevo Perfil" : "Nuevo Prompt"}</button>
                    )}
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--bg-secondary)", borderRadius: 12, padding: 4, border: "1px solid var(--border)" }}>
                    {tabs.map(t => {
                        const Icon = t.icon;
                        return (
                            <button key={t.key} onClick={() => setTab(t.key)} style={{
                                flex: 1, padding: "10px 12px", borderRadius: 8, border: "none",
                                background: tab === t.key ? "var(--accent)" : "transparent",
                                color: tab === t.key ? "white" : "var(--text-secondary)",
                                fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                                transition: "all 0.2s ease"
                            }}>
                                <Icon size={16} /> {t.label} <span style={{ fontSize: 11, opacity: 0.7 }}>({t.count})</span>
                            </button>
                        );
                    })}
                </div>

                {/* Profiles Tab */}
                {tab === "profiles" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {profiles.map(p => (
                            <div key={p.id} style={{ padding: "16px 20px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <Sparkles size={18} color="var(--accent)" />
                                        <span style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</span>
                                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "#3498db22", color: "#3498db" }}>{toneLabels[p.tone] || p.tone}</span>
                                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: p.active ? "#2ecc7122" : "#e74c3c22", color: p.active ? "#2ecc71" : "#e74c3c" }}>{p.active ? "Activo" : "Inactivo"}</span>
                                    </div>
                                    <button style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}><Edit2 size={16} /></button>
                                </div>
                                {p.disclaimers && <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8 }}>{p.disclaimers}</p>}
                            </div>
                        ))}
                        {profiles.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>No hay perfiles de personalidad. Crea el primero para configurar a Carla.</div>}
                    </div>
                )}

                {/* Prompts Tab */}
                {tab === "prompts" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {prompts.map(p => (
                            <div key={p.id} style={{ padding: "16px 20px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <FileText size={16} color="var(--accent)" />
                                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "#9b59b622", color: "#9b59b6" }}>{p.template_type}</span>
                                        <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>v{p.version}</span>
                                    </div>
                                    <button style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}><Edit2 size={16} /></button>
                                </div>
                                <pre style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8, whiteSpace: "pre-wrap", fontFamily: "monospace", background: "var(--bg-primary)", padding: 10, borderRadius: 8, maxHeight: 120, overflow: "auto" }}>{p.content?.substring(0, 300)}{p.content?.length > 300 ? "..." : ""}</pre>
                            </div>
                        ))}
                        {prompts.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>No hay prompt templates. Crea el primero.</div>}
                    </div>
                )}

                {/* Contexts Tab */}
                {tab === "contexts" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {contexts.map(c => (
                            <div key={c.id} style={{ padding: "14px 20px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontWeight: 600, fontSize: 13 }}>Conv: {c.conversation_id?.substring(0, 8)}...</span>
                                        {c.intent_primary && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "#3498db22", color: "#3498db" }}>{c.intent_primary}</span>}
                                        {c.should_handoff && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "#e74c3c22", color: "#e74c3c" }}>🔥 Handoff</span>}
                                        {c.suggested_stage && <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>→ {c.suggested_stage}</span>}
                                    </div>
                                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{new Date(c.created_at).toLocaleString()}</span>
                                </div>
                                {c.summary_for_agent && <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>📝 {c.summary_for_agent}</p>}
                            </div>
                        ))}
                        {contexts.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>Sin contextos de conversación recientes.</div>}
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 520, padding: 28, borderRadius: 18, background: "var(--bg-secondary)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{tab === "profiles" ? "Nuevo Perfil de Personalidad" : "Nuevo Prompt Template"}</h2>
                            <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}><X size={20} /></button>
                        </div>

                        {tab === "profiles" && (
                            <>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Nombre</label>
                                    <input value={profileForm.name} onChange={e => setProfileForm(p => ({ ...p, name: e.target.value }))} placeholder="Carla - Ventas Educativas" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                                </div>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Tono</label>
                                    <select value={profileForm.tone} onChange={e => setProfileForm(p => ({ ...p, tone: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                                        <option value="professional">Profesional</option>
                                        <option value="friendly">Amigable</option>
                                        <option value="formal">Formal</option>
                                        <option value="casual">Casual</option>
                                        <option value="empathetic">Empática</option>
                                    </select>
                                </div>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Disclaimers Internos</label>
                                    <textarea value={profileForm.disclaimers} onChange={e => setProfileForm(p => ({ ...p, disclaimers: e.target.value }))} rows={3} placeholder="Reglas internas que Carla debe respetar..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box", resize: "vertical" }} />
                                </div>
                                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                                    <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer" }}>Cancelar</button>
                                    <button onClick={handleCreateProfile} disabled={saving || !profileForm.name} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: saving ? "var(--border)" : "var(--accent)", color: "white", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}>{saving ? "Guardando..." : "Crear Perfil"}</button>
                                </div>
                            </>
                        )}

                        {tab === "prompts" && (
                            <>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Nombre</label>
                                    <input value={promptForm.name} onChange={e => setPromptForm(p => ({ ...p, name: e.target.value }))} placeholder="System Prompt — Ventas" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                                </div>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Tipo</label>
                                    <select value={promptForm.template_type} onChange={e => setPromptForm(p => ({ ...p, template_type: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                                        <option value="system">System Prompt</option>
                                        <option value="greeting">Greeting</option>
                                        <option value="follow_up">Follow-Up</option>
                                        <option value="handoff">Handoff</option>
                                        <option value="closing">Closing</option>
                                    </select>
                                </div>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Contenido del Prompt</label>
                                    <textarea value={promptForm.content} onChange={e => setPromptForm(p => ({ ...p, content: e.target.value }))} rows={8} placeholder="Eres Carla, asesora comercial de {{tenant_name}}. Tu objetivo es..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 13, outline: "none", boxSizing: "border-box", resize: "vertical", fontFamily: "monospace" }} />
                                </div>
                                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                                    <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer" }}>Cancelar</button>
                                    <button onClick={handleCreatePrompt} disabled={saving || !promptForm.name || !promptForm.content} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: saving ? "var(--border)" : "var(--accent)", color: "white", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}>{saving ? "Guardando..." : "Crear Prompt"}</button>
                                </div>
                            </>
                        )}
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
