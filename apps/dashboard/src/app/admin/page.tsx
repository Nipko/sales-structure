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
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "@/hooks/useApiData";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    const { user } = useAuth();
    const t = useTranslations("dashboard");

    const statConfig = [
        { key: "leadsToday",        label: t("leadsToday"),        icon: Building2,     color: "text-indigo-500",  bgIcon: "bg-indigo-500/10", suffix: "" },
        { key: "leadsHot",          label: t("leadsHot"),          icon: TrendingUp,    color: "text-emerald-500", bgIcon: "bg-emerald-500/10", suffix: "" },
        { key: "messagesProcessed", label: t("messagesProcessed"), icon: Activity,      color: "text-sky-500",     bgIcon: "bg-sky-500/10", suffix: "" },
        { key: "llmCostToday",      label: t("llmCostToday"),      icon: Brain,         color: "text-amber-500",   bgIcon: "bg-amber-500/10", suffix: "$" },
    ];
    const [overview, setOverview] = useState<Record<string, number>>({
        leadsToday: 0, leadsHot: 0, messagesProcessed: 0, llmCostToday: 0,
    });
    const [activity, setActivity] = useState<any[]>([]);
    const [modelUsage, setModelUsage] = useState<any[]>([]);
    const [isLive, setIsLive] = useState(false);
    const [platformStats, setPlatformStats] = useState({ totalTenants: 0, totalUsers: 0 });

    // Check if setup wizard needs to be shown
    useEffect(() => {
        async function checkSetupWizard() {
            if (!user?.tenantId || user?.role === "super_admin") return;
            try {
                const res = await api.getSetupStatus(user.tenantId);
                if (res.success && !res.data?.setupWizardCompleted) {
                    window.location.href = "/admin/setup-wizard";
                }
            } catch { /* proceed to dashboard */ }
        }
        checkSetupWizard();
    }, [user?.tenantId, user?.role]);

    useEffect(() => {
        async function loadPlatformStats() {
            if (user?.role !== "super_admin") return;
            const result = await api.getTenants();
            if (result.success && Array.isArray(result.data)) {
                const totalUsers = result.data.reduce((s: number, t: any) => s + (t._count?.users || 0), 0);
                setPlatformStats({ totalTenants: result.data.length, totalUsers });
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
                    leadsToday:        result.data.leadsToday,
                    leadsHot:          result.data.leadsHot,
                    messagesProcessed: result.data.messagesProcessed,
                    llmCostToday:      result.data.llmCostToday,
                });
                setIsLive(true);
            }
            // Load dashboard details (activity + model usage)
            try {
                const dashResult = await api.getOverviewStats(user.tenantId);
                if (dashResult.success && dashResult.data) {
                    if (Array.isArray(dashResult.data.recentActivity)) {
                        setActivity(dashResult.data.recentActivity.map((a: any) => ({
                            tenant: a.tenant_name || a.tenant || 'Sistema',
                            event: a.event || a.description || a.event_type || '',
                            time: a.created_at ? new Date(a.created_at).toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit' }) : a.time || '',
                            type: a.type || a.event_type || 'conversation',
                        })));
                    }
                    if (Array.isArray(dashResult.data.modelUsage)) {
                        const total = dashResult.data.modelUsage.reduce((s: number, m: any) => s + (m.requests || m.count || 0), 0) || 1;
                        setModelUsage(dashResult.data.modelUsage.map((m: any, i: number) => ({
                            model: m.model || m.llm_model || 'Unknown',
                            tier: m.tier || `Tier ${i + 1}`,
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

    return (
        <div className="animate-in">
            {/* Header */}
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                        Dashboard
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        {t("welcome", { name: user?.firstName || "Admin" })}
                    </p>
                </div>
                <DataSourceBadge isLive={isLive} />
            </div>

            {/* Platform Section — super_admin only */}
            {user?.role === "super_admin" && (
                <div className="mb-8">
                    <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("platform")}</h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Link href="/admin/tenants">
                            <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors cursor-pointer">
                                <CardContent className="pt-0">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">Total Tenants</p>
                                            <p className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">{platformStats.totalTenants}</p>
                                        </div>
                                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/10">
                                            <Building2 size={22} className="text-indigo-500" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                        <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift">
                            <CardContent className="pt-0">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">Total Usuarios</p>
                                        <p className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">{platformStats.totalUsers}</p>
                                    </div>
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10">
                                        <Users size={22} className="text-sky-500" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift">
                            <CardContent className="pt-0">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">Estado del Sistema</p>
                                        <div className="mt-2 flex items-center gap-2">
                                            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                                            <span className="text-sm font-semibold text-emerald-500">Online</span>
                                        </div>
                                    </div>
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10">
                                        <CheckCircle2 size={22} className="text-emerald-500" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}

            {/* Stats Grid */}
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-stagger">
                {statConfig.map((stat) => {
                    const Icon = stat.icon;
                    const rawValue = overview[stat.key] ?? 0;
                    const displayValue = stat.suffix === "$"
                        ? `$${rawValue.toFixed(2)}`
                        : rawValue.toLocaleString("es-CO");
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

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Recent Activity */}
                <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover-lift">
                    <CardHeader>
                        <CardTitle className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                            Actividad Reciente
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
                                    Sin datos de uso de modelos disponibles
                                </div>
                            )}
                        </div>
                        <div className="mt-5 flex items-center justify-between rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800">
                            <span className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                                <TrendingUp size={14} />
                                El Router ahorra ~42% en costos usando Tier 3-4 para mensajes simples
                            </span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
