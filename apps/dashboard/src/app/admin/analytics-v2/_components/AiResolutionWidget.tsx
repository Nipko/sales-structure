'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Bot, Users, CheckCircle, Headphones, Loader2 } from 'lucide-react';
import {
    AreaChart, Area, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '@/lib/api';
import KPICard from '@/components/analytics/KPICard';

// ── Types ──

interface AiResolutionData {
    summary: {
        totalConversations: number;
        aiResolved: number;
        agentResolved: number;
        autoResolved: number;
        unresolved: number;
        aiResolutionRate: number;
        avgMessages: number;
        avgMessagesBeforeHandoff: number;
    };
    trend: Array<{
        date: string;
        aiResolutionRate: number;
        aiResolved: number;
        agentResolved: number;
        autoResolved: number;
    }>;
    byChannel: Array<{
        channel: string;
        total: number;
        aiResolved: number;
        rate: number;
    }>;
}

// ── Constants ──

const PIE_COLORS = {
    ai: '#10b981',       // emerald
    agent: '#3b82f6',    // blue
    auto: '#8b5cf6',     // purple
    unresolved: '#6b7280', // gray
};

const CHANNEL_LABELS: Record<string, string> = {
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    messenger: 'Messenger',
    telegram: 'Telegram',
};

// ── Component ──

export default function AiResolutionWidget({
    tenantId,
    startDate,
    endDate,
}: {
    tenantId: string;
    startDate: string;
    endDate: string;
}) {
    const t = useTranslations('aiResolution');
    const [data, setData] = useState<AiResolutionData | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const res = await api.getAiResolutionStats(tenantId, { start: startDate, end: endDate });
            if (res.success && res.data) {
                setData(res.data as AiResolutionData);
            }
        } catch (err) {
            console.error('Failed to fetch AI resolution stats:', err);
        }
        setLoading(false);
    }, [tenantId, startDate, endDate]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!data) {
        return (
            <p className="text-muted-foreground py-10 text-center">{t('noData')}</p>
        );
    }

    const { summary, trend, byChannel } = data;
    const totalResolved = summary.aiResolved + summary.agentResolved + summary.autoResolved;

    // Pie chart data
    const pieData = [
        { name: t('aiResolved'), value: summary.aiResolved, color: PIE_COLORS.ai },
        { name: t('agentResolved'), value: summary.agentResolved, color: PIE_COLORS.agent },
        { name: t('autoResolved'), value: summary.autoResolved, color: PIE_COLORS.auto },
        { name: t('unresolved'), value: summary.unresolved, color: PIE_COLORS.unresolved },
    ].filter(d => d.value > 0);

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KPICard
                    label={t('aiResolutionRate')}
                    value={`${summary.aiResolutionRate}%`}
                    changePercent={0}
                    icon={Bot}
                    iconColor="text-emerald-400"
                />
                <KPICard
                    label={t('totalResolved')}
                    value={totalResolved}
                    changePercent={0}
                    icon={CheckCircle}
                    iconColor="text-blue-400"
                />
                <KPICard
                    label={t('aiResolved')}
                    value={summary.aiResolved}
                    changePercent={0}
                    icon={Bot}
                    iconColor="text-emerald-400"
                />
                <KPICard
                    label={t('agentResolved')}
                    value={summary.agentResolved}
                    changePercent={0}
                    icon={Headphones}
                    iconColor="text-indigo-400"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Trend Chart */}
                {trend && trend.length > 0 && (
                    <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]">
                        <h3 className="text-sm font-semibold text-foreground mb-4">{t('trendTitle')}</h3>
                        <ResponsiveContainer width="100%" height={280}>
                            <AreaChart data={trend}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 11, fill: '#9898b0' }}
                                    tickFormatter={(d: string) => d.slice(5)}
                                />
                                <YAxis
                                    tick={{ fontSize: 11, fill: '#9898b0' }}
                                    domain={[0, 100]}
                                    tickFormatter={(v: number) => `${v}%`}
                                />
                                <Tooltip
                                    contentStyle={{
                                        background: '#1a1a2e',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: 8,
                                        fontSize: 12,
                                    }}
                                    formatter={(value: any) => [`${value}%`, t('aiResolutionRate')]}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="aiResolutionRate"
                                    stroke="#10b981"
                                    fill="#10b981"
                                    fillOpacity={0.15}
                                    strokeWidth={2}
                                    name={t('aiResolutionRate')}
                                    dot={false}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Pie Chart: Breakdown by type */}
                {pieData.length > 0 && (
                    <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]">
                        <h3 className="text-sm font-semibold text-foreground mb-4">{t('typeBreakdown')}</h3>
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={80}
                                    label={({ name, percent }: any) =>
                                        `${name || ''} ${((percent || 0) * 100).toFixed(0)}%`
                                    }
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={index} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        background: '#1a1a2e',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: 8,
                                        fontSize: 12,
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                        {/* Legend */}
                        <div className="mt-3 space-y-2">
                            {pieData.map((d) => (
                                <div key={d.name} className="flex items-center justify-between text-[13px]">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full" style={{ background: d.color }} />
                                        <span className="text-foreground">{d.name}</span>
                                    </div>
                                    <span className="text-muted-foreground">{d.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Channel Breakdown Table */}
            {byChannel && byChannel.length > 0 && (
                <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]">
                    <h3 className="text-sm font-semibold text-foreground mb-4">{t('channelBreakdown')}</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-200 dark:border-white/10">
                                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t('channel')}</th>
                                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t('total')}</th>
                                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t('aiResolved')}</th>
                                    <th className="text-right py-2.5 px-3 text-muted-foreground font-medium">{t('rate')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {byChannel.map((ch) => (
                                    <tr key={ch.channel} className="border-b border-neutral-100 dark:border-white/5">
                                        <td className="py-2.5 px-3 text-foreground font-medium">
                                            {CHANNEL_LABELS[ch.channel] || ch.channel}
                                        </td>
                                        <td className="py-2.5 px-3 text-right text-foreground">{ch.total}</td>
                                        <td className="py-2.5 px-3 text-right text-emerald-500">{ch.aiResolved}</td>
                                        <td className="py-2.5 px-3 text-right">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                                ch.rate >= 70
                                                    ? 'bg-emerald-500/10 text-emerald-500'
                                                    : ch.rate >= 40
                                                        ? 'bg-amber-500/10 text-amber-500'
                                                        : 'bg-red-500/10 text-red-400'
                                            }`}>
                                                {ch.rate}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
