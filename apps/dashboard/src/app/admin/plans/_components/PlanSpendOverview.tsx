"use client";
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
export function PlanSpendOverview() {
    const t=useTranslations('plansPage');
    const [data,setData]=useState<any>(null);
    const [error,setError]=useState(false);
    const load=async()=>{try{const res=await api.getAdminLlmSpend();if(!res.success)throw new Error();setData(res.data);setError(false);}catch{setError(true);}};
    useEffect(()=>{void load();},[]);
    return <section className="mt-6 rounded-xl border p-4 space-y-3">
        <div className="flex gap-4 justify-between"><h2 className="font-semibold">{t('spendTitle')} {data?.month}</h2>
            <button className="underline" onClick={()=>void load()}>{t('spendRefresh')}</button></div>
        <p className="text-sm">{t('spendExplanation')}</p>
        {error && <p role="alert">{t('saveError')}</p>}
        <div className="overflow-x-auto"><table className="w-full text-sm text-left">
            <thead><tr>{['spendTenant','spendUsed','spendCeiling','spendUnknown'].map(key=><th className="p-2" key={key}>{t(key)}</th>)}</tr></thead>
            <tbody>{data?.tenants?.map((row:any)=><tr key={row.tenantId} className="border-t">
                <td className="p-2">{row.name} · {row.plan}</td>
                <td className="p-2">{row.initialized ? `$${(row.accountedUsdCents/100).toFixed(4)}` : '—'}</td>
                <td className="p-2">{row.ceilingUsdCents < 0 ? t('unlimited') : `$${(row.ceilingUsdCents/100).toFixed(2)}`}</td>
                <td className="p-2">{row.unresolved}</td>
            </tr>)}</tbody>
        </table></div>
    </section>;
}
