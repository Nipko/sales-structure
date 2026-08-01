"use client";

import { useEffect, useState } from "react";
import {
    Building2,
    MessageSquare,
    Brain,
    TrendingUp,
    ArrowUpRight,
    Activity,
    Users,
    CheckCircle2,
    Calendar,
    UserPlus,
    UserX,
    Flame,
    MapPin,
    Car,
    UtensilsCrossed,
    Plane,
    GraduationCap,
    DollarSign,
    Sparkles,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslations, useLocale } from "next-intl";
import { useVerticalTerms } from "@/hooks/useVerticalTerms";
import { DataSourceBadge } from "@/hooks/useApiData";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPanel } from "@/components/ui/help-panel";
import OnboardingMetricsCard from "./_components/OnboardingMetricsCard";

const ICON_MAP: Record<string, any> = {
    Calendar, UserPlus, UserX, MessageSquare, Flame, MapPin, Car,
    UtensilsCrossed, Plane, GraduationCap, DollarSign,
    Building2, Brain, TrendingUp, Activity,
};

const activityDotColors: Record<string, string> = {
    conversation: "bg-emerald-500",
    handoff: "bg-amber-500",
    order: "bg-indigo-500",
};

const modelBarColors = [
    "bg-emerald-500",
    "bg-sky-500",
    "bg-amber-500",
    "bg-indigo-500",
    "bg-red-500",
];

export default function AdminDashboard() {
    const { user, verticalConfig } = useAuth();
    const t = useTranslations("dashboard");
    const tSetup = useTranslations("setupWizard");
    const tVw = useTranslations("verticalWelcome");
    const tHelp = useTranslations("help");
    const vt = useVerticalTerms();
    const locale = useLocale() as "es" | "en" | "pt" | "fr";

    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    const defaultStatConfig = [
        { key: "leadsToday",        label: `${capitalize(vt.customerNounPlural)} Hoy`, icon: Building2,     color: "text-indigo-500",  bgIcon: "bg-indigo-500/10", suffix: "" },
        { key: "leadsHot",          label: t("leadsHot"),          icon: TrendingUp,    color: "text-emerald-500", bgIcon: "bg-emerald-500/10", suffix: "" },
        { key: "messagesProcessed", label: t("messagesProcessed"), icon: Activity,      color: "text-sky-500",     bgIcon: "bg-sky-500/10", suffix: "" },
        { key: "llmCostToday",      label: t("llmCostToday"),      icon: Brain,         color: "text-amber-500",   bgIcon: "bg-amber-500/10", suffix: "$" },
    ];

    const verticalKpis = verticalConfig?.dashboard?.kpis;
    const statConfig = verticalKpis?.length
        ? verticalKpis.map((kpi: { key: string; label: Record<string, string>; icon: string; color: string }) => ({
            key: kpi.key,
            label: kpi.label[locale] || kpi.label.en || kpi.key,
            icon: ICON_MAP[kpi.icon] || Activity,
            color: `text-[${kpi.color}]`,
            bgIcon: `bg-[${kpi.color}]/10`,
            // Una tasa sin el % se lee como un conteo: "23 casos ganados" en vez
            // de "23% de cierre". Es el mismo número diciendo otra cosa.
            suffix: kpi.key.toLowerCase().includes("cost") || kpi.key.toLowerCase().includes("revenue")
                ? "$"
                : kpi.key.toLowerCase().includes("rate") ? "%" : "",
        }))
        : defaultStatConfig;
    const APPOINTMENT_INDUSTRIES = ['salud', 'moda_belleza', 'restaurantes'];
    const PIPELINE_INDUSTRIES = ['inmobiliaria', 'automotriz', 'technology', 'finanzas', 'servicios_profesionales'];

    const [overview, setOverview] = useState<Record<string, number>>({
        leadsToday: 0, leadsHot: 0, messagesProcessed: 0, llmCostToday: 0,
    });
    const [activity, setActivity] = useState<any[]>([]);
    const [modelUsage, setModelUsage] = useState<any[]>([]);
    const [verticalAppointments, setVerticalAppointments] = useState<any[]>([]);
    const [verticalLeads, setVerticalLeads] = useState<any[]>([]);
    const [verticalLoading, setVerticalLoading] = useState(false);
    const [isLive, setIsLive] = useState(false);
    const [needsChannel, setNeedsChannel] = useState(false);
    const [wizardSkipped, setWizardSkipped] = useState(false);
    const [platformStats, setPlatformStats] = useState({
        totalTenants: 0,
        totalUsers: 0,
        activeTenants: 0,
        trialingTenants: 0,
        messagesToday: 0,
        pendingHandoffs: 0,
        verticalDistribution: [] as { industry: string; count: number }[],
    });

    // Check if setup wizard needs to be shown
    useEffect(() => {
        async function checkSetupWizard() {
            if (!user?.tenantId || user?.role === "super_admin") return;
            // El agente es la configuración del negocio entero: empujar a un
            // tenant_agent al asistente le daba control sobre la persona que atiende a
            // todos los clientes. Los avisos los ve también el supervisor, que sí puede
            // conectar canales; el asistente guiado queda para el admin.
            const canConfigureAgent = user?.role === "tenant_admin";
            const canConnectChannels = canConfigureAgent || user?.role === "tenant_supervisor";
            if (!canConnectChannels) return;
            // Loop kill switch — if we just came back from /admin/setup-wizard
            // and the flag is still unset (backend write failed for some
            // reason), do NOT redirect again. Stay on /admin so the user is
            // not trapped. They can re-run the wizard manually from settings.
            const justBouncedKey = `setupWizard_lastBounce_${user.tenantId}`;
            const lastBounce = parseInt(sessionStorage.getItem(justBouncedKey) || "0", 10);
            if (Date.now() - lastBounce < 30_000) return;

            try {
                const res = await api.getSetupStatus(user.tenantId);
                if (!res.success) return;

                if (!res.data?.setupWizardCompleted) {
                    if (!canConfigureAgent) return;
                    sessionStorage.setItem(justBouncedKey, String(Date.now()));
                    window.location.href = "/admin/setup-wizard";
                    return;
                }

                // Apretó "Saltar": el asistente quedó marcado como completo para no
                // reabrir el bucle de redirect, y hasta ahora eso lo borraba del sistema
                // de guía — no existe ningún enlace al wizard en toda la app. Ofrecerle
                // retomarlo en vez de dejarlo con un agente sin personalizar.
                if (canConfigureAgent && res.data?.setupWizardSkipped) setWizardSkipped(true);
                if (!res.data?.hasAnyChannel) setNeedsChannel(true);
            } catch { /* proceed to dashboard */ }
        }
        checkSetupWizard();
    }, [user?.tenantId, user?.role]);

    useEffect(() => {
        async function loadPlatformStats() {
            if (user?.role !== "super_admin") return;

            // Load tenant list for vertical distribution
            const tenantsResult = await api.getTenants();
            let verticalDistribution: { industry: string; count: number }[] = [];
            if (tenantsResult.success && Array.isArray(tenantsResult.data)) {
                const industryMap: Record<string, number> = {};
                tenantsResult.data.forEach((t: any) => {
                    const ind = t.industry || 'other';
                    industryMap[ind] = (industryMap[ind] || 0) + 1;
                });
                verticalDistribution = Object.entries(industryMap)
                    .map(([industry, count]) => ({ industry, count }))
                    .sort((a, b) => b.count - a.count);
            }

            // Load platform stats (includes messagesToday, pendingHandoffs)
            try {
                const statsResult = await api.fetch("/tenants/stats");
                if (statsResult.success && statsResult.data) {
                    const d = statsResult.data;
                    setPlatformStats({
                        totalTenants: d.totalTenants || 0,
                        totalUsers: d.totalUsers || 0,
                        activeTenants: d.activeTenants || 0,
                        trialingTenants: d.trialingTenants || 0,
                        messagesToday: d.messagesToday || 0,
                        pendingHandoffs: d.pendingHandoffs || 0,
                        verticalDistribution,
                    });
                    return;
                }
            } catch { /* fallback to tenant list data */ }

            // Fallback if stats endpoint fails
            if (tenantsResult.success && Array.isArray(tenantsResult.data)) {
                const tenants = tenantsResult.data;
                setPlatformStats({
                    totalTenants: tenants.length,
                    totalUsers: tenants.reduce((s: number, t: any) => s + (t._count?.users || 0), 0),
                    activeTenants: tenants.filter((t: any) => t.isActive).length,
                    trialingTenants: tenants.filter((t: any) => t.subscriptionStatus === 'trialing').length,
                    messagesToday: 0,
                    pendingHandoffs: 0,
                    verticalDistribution,
                });
            }
        }
        loadPlatformStats();
    }, [user?.role]);

    useEffect(() => {
        async function loadOverview() {
            if (!user?.tenantId) return;

            const result = await api.getCommercialOverview(user.tenantId);
            if (result.success && result.data) {
                setOverview({
                    ...result.data,
                    leadsToday:        result.data.leadsToday ?? 0,
                    leadsHot:          result.data.leadsHot ?? 0,
                    messagesProcessed: result.data.messagesProcessed ?? 0,
                    llmCostToday:      result.data.llmCostToday ?? 0,
                });
                setIsLive(true);
            }
            // Load dashboard details (activity + model usage)
            try {
                const dashResult = await api.getOverviewStats(user.tenantId);
                if (dashResult.success && dashResult.data) {
                    if (Array.isArray(dashResult.data.recentActivity)) {
                        setActivity(dashResult.data.recentActivity.map((a: any) => ({
                            tenant: a.tenant_name || a.tenant || t('system'),
                            event: a.event || a.description || a.event_type || '',
                            time: a.created_at ? formatTimeAgo(a.created_at) : a.time || '',
                            type: a.type || a.event_type || 'conversation',
                        })));
                    }
                    if (Array.isArray(dashResult.data.modelUsage)) {
                        const total = dashResult.data.modelUsage.reduce((s: number, m: any) => s + (m.requests || m.count || 0), 0) || 1;
                        setModelUsage(dashResult.data.modelUsage.map((m: any, i: number) => ({
                            model: m.model || m.llm_model || t('unknown'),
                            tier: m.tier || t('tierN', { n: i + 1 }),
                            requests: m.requests || m.count || 0,
                            pct: Math.round(((m.requests || m.count || 0) / total) * 100),
                            colorClass: modelBarColors[i % modelBarColors.length],
                        })));
                    }
                }
            } catch (err) {
                console.error('Failed to load dashboard details:', err);
            }
        }
        loadOverview();
    }, []);

    // Load vertical-specific data
    useEffect(() => {
        async function loadVerticalData() {
            if (!user?.tenantId || user?.role === 'super_admin') return;
            const industry = vt.industry;

            if (APPOINTMENT_INDUSTRIES.includes(industry)) {
                setVerticalLoading(true);
                try {
                    const today = new Date().toISOString().split('T')[0];
                    const res = await api.fetch(`/appointments/${user.tenantId}?date=${today}&status=pending,confirmed`);
                    if (res.success && Array.isArray(res.data)) {
                        setVerticalAppointments(res.data);
                    }
                } catch { /* ignore */ }
                setVerticalLoading(false);
            } else if (PIPELINE_INDUSTRIES.includes(industry)) {
                setVerticalLoading(true);
                try {
                    const res = await api.fetch(`/crm/leads/${user.tenantId}?limit=5&sort=created_at:desc`);
                    if (res.success && Array.isArray(res.data)) {
                        setVerticalLeads(res.data);
                    }
                } catch { /* ignore */ }
                setVerticalLoading(false);
            }
        }
        loadVerticalData();
    }, [user?.tenantId, user?.role, vt.industry]);

    const formatTime = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        } catch { return ''; }
    };

    const formatTimeAgo = (dateStr: string) => {
        try {
            const diff = Date.now() - new Date(dateStr).getTime();
            const mins = Math.floor(diff / 60000);
            if (mins < 60) return `${mins}m`;
            const hours = Math.floor(mins / 60);
            if (hours < 24) return `${hours}h`;
            return `${Math.floor(hours / 24)}d`;
        } catch { return ''; }
    };

    const appointmentStatusColors: Record<string, string> = {
        pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
        confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
        completed: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
        cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
        no_show: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400',
    };

    const stageColors: Record<string, string> = {
        new: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
        contacted: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
        qualified: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
        proposal: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
        negotiation: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
        won: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
        lost: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    };

    // Empty-state: tenant sin actividad real todavía (ya cargó datos pero todo en cero).
    // Muestra un hero guiado en vez de un panel de puros ceros.
    const isEmptyTenant = user?.role !== "super_admin" && isLive && activity.length === 0
        && (overview.messagesProcessed ?? 0) === 0 && (overview.leadsToday ?? 0) === 0;
    const emptyActions = [
        { href: "/admin/channels/whatsapp", icon: MessageSquare, tk: "test", iconBg: "bg-emerald-500/10", iconText: "text-emerald-500" },
        { href: "/admin/knowledge", icon: Brain, tk: "knowledge", iconBg: "bg-violet-500/10", iconText: "text-violet-500" },
        { href: "/admin/users", icon: Users, tk: "team", iconBg: "bg-sky-500/10", iconText: "text-sky-500" },
    ];

    return (
        <div className="animate-in">
            {needsChannel && user?.role !== "super_admin" && (
                <div className="mb-6 rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center shrink-0">
                        <MessageSquare size={18} className="text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{tSetup("connectBannerTitle")}</p>
                        <p className="text-xs text-amber-700 dark:text-amber-400/80 mt-0.5">{tSetup("connectBannerDesc")}</p>
                    </div>
                    <Link href="/admin/channels/whatsapp" className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600 dark:text-neutral-900 transition-colors">
                        {tSetup("connectBannerCta")} <ArrowUpRight size={14} />
                    </Link>
                </div>
            )}
            {/* Retomar el asistente guiado. Sin esto, "Saltar" era irreversible: no
                existe ningún otro enlace al wizard en toda la aplicación. */}
            {wizardSkipped && !needsChannel && (
                <div className="mb-6 rounded-xl border border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center shrink-0">
                        <Sparkles size={18} className="text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">{tSetup("resumeBannerTitle")}</p>
                        <p className="text-xs text-indigo-700 dark:text-indigo-400/80 mt-0.5">{tSetup("resumeBannerDesc")}</p>
                    </div>
                    <Link href="/admin/setup-wizard" className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors">
                        {tSetup("resumeBannerCta")} <ArrowUpRight size={14} />
                    </Link>
                </div>
            )}
            {/* Header */}
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                        {t('title')}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        {/* .has(): sin el guard, las industrias sin clave propia mostraban
                            la clave i18n cruda ("verticalWelcome.gimnasios") en el saludo. */}
                        {tVw(vt.industry !== 'otro' && tVw.has(vt.industry) ? vt.industry : 'default', { name: user?.firstName || "Admin" })}
                    </p>
                </div>
                <DataSourceBadge isLive={isLive} />
            </div>

            <HelpPanel
                title={tHelp("dashboard.title")}
                description={tHelp("dashboard.description")}
                tips={tHelp.raw("dashboard.tips") as string[]}
                mediaKey="dashboard"
            />

            {/* Empty-state guiado (Fase 4) — tenant nuevo sin actividad todavía */}
            {isEmptyTenant && (
                <div className="mb-8 rounded-xl border border-indigo-200 dark:border-indigo-500/20 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-500/10 dark:to-neutral-900 p-6">
                    <div className="flex items-start gap-3 mb-5">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center shrink-0">
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t("emptyState.title")}</h3>
                            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">{t("emptyState.subtitle")}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {emptyActions.map((a) => {
                            const Icon = a.icon;
                            return (
                                <Link
                                    key={a.tk}
                                    href={a.href}
                                    className="group rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors"
                                >
                                    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center mb-2.5", a.iconBg)}>
                                        <Icon size={18} className={a.iconText} />
                                    </div>
                                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1">
                                        {t(`emptyState.actions.${a.tk}Title`)}
                                        <ArrowUpRight size={13} className="text-neutral-400 group-hover:text-indigo-500 transition-colors" />
                                    </p>
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t(`emptyState.actions.${a.tk}Desc`)}</p>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            )}

            {user?.role === "super_admin" && <OnboardingMetricsCard />}

            {/* Platform Section — super_admin only */}
            {user?.role === "super_admin" && (
                <div className="mb-8">
                    <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("platform")}</h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {/* Total Tenants */}
                        <Link href="/admin/tenants">
                            <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors cursor-pointer">
                                <CardContent className="pt-0">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">{t('totalTenants')}</p>
                                            <p className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">{platformStats.totalTenants}</p>
                                        </div>
                                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/10">
                                            <Building2 size={22} className="text-indigo-500" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>

                        {/* Total Users */}
                        <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift">
                            <CardContent className="pt-0">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">{t('totalUsers')}</p>
                                        <p className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">{platformStats.totalUsers}</p>
                                    </div>
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10">
                                        <Users size={22} className="text-sky-500" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Active Tenants */}
                        <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift">
                            <CardContent className="pt-0">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">{t('activeTenants')}</p>
                                        <p className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">{platformStats.activeTenants}</p>
                                        {platformStats.trialingTenants > 0 && (
                                            <p className="mt-1 text-xs text-amber-500">
                                                {platformStats.trialingTenants} {t('trialing')}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10">
                                        <CheckCircle2 size={22} className="text-emerald-500" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Messages Today */}
                        <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift">
                            <CardContent className="pt-0">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">{t('messagesToday')}</p>
                                        <p className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">{platformStats.messagesToday.toLocaleString()}</p>
                                    </div>
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/10">
                                        <MessageSquare size={22} className="text-violet-500" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Pending Handoffs */}
                        <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift">
                            <CardContent className="pt-0">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">{t('pendingHandoffs')}</p>
                                        <p className={cn("text-3xl font-semibold", platformStats.pendingHandoffs > 0 ? "text-amber-500" : "text-neutral-900 dark:text-neutral-100")}>{platformStats.pendingHandoffs}</p>
                                    </div>
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10">
                                        <Activity size={22} className="text-amber-500" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Vertical Distribution */}
                        <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift">
                            <CardContent className="pt-0">
                                <div className="flex items-start justify-between mb-3">
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('verticalDistribution')}</p>
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/10">
                                        <TrendingUp size={22} className="text-rose-500" />
                                    </div>
                                </div>
                                {platformStats.verticalDistribution.length > 0 ? (
                                    <div className="space-y-1.5">
                                        {platformStats.verticalDistribution.map((v) => (
                                            <div key={v.industry} className="flex items-center justify-between text-xs">
                                                <span className="capitalize text-neutral-700 dark:text-neutral-300">
                                                    {v.industry.replace(/_/g, ' ')}
                                                </span>
                                                <span className="font-semibold text-neutral-900 dark:text-neutral-100">{v.count}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-neutral-400 dark:text-neutral-500">{t('noData')}</p>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}

            {/* Stats Grid */}
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-stagger">
                {statConfig.map((stat: any) => {
                    const Icon = stat.icon;
                    const rawValue = overview[stat.key];
                    const displayValue = rawValue == null
                        ? "—"
                        : stat.suffix === "$"
                            ? `$${Number(rawValue).toFixed(2)}`
                            : stat.suffix === "%"
                                ? `${Math.round(Number(rawValue))}%`
                                : Number(rawValue).toLocaleString();
                    return (
                        <Card key={stat.key} className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift">
                            <CardContent className="pt-0">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
                                            {stat.label}
                                        </p>
                                        <p className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">
                                            {displayValue}
                                        </p>
                                        <p className={cn("mt-2 flex items-center gap-1 text-xs", stat.color)}>
                                            <ArrowUpRight size={14} />
                                            {isLive ? t("live") : t("loading")}
                                        </p>
                                    </div>
                                    <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", stat.bgIcon)}>
                                        <Icon size={22} className={stat.color} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Vertical Home View */}
            {user?.role !== 'super_admin' && APPOINTMENT_INDUSTRIES.includes(vt.industry) && (
                <div className="mb-8 rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 overflow-hidden">
                    <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Calendar size={18} className="text-indigo-500" />
                            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t('verticalHome.todayAgenda')}</h3>
                        </div>
                        <Link href="/admin/appointments" className="text-xs text-indigo-500 hover:underline">
                            {t('verticalHome.viewAll')} →
                        </Link>
                    </div>
                    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                        {verticalLoading ? (
                            <div className="px-6 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                                {t('loading')}
                            </div>
                        ) : verticalAppointments.length > 0 ? verticalAppointments.map((apt: any) => (
                            <div key={apt.id} className="px-6 py-3 flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                        {apt.customer_name || apt.contact_name || apt.service_name}
                                    </p>
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                        {apt.service_name} · {formatTime(apt.start_at || apt.start_time)}
                                    </p>
                                </div>
                                <span className={cn("text-xs px-2 py-0.5 rounded-full", appointmentStatusColors[apt.status] || 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400')}>
                                    {apt.status}
                                </span>
                            </div>
                        )) : (
                            <div className="px-6 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                                {t('verticalHome.noAppointmentsToday')}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {user?.role !== 'super_admin' && PIPELINE_INDUSTRIES.includes(vt.industry) && (
                <div className="mb-8 rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 overflow-hidden">
                    <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <TrendingUp size={18} className="text-emerald-500" />
                            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t('verticalHome.recentLeads', { noun: vt.customerNounPlural })}</h3>
                        </div>
                        <Link href="/admin/contacts" className="text-xs text-indigo-500 hover:underline">
                            {t('verticalHome.viewAll')} →
                        </Link>
                    </div>
                    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                        {verticalLoading ? (
                            <div className="px-6 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                                {t('loading')}
                            </div>
                        ) : verticalLeads.length > 0 ? verticalLeads.map((lead: any) => (
                            <div key={lead.id} className="px-6 py-3 flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                        {lead.name || lead.phone || t('verticalHome.unnamed')}
                                    </p>
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                        {lead.phone}{lead.email ? ` · ${lead.email}` : ''}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {lead.stage && (
                                        <span className={cn("text-xs px-2 py-0.5 rounded-full", stageColors[lead.stage] || 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400')}>
                                            {lead.stage}
                                        </span>
                                    )}
                                    {lead.created_at && (
                                        <span className="text-xs text-neutral-400 dark:text-neutral-500">
                                            {formatTimeAgo(lead.created_at)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )) : (
                            <div className="px-6 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                                {t('verticalHome.noLeadsYet')}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Recent Activity */}
                <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift">
                    <CardHeader>
                        <CardTitle className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                            {t('recentActivity')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-col gap-3.5">
                            {activity.length > 0 ? activity.map((item, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        "flex items-center gap-3.5 py-2.5",
                                        i < activity.length - 1 && "border-b border-neutral-100 dark:border-neutral-800"
                                    )}
                                >
                                    <div
                                        className={cn(
                                            "h-2 w-2 shrink-0 rounded-full",
                                            activityDotColors[item.type] || "bg-sky-500"
                                        )}
                                    />
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                            {item.event}
                                        </p>
                                        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                                            {item.tenant}
                                        </p>
                                    </div>
                                    <span className="whitespace-nowrap text-xs text-neutral-500 dark:text-neutral-400">
                                        {item.time}
                                    </span>
                                </div>
                            )) : (
                                <div className="py-5 text-center text-xs text-neutral-500 dark:text-neutral-400">
                                    {t("noActivity")}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* LLM Model Usage */}
                <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift">
                    <CardHeader>
                        <CardTitle className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                            {t("modelUsage")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-col gap-4">
                            {modelUsage.length > 0 ? modelUsage.map((model) => (
                                <div key={model.model}>
                                    <div className="mb-1.5 flex items-center justify-between">
                                        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                            {model.model}{" "}
                                            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                                                ({model.tier})
                                            </span>
                                        </span>
                                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                            {model.requests} req · {model.pct}%
                                        </span>
                                    </div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                                        <div
                                            className={cn("h-full rounded-full transition-all duration-1000 ease-out", model.colorClass)}
                                            style={{ width: `${model.pct}%` }}
                                        />
                                    </div>
                                </div>
                            )) : (
                                <div className="py-5 text-center text-xs text-neutral-500 dark:text-neutral-400">
                                    {t('noModelUsage')}
                                </div>
                            )}
                        </div>
                        <div className="mt-5 flex items-center justify-between rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800">
                            <span className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                                <TrendingUp size={14} />
                                {t('routerSavings')}
                            </span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
