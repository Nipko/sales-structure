'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { readQualitySampling, type QualitySamplingReport } from '@/lib/quality-sampling';

export function QualitySamplingEvidence({report}:{report:QualitySamplingReport}) {
    const t=useTranslations('qualitySampling');
    if (report.state==='not_captured') return <p className="text-sm text-muted-foreground">{t('notCaptured')}</p>;
    return <div className="space-y-3">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{(['eligible','selected','queued','pending','failed','erased'] as const).map(key=><div key={key}>
            <dt className="text-xs text-muted-foreground">{t(key)}</dt><dd className="text-lg font-semibold">{report[key]}</dd>
        </div>)}</dl>
        <p className="text-xs text-muted-foreground">{t('queueEvidence')}</p>
        {(report.failed||0)>0&&<p className="text-sm text-amber-700 dark:text-amber-300">{t('failedHelp')}</p>}
    </div>;
}

export default function QualitySamplingCard({tenantId}:{tenantId:string}) {
    const t=useTranslations('qualitySampling');
    const [day,setDay]=useState(()=>new Date(Date.now()-86_400_000).toISOString().slice(0,10));
    const [retry,setRetry]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(false);
    const [report,setReport]=useState<QualitySamplingReport|null>(null);
    const sequence=useRef(0);
    useEffect(()=>{
        const request=++sequence.current;
        setLoading(true);setError(false);setReport(null);
        void readQualitySampling(()=>api.getQualitySampling(tenantId,day)).then(data=>{
            if(sequence.current===request)setReport(data);
        }).catch(()=>{if(sequence.current===request)setError(true);})
            .finally(()=>{if(sequence.current===request)setLoading(false);});
        return()=>{sequence.current++;};
    },[tenantId,day,retry]);
    return <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-label={t('title')}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{t('title')}</h3>
            <label className="text-xs">{t('day')}<input type="date" value={day} onChange={event=>{if(event.target.value)setDay(event.target.value);}}
                className="ml-2 min-h-10 rounded-lg border border-border bg-background px-2" /></label></div>
        <p className="text-sm text-muted-foreground">{t('method')}</p>
        {loading&&<p role="status" className="text-sm">{t('loading')}</p>}
        {error&&<div role="alert" className="space-y-2 text-sm"><p>{t('unavailable')}</p>
            <button className="min-h-10 rounded-lg border border-border px-3" onClick={()=>setRetry(value=>value+1)}>{t('retry')}</button></div>}
        {report&&<QualitySamplingEvidence report={report}/>}
    </section>;
}
