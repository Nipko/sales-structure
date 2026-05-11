"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    MessageCircle, Plus, Copy, Check, Trash2, Settings,
    Eye, Palette, Globe, Code, ToggleLeft, ToggleRight,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface WidgetConfig {
    id: string;
    widget_id: string;
    name: string;
    primary_color: string;
    position: string;
    welcome_message: string;
    agent_name: string;
    pre_chat_enabled: boolean;
    pre_chat_fields: string[];
    allowed_domains: string[];
    is_active: boolean;
    locale: string;
    created_at: string;
}

export default function WebChatWidgetPage() {
    const t = useTranslations("webChat");
    const { activeTenantId } = useTenant();
    const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [snippetCopied, setSnippetCopied] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<any>({});

    const fetchWidgets = useCallback(async () => {
        if (!activeTenantId) return;
        try {
            const token = localStorage.getItem("token");
            const res = await fetch(`${API_URL}/widgets/${activeTenantId}`, {
                headers: { Authorization: `Bearer ${token}`, "x-tenant-id": activeTenantId },
            });
            const data = await res.json();
            if (data.success) setWidgets(data.data || []);
        } catch { /* ignore */ }
        setLoading(false);
    }, [activeTenantId]);

    useEffect(() => { fetchWidgets(); }, [fetchWidgets]);

    const createWidget = async () => {
        if (!activeTenantId) return;
        setCreating(true);
        try {
            const token = localStorage.getItem("token");
            const res = await fetch(`${API_URL}/widgets/${activeTenantId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-tenant-id": activeTenantId },
                body: JSON.stringify({ name: "Web Chat" }),
            });
            const data = await res.json();
            if (data.success) {
                setWidgets(prev => [data.data, ...prev]);
            }
        } catch { /* ignore */ }
        setCreating(false);
    };

    const updateWidget = async (widgetId: string) => {
        if (!activeTenantId) return;
        const token = localStorage.getItem("token");
        await fetch(`${API_URL}/widgets/${activeTenantId}/${widgetId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-tenant-id": activeTenantId },
            body: JSON.stringify(editForm),
        });
        setEditingId(null);
        fetchWidgets();
    };

    const deleteWidget = async (widgetId: string) => {
        if (!activeTenantId || !confirm(t("confirmDelete"))) return;
        const token = localStorage.getItem("token");
        await fetch(`${API_URL}/widgets/${activeTenantId}/${widgetId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}`, "x-tenant-id": activeTenantId },
        });
        setWidgets(prev => prev.filter(w => w.id !== widgetId));
    };

    const copySnippet = async (widget: WidgetConfig) => {
        const snippet = `<script>\n  window.__paralllyWidget = { widgetId: '${widget.widget_id}' };\n</script>\n<script async src="${API_URL}/widget/loader.js"></script>`;
        await navigator.clipboard.writeText(snippet);
        setSnippetCopied(widget.id);
        setTimeout(() => setSnippetCopied(null), 2000);
    };

    const startEdit = (w: WidgetConfig) => {
        setEditingId(w.id);
        setEditForm({
            name: w.name,
            primaryColor: w.primary_color,
            position: w.position,
            welcomeMessage: w.welcome_message,
            agentName: w.agent_name,
            preChatEnabled: w.pre_chat_enabled,
            allowedDomains: w.allowed_domains,
            isActive: w.is_active,
            locale: w.locale,
        });
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
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                        <MessageCircle size={22} className="text-indigo-500" />
                        {t("title")}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
                </div>
                <button
                    onClick={createWidget}
                    disabled={creating}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                    <Plus size={16} />
                    {t("create")}
                </button>
            </div>

            {widgets.length === 0 && (
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-12 text-center">
                    <MessageCircle size={40} className="mx-auto text-neutral-300 dark:text-neutral-600 mb-4" />
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("noWidgets")}</p>
                </div>
            )}

            {widgets.map(w => (
                <div key={w.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-neutral-200 dark:border-neutral-800">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: w.primary_color }}>
                                <MessageCircle size={16} className="text-white" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{w.name}</h3>
                                <p className="text-xs text-neutral-500 dark:text-neutral-400">ID: {w.widget_id}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${w.is_active ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500"}`}>
                                {w.is_active ? t("active") : t("inactive")}
                            </span>
                            <button onClick={() => copySnippet(w)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg" title={t("copySnippet")}>
                                {snippetCopied === w.id ? <Check size={16} className="text-green-500" /> : <Code size={16} className="text-neutral-500" />}
                            </button>
                            <button onClick={() => startEdit(w)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg" title={t("configure")}>
                                <Settings size={16} className="text-neutral-500" />
                            </button>
                            <button onClick={() => deleteWidget(w.id)} className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg" title={t("delete")}>
                                <Trash2 size={16} className="text-red-400" />
                            </button>
                        </div>
                    </div>

                    {/* Edit panel */}
                    {editingId === w.id && (
                        <div className="p-5 space-y-4 bg-neutral-50 dark:bg-neutral-800/30">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("widgetName")}</label>
                                    <input
                                        value={editForm.name || ""}
                                        onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                        className="w-full h-9 px-3 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("agentName")}</label>
                                    <input
                                        value={editForm.agentName || ""}
                                        onChange={e => setEditForm({ ...editForm, agentName: e.target.value })}
                                        className="w-full h-9 px-3 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("color")}</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="color"
                                            value={editForm.primaryColor || "#6c5ce7"}
                                            onChange={e => setEditForm({ ...editForm, primaryColor: e.target.value })}
                                            className="w-9 h-9 rounded-lg border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                                        />
                                        <span className="text-xs text-neutral-500">{editForm.primaryColor}</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("position")}</label>
                                    <select
                                        value={editForm.position || "bottom-right"}
                                        onChange={e => setEditForm({ ...editForm, position: e.target.value })}
                                        className="w-full h-9 px-3 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none"
                                    >
                                        <option value="bottom-right">{t("bottomRight")}</option>
                                        <option value="bottom-left">{t("bottomLeft")}</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("welcomeMessage")}</label>
                                <textarea
                                    value={editForm.welcomeMessage || ""}
                                    onChange={e => setEditForm({ ...editForm, welcomeMessage: e.target.value })}
                                    rows={2}
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 resize-none"
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-neutral-700 dark:text-neutral-300">{t("preChatForm")}</span>
                                    <button
                                        onClick={() => setEditForm({ ...editForm, preChatEnabled: !editForm.preChatEnabled })}
                                        className="text-indigo-500"
                                    >
                                        {editForm.preChatEnabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} className="text-neutral-400" />}
                                    </button>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setEditingId(null)}
                                    className="px-4 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg"
                                >
                                    {t("cancel")}
                                </button>
                                <button
                                    onClick={() => updateWidget(w.id)}
                                    className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                                >
                                    {t("save")}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Snippet preview */}
                    {!editingId && (
                        <div className="px-5 py-3 bg-neutral-50 dark:bg-neutral-800/30">
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">{t("embedCode")}</p>
                            <code className="block text-xs text-neutral-600 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-3 font-mono break-all">
                                {`<script>window.__paralllyWidget={widgetId:'${w.widget_id}'};</script>`}
                            </code>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
