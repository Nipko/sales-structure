'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentReleaseReviewSubject, AgentReleaseSubjectValue } from '@parallext/shared';
import { canReviewRelease, emptyReleaseReviewChecks, RELEASE_REVIEW_CHECKS, releaseErrorKind,
    type AgentReleaseDetail, type ReleaseReviewChecks } from '@/lib/agent-release-review';

const button = 'min-h-10 rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40';
const panel = 'rounded-xl border bg-white p-5 dark:bg-neutral-900';

function SubjectValue({ value, field }: { value: AgentReleaseSubjectValue; field: string }) {
    const t = useTranslations('agentReleases');
    const tools = useTranslations('agent.capabilities');
    const format = (value: string) => {
        if (field === 'toolsEnabled') {
            if (value === 'appointments') return tools('appointmentScheduling');
            if (tools.has(`${value}Title`)) return tools(`${value}Title`);
        }
        if (['mode', 'skillset'].includes(field) && t.has(`values.${value}`)) return t(`values.${value}`);
        return value;
    };
    if (value === null) return <span className="text-neutral-500 dark:text-neutral-400">{t('unknown')}</span>;
    if (Array.isArray(value)) return value.length ? <ul className="list-disc space-y-1 pl-5">{value.map((item, i) => <li key={i} className="whitespace-pre-wrap break-words">{format(item)}</li>)}</ul> : <span>{t('empty')}</span>;
    return <span className="whitespace-pre-wrap break-words">{typeof value === 'boolean' ? t(value ? 'yes' : 'no') : typeof value === 'string' ? format(value) : value}</span>;
}

export function AgentReleaseSubject({ subject }: { subject: AgentReleaseReviewSubject }) {
    const t = useTranslations('agentReleases');
    return <section className={`${panel} space-y-4`}><h2 className="font-semibold">{t('subjectTitle')}</h2><p className="text-sm">{t('subjectHelp')}</p>
        <p className="text-sm">{t('baseVersion', { version: subject.baseOperationalVersion ?? t('unknown') })}</p>
        <details><summary className="cursor-pointer font-medium">{t('changesTitle')}</summary>
            {subject.changes === null ? <p className="mt-3">{t('baseUnavailable')}</p> : !subject.changes.length ? <p className="mt-3">{t('noProjectedChanges')}</p> :
                <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{t('changesTitle')}</caption><thead><tr>
                    {['field', 'before', 'after'].map(key => <th key={key} scope="col" className="p-2">{t(key)}</th>)}
                </tr></thead><tbody>{subject.changes.map(change => <tr key={change.key} className="border-t align-top"><th scope="row" className="p-2 font-medium">{t(`fields.${change.key}`)}</th>
                    <td className="max-w-sm p-2"><SubjectValue field={change.key} value={change.before} /></td><td className="max-w-sm p-2"><SubjectValue field={change.key} value={change.after} /></td></tr>)}</tbody></table></div>}
        </details>
        <details><summary className="cursor-pointer font-medium">{t('allConfiguration')}</summary><dl className="mt-3 space-y-3 text-sm">
            {subject.fields.map(field => <div key={field.key} className="grid gap-1 border-t pt-3 sm:grid-cols-[200px_1fr]"><dt className="font-medium">{t(`fields.${field.key}`)}</dt><dd><SubjectValue field={field.key} value={field.value} /></dd></div>)}
        </dl></details>
    </section>;
}

export function AgentReleaseReview({ candidate, role, busy, decide }: { candidate: AgentReleaseDetail; role: string | null | undefined; busy: boolean;
    decide: (decision: 'approve' | 'reject', checks: ReleaseReviewChecks, seen: string[]) => Promise<void> }) {
    const t = useTranslations('agentReleases');
    const [checks, setChecks] = useState(emptyReleaseReviewChecks), [seen, setSeen] = useState<string[]>([]), [opened, setOpened] = useState<string[]>([]);
    const current = candidate.revisionState === 'current', evidence = current ? candidate.review : null;
    const status = (value: string) => t(t.has(`states.${value}`) ? `states.${value}` : 'unknown');
    const channel = (value: string) => t(t.has(`channels.${value}`) ? `channels.${value}` : 'unknown');
    const language = (value: string) => t(t.has(`languages.${value}`) ? `languages.${value}` : 'unknown');
    return <div className="space-y-5"><section className={`${panel} space-y-3`}>
        <h2 className="font-semibold">{t('candidateTitle')}</h2><p role="status">{status(candidate.status)} · {t('version', { version: candidate.version })}</p>
        <p className="text-sm">{t('reviewDoesNotPublish')}</p>
        {!current && <p role="alert" className="rounded-lg border border-amber-400 p-3">{t(candidate.revisionState === 'changed' || candidate.revisionState === 'invalidated' ? 'changed' : 'unavailable')}</p>}
        {candidate.error && <p role="alert">{t(releaseErrorKind(candidate.error))}</p>}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{t('channelsTitle')}</caption><thead><tr>
            {['channel', 'state', 'completedScenarios'].map(key => <th scope="col" key={key} className="p-2">{t(key)}</th>)}
        </tr></thead><tbody>{candidate.evaluations.map(row => <tr key={row.id} className="border-t"><th scope="row" className="p-2 font-medium">{channel(row.channel)}</th>
            <td className="p-2">{status(row.status)}{row.error && <p className="mt-1 text-xs">{t(releaseErrorKind(row.error))}</p>}</td><td className="p-2">{row.completedScenarios}</td></tr>)}</tbody></table></div>
        {!candidate.evaluations.length && <p>{t('noEvaluation')}</p>}
    </section>
        {evidence && <><AgentReleaseSubject subject={evidence.subject} />
            <section className={`${panel} space-y-3`}><h2 className="font-semibold">{t('evidenceTitle')}</h2>
                <p>{t('caseCoverage', { verified: evidence.readiness.verifiedCases, required: evidence.readiness.requiredCases })}</p>
                <p className="text-sm">{t('evidenceLimits')}</p><p role="status">{t(evidence.eligibleForReview ? 'reviewReady' : 'reviewBlocked')}</p>
                <details><summary className="cursor-pointer font-medium">{t('operationsTitle')}</summary><p className="mt-2 text-sm">{t('operationsHelp')}</p>
                    {!evidence.operationChecks.length ? <p className="mt-2 text-sm">{t('noOperationChecks')}</p> : <ul className="mt-3 max-h-96 space-y-3 overflow-y-auto text-sm">
                        {evidence.operationChecks.map((check, i) => <li key={i} className="rounded-lg border p-3"><p className="font-medium">{channel(check.channel)} · {check.language ? language(check.language) : t('unknown')}</p>
                            <p>{t(t.has(`assertions.${check.assertion}`) ? `assertions.${check.assertion}` : 'unknown')}{check.family || check.tool ? ` · ${check.family ?? check.tool}` : ''}</p>
                            <p>{t('operationCoverage', { passed: check.passed, required: check.required, failed: check.failed, unknown: check.unknown })}</p>
                            <p className="break-words text-xs text-neutral-500">{t('scenarioReference', { key: check.scenario })}</p></li>)}
                    </ul>}
                </details>
                {!!evidence.readiness.gaps.length && <details><summary className="cursor-pointer">{t('gapsTitle', { count: evidence.readiness.gaps.length })}</summary><ul className="mt-3 max-h-80 list-disc space-y-2 overflow-y-auto pl-5 text-sm">
                    {evidence.readiness.gaps.map((gap, i) => <li key={i}>{t(t.has(`gaps.${gap.code}`) ? `gaps.${gap.code}` : 'gaps.unknown')}
                        <span className="block text-xs text-neutral-500 dark:text-neutral-400">{[gap.channel && channel(gap.channel), gap.language && language(gap.language), gap.task, gap.scenario].filter(Boolean).join(' · ')}</span></li>)}
                </ul></details>}
                <details><summary className="cursor-pointer text-sm">{t('evidenceIdentity')}</summary><dl className="mt-3 space-y-2 break-all text-xs">
                    {[['revisionId', candidate.configurationRevisionId], ['candidateHash', evidence.configurationHash], ['baseHash', evidence.subject.baseOperationalHash], ['dependencyHash', evidence.dependencyRevision], ['evidenceHash', evidence.evidenceHash]].map(([key, value]) =>
                        <div key={key}><dt className="font-medium">{t(key!)}</dt><dd className="font-mono">{value ?? t('unknown')}</dd></div>)}
                </dl></details>
            </section>
            <section className={`${panel} space-y-4`}><h2 className="font-semibold">{t('samplesTitle')}</h2><p className="text-sm">{t('samplesHelp')}</p>
                {!evidence.samples.length && <p>{t('noSamples')}</p>}
                {evidence.samples.map(sample => <article key={sample.hash} className="rounded-lg border p-3"><details onToggle={event => {
                    if (event.currentTarget.open) setOpened(old => old.includes(sample.hash) ? old : [...old, sample.hash]);
                }}><summary className="cursor-pointer font-medium">{channel(sample.channel)} · {language(sample.language)}</summary>
                    <p className="mt-2 break-words text-xs text-neutral-500">{t('scenarioReference', { key: sample.scenario })}</p>
                    <ol className="my-3 space-y-3">{sample.transcript.map((turn, index) => <li key={index} className="rounded-lg bg-neutral-100 p-3 dark:bg-neutral-800">
                        <span className="text-xs font-semibold">{t(turn.role === 'user' ? 'customer' : turn.role === 'assistant' ? 'agent' : 'event')}</span>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{turn.content}</p>
                    </li>)}</ol></details>
                    {candidate.status === 'evaluated' && <label className="mt-3 flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={seen.includes(sample.hash)}
                        disabled={busy || !opened.includes(sample.hash) || !['tenant_admin', 'super_admin'].includes(role ?? '')}
                        onChange={event => setSeen(old => event.target.checked ? [...old, sample.hash] : old.filter(hash => hash !== sample.hash))} />{t('sampleReviewed')}</label>}
                </article>)}
            </section>
            {candidate.status === 'evaluated' && ['tenant_admin', 'super_admin'].includes(role ?? '') && <section className={`${panel} space-y-3`}><h2 className="font-semibold">{t('decisionTitle')}</h2>
                <p className="text-sm">{t('decisionHelp')}</p><fieldset disabled={busy} className="space-y-2"><legend className="sr-only">{t('decisionTitle')}</legend>
                    {RELEASE_REVIEW_CHECKS.map(key => <label key={key} className="flex min-h-10 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={checks[key]}
                        onChange={event => setChecks(old => ({ ...old, [key]: event.target.checked }))} />{t(`checks.${key}`)}</label>)}
                </fieldset><div className="flex flex-wrap gap-2"><button type="button" className={`${button} border-indigo-500`} disabled={busy || !canReviewRelease(candidate, role, 'approve', checks, seen)} onClick={() => void decide('approve', checks, seen)}>{t('approve')}</button>
                    <button type="button" className={button} disabled={busy || !canReviewRelease(candidate, role, 'reject', checks, seen)} onClick={() => void decide('reject', checks, seen)}>{t('reject')}</button></div>
            </section>}
        </>}
    </div>;
}
