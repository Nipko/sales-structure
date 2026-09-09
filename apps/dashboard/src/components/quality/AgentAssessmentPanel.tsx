"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { rollUpOperationalState, type AgentAssessment } from '@parallext/shared';
import { useTenant } from '@/contexts/TenantContext';
import { useRole } from '@/hooks/useRole';
import { api } from '@/lib/api';
import { QUALITY_HEALTH_REFRESH_EVENT } from '@/lib/quality-health-events';
import { AgentMissionEditor } from './AgentMissionEditor';
import { AgentOperationalStateSummary, OperationalStateBadge, OperationalStateLegend, operationalStatesPresent } from './OperationalState';

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
    const tConfig = useTranslations('agentConfiguration');
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
    const visibleTasks = assessment.tasks.filter(task => canAccess(task.href));
    const toolStates = assessment.tools.map(tool => tool.state);
    /**
     * One word for several connections is a roll-up, and the platform has exactly
     * one of those. The `some(unavailable || degraded)` this replaces said
     * "pendiente de verificar" for a broken contract as well as for an unreadable
     * one — the two cases the six-word vocabulary exists to keep apart.
     */
    const channelsState = rollUpOperationalState(assessment.channels.map(channel => channel.state));
    const channelName = (channelType: string | null) => channelType
        ? (t.has(`channelTypes.${channelType}`) ? t(`channelTypes.${channelType}`) : channelType)
        : t('channelUnspecified');
    return <section className="my-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/5" aria-label={t('title')}>
        <h2 className="font-semibold">{t('title')}</h2>
        {/* The server already rolled this up over the quality status, every task
            and every connection. Rendering it is the whole point: a count of
            pending steps cannot say whether the agent is untested or broken. */}
        <AgentOperationalStateSummary state={assessment.state} className="mt-2" />
        <p className="mt-2 text-xs text-neutral-500">{tDraft('assessmentOperational')}</p>
        {assessment.mission.definition && <p className="mt-2 text-sm">{assessment.mission.definition.objective}</p>}
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{t(`sources.${assessment.mission.source}`)}</p>
        <AgentMissionEditor key={assessment.agent?.id ?? 'no-agent'} assessment={assessment} />
        {next && <Link href={next.href} className="mt-3 inline-flex rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white">{t('next')}: {tSetup(`items.${next.key}`)}</Link>}
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">{t('details')}</summary>
            <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('tasksTitle')}</h3>
            <ul className="mt-2 space-y-2">{visibleTasks.map(task => <li key={task.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link href={task.href} className="underline">{tSetup(`items.${task.key}`)}</Link>
                <OperationalStateBadge state={task.state} />
                {/* Salud's own word stays next to the shared one: it is what the
                    check tables say, and it still carries "no aplica", which has
                    no rung on the ladder. Where the two differ the server meant
                    it — a mission running on its template's default is `pending`
                    ("falta acordarla"), never `degraded`. */}
                <span className="text-xs text-neutral-500">{tQuality(`checkStatuses.${task.status}`)}</span>
            </li>)}</ul>
            {assessment.channels.length > 0 && <>
                <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('channelsTitle')}</h3>
                <ul className="mt-2 space-y-2">{assessment.channels.map((channel, index) => <li key={`${channel.channelType ?? 'unspecified'}:${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{channelName(channel.channelType)}</span>
                    {channel.scope === 'preview' && <span className="text-xs text-neutral-500">{t('channelPreview')}</span>}
                    <OperationalStateBadge state={channel.state} />
                </li>)}</ul>
            </>}
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('testsTitle')}</h3>
            <p className="mt-2 text-xs">{t('testEvidence', { count: assessment.requiredTests.length })}</p>
            {assessment.requiredTests.length > 0 && <ul className="mt-2 space-y-2">{assessment.requiredTests.map(test => <li key={test.intentKey} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{tConfig.has(`intentLabels.${test.intentKey}`) ? tConfig(`intentLabels.${test.intentKey}`) : test.intentKey}</span>
                <OperationalStateBadge state={test.state} />
                {/* `failed` and `stale` both roll up to `degraded`; the evidence
                    word is what tells "it broke" from "it passed on a version
                    that is no longer the one on screen". */}
                <span className="text-xs text-neutral-500">{t(`evidence.${test.evidence}`)}</span>
            </li>)}</ul>}
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('toolsTitle')}</h3>
            <p className="mt-2 text-xs">{!assessment.channels.length ? t('capabilityNoChannels')
                : channelsState === 'degraded' ? t('capabilityDegraded')
                    : channelsState === 'unknown' ? tSetup('verificationUnavailable')
                        : t('capabilityEvidence', { count: assessment.channels.reduce((sum, channel) => sum + (channel.contract?.publishedTools.length ?? 0), 0) })}</p>
            {/* Counted per state rather than summed: a switched-off tool, one the
                plan excludes and one nobody could read are three answers, and a
                single total is how they became one. */}
            {toolStates.length > 0 && <ul className="mt-2 space-y-2">{operationalStatesPresent(toolStates).map(state => <li key={state} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <OperationalStateBadge state={state} />
                <span className="text-xs text-neutral-500">{t('toolsInState', { count: toolStates.filter(toolState => toolState === state).length })}</span>
            </li>)}</ul>}
            <OperationalStateLegend className="mt-4" states={[assessment.state, ...visibleTasks.map(task => task.state),
                ...assessment.channels.map(channel => channel.state), ...assessment.requiredTests.map(test => test.state), ...toolStates]} />
        </details>
    </section>;
}
