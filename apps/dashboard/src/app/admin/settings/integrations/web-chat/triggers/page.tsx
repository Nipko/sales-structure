"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    Zap, Plus, Trash2, Pencil, ToggleLeft, ToggleRight,
    X, ChevronLeft, Clock, MousePointerClick, ArrowUpFromLine,
    Globe, Eye,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface Condition {
    type: string;
    value?: number | string;
    operator?: string;
}

interface Trigger {
    id: string;
    widget_config_id: string;
    name: string;
    conditions: Condition[];
    condition_operator: string;
    action_type: string;
    action_config: Record<string, any>;
    frequency_minutes: number;
    is_active: boolean;
    priority: number;
    created_at: string;
    updated_at: string;
}

interface TriggerForm {
    name: string;
    conditions: Condition[];
    conditionOperator: string;
    actionType: string;
    actionConfig: Record<string, any>;
    frequencyMinutes: number;
    isActive: boolean;
    priority: number;
}

const EMPTY_FORM: TriggerForm = {
    name: "",
    conditions: [],
    conditionOperator: "AND",
    actionType: "show_bubble_message",
    actionConfig: { message: "" },
    frequencyMinutes: 0,
    isActive: true,
    priority: 0,
};

const CONDITION_TYPES = ["time_on_page", "scroll_depth", "exit_intent", "page_url", "visit_count"] as const;
const ACTION_TYPES = ["open_widget", "show_bubble_message", "show_banner"] as const;

function conditionIcon(type: string) {
    switch (type) {
        case "time_on_page": return <Clock size={14} />;
        case "scroll_depth": return <ArrowUpFromLine size={14} />;
        case "exit_intent": return <MousePointerClick size={14} />;
        case "page_url": return <Globe size={14} />;
        case "visit_count": return <Eye size={14} />;
        default: return <Zap size={14} />;
    }
}

export default function WidgetTriggersPage() {
    const t = useTranslations("widgetTriggers");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();
    const [triggers, setTriggers] = useState<Trigger[]>([]);
    const [widgetConfigId, setWidgetConfigId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<TriggerForm>({ ...EMPTY_FORM });
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);

    const showToast = (msg: string, type: "ok" | "err" = "ok") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    // Load widget configs to get the first widget's id
    const fetchData = useCallback(async () => {
        if (!activeTenantId) return;
        try {
            const token = localStorage.getItem("token");
            const res = await fetch(`${API_URL}/widgets/${activeTenantId}`, {
                headers: { Authorization: `Bearer ${token}`, "x-tenant-id": activeTenantId },
            });
            const data = await res.json();
            if (data.success && data.data?.length) {
                const wid = data.data[0].id;
                setWidgetConfigId(wid);
                const trigRes = await api.listWidgetTriggers(wid);
                if (trigRes.success) setTriggers(trigRes.data || []);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [activeTenantId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const openCreate = () => {
        setEditingId(null);
        setForm({ ...EMPTY_FORM, actionConfig: { message: "" } });
        setShowModal(true);
    };

    const openEdit = (tr: Trigger) => {
        setEditingId(tr.id);
        setForm({
            name: tr.name,
            conditions: tr.conditions || [],
            conditionOperator: tr.condition_operator || "AND",
            actionType: tr.action_type,
            actionConfig: tr.action_config || {},
            frequencyMinutes: tr.frequency_minutes,
            isActive: tr.is_active,
            priority: tr.priority,
        });
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!widgetConfigId || !form.name.trim()) return;
        setSaving(true);
        try {
            if (editingId) {
                const res = await api.updateWidgetTrigger(editingId, form);
                if (res.success) {
                    showToast(t("toast.updated"));
                    setShowModal(false);
                    fetchData();
                } else {
                    showToast(res.error || t("toast.error"), "err");
                }
            } else {
                const res = await api.createWidgetTrigger(widgetConfigId, form);
                if (res.success) {
                    showToast(t("toast.created"));
                    setShowModal(false);
                    fetchData();
                } else {
                    if (res.error?.includes("plan_limit")) {
                        showToast(t("planLimit"), "err");
                    } else {
                        showToast(res.error || t("toast.error"), "err");
                    }
                }
            }
        } catch {
            showToast(t("toast.error"), "err");
        }
        setSaving(false);
    };

    const handleDelete = async (triggerId: string) => {
        if (!confirm(t("confirmDelete"))) return;
        const res = await api.deleteWidgetTrigger(triggerId);
        if (res.success) {
            showToast(t("toast.deleted"));
            setTriggers(prev => prev.filter(tr => tr.id !== triggerId));
        }
    };

    const toggleActive = async (tr: Trigger) => {
        const res = await api.updateWidgetTrigger(tr.id, { isActive: !tr.is_active });
        if (res.success) {
            setTriggers(prev => prev.map(t2 => t2.id === tr.id ? { ...t2, is_active: !t2.is_active } : t2));
        }
    };

    const addCondition = () => {
        setForm(prev => ({
            ...prev,
            conditions: [...prev.conditions, { type: "time_on_page", value: 10 }],
        }));
    };

    const updateCondition = (idx: number, patch: Partial<Condition>) => {
        setForm(prev => ({
            ...prev,
            conditions: prev.conditions.map((c, i) => i === idx ? { ...c, ...patch } : c),
        }));
    };

    const removeCondition = (idx: number) => {
        setForm(prev => ({
            ...prev,
            conditions: prev.conditions.filter((_, i) => i !== idx),
        }));
    };

    const conditionSummary = (conditions: Condition[], operator: string) => {
        if (!conditions?.length) return "-";
        return conditions.map(c => t(`conditionTypes.${c.type}`)).join(operator === "AND" ? " + " : " | ");
    };

    const actionLabel = (type: string) => {
        switch (type) {
            case "open_widget": return t("openWidget");
            case "show_bubble_message": return t("showBubble");
            case "show_banner": return t("showBanner");
            default: return type;
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="w-8 h-8 border-2 border-neutral-300 dark:border-neutral-700 border-t-indigo-500 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-3xl space-y-6">
            {/* Toast */}
            {toast && (
                <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg ${toast.type === "ok" ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
                    {toast.msg}
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <a
                            href="/admin/settings/integrations/web-chat"
                            className="text-neutral-400 hover:text-neutral-200 transition-colors"
                        >
                            <ChevronLeft size={18} />
                        </a>
                        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                            <Zap size={22} className="text-indigo-500" />
                            {t("title")}
                        </h1>
                    </div>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
                </div>
                <button
                    onClick={openCreate}
                    disabled={!widgetConfigId}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                    <Plus size={16} />
                    {t("create")}
                </button>
            </div>

            <HelpPanel
                title={tHelp("settingsIntegrationsWebChatTriggers.title")}
                description={tHelp("settingsIntegrationsWebChatTriggers.description")}
                tips={tHelp.raw("settingsIntegrationsWebChatTriggers.tips") as string[]}
                mediaKey="settingsIntegrationsWebChatTriggers"
            />

            {/* No widget warning */}
            {!widgetConfigId && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6 text-center">
                    <p className="text-sm text-amber-700 dark:text-amber-400">No widget configured yet. Create a widget first.</p>
                </div>
            )}

            {/* Empty state */}
            {widgetConfigId && triggers.length === 0 && (
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-12 text-center">
                    <Zap size={40} className="mx-auto text-neutral-300 dark:text-neutral-600 mb-4" />
                    <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{t("empty.title")}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{t("empty.subtitle")}</p>
                </div>
            )}

            {/* Trigger list */}
            {triggers.map(tr => (
                <div key={tr.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                                <Zap size={16} className="text-indigo-500" />
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">{tr.name}</h3>
                                <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                                    {conditionSummary(tr.conditions, tr.condition_operator)} &rarr; {actionLabel(tr.action_type)}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tr.is_active ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500"}`}>
                                {tr.is_active ? t("active") : t("inactive")}
                            </span>
                            <button onClick={() => toggleActive(tr)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg">
                                {tr.is_active ? <ToggleRight size={18} className="text-indigo-500" /> : <ToggleLeft size={18} className="text-neutral-400" />}
                            </button>
                            <button onClick={() => openEdit(tr)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg">
                                <Pencil size={16} className="text-neutral-500" />
                            </button>
                            <button onClick={() => handleDelete(tr.id)} className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg">
                                <Trash2 size={16} className="text-red-400" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)}>
                    <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        {/* Modal header */}
                        <div className="flex items-center justify-between p-5 border-b border-neutral-200 dark:border-neutral-800">
                            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                                {editingId ? t("edit") : t("create")}
                            </h2>
                            <button onClick={() => setShowModal(false)} className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg">
                                <X size={18} className="text-neutral-500" />
                            </button>
                        </div>

                        {/* Modal body */}
                        <div className="p-5 space-y-5">
                            {/* Name */}
                            <div>
                                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("name")}</label>
                                <input
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    placeholder={t("namePlaceholder")}
                                    className="w-full h-9 px-3 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500"
                                />
                            </div>

                            {/* Conditions */}
                            <div>
                                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">{t("conditions")}</label>

                                {form.conditions.length > 1 && (
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="text-xs text-neutral-500">{t("conditionOperator")}:</span>
                                        <button
                                            onClick={() => setForm({ ...form, conditionOperator: form.conditionOperator === "AND" ? "OR" : "AND" })}
                                            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${form.conditionOperator === "AND" ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-400" : "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400"}`}
                                        >
                                            {form.conditionOperator === "AND" ? t("and") : t("or")}
                                        </button>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    {form.conditions.map((cond, idx) => (
                                        <div key={idx} className="flex items-center gap-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700">
                                            <span className="flex-shrink-0 text-neutral-400">{conditionIcon(cond.type)}</span>
                                            <select
                                                value={cond.type}
                                                onChange={e => {
                                                    const newType = e.target.value;
                                                    const patch: Partial<Condition> = { type: newType };
                                                    if (newType === "exit_intent") { patch.value = undefined; patch.operator = undefined; }
                                                    else if (newType === "time_on_page") { patch.value = 10; patch.operator = undefined; }
                                                    else if (newType === "scroll_depth") { patch.value = 50; patch.operator = undefined; }
                                                    else if (newType === "page_url") { patch.value = "/"; patch.operator = "contains"; }
                                                    else if (newType === "visit_count") { patch.value = 3; patch.operator = "gte"; }
                                                    updateCondition(idx, patch);
                                                }}
                                                className="h-8 px-2 text-xs rounded-md border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none"
                                            >
                                                {CONDITION_TYPES.map(ct => (
                                                    <option key={ct} value={ct}>{t(`conditionTypes.${ct}`)}</option>
                                                ))}
                                            </select>

                                            {cond.type === "time_on_page" && (
                                                <div className="flex items-center gap-1">
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={cond.value ?? 10}
                                                        onChange={e => updateCondition(idx, { value: parseInt(e.target.value) || 1 })}
                                                        className="w-16 h-8 px-2 text-xs rounded-md border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none"
                                                    />
                                                    <span className="text-xs text-neutral-500">{t("seconds")}</span>
                                                </div>
                                            )}

                                            {cond.type === "scroll_depth" && (
                                                <div className="flex items-center gap-1">
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        max={100}
                                                        value={cond.value ?? 50}
                                                        onChange={e => updateCondition(idx, { value: parseInt(e.target.value) || 1 })}
                                                        className="w-16 h-8 px-2 text-xs rounded-md border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none"
                                                    />
                                                    <span className="text-xs text-neutral-500">%</span>
                                                </div>
                                            )}

                                            {cond.type === "page_url" && (
                                                <>
                                                    <select
                                                        value={cond.operator || "contains"}
                                                        onChange={e => updateCondition(idx, { operator: e.target.value })}
                                                        className="h-8 px-2 text-xs rounded-md border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none"
                                                    >
                                                        <option value="contains">contains</option>
                                                        <option value="equals">equals</option>
                                                        <option value="starts_with">starts with</option>
                                                    </select>
                                                    <input
                                                        value={String(cond.value || "")}
                                                        onChange={e => updateCondition(idx, { value: e.target.value })}
                                                        placeholder="/pricing"
                                                        className="flex-1 h-8 px-2 text-xs rounded-md border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none"
                                                    />
                                                </>
                                            )}

                                            {cond.type === "visit_count" && (
                                                <>
                                                    <select
                                                        value={cond.operator || "gte"}
                                                        onChange={e => updateCondition(idx, { operator: e.target.value })}
                                                        className="h-8 px-2 text-xs rounded-md border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none"
                                                    >
                                                        <option value="gte">&ge;</option>
                                                        <option value="eq">=</option>
                                                        <option value="lte">&le;</option>
                                                    </select>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={cond.value ?? 3}
                                                        onChange={e => updateCondition(idx, { value: parseInt(e.target.value) || 1 })}
                                                        className="w-16 h-8 px-2 text-xs rounded-md border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none"
                                                    />
                                                </>
                                            )}

                                            <button onClick={() => removeCondition(idx)} className="p-1 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md ml-auto flex-shrink-0">
                                                <X size={14} className="text-red-400" />
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                <button
                                    onClick={addCondition}
                                    className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg"
                                >
                                    <Plus size={14} />
                                    {t("addCondition")}
                                </button>
                            </div>

                            {/* Action Type */}
                            <div>
                                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("actionType")}</label>
                                <select
                                    value={form.actionType}
                                    onChange={e => {
                                        const at = e.target.value;
                                        const ac = at === "show_bubble_message" ? { message: "" }
                                            : at === "show_banner" ? { message: "", position: "bottom", bgColor: "#6c5ce7" }
                                            : {};
                                        setForm({ ...form, actionType: at, actionConfig: ac });
                                    }}
                                    className="w-full h-9 px-3 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none"
                                >
                                    {ACTION_TYPES.map(at => (
                                        <option key={at} value={at}>{actionLabel(at)}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Action Config */}
                            {(form.actionType === "show_bubble_message" || form.actionType === "show_banner") && (
                                <div>
                                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("message")}</label>
                                    <input
                                        value={form.actionConfig.message || ""}
                                        onChange={e => setForm({ ...form, actionConfig: { ...form.actionConfig, message: e.target.value } })}
                                        placeholder={t("messagePlaceholder")}
                                        className="w-full h-9 px-3 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500"
                                    />
                                </div>
                            )}

                            {form.actionType === "show_banner" && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("position")}</label>
                                        <select
                                            value={form.actionConfig.position || "bottom"}
                                            onChange={e => setForm({ ...form, actionConfig: { ...form.actionConfig, position: e.target.value } })}
                                            className="w-full h-9 px-3 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none"
                                        >
                                            <option value="top">{t("top")}</option>
                                            <option value="bottom">{t("bottom")}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("bgColor")}</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={form.actionConfig.bgColor || "#6c5ce7"}
                                                onChange={e => setForm({ ...form, actionConfig: { ...form.actionConfig, bgColor: e.target.value } })}
                                                className="w-9 h-9 rounded-lg border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                                            />
                                            <span className="text-xs text-neutral-500">{form.actionConfig.bgColor || "#6c5ce7"}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Frequency & Priority */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("frequency")}</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={form.frequencyMinutes}
                                        onChange={e => setForm({ ...form, frequencyMinutes: parseInt(e.target.value) || 0 })}
                                        className="w-full h-9 px-3 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500"
                                    />
                                    <p className="text-xs text-neutral-400 mt-0.5">{t("frequencyHint")}</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("priority")}</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={form.priority}
                                        onChange={e => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                                        className="w-full h-9 px-3 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500"
                                    />
                                </div>
                            </div>

                            {/* Active */}
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-neutral-700 dark:text-neutral-300">{t("active")}</span>
                                <button onClick={() => setForm({ ...form, isActive: !form.isActive })}>
                                    {form.isActive ? <ToggleRight size={24} className="text-indigo-500" /> : <ToggleLeft size={24} className="text-neutral-400" />}
                                </button>
                            </div>
                        </div>

                        {/* Modal footer */}
                        <div className="flex justify-end gap-2 p-5 border-t border-neutral-200 dark:border-neutral-800">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg"
                            >
                                {t("cancel")}
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving || !form.name.trim()}
                                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {t("save")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
