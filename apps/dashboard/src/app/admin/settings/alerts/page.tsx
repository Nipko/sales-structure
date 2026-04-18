"use client";

import { SkeletonPage } from "@/components/ui/skeleton-loader";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
    Bell, Plus, Trash2, Save, Mail, Clock, Loader2,
    AlertTriangle, CheckCircle, XCircle, Calendar,
} from "lucide-react";

const METRICS = [
    { value: "active_conversations", label: "Conversaciones activas" },
    { value: "queue_depth", label: "Cola de espera" },
    { value: "agents_online", label: "Agentes online" },
    { value: "messages_today", label: "Mensajes hoy" },
    { value: "handoffs_today", label: "Escalaciones hoy" },
    { value: "llm_cost_today", label: "Costo LLM hoy" },
];

const OPERATORS = [
    { value: ">", label: "Mayor que (>)" },
    { value: ">=", label: "Mayor o igual (>=)" },
    { value: "<", label: "Menor que (<)" },
    { value: "<=", label: "Menor o igual (<=)" },
    { value: "=", label: "Igual a (=)" },
];

export default function AlertsSettingsPage() {
    const t = useTranslations("settings");
    const { user } = useAuth();
    const tenantId = user?.tenantId;

    const [rules, setRules] = useState<any[]>([]);
    const [reportConfig, setReportConfig] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);

    // Alert form
    const [form, setForm] = useState({
        name: "", metric: "active_conversations", operator: ">",
        threshold: 0, notifyEmails: "", cooldownMinutes: 60,
    });

    // Report form
    const [reportForm, setReportForm] = useState({
        frequency: "weekly", recipients: "", isActive: true,
    });

    const fetchData = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        const [rulesRes, reportRes] = await Promise.all([
            api.getAlertRules(tenantId),
            api.getReportConfig(tenantId),
        ]);
        if (rulesRes.success) setRules(rulesRes.data || []);
        if (reportRes.success && reportRes.data) {
            setReportConfig(reportRes.data);
            setReportForm({
                frequency: reportRes.data.frequency || "weekly",
                recipients: (reportRes.data.recipients || []).join(", "),
                isActive: reportRes.data.is_active ?? true,
            });
        }
        setLoading(false);
    }, [tenantId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleCreateAlert = async () => {
        if (!tenantId || !form.name || !form.threshold) return;
        setSaving(true);
        const emails = form.notifyEmails.split(",").map(e => e.trim()).filter(Boolean);
        await api.createAlertRule(tenantId, {
            name: form.name, metric: form.metric, operator: form.operator,
            threshold: Number(form.threshold), notifyEmails: emails,
            cooldownMinutes: form.cooldownMinutes,
        });
        setForm({ name: "", metric: "active_conversations", operator: ">", threshold: 0, notifyEmails: "", cooldownMinutes: 60 });
        setShowForm(false);
        setSaving(false);
        fetchData();
    };

    const handleToggleRule = async (rule: any) => {
        if (!tenantId) return;
        await api.updateAlertRule(tenantId, rule.id, { isActive: !rule.is_active });
        fetchData();
    };

    const handleDeleteRule = async (ruleId: string) => {
        if (!tenantId) return;
        await api.deleteAlertRule(tenantId, ruleId);
        fetchData();
    };

    const handleSaveReport = async () => {
        if (!tenantId) return;
        setSaving(true);
        const recipients = reportForm.recipients.split(",").map(e => e.trim()).filter(Boolean);
        await api.upsertReportConfig(tenantId, {
            frequency: reportForm.frequency, recipients, isActive: reportForm.isActive,
        });
        setSaving(false);
        fetchData();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
                <Loader2 size={20} className="animate-spin" /> Cargando...
            </div>
        );
    }

    const inputCls = "w-full py-2.5 px-3 rounded-lg border border-neutral-300 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-foreground text-sm outline-none focus:border-indigo-500 dark:focus:border-indigo-500/50";

    return (
        <div className="p-6 max-w-[900px] mx-auto space-y-8">
            {/* ── Alert Rules ── */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Bell size={20} className="text-amber-400" />
                        <h2 className="text-lg font-semibold text-foreground">Alertas</h2>
                    </div>
                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="px-3 py-1.5 rounded-lg text-[13px] font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors inline-flex items-center gap-1.5"
                    >
                        <Plus size={14} /> Nueva alerta
                    </button>
                </div>

                <p className="text-sm text-muted-foreground mb-4">
                    Recibe notificaciones cuando una métrica supera un umbral. Se evalúan cada 15 minutos.
                </p>

                {/* Create form */}
                {showForm && (
                    <div className="p-5 mb-4 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08] space-y-3">
                        <input
                            type="text" placeholder="Nombre de la alerta"
                            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                            className={inputCls}
                        />
                        <div className="grid grid-cols-3 gap-3">
                            <select value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })} className={inputCls}>
                                {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                            <select value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })} className={inputCls}>
                                {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <input
                                type="number" placeholder="Umbral"
                                value={form.threshold} onChange={e => setForm({ ...form, threshold: Number(e.target.value) })}
                                className={inputCls}
                            />
                        </div>
                        <input
                            type="text" placeholder="Emails (separados por coma)"
                            value={form.notifyEmails} onChange={e => setForm({ ...form, notifyEmails: e.target.value })}
                            className={inputCls}
                        />
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Clock size={14} /> Cooldown:
                            </div>
                            <input
                                type="number" value={form.cooldownMinutes}
                                onChange={e => setForm({ ...form, cooldownMinutes: Number(e.target.value) })}
                                className={`${inputCls} w-20`}
                            />
                            <span className="text-sm text-muted-foreground">min</span>
                            <div className="flex-1" />
                            <button
                                onClick={handleCreateAlert} disabled={saving || !form.name}
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
                            >
                                <Save size={14} /> Crear
                            </button>
                        </div>
                    </div>
                )}

                {/* Rules list */}
                <div className="space-y-2">
                    {rules.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-6 text-center">No hay alertas configuradas.</p>
                    ) : (
                        rules.map((rule: any) => (
                            <div key={rule.id} className="flex items-center gap-4 p-4 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]">
                                <div className={`w-2 h-2 rounded-full ${rule.is_active ? "bg-emerald-400" : "bg-neutral-400"}`} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{rule.name}</p>
                                    <p className="text-[12px] text-muted-foreground">
                                        {METRICS.find(m => m.value === rule.metric)?.label || rule.metric} {rule.operator} {Number(rule.threshold)}
                                        {rule.trigger_count > 0 && <span className="ml-2 text-amber-400">({rule.trigger_count}x)</span>}
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleToggleRule(rule)}
                                    className={`px-2.5 py-1 rounded-lg text-[12px] font-medium border transition-colors ${
                                        rule.is_active
                                            ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10"
                                            : "border-neutral-300 dark:border-white/10 text-muted-foreground"
                                    }`}
                                >
                                    {rule.is_active ? "Activa" : "Inactiva"}
                                </button>
                                <button
                                    onClick={() => handleDeleteRule(rule.id)}
                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ── Scheduled Reports ── */}
            <div>
                <div className="flex items-center gap-2 mb-4">
                    <Calendar size={20} className="text-blue-400" />
                    <h2 className="text-lg font-semibold text-foreground">Informes Programados</h2>
                </div>

                <p className="text-sm text-muted-foreground mb-4">
                    Recibe un resumen de KPIs por email de forma automática.
                </p>

                <div className="p-5 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08] space-y-4">
                    <div className="flex items-center gap-3">
                        <label className="text-sm text-muted-foreground w-24 shrink-0">Frecuencia</label>
                        <select
                            value={reportForm.frequency}
                            onChange={e => setReportForm({ ...reportForm, frequency: e.target.value })}
                            className={inputCls}
                        >
                            <option value="weekly">Semanal (lunes 8 AM)</option>
                            <option value="monthly">Mensual (día 1, 8 AM)</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-3">
                        <label className="text-sm text-muted-foreground w-24 shrink-0">Destinatarios</label>
                        <input
                            type="text"
                            placeholder="email1@empresa.com, email2@empresa.com"
                            value={reportForm.recipients}
                            onChange={e => setReportForm({ ...reportForm, recipients: e.target.value })}
                            className={inputCls}
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <label className="text-sm text-muted-foreground w-24 shrink-0">Activo</label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={reportForm.isActive}
                                onChange={e => setReportForm({ ...reportForm, isActive: e.target.checked })}
                                className="w-4 h-4 rounded border-neutral-300 dark:border-white/20 text-indigo-500 focus:ring-indigo-500/30"
                            />
                            <span className="text-sm text-foreground">
                                {reportForm.isActive ? "Habilitado" : "Deshabilitado"}
                            </span>
                        </label>
                    </div>

                    {reportConfig?.last_sent_at && (
                        <p className="text-[12px] text-muted-foreground">
                            Último envío: {new Date(reportConfig.last_sent_at).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                    )}

                    <div className="flex justify-end">
                        <button
                            onClick={handleSaveReport} disabled={saving}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
                        >
                            <Save size={14} /> Guardar configuración
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
