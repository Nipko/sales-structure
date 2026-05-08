"use client";

/**
 * Field-services dispatch board for servicios_hogar tenants. Lists
 * incoming requests sorted by urgency, lets the operator advance
 * status or assign a technician. Auto-refresh every 20s during peak
 * dispatch hours.
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Wrench, RefreshCw, Loader2, MapPin, Phone, AlertTriangle,
    Clock, ChevronRight, X, Save, User,
} from "lucide-react";

interface ServiceRequest {
    id: string;
    service_type: string;
    urgency: string;
    customer_name?: string;
    customer_phone?: string;
    address?: string;
    address_notes?: string;
    city?: string;
    issue_description?: string;
    preferred_date?: string;
    preferred_time_window?: string;
    estimated_cost?: number;
    currency?: string;
    assigned_technician_name?: string;
    scheduled_at?: string;
    completed_at?: string;
    status: string;
    created_at: string;
}

const URGENCY_COLOR: Record<string, string> = {
    emergencia: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
    alta: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    normal: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
    flexible: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-400 border-neutral-500/30",
};

const STATUS_FLOW = ["pending", "quoted", "scheduled", "dispatched", "in_progress", "completed"] as const;

export default function ServiceRequestsPage() {
    const t = useTranslations("serviceRequests");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [requests, setRequests] = useState<ServiceRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"all" | "active" | "emergency">("all");
    const [selected, setSelected] = useState<ServiceRequest | null>(null);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        try {
            const params: any = {};
            if (filter === "emergency") params.urgency = "emergencia";
            const res = await api.listServiceRequests(activeTenantId, params);
            if (res.success) {
                let data = res.data || [];
                if (filter === "active") {
                    data = data.filter((r: ServiceRequest) => !["completed", "cancelled"].includes(r.status));
                }
                setRequests(data);
            }
        } finally { setLoading(false); }
    }, [activeTenantId, filter]);

    useEffect(() => {
        load();
        const id = setInterval(load, 20000);
        return () => clearInterval(id);
    }, [load]);

    async function handleAdvance(req: ServiceRequest) {
        if (!activeTenantId) return;
        const idx = STATUS_FLOW.indexOf(req.status as any);
        if (idx === -1 || idx === STATUS_FLOW.length - 1) return;
        const nextStatus = STATUS_FLOW[idx + 1];
        await api.updateServiceRequest(activeTenantId, req.id, { status: nextStatus });
        load();
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Wrench className="h-6 w-6 text-amber-600" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground rounded-lg text-sm transition disabled:opacity-50">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {tc("refresh")}
                </button>
            </div>

            <div className="flex bg-card border border-border rounded-lg p-0.5 w-fit">
                {([
                    { id: "all", label: t("filterAll") },
                    { id: "active", label: t("filterActive") },
                    { id: "emergency", label: t("filterEmergency") },
                ] as const).map(f => (
                    <button key={f.id} onClick={() => setFilter(f.id as any)} className={cn(
                        "px-3 py-1.5 text-sm font-medium rounded transition",
                        filter === f.id ? "bg-amber-600 text-white" : "text-muted-foreground hover:text-foreground",
                    )}>
                        {f.label}
                    </button>
                ))}
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
                {loading && requests.length === 0 ? (
                    <div className="p-3 space-y-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="skeleton h-16 w-full rounded-lg" />
                        ))}
                    </div>
                ) : requests.length === 0 ? (
                    <div className="text-center py-12 text-sm text-muted-foreground">{t("noRequests")}</div>
                ) : (
                    <div className="divide-y divide-border">
                        {requests.map(req => {
                            const ageMin = Math.floor((Date.now() - new Date(req.created_at).getTime()) / 60000);
                            const stale = req.urgency === "emergencia" && ageMin > 30 && req.status === "pending";
                            return (
                                <div key={req.id} className={cn("p-4 hover:bg-muted/20 cursor-pointer", stale && "bg-red-500/5")} onClick={() => setSelected(req)}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <span className={cn("text-[10px] px-2 py-0.5 rounded font-medium border uppercase", URGENCY_COLOR[req.urgency])}>
                                                    {req.urgency}
                                                </span>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono uppercase">{req.service_type}</span>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{req.status}</span>
                                                <span className="text-[10px] text-muted-foreground font-mono">{ageMin}m</span>
                                            </div>
                                            <div className="text-sm font-medium">{req.customer_name || t("anonymous")}</div>
                                            {req.address && (
                                                <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                                    <MapPin className="h-3 w-3" /> {req.address}{req.city && `, ${req.city}`}
                                                </div>
                                            )}
                                            {req.issue_description && (
                                                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                                    {req.issue_description}
                                                </div>
                                            )}
                                            {req.assigned_technician_name && (
                                                <div className="text-xs text-emerald-600 flex items-center gap-1 mt-1">
                                                    <User className="h-3 w-3" /> {req.assigned_technician_name}
                                                </div>
                                            )}
                                        </div>
                                        {!["completed", "cancelled"].includes(req.status) && (
                                            <button onClick={(e) => { e.stopPropagation(); handleAdvance(req); }} className="text-xs px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium inline-flex items-center gap-1 flex-shrink-0">
                                                <ChevronRight className="h-3 w-3" /> {t("advance")}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {selected && (
                <RequestDetailModal request={selected} onClose={() => setSelected(null)} onUpdated={() => { setSelected(null); load(); }} />
            )}
        </div>
    );
}

function RequestDetailModal({ request, onClose, onUpdated }: { request: ServiceRequest; onClose: () => void; onUpdated: () => void }) {
    const t = useTranslations("serviceRequests");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [tech, setTech] = useState(request.assigned_technician_name || "");
    const [scheduledAt, setScheduledAt] = useState(request.scheduled_at?.slice(0, 16) || "");
    const [estimatedCost, setEstimatedCost] = useState(request.estimated_cost?.toString() || "");
    const [busy, setBusy] = useState(false);

    async function handleSave() {
        if (!activeTenantId) return;
        setBusy(true);
        try {
            await api.updateServiceRequest(activeTenantId, request.id, {
                assignedTechnicianName: tech || undefined,
                scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
                estimatedCost: estimatedCost ? parseFloat(estimatedCost) : undefined,
            });
            onUpdated();
        } finally { setBusy(false); }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <div>
                        <h3 className="text-base font-semibold">{request.service_type}</h3>
                        <p className="text-xs text-muted-foreground font-mono">#{request.id.slice(0, 8)}</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
                </div>
                <div className="p-5 space-y-3 text-sm">
                    {request.customer_name && (
                        <div>
                            <div className="text-xs text-muted-foreground">{t("customer")}</div>
                            <div className="font-medium">{request.customer_name}</div>
                            {request.customer_phone && <div className="font-mono text-xs flex items-center gap-1"><Phone className="h-3 w-3" />{request.customer_phone}</div>}
                        </div>
                    )}
                    {request.address && (
                        <div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />{t("address")}</div>
                            <div>{request.address}</div>
                            {request.address_notes && <div className="text-xs text-muted-foreground italic">{request.address_notes}</div>}
                        </div>
                    )}
                    {request.issue_description && (
                        <div>
                            <div className="text-xs text-muted-foreground">{t("issue")}</div>
                            <div className="text-sm">{request.issue_description}</div>
                        </div>
                    )}
                    {(request.preferred_date || request.preferred_time_window) && (
                        <div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{t("preferred")}</div>
                            <div className="text-sm">{request.preferred_date} {request.preferred_time_window}</div>
                        </div>
                    )}
                    <div className="border-t border-border pt-3 space-y-3">
                        <div>
                            <label className="block text-xs font-medium mb-1">{t("technician")}</label>
                            <input type="text" value={tech} onChange={e => setTech(e.target.value)} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium mb-1">{t("scheduledAt")}</label>
                            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium mb-1">{t("estimatedCost")}</label>
                            <input type="number" step="0.01" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} className="px-3 py-1.5 bg-muted/30 hover:bg-muted text-foreground border border-border rounded-lg text-sm transition-colors">{tc("cancel")}</button>
                    <button onClick={handleSave} disabled={busy} className="inline-flex items-center gap-2 px-4 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
