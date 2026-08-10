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
import { HelpPanel } from "@/components/ui/help-panel";
import { formatLocalTimestamp } from "@/lib/local-timestamp";

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

const STATUS_TABS = ["all", "requested", "scheduled", "in_progress", "delivered", "cancelled"] as const;
type StatusTab = typeof STATUS_TABS[number];

const STATUS_META: Record<string, { bg: string; text: string }> = {
    requested:   { bg: "bg-purple-500/10",  text: "text-purple-600 dark:text-purple-400" },
    scheduled:   { bg: "bg-blue-500/10",    text: "text-blue-600 dark:text-blue-400" },
    in_progress: { bg: "bg-amber-500/10",   text: "text-amber-600 dark:text-amber-400" },
    delivered:   { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400" },
    cancelled:   { bg: "bg-neutral-500/10", text: "text-neutral-500" },
};

export default function PhotoSessionsPage() {
    const t = useTranslations("photoSessionsPage");
    const tHelp = useTranslations("help");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({ requested: 0, scheduled: 0, in_progress: 0, delivered: 0, cancelled: 0 });
    const [tab, setTab] = useState<StatusTab>("all");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [delivering, setDelivering] = useState<SessionRow | null>(null);
    const [scheduling, setScheduling] = useState<SessionRow | null>(null);

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

    async function handleStatus(s: SessionRow, status: string) {
        if (!activeTenantId) return;
        if (status === "cancelled" && !confirm(t("cancelConfirm"))) return;
        await api.updatePhotoSession(activeTenantId, s.id, { status }).catch(() => null);
        load();
    }

    async function handleDeliver(galleryUrl: string, galleryPassword: string, deliveredCount: number) {
        if (!activeTenantId || !delivering) return;
        // El endpoint de entrega recibe la galería; el conteo entregado va por
        // update porque `deliver` no lo toca.
        if (deliveredCount > 0) {
            await api.updatePhotoSession(activeTenantId, delivering.id, { deliveredCount }).catch(() => null);
        }
        await api.deliverPhotoSession(activeTenantId, delivering.id, {
            galleryUrl: galleryUrl.trim(),
            galleryPassword: galleryPassword.trim() || undefined,
        }).catch(() => null);
        setDelivering(null);
        load();
    }

    async function handleSchedule(scheduledAt: string) {
        if (!activeTenantId || !scheduling) return;
        const res = await api.updatePhotoSession(activeTenantId, scheduling.id, {
            status: "scheduled",
            // photo_sessions.scheduled_at is a tenant-local TIMESTAMP; keep the
            // datetime-local literal instead of converting it to UTC.
            scheduledAt,
        }).catch(() => null);
        if (!res?.success) throw new Error("photo_session_schedule_failed");
        setScheduling(null);
        load();
    }

    const totalAll = (counts.requested || 0) + (counts.scheduled || 0) + (counts.in_progress || 0) + (counts.delivered || 0) + (counts.cancelled || 0);

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

            <HelpPanel
                title={tHelp("photoSessions.title")}
                description={tHelp("photoSessions.description")}
                tips={tHelp.raw("photoSessions.tips") as string[]}
                mediaKey="photoSessions"
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
                                            <span>{formatLocalTimestamp(s.scheduled_at)}</span>
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

                                {/* Acciones. La página era 100% de lectura: el
                                    estudio veía "0 / ? fotos" y "sin galería" sin
                                    ninguna forma de avanzar la sesión, así que el
                                    estado quedaba congelado en lo que había
                                    escrito el bot. update/deliver existían en el
                                    cliente HTTP con cero llamadores. */}
                                {s.status !== "cancelled" && s.status !== "delivered" && (
                                    <div className="mt-3 flex items-center justify-end gap-2">
                                        {s.status === "requested" && (
                                            <button
                                                onClick={() => setScheduling(s)}
                                                className="px-2.5 py-1 rounded-lg border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 text-xs font-medium hover:bg-purple-500/10 transition-colors cursor-pointer"
                                            >
                                                {t("actions.schedule")}
                                            </button>
                                        )}
                                        {s.status === "scheduled" && (
                                            <button
                                                onClick={() => handleStatus(s, "in_progress")}
                                                className="px-2.5 py-1 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors cursor-pointer"
                                            >
                                                {t("actions.start")}
                                            </button>
                                        )}
                                        {s.status !== "requested" && (
                                            <button
                                                onClick={() => setDelivering(s)}
                                                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                                            >
                                                {t("actions.deliver")}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleStatus(s, "cancelled")}
                                            className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer"
                                        >
                                            {tc("cancel")}
                                        </button>
                                    </div>
                                )}
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}

            {delivering && (
                <DeliverModal
                    session={delivering}
                    onClose={() => setDelivering(null)}
                    onDeliver={handleDeliver}
                    t={t}
                    tc={tc}
                />
            )}
            {scheduling && (
                <ScheduleModal
                    session={scheduling}
                    onClose={() => setScheduling(null)}
                    onSchedule={handleSchedule}
                    t={t}
                    tc={tc}
                />
            )}
        </div>
    );
}

function ScheduleModal({ session, onClose, onSchedule, t, tc }: {
    session: SessionRow;
    onClose: () => void;
    onSchedule: (scheduledAt: string) => Promise<void>;
    t: (k: string) => string;
    tc: (k: string) => string;
}) {
    const [scheduledAt, setScheduledAt] = useState(session.scheduled_at?.slice(0, 16) || "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function submit() {
        if (!scheduledAt) {
            setError(t("scheduleMissingDate"));
            return;
        }
        setBusy(true);
        setError("");
        try {
            await onSchedule(scheduledAt);
        } catch {
            setError(t("scheduleError"));
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onClose()}>
            <div className="w-full max-w-md rounded-xl bg-card border border-border p-6 shadow-xl" onClick={e => e.stopPropagation()}>
                <h3 className="font-semibold mb-1">{t("scheduleTitle")}</h3>
                <p className="text-xs text-muted-foreground mb-4">{session.contact_name || session.client_name || ""}</p>
                {error && (
                    <div className="px-3 py-2 rounded-lg mb-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                        {error}
                    </div>
                )}
                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("scheduleAt")}</label>
                <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                />
                <div className="flex justify-end gap-2 mt-5">
                    <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground cursor-pointer">
                        {tc("cancel")}
                    </button>
                    <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white transition-colors cursor-pointer">
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}


/**
 * Entrega de la sesión: la URL de la galería y cuántas fotos se entregaron.
 *
 * Es el cierre del circuito que la página mostraba y no dejaba operar. La
 * contraseña es opcional porque muchos estudios entregan con link público.
 */
function DeliverModal({ session, onClose, onDeliver, t, tc }: {
    session: { package_name: string | null; client_name: string | null; contact_name: string | null; deliverable_count: number | null };
    onClose: () => void;
    onDeliver: (galleryUrl: string, galleryPassword: string, deliveredCount: number) => Promise<void>;
    t: (k: string) => string;
    tc: (k: string) => string;
}) {
    const [galleryUrl, setGalleryUrl] = useState("");
    const [galleryPassword, setGalleryPassword] = useState("");
    const [deliveredCount, setDeliveredCount] = useState<number>(session.deliverable_count || 0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function submit() {
        if (!galleryUrl.trim()) {
            setError(t("deliverMissingUrl"));
            return;
        }
        setBusy(true);
        setError("");
        await onDeliver(galleryUrl, galleryPassword, Number(deliveredCount) || 0);
        setBusy(false);
    }

    const who = session.client_name || session.contact_name || "";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onClose()}>
            <div className="w-full max-w-md rounded-xl bg-card border border-border p-6 shadow-xl" onClick={e => e.stopPropagation()}>
                <h3 className="font-semibold mb-1">{t("actions.deliver")}</h3>
                <p className="text-xs text-muted-foreground mb-4">{who}{session.package_name ? ` · ${session.package_name}` : ""}</p>

                {error && (
                    <div className="px-3 py-2 rounded-lg mb-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                        {error}
                    </div>
                )}

                <div className="space-y-3">
                    <div>
                        <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("galleryUrl")}</label>
                        <input
                            value={galleryUrl}
                            onChange={e => setGalleryUrl(e.target.value)}
                            placeholder="https://..."
                            className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("galleryPassword")}</label>
                            <input
                                value={galleryPassword}
                                onChange={e => setGalleryPassword(e.target.value)}
                                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("deliveredCount")}</label>
                            <input
                                type="number" min={0}
                                value={deliveredCount}
                                onChange={e => setDeliveredCount(Number(e.target.value))}
                                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-5">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground cursor-pointer">
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={submit}
                        disabled={busy}
                        className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white transition-colors cursor-pointer"
                    >
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
