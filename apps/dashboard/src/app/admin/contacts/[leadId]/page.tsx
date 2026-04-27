"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PageHeader } from "@/components/ui/page-header";
import {
    ArrowLeft, User, Phone, Mail, Building2, Star, Tag,
    MessageSquare, CheckSquare, StickyNote, Clock, Plus,
    ChevronDown, CheckCircle, Circle, AlertCircle, Briefcase,
    TrendingUp, Calendar, Zap, Send, Edit2, Save, X,
    Archive, Loader2,
} from "lucide-react";

const STAGES: Record<string, { label: string; color: string }> = {
    nuevo: { label: "New", color: "#95a5a6" },
    contactado: { label: "Contacted", color: "#3498db" },
    respondio: { label: "Responded", color: "#9b59b6" },
    calificado: { label: "Qualified", color: "#f39c12" },
    tibio: { label: "Warm", color: "#e67e22" },
    caliente: { label: "Hot", color: "#e74c3c" },
    listo_cierre: { label: "Ready to close", color: "#27ae60" },
    ganado: { label: "Won", color: "#2ecc71" },
    perdido: { label: "Lost", color: "#7f8c8d" },
    no_interesado: { label: "Not interested", color: "#bdc3c7" },
};

const EVENT_ICONS: Record<string, typeof MessageSquare> = {
    note: StickyNote, task: CheckSquare, stage_change: TrendingUp, event: Zap, message: MessageSquare,
};

interface EditForm {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    stage: string;
    is_vip: boolean;
    tags: string;
}

export default function Lead360Page() {
    const params = useParams();
    const router = useRouter();
    const { activeTenantId } = useTenant();
    const t = useTranslations("contacts");
    const leadId = params?.leadId as string;

    const [lead360, setLead360] = useState<any>(null);
    const [timeline, setTimeline] = useState<any[]>([]);
    const [notes, setNotes] = useState<any[]>([]);
    const [tasks, setTasks] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<"timeline" | "notes" | "tasks">("timeline");
    const [loading, setLoading] = useState(true);

    const [newNote, setNewNote] = useState("");
    const [addingNote, setAddingNote] = useState(false);
    const [newTask, setNewTask] = useState({ title: "", dueAt: "", type: "follow_up" });
    const [addingTask, setAddingTask] = useState(false);

    // Edit mode state
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editForm, setEditForm] = useState<EditForm>({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        stage: "nuevo",
        is_vip: false,
        tags: "",
    });

    // Archive state
    const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
    const [archiving, setArchiving] = useState(false);

    const tenantId = activeTenantId;

    const load = useCallback(async () => {
        if (!tenantId || !leadId) return;
        setLoading(true);
        try {
            const [d1, d2, d3, d4] = await Promise.all([
                api.fetch(`/crm/leads/${tenantId}/${leadId}`),
                api.fetch(`/crm/timeline/${tenantId}/${leadId}`),
                api.fetch(`/crm/notes/${tenantId}/${leadId}`),
                api.fetch(`/crm/tasks/${tenantId}?leadId=${leadId}`),
            ]);
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

    const enterEditMode = () => {
        if (!lead360?.lead) return;
        const { lead, tags = [] } = lead360;
        setEditForm({
            first_name: lead.first_name || "",
            last_name: lead.last_name || "",
            email: lead.email || "",
            phone: lead.phone || "",
            stage: lead.stage || "nuevo",
            is_vip: !!lead.is_vip,
            tags: tags.map((tg: any) => tg.name).join(", "),
        });
        setEditing(true);
    };

    const cancelEdit = () => {
        setEditing(false);
    };

    const handleSave = async () => {
        if (!tenantId || !leadId) return;
        setSaving(true);
        try {
            const tagsArray = editForm.tags
                .split(",")
                .map((tg) => tg.trim())
                .filter(Boolean);
            await api.fetch(`/crm/leads/${tenantId}/${leadId}`, {
                method: "PUT",
                body: JSON.stringify({
                    first_name: editForm.first_name,
                    last_name: editForm.last_name,
                    email: editForm.email,
                    phone: editForm.phone,
                    stage: editForm.stage,
                    is_vip: editForm.is_vip,
                    tags: tagsArray,
                }),
            });
            setEditing(false);
            await load();
        } catch (e) {
            console.error("Error saving lead:", e);
        } finally {
            setSaving(false);
        }
    };

    const handleArchive = async () => {
        if (!tenantId || !leadId) return;
        setArchiving(true);
        try {
            await api.fetch(`/crm/leads/${tenantId}/${leadId}`, {
                method: "DELETE",
            });
            router.push("/admin/contacts");
        } catch (e) {
            console.error("Error archiving lead:", e);
            setArchiving(false);
            setShowArchiveConfirm(false);
        }
    };

    const handleAddNote = async () => {
        if (!newNote.trim() || !tenantId) return;
        setAddingNote(true);
        await api.fetch(`/crm/notes/${tenantId}`, { method: "POST", body: JSON.stringify({ leadId, content: newNote }) });
        setNewNote("");
        setAddingNote(false);
        load();
    };

    const handleAddTask = async () => {
        if (!newTask.title.trim() || !tenantId) return;
        setAddingTask(true);
        await api.fetch(`/crm/tasks/${tenantId}`, { method: "POST", body: JSON.stringify({ leadId, ...newTask }) });
        setNewTask({ title: "", dueAt: "", type: "follow_up" });
        setAddingTask(false);
        load();
    };

    const handleCompleteTask = async (taskId: string) => {
        if (!tenantId) return;
        await api.fetch(`/crm/tasks/${tenantId}/${taskId}/status`, { method: "PUT", body: JSON.stringify({ status: "done" }) });
        load();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[400px] gap-3 text-muted-foreground">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                {t("leadDetail.loading")}
            </div>
        );
    }

    const { lead, opportunities = [], tags = [] } = lead360 || {};
    if (!lead) return null;

    const stageInfo = STAGES[lead.stage] || STAGES.nuevo;
    const score = lead.score || 0;

    return (
        <div>
            <PageHeader
                title="Lead 360°"
                breadcrumbs={
                    <Breadcrumbs items={[
                        { label: "CRM", href: "/admin/contacts" },
                        { label: lead?.name || t("leadDetail.contact") },
                    ]} />
                }
            />

            <div className="grid grid-cols-[340px_1fr] gap-5">
                {/* === LEFT PANEL: Profile === */}
                <div className="flex flex-col gap-4">
                    {/* Profile Card */}
                    <div className="bg-card rounded-xl border border-border p-5">
                        {/* Header row with avatar, name, and action buttons */}
                        <div className="flex items-start gap-3.5 mb-4">
                            <div className="w-[52px] h-[52px] rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center text-white font-semibold text-xl shrink-0">
                                {(lead.first_name || "?").charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                                {!editing ? (
                                    <>
                                        <div className="font-semibold text-lg">{lead.first_name} {lead.last_name}</div>
                                        {lead.company_name && (
                                            <div className="text-[13px] text-muted-foreground flex items-center gap-1">
                                                <Building2 size={12} /> {lead.company_name}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        <input
                                            type="text"
                                            value={editForm.first_name}
                                            onChange={(e) => setEditForm((f) => ({ ...f, first_name: e.target.value }))}
                                            placeholder={t("leadDetail.firstName")}
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-muted text-foreground text-sm outline-none"
                                        />
                                        <input
                                            type="text"
                                            value={editForm.last_name}
                                            onChange={(e) => setEditForm((f) => ({ ...f, last_name: e.target.value }))}
                                            placeholder={t("leadDetail.lastName")}
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-muted text-foreground text-sm outline-none"
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                {!editing ? (
                                    <>
                                        <button
                                            onClick={enterEditMode}
                                            title={t("leadDetail.edit")}
                                            className="p-1.5 rounded-lg bg-transparent border-none cursor-pointer text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                                        >
                                            <Edit2 size={15} />
                                        </button>
                                        <button
                                            onClick={() => setShowArchiveConfirm(true)}
                                            title={t("leadDetail.archive")}
                                            className="p-1.5 rounded-lg bg-transparent border-none cursor-pointer text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                        >
                                            <Archive size={15} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={handleSave}
                                            disabled={saving}
                                            title={t("leadDetail.save")}
                                            className="p-1.5 rounded-lg bg-transparent border-none cursor-pointer text-emerald-500 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                                        >
                                            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                        </button>
                                        <button
                                            onClick={cancelEdit}
                                            title={t("leadDetail.cancel")}
                                            className="p-1.5 rounded-lg bg-transparent border-none cursor-pointer text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                        >
                                            <X size={15} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Score bar */}
                        <div className="mb-3.5">
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-muted-foreground">Score</span>
                                <span className="font-semibold" style={{ color: score >= 7 ? "#2ecc71" : score >= 4 ? "#f39c12" : "#e74c3c" }}>{score}/10</span>
                            </div>
                            <div className="h-1.5 rounded bg-muted overflow-hidden">
                                <div className="h-full rounded transition-[width] duration-500" style={{ width: `${score * 10}%`, background: score >= 7 ? "#2ecc71" : score >= 4 ? "#f39c12" : "#e74c3c" }} />
                            </div>
                        </div>

                        {/* Stage */}
                        {!editing ? (
                            <div>
                                <span className="px-3 py-1 rounded-full text-xs font-semibold" style={{ background: `${stageInfo.color}22`, color: stageInfo.color }}>
                                    {stageInfo.label}
                                </span>
                                {lead.is_vip && (
                                    <span className="ml-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: "rgba(255,215,0,0.12)", color: "#f1c40f" }}>
                                        VIP
                                    </span>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2.5">
                                <div>
                                    <label className="text-[11px] text-muted-foreground mb-1 block">{t("leadDetail.stage")}</label>
                                    <select
                                        value={editForm.stage}
                                        onChange={(e) => setEditForm((f) => ({ ...f, stage: e.target.value }))}
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-muted text-foreground text-sm outline-none"
                                    >
                                        {Object.entries(STAGES).map(([key, val]) => (
                                            <option key={key} value={key}>{val.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={editForm.is_vip}
                                        onChange={(e) => setEditForm((f) => ({ ...f, is_vip: e.target.checked }))}
                                        className="w-4 h-4 rounded border-border accent-primary"
                                    />
                                    <Star size={14} className="text-amber-400" />
                                    <span className="text-muted-foreground">{t("leadDetail.vip")}</span>
                                </label>
                            </div>
                        )}

                        {/* Contact info */}
                        {!editing ? (
                            <div className="mt-4 flex flex-col gap-2">
                                {lead.phone && (
                                    <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-[13px] text-muted-foreground no-underline">
                                        <Phone size={14} className="text-primary" /> {lead.phone}
                                    </a>
                                )}
                                {lead.email && (
                                    <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-[13px] text-muted-foreground no-underline">
                                        <Mail size={14} className="text-primary" /> {lead.email}
                                    </a>
                                )}
                            </div>
                        ) : (
                            <div className="mt-3 flex flex-col gap-2">
                                <div>
                                    <label className="text-[11px] text-muted-foreground mb-1 block">{t("leadDetail.email")}</label>
                                    <input
                                        type="email"
                                        value={editForm.email}
                                        onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                                        placeholder={t("leadDetail.email")}
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-muted text-foreground text-sm outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-muted-foreground mb-1 block">{t("leadDetail.phone")}</label>
                                    <input
                                        type="tel"
                                        value={editForm.phone}
                                        onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                                        placeholder={t("leadDetail.phone")}
                                        className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-muted text-foreground text-sm outline-none"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Tags */}
                        {!editing ? (
                            tags.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1">
                                    {tags.map((tg: any) => (
                                        <span key={tg.name} className="text-[10px] px-2 py-0.5 rounded font-semibold" style={{ background: `${tg.color}22`, color: tg.color }}>
                                            {tg.name}
                                        </span>
                                    ))}
                                </div>
                            )
                        ) : (
                            <div className="mt-3">
                                <label className="text-[11px] text-muted-foreground mb-1 block">{t("leadDetail.tags")}</label>
                                <input
                                    type="text"
                                    value={editForm.tags}
                                    onChange={(e) => setEditForm((f) => ({ ...f, tags: e.target.value }))}
                                    placeholder={t("leadDetail.tagsPlaceholder")}
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-muted text-foreground text-sm outline-none"
                                />
                            </div>
                        )}

                        {/* Save / Cancel buttons at bottom of card when editing */}
                        {editing && (
                            <div className="mt-4 flex gap-2">
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="flex-1 px-3 py-2 rounded-lg border-none bg-primary text-white font-semibold text-[13px] cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                                >
                                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                    {t("leadDetail.save")}
                                </button>
                                <button
                                    onClick={cancelEdit}
                                    className="px-3 py-2 rounded-lg border border-border bg-transparent text-muted-foreground font-semibold text-[13px] cursor-pointer flex items-center justify-center gap-1.5 hover:bg-muted transition-colors"
                                >
                                    <X size={14} />
                                    {t("leadDetail.cancel")}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Opportunities */}
                    <div className="bg-card rounded-xl border border-border p-4">
                        <h3 className="m-0 mb-3 text-sm font-semibold flex items-center gap-1.5">
                            <Briefcase size={14} className="text-primary" /> {t("leadDetail.opportunities")}
                        </h3>
                        {opportunities.length === 0 ? (
                            <p className="text-[13px] text-muted-foreground m-0">{t("leadDetail.noOpportunities")}</p>
                        ) : opportunities.map((op: any) => (
                            <div key={op.id} className="py-2 border-b border-border">
                                <div className="text-[13px] font-semibold">{op.course_name || t("leadDetail.opportunity")}</div>
                                <div className="flex gap-2 mt-1">
                                    <span className="text-[11px] text-muted-foreground">{STAGES[op.stage]?.label || op.stage}</span>
                                    {op.estimated_value && (
                                        <span className="text-[11px] font-semibold text-emerald-500">
                                            ${Number(op.estimated_value).toLocaleString()} COP
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* === RIGHT PANEL: Timeline / Notes / Tasks === */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                    {/* Tabs */}
                    <div className="flex border-b border-border">
                        {[
                            { key: "timeline", label: "Timeline", icon: Clock },
                            { key: "notes", label: `Notes (${notes.length})`, icon: StickyNote },
                            { key: "tasks", label: `Tasks (${tasks.filter((tk: any) => tk.status !== "done").length})`, icon: CheckSquare },
                        ].map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key as any)}
                                className={cn(
                                    "flex-1 px-4 py-3 border-none cursor-pointer text-[13px] flex items-center justify-center gap-1.5 border-b-2",
                                    activeTab === tab.key
                                        ? "bg-muted text-primary font-semibold border-b-primary"
                                        : "bg-transparent text-muted-foreground font-normal border-b-transparent"
                                )}
                            >
                                <tab.icon size={14} /> {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="p-5 max-h-[calc(100vh-280px)] overflow-y-auto">
                        {/* TIMELINE */}
                        {activeTab === "timeline" && (
                            <div className="flex flex-col gap-3">
                                {timeline.length === 0 && (
                                    <p className="text-muted-foreground text-center py-10">No activity recorded yet.</p>
                                )}
                                {timeline.map((event: any, i: number) => {
                                    const Icon = EVENT_ICONS[event.event_type] || Zap;
                                    return (
                                        <div key={i} className="flex gap-3">
                                            <div className="w-8 h-8 rounded-full shrink-0 bg-muted border border-border flex items-center justify-center">
                                                <Icon size={14} className="text-primary" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="text-[13px]">{event.description}</div>
                                                <div className="text-[11px] text-muted-foreground mt-0.5">
                                                    {event.actor && <span className="mr-1.5">{event.actor}</span>}
                                                    {new Date(event.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* NOTES */}
                        {activeTab === "notes" && (
                            <div>
                                <div className="mb-4 flex flex-col gap-2">
                                    <textarea
                                        value={newNote}
                                        onChange={e => setNewNote(e.target.value)}
                                        placeholder="Add an internal note..."
                                        rows={3}
                                        className="w-full px-3 py-2.5 rounded-lg border border-border bg-muted text-foreground text-[13px] resize-y outline-none box-border"
                                    />
                                    <button
                                        onClick={handleAddNote}
                                        disabled={addingNote || !newNote.trim()}
                                        className={cn(
                                            "self-end px-4 py-2 rounded-lg border-none bg-primary text-white font-semibold text-[13px] cursor-pointer flex items-center gap-1.5",
                                            !newNote.trim() && "opacity-50"
                                        )}
                                    >
                                        <Send size={14} /> Save note
                                    </button>
                                </div>
                                {notes.map((note: any) => (
                                    <div key={note.id} className="p-3 rounded-[10px] bg-muted mb-2.5 border-l-[3px] border-l-amber-500">
                                        <p className="m-0 mb-1 text-sm leading-relaxed">{note.content}</p>
                                        <span className="text-[11px] text-muted-foreground">
                                            {note.created_by && `${note.created_by} · `}
                                            {new Date(note.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                    </div>
                                ))}
                                {notes.length === 0 && (
                                    <p className="text-muted-foreground text-center py-8">No notes yet.</p>
                                )}
                            </div>
                        )}

                        {/* TASKS */}
                        {activeTab === "tasks" && (
                            <div>
                                <div className="mb-4 p-3 bg-muted rounded-[10px] flex flex-col gap-2">
                                    <input
                                        value={newTask.title}
                                        onChange={e => setNewTask(tk => ({ ...tk, title: e.target.value }))}
                                        placeholder="New task... (e.g.: Call client)"
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-[13px] outline-none box-border"
                                    />
                                    <div className="flex gap-2">
                                        <select
                                            value={newTask.type}
                                            onChange={e => setNewTask(tk => ({ ...tk, type: e.target.value }))}
                                            className="flex-1 px-2.5 py-2 rounded-lg border border-border bg-card text-foreground text-xs outline-none"
                                        >
                                            <option value="follow_up">Follow-up</option>
                                            <option value="call">Call</option>
                                            <option value="email">Email</option>
                                            <option value="meeting">Meeting</option>
                                            <option value="handoff">Handoff</option>
                                        </select>
                                        <input
                                            type="datetime-local"
                                            value={newTask.dueAt}
                                            onChange={e => setNewTask(tk => ({ ...tk, dueAt: e.target.value }))}
                                            className="flex-1 px-2.5 py-2 rounded-lg border border-border bg-card text-foreground text-xs outline-none"
                                        />
                                        <button
                                            onClick={handleAddTask}
                                            disabled={addingTask || !newTask.title.trim()}
                                            className={cn(
                                                "px-3.5 py-2 rounded-lg border-none bg-primary text-white font-semibold text-xs cursor-pointer",
                                                !newTask.title.trim() && "opacity-50"
                                            )}
                                        >
                                            <Plus size={14} />
                                        </button>
                                    </div>
                                </div>

                                {tasks.map((task: any) => (
                                    <div key={task.id} className={cn("flex items-start gap-2.5 py-2.5 border-b border-border", task.status === "done" && "opacity-50")}>
                                        <button onClick={() => handleCompleteTask(task.id)} className="bg-transparent border-none cursor-pointer p-0.5 mt-px">
                                            {task.status === "done"
                                                ? <CheckCircle size={18} color="#2ecc71" />
                                                : <Circle size={18} className="text-muted-foreground" />
                                            }
                                        </button>
                                        <div className="flex-1">
                                            <div className={cn("text-sm font-medium", task.status === "done" && "line-through")}>
                                                {task.title}
                                            </div>
                                            <div className="flex gap-2 mt-0.5">
                                                <span className="text-[11px] text-muted-foreground">{task.type}</span>
                                                {task.due_at && (
                                                    <span className={cn("text-[11px] flex items-center gap-0.5", new Date(task.due_at) < new Date() && task.status !== "done" ? "text-red-500" : "text-muted-foreground")}>
                                                        <Calendar size={10} /> {new Date(task.due_at).toLocaleDateString(undefined)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {tasks.length === 0 && (
                                    <p className="text-muted-foreground text-center py-8">No tasks created.</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Archive Confirmation Dialog */}
            {showArchiveConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => !archiving && setShowArchiveConfirm(false)}>
                    <div className="bg-card rounded-xl border border-border p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                                <Archive size={20} className="text-red-500" />
                            </div>
                            <div>
                                <h3 className="m-0 text-base font-semibold">{t("leadDetail.archiveTitle")}</h3>
                                <p className="m-0 text-[13px] text-muted-foreground">{t("leadDetail.archiveMessage")}</p>
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setShowArchiveConfirm(false)}
                                disabled={archiving}
                                className="px-4 py-2 rounded-lg border border-border bg-transparent text-muted-foreground font-semibold text-[13px] cursor-pointer hover:bg-muted transition-colors"
                            >
                                {t("leadDetail.cancel")}
                            </button>
                            <button
                                onClick={handleArchive}
                                disabled={archiving}
                                className="px-4 py-2 rounded-lg border-none bg-red-500 text-white font-semibold text-[13px] cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                            >
                                {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                                {t("leadDetail.confirmArchive")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
