'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentConfigurationWorkspace } from '@parallext/shared';
import { api } from '@/lib/api';
import { isAdmin } from '@/lib/roles';
import { prepareReleaseRequest, prepareReleaseReview, releaseErrorKind, type AgentReleaseDetail, type AgentReleaseListItem,
    type AgentReleaseRequest, type AgentReleaseReviewRequest, type ReleaseCommandAttempt, type ReleaseReviewChecks } from '@/lib/agent-release-review';
import { AgentReleaseReview } from './AgentReleaseReview';

const button = 'min-h-10 rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40';

export function AgentReleaseWorkspace({ tenantId, agentId, role }: { tenantId: string; agentId: string; role: string | null | undefined }) {
    const t = useTranslations('agentReleases');
    const [workspace, setWorkspace] = useState<AgentConfigurationWorkspace | null>(null), [items, setItems] = useState<AgentReleaseListItem[]>([]);
    const [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<AgentReleaseDetail | null>(null);
    const [loading, setLoading] = useState(true), [reading, setReading] = useState(false), [busy, setBusy] = useState(false);
    const [listUnavailable, setListUnavailable] = useState(false);
    const [error, setError] = useState(''), [notice, setNotice] = useState('');
    const mounted = useRef(true), loadGeneration = useRef(0), detailGeneration = useRef(0), mutating = useRef(false);
    const request = useRef<ReleaseCommandAttempt<AgentReleaseRequest> | null>(null), review = useRef<ReleaseCommandAttempt<AgentReleaseReviewRequest> | null>(null);
    const load = useCallback(async () => {
        const generation = ++loadGeneration.current; setLoading(true); setError('');
        const rows = await Promise.allSettled([api.getAgentConfiguration(tenantId, agentId), api.getAgentReleases(tenantId, agentId)]);
        if (!mounted.current || generation !== loadGeneration.current) return;
        const config = rows[0].status === 'fulfilled' && rows[0].value.success ? rows[0].value.data ?? null : null;
        const list = rows[1].status === 'fulfilled' && rows[1].value.success ? rows[1].value.data ?? null : null;
        setWorkspace(config); setItems(list ?? []);
        setListUnavailable(list === null);
        if (!config || !list) setError(t('unavailable'));
        if (list) setSelected(current => current && list.some(row => row.id === current) ? current : list[0]?.id ?? null);
        setLoading(false);
        return list;
    }, [tenantId, agentId, t]);
    const read = useCallback(async (candidateId: string) => {
        const generation = ++detailGeneration.current; setReading(true); setDetail(null);
        try {
            const result = await api.getAgentRelease(tenantId, agentId, candidateId);
            if (!mounted.current || generation !== detailGeneration.current) return;
            if (result.success && result.data?.id === candidateId && result.data.agentId === agentId) setDetail(result.data);
            else setError(t(releaseErrorKind(result.errorCode)));
        } catch { if (mounted.current && generation === detailGeneration.current) setError(t('unavailable')); }
        finally { if (mounted.current && generation === detailGeneration.current) setReading(false); }
    }, [tenantId, agentId, t]);
    useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; loadGeneration.current++; detailGeneration.current++; }; }, [load]);
    useEffect(() => {
        review.current = null; detailGeneration.current++; setDetail(null);
        if (selected) void read(selected); else setReading(false);
    }, [selected, read]);
    const refresh = async () => { const list = await load(); if (selected && list?.some(row => row.id === selected) && mounted.current) await read(selected); };
    const prepare = async () => {
        if (!workspace || mutating.current || !isAdmin(role)) return;
        mutating.current = true; setBusy(true); setError(''); setNotice('');
        try {
            request.current = prepareReleaseRequest(workspace, request.current);
            const result = await api.prepareAgentRelease(tenantId, agentId, request.current.body);
            if (!mounted.current) return;
            if (!result.success || !result.data) { setError(t(releaseErrorKind(result.errorCode))); return; }
            const id = result.data.id;
            setNotice(t('requested')); await load(); setSelected(id); if (selected === id) await read(id);
        } catch { if (mounted.current) setError(t('unavailable')); }
        finally { mutating.current = false; if (mounted.current) setBusy(false); }
    };
    const decide = async (decision: 'approve' | 'reject', checks: ReleaseReviewChecks, seen: string[]) => {
        if (!detail || mutating.current) return;
        mutating.current = true; setBusy(true); setError(''); setNotice('');
        try {
            review.current = prepareReleaseReview(detail, role, decision, checks, seen, review.current);
            const result = await api.reviewAgentRelease(tenantId, agentId, detail.id, review.current.body);
            if (!mounted.current) return;
            if (!result.success || !result.data) {
                setError(t(releaseErrorKind(result.errorCode)));
                if (releaseErrorKind(result.errorCode) === 'changed') { setDetail(null); detailGeneration.current++; }
                return;
            }
            setNotice(t(decision === 'approve' ? 'approvedNotice' : 'rejectedNotice'));
            setDetail(result.data); await load();
        } catch { if (mounted.current) setError(t('unavailable')); }
        finally { mutating.current = false; if (mounted.current) setBusy(false); }
    };
    return <main className="mx-auto max-w-6xl space-y-6 p-6"><div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/admin/agent/${agentId}`} className={button}>{t('back')}</Link><button type="button" disabled={busy || loading || reading} className={button} onClick={() => void refresh()}>{t('refresh')}</button></div>
        <header><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="mt-2 text-neutral-600 dark:text-neutral-300">{t('intro')}</p></header>
        {error && <p role="alert" className="rounded-lg border border-red-400 p-3">{error}</p>}{notice && <p role="status">{notice}</p>}
        <section className="space-y-3 rounded-xl border bg-white p-5 dark:bg-neutral-900"><h2 className="font-semibold">{t('prepareTitle')}</h2>
            <p className="text-sm">{t('prepareHelp')}</p><p>{loading ? t('loading') : workspace?.evaluationRevisionId ? t('currentDraft') : t('draftRequired')}</p>
            {isAdmin(role) && <button type="button" className={`${button} border-indigo-500`} disabled={busy || loading || !workspace?.evaluationRevisionId} onClick={() => void prepare()}>{t(busy ? 'saving' : 'prepare')}</button>}
        </section>
        <div className="grid gap-5 lg:grid-cols-[240px_1fr]"><section className="h-fit rounded-xl border bg-white p-4 dark:bg-neutral-900"><h2 className="mb-3 font-semibold">{t('listTitle')}</h2>
            {loading ? <p role="status">{t('loading')}</p> : listUnavailable ? <p>{t('unavailable')}</p> : !items.length ? <p>{t('noCandidates')}</p> : <ul className="space-y-2">{items.map(item => <li key={item.id}>
                <button type="button" className={`${button} w-full text-left ${selected === item.id ? 'border-indigo-500' : ''}`} aria-pressed={selected === item.id} disabled={busy} onClick={() => { setError(''); setNotice(''); setSelected(item.id); }}>
                    <span className="block">{t('candidateReference', { reference: item.id.slice(0, 8) })}</span><span className="text-xs">{t(t.has(`states.${item.status}`) ? `states.${item.status}` : 'unknown')} · {t('version', { version: item.version })}</span>
                </button></li>)}</ul>}
        </section>{reading ? <p role="status" className="p-5">{t('loading')}</p> : detail && detail.id === selected ? <AgentReleaseReview key={`${detail.id}:${detail.version}:${detail.review?.evidenceHash ?? detail.revisionState}`}
            candidate={detail} role={role} busy={busy} decide={decide} /> : <p className="p-5">{t('selectCandidate')}</p>}</div>
    </main>;
}
