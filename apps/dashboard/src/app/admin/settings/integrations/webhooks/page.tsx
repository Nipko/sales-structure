"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    Webhook, Plus, Trash2, RotateCw, Eye, EyeOff,
    Copy, CheckCircle, XCircle, Loader2, Send, ToggleLeft, ToggleRight,
    Clock, ChevronDown, ChevronUp, AlertTriangle,
} from "lucide-react";

interface WebhookEndpoint {
    id: string;
    url: string;
    events: string[];
    secret: string;
    is_active: boolean;
    description?: string;
    created_at: string;
    updated_at: string;
}

interface Delivery {
    id: string;
    event: string;
    status_code: number | null;
    error: string | null;
    attempt: number;
    delivered_at: string;
}

const EVENT_LABELS: Record<string, string> = {
    "lead.created": "lead.created",
    "handoff.created": "handoff.created",
    "appointment.booked": "appointment.booked",
    "message.received": "message.received",
    "campaign.completed": "campaign.completed",
};

const EVENTS = Object.keys(EVENT_LABELS);

const inputCls =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40";

export default function WebhooksSettingsPage() {
    const t = useTranslations("outboundWebhooks");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ url: "", events: [] as string[], description: "" });
    const [creating, setCreating] = useState(false);

    const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
    const [copied, setCopied] = useState("");
    const [expandedDeliveries, setExpandedDeliveries] = useState<Record<string, boolean>>({});
    const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
    const [testing, setTesting] = useState("");

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        const res = await api.listWebhooks(activeTenantId);
        if (res.success) setEndpoints(res.data || []);
        else setError(res.error || tc("connectionError"));
        setLoading(false);
    }, [activeTenantId, tc]);

    useEffect(() => { load(); }, [load]);

    const handleCreate = async () => {
        if (!form.url || form.events.length === 0) return;
        setCreating(true);
        const res = await api.createWebhook(activeTenantId!, {
            url: form.url,
            events: form.events,
            description: form.description || undefined,
        });
        setCreating(false);
        if (res.success) {
            setShowCreate(false);
            setForm({ url: "", events: [], description: "" });
            load();
        } else {
            setError(res.error || "");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm(t("confirmDelete"))) return;
        await api.deleteWebhook(activeTenantId!, id);
        load();
    };

    const handleToggle = async (ep: WebhookEndpoint) => {
        await api.updateWebhook(activeTenantId!, ep.id, { is_active: !ep.is_active });
        load();
    };

    const handleRegenerate = async (id: string) => {
        if (!confirm(t("confirmRegenerate"))) return;
        const res = await api.regenerateWebhookSecret(activeTenantId!, id);
        if (res.success) load();
    };

    const handleTest = async (id: string) => {
        setTesting(id);
        await api.testWebhook(activeTenantId!, id);
        setTesting("");
        if (expandedDeliveries[id]) loadDeliveries(id);
    };

    const loadDeliveries = async (id: string) => {
        const res = await api.getWebhookDeliveries(activeTenantId!, id, 20);
        if (res.success) setDeliveries((prev) => ({ ...prev, [id]: res.data || [] }));
    };

    const toggleDeliveries = (id: string) => {
        const next = !expandedDeliveries[id];
        setExpandedDeliveries((prev) => ({ ...prev, [id]: next }));
        if (next && !deliveries[id]) loadDeliveries(id);
    };

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopied(id);
        setTimeout(() => setCopied(""), 2000);
    };

    const toggleEvent = (event: string) => {
        setForm((f) => ({
            ...f,
            events: f.events.includes(event) ? f.events.filter((e) => e !== event) : [...f.events, event],
        }));
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-3xl">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Webhook className="h-6 w-6 text-indigo-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition"
                >
                    <Plus className="h-4 w-4" />
                    {t("addEndpoint")}
                </button>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {/* Create Modal */}
            {showCreate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg shadow-xl space-y-4">
                        <h2 className="text-lg font-semibold">{t("addEndpoint")}</h2>

                        <div>
                            <label className="text-sm font-medium text-foreground">{t("urlLabel")}</label>
                            <input
                                type="url"
                                value={form.url}
                                onChange={(e) => setForm({ ...form, url: e.target.value })}
                                placeholder="https://example.com/webhook"
                                className={inputCls + " mt-1"}
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium text-foreground">{t("descriptionLabel")}</label>
                            <input
                                type="text"
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                placeholder={t("descriptionPlaceholder")}
                                className={inputCls + " mt-1"}
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium text-foreground">{t("eventsLabel")}</label>
                            <div className="mt-2 space-y-1.5">
                                {EVENTS.map((ev) => (
                                    <label key={ev} className="flex items-center gap-2 cursor-pointer text-sm">
                                        <input
                                            type="checkbox"
                                            checked={form.events.includes(ev)}
                                            onChange={() => toggleEvent(ev)}
                                            className="rounded border-border"
                                        />
                                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{ev}</code>
                                        <span className="text-muted-foreground">— {t(`eventDesc.${ev.replace(/\./g, "_")}` as any)}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={() => setShowCreate(false)}
                                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
                            >
                                {tc("cancel")}
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={creating || !form.url || form.events.length === 0}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                            >
                                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : t("create")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Endpoint List */}
            {endpoints.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-8 text-center">
                    <Webhook className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">{t("empty")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t("emptyHint")}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {endpoints.map((ep) => (
                        <div key={ep.id} className="bg-card border border-border rounded-xl overflow-hidden">
                            <div className="p-4 space-y-3">
                                {/* Header row */}
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${ep.is_active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400"}`}>
                                                {ep.is_active ? t("active") : t("inactive")}
                                            </span>
                                            {ep.description && (
                                                <span className="text-sm font-medium truncate">{ep.description}</span>
                                            )}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-1 truncate">{ep.url}</p>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        <button onClick={() => handleToggle(ep)} title={ep.is_active ? t("disable") : t("enable")} className="p-1.5 rounded hover:bg-muted transition">
                                            {ep.is_active ? <ToggleRight className="h-4 w-4 text-emerald-500" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                                        </button>
                                        <button
                                            onClick={() => handleTest(ep.id)}
                                            disabled={testing === ep.id}
                                            title={t("sendTest")}
                                            className="p-1.5 rounded hover:bg-muted transition"
                                        >
                                            {testing === ep.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 text-blue-500" />}
                                        </button>
                                        <button onClick={() => handleDelete(ep.id)} title={tc("delete")} className="p-1.5 rounded hover:bg-muted transition">
                                            <Trash2 className="h-4 w-4 text-red-500" />
                                        </button>
                                    </div>
                                </div>

                                {/* Events */}
                                <div className="flex flex-wrap gap-1.5">
                                    {ep.events.map((ev) => (
                                        <span key={ev} className="inline-flex px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-[10px] font-mono">
                                            {ev}
                                        </span>
                                    ))}
                                </div>

                                {/* Secret */}
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-muted-foreground">{t("secret")}:</span>
                                    <code className="bg-muted px-2 py-0.5 rounded font-mono text-[11px]">
                                        {visibleSecrets[ep.id] ? ep.secret : "••••••••••••••••"}
                                    </code>
                                    <button onClick={() => setVisibleSecrets((s) => ({ ...s, [ep.id]: !s[ep.id] }))} className="p-1 hover:bg-muted rounded">
                                        {visibleSecrets[ep.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                    </button>
                                    <button onClick={() => copyToClipboard(ep.secret, ep.id)} className="p-1 hover:bg-muted rounded">
                                        {copied === ep.id ? <CheckCircle className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                                    </button>
                                    <button onClick={() => handleRegenerate(ep.id)} title={t("regenerate")} className="p-1 hover:bg-muted rounded">
                                        <RotateCw className="h-3 w-3 text-amber-500" />
                                    </button>
                                </div>
                            </div>

                            {/* Deliveries toggle */}
                            <button
                                onClick={() => toggleDeliveries(ep.id)}
                                className="w-full flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground hover:bg-muted/50 transition"
                            >
                                <span className="flex items-center gap-1.5">
                                    <Clock className="h-3 w-3" /> {t("recentDeliveries")}
                                </span>
                                {expandedDeliveries[ep.id] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>

                            {expandedDeliveries[ep.id] && (
                                <div className="border-t border-border divide-y divide-border max-h-48 overflow-y-auto">
                                    {!deliveries[ep.id] ? (
                                        <div className="px-4 py-3 text-xs text-muted-foreground text-center">
                                            <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> {tc("loading")}
                                        </div>
                                    ) : deliveries[ep.id].length === 0 ? (
                                        <div className="px-4 py-3 text-xs text-muted-foreground text-center">{t("noDeliveries")}</div>
                                    ) : (
                                        deliveries[ep.id].map((d) => (
                                            <div key={d.id} className="px-4 py-2 flex items-center gap-3 text-xs">
                                                {d.status_code && d.status_code >= 200 && d.status_code < 300 ? (
                                                    <CheckCircle className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                                                ) : (
                                                    <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                                                )}
                                                <code className="bg-muted px-1.5 py-0.5 rounded">{d.event}</code>
                                                <span className="text-muted-foreground">
                                                    {d.status_code ? `HTTP ${d.status_code}` : d.error?.slice(0, 40) || "—"}
                                                </span>
                                                <span className="ml-auto text-muted-foreground font-mono">
                                                    {new Date(d.delivered_at).toLocaleString()}
                                                </span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <div className="bg-muted/50 border border-border rounded-lg p-4 text-xs text-muted-foreground space-y-1.5">
                <p className="font-medium text-foreground">{t("signatureInfo")}</p>
                <p>{t("signatureDesc")}</p>
                <code className="block bg-muted p-2 rounded text-[11px]">
                    X-Webhook-Signature: HMAC-SHA256(payload, secret)
                </code>
            </div>
        </div>
    );
}
