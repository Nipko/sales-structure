'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AgentConfigurationWorkspace } from '@parallext/shared';
import { api } from '@/lib/api';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { isAdmin } from '@/lib/roles';
import type { AgentReleaseDetail, AgentReleaseListItem } from '@/lib/agent-release-review';
import {
    preparePublish, prepareRollback, publicationErrorKind, publicationReference, publicationRequiresReload,
    publishBlock, rollbackBlock,
    type AgentActivation, type AgentPublicationHistory, type AgentPublicationReceipt,
    type PublicationAttempt, type PublishAgentConfigurationRequest, type RollbackAgentConfigurationRequest,
} from '@/lib/agent-publication';

/**
 * Which configuration customers actually get, and the way back.
 *
 * A candidate could be reviewed and approved and then had no way to reach the
 * agent that serves people: publication existed only as an endpoint. This is
 * that step, and its history — what is serving now, what it replaced, and who
 * asked for each change.
 *
 * Every request here is compare-and-swap, so the screen sends the values it
 * just read and never what it remembers. When the server answers that those
 * values are stale, that is not a generic failure: somebody else changed the
 * configuration, and the only correct next action is to read it again.
 *
 * Configuration bodies are never shown. The history says what happened; the
 * editor is where a configuration is read.
 */

const BUTTON = 'inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm '
    + 'text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 '
    + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const CARD = 'rounded-xl border border-border bg-card';

type Confirming = 'publish' | 'rollback' | null;

export function AgentPublicationWorkspace({ tenantId, agentId, role }: {
    tenantId: string; agentId: string; role: string | null | undefined;
}) {
    const t = useTranslations('agentPublications');
    const locale = useLocale();

    const [workspace, setWorkspace] = useState<AgentConfigurationWorkspace | null>(null);
    const [history, setHistory] = useState<AgentPublicationHistory | null>(null);
    const [candidates, setCandidates] = useState<AgentReleaseListItem[]>([]);
    const [candidateId, setCandidateId] = useState('');
    const [candidate, setCandidate] = useState<AgentReleaseDetail | null>(null);
    const [activation, setActivation] = useState<AgentActivation>('preserve');

    const [loading, setLoading] = useState(true);
    const [reading, setReading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState<Confirming>(null);
    const [error, setError] = useState('');
    const [staleRead, setStaleRead] = useState(false);
    const [notice, setNotice] = useState('');

    const mounted = useRef(true);
    const loadGeneration = useRef(0);
    const detailGeneration = useRef(0);
    const publishAttempt = useRef<PublicationAttempt<PublishAgentConfigurationRequest> | null>(null);
    const rollbackAttempt = useRef<PublicationAttempt<RollbackAgentConfigurationRequest> | null>(null);

    const dateFormatter = useMemo(
        () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale]);
    const when = (value: string) => {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? '—' : dateFormatter.format(parsed);
    };

    /**
     * One read for all three. The CAS pair must come from the same moment: a
     * version taken here and a hash taken a second later is precisely the stale
     * expectation the server exists to refuse.
     */
    const load = useCallback(async () => {
        const generation = ++loadGeneration.current;
        setLoading(true);
        setError('');
        setStaleRead(false);
        const [configuration, publications, releases] = await Promise.all([
            api.getAgentConfiguration(tenantId, agentId),
            api.getAgentPublications(tenantId, agentId),
            api.getAgentReleases(tenantId, agentId),
        ]);
        if (!mounted.current || generation !== loadGeneration.current) return;
        publishAttempt.current = null;
        rollbackAttempt.current = null;
        const nextWorkspace = configuration.success ? configuration.data ?? null : null;
        const nextHistory = publications.success ? publications.data ?? null : null;
        setWorkspace(nextWorkspace);
        setHistory(nextHistory);
        const approved = (releases.success ? releases.data ?? [] : []).filter(row => row.status === 'approved');
        setCandidates(approved);
        setCandidateId(current => (approved.some(row => row.id === current) ? current : approved[0]?.id ?? ''));
        if (!nextWorkspace || !nextHistory) {
            setError(t(`errors.${publicationErrorKind(nextWorkspace ? publications : configuration)}`));
        }
        setLoading(false);
    }, [tenantId, agentId, t]);

    useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; loadGeneration.current++; detailGeneration.current++; }; }, [load]);

    useEffect(() => {
        const generation = ++detailGeneration.current;
        publishAttempt.current = null;
        setCandidate(null);
        if (!candidateId) { setReading(false); return; }
        setReading(true);
        void api.getAgentRelease(tenantId, agentId, candidateId).then(result => {
            if (!mounted.current || generation !== detailGeneration.current) return;
            if (result.success && result.data?.id === candidateId && result.data.agentId === agentId) setCandidate(result.data);
            else setError(t(`errors.${publicationErrorKind(result)}`));
            setReading(false);
        });
    }, [tenantId, agentId, candidateId, t]);

    const publishRefusal = publishBlock(workspace, history, candidate, role);
    const rollbackRefusal = rollbackBlock(workspace, history, role);

    const settle = (receipt: AgentPublicationReceipt, kind: 'publish' | 'rollback') => {
        setNotice(t(receipt.idempotentReplay ? 'replayNotice' : `${kind}Notice`,
            { version: receipt.operationalVersion }));
    };

    const commit = async (kind: 'publish' | 'rollback') => {
        if (!workspace || !history || busy) return;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const result = kind === 'publish'
                ? await (async () => {
                    publishAttempt.current = preparePublish(
                        workspace, history, candidate!, role, activation, publishAttempt.current);
                    return api.publishAgentConfiguration(tenantId, agentId, candidate!.id, publishAttempt.current.body);
                })()
                : await (async () => {
                    rollbackAttempt.current = prepareRollback(workspace, history, role, rollbackAttempt.current);
                    return api.rollbackAgentConfiguration(tenantId, agentId, rollbackAttempt.current.body);
                })();
            if (!mounted.current) return;
            if (result.success && result.data) {
                settle(result.data, kind);
                await load();
                return;
            }
            const errorKind = publicationErrorKind(result);
            setError(t(`errors.${errorKind}`));
            if (publicationRequiresReload(errorKind)) {
                // The values on screen describe a configuration that is no
                // longer serving. Stop offering an action built from them.
                setStaleRead(true);
                publishAttempt.current = null;
                rollbackAttempt.current = null;
            }
        } catch (thrown: any) {
            // The only throw here is the local verdict refusing to build a
            // request from expectations that no longer hold together.
            const blocked = String(thrown?.message || '').split('agent_publication_blocked:')[1];
            if (mounted.current) {
                setError(blocked
                    ? t(`${kind === 'publish' ? 'publishBlocked' : 'rollbackBlocked'}.${blocked}`)
                    : t('errors.unavailable'));
            }
        } finally {
            if (mounted.current) { setConfirming(null); setBusy(false); }
        }
    };

    return (
        <main className="mx-auto max-w-5xl space-y-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Link href={`/admin/agent/${agentId}`} className={BUTTON}>{t('back')}</Link>
                <button type="button" className={BUTTON} disabled={busy || loading} onClick={() => void load()}>
                    {t('refresh')}
                </button>
            </div>

            <header>
                <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('intro')}</p>
            </header>

            {error && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
            <p aria-live="polite" className="sr-only">{notice}</p>
            {notice && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}

            {staleRead && (
                <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                    <p className="text-sm text-amber-900 dark:text-amber-100">{t('reloadRequired')}</p>
                    <button type="button" className={`${BUTTON} mt-3`} disabled={busy} onClick={() => void load()}>
                        {t('reload')}
                    </button>
                </div>
            )}

            <section aria-labelledby="publication-current" className={`${CARD} p-5`}>
                <h2 id="publication-current" className="text-lg font-semibold text-foreground">{t('current.title')}</h2>
                {loading ? <p role="status" className="mt-2 text-sm text-muted-foreground">{t('loading')}</p> : (
                    <dl className="mt-3 space-y-2 text-sm">
                        <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-2">
                            <dt className="text-muted-foreground">{t('current.version')}</dt>
                            <dd className="tabular-nums text-foreground">{workspace ? workspace.operational.version : '—'}</dd>
                        </div>
                        <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-2">
                            <dt className="text-muted-foreground">{t('current.hash')}</dt>
                            <dd className="break-all font-mono text-foreground">{publicationReference(workspace?.operational.hash)}</dd>
                        </div>
                        <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-2">
                            <dt className="text-muted-foreground">{t('current.head')}</dt>
                            <dd className="text-foreground">
                                {history?.head
                                    ? t('current.headValue', {
                                        kind: t(`kinds.${history.head.kind}`),
                                        reference: publicationReference(history.head.id),
                                        when: when(history.head.createdAt),
                                    })
                                    : t('current.noHead')}
                            </dd>
                        </div>
                    </dl>
                )}
                <p className="mt-3 text-sm text-muted-foreground">{t('current.bodiesNote')}</p>
            </section>

            <section aria-labelledby="publication-publish" className={`${CARD} p-5`}>
                <h2 id="publication-publish" className="text-lg font-semibold text-foreground">{t('publish.title')}</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('publish.help')}</p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                        <label htmlFor="publication-candidate" className="mb-1 block text-sm font-medium text-foreground">
                            {t('publish.candidate')}
                        </label>
                        <select id="publication-candidate" value={candidateId} disabled={loading || busy}
                            onChange={event => { setCandidateId(event.target.value); setConfirming(null); setError(''); setNotice(''); }}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                            <option value="">{t('publish.noCandidate')}</option>
                            {candidates.map(row => (
                                <option key={row.id} value={row.id}>
                                    {t('publish.candidateOption', { reference: row.id.slice(0, 8), version: row.version })}
                                </option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-muted-foreground">{t('publish.candidateHelp')}</p>
                    </div>
                    <div>
                        <label htmlFor="publication-activation" className="mb-1 block text-sm font-medium text-foreground">
                            {t('publish.activation')}
                        </label>
                        <select id="publication-activation" value={activation} disabled={loading || busy}
                            onChange={event => { setActivation(event.target.value as AgentActivation); setConfirming(null); }}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                            <option value="preserve">{t('publish.activationPreserve')}</option>
                            <option value="activate">{t('publish.activationActivate')}</option>
                        </select>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {t(activation === 'activate' ? 'publish.activationActivateHelp' : 'publish.activationPreserveHelp')}
                        </p>
                    </div>
                </div>

                {reading && <p role="status" className="mt-3 text-sm text-muted-foreground">{t('loading')}</p>}
                {!loading && !reading && publishRefusal && (
                    <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{t(`publishBlocked.${publishRefusal}`)}</p>
                )}
                {candidate?.review && (
                    <p className="mt-3 text-sm text-muted-foreground">
                        {t('publish.evidence', { reference: publicationReference(candidate.review.evidenceHash), version: candidate.version })}
                    </p>
                )}

                <button type="button" className={`${BUTTON} mt-4 border-indigo-500 text-indigo-600 dark:text-indigo-300`}
                    disabled={Boolean(publishRefusal) || staleRead || busy || loading || reading}
                    onClick={() => { setConfirming('publish'); setNotice(''); }}>
                    {t('publish.action')}
                </button>

                {confirming === 'publish' && !publishRefusal && (
                    <ConfirmStep
                        title={t('publish.confirmTitle')}
                        consequence={t(activation === 'activate' ? 'publish.confirmBodyActivate' : 'publish.confirmBodyPreserve',
                            { version: (workspace?.operational.version ?? 0) + 1 })}
                        confirmLabel={t('publish.confirm')}
                        cancelLabel={t('cancel')}
                        busy={busy}
                        onConfirm={() => void commit('publish')}
                        onCancel={() => setConfirming(null)}
                    />
                )}
            </section>

            <section aria-labelledby="publication-rollback" className={`${CARD} p-5`}>
                <h2 id="publication-rollback" className="text-lg font-semibold text-foreground">{t('rollback.title')}</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('rollback.help')}</p>
                {!loading && rollbackRefusal && (
                    <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{t(`rollbackBlocked.${rollbackRefusal}`)}</p>
                )}
                <button type="button" className={`${BUTTON} mt-4 border-amber-500 text-amber-700 dark:text-amber-300`}
                    disabled={Boolean(rollbackRefusal) || staleRead || busy || loading}
                    onClick={() => { setConfirming('rollback'); setNotice(''); }}>
                    {t('rollback.action')}
                </button>
                {confirming === 'rollback' && !rollbackRefusal && history?.head && (
                    <ConfirmStep
                        title={t('rollback.confirmTitle')}
                        consequence={t('rollback.confirmBody', {
                            reference: publicationReference(history.head.id),
                            version: (workspace?.operational.version ?? 0) + 1,
                        })}
                        confirmLabel={t('rollback.confirm')}
                        cancelLabel={t('cancel')}
                        busy={busy}
                        onConfirm={() => void commit('rollback')}
                        onCancel={() => setConfirming(null)}
                    />
                )}
            </section>

            <section aria-labelledby="publication-history" className={`${CARD} p-5`}>
                <h2 id="publication-history" className="text-lg font-semibold text-foreground">{t('history.title')}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t('history.help')}</p>
                {loading ? <p role="status" className="mt-3 text-sm text-muted-foreground">{t('loading')}</p>
                    : !history?.events.length ? <p className="mt-3 text-sm text-muted-foreground">{t('history.empty')}</p> : (
                        <div className="mt-3 overflow-x-auto">
                            <table className="w-full text-sm">
                                <caption className="sr-only">{t('history.caption')}</caption>
                                <thead>
                                    <tr className="border-b border-border text-left">
                                        <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">{t('history.colWhen')}</th>
                                        <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">{t('history.colKind')}</th>
                                        <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">{t('history.colVersion')}</th>
                                        <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">{t('history.colHashes')}</th>
                                        <th scope="col" className="py-2 font-medium text-muted-foreground">{t('history.colRequestedBy')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.events.map(event => (
                                        <tr key={event.id} className="border-b border-border/60">
                                            <td className="py-2 pr-3 text-foreground">{when(event.createdAt)}</td>
                                            <td className="py-2 pr-3 text-foreground">
                                                {t(`kinds.${event.kind}`)}
                                                {event.rollbackOf && (
                                                    <span className="block text-xs text-muted-foreground">
                                                        {t('history.rollbackOf', { reference: publicationReference(event.rollbackOf) })}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                                                {t('history.versionRange', { from: event.baseVersion, to: event.operationalVersion })}
                                            </td>
                                            <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                                                {publicationReference(event.beforeHash)} → {publicationReference(event.afterHash)}
                                            </td>
                                            <td className="py-2 font-mono text-xs text-muted-foreground">{publicationReference(event.requestedBy)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
            </section>

            {!isAdmin(role) && <p className="text-sm text-muted-foreground">{t('readOnly')}</p>}
        </main>
    );
}
