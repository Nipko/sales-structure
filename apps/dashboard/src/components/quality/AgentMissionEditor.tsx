"use client";

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { isAgentMissionV1, type AgentAssessment, type AgentConfigurationProposal, type AgentMissionV1 } from '@parallext/shared';
import { useTenant } from '@/contexts/TenantContext';
import { useRole } from '@/hooks/useRole';
import { api } from '@/lib/api';
import { AgentConfigurationReview } from './AgentConfigurationReview';

export function AgentMissionEditor({ assessment }: { assessment: AgentAssessment }) {
    const t = useTranslations('agentConfiguration');
    const { activeTenantId } = useTenant();
    const { role } = useRole();
    const [editing, setEditing] = useState(false);
    const [objective, setObjective] = useState('');
    const [criteria, setCriteria] = useState('');
    const [handoff, setHandoff] = useState('');
    const [intents, setIntents] = useState<string[]>([]);
    const [proposal, setProposal] = useState<AgentConfigurationProposal | null>(null);
    const [request, setRequest] = useState<{ key: string; value: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    if (!assessment.agent || !['tenant_admin', 'super_admin'].includes(role ?? '')) return null;
    const start = () => {
        const mission = assessment.mission.definition;
        setObjective(mission?.objective ?? ''); setCriteria(mission?.successCriteria.join('\n') ?? '');
        setHandoff(mission?.handoffConditions.join('\n') ?? '');
        setIntents((mission?.intentKeys ?? []).filter(key => assessment.mission.availableIntentKeys.includes(key)));
        setProposal(null); setRequest(null); setError(false); setEditing(true);
    };
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!activeTenantId || busy || !assessment.agent) return;
        const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
        const mission: AgentMissionV1 = { version: 1, objective: objective.trim(), intentKeys: intents, successCriteria: lines(criteria), handoffConditions: lines(handoff) };
        if (!isAgentMissionV1(mission)) { setError(true); return; }
        const value = JSON.stringify(mission);
        const key = request?.value === value ? request.key : crypto.randomUUID();
        setRequest({ key, value }); setBusy(true); setError(false);
        try {
            const response = await api.proposeAgentConfiguration(activeTenantId, { agentId: assessment.agent.id, changes: [{ path: 'mission', value: mission }], requestKey: key });
            if (!response.success || !response.data) throw new Error('proposal_unavailable');
            setProposal(response.data);
        } catch { setError(true); } finally { setBusy(false); }
    };
    if (!editing) return <button type="button" onClick={start} className="mt-3 min-h-10 rounded-lg border border-indigo-300 px-3 py-2 text-sm font-medium">{t('editMission')}</button>;
    return <div className="mt-4 rounded-xl border bg-white p-4 dark:bg-neutral-900">
        <form onSubmit={submit} data-tour-form="agent-mission" className="space-y-3">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('missionHelp')}</p>
            <label className="block text-sm font-medium">{t('objective')}<textarea required maxLength={2000} disabled={busy || Boolean(proposal)} value={objective} onChange={event => setObjective(event.target.value)} className="mt-1 block min-h-20 w-full rounded-lg border bg-transparent p-2" /></label>
            <fieldset disabled={busy || Boolean(proposal)}><legend className="text-sm font-medium">{t('intents')}</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">{assessment.mission.availableIntentKeys.map(key => <label key={key} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={intents.includes(key)} onChange={event => setIntents(current => event.target.checked ? [...current, key] : current.filter(item => item !== key))} className="mt-1" />
                    {t.has(`intentLabels.${key}`) ? t(`intentLabels.${key}`) : key}
                </label>)}</div>
            </fieldset>
            <label className="block text-sm font-medium">{t('successCriteria')}<textarea required maxLength={10000} disabled={busy || Boolean(proposal)} value={criteria} onChange={event => setCriteria(event.target.value)} className="mt-1 block min-h-20 w-full rounded-lg border bg-transparent p-2" /><span className="text-xs font-normal text-neutral-500">{t('onePerLine')}</span></label>
            <label className="block text-sm font-medium">{t('handoffConditions')}<textarea required maxLength={10000} disabled={busy || Boolean(proposal)} value={handoff} onChange={event => setHandoff(event.target.value)} className="mt-1 block min-h-20 w-full rounded-lg border bg-transparent p-2" /><span className="text-xs font-normal text-neutral-500">{t('onePerLine')}</span></label>
            {error && <p role="alert" className="text-sm text-red-600">{t('proposalError')}</p>}
            <div className="flex flex-wrap gap-2">
                {!proposal && <button type="submit" disabled={busy} className="min-h-10 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? t('preparing') : t('prepare')}</button>}
                {proposal && <button type="button" disabled={busy} onClick={() => { setProposal(null); setRequest(null); }} className="min-h-10 rounded-lg border px-3 py-2 text-sm">{t('editReview')}</button>}
                <button type="button" disabled={busy} onClick={() => setEditing(false)} className="min-h-10 rounded-lg border px-3 py-2 text-sm">{t('close')}</button>
            </div>
        </form>
        {proposal && <AgentConfigurationReview key={proposal.id} proposal={proposal} />}
    </div>;
}
