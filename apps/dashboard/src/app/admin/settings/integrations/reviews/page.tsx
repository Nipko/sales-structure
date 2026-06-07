"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { Star, Loader2, RefreshCw, Sparkles, Send, Link2, CheckCircle2, MessageSquare } from "lucide-react";

interface Cfg { connected: boolean; accountId?: string; locationId?: string; locationName?: string; autoReply: boolean }
interface Review {
    id: string; reviewer: string; photo?: string; rating: number; comment?: string; createdAt?: string;
    replyComment?: string; replyStatus: string; aiSuggestion?: string;
}
interface Stats { total: number; avgRating: number; unreplied: number; negative: number; positive: number }

const CARD = "rounded-[14px] border border-border bg-card p-6";
const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

function Stars({ n }: { n: number }) {
    return <span className="inline-flex">{[1, 2, 3, 4, 5].map((i) => <Star key={i} size={13} className={i <= n ? "text-yellow-500 fill-yellow-500" : "text-neutral-300 dark:text-neutral-600"} />)}</span>;
}

export default function ReviewsSettingsPage() {
    const t = useTranslations("reviewsModule");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();

    const [cfg, setCfg] = useState<Cfg | null>(null);
    const [stats, setStats] = useState<Stats | null>(null);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState("");
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [form, setForm] = useState({ accountId: "", locationId: "", locationName: "" });

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const c: any = await api.getReviewsConfig(activeTenantId);
            if (c?.success) {
                setCfg(c.data);
                setForm({ accountId: c.data.accountId || "", locationId: c.data.locationId || "", locationName: c.data.locationName || "" });
                if (c.data.connected) {
                    const [s, r]: any[] = await Promise.all([api.getReviewsStats(activeTenantId), api.listReviews(activeTenantId)]);
                    if (s?.success) setStats(s.data);
                    if (r?.success) setReviews(r.data || []);
                }
            }
        } catch { /* noop */ }
        setLoading(false);
    }, [activeTenantId]);

    useEffect(() => { load(); }, [load]);

    const connect = async () => {
        if (!activeTenantId) return;
        const res: any = await api.connectReviews(activeTenantId);
        if (res?.success && res.data?.url) window.location.href = res.data.url;
    };
    const saveCfg = async () => {
        if (!activeTenantId) return;
        setBusy("cfg");
        try { await api.updateReviewsConfig(activeTenantId, form); await load(); } finally { setBusy(""); }
    };
    const toggleAuto = async () => {
        if (!activeTenantId || !cfg) return;
        await api.updateReviewsConfig(activeTenantId, { autoReply: !cfg.autoReply });
        await load();
    };
    const sync = async () => {
        if (!activeTenantId) return;
        setBusy("sync");
        try { await api.syncReviews(activeTenantId); await load(); } finally { setBusy(""); }
    };
    const disconnect = async () => {
        if (!activeTenantId) return;
        await api.disconnectReviews(activeTenantId); await load();
    };
    const generate = async (r: Review) => {
        if (!activeTenantId) return;
        setBusy(`gen:${r.id}`);
        try {
            const res: any = await api.generateReviewReply(activeTenantId, r.id);
            if (res?.success) setDrafts((d) => ({ ...d, [r.id]: res.data.suggestion }));
        } finally { setBusy(""); }
    };
    const postReply = async (r: Review) => {
        if (!activeTenantId) return;
        const comment = drafts[r.id] ?? r.aiSuggestion ?? "";
        if (!comment.trim()) return;
        setBusy(`post:${r.id}`);
        try { await api.postReviewReply(activeTenantId, r.id, comment); await load(); } finally { setBusy(""); }
    };

    return (
        <div className="max-w-3xl mx-auto p-6 space-y-5">
            <PageHeader icon={Star} title={t("title")} subtitle={t("subtitle")} />

            <HelpPanel
                title={tHelp("settingsIntegrationsReviews.title")}
                description={tHelp("settingsIntegrationsReviews.description")}
                tips={tHelp.raw("settingsIntegrationsReviews.tips") as string[]}
                mediaKey="settingsIntegrationsReviews"
            />

            {loading && !cfg ? (
                <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : !cfg?.connected ? (
                <div className={cn(CARD, "text-center py-10")}>
                    <Star size={32} className="text-yellow-500 mx-auto mb-3" />
                    <p className="text-sm text-text-secondary mb-4">{t("connectPrompt")}</p>
                    <button onClick={connect} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700">
                        <Link2 size={16} /> {t("connectGbp")}
                    </button>
                </div>
            ) : (
                <>
                    {/* Connection config */}
                    <div className={CARD}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                                <CheckCircle2 size={16} className="text-emerald-500" /> {t("connected")}
                            </h3>
                            <button onClick={disconnect} className="text-xs text-muted-foreground hover:text-red-400">{t("disconnect")}</button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {([["accountId", "Account ID"], ["locationId", "Location ID"], ["locationName", t("locationName")]] as const).map(([k, label]) => (
                                <div key={k}>
                                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{label}</label>
                                    <input className={inputCls} value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center gap-3 mt-4">
                            <button onClick={saveCfg} disabled={busy === "cfg"} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
                                {busy === "cfg" && <Loader2 size={15} className="animate-spin" />} {t("save")}
                            </button>
                            <button onClick={sync} disabled={busy === "sync"} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
                                {busy === "sync" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {t("sync")}
                            </button>
                            <label className="ml-auto flex items-center gap-2 cursor-pointer text-sm text-foreground">
                                <input type="checkbox" checked={cfg.autoReply} onChange={toggleAuto} className="h-4 w-4 accent-indigo-500" />
                                {t("autoReply")}
                            </label>
                        </div>
                    </div>

                    {/* Stats */}
                    {stats && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className={CARD + " !p-4"}><div className="text-xs text-muted-foreground mb-1">{t("avgRating")}</div><div className="text-xl font-semibold text-foreground flex items-center gap-1.5">{stats.avgRating} <Star size={16} className="text-yellow-500 fill-yellow-500" /></div></div>
                            <div className={CARD + " !p-4"}><div className="text-xs text-muted-foreground mb-1">{t("totalReviews")}</div><div className="text-xl font-semibold text-foreground">{stats.total}</div></div>
                            <div className={CARD + " !p-4"}><div className="text-xs text-muted-foreground mb-1">{t("unreplied")}</div><div className="text-xl font-semibold text-amber-500">{stats.unreplied}</div></div>
                            <div className={CARD + " !p-4"}><div className="text-xs text-muted-foreground mb-1">{t("negative")}</div><div className="text-xl font-semibold text-red-400">{stats.negative}</div></div>
                        </div>
                    )}

                    {/* Reviews list */}
                    <div className="space-y-3">
                        {reviews.length === 0 ? (
                            <div className={cn(CARD, "text-center py-8")}><p className="text-sm text-muted-foreground">{t("noReviews")}</p></div>
                        ) : reviews.map((r) => (
                            <div key={r.id} className={CARD}>
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className="text-sm font-medium text-foreground">{r.reviewer}</span>
                                    <Stars n={r.rating} />
                                    {r.replyStatus === "posted" && <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">{t("replied")}</span>}
                                </div>
                                {r.comment && <p className="text-sm text-text-secondary mb-3">{r.comment}</p>}

                                {r.replyStatus === "posted" ? (
                                    <div className="rounded-lg bg-neutral-50 dark:bg-white/[0.03] p-3 text-sm text-text-secondary flex gap-2">
                                        <MessageSquare size={14} className="text-emerald-500 shrink-0 mt-0.5" /> {r.replyComment}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <textarea
                                            rows={2}
                                            className={cn(inputCls, "resize-none")}
                                            placeholder={t("replyPlaceholder")}
                                            value={drafts[r.id] ?? r.aiSuggestion ?? ""}
                                            onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                                        />
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => generate(r)} disabled={busy === `gen:${r.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
                                                {busy === `gen:${r.id}` ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {t("aiSuggest")}
                                            </button>
                                            <button onClick={() => postReply(r)} disabled={busy === `post:${r.id}` || !(drafts[r.id] ?? r.aiSuggestion)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
                                                {busy === `post:${r.id}` ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {t("postReply")}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
