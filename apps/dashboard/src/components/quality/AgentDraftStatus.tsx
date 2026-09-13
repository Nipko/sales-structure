'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { AgentConfigurationWorkspace, DiscardAgentDraftRequest } from '@parallext/shared';
import { agentDraftTestHref } from '@/lib/agent-draft-save';
import { api } from '@/lib/api';
import { useRole } from '@/hooks/useRole';

export function AgentDraftStatus({ workspace, tenantId }: { workspace: AgentConfigurationWorkspace | null; tenantId?: string | null }) {
    const t = useTranslations('agentDraft');
    const { role } = useRole();
    const [busy, setBusy] = useState(false), [error, setError] = useState(false);
    const request = useRef<DiscardAgentDraftRequest | null>(null);
    const discard = async () => {
        if (!tenantId || !workspace?.draft || busy) return;
        setBusy(true); setError(false);
        if (request.current?.expectedDraftRevision !== workspace.draft.id || request.current?.expectedOperationalHash !== workspace.operational.hash)
            request.current = { requestKey: crypto.randomUUID(), expectedDraftRevision: workspace.draft.id,
                expectedOperationalVersion: workspace.operational.version, expectedOperationalHash: workspace.operational.hash };
        try {
            const result = await api.discardAgentDraft(tenantId, workspace.agentId, request.current!);
            if (!result.success || !result.data || result.data.draft) throw new Error('draft_changed');
            window.location.reload();
        } catch { setError(true); } finally { setBusy(false); }
    };
    if (!workspace) return <div role="alert" className="mb-4 rounded-xl border border-amber-300 p-4 text-sm">{t('loadUnavailable')}</div>;
    const stale = workspace.draft && !workspace.draft.currentBase;
    return <section aria-label={t('title')} className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm dark:border-indigo-700 dark:bg-indigo-950">
        <h2 className="font-semibold">{t('title')}</h2>
        <p className="mt-1">{t('operationalVersion', { version: workspace.operational.version })} · {t(workspace.operational.body.isActive ? 'operationalActive' : 'operationalInactive')}</p>
        <p className="mt-1 font-medium">{t(workspace.draft ? 'draftPrepared' : 'noDraft')}</p>
        <p className="mt-1">{t('saveHint')}</p>
        {stale && <p role="alert" className="mt-2 text-amber-800 dark:text-amber-200">{t('baseChanged')}</p>}
        {workspace.evaluationRevisionId && <Link className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-indigo-400 px-3 py-2 font-medium" href={agentDraftTestHref(workspace)}>{t('testDraft')}</Link>}
        {workspace.draft && tenantId && ['tenant_admin', 'super_admin'].includes(role ?? '') && <div className="mt-3 border-t border-indigo-200 pt-3 dark:border-indigo-700">
            <p className="text-xs">{t('discardHint')}</p>
            <button type="button" disabled={busy} onClick={() => void discard()} className="mt-2 min-h-10 rounded-lg border border-current px-3 py-2 disabled:opacity-50">{t(busy ? 'discarding' : 'discard')}</button>
        </div>}
        {error && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{t('discardError')}</p>}
    </section>;
}
