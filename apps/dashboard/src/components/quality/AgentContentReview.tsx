"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentContentProposal, AppliedAgentContentObject } from '@parallext/shared';
import { api } from '@/lib/api';

/**
 * A content object Assist proposes to create, before it exists.
 *
 * The configuration review beside this one shows a diff: a value, and the value
 * it replaces. A creation has no `before`, and rendering an empty column would
 * read as "this field is being cleared". So the card says the object does not
 * exist yet in words, and then lists exactly what will be written.
 *
 * Nothing here reaches a customer. The four executable operations write a row
 * the tenant reviews on `route`, and the API refuses to type anything that
 * sends, publishes or charges as executable at all — an operation like that is
 * declared as a route to the screen that owns it, with its reason.
 */
export function AgentContentReview({ tenantId, proposal, onApplied }: {
    tenantId: string;
    proposal: AgentContentProposal;
    onApplied?: (result: AppliedAgentContentObject) => void;
}) {
    const t = useTranslations('agentContent');
    const [current, setCurrent] = useState(proposal);
    const [result, setResult] = useState<AppliedAgentContentObject | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const expired = current.status === 'expired' || (current.status === 'proposed'
        && Date.parse(current.expiresAt) <= Date.now());
    const applied = current.status === 'applied' || !!result;

    const apply = async () => {
        setBusy(true); setError('');
        try {
            // The digest travels back exactly as it arrived: it is what says the
            // person approved THIS content and not a proposal that moved.
            const response = await api.applyAgentContent(tenantId, current.id, current.digest);
            if (!response?.success || !response.data) { setError(response?.errorCode || 'apply_failed'); return; }
            setResult(response.data);
            setCurrent(response.data.proposal);
            onApplied?.(response.data);
        } catch { setError('apply_failed'); }
        finally { setBusy(false); }
    };

    return <section className="mt-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        {/* The operation key contains dots and next-intl reads a dot as a
            path separator, so `knowledge.faq.create` would be looked up as
            three nested objects and never found. Same substitution the
            configuration review makes for its field paths. */}
        <h3 className="font-semibold">{t(`operations.${current.operation.replace(/\./g, '_')}`)}</h3>
        {/* "Does not exist yet" said outright, because an empty before-column
            reads as a field being cleared rather than an object being made. */}
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{t('willCreate')}</p>

        <dl className="mt-3 space-y-2 text-sm">
            {current.preview.after.map(field => <div key={field.field} className="grid gap-0.5">
                <dt className="text-xs font-medium text-neutral-500">
                    {t.has(`fields.${field.field}`) ? t(`fields.${field.field}`) : field.field}
                </dt>
                <dd className="whitespace-pre-wrap break-words">{String(field.value)}</dd>
            </div>)}
        </dl>

        {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.apply_failed')}
        </p>}

        {result && <div className="mt-3 space-y-1 text-sm">
            <p role="status" className="text-emerald-700 dark:text-emerald-400">
                {t(result.outcome === 'replayed' ? 'replayed' : 'created')}
            </p>
            {/* Written is not reviewed. The object exists; whether it says the
                right thing is a person's judgement, on its own screen. */}
            {result.verification === 'unavailable' && <p role="status" className="text-amber-700 dark:text-amber-400">
                {t.has(`verification.${result.verificationReason}`)
                    ? t(`verification.${result.verificationReason}`) : t('verification.unavailable')}
            </p>}
            {result.object && <a href={result.object.route}
                className="inline-flex min-h-10 items-center rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700">
                {t('reviewObject')}
            </a>}
        </div>}

        {expired && !applied && <p role="status" className="mt-3 text-sm text-amber-700 dark:text-amber-400">{t('expired')}</p>}

        {!applied && !expired && <button type="button" disabled={busy} onClick={() => void apply()}
            className="mt-3 min-h-10 rounded-lg bg-indigo-600 px-3 py-2 font-medium text-white disabled:opacity-50">
            {busy ? t('applying') : t('apply')}
        </button>}
    </section>;
}
