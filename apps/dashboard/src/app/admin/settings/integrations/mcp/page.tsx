"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Plug2, Loader2, Plus, Trash2, CheckCircle2, Server, Copy, Power } from "lucide-react";

interface McpServer { id: string; name: string; url: string; authHeader?: string; enabled: boolean }

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";
const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40";

export default function McpSettingsPage() {
    const t = useTranslations("mcp");
    const { activeTenantId } = useTenant();

    const [servers, setServers] = useState<McpServer[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState("");
    const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
    const [form, setForm] = useState({ name: "", url: "", authHeader: "" });

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res: any = await api.listMcpServers(activeTenantId);
            if (res?.success) setServers(res.data || []);
        } catch { /* noop */ }
        setLoading(false);
    }, [activeTenantId]);

    useEffect(() => { load(); }, [load]);

    const flash = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 3500); };

    const add = async () => {
        if (!activeTenantId || !form.name.trim() || !form.url.trim()) return;
        setBusy("add");
        try {
            const res: any = await api.saveMcpServer(activeTenantId, { ...form, enabled: true });
            if (res?.success) { setForm({ name: "", url: "", authHeader: "" }); await load(); flash(true, t("saved")); }
            else flash(false, t("saveFailed"));
        } catch (e: any) { flash(false, e?.message || t("saveFailed")); }
        setBusy("");
    };

    const toggle = async (s: McpServer) => {
        if (!activeTenantId) return;
        setBusy(`toggle:${s.id}`);
        try {
            await api.saveMcpServer(activeTenantId, { id: s.id, name: s.name, url: s.url, enabled: !s.enabled });
            await load();
        } catch { /* noop */ }
        setBusy("");
    };

    const test = async (s: McpServer) => {
        if (!activeTenantId) return;
        setBusy(`test:${s.id}`);
        try {
            const res: any = await api.testMcpServer(activeTenantId, s.id);
            const ok = res?.success && res.data?.ok;
            flash(!!ok, ok ? t("testOk", { count: res.data?.toolCount ?? 0 }) : `${t("testFailed")}${res?.data?.message ? `: ${res.data.message}` : ""}`);
        } catch (e: any) { flash(false, e?.message || t("testFailed")); }
        setBusy("");
    };

    const remove = async (s: McpServer) => {
        if (!activeTenantId) return;
        setBusy(`del:${s.id}`);
        try { await api.deleteMcpServer(activeTenantId, s.id); await load(); } catch { /* noop */ }
        setBusy("");
    };

    const copyUrl = () => { navigator.clipboard?.writeText(`${API_BASE}/mcp/rpc`); flash(true, t("copied")); };

    return (
        <div className="max-w-3xl mx-auto p-6">
            <PageHeader icon={Plug2} title={t("title")} subtitle={t("subtitle")} />

            {toast && <div className={cn("mb-4 text-sm font-medium", toast.ok ? "text-emerald-500" : "text-red-400")}>{toast.msg}</div>}

            {/* Expose — our MCP server endpoint */}
            <div className="rounded-[14px] border border-border bg-card p-6 mb-5">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center"><Server size={20} className="text-cyan-500" /></div>
                    <div>
                        <h3 className="text-sm font-semibold text-foreground">{t("exposeTitle")}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("exposeDesc")}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                    <code className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground font-mono">{API_BASE}/mcp/rpc</code>
                    <button onClick={copyUrl} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted">
                        <Copy size={14} /> {t("copy")}
                    </button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">{t("exposeAuthHint")}</p>
            </div>

            {/* Consume — external MCP servers */}
            <div className="rounded-[14px] border border-border bg-card p-6">
                <h3 className="text-sm font-semibold text-foreground mb-1">{t("consumeTitle")}</h3>
                <p className="text-xs text-muted-foreground mb-4">{t("consumeDesc")}</p>

                {loading ? (
                    <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div>
                ) : (
                    <>
                        {servers.length > 0 && (
                            <div className="space-y-2 mb-5">
                                {servers.map((s) => (
                                    <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                                        <div className={cn("w-2 h-2 rounded-full shrink-0", s.enabled ? "bg-emerald-500" : "bg-neutral-400")} />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-foreground truncate">{s.name}</div>
                                            <div className="text-[11px] text-muted-foreground font-mono truncate">{s.url}</div>
                                        </div>
                                        <button onClick={() => test(s)} disabled={busy === `test:${s.id}`} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                                            {busy === `test:${s.id}` ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} {t("test")}
                                        </button>
                                        <button onClick={() => toggle(s)} title={t("toggle")} className={cn("hover:text-foreground", s.enabled ? "text-emerald-500" : "text-neutral-400")}>
                                            <Power size={15} />
                                        </button>
                                        <button onClick={() => remove(s)} className="text-muted-foreground hover:text-red-400"><Trash2 size={15} /></button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Add form */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input className={inputCls} placeholder={t("namePlaceholder")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                            <input className={inputCls} placeholder="https://...mcp" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
                            <input className={inputCls} placeholder={t("authPlaceholder")} value={form.authHeader} onChange={(e) => setForm({ ...form, authHeader: e.target.value })} />
                        </div>
                        <button onClick={add} disabled={busy === "add" || !form.name.trim() || !form.url.trim()}
                            className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
                            {busy === "add" ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} {t("addServer")}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
