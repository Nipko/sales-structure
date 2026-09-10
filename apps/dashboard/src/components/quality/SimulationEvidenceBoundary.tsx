"use client";

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

export type SimulationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'retired';

/** Hide cached evidence while authority is unknown or the source was withdrawn. */
export function SimulationEvidenceBoundary({ status, loading, error, retry, children }: {
    status?: SimulationStatus; loading: boolean; error: boolean; retry: () => void; children: ReactNode;
}) {
    const t = useTranslations('simulation');
    if (status === 'retired') return <div role="status" className="rounded-xl border border-neutral-200 dark:border-white/10 p-6 space-y-2">
        <h3 className="font-semibold">{t('status_retired')}</h3><p className="text-sm text-text-secondary">{t('retiredHint')}</p>
    </div>;
    if (loading) return <p role="status" className="flex items-center gap-2 p-6 text-sm"><Loader2 size={16} className="animate-spin" />{t('loadingResults')}</p>;
    if (error) return <div role="alert" className="p-6 space-y-3"><p>{t('loadResultsError')}</p><button onClick={retry} className="underline">{t('retry')}</button></div>;
    return <>{children}</>;
}

export function SimulationRetirement({ status, role, busy, error, retire }: {
    status: SimulationStatus; role?: string; busy: boolean; error: boolean; retire: () => void;
}) {
    const t = useTranslations('simulation');
    const [confirming, setConfirming] = useState(false);
    if (status === 'retired' || !['super_admin','tenant_admin','tenant_supervisor'].includes(role || '')) return null;
    return <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-4 space-y-3">
        <p className="text-sm text-text-secondary">{t('retireHint')}</p>
        {error && <p role="alert" className="text-sm text-red-500">{t('retireError')}</p>}
        {confirming ? <div role="group" aria-label={t('retireConfirm')} className="space-y-3">
            <p className="text-sm font-medium">{t('retireConfirm')}</p>
            <div className="flex gap-4"><button disabled={busy} onClick={retire} className="text-sm text-red-600 disabled:opacity-50">{t(busy ? 'retiring' : 'retireConfirmButton')}</button>
                <button disabled={busy} onClick={() => setConfirming(false)} className="text-sm underline">{t('keepRun')}</button></div>
        </div> : <button onClick={() => setConfirming(true)} className="text-sm underline">{t('retireRun')}</button>}
    </div>;
}
