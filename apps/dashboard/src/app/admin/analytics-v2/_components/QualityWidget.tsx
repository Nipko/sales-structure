'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldCheck, Star, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/lib/api';
import KPICard from '@/components/analytics/KPICard';

interface QualitySummary {
    scored: number;
    avgOverall: number;
    avgResolution: number;
    avgTone: number;
    avgAccuracy: number;
    avgEmpathy: number;
    distribution: { excellent: number; ok: number; poor: number };
    flagged: number;
    verifiedResolutionRate: number | null;
    operationalKnown: number;
    operationalUnknown: number;
    partialTranscripts: number;
}

interface FlaggedRow {
    conversationId: string;
    overall: number;
    flags: string[];
    resolutionType: string | null;
    resolutionVerified: boolean | null;
    verificationReason: string | null;
}

const DIST_COLORS = { excellent: '#10b981', ok: '#f59e0b', poor: '#ef4444' };

export default function QualityWidget({
    tenantId,
    startDate,
    endDate,
}: {
    tenantId: string;
    startDate: string;
    endDate: string;
}) {
    const t = useTranslations('quality');
    const [summary, setSummary] = useState<QualitySummary | null>(null);
    const [flagged, setFlagged] = useState<FlaggedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const requestId = useRef(0);

    const fetchData = useCallback(async () => {
        if (!tenantId) return;
        const request = ++requestId.current;
        setLoading(true);
        setFailed(false);
        setSummary(null);
        setFlagged([]);
        try {
            const [sRes, fRes]: any[] = await Promise.all([
                api.getQualitySummary(tenantId, { start: startDate, end: endDate }),
                api.getQualityFlagged(tenantId, { start: startDate, end: endDate, limit: 50 }),
            ]);
            if (!sRes?.success || !sRes.data || !fRes?.success || !Array.isArray(fRes.data)) throw new Error('quality_unavailable');
            if (request !== requestId.current) return;
            setSummary(sRes.data as QualitySummary);
            setFlagged(fRes.data as FlaggedRow[]);
        } catch {
            if (request === requestId.current) setFailed(true);
        }
        if (request === requestId.current) setLoading(false);
    }, [tenantId, startDate, endDate]);

    useEffect(() => { fetchData(); return () => { requestId.current++; }; }, [fetchData]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (failed) return <p role="alert" className="text-sm text-muted-foreground">{t('loadError')} <button type="button" className="underline" onClick={fetchData}>{t('retry')}</button></p>;
    if (!summary || summary.scored === 0) {
        return <p className="text-muted-foreground py-10 text-center">{t('noData')}</p>;
    }

    return <QualityScoreDetails summary={summary} flagged={flagged}/>;
}

export function QualityScoreDetails({summary,flagged}: {summary:QualitySummary;flagged:FlaggedRow[]}) {
    const t=useTranslations('quality');

    const subScores = [
        { key: 'resolution', value: summary.avgResolution },
        { key: 'tone', value: summary.avgTone },
        { key: 'accuracy', value: summary.avgAccuracy },
        { key: 'empathy', value: summary.avgEmpathy },
    ];

    const pieData = [
        { name: t('excellent'), value: summary.distribution.excellent, color: DIST_COLORS.excellent },
        { name: t('ok'), value: summary.distribution.ok, color: DIST_COLORS.ok },
        { name: t('poor'), value: summary.distribution.poor, color: DIST_COLORS.poor },
    ].filter((d) => d.value > 0);

    return (
        <div className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KPICard label={t('avgOverall')} value={`${summary.avgOverall}/10`} icon={Star} iconColor="text-yellow-400" />
                <KPICard label={t('scored')} value={summary.scored} icon={CheckCircle} iconColor="text-blue-400" />
                <KPICard label={t('verifiedResolutionRate')} value={summary.verifiedResolutionRate == null ? t('unknownOutcome') : `${summary.verifiedResolutionRate}%`} icon={ShieldCheck} iconColor="text-emerald-400" />
                <KPICard label={t('flagged')} value={summary.flagged} icon={AlertTriangle} iconColor="text-amber-400" />
            </div>

            <p className="text-sm text-muted-foreground">{t('opinionNotice')} {t('coverageNotice', { known: summary.operationalKnown ?? 0, unknown: summary.operationalUnknown ?? summary.scored, partial: summary.partialTranscripts ?? 0 })}</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Sub-scores */}
                <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]">
                    <h3 className="text-sm font-semibold text-foreground mb-4">{t('subScores')}</h3>
                    <div className="space-y-4">
                        {subScores.map((s) => (
                            <div key={s.key}>
                                <div className="flex justify-between text-[13px] mb-1">
                                    <span className="text-text-secondary">{t(s.key)}</span>
                                    <span className="text-foreground font-medium">{s.value}/10</span>
                                </div>
                                <div className="h-2 rounded-full bg-neutral-100 dark:bg-white/[0.06] overflow-hidden">
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            width: `${(s.value / 10) * 100}%`,
                                            background: s.value >= 8 ? '#10b981' : s.value >= 5 ? '#f59e0b' : '#ef4444',
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Distribution */}
                {pieData.length > 0 && (
                    <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]">
                        <h3 className="text-sm font-semibold text-foreground mb-4">{t('distribution')}</h3>
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                                    label={({ name, percent }: any) => `${name || ''} ${((percent || 0) * 100).toFixed(0)}%`}>
                                    {pieData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}
                                </Pie>
                                <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            {/* Flagged conversations */}
            {flagged.length > 0 && (
                <div className="p-6 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]">
                    <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                        <AlertTriangle size={16} className="text-amber-400" />
                        {t('flaggedTitle')} ({flagged.length})
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-200 dark:border-white/10">
                                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t('score')}</th>
                                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t('issues')}</th>
                                    <th className="text-left py-2.5 px-3 text-muted-foreground font-medium">{t('resolutionType')}</th>
                                    <th className="text-center py-2.5 px-3 text-muted-foreground font-medium">{t('verified')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {flagged.map((r) => (
                                    <tr key={r.conversationId} className="border-b border-neutral-100 dark:border-white/5">
                                        <td className="py-2.5 px-3">
                                            <span className={`font-semibold ${r.overall >= 8 ? 'text-emerald-500' : r.overall >= 5 ? 'text-amber-500' : 'text-red-400'}`}>
                                                {r.overall}/10
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-3 text-text-secondary max-w-[360px]">
                                            {r.flags.length ? r.flags.join('; ') : '—'}
                                        </td>
                                        <td className="py-2.5 px-3 text-muted-foreground">{r.resolutionType || '—'}</td>
                                        <td className="py-2.5 px-3 text-center">
                                            {r.resolutionVerified === null ? (
                                                <span className="text-muted-foreground">{t('unknownOutcome')}</span>
                                            ) : r.resolutionVerified ? (
                                                <span className="text-emerald-500">{t('yes')}</span>
                                            ) : (
                                                <span className="text-red-400">{t('no')}</span>
                                            )}
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
