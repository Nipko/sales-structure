"use client";
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

type FundingNumber = { channelAccountId: string; displayName?: string; wabaId?: string;
    state: 'not_checked'|'attached'|'absent'|'restricted'|'unknown'; checkedAt?: string };

export function WhatsappFundingPanel({ canCheck }: { canCheck: boolean }) {
    const t = useTranslations('whatsappFunding');
    const [numbers, setNumbers] = useState<FundingNumber[]>([]);
    const [error, setError] = useState(false);
    const [checking, setChecking] = useState<string | null>(null);
    const load = async () => {
        try {
            const result = await api.getWhatsappFundingReadiness();
            if (!result.success || !result.data) throw new Error();
            setNumbers(result.data.numbers); setError(false);
        } catch { setError(true); }
    };
    useEffect(() => { void load(); }, []);
    const check = async (phoneNumberId: string) => {
        setChecking(phoneNumberId);
        try {
            const result = await api.checkWhatsappFunding(phoneNumberId);
            if (!result.success) throw new Error();
            await load();
        } catch { setError(true); }
        finally { setChecking(null); }
    };
    return <section className="rounded-xl border border-[var(--border)] p-5 space-y-3">
        <h2 className="font-semibold">{t('title')}</h2>
        <p className="text-sm">{t('separation')}</p>
        <ol className="list-decimal pl-5 text-sm space-y-1">
            <li>{t('step1')}</li><li>{t('step2')}</li><li>{t('step3')}</li>
        </ol>
        <a className="inline-block underline" href="https://business.facebook.com/wa/manage/home/" target="_blank" rel="noopener noreferrer">{t('openMeta')}</a>
        <p className="text-sm">{t('allowance')}</p>
        {error && <p role="alert">{t('error')} <button className="underline" onClick={() => void load()}>{t('reload')}</button></p>}
        <ul className="space-y-3">{numbers.map(number => <li key={number.channelAccountId} className="border-t pt-3">
            <p>{number.displayName || number.channelAccountId} · {t('waba')}: {number.wabaId || t('unknown')}</p>
            <p role="status" className="text-sm">{t(number.state)}</p>
            {number.checkedAt && <p className="text-xs">{t('checked')}: {new Date(number.checkedAt).toLocaleString()}</p>}
            {canCheck && <button type="button" disabled={checking !== null} className="underline disabled:opacity-50"
                onClick={() => void check(number.channelAccountId)}>{checking === number.channelAccountId ? t('checking') : t('check')}</button>}
        </li>)}</ul>
    </section>;
}
