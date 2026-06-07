"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import {
    ClipboardList, Search, ChevronRight,
    PlayCircle, Pause, CheckCircle2, XCircle,
} from "lucide-react";
import { SkeletonTable } from "@/components/ui/skeleton-loader";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpPanel } from "@/components/ui/help-panel";

interface PlanRow {
    id: string;
    name: string;
    plan_type: string | null;
    contact_id: string;
    contact_name: string | null;
    contact_phone: string | null;
    total_sessions: number;
    completed_sessions: number;
    status: string;
    started_at: string | null;
    expected_end_at: string | null;
    total_cost: number | null;
    currency: string | null;
    created_at: string;
}

const STATUS_TABS = ["all", "active", "paused", "completed", "cancelled"] as const;
type StatusTab = typeof STATUS_TABS[number];

const STATUS_META: Record<string, { icon: any; bg: string; text: string }> = {
    active:    { icon: PlayCircle,  bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400" },
    paused:    { icon: Pause,       bg: "bg-amber-500/10",   text: "text-amber-600 dark:text-amber-400" },
    completed: { icon: CheckCircle2, bg: "bg-indigo-500/10",  text: "text-indigo-600 dark:text-indigo-400" },
    cancelled: { icon: XCircle,     bg: "bg-neutral-500/10", text: "text-neutral-500" },
};

export default function TreatmentPlansPage() {
    const t = useTranslations("treatmentPlansPage");
    const tHelp = useTranslations("help");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [plans, setPlans] = useState<PlanRow[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({ active: 0, paused: 0, completed: 0, cancelled: 0 });
    const [tab, setTab] = useState<StatusTab>("active");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        const res = await api.listAllTreatmentPlans(activeTenantId, {
            status: tab,
            search: search || undefined,
        });
        if (res.success && res.data) {
            setPlans((res.data as any).plans || []);
            setCounts((res.data as any).counts || {});
        }
        setLoading(false);
    }, [activeTenantId, tab, search]);

    useEffect(() => { load(); }, [load]);

    const totalAll = (counts.active || 0) + (counts.paused || 0) + (counts.completed || 0) + (counts.cancelled || 0);

    const tabs = STATUS_TABS.map((id) => ({
        id,
        label: id === "all"
            ? `${t(`status.all`)} (${totalAll})`
            : `${t(`status.${id}`)} (${counts[id] || 0})`,
    }));

    return (
        <div className="max-w-[1400px] mx-auto space-y-6">
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={ClipboardList}
            />

            <HelpPanel
                title={tHelp("treatmentPlans.title")}
                description={tHelp("treatmentPlans.description")}
                tips={tHelp.raw("treatmentPlans.tips") as string[]}
                mediaKey="treatmentPlans"
            />

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <TabNav
                    tabs={tabs}
                    activeTab={tab}
                    onTabChange={(id) => setTab(id as StatusTab)}
                />
                <div className="relative md:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input
                        type="search"
                        placeholder={t("searchPlaceholder")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                    />
                </div>
            </div>

            {loading && <SkeletonTable rows={6} cols={6} />}

            {!loading && plans.length === 0 && (
                <EmptyState
                    icon={ClipboardList}
                    iconColor="text-cyan-400"
                    title={t("empty.title")}
                    description={t("empty.hint")}
                />
            )}

            {!loading && plans.length > 0 && (
                <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-50 dark:bg-neutral-800/50 text-xs text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                                <tr>
                                    <th className="px-4 py-2.5 text-left font-medium">{t("col.patient")}</th>
                                    <th className="px-4 py-2.5 text-left font-medium">{t("col.plan")}</th>
                                    <th className="px-4 py-2.5 text-left font-medium">{t("col.progress")}</th>
                                    <th className="px-4 py-2.5 text-left font-medium">{t("col.status")}</th>
                                    <th className="px-4 py-2.5 text-left font-medium">{t("col.started")}</th>
                                    <th className="px-4 py-2.5 text-right font-medium">{t("col.cost")}</th>
                                    <th className="px-4 py-2.5"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {plans.map((p) => {
                                    const meta = STATUS_META[p.status] || STATUS_META.cancelled;
                                    const Icon = meta.icon;
                                    const pct = p.total_sessions > 0
                                        ? Math.round((p.completed_sessions / p.total_sessions) * 100)
                                        : 0;
                                    return (
                                        <tr
                                            key={p.id}
                                            className="border-b border-neutral-100 dark:border-neutral-800/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                                        >
                                            <td className="px-4 py-3">
                                                {p.contact_id ? (
                                                    <Link
                                                        href={`/admin/contacts/${p.contact_id}`}
                                                        className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                                                    >
                                                        {p.contact_name || tc("unknown")}
                                                    </Link>
                                                ) : (
                                                    <span className="text-neutral-500">{tc("unknown")}</span>
                                                )}
                                                {p.contact_phone && (
                                                    <div className="text-xs text-neutral-500 dark:text-neutral-400">{p.contact_phone}</div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-neutral-900 dark:text-neutral-100">{p.name}</div>
                                                {p.plan_type && (
                                                    <div className="text-xs text-neutral-500 dark:text-neutral-400">{p.plan_type}</div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-24 h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-indigo-500 transition-all"
                                                            style={{ width: `${pct}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                                                        {p.completed_sessions} / {p.total_sessions}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.bg} ${meta.text}`}>
                                                    <Icon className="w-3 h-3" />
                                                    {t(`status.${p.status}`)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 text-xs">
                                                {p.started_at ? new Date(p.started_at).toLocaleDateString() : "—"}
                                            </td>
                                            <td className="px-4 py-3 text-right text-neutral-700 dark:text-neutral-300">
                                                {p.total_cost
                                                    ? `${p.currency || ""} ${Number(p.total_cost).toLocaleString()}`
                                                    : "—"}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {p.contact_id && (
                                                    <Link
                                                        href={`/admin/contacts/${p.contact_id}`}
                                                        className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                                                    >
                                                        <ChevronRight className="w-4 h-4 inline" />
                                                    </Link>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
