"use client";

/**
 * Treatment Plans card — collapsible panel that shows the contact's active
 * multi-session treatments with progress and upcoming sessions. Renders
 * inside the lead-detail page; only visible when the tenant's vertical is
 * `salud` (the parent decides whether to mount this component).
 */

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import {
    Activity, ChevronDown, ChevronUp, Plus, Check, X, Trash2, AlertCircle,
} from "lucide-react";

interface TreatmentPlan {
    id: string;
    name: string;
    plan_type?: string;
    total_sessions: number;
    completed_sessions: number;
    frequency_days?: number;
    total_cost?: number;
    currency: string;
    started_at?: string;
    expected_end_at?: string;
    completed_at?: string;
    status: "active" | "completed" | "paused" | "cancelled";
    notes?: string;
}

interface TreatmentSession {
    id: string;
    plan_id: string;
    session_number: number;
    scheduled_at?: string;
    completed_at?: string;
    status: "pending" | "scheduled" | "completed" | "cancelled" | "no_show";
    notes?: string;
}

const PLAN_TYPE_KEYS = [
    "ortodoncia",
    "blanqueamiento",
    "limpieza_serie",
    "fisioterapia",
    "estetica",
    "psicologia",
    "otro",
];

export function TreatmentPlansCard({
    tenantId, contactId,
}: {
    tenantId: string;
    contactId: string;
}) {
    const t = useTranslations("treatmentPlans");
    const tc = useTranslations("common");
    const [plans, setPlans] = useState<TreatmentPlan[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [expandedPlan, setExpandedPlan] = useState<string | null>(null);

    useEffect(() => {
        if (!open || loaded) return;
        loadPlans();
    }, [open]);

    async function loadPlans() {
        const res = await api.listTreatmentPlans(tenantId, contactId);
        if (res.success && Array.isArray(res.data)) setPlans(res.data);
        setLoaded(true);
    }

    const activePlans = plans.filter(p => p.status === "active");
    const otherPlans = plans.filter(p => p.status !== "active");

    return (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 mb-4">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Activity size={16} className="text-indigo-500" />
                    <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</span>
                    {loaded && activePlans.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                            {activePlans.length} {t("active")}
                        </span>
                    )}
                </div>
                {open ? <ChevronUp size={16} className="text-neutral-400" /> : <ChevronDown size={16} className="text-neutral-400" />}
            </button>

            {open && (
                <div className="border-t border-neutral-100 dark:border-neutral-800 p-4 space-y-3">
                    {!loaded ? (
                        <p className="text-xs text-neutral-500 text-center py-4">{tc("loading")}</p>
                    ) : (
                        <>
                            {plans.length === 0 ? (
                                <div className="text-center py-6">
                                    <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">{t("emptyDesc")}</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {[...activePlans, ...otherPlans].map(p => (
                                        <PlanRow
                                            key={p.id}
                                            plan={p}
                                            tenantId={tenantId}
                                            isExpanded={expandedPlan === p.id}
                                            onToggle={() => setExpandedPlan(expandedPlan === p.id ? null : p.id)}
                                            onChanged={loadPlans}
                                            t={t}
                                            tc={tc}
                                        />
                                    ))}
                                </div>
                            )}

                            <button
                                onClick={() => setShowCreate(true)}
                                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                            >
                                <Plus size={14} /> {t("createPlan")}
                            </button>
                        </>
                    )}
                </div>
            )}

            {showCreate && (
                <CreatePlanModal
                    tenantId={tenantId}
                    contactId={contactId}
                    onClose={() => setShowCreate(false)}
                    onCreated={() => {
                        setShowCreate(false);
                        loadPlans();
                    }}
                    t={t}
                    tc={tc}
                />
            )}
        </div>
    );
}

function PlanRow({
    plan, tenantId, isExpanded, onToggle, onChanged, t, tc,
}: {
    plan: TreatmentPlan;
    tenantId: string;
    isExpanded: boolean;
    onToggle: () => void;
    onChanged: () => void;
    t: any;
    tc: any;
}) {
    const [sessions, setSessions] = useState<TreatmentSession[]>([]);
    const [sessionsLoaded, setSessionsLoaded] = useState(false);
    const progressPct = plan.total_sessions > 0
        ? Math.round((plan.completed_sessions / plan.total_sessions) * 100)
        : 0;

    useEffect(() => {
        if (!isExpanded || sessionsLoaded) return;
        loadSessions();
    }, [isExpanded]);

    async function loadSessions() {
        const res = await api.getTreatmentPlan(tenantId, plan.id);
        if (res.success && res.data?.sessions) {
            setSessions(res.data.sessions);
        }
        setSessionsLoaded(true);
    }

    async function completeSession(id: string) {
        await api.completeTreatmentSession(tenantId, id);
        await loadSessions();
        onChanged();
    }

    async function addSession() {
        await api.addTreatmentSession(tenantId, plan.id, {});
        await loadSessions();
        onChanged();
    }

    async function cancelPlan() {
        if (!confirm(t("cancelPlanConfirm"))) return;
        await api.cancelTreatmentPlan(tenantId, plan.id);
        onChanged();
    }

    const statusColor = {
        active: "text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400",
        completed: "text-neutral-600 bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-400",
        paused: "text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400",
        cancelled: "text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400",
    }[plan.status] || "";

    return (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full text-left px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
            >
                <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 flex-1 truncate">{plan.name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColor}`}>
                        {t(`status.${plan.status}`)}
                    </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400 mb-1">
                    <span>{plan.completed_sessions}/{plan.total_sessions} {t("sessionsShort")}</span>
                    {plan.total_cost ? <span>· {plan.currency} {Number(plan.total_cost).toLocaleString()}</span> : null}
                </div>
                <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                    <div
                        className={`h-full transition-all ${plan.status === "active" ? "bg-indigo-500" : "bg-neutral-400 dark:bg-neutral-600"}`}
                        style={{ width: `${progressPct}%` }}
                    />
                </div>
            </button>

            {isExpanded && (
                <div className="border-t border-neutral-100 dark:border-neutral-800 px-3 py-2 bg-neutral-50/50 dark:bg-neutral-800/20">
                    {!sessionsLoaded ? (
                        <p className="text-[11px] text-neutral-400 text-center py-2">{tc("loading")}</p>
                    ) : sessions.length === 0 ? (
                        <p className="text-[11px] text-neutral-500 text-center py-2">{t("noSessionsYet")}</p>
                    ) : (
                        <div className="space-y-1">
                            {sessions.map(s => (
                                <div key={s.id} className="flex items-center gap-2 text-[12px]">
                                    <span className="w-5 h-5 rounded-full bg-neutral-200 dark:bg-neutral-700 text-[10px] flex items-center justify-center font-medium">
                                        {s.session_number}
                                    </span>
                                    <span className="flex-1 text-neutral-600 dark:text-neutral-400">
                                        {s.scheduled_at
                                            ? new Date(s.scheduled_at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                                            : t("notScheduled")}
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                        s.status === "completed" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                                        s.status === "scheduled" ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                                        s.status === "cancelled" ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                        "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                                    }`}>
                                        {t(`sessionStatus.${s.status}`)}
                                    </span>
                                    {plan.status === "active" && s.status !== "completed" && s.status !== "cancelled" && (
                                        <button
                                            onClick={() => completeSession(s.id)}
                                            title={t("markCompleted")}
                                            className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                        >
                                            <Check size={12} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {plan.status === "active" && plan.completed_sessions + sessions.filter(s => s.status !== "cancelled").length < plan.total_sessions && (
                        <button
                            onClick={addSession}
                            className="mt-2 w-full text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                            + {t("addSession")}
                        </button>
                    )}

                    {plan.status === "active" && (
                        <button
                            onClick={cancelPlan}
                            className="mt-2 w-full text-[11px] text-red-500 hover:underline"
                        >
                            {t("cancelPlan")}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function CreatePlanModal({
    tenantId, contactId, onClose, onCreated, t, tc,
}: {
    tenantId: string;
    contactId: string;
    onClose: () => void;
    onCreated: () => void;
    t: any;
    tc: any;
}) {
    const [form, setForm] = useState({
        name: "",
        planType: "ortodoncia",
        totalSessions: 12,
        frequencyDays: 30,
        totalCost: "",
        currency: "COP",
        startedAt: new Date().toISOString().split("T")[0],
        notes: "",
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleCreate() {
        if (!form.name.trim()) {
            setError(t("nameRequired"));
            return;
        }
        if (form.totalSessions < 1) {
            setError(t("totalSessionsMin"));
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await api.createTreatmentPlan(tenantId, {
                contactId,
                name: form.name,
                planType: form.planType,
                totalSessions: form.totalSessions,
                frequencyDays: form.frequencyDays,
                totalCost: form.totalCost ? parseFloat(form.totalCost) : undefined,
                currency: form.currency,
                startedAt: form.startedAt,
                notes: form.notes,
            });
            if (res.success) onCreated();
            else setError(res.error || tc("errorSaving"));
        } catch (err: any) {
            setError(err?.message || tc("errorSaving"));
        } finally {
            setSaving(false);
        }
    }

    const inputCls = "w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-neutral-900 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800">
                    <h3 className="text-base font-semibold">{t("createPlan")}</h3>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        <X size={18} />
                    </button>
                </div>
                <div className="p-5 space-y-3">
                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("name")} *</label>
                        <input
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            placeholder={t("namePlaceholder")}
                            className={inputCls}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("planType")}</label>
                            <select value={form.planType} onChange={e => setForm({ ...form, planType: e.target.value })} className={inputCls}>
                                {PLAN_TYPE_KEYS.map(k => <option key={k} value={k}>{t(`planTypes.${k}`)}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("totalSessions")} *</label>
                            <input
                                type="number"
                                min={1}
                                value={form.totalSessions}
                                onChange={e => setForm({ ...form, totalSessions: parseInt(e.target.value) || 1 })}
                                className={inputCls}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("frequencyDays")}</label>
                            <input
                                type="number"
                                min={1}
                                value={form.frequencyDays}
                                onChange={e => setForm({ ...form, frequencyDays: parseInt(e.target.value) || 30 })}
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("startedAt")}</label>
                            <input
                                type="date"
                                value={form.startedAt}
                                onChange={e => setForm({ ...form, startedAt: e.target.value })}
                                className={inputCls}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("totalCost")}</label>
                            <input
                                type="number"
                                min={0}
                                value={form.totalCost}
                                onChange={e => setForm({ ...form, totalCost: e.target.value })}
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("currency")}</label>
                            <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className={inputCls}>
                                <option value="COP">COP</option>
                                <option value="USD">USD</option>
                                <option value="MXN">MXN</option>
                                <option value="ARS">ARS</option>
                                <option value="BRL">BRL</option>
                                <option value="CLP">CLP</option>
                                <option value="EUR">EUR</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("notes")}</label>
                        <textarea
                            rows={2}
                            value={form.notes}
                            onChange={e => setForm({ ...form, notes: e.target.value })}
                            className={`${inputCls} resize-y`}
                        />
                    </div>
                    {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} /> {error}</p>}
                </div>
                <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100 dark:border-neutral-800">
                    <button onClick={onClose} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={saving || !form.name.trim()}
                        className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {saving ? tc("saving") : t("createPlan")}
                    </button>
                </div>
            </div>
        </div>
    );
}
