"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    ArrowLeft, DollarSign, User, Clock, Calendar,
    FileText, TrendingUp, Loader2, Pencil, Save,
    X, Archive, MessageSquare, ExternalLink,
} from "lucide-react";

const KNOWN_STAGE_KEYS = ['nuevo','contactado','respondio','calificado','tibio','caliente','listo_para_cierre','listo_cierre','ganado','perdido','no_interesado'];
const formatCurrency = (n: number) => `$${n.toLocaleString()}`;

export default function DealDetailPage() {
    const t = useTranslations("pipeline");
    const tc = useTranslations("common");
    const params = useParams();
    const router = useRouter();
    const { activeTenantId } = useTenant();
    const dealId = params.dealId as string;

    const [opp, setOpp] = useState<any>(null);
    const [lead, setLead] = useState<any>(null);
    const [stages, setStages] = useState<any[]>([]);
    const [stageHistory, setStageHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [form, setForm] = useState({ estimated_value: "", notes: "", assigned_to: "" });
    const [now] = useState(Date.now);

    const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

    const load = useCallback(async () => {
        if (!activeTenantId || !dealId) return;
        setLoading(true);

        const [oppRes, stagesRes] = await Promise.all([
            api.fetch(`/crm/opportunities/${activeTenantId}/${dealId}`),
            api.fetch(`/pipeline/stages/${activeTenantId}`),
        ]);

        if (oppRes?.success && oppRes.data) {
            const o = oppRes.data;
            setOpp(o);
            setForm({
                estimated_value: String(o.estimated_value || 0),
                notes: o.notes || o.metadata?.notes || "",
                assigned_to: o.assigned_to || "",
            });

            if (o.lead_id) {
                const leadRes = await api.fetch(`/crm/leads/${activeTenantId}/${o.lead_id}`);
                if (leadRes?.success) setLead(leadRes.data);

                const timelineRes = await api.fetch(`/crm/timeline/${activeTenantId}/${o.lead_id}`);
                if (timelineRes?.success && Array.isArray(timelineRes.data)) {
                    setStageHistory(
                        timelineRes.data
                            .filter((e: any) => e.event_type === "stage_change")
                            .slice(0, 20),
                    );
                }
            }
        }

        if (stagesRes?.success) setStages(stagesRes.data || []);
        setLoading(false);
    }, [activeTenantId, dealId]);

    useEffect(() => { load(); }, [load]);

    const handleSave = async () => {
        if (!activeTenantId || !opp) return;
        setSaving(true);
        await api.fetch(`/crm/opportunities/${activeTenantId}/${opp.id}`, {
            method: "PUT",
            body: JSON.stringify({
                estimated_value: Number(form.estimated_value) || 0,
                notes: form.notes,
                assigned_to: form.assigned_to || null,
            }),
        });
        setSaving(false);
        setEditing(false);
        showToast(tc("saved"));
        load();
    };

    const handleStageChange = async (newStage: string) => {
        if (!activeTenantId || !opp || newStage === opp.stage) return;
        await api.fetch(`/crm/kanban/${activeTenantId}/${opp.id}/move`, {
            method: "PUT",
            body: JSON.stringify({ stage: newStage }),
        });
        showToast(t("movedTo", { stage: KNOWN_STAGE_KEYS.includes(newStage) ? tc(`stages.${newStage}`) : newStage }));
        load();
    };

    const handleArchive = async () => {
        if (!activeTenantId || !opp) return;
        if (!confirm(t("dealDetail.archiveConfirm"))) return;
        await api.fetch(`/crm/opportunities/${activeTenantId}/${opp.id}`, {
            method: "PUT",
            body: JSON.stringify({ stage: "perdido", lost_reason: "Archived from pipeline detail" }),
        });
        router.push("/admin/pipeline");
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 size={28} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!opp) {
        return (
            <div className="text-center py-16 text-muted-foreground">
                <p>{t("dealNotFound")}</p>
                <button
                    onClick={() => router.push("/admin/pipeline")}
                    className="mt-3 text-sm text-indigo-500 hover:underline cursor-pointer"
                >
                    {t("backToPipeline")}
                </button>
            </div>
        );
    }

    const currentStage = opp.stage || "nuevo";
    const stageName = KNOWN_STAGE_KEYS.includes(currentStage)
        ? tc(`stages.${currentStage}`)
        : currentStage;
    const title = lead ? `${lead.first_name || ""} ${lead.last_name || ""}`.trim() || t("dealDetail.untitled") : t("dealDetail.untitled");
    const createdDays = Math.floor((now - new Date(opp.created_at).getTime()) / 86400000);

    const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40";

    return (
        <>
            <div>
                <button
                    onClick={() => router.push("/admin/pipeline")}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 cursor-pointer transition-colors"
                >
                    <ArrowLeft size={16} /> {t("backToPipeline")}
                </button>

                <PageHeader
                    title={title}
                    subtitle={`${stageName} — ${formatCurrency(opp.estimated_value || 0)}`}
                    icon={TrendingUp}
                    action={
                        <div className="flex items-center gap-2">
                            {!editing ? (
                                <button
                                    onClick={() => setEditing(true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted transition-colors cursor-pointer"
                                >
                                    <Pencil size={14} /> {tc("edit")}
                                </button>
                            ) : (
                                <>
                                    <button
                                        onClick={() => setEditing(false)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted transition-colors cursor-pointer"
                                    >
                                        <X size={14} /> {tc("cancel")}
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                        {tc("save")}
                                    </button>
                                </>
                            )}
                            <button
                                onClick={handleArchive}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-500 text-sm hover:bg-red-500/10 transition-colors cursor-pointer"
                            >
                                <Archive size={14} /> {t("dealDetail.archive")}
                            </button>
                        </div>
                    }
                />

                {/* KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="p-4 rounded-xl bg-card border border-border">
                        <div className="text-xs text-muted-foreground font-semibold mb-1">{t("dealDetail.value")}</div>
                        <div className="text-xl font-semibold text-emerald-500">{formatCurrency(opp.estimated_value || 0)}</div>
                    </div>
                    <div className="p-4 rounded-xl bg-card border border-border">
                        <div className="text-xs text-muted-foreground font-semibold mb-1">{t("dealDetail.probability")}</div>
                        <div className="text-xl font-semibold">
                            {stages.find((s: any) => s.slug === currentStage || s.id === currentStage)?.defaultProbability ?? opp.score ?? 0}%
                        </div>
                    </div>
                    <div className="p-4 rounded-xl bg-card border border-border">
                        <div className="text-xs text-muted-foreground font-semibold mb-1">{t("dealDetail.daysInStage")}</div>
                        <div className={cn("text-xl font-semibold", createdDays > 5 ? "text-red-500" : "")}>
                            {createdDays}d
                        </div>
                    </div>
                    <div className="p-4 rounded-xl bg-card border border-border">
                        <div className="text-xs text-muted-foreground font-semibold mb-1">{t("dealDetail.score")}</div>
                        <div className="text-xl font-semibold">{lead?.score ?? opp.score ?? "—"}</div>
                    </div>
                </div>

                {/* Stage Selector */}
                <div className="mb-6">
                    <h3 className="text-sm font-semibold mb-2">{t("dealDetail.stage")}</h3>
                    <div className="flex flex-wrap gap-1.5">
                        {(stages.length > 0 ? stages : KNOWN_STAGE_KEYS.map(k => ({ slug: k, name: k, color: "#3498db" }))).map((s: any) => {
                            const key = s.slug || s.id;
                            const isActive = key === currentStage;
                            const label = KNOWN_STAGE_KEYS.includes(key) ? tc(`stages.${key}`) : s.name;
                            return (
                                <button
                                    key={key}
                                    onClick={() => handleStageChange(key)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border",
                                        isActive
                                            ? "text-white border-transparent shadow-sm"
                                            : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20",
                                    )}
                                    style={isActive ? { backgroundColor: s.color || "#6c5ce7" } : undefined}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Deal Info */}
                    <div className="p-5 rounded-xl bg-card border border-border">
                        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                            <FileText size={16} className="text-muted-foreground" /> {t("dealDetail.info")}
                        </h3>
                        {editing ? (
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs text-muted-foreground font-semibold">{t("dealDetail.value")}</label>
                                    <input
                                        type="number"
                                        value={form.estimated_value}
                                        onChange={e => setForm(f => ({ ...f, estimated_value: e.target.value }))}
                                        className={inputCls + " mt-1"}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground font-semibold">{t("dealForm.notes")}</label>
                                    <textarea
                                        value={form.notes}
                                        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                        rows={3}
                                        className={inputCls + " mt-1 resize-none"}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground font-semibold">{t("dealDetail.assignedTo")}</label>
                                    <input
                                        value={form.assigned_to}
                                        onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                                        placeholder={t("dealDetail.assignedPlaceholder")}
                                        className={inputCls + " mt-1"}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2.5 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("dealDetail.stage")}</span>
                                    <span className="font-medium">{stageName}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("dealDetail.value")}</span>
                                    <span className="font-medium text-emerald-500">{formatCurrency(opp.estimated_value || 0)}</span>
                                </div>
                                {opp.assigned_to && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t("dealDetail.assignedTo")}</span>
                                        <span className="font-medium">{opp.assigned_to}</span>
                                    </div>
                                )}
                                {opp.won_at && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t("dealDetail.wonAt")}</span>
                                        <span className="font-medium text-emerald-500">{new Date(opp.won_at).toLocaleDateString()}</span>
                                    </div>
                                )}
                                {opp.lost_at && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t("dealDetail.lostAt")}</span>
                                        <span className="font-medium text-red-500">{new Date(opp.lost_at).toLocaleDateString()}</span>
                                    </div>
                                )}
                                {opp.loss_reason && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t("dealDetail.lossReason")}</span>
                                        <span className="font-medium">{opp.loss_reason}</span>
                                    </div>
                                )}
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{tc("createdAt")}</span>
                                    <span className="font-medium">{new Date(opp.created_at).toLocaleDateString()}</span>
                                </div>
                                {(opp.notes || opp.metadata?.notes) && (
                                    <div className="pt-2 border-t border-border">
                                        <span className="text-muted-foreground text-xs">{t("dealForm.notes")}</span>
                                        <p className="mt-1 text-foreground">{opp.notes || opp.metadata?.notes}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Contact / Lead Info */}
                    <div className="p-5 rounded-xl bg-card border border-border">
                        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                            <User size={16} className="text-muted-foreground" /> {t("dealDetail.contact")}
                        </h3>
                        <div className="space-y-2.5 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{tc("name")}</span>
                                <span className="font-medium">{title}</span>
                            </div>
                            {lead?.phone && (
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{tc("phone")}</span>
                                    <span className="font-medium">{lead.phone}</span>
                                </div>
                            )}
                            {lead?.email && (
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{tc("email")}</span>
                                    <span className="font-medium">{lead.email}</span>
                                </div>
                            )}
                            {lead?.score != null && (
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("dealDetail.leadScore")}</span>
                                    <span className="font-medium">★ {lead.score}</span>
                                </div>
                            )}
                            {opp.conversation_id && (
                                <div className="pt-2 border-t border-border">
                                    <button
                                        onClick={() => router.push(`/admin/inbox?conversation=${opp.conversation_id}`)}
                                        className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline cursor-pointer"
                                    >
                                        <MessageSquare size={12} /> {t("dealDetail.viewConversation")}
                                        <ExternalLink size={10} />
                                    </button>
                                </div>
                            )}
                            {lead && (
                                <div className="pt-2 border-t border-border">
                                    <button
                                        onClick={() => router.push(`/admin/contacts/${lead.id}`)}
                                        className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline cursor-pointer"
                                    >
                                        <User size={12} /> {t("dealDetail.viewContact")}
                                        <ExternalLink size={10} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Stage History */}
                {stageHistory.length > 0 && (
                    <div className="mt-5 p-5 rounded-xl bg-card border border-border">
                        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                            <Clock size={16} className="text-muted-foreground" /> {t("dealDetail.history")}
                        </h3>
                        <div className="space-y-3">
                            {stageHistory.map((h: any, i: number) => (
                                <div key={h.id || i} className="flex items-center gap-3 text-sm">
                                    <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                                    <div className="flex-1">
                                        <span className="font-medium">{h.description || "—"}</span>
                                        {h.actor && h.actor !== "system" && (
                                            <span className="text-muted-foreground ml-2">({h.actor})</span>
                                        )}
                                    </div>
                                    <span className="text-xs text-muted-foreground shrink-0">
                                        {new Date(h.created_at).toLocaleDateString()}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold bg-emerald-500 text-white shadow-[0_4px_20px_rgba(0,0,0,0.2)] animate-in slide-in-from-bottom-2 fade-in duration-300">
                    {toast}
                </div>
            )}
        </>
    );
}
