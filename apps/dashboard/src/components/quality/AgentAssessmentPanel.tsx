"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { AgentAssessment } from '@parallext/shared';
import { useTenant } from '@/contexts/TenantContext';
import { useRole } from '@/hooks/useRole';
import { api } from '@/lib/api';
import { QUALITY_HEALTH_REFRESH_EVENT } from '@/lib/quality-health-events';
import { AgentMissionEditor } from './AgentMissionEditor';

/** Every configuration surface uses this same server assessment and task order. */
export function AgentAssessmentPanel({ agentId, assessment: provided }: { agentId?: string; assessment?: AgentAssessment | null }) {
    const { activeTenantId } = useTenant();
    return <AgentAssessmentContent key={`${activeTenantId}:${agentId ?? provided?.agent?.id ?? 'default'}`} agentId={agentId} assessment={provided} />;
}

function AgentAssessmentContent({ agentId, assessment: provided }: { agentId?: string; assessment?: AgentAssessment | null }) {
    const t = useTranslations('agentAssessment');
    const tDraft = useTranslations('agentDraft');
    const tSetup = useTranslations('qualityHealth.setup');
    const tQuality = useTranslations('agentQuality');
    const { activeTenantId } = useTenant();
    const { role, canAccess } = useRole();
    const eligible = ['tenant_admin', 'tenant_supervisor', 'super_admin'].includes(role ?? '');
    const [assessment, setAssessment] = useState<AgentAssessment | null>(provided ?? null);
    const [loading, setLoading] = useState(provided === undefined);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        if (provided !== undefined) { setAssessment(provided); setLoading(false); return; }
        if (!activeTenantId || !eligible) return;
        let cancelled = false;
        setLoading(true);
        api.getAgentAssessment(activeTenantId, agentId).then(response => {
            if (!cancelled) setAssessment(response.success ? response.data ?? null : null);
        }).catch(() => { if (!cancelled) setAssessment(null); }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [activeTenantId, agentId, eligible, provided, revision]);
    useEffect(() => {
        const refresh = () => setRevision(value => value + 1);
        window.addEventListener(QUALITY_HEALTH_REFRESH_EVENT, refresh);
        return () => window.removeEventListener(QUALITY_HEALTH_REFRESH_EVENT, refresh);
    }, []);
    if (!eligible) return null;
    if (loading && !assessment) return <p role="status" className="my-3 text-sm text-neutral-500">{tSetup('loading')}</p>;
    if (!assessment) return <div role="status" className="my-3 rounded-xl border p-4 text-sm">{tSetup('unavailable')} <button type="button" onClick={() => setRevision(value => value + 1)} className="ml-2 underline">{tSetup('retry')}</button></div>;
    const next = assessment.tasks.find(task => !['pass', 'not_applicable'].includes(task.status) && canAccess(task.href));
    return <section className="my-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/5" aria-label={t('title')}>
        <h2 className="font-semibold">{t('title')}</h2>
        <p className="mt-1 text-xs text-neutral-500">{tDraft('assessmentOperational')}</p>
        {assessment.mission.definition && <p className="mt-2 text-sm">{assessment.mission.definition.objective}</p>}
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{t(`sources.${assessment.mission.source}`)}</p>
        <AgentMissionEditor key={assessment.agent?.id ?? 'no-agent'} assessment={assessment} />
        {next && <Link href={next.href} className="mt-3 inline-flex rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white">{t('next')}: {tSetup(`items.${next.key}`)}</Link>}
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">{t('details')}</summary>
            <ul className="mt-3 space-y-2">{assessment.tasks.filter(task => canAccess(task.href)).map(task => <li key={task.key}>
                <Link href={task.href} className="underline">{tSetup(`items.${task.key}`)}</Link> <span className="text-neutral-500">— {tQuality(`checkStatuses.${task.status}`)}</span>
            </li>)}</ul>
            <p className="mt-3 text-xs">{t('testEvidence', { count: assessment.requiredTests.length })}</p>
            <p className="mt-1 text-xs">{assessment.channels.some(channel => channel.status === 'unavailable' || channel.contract?.degraded)
                ? tSetup('verificationUnavailable')
                : t('capabilityEvidence', { count: assessment.channels.reduce((sum, channel) => sum + (channel.contract?.publishedTools.length ?? 0), 0) })}</p>
        </details>
    </section>;
}
