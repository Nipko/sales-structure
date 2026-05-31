"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import {
    Building2, Loader2, Plus, Search, X, TrendingUp, AlertTriangle, Trash2,
    DollarSign, Target, Gauge, Users,
} from "lucide-react";

interface Org {
    id: string; name: string; industry?: string; city?: string; country?: string; website?: string;
    domain?: string; size?: string; phone?: string; email?: string; notes?: string;
    contactCount?: number; openOpportunities?: number; pipelineValue?: number; weightedValue?: number;
}
interface Forecast {
    openCount: number; totalPipeline: number; weightedPipeline: number; committedValue: number; bestCase: number;
    velocity: { avgDaysToWin: number | null; wonLast90Days: number; monthlyWinRate: number };
    byStage: { stage: string; stageName: string; probability: number; count: number; value: number; weighted: number }[];
}
interface Rotting { id: string; name: string; companyName?: string; stage: string; value: number; currency?: string; daysStale: number }

const CARD = "rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]";
const fmtMoney = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function OrganizationsPage() {
    const t = useTranslations("organizations");
    const { activeTenantId } = useTenant();

    const [orgs, setOrgs] = useState<Org[]>([]);
    const [forecast, setForecast] = useState<Forecast | null>(null);
    const [rotting, setRotting] = useState<Rotting[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<Org | null>(null);
    const [detail, setDetail] = useState<any | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const [o, f, r]: any[] = await Promise.all([
                api.listOrganizations(activeTenantId, search || undefined),
                api.getForecast(activeTenantId),
                api.getRottingDeals(activeTenantId, 14),
            ]);
            if (o?.success) setOrgs(o.data || []);
            if (f?.success) setForecast(f.data);
            if (r?.success) setRotting(r.data || []);
        } catch { /* noop */ }
        setLoading(false);
    }, [activeTenantId, search]);

    useEffect(() => { load(); }, [load]);

    const openDetail = async (org: Org) => {
        if (!activeTenantId) return;
        const res: any = await api.getOrganization(activeTenantId, org.id);
        if (res?.success) setDetail(res.data);
    };

    const save = async () => {
        if (!activeTenantId || !editing?.name?.trim()) return;
        setSaving(true);
        try {
            if (editing.id) await api.updateOrganization(activeTenantId, editing.id, editing);
            else await api.createOrganization(activeTenantId, editing);
            setEditing(null);
            await load();
        } finally { setSaving(false); }
    };

    const remove = async (org: Org) => {
        if (!activeTenantId) return;
        await api.deleteOrganization(activeTenantId, org.id);
        if (detail?.id === org.id) setDetail(null);
        await load();
    };

    return (
        <div className="space-y-6">
            <PageHeader icon={Building2} title={t("title")} subtitle={t("subtitle")}
                action={<button onClick={() => setEditing({ id: "", name: "" } as Org)} className="flex items-center gap-2 rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:opacity-90"><Plus size={16} /> {t("newOrg")}</button>}
            />

            {loading && !forecast ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : (
                <>
                    {/* Forecast KPIs */}
                    {forecast && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            <Kpi icon={DollarSign} color="text-emerald-500" label={t("weightedPipeline")} value={fmtMoney(forecast.weightedPipeline)} hint={t("weightedHint")} />
                            <Kpi icon={Target} color="text-violet-500" label={t("committed")} value={fmtMoney(forecast.committedValue)} hint={t("committedHint")} />
                            <Kpi icon={TrendingUp} color="text-sky-500" label={t("bestCase")} value={fmtMoney(forecast.bestCase)} hint={t("bestCaseHint")} />
                            <Kpi icon={Gauge} color="text-amber-500" label={t("avgDaysToWin")} value={forecast.velocity.avgDaysToWin != null ? `${forecast.velocity.avgDaysToWin}d` : "—"} hint={t("velocityHint")} />
                            <Kpi icon={Users} color="text-indigo-500" label={t("openDeals")} value={forecast.openCount} hint={t("monthlyWins", { n: forecast.velocity.monthlyWinRate })} />
                        </div>
                    )}

                    {/* Weighted by stage */}
                    {forecast && forecast.byStage.length > 0 && (
                        <div className={cn(CARD, "p-5")}>
                            <h3 className="text-sm font-semibold text-foreground mb-3">{t("byStage")}</h3>
                            <div className="space-y-2.5">
                                {forecast.byStage.map((s) => {
                                    const max = Math.max(...forecast.byStage.map((x) => x.value), 1);
                                    return (
                                        <div key={s.stage}>
                                            <div className="flex justify-between text-[13px] mb-1">
                                                <span className="text-text-secondary">{s.stageName} <span className="text-muted-foreground">· {s.count} · {s.probability}%</span></span>
                                                <span className="text-foreground font-medium">{fmtMoney(s.weighted)} <span className="text-muted-foreground text-xs">/ {fmtMoney(s.value)}</span></span>
                                            </div>
                                            <div className="h-2 rounded-full bg-neutral-100 dark:bg-white/[0.06] overflow-hidden">
                                                <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${(s.value / max) * 100}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Rotting alerts */}
                    {rotting.length > 0 && (
                        <div className={cn(CARD, "p-5 border-amber-300 dark:border-amber-500/30")}>
                            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                                <AlertTriangle size={16} className="text-amber-500" /> {t("rottingTitle")} ({rotting.length})
                            </h3>
                            <div className="space-y-1.5">
                                {rotting.slice(0, 10).map((d) => (
                                    <div key={d.id} className="flex items-center gap-3 text-sm">
                                        <span className="flex-1 truncate text-text-secondary">{d.name}{d.companyName ? ` · ${d.companyName}` : ""}</span>
                                        <span className="text-muted-foreground text-xs">{d.stage}</span>
                                        <span className="text-foreground">{fmtMoney(d.value)}</span>
                                        <span className="text-amber-500 text-xs font-medium w-20 text-right">{t("daysStale", { n: d.daysStale })}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Organizations */}
                    <div className={cn(CARD, "p-5")}>
                        <div className="flex items-center justify-between mb-4 gap-3">
                            <h3 className="text-sm font-semibold text-foreground">{t("organizations")}</h3>
                            <div className="relative">
                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchPlaceholder")}
                                    className="rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-sm text-foreground w-56" />
                            </div>
                        </div>
                        {orgs.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-8 text-center">{t("empty")}</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-200 dark:border-white/10 text-left">
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium">{t("name")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium">{t("industry")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-center">{t("contacts")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-center">{t("openDeals")}</th>
                                            <th className="py-2.5 px-3 text-muted-foreground font-medium text-right">{t("weighted")}</th>
                                            <th className="w-8"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orgs.map((o) => (
                                            <tr key={o.id} onClick={() => openDetail(o)} className="border-b border-neutral-100 dark:border-white/5 cursor-pointer hover:bg-neutral-50 dark:hover:bg-white/[0.03]">
                                                <td className="py-2.5 px-3 font-medium text-foreground">{o.name}</td>
                                                <td className="py-2.5 px-3 text-text-secondary">{o.industry || "—"}</td>
                                                <td className="py-2.5 px-3 text-center text-text-secondary">{o.contactCount ?? 0}</td>
                                                <td className="py-2.5 px-3 text-center text-text-secondary">{o.openOpportunities ?? 0}</td>
                                                <td className="py-2.5 px-3 text-right font-medium text-emerald-500">{fmtMoney(o.weightedValue ?? 0)}</td>
                                                <td className="py-2.5 px-3" onClick={(e) => { e.stopPropagation(); setEditing(o); }}>
                                                    <span className="text-xs text-accent hover:underline">{t("edit")}</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Edit/create modal */}
            {editing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setEditing(null)}>
                    <div className={cn(CARD, "w-full max-w-lg p-6")} onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-semibold text-foreground">{editing.id ? t("editOrg") : t("newOrg")}</h3>
                            <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {([
                                ["name", t("name")], ["industry", t("industry")], ["website", "Website"], ["domain", "Domain"],
                                ["size", t("size")], ["city", t("city")], ["phone", t("phone")], ["email", t("email")],
                            ] as const).map(([key, label]) => (
                                <div key={key} className={key === "name" ? "col-span-2" : ""}>
                                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{label}</label>
                                    <input value={(editing as any)[key] || ""} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                                </div>
                            ))}
                            <div className="col-span-2">
                                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{t("notes")}</label>
                                <textarea value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} rows={2}
                                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground resize-none" />
                            </div>
                        </div>
                        <div className="flex items-center gap-2 mt-5">
                            <button onClick={save} disabled={saving || !editing.name?.trim()} className="flex items-center gap-2 rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                                {saving && <Loader2 size={15} className="animate-spin" />} {t("save")}
                            </button>
                            {editing.id && (
                                <button onClick={() => { remove(editing); setEditing(null); }} className="ml-auto flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-red-400">
                                    <Trash2 size={15} /> {t("delete")}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Detail drawer */}
            {detail && (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={() => setDetail(null)}>
                    <div className="w-full max-w-md h-full bg-white dark:bg-[#12121e] border-l border-neutral-200 dark:border-white/10 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="sticky top-0 bg-white dark:bg-[#12121e] border-b border-neutral-200 dark:border-white/10 px-5 py-4 flex items-start justify-between">
                            <div>
                                <h3 className="text-base font-semibold text-foreground">{detail.name}</h3>
                                <p className="text-xs text-muted-foreground">{[detail.industry, detail.city].filter(Boolean).join(" · ") || "—"}</p>
                            </div>
                            <button onClick={() => setDetail(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-5">
                            <div className="grid grid-cols-3 gap-2 text-center">
                                <Mini label={t("contacts")} value={detail.members?.length ?? 0} />
                                <Mini label={t("openDeals")} value={detail.opportunities?.length ?? 0} />
                                <Mini label={t("weighted")} value={fmtMoney((detail.opportunities || []).reduce((s: number, o: any) => s + (o.weightedValue || 0), 0))} />
                            </div>
                            {detail.members?.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t("members")}</h4>
                                    <div className="space-y-1.5">
                                        {detail.members.map((m: any) => (
                                            <div key={m.contactId} className="flex items-center gap-2 text-sm">
                                                <span className="flex-1 truncate text-foreground">{m.name || "—"}</span>
                                                <span className="text-xs text-muted-foreground">{m.stage}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {detail.opportunities?.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t("openDeals")}</h4>
                                    <div className="space-y-1.5">
                                        {detail.opportunities.map((o: any) => (
                                            <div key={o.id} className="flex items-center gap-2 text-sm">
                                                <span className="flex-1 text-text-secondary">{o.stage} · {o.probability}%</span>
                                                <span className="text-emerald-500 font-medium">{fmtMoney(o.weightedValue)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function Kpi({ icon: Icon, color, label, value, hint }: { icon: any; color: string; label: string; value: string | number; hint?: string }) {
    return (
        <div className={cn(CARD, "p-4")}>
            <div className="flex items-center gap-2 mb-1.5"><Icon size={15} className={color} /><span className="text-xs text-muted-foreground">{label}</span></div>
            <div className="text-lg font-semibold text-foreground">{value}</div>
            {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
        </div>
    );
}
function Mini({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-lg bg-neutral-50 dark:bg-white/[0.03] p-2.5">
            <div className="text-sm font-semibold text-foreground">{value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
        </div>
    );
}
