"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { ChevronDown, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    actAndReloadToolApprovals, approvalActions, approvalDomainStates, approvalExecutionState, approvalsForConversation, canReviewToolApprovals,
    isTechnicalReference, normalizeApprovalArgument, safeApprovalDetails, TOOL_ARGUMENT_GROUPS,
    type ToolApprovalAction, type ToolApprovalItem,
} from '@/lib/tool-approvals';

const EXECUTION_STYLES: Record<string, string> = {
    succeeded: 'text-emerald-700 dark:text-emerald-300',
    failed: 'text-red-700 dark:text-red-300',
    reconciliation: 'text-amber-700 dark:text-amber-300',
};

/** Pure review surface exported separately so role, result and translation
 * contracts can be verified without substituting a fake network or DOM. */
export function ToolApprovalReviewCard({ ticket, role, verified, busy, onAction }: {
    ticket: ToolApprovalItem; role?: string | null; verified: boolean; busy: boolean;
    onAction: (ticket: ToolApprovalItem, action: ToolApprovalAction, reason?: string) => Promise<void>;
}) {
    const t = useTranslations('toolApprovals');
    const locale = useLocale();
    const [reason, setReason] = useState('');
    const [reviewed, setReviewed] = useState(false);
    const actions = approvalActions(ticket, role);
    const validityUnknown = !Number.isFinite(Date.parse(ticket.expiresAt));
    const execution = approvalExecutionState(ticket);
    const errorCode = ticket.executionErrorCode || ticket.resumeError || (typeof ticket.resumeResult?.error === 'string' ? ticket.resumeResult.error : null);
    const request = safeApprovalDetails(ticket.request || {}) as Record<string, unknown>;
    const knownKeys = Object.values(TOOL_ARGUMENT_GROUPS).flat();
    const entries = Object.entries(request);
    const unknown = entries.filter(([key]) => !knownKeys.includes(normalizeApprovalArgument(key)));
    const title = t.has(`tools.${ticket.toolName}`) ? t(`tools.${ticket.toolName}`) : t('unknownTool');
    const date = (value: string | null) => {
        if (!value || !Number.isFinite(Date.parse(value))) return t('unknownDate');
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    };
    const value = (input: unknown): React.ReactNode => {
        if (input == null || input === '') return <span className="text-muted-foreground">{t('notProvided')}</span>;
        if (typeof input === 'boolean') return t(input ? 'yes' : 'no');
        if (isTechnicalReference(input)) return <span title={t('referenceHint')}>{t('reference', { reference: input.slice(0, 8) })}</span>;
        if (Array.isArray(input)) return <ul className="space-y-1 list-disc pl-4">{input.map((entry, index) => <li key={index}>{value(entry)}</li>)}</ul>;
        if (typeof input === 'object') {
            const details = Object.entries(input);
            const known = details.filter(([key]) => knownKeys.includes(normalizeApprovalArgument(key)));
            return <dl className="space-y-1">{known.map(([key, entry]) => <div key={key}>
                <dt className="text-xs text-muted-foreground">{t(`arguments.${normalizeApprovalArgument(key)}`)}</dt><dd>{value(entry)}</dd>
            </div>)}{known.length !== details.length && <p className="text-xs text-muted-foreground">{t('additionalDetails')}</p>}</dl>;
        }
        return <span className="whitespace-pre-wrap break-words">{String(input)}</span>;
    };
    const canAct = actions.approve || actions.reject || actions.resume;
    if (!canReviewToolApprovals(role)) return null;
    return <article className="rounded-xl border border-border bg-card p-3 text-sm" aria-label={title}>
        <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
                <h4 className="font-semibold">{title}</h4>
                <p className="mt-1 text-xs text-muted-foreground">{t(ticket.kind === 'draft_action' ? 'kind.draft_action' : 'kind.policy')}</p>
            </div>
            <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{t(`approval.${actions.expired && !validityUnknown && ticket.status === 'pending' ? 'expired' : ticket.status}`)}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{t('requestedAt', { date: date(ticket.requestedAt) })}</span>
            <span>{t('expiresAt', { date: date(ticket.expiresAt) })}</span>
            {ticket.agentVersion != null && <span>{t('agentVersion', { version: ticket.agentVersion })}</span>}
            {isTechnicalReference(ticket.agentId) && <Link className="underline" href={`/admin/agent/${ticket.agentId}`}>{t('openAgent')}</Link>}
        </div>
        {actions.expired && !['succeeded','processing','reconciliation'].includes(execution) &&
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t(validityUnknown ? 'validityUnknown' : 'reviewExpired')}</p>}
        <h5 className="mt-3 font-medium text-xs">{t('proposedArguments')}</h5>
        {entries.length === 0 && <p className="mt-1 text-xs text-muted-foreground">{t('noArguments')}</p>}
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {Object.entries(TOOL_ARGUMENT_GROUPS).map(([group, keys]) => {
                const fields = entries.filter(([key]) => keys.includes(normalizeApprovalArgument(key)));
                return fields.length ? <div key={group} className="min-w-0 rounded-lg bg-muted/40 p-2">
                    <h6 className="mb-1 text-xs font-semibold">{t(`groups.${group}`)}</h6>
                    <dl className="space-y-2">{fields.map(([key, entry]) => <div key={key}>
                        <dt className="text-xs text-muted-foreground">{t(`arguments.${normalizeApprovalArgument(key)}`)}</dt>
                        <dd className="mt-0.5">{value(entry)}</dd>
                    </div>)}</dl>
                </div> : null;
            })}
        </div>
        {!!unknown.length && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t('reviewAdditional', { count: unknown.length })}</p>}
        <details className="mt-2 rounded-lg border border-border p-2 text-xs">
            <summary className="cursor-pointer font-medium">{t('exactDetails')}</summary>
            <p className="mt-2 text-muted-foreground">{t('technicalDetailsHint')}</p>
            <p className="mt-2">{t('technicalTool')}: <code>{ticket.toolName}</code></p>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(request, null, 2)}</pre>
        </details>
        <div className={cn('mt-3 rounded-lg bg-muted/30 p-2', EXECUTION_STYLES[execution])} role="status">
            <p className="font-medium">{t(`execution.${execution}`)}</p>
            <p className="mt-1 text-xs">{t(`executionHelp.${execution}`)}</p>
            {errorCode && <p className="mt-1 text-xs">{t.has(`errors.${errorCode}`) ? t(`errors.${errorCode}`) : t('operationError')}</p>}
            {approvalDomainStates(ticket).map(state => <p key={state} className="mt-1 text-xs font-medium">
                {t('businessState', { state: t.has(`domainStates.${state}`) ? t(`domainStates.${state}`) : t('unknownBusinessState') })}
            </p>)}
            {ticket.resumedAt && <p className="mt-1 text-xs text-muted-foreground">{t('resumedAt', { date: date(ticket.resumedAt) })}</p>}
        </div>
        {ticket.decidedAt && <p className="mt-2 text-xs text-muted-foreground">{t('decidedAt', { date: date(ticket.decidedAt) })}</p>}
        {ticket.decisionReason && <p className="mt-1 text-xs whitespace-pre-wrap break-words">{t('decisionReason')}: {ticket.decisionReason}</p>}
        {ticket.resumeResult && <details className="mt-2 text-xs">
            <summary className="cursor-pointer font-medium">{t('resultDetails')}</summary>
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-muted p-2 whitespace-pre-wrap break-words">{JSON.stringify(safeApprovalDetails(ticket.resumeResult), null, 2)}</pre>
        </details>}
        {canAct && <div className="mt-3 space-y-2 border-t border-border pt-3" data-tour-form="tool-approval">
            {(actions.approve || actions.reject) && <label className="block text-xs">
                {t('reviewNote')}
                <textarea value={reason} onChange={event => setReason(event.target.value)} disabled={busy || !verified}
                    maxLength={1000} rows={2} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm disabled:opacity-50" />
            </label>}
            {(actions.approve || actions.resume) && <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={busy || !verified} className="mt-0.5" />
                <span>{t('reviewed')}</span>
            </label>}
            <div className="flex flex-wrap gap-2">
                {actions.approve && <button type="button" disabled={!reviewed || busy || !verified}
                    onClick={() => void onAction(ticket, 'approved', reason)} className="min-h-10 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? t('working') : t('approve')}</button>}
                {actions.reject && <button type="button" disabled={busy || !verified}
                    onClick={() => void onAction(ticket, 'rejected', reason)} className="min-h-10 rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50">{t('reject')}</button>}
                {actions.resume && <button type="button" disabled={!reviewed || busy || !verified}
                    onClick={() => void onAction(ticket, 'resume', reason)} className="min-h-10 rounded-lg border border-indigo-500 px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-300 disabled:opacity-50">{busy ? t('working') : t('resume')}</button>}
            </div>
        </div>}
    </article>;
}

export function ToolApprovalsPanel({ tenantId, conversationId, role, refreshVersion = 0 }: {
    tenantId: string; conversationId: string; role?: string | null; refreshVersion?: number;
}) {
    const t = useTranslations('toolApprovals');
    const [items, setItems] = useState<ToolApprovalItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [verified, setVerified] = useState(false);
    const [error, setError] = useState(false);
    const [uncertain, setUncertain] = useState(false);
    const [busy, setBusy] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const requestNumber = useRef(0);
    const active = useRef(true);
    const scope = `${tenantId}:${conversationId}`;
    const currentScope = useRef(scope);
    currentScope.current = scope;
    const renderedScope = useRef(scope);
    const busyRef = useRef(false);
    const allowed = canReviewToolApprovals(role);
    const load = useCallback(async () => {
        if (!allowed || busyRef.current) return;
        const number = ++requestNumber.current;
        setLoading(true); setVerified(false); setError(false);
        try {
            const response = await api.getToolApprovals(tenantId, conversationId);
            if (!response.success || !Array.isArray(response.data)) throw new Error('approval_list_unavailable');
            if (!active.current || currentScope.current !== scope || number !== requestNumber.current) return;
            const fresh = approvalsForConversation(response.data, conversationId);
            setItems(fresh); setVerified(true); renderedScope.current = scope;
            if (fresh.some(item => item.status === 'pending')) setExpanded(true);
        } catch {
            if (active.current && currentScope.current === scope && number === requestNumber.current) setError(true);
        } finally {
            if (active.current && currentScope.current === scope && number === requestNumber.current) setLoading(false);
        }
    }, [allowed, conversationId, tenantId, scope]);
    useEffect(() => { active.current = true; return () => { active.current = false; requestNumber.current++; }; }, []);
    useEffect(() => { void load(); }, [load, refreshVersion]);
    // Expiry is a UI constraint too. Refresh an open queue while a workflow runs,
    // and after reconnection/focus; every response remains server authoritative.
    useEffect(() => {
        if (!allowed) return;
        const refresh = () => { if (!busyRef.current && document.visibilityState !== 'hidden') void load(); };
        window.addEventListener('focus', refresh);
        const timer = window.setInterval(refresh, 30000);
        return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
    }, [allowed, load]);
    const act = async (ticket: ToolApprovalItem, action: ToolApprovalAction, reason?: string) => {
        if (busyRef.current || !verified || !allowed || currentScope.current !== scope) return;
        busyRef.current = true; setBusy(true); setVerified(false); setUncertain(false); setError(false);
        ++requestNumber.current;
        try {
            const result = await actAndReloadToolApprovals(api, tenantId, conversationId, ticket, action, role, reason);
            if (!active.current || currentScope.current !== scope) return;
            setItems(result.items); setVerified(true); setUncertain(!result.acknowledged); renderedScope.current = scope;
        } catch {
            if (active.current && currentScope.current === scope) setError(true);
        } finally {
            busyRef.current = false;
            if (active.current && currentScope.current === scope) setBusy(false);
        }
    };
    if (!allowed) return null;
    const visible = renderedScope.current === scope ? items : [];
    const pending = visible.filter(item => item.status === 'pending' && !approvalActions(item, role).expired).length;
    return <section className="shrink-0 border-b border-border bg-muted/20 px-3 py-2 md:px-6" aria-label={t('title')}>
        <div className="flex items-center gap-2">
            <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}
                className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium">
                <ShieldCheck size={16} className="shrink-0 text-indigo-500" /><span>{t('title')}</span>
                {!!pending && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">{t('pendingCount', { count: pending })}</span>}
                <ChevronDown size={15} className={cn('ml-auto shrink-0 transition-transform', expanded && 'rotate-180')} />
            </button>
            <button type="button" onClick={() => void load()} disabled={loading || busy} aria-label={t('refresh')}
                className="min-h-9 rounded-lg px-2 disabled:opacity-50">{loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}</button>
        </div>
        {error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{t('verificationError')}</p>}
        {uncertain && <p role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t('mutationUncertain')}</p>}
        {expanded && <div className="mt-2 max-h-[45vh] overflow-auto space-y-3 pb-2">
            <p className="text-xs text-muted-foreground">{t('explanation')}</p>
            {loading && <p role="status" className="text-xs text-muted-foreground">{t('loading')}</p>}
            {!loading && !error && !visible.length && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
            {visible.map(ticket => <ToolApprovalReviewCard key={`${ticket.id}:${ticket.status}:${ticket.resumeState}:${ticket.executionStatus}:${JSON.stringify(ticket.request)}`}
                ticket={ticket} role={role} verified={verified && !loading} busy={busy} onAction={act} />)}
            {visible.length >= 100 && <p className="text-xs text-muted-foreground">{t('limitReached')}</p>}
        </div>}
    </section>;
}
