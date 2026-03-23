"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import {
    ArrowLeft, User, Phone, Mail, Building2, Star, Tag,
    MessageSquare, CheckSquare, StickyNote, Clock, Plus,
    ChevronDown, CheckCircle, Circle, AlertCircle, Briefcase,
    TrendingUp, Calendar, Zap, Send,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1";

const STAGES: Record<string, { label: string; color: string }> = {
    nuevo: { label: "Nuevo", color: "#95a5a6" },
    contactado: { label: "Contactado", color: "#3498db" },
    respondio: { label: "Respondió", color: "#9b59b6" },
    calificado: { label: "Calificado", color: "#f39c12" },
    tibio: { label: "Tibio", color: "#e67e22" },
    caliente: { label: "Caliente", color: "#e74c3c" },
    listo_cierre: { label: "Listo para cierre", color: "#27ae60" },
    ganado: { label: "Ganado", color: "#2ecc71" },
    perdido: { label: "Perdido", color: "#7f8c8d" },
    no_interesado: { label: "No interesado", color: "#bdc3c7" },
};

const EVENT_ICONS: Record<string, typeof MessageSquare> = {
    note: StickyNote,
    task: CheckSquare,
    stage_change: TrendingUp,
    event: Zap,
    message: MessageSquare,
};

export default function Lead360Page() {
    const params = useParams();
    const router = useRouter();
    const { activeTenantId } = useTenant();
    const leadId = params?.leadId as string;

    const [lead360, setLead360] = useState<any>(null);
    const [timeline, setTimeline] = useState<any[]>([]);
    const [notes, setNotes] = useState<any[]>([]);
    const [tasks, setTasks] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<"timeline" | "notes" | "tasks">("timeline");
    const [loading, setLoading] = useState(true);

    // Note/Task input states
    const [newNote, setNewNote] = useState("");
    const [addingNote, setAddingNote] = useState(false);
    const [newTask, setNewTask] = useState({ title: "", dueAt: "", type: "follow_up" });
    const [addingTask, setAddingTask] = useState(false);

    const tenantId = activeTenantId;

    const load = useCallback(async () => {
        if (!tenantId || !leadId) return;
        setLoading(true);
        try {
            const [r1, r2, r3, r4] = await Promise.all([
                fetch(`${API}/crm/leads/${tenantId}/${leadId}`),
                fetch(`${API}/crm/timeline/${tenantId}/${leadId}`),
                fetch(`${API}/crm/notes/${tenantId}/${leadId}`),
                fetch(`${API}/crm/tasks/${tenantId}?leadId=${leadId}`),
            ]);
            const [d1, d2, d3, d4] = await Promise.all([r1.json(), r2.json(), r3.json(), r4.json()]);
            setLead360(d1.data);
            setTimeline(d2.data || []);
            setNotes(d3.data || []);
            setTasks(d4.data || []);
        } catch (e) {
            console.error("Error loading Lead 360:", e);
        } finally {
            setLoading(false);
        }
    }, [tenantId, leadId]);

    useEffect(() => { load(); }, [load]);

    const handleAddNote = async () => {
        if (!newNote.trim() || !tenantId) return;
        setAddingNote(true);
        await fetch(`${API}/crm/notes/${tenantId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leadId, content: newNote }),
        });
        setNewNote("");
        setAddingNote(false);
        load();
    };

    const handleAddTask = async () => {
        if (!newTask.title.trim() || !tenantId) return;
        setAddingTask(true);
        await fetch(`${API}/crm/tasks/${tenantId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leadId, ...newTask }),
        });
        setNewTask({ title: "", dueAt: "", type: "follow_up" });
        setAddingTask(false);
        load();
    };

    const handleCompleteTask = async (taskId: string) => {
        if (!tenantId) return;
        await fetch(`${API}/crm/tasks/${tenantId}/${taskId}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "done" }),
        });
        load();
    };

    if (loading) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, gap: 12, color: "var(--text-secondary)" }}>
                <div style={{ width: 24, height: 24, border: "2px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                Cargando perfil...
            </div>
        );
    }

    const { lead, opportunities = [], tags = [] } = lead360 || {};
    if (!lead) return null;

    const stageInfo = STAGES[lead.stage] || STAGES.nuevo;
    const score = lead.score || 0;

    return (
        <div>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                <button
                    onClick={() => router.back()}
                    style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}
                >
                    <ArrowLeft size={16} /> Volver
                </button>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Lead 360°</h1>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 20 }}>

                {/* === LEFT PANEL: Profile === */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                    {/* Profile Card */}
                    <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                            <div style={{
                                width: 52, height: 52, borderRadius: "50%",
                                background: "linear-gradient(135deg, var(--accent), #9b59b6)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                color: "white", fontWeight: 700, fontSize: 20, flexShrink: 0,
                            }}>
                                {(lead.first_name || "?").charAt(0)}
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: 18 }}>{lead.first_name} {lead.last_name}</div>
                                {lead.company_name && (
                                    <div style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
                                        <Building2 size={12} /> {lead.company_name}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Score bar */}
                        <div style={{ marginBottom: 14 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                                <span style={{ color: "var(--text-secondary)" }}>Score</span>
                                <span style={{ fontWeight: 700, color: score >= 7 ? "#2ecc71" : score >= 4 ? "#f39c12" : "#e74c3c" }}>{score}/10</span>
                            </div>
                            <div style={{ height: 6, borderRadius: 4, background: "var(--bg-tertiary)", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${score * 10}%`, background: score >= 7 ? "#2ecc71" : score >= 4 ? "#f39c12" : "#e74c3c", borderRadius: 4, transition: "width 0.5s" }} />
                            </div>
                        </div>

                        {/* Stage */}
                        <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: `${stageInfo.color}22`, color: stageInfo.color }}>
                            {stageInfo.label}
                        </span>
                        {lead.is_vip && (
                            <span style={{ marginLeft: 6, padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "rgba(255,215,0,0.12)", color: "#f1c40f" }}>
                                ⭐ VIP
                            </span>
                        )}

                        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                            {lead.phone && (
                                <a href={`tel:${lead.phone}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}>
                                    <Phone size={14} color="var(--accent)" /> {lead.phone}
                                </a>
                            )}
                            {lead.email && (
                                <a href={`mailto:${lead.email}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}>
                                    <Mail size={14} color="var(--accent)" /> {lead.email}
                                </a>
                            )}
                        </div>

                        {tags.length > 0 && (
                            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {tags.map((t: any) => (
                                    <span key={t.name} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: `${t.color}22`, color: t.color, fontWeight: 600 }}>
                                        {t.name}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Opportunities */}
                    <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 16 }}>
                        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                            <Briefcase size={14} color="var(--accent)" /> Oportunidades
                        </h3>
                        {opportunities.length === 0 ? (
                            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>Sin oportunidades</p>
                        ) : opportunities.map((op: any) => (
                            <div key={op.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>{op.course_name || "Oportunidad"}</div>
                                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                                    <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{STAGES[op.stage]?.label || op.stage}</span>
                                    {op.estimated_value && (
                                        <span style={{ fontSize: 11, fontWeight: 600, color: "#2ecc71" }}>
                                            ${Number(op.estimated_value).toLocaleString()} COP
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* === RIGHT PANEL: Timeline / Notes / Tasks === */}
                <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
                    {/* Tabs */}
                    <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
                        {[
                            { key: "timeline", label: "Timeline", icon: Clock },
                            { key: "notes", label: `Notas (${notes.length})`, icon: StickyNote },
                            { key: "tasks", label: `Tareas (${tasks.filter((t: any) => t.status !== "done").length})`, icon: CheckSquare },
                        ].map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key as any)}
                                style={{
                                    flex: 1, padding: "12px 16px", border: "none", cursor: "pointer",
                                    background: activeTab === tab.key ? "var(--bg-tertiary)" : "transparent",
                                    color: activeTab === tab.key ? "var(--accent)" : "var(--text-secondary)",
                                    fontWeight: activeTab === tab.key ? 600 : 400, fontSize: 13,
                                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                                    borderBottom: activeTab === tab.key ? "2px solid var(--accent)" : "2px solid transparent",
                                }}
                            >
                                <tab.icon size={14} /> {tab.label}
                            </button>
                        ))}
                    </div>

                    <div style={{ padding: 20, maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>

                        {/* ---- TIMELINE ---- */}
                        {activeTab === "timeline" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                {timeline.length === 0 && (
                                    <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: "40px 0" }}>Sin actividad registrada aún.</p>
                                )}
                                {timeline.map((event: any, i: number) => {
                                    const Icon = EVENT_ICONS[event.event_type] || Zap;
                                    return (
                                        <div key={i} style={{ display: "flex", gap: 12 }}>
                                            <div style={{
                                                width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                                                background: "var(--bg-tertiary)", border: "1px solid var(--border)",
                                                display: "flex", alignItems: "center", justifyContent: "center",
                                            }}>
                                                <Icon size={14} color="var(--accent)" />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 13 }}>{event.description}</div>
                                                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                                                    {event.actor && <span style={{ marginRight: 6 }}>{event.actor}</span>}
                                                    {new Date(event.created_at).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* ---- NOTES ---- */}
                        {activeTab === "notes" && (
                            <div>
                                {/* Add note */}
                                <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                                    <textarea
                                        value={newNote}
                                        onChange={e => setNewNote(e.target.value)}
                                        placeholder="Agregar una nota interna..."
                                        rows={3}
                                        style={{
                                            width: "100%", padding: "10px 12px", borderRadius: 8,
                                            border: "1px solid var(--border)", background: "var(--bg-tertiary)",
                                            color: "var(--text-primary)", fontSize: 13, resize: "vertical",
                                            outline: "none", boxSizing: "border-box",
                                        }}
                                    />
                                    <button
                                        onClick={handleAddNote}
                                        disabled={addingNote || !newNote.trim()}
                                        style={{
                                            alignSelf: "flex-end", padding: "8px 16px", borderRadius: 8,
                                            border: "none", background: "var(--accent)", color: "white",
                                            fontWeight: 600, fontSize: 13, cursor: "pointer",
                                            display: "flex", alignItems: "center", gap: 6,
                                            opacity: !newNote.trim() ? 0.5 : 1,
                                        }}
                                    >
                                        <Send size={14} /> Guardar nota
                                    </button>
                                </div>

                                {/* Notes list */}
                                {notes.map((note: any) => (
                                    <div key={note.id} style={{
                                        padding: 12, borderRadius: 10, background: "var(--bg-tertiary)",
                                        marginBottom: 10, borderLeft: "3px solid #f39c12",
                                    }}>
                                        <p style={{ margin: "0 0 4px", fontSize: 14, lineHeight: 1.5 }}>{note.content}</p>
                                        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                                            {note.created_by && `${note.created_by} · `}
                                            {new Date(note.created_at).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                    </div>
                                ))}
                                {notes.length === 0 && (
                                    <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: "30px 0" }}>Sin notas aún.</p>
                                )}
                            </div>
                        )}

                        {/* ---- TASKS ---- */}
                        {activeTab === "tasks" && (
                            <div>
                                {/* Add task */}
                                <div style={{ marginBottom: 16, padding: 12, background: "var(--bg-tertiary)", borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                                    <input
                                        value={newTask.title}
                                        onChange={e => setNewTask(t => ({ ...t, title: e.target.value }))}
                                        placeholder="Nueva tarea... (ej: Llamar al cliente)"
                                        style={{
                                            width: "100%", padding: "8px 12px", borderRadius: 8,
                                            border: "1px solid var(--border)", background: "var(--bg-secondary)",
                                            color: "var(--text-primary)", fontSize: 13, outline: "none", boxSizing: "border-box",
                                        }}
                                    />
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <select
                                            value={newTask.type}
                                            onChange={e => setNewTask(t => ({ ...t, type: e.target.value }))}
                                            style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 12, outline: "none" }}
                                        >
                                            <option value="follow_up">Follow-up</option>
                                            <option value="call">Llamada</option>
                                            <option value="email">Email</option>
                                            <option value="meeting">Reunión</option>
                                            <option value="handoff">Handoff</option>
                                        </select>
                                        <input
                                            type="datetime-local"
                                            value={newTask.dueAt}
                                            onChange={e => setNewTask(t => ({ ...t, dueAt: e.target.value }))}
                                            style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 12, outline: "none" }}
                                        />
                                        <button
                                            onClick={handleAddTask}
                                            disabled={addingTask || !newTask.title.trim()}
                                            style={{
                                                padding: "8px 14px", borderRadius: 8,
                                                border: "none", background: "var(--accent)", color: "white",
                                                fontWeight: 600, fontSize: 12, cursor: "pointer",
                                                opacity: !newTask.title.trim() ? 0.5 : 1,
                                            }}
                                        >
                                            <Plus size={14} />
                                        </button>
                                    </div>
                                </div>

                                {/* Tasks list */}
                                {tasks.map((task: any) => (
                                    <div key={task.id} style={{
                                        display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0",
                                        borderBottom: "1px solid var(--border)",
                                        opacity: task.status === "done" ? 0.5 : 1,
                                    }}>
                                        <button onClick={() => handleCompleteTask(task.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, marginTop: 1 }}>
                                            {task.status === "done"
                                                ? <CheckCircle size={18} color="#2ecc71" />
                                                : <Circle size={18} color="var(--text-secondary)" />
                                            }
                                        </button>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 14, fontWeight: 500, textDecoration: task.status === "done" ? "line-through" : "none" }}>
                                                {task.title}
                                            </div>
                                            <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                                                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{task.type}</span>
                                                {task.due_at && (
                                                    <span style={{ fontSize: 11, color: new Date(task.due_at) < new Date() && task.status !== "done" ? "#e74c3c" : "var(--text-secondary)", display: "flex", alignItems: "center", gap: 2 }}>
                                                        <Calendar size={10} /> {new Date(task.due_at).toLocaleDateString("es-CO")}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {tasks.length === 0 && (
                                    <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: "30px 0" }}>Sin tareas creadas.</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
