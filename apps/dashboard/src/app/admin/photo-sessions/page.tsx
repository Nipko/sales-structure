"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import {
    Camera, Search, Image as ImageIcon, ExternalLink,
    Calendar, Clock,
} from "lucide-react";
import { motion } from "motion/react";
import { SkeletonCards } from "@/components/ui/skeleton-loader";
import { EmptyState } from "@/components/ui/empty-state";

interface SessionRow {
    id: string;
    contact_id: string | null;
    contact_name: string | null;
    contact_phone: string | null;
    client_name: string | null;
    client_phone: string | null;
    session_type: string;
    package_name: string | null;
    scheduled_at: string | null;
    duration_minutes: number | null;
    location: string | null;
    deliverable_count: number | null;
    delivered_count: number;
    gallery_url: string | null;
    delivery_due_at: string | null;
    delivered_at: string | null;
    price: number | null;
    currency: string | null;
    status: string;
}

const STATUS_TABS = ["all", "scheduled", "in_progress", "delivered", "cancelled"] as const;
type StatusTab = typeof STATUS_TABS[number];

const STATUS_META: Record<string, { bg: string; text: string }> = {
    scheduled:   { bg: "bg-blue-500/10",    text: "text-blue-600 dark:text-blue-400" },
    in_progress: { bg: "bg-amber-500/10",   text: "text-amber-600 dark:text-amber-400" },
    delivered:   { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400" },
    cancelled:   { bg: "bg-neutral-500/10", text: "text-neutral-500" },
};

export default function PhotoSessionsPage() {
    const t = useTranslations("photoSessionsPage");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({ scheduled: 0, in_progress: 0, delivered: 0, cancelled: 0 });
    const [tab, setTab] = useState<StatusTab>("all");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        const res = await api.listPhotoSessions(activeTenantId, {
            status: tab === "all" ? undefined : tab,
            search: search || undefined,
        });
        if (res.success && res.data) {
            setSessions((res.data as any).sessions || []);
            setCounts((res.data as any).counts || {});
        }
        setLoading(false);
    }, [activeTenantId, tab, search]);

    useEffect(() => { load(); }, [load]);

    const totalAll = (counts.scheduled || 0) + (counts.in_progress || 0) + (counts.delivered || 0) + (counts.cancelled || 0);

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
                icon={Camera}
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

            {loading && <SkeletonCards count={4} />}

            {!loading && sessions.length === 0 && (
                <EmptyState
                    icon={Camera}
                    iconColor="text-purple-400"
                    title={t("empty.title")}
                    description={t("empty.hint")}
                />
            )}

            {!loading && sessions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {sessions.map((s, i) => {
                        const meta = STATUS_META[s.status] || STATUS_META.cancelled;
                        const clientLabel = s.contact_name || s.client_name || tc("unknown");
                        const phone = s.contact_phone || s.client_phone || null;
                        const typeLabel = t.has(`sessionTypes.${s.session_type}`)
                            ? t(`sessionTypes.${s.session_type}`)
                            : s.session_type;
                        return (
                            <motion.div
                                key={s.id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, delay: 0.04 * Math.min(i, 8) }}
                                whileHover={{ y: -2 }}
                                className="group relative bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 overflow-hidden hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-lg hover:shadow-purple-500/5 transition-all duration-200"
                            >
                                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 via-transparent to-fuchsia-500/0 group-hover:from-purple-500/[0.04] group-hover:to-fuchsia-500/[0.06] transition-colors pointer-events-none" />
                                <div className="relative">
                                <div className="flex items-start justify-between gap-3 mb-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${meta.bg} ${meta.text}`}>
                                                {t(`status.${s.status}`)}
                                            </span>
                                            <span className="text-xs text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                                                {typeLabel}
                                            </span>
                                        </div>
                                        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mt-1.5 truncate">
                                            {s.contact_id ? (
                                                <Link href={`/admin/contacts/${s.contact_id}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">
                                                    {clientLabel}
                                                </Link>
                                            ) : clientLabel}
                                        </h3>
                                        {phone && (
                                            <p className="text-xs text-neutral-500 dark:text-neutral-400">{phone}</p>
                                        )}
                                        {s.package_name && (
                                            <p className="text-sm text-neutral-700 dark:text-neutral-300 mt-1.5">
                                                {s.package_name}
                                            </p>
                                        )}
                                    </div>
                                    {s.price && (
                                        <div className="text-right flex-shrink-0">
                                            <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("col.price")}</div>
                                            <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                                {s.currency} {Number(s.price).toLocaleString()}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    {s.scheduled_at && (
                                        <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                                            <Calendar className="w-3.5 h-3.5" />
                                            <span>{new Date(s.scheduled_at).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {s.delivery_due_at && s.status !== "delivered" && (
                                        <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                                            <Clock className="w-3.5 h-3.5" />
                                            <span>{tc("due")}: {new Date(s.delivery_due_at).toLocaleDateString()}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                                        <ImageIcon className="w-3.5 h-3.5" />
                                        <span>
                                            {s.delivered_count} / {s.deliverable_count || "?"}
                                        </span>
                                    </div>
                                    {s.gallery_url ? (
                                        <a
                                            href={s.gallery_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                                        >
                                            {t("col.gallery")}
                                            <ExternalLink className="w-3 h-3" />
                                        </a>
                                    ) : (
                                        <span className="text-xs text-neutral-400 italic">{t("noGallery")}</span>
                                    )}
                                </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
