"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import {
    Shield, FileText, UserCheck, UserX, Trash2, Plus, X, Eye, Check
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1";

type Tab = "legal" | "consents" | "optouts" | "deletions";

export default function CompliancePage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [tab, setTab] = useState<Tab>("legal");
    const [legalTexts, setLegalTexts] = useState<any[]>([]);
    const [consents, setConsents] = useState<any[]>([]);
    const [optOuts, setOptOuts] = useState<any[]>([]);
    const [deletions, setDeletions] = useState<any[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    // Legal text form
    const [legalForm, setLegalForm] = useState({ channel: "web", version: 1, text: "" });
    // Opt-out form
    const [optOutForm, setOptOutForm] = useState({ lead_id: "", channel: "whatsapp", reason: "" });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!activeTenantId) return;
        loadAll();
    }, [activeTenantId]);

    async function loadAll() {
        try {
            const [lt, co, oo, dr] = await Promise.all([
                fetch(`${API}/compliance/legal-texts/${activeTenantId}`).then(r => r.json()),
                fetch(`${API}/compliance/consents/${activeTenantId}`).then(r => r.json()),
                fetch(`${API}/compliance/opt-outs/${activeTenantId}`).then(r => r.json()),
                fetch(`${API}/compliance/deletion-requests/${activeTenantId}`).then(r => r.json()),
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
            const res = await fetch(`${API}/compliance/legal-texts/${activeTenantId}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(legalForm)
            });
            const created = await res.json();
            if (created?.id) { setLegalTexts(prev => [created, ...prev]); setShowModal(false); setToast("Texto legal creado"); setTimeout(() => setToast(null), 2500); }
        } catch (err) { console.error(err); } finally { setSaving(false); }
    };

    const handleCreateOptOut = async () => {
        if (!optOutForm.lead_id || !activeTenantId) return;
        setSaving(true);
        try {
            const res = await fetch(`${API}/compliance/opt-outs/${activeTenantId}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(optOutForm)
            });
            const created = await res.json();
            if (created?.id) { setOptOuts(prev => [created, ...prev]); setShowModal(false); setToast("Opt-out registrado"); setTimeout(() => setToast(null), 2500); }
        } catch (err) { console.error(err); } finally { setSaving(false); }
    };

    const handleProcessDeletion = async (id: string) => {
        try {
            await fetch(`${API}/compliance/deletion-requests/${activeTenantId}/${id}/process`, { method: "PUT" });
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                            <Shield size={28} color="var(--accent)" /> Compliance & Audit
                        </h1>
                        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>Trazabilidad legal, consentimiento y privacidad</p>
                    </div>
                    {(tab === "legal" || tab === "optouts") && (
                        <button onClick={() => setShowModal(true)} style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
                            borderRadius: 10, border: "none", background: "var(--accent)", color: "white",
                            fontWeight: 600, fontSize: 14, cursor: "pointer",
                        }}><Plus size={18} /> {tab === "legal" ? "Nuevo Texto Legal" : "Registrar Opt-Out"}</button>
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

                {/* Content */}
                {tab === "legal" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {legalTexts.map(lt => (
                            <div key={lt.id} style={{ padding: "14px 20px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <FileText size={16} color="var(--accent)" />
                                        <span style={{ fontWeight: 600 }}>v{lt.version}</span>
                                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#3498db22", color: "#3498db" }}>{lt.channel}</span>
                                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: lt.active ? "#2ecc7122" : "#e74c3c22", color: lt.active ? "#2ecc71" : "#e74c3c" }}>{lt.active ? "Activo" : "Inactivo"}</span>
                                    </div>
                                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{new Date(lt.created_at).toLocaleDateString()}</span>
                                </div>
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 8, lineHeight: 1.5 }}>{lt.text?.substring(0, 200)}{lt.text?.length > 200 ? "..." : ""}</p>
                            </div>
                        ))}
                        {legalTexts.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>No hay textos legales configurados.</div>}
                    </div>
                )}

                {tab === "consents" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {consents.map(c => (
                            <div key={c.id} style={{ padding: "12px 20px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-secondary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                    <span style={{ fontWeight: 600, fontSize: 13 }}>Lead: {c.lead_id?.substring(0, 8) || "N/A"}...</span>
                                    <span style={{ marginLeft: 12, fontSize: 12, color: "var(--text-secondary)" }}>Canal: {c.channel} · v{c.legal_text_version}</span>
                                </div>
                                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{new Date(c.granted_at).toLocaleString()}</span>
                            </div>
                        ))}
                        {consents.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>No hay consentimientos registrados aún.</div>}
                    </div>
                )}

                {tab === "optouts" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {optOuts.map(o => (
                            <div key={o.id} style={{ padding: "12px 20px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-secondary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                    <span style={{ fontWeight: 600, fontSize: 13 }}>Lead: {o.lead_id?.substring(0, 8) || "N/A"}...</span>
                                    <span style={{ marginLeft: 12, fontSize: 12, padding: "2px 8px", borderRadius: 6, background: "#e74c3c22", color: "#e74c3c" }}>{o.channel}</span>
                                    <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-secondary)" }}>{o.scope} — {o.reason || "Sin razón"}</span>
                                </div>
                                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{new Date(o.created_at).toLocaleString()}</span>
                            </div>
                        ))}
                        {optOuts.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>No hay opt-outs registrados.</div>}
                    </div>
                )}

                {tab === "deletions" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {deletions.map(d => (
                            <div key={d.id} style={{ padding: "12px 20px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-secondary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                    <span style={{ fontWeight: 600, fontSize: 13 }}>Lead: {d.lead_id?.substring(0, 8) || "N/A"}...</span>
                                    <span style={{ marginLeft: 12, fontSize: 11, padding: "2px 8px", borderRadius: 6, background: d.status === "processed" ? "#2ecc7122" : "#f39c1222", color: d.status === "processed" ? "#2ecc71" : "#f39c12" }}>{d.status}</span>
                                    <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-secondary)" }}>Solicitado por: {d.requested_by || "Sistema"}</span>
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{new Date(d.requested_at).toLocaleDateString()}</span>
                                    {d.status === "pending" && (
                                        <button onClick={() => handleProcessDeletion(d.id)} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#2ecc71", color: "white", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                                            <Check size={12} /> Procesar
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {deletions.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>No hay solicitudes de borrado.</div>}
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 480, padding: 28, borderRadius: 18, background: "var(--bg-secondary)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{tab === "legal" ? "Nuevo Texto Legal" : "Registrar Opt-Out"}</h2>
                            <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}><X size={20} /></button>
                        </div>

                        {tab === "legal" && (
                            <>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Canal</label>
                                    <select value={legalForm.channel} onChange={e => setLegalForm(p => ({ ...p, channel: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                                        <option value="web">Web</option>
                                        <option value="whatsapp">WhatsApp</option>
                                        <option value="email">Email</option>
                                    </select>
                                </div>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Versión</label>
                                    <input type="number" value={legalForm.version} onChange={e => setLegalForm(p => ({ ...p, version: parseInt(e.target.value) || 1 }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                                </div>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Texto Legal</label>
                                    <textarea value={legalForm.text} onChange={e => setLegalForm(p => ({ ...p, text: e.target.value }))} rows={5} placeholder="Acepto los términos y condiciones de tratamiento de datos personales..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box", resize: "vertical" }} />
                                </div>
                                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                                    <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer" }}>Cancelar</button>
                                    <button onClick={handleCreateLegal} disabled={saving || !legalForm.text} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: saving ? "var(--border)" : "var(--accent)", color: "white", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}>{saving ? "Guardando..." : "Crear Texto"}</button>
                                </div>
                            </>
                        )}

                        {tab === "optouts" && (
                            <>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Lead ID</label>
                                    <input value={optOutForm.lead_id} onChange={e => setOptOutForm(p => ({ ...p, lead_id: e.target.value }))} placeholder="UUID del lead" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                                </div>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Canal</label>
                                    <select value={optOutForm.channel} onChange={e => setOptOutForm(p => ({ ...p, channel: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                                        <option value="whatsapp">WhatsApp</option>
                                        <option value="email">Email</option>
                                        <option value="sms">SMS</option>
                                    </select>
                                </div>
                                <div style={{ marginBottom: 12 }}>
                                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Razón</label>
                                    <input value={optOutForm.reason} onChange={e => setOptOutForm(p => ({ ...p, reason: e.target.value }))} placeholder="Solicitud del usuario" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                                </div>
                                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                                    <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer" }}>Cancelar</button>
                                    <button onClick={handleCreateOptOut} disabled={saving || !optOutForm.lead_id} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: saving ? "var(--border)" : "#e74c3c", color: "white", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}>{saving ? "Guardando..." : "Registrar Opt-Out"}</button>
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
