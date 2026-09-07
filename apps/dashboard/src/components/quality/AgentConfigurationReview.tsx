"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AGENT_ACCOUNT_DAYS, isAgentAccountBusinessHours, type AgentConfigurationProposal, type AgentMissionV1, type AppliedAgentConfiguration } from '@parallext/shared';
import { useTenant } from '@/contexts/TenantContext';
import { useRole } from '@/hooks/useRole';
import { api } from '@/lib/api';
import { notifyAgentConfigurationApplied, requestQualityHealthRefresh } from '@/lib/quality-health-events';

/** The displayed values and digest are immutable; changing a value requires a new proposal. */
export function AgentConfigurationReview({ proposal, onApplied }: {
    proposal: AgentConfigurationProposal; onApplied?: (result: AppliedAgentConfiguration) => void;
}) {
    const t = useTranslations('agentConfiguration');
    const { activeTenantId } = useTenant();
    const { role } = useRole();
    const [result, setResult] = useState<AppliedAgentConfiguration | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const current = result?.proposal ?? proposal;
    const applied = current.status === 'applied';
    const expired = current.status === 'expired' || (!applied && Date.parse(current.expiresAt) <= Date.now());
    const canApply = ['tenant_admin', 'super_admin'].includes(role ?? '');
    const renderValue = (value: unknown) => {
        if (value === null || value === undefined || value === '') return <span className="italic text-neutral-500">{t('empty')}</span>;
        if (typeof value === 'string') return <p className="whitespace-pre-wrap break-words">{value}</p>;
        if (typeof value === 'boolean') return <p>{t(value ? 'enabled' : 'disabled')}</p>;
        if (Array.isArray(value)) return <ul className="list-disc space-y-1 pl-4">{value.map((item, index) => <li key={index}>{String(item)}</li>)}</ul>;
        if (isAgentAccountBusinessHours(value)) return <div className="space-y-1">
            <p>{value.timezone}</p><p>{value.is247 ? t('alwaysOpen') : t('weeklySchedule')}</p>
            <ul>{AGENT_ACCOUNT_DAYS.map(day => <li key={day}>{t(`days.${day}`)}: {value.schedule[day].enabled ? `${value.schedule[day].open}–${value.schedule[day].close}` : t('closed')}</li>)}</ul>
            <p className="whitespace-pre-wrap">{value.afterHoursMessage}</p>
        </div>;
        const mission = value as AgentMissionV1;
        if (mission.version === 1 && Array.isArray(mission.intentKeys)) return <dl className="space-y-2">
            <div><dt className="font-medium">{t('objective')}</dt><dd className="whitespace-pre-wrap">{mission.objective}</dd></div>
            <div><dt className="font-medium">{t('intents')}</dt><dd>{mission.intentKeys.map(key => t.has(`intentLabels.${key}`) ? t(`intentLabels.${key}`) : key).join(', ')}</dd></div>
            <div><dt className="font-medium">{t('successCriteria')}</dt><dd className="whitespace-pre-wrap">{mission.successCriteria?.join('\n')}</dd></div>
            <div><dt className="font-medium">{t('handoffConditions')}</dt><dd className="whitespace-pre-wrap">{mission.handoffConditions?.join('\n')}</dd></div>
        </dl>;
        return <pre className="whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>;
    };
    const apply = async () => {
        if (!activeTenantId || busy || !canApply) return;
        setBusy(true); setError(false);
        try {
            const response = await api.applyAgentConfiguration(activeTenantId, proposal.id, proposal.digest);
            if (!response.success || !response.data) throw new Error('apply_unavailable');
            setResult(response.data);
            notifyAgentConfigurationApplied(activeTenantId, response.data.proposal.agentId);
            requestQualityHealthRefresh();
            onApplied?.(response.data);
        } catch { setError(true); } finally { setBusy(false); }
    };
    return <section className="mt-3 rounded-xl border border-indigo-200 bg-white p-3 text-sm dark:border-indigo-700 dark:bg-neutral-900" aria-label={t('reviewTitle')}>
        <h3 className="font-semibold">{t('reviewTitle')}</h3>
        <p className="mt-1 font-medium">{proposal.agentName}</p>
        <p className="mt-1 text-xs text-neutral-500">{t('version', { version: proposal.expectedVersion })}</p>
        {proposal.changes.map(change => <div key={change.path} className="mt-3 border-t pt-3">
            <h4 className="font-medium">{t(`fields.${change.path.replace(/\./g, '_')}`)}</h4>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 rounded-lg bg-neutral-100 p-2 dark:bg-neutral-800"><p className="mb-1 text-xs font-semibold">{t('current')}</p>{renderValue(change.before)}</div>
                <div className="min-w-0 rounded-lg bg-indigo-50 p-2 dark:bg-indigo-950"><p className="mb-1 text-xs font-semibold">{t('proposed')}</p>{renderValue(change.value)}</div>
            </div>
        </div>)}
        {error && <p role="alert" className="mt-3 text-red-600 dark:text-red-400">{t('applyError')}</p>}
        {applied && <p role="status" className="mt-3 text-emerald-700 dark:text-emerald-400">{t('applied')}</p>}
        {result?.verification === 'unavailable' && <p role="status" className="mt-2 text-amber-700 dark:text-amber-400">{t('verificationPending')}</p>}
        {expired && <p role="status" className="mt-3 text-amber-700 dark:text-amber-400">{t('expired')}</p>}
        {canApply && !expired && (!applied || result?.verification === 'unavailable') && <button type="button" disabled={busy} onClick={() => void apply()}
            className="mt-3 min-h-10 rounded-lg bg-indigo-600 px-3 py-2 font-medium text-white disabled:opacity-50">{busy ? t('applying') : applied ? t('retryVerification') : t('apply')}</button>}
    </section>;
}
