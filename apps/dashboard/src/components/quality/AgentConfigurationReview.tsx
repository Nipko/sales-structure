"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AGENT_ACCOUNT_DAYS, isAgentAccountBusinessHours, type AgentConfigurationProposal, type AgentMissionV1, type AppliedAgentConfiguration, type AppliedDraftVerification, type AppliedDraftVerificationState } from '@parallext/shared';
import { useTenant } from '@/contexts/TenantContext';
import { useAgentReviewMode } from '@/hooks/useAgentReviewMode';
import { useRole } from '@/hooks/useRole';
import { agentReviewModeCopyKey, withinNamespace, type AgentReviewModeReading } from '@/lib/agent-review-mode';
import { api } from '@/lib/api';
import { notifyAgentConfigurationApplied, requestQualityHealthRefresh } from '@/lib/quality-health-events';

/** One sentence per state. A fifth state cannot compile until it has its own. */
const DRAFT_CHECK_KEYS: Record<AppliedDraftVerificationState, string> = {
    verified: 'verified', failed: 'failed', unavailable: 'unavailable', not_applicable: 'notApplicable',
};
/** Superseded evidence takes the "nothing proven" tone, never the green one. */
const DRAFT_CHECK_TONES: Record<AppliedDraftVerificationState | 'stale', string> = {
    verified: 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400',
    failed: 'border-red-300 text-red-600 dark:border-red-800 dark:text-red-400',
    unavailable: 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400',
    not_applicable: 'border-neutral-200 text-neutral-700 dark:border-neutral-700 dark:text-neutral-300',
    stale: 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400',
};

/**
 * Evidence about the revision this apply wrote. It gets its own box because it
 * answers a different question from the assessment around it: that one
 * describes the configuration still serving customers, this one only says
 * whether the edited draft answered at all — with tools off, and without
 * proving that any mission task passes.
 *
 * `live`: the tenant applies changes immediately, so there was no draft — the
 * change went live and the check ran against the agent that answers now. Every
 * sentence that says "borrador" has a live twin under `draftCheck.live`.
 */
export function AppliedDraftEvidence({ verification, currentRevision, live = false }: {
    verification: AppliedDraftVerification;
    /** The draft pointer the apply re-read as it committed, when there is one. */
    currentRevision?: { id: string; bodyHash: string } | null;
    live?: boolean;
}) {
    const t = useTranslations('agentConfiguration');
    const say = (key: string) => live && t.has(`draftCheck.live.${key}`) ? t(`draftCheck.live.${key}`) : t(`draftCheck.${key}`);
    // The receipt names the revision it ran against, so it can only ever speak
    // for that one: once the draft moves past it this is history, not a verdict.
    const stale = Boolean(verification.revisionId && currentRevision
        && (currentRevision.id !== verification.revisionId || currentRevision.bodyHash !== verification.revisionHash));
    const state = verification.state;
    const reason = verification.reason;
    return <section className={`mt-3 rounded-lg border p-3 ${DRAFT_CHECK_TONES[stale ? 'stale' : state]}`}>
        <h4 className="font-semibold">{t('draftCheck.title')}</h4>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{state === 'not_applicable' ? t('draftCheck.scopeAccount') : say('scope')}</p>
        {stale
            ? <><p role="status" className="mt-2 font-medium">{t('draftCheck.stale')}</p>
                <p className="mt-1 text-xs">{t('draftCheck.staleThen')} {say(DRAFT_CHECK_KEYS[state])}</p></>
            : <p role={state === 'failed' ? 'alert' : 'status'} className="mt-2 font-medium">{say(DRAFT_CHECK_KEYS[state])}</p>}
        {!stale && state === 'verified' && <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{say('verifiedLimit')}</p>}
        {/* Only what the apply reported. An unmapped reason says nothing rather than naming a cause nobody established. */}
        {!stale && state === 'unavailable' && reason && t.has(`draftCheck.reasons.${reason}`)
            && <p className="mt-1 text-xs">{say(`reasons.${reason}`)}</p>}
    </section>;
}

/**
 * Which sentence an apply refusal gets. Only one has its own: an immediate save
 * that would leave two active agents on one channel is refused
 * (`agent_connection_owned_by_other_agent`), and the fix is a channel on
 * another agent — not "prepare a new review", which is what the generic
 * sentence tells the owner. Everything else keeps the generic sentence.
 */
export function applyErrorMessageKey(errorCode?: string | null): 'applyError' | 'applyErrors.connectionOwned' {
    return errorCode === 'agent_connection_owned_by_other_agent' ? 'applyErrors.connectionOwned' : 'applyError';
}

/**
 * What applying an agent proposal does, in the tenant's mode (D25).
 *
 * The card always said "a draft is saved; what answers does not change" and
 * offered "Guardar borrador", while the default mode applies the change to the
 * agent answering customers the moment the button is pressed. Before the apply
 * the mode comes from the tenant (read once, admins only, since only they can
 * apply); after it, from the workspace the apply returned, which is the one
 * source that cannot be stale. Unknown gets a sentence true in both modes.
 */
export function proposalModeReading(
    fetched: AgentReviewModeReading,
    result?: Pick<AppliedAgentConfiguration, 'draft'> | null,
): AgentReviewModeReading {
    const directCommit = result?.draft?.workspace?.directCommit;
    if (typeof directCommit === 'boolean') return directCommit ? 'immediate' : 'reviewed';
    return fetched;
}

/** The displayed values and digest are immutable; changing a value requires a new proposal. */
export function AgentConfigurationReview({ proposal, onApplied }: {
    proposal: AgentConfigurationProposal; onApplied?: (result: AppliedAgentConfiguration) => void;
}) {
    const t = useTranslations('agentConfiguration');
    const tDraft = useTranslations('agentDraft');
    const { activeTenantId } = useTenant();
    const { role } = useRole();
    const [result, setResult] = useState<AppliedAgentConfiguration | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<ReturnType<typeof applyErrorMessageKey> | null>(null);
    const current = result?.proposal ?? proposal;
    const scoped = ['agent_draft', 'account'].includes(current.targetScope);
    const applied = scoped && current.status === 'applied';
    const expired = !scoped || current.status === 'expired' || (!applied && Date.parse(current.expiresAt) <= Date.now());
    const canApply = ['tenant_admin', 'super_admin'].includes(role ?? '');
    const fetchedMode = useAgentReviewMode(activeTenantId, canApply && proposal.targetScope === 'agent_draft');
    const mode = proposalModeReading(fetchedMode, result);
    const modeCopy = (surface: 'proposalReview' | 'proposalApply' | 'proposalApplied') =>
        tDraft(withinNamespace(agentReviewModeCopyKey(surface, mode), 'agentDraft'));
    // Applying again replays the committed proposal and runs the check afresh,
    // so a check that never ran is worth offering again. Exhausted quota is not:
    // nothing about pressing the button puts AI messages back in the period.
    const recheckable = result?.draftVerification.state === 'unavailable' && result.draftVerification.reason !== 'quota_exhausted';
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
        setBusy(true); setError(null);
        try {
            const response = await api.applyAgentConfiguration(activeTenantId, proposal.id, proposal.digest);
            if (!response.success || !response.data) { setError(applyErrorMessageKey(response.errorCode)); return; }
            setResult(response.data);
            notifyAgentConfigurationApplied(activeTenantId, response.data.proposal.agentId);
            requestQualityHealthRefresh();
            onApplied?.(response.data);
        } catch { setError('applyError'); } finally { setBusy(false); }
    };
    return <section className="mt-3 rounded-xl border border-indigo-200 bg-white p-3 text-sm dark:border-indigo-700 dark:bg-neutral-900" aria-label={t('reviewTitle')}>
        <h3 className="font-semibold">{t('reviewTitle')}</h3>
        <p className="mt-1 font-medium">{proposal.agentName}</p>
        {/* `expectedVersion` is how the apply refuses a stale proposal, not
            something to read: the owner is told what it means, not its number. */}
        <p className="mt-1 text-xs text-neutral-500" data-prepared-from>{t('preparedFrom')}</p>
        <p className="mt-2 text-xs" data-review-mode={proposal.targetScope === 'account' ? undefined : mode}>{proposal.targetScope === 'account' ? tDraft('accountReview') : modeCopy('proposalReview')}</p>
        {proposal.changes.map(change => <div key={change.path} className="mt-3 border-t pt-3">
            <h4 className="font-medium">{t(`fields.${change.path.replace(/\./g, '_')}`)}</h4>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 rounded-lg bg-neutral-100 p-2 dark:bg-neutral-800"><p className="mb-1 text-xs font-semibold">{t('current')}</p>{renderValue(change.before)}</div>
                <div className="min-w-0 rounded-lg bg-indigo-50 p-2 dark:bg-indigo-950"><p className="mb-1 text-xs font-semibold">{t('proposed')}</p>{renderValue(change.value)}</div>
            </div>
        </div>)}
        {error && <div role="alert" className="mt-3 text-red-600 dark:text-red-400">
            <p>{t(error, { agent: proposal.agentName })}</p>
            {error === 'applyErrors.connectionOwned' && <a href={`/admin/agent/${proposal.agentId}?tab=persona&focus=channels`}
                className="mt-2 inline-flex min-h-10 items-center rounded-lg border border-red-300 px-3 py-2 font-medium dark:border-red-800">
                {t('applyErrors.connectionOwnedAction', { agent: proposal.agentName })}</a>}
        </div>}
        {applied && <p role="status" className="mt-3 text-emerald-700 dark:text-emerald-400">{proposal.targetScope === 'account' ? t('applied') : modeCopy('proposalApplied')}</p>}
        {result && <AppliedDraftEvidence verification={result.draftVerification} currentRevision={result.draft?.workspace.draft} live={mode === 'immediate'} />}
        {result?.draft?.workspace.evaluationRevisionId && <a href={`/admin/agent/${proposal.agentId}/test?configurationRevisionId=${encodeURIComponent(result.draft.workspace.evaluationRevisionId)}`}
            className="mt-3 inline-flex min-h-10 items-center rounded-lg border px-3 py-2">{tDraft('testDraft')}</a>}
        {result?.verification === 'unavailable' && <p role="status" className="mt-2 text-amber-700 dark:text-amber-400">{t('verificationPending')}</p>}
        {expired && <p role="status" className="mt-3 text-amber-700 dark:text-amber-400">{t('expired')}</p>}
        {canApply && !expired && (!applied || result?.verification === 'unavailable' || recheckable) && <button type="button" disabled={busy} onClick={() => void apply()}
            className="mt-3 min-h-10 rounded-lg bg-indigo-600 px-3 py-2 font-medium text-white disabled:opacity-50">{busy ? t('applying') : applied ? t('retryVerification') : proposal.targetScope === 'account' ? t('apply') : modeCopy('proposalApply')}</button>}
    </section>;
}
