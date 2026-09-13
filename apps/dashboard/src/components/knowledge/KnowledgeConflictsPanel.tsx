"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { api } from '@/lib/api';
import { actAndReloadKnowledgeConflicts, readKnowledgeConflicts, allowedConflictDecisions, conflictAgentScope, type KnowledgeConflictCase, type KnowledgeConflictDecision,
    type KnowledgeConflictOverview, type KnowledgeConflictReview } from '@/lib/knowledge-conflicts';

const button='min-h-10 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';

export function KnowledgeConflictCard({item,agents,busy,verified,onReview}:{item:KnowledgeConflictCase;agents:Array<{id:string;name:string}>;
    busy:boolean;verified:boolean;onReview:(id:string,input:KnowledgeConflictReview)=>Promise<void>}) {
    const t=useTranslations('knowledgeConflicts');
    const locale=useLocale();
    const choices=conflictAgentScope(item.sourceA,item.sourceB);
    const [agentId,setAgentId]=useState<string|null>(choices[0]??null);
    const [decision,setDecision]=useState<KnowledgeConflictDecision|''>('');
    const [reason,setReason]=useState('');
    const [checked,setChecked]=useState(false);
    const country=item.sourceA.regulated?item.sourceA.jurisdiction:item.sourceB.regulated?item.sourceB.jurisdiction:null;
    const countryName=country?new Intl.DisplayNames([locale],{type:'region'}).of(country)||country:t('allCountries');
    const sourceHref=(kind:string)=>kind==='document'?'/admin/knowledge':kind==='faq'?'/admin/knowledge/faqs':kind==='policy'?'/admin/settings/policies':'/admin/settings/business-info';
    const options=allowedConflictDecisions(item);
    const date=(value:string|null)=>value?new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(new Date(value)):t('notSpecified');
    return <article className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{t('potentialConflict')}</h4><span className="text-xs">{t(`states.${item.status}`)}</span></div>
        <p className="text-sm">{item.detail}</p>
        <p className="text-xs text-muted-foreground">{t('quoteEvidenceOnly')}</p>
        <div className="grid gap-3 md:grid-cols-2">{([['A',item.sourceA,item.quoteA],['B',item.sourceB,item.quoteB]] as const).map(([label,source,quote])=><div key={label} className="min-w-0 rounded-lg bg-muted/40 p-3">
            <p className="text-xs font-semibold">{t('sourceLabel',{label,kind:t(`kinds.${source.kind}`)})}</p>
            <p className="mt-1 break-words font-medium">{source.title}</p>
            <blockquote className="my-2 border-l-2 border-indigo-300 pl-3 text-sm whitespace-pre-wrap break-words">{quote}</blockquote>
            <p className="text-xs text-muted-foreground">{t('authority',{authority:source.kind==='document'?(source.authority||t('notSpecified')):t(`kinds.${source.kind}`)})}</p>
            <p className="text-xs text-muted-foreground">{t('validity',{from:date(source.validFrom),to:date(source.validTo)})}</p>
            <Link href={sourceHref(source.kind)} className="mt-2 inline-flex text-xs underline">{t('openSource')}</Link>
            <details className="mt-2 text-xs"><summary className="cursor-pointer">{t('sourceReference')}</summary><p className="mt-1 break-all">{t('revision',{revision:source.revision})}</p><p className="mt-1 break-all">{source.hash}</p></details>
        </div>)}</div>
        {item.suggestion&&<p className="text-sm text-muted-foreground">{item.suggestion}</p>}
        {item.review&&<div className="space-y-1 rounded-lg border border-border p-3 text-xs">
            <p>{t('lastReview',{decision:t(`decisions.${item.review.decision}`),date:date(item.review.createdAt)})}</p>
            <p>{t('scope',{audience:t(`audiences.${item.review.scope.audience}`),country:item.review.scope.jurisdiction?new Intl.DisplayNames([locale],{type:'region'}).of(item.review.scope.jurisdiction)||item.review.scope.jurisdiction:t('allCountries')})}</p>
            <p>{t('reviewedAgent',{agent:item.review.scope.agentId?(agents.find(agent=>agent.id===item.review!.scope.agentId)?.name||t('agentReference',{reference:item.review.scope.agentId.slice(0,8)})):t('allAgents')})}</p>
            <p className="whitespace-pre-wrap break-words">{item.review.reason}</p>
            <details><summary className="cursor-pointer">{t('reviewReference')}</summary><p className="break-all">{t('reviewer',{reference:item.review.actorId})}</p></details>
        </div>}
        {item.status==='stale'?<p className="text-sm text-amber-700 dark:text-amber-300">{t('staleHelp')}</p>:<fieldset disabled={busy||!verified} data-tour-form="knowledge-conflict" className="space-y-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">{t('reviewHelp')}</p>
            <label className="block text-sm">{t('decision')}<select value={decision} onChange={event=>setDecision(event.target.value as KnowledgeConflictDecision)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2">
                <option value="">{t('chooseDecision')}</option>{options.map(value=><option key={value} value={value}>{t(`decisions.${value}`)}</option>)}</select></label>
            <label className="block text-sm">{t('agentScope')}<select value={agentId??''} onChange={event=>setAgentId(event.target.value||null)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2">
                {choices.map(id=><option key={id??'all'} value={id??''}>{id?(agents.find(agent=>agent.id===id)?.name||t('agentReference',{reference:id.slice(0,8)})):t('allAgents')}</option>)}</select></label>
            <p className="text-xs">{t('scope',{audience:t(`audiences.${item.sourceA.audience}`),country:countryName})}</p>
            <label className="block text-sm">{t('reason')}<textarea value={reason} maxLength={2000} rows={3} onChange={event=>setReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" /></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={event=>setChecked(event.target.checked)} className="mt-1" />{t('checked')}</label>
            <button className={button} disabled={!checked||reason.trim().length<10||decision===''||!choices.length} onClick={()=>decision!==''&&void onReview(item.id,{revision:item.revision,decision,reason,sourceAHash:item.sourceA.hash,sourceBHash:item.sourceB.hash,scope:{audience:item.sourceA.audience,agentId,jurisdiction:country}})}>{t('saveReview')}</button>
        </fieldset>}
    </article>;
}

export function KnowledgeConflictCoverage({report}:{report:KnowledgeConflictOverview['lastScan']}) {
    const t=useTranslations('knowledgeConflicts');
    if(!report)return <p className="text-sm text-muted-foreground">{t('notScanned')}</p>;
    return <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm" role="status">
        <p className="font-medium">{t(`scanStates.${report.status}`)}</p>
        <p>{t('coverage',{sampled:report.sampledSources,candidates:report.candidatePairs,checked:report.checkedPairs,unknown:report.unknownPairs})}</p>
        <p className="text-xs text-muted-foreground">{t('sampleLimit')}</p>
        <dl className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">{Object.entries(report.sourceCounts).map(([kind,count])=><div key={kind}><dt>{t(`kinds.${kind}`)}</dt><dd>{count===null?t('unavailable'):count}</dd></div>)}</dl>
        {!!report.errors.length&&<p className="text-xs text-amber-700 dark:text-amber-300">{t('partialHelp')}</p>}
    </div>;
}

export function KnowledgeConflictAvailability({error,loading}:{error:string;loading:boolean}) {
    const t=useTranslations('knowledgeConflicts');
    if(error)return <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{t.has(`errors.${error}`)?t(`errors.${error}`):t('errors.requestFailed')}</p>;
    return loading?<p role="status" className="text-sm">{t('loading')}</p>:null;
}

export function KnowledgeConflictsPanel({tenantId,agents}:{tenantId:string;agents:Array<{id:string;name:string}>}) {
    const t=useTranslations('knowledgeConflicts'),locale=useLocale();
    const [data,setData]=useState<KnowledgeConflictOverview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[verified,setVerified]=useState(false);
    const active=useRef(true),revision=useRef(0),lock=useRef(false);
    const refresh=useCallback(async()=>{
        const version=++revision.current;setVerified(false);
        const data=await readKnowledgeConflicts(()=>api.getKnowledgeConflicts(tenantId));
        if(active.current&&version===revision.current){setData(data);setVerified(true);}
    },[tenantId]);
    useEffect(()=>{active.current=true;void refresh().catch(()=>{if(active.current)setError('requestFailed');});return()=>{active.current=false;revision.current++;};},[refresh]);
    const run=async(action?:()=>Promise<{success:boolean;errorCode?:string}>)=>{
        if(lock.current)return;lock.current=true;setBusy(true);setVerified(false);setError('');
        const version=++revision.current;
        try{const result=await actAndReloadKnowledgeConflicts(()=>api.getKnowledgeConflicts(tenantId),action);
            if(active.current&&version===revision.current){setData(result.data);setVerified(true);setError(result.errorCode);}
        }catch{if(active.current)setError('requestFailed');}finally{lock.current=false;if(active.current)setBusy(false);}
    };
    return <section className="mt-5 space-y-4 rounded-xl border border-border bg-card p-5" aria-label={t('title')}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{t('title')}</h3><div className="flex flex-wrap gap-2">
            <button className={button} disabled={busy} onClick={()=>void run()}>{t('refresh')}</button>
            <button className={button} disabled={busy} onClick={()=>void run(()=>api.scanKnowledgeConflicts(tenantId,locale.slice(0,2)))}>{t(busy?'working':'scan')}</button>
        </div></div>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <KnowledgeConflictAvailability error={error} loading={!data}/>
        {data&&<><KnowledgeConflictCoverage report={data.lastScan}/>
            {!data.cases.length&&<p className="text-sm text-muted-foreground">{t('empty')}</p>}
            {data.cases.map(item=><KnowledgeConflictCard key={`${item.id}:${item.revision}:${item.status}`} item={item} agents={agents} busy={busy} verified={verified}
                onReview={(id,input)=>run(()=>api.reviewKnowledgeConflict(tenantId,id,input))}/>)}</>}
    </section>;
}
