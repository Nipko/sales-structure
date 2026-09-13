"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api, type ApiEnvelope } from '@/lib/api';

const field='w-full rounded-lg border bg-transparent p-2 text-sm';
const button='rounded-lg border px-3 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed';
const panel='rounded-xl border bg-white p-5 space-y-4 dark:bg-neutral-900';
type Case= {id:string;state:string;revision:number;sourceState?:string;sourceKind:string;sourceRevision:string;sourceAgentVersion:number;
    scope:any;proposal:any;sourceConfiguration:string};
type Options={profiles:Array<{id:string;intents:Array<{key:string;tools:string[];commits:boolean}>}>;families:Array<{key:string;table:string;executable:boolean}>};
function Label({label,children}:{label:string;children:ReactNode}){return <label className="block space-y-1 text-sm"><span>{label}</span>{children}</label>;}

export function RegressionMetrics({data,unavailable}:{data:any;unavailable:boolean}){
    const t=useTranslations('qualityRegressions');
    if(!data)return <section className={panel}><h2 className="font-semibold">{t('metricsTitle')}</h2><p role="status">{t(unavailable?'metricsUnavailable':'loading')}</p></section>;
    return <section className={panel}><h2 className="font-semibold">{t('metricsTitle')}</h2><p>{t('denominator',{total:data.eligible_turns,observed:data.observed_turns,unknown:data.unobserved_turns})}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('metricsLimits')}</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{t('metricsTitle')}</caption><thead><tr>
            {['mission','language','channel','difficulty','eligible','unknownOutcomes'].map(key=><th className="p-2" scope="col" key={key}>{t(key)}</th>)}
        </tr></thead><tbody>{data.groups.map((row:any,index:number)=><tr key={index} className="border-t">
            <td className="p-2">{row.mission==='unknown'?t('unknown'):row.mission}</td><td className="p-2">{row.language==='unknown'?t('unknown'):row.language}</td>
            <td className="p-2">{row.channel}</td><td className="p-2">{t(`difficulties.${row.difficulty}`)}</td><td className="p-2">{row.eligible_turns}</td><td className="p-2">{row.outcome_unknown_turns}</td>
        </tr>)}</tbody></table></div>{!data.groups.length&&<p>{t('noTurns')}</p>}</section>;
}

export function RegressionWorkspace({tenantId,agentId}:{tenantId:string;agentId:string}){
    const t=useTranslations('qualityRegressions');
    const [cases,setCases]=useState<Case[]>([]),[sources,setSources]=useState<any[]>([]),[options,setOptions]=useState<Options|null>(null);
    const [selected,setSelected]=useState<string|null>(null),[metrics,setMetrics]=useState<any>(null),[metricsUnavailable,setMetricsUnavailable]=useState(false);
    const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
    const generation=useRef(0),mounted=useRef(true),mutation=useRef(false);
    const load=useCallback(async()=>{
        const request=++generation.current;setLoading(true);
        const results=await Promise.allSettled([api.getQualityRegressions(tenantId,agentId),api.getQualityRegressionSources(tenantId,agentId),
            api.getQualityRegressionOptions(tenantId,agentId),api.getAgentMissionMetrics(tenantId,agentId)]);
        if(!mounted.current||request!==generation.current)return;
        const values=results.map(row=>row.status==='fulfilled'&&row.value.success?row.value.data:null);
        if(values.slice(0,3).some(value=>value===null)){setError(t('requestFailed'));setCases([]);setSources([]);setOptions(null);}
        else{setCases(values[0]);setSources(values[1]);setOptions(values[2]);}
        setMetrics(values[3]);setMetricsUnavailable(values[3]===null);setLoading(false);
    },[tenantId,agentId,t]);
    useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;generation.current++;};},[load]);
    const run=async(action:()=>Promise<ApiEnvelope<any>>)=>{
        if(mutation.current)return;mutation.current=true;setBusy(true);setError('');setNotice('');
        try{
            const result=await action();if(!mounted.current)return;
            if(!result.success){setError(t(['regression_revision_changed','regression_source_changed','regression_review_changed'].includes(result.errorCode||'')?'changed':'requestFailed'));return;}
            if(result.data?.id)setSelected(result.data.id);
            setNotice(t('saved'));await load();
        }catch{if(mounted.current)setError(t('requestFailed'));}
        finally{mutation.current=false;if(mounted.current)setBusy(false);}
    };
    const active=cases.find(row=>row.id===selected);
    return <main className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><Link href={`/admin/agent/${agentId}`} className={button}>{t('back')}</Link>
            <button type="button" className={button} disabled={busy||loading} onClick={()=>void load()}>{t('refresh')}</button></div>
        <header><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="mt-2 text-neutral-600 dark:text-neutral-300">{t('intro')}</p></header>
        {error&&<p role="alert" className="rounded-lg border border-red-400 p-3">{error}</p>}{notice&&<p role="status">{notice}</p>}
        <RegressionMetrics data={metrics} unavailable={metricsUnavailable}/>
        <section className={panel}><h2 className="font-semibold">{t('sourcesTitle')}</h2><p className="text-sm">{t('sourcesHelp')}</p>
            {loading?<p role="status">{t('loading')}</p>:sources.length?<ul className="divide-y">{sources.map(source=><li key={`${source.kind}:${source.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div><span>{t(source.kind==='quality_score'?'opinion':'toolFailure')}</span>{source.tool_name&&<span className="ml-2 font-mono text-xs">{source.tool_name}</span>}
                    <p className="text-xs text-neutral-500">{t('sourceReference',{id:source.id.slice(0,8)})}</p></div>
                <button type="button" className={button} disabled={busy} onClick={()=>void run(()=>api.proposeQualityRegression(tenantId,agentId,{kind:source.kind,evidenceId:source.id}))}>{t('propose')}</button>
            </li>)}</ul>:<p>{t('noSources')}</p>}</section>
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]"><section className={panel}><h2 className="font-semibold">{t('casesTitle')}</h2>
            {!cases.length&&<p>{t('noCases')}</p>}<ul className="space-y-2">{cases.map(row=><li key={row.id}><button type="button" className={`${button} w-full text-left ${selected===row.id?'border-indigo-500':''}`}
                aria-pressed={selected===row.id} disabled={busy} onClick={()=>setSelected(row.id)}><span className="block">{row.proposal.title||t('untitled')}</span>
                <span className="text-xs">{t(`states.${row.state}`)} · {t('revision',{version:row.revision})}</span></button></li>)}</ul></section>
            {active&&options?<RegressionEditor key={`${active.id}:${active.revision}:${active.state}`} value={active} options={options} busy={busy}
                save={(body:any)=>run(()=>api.editQualityRegression(tenantId,agentId,active.id,body))}
                review={(body:any)=>run(()=>api.reviewQualityRegression(tenantId,agentId,active.id,body))}/>:<section className={panel}><p>{t('selectCase')}</p></section>}
        </div></main>;
}

export function RegressionEditor({value,options,busy,save,review}:{value:Case;options:Options;busy:boolean;save:(body:any)=>Promise<void>;review:(body:any)=>Promise<void>}){
    const t=useTranslations('qualityRegressions');
    const [title,setTitle]=useState(value.proposal.title),[messages,setMessages]=useState(value.proposal.messages.join('\n\n')),[criteria,setCriteria]=useState(value.proposal.criteria);
    const [scope,setScope]=useState({...value.scope}),[actions,setActions]=useState<any[]>(value.proposal.expectedActions||[]),[dirty,setDirty]=useState(false);
    const [checks,setChecks]=useState({privacy:false,correctness:false,reproduction:false}),[note,setNote]=useState('');
    const intents=options.profiles.find(profile=>profile.id===scope.profileId)?.intents||[],intent=intents.find(item=>item.key===scope.mission);
    const change=(key:string,value:any)=>{setScope((old:any)=>({...old,[key]:value,...(key==='profileId'?{mission:null}:{})}));setDirty(true);};
    const retired=value.state==='retired',blocked=value.sourceState==='blocked';
    const canApprove=!busy&&!dirty&&!blocked&&!retired&&value.state==='proposed'&&Object.values(checks).every(Boolean)&&note.trim().length>0
        &&scope.profileId&&scope.mission&&scope.language&&scope.difficulty!=='unknown'&&title.trim()&&criteria.trim();
    return <section className={panel}><h2 className="font-semibold">{t('reviewTitle')}</h2><p className="text-sm">{t('sourceVersion',{version:value.sourceAgentVersion,revision:value.sourceRevision})}</p>
        <p className="text-sm">{t(value.sourceConfiguration==='captured'?'configurationCaptured':'configurationUnavailable')}</p>
        {blocked&&<p role="alert">{t('changed')}</p>}
        <details><summary className="cursor-pointer text-sm font-medium">{t('observedReplies')}</summary><p className="mt-2 text-sm">{t('sourceCoverage',{selected:value.proposal.coverage.selectedMessages,total:value.proposal.coverage.sourceMessages,truncated:value.proposal.coverage.truncatedMessages||0})}</p>
            <div className="space-y-2">{value.proposal.observedReplies?.map((text:string,index:number)=><p className="whitespace-pre-wrap rounded border p-2 text-sm" key={index}>{text}</p>)}</div></details>
        <fieldset disabled={busy||retired||blocked} className="space-y-4"><legend className="sr-only">{t('reviewTitle')}</legend>
            <Label label={t('caseTitle')}><input className={field} value={title} maxLength={160} onChange={event=>{setTitle(event.target.value);setDirty(true);}}/></Label>
            <div className="grid gap-3 sm:grid-cols-2"><Label label={t('profile')}><select className={field} value={scope.profileId||''} onChange={event=>change('profileId',event.target.value||null)}><option value="">{t('choose')}</option>{options.profiles.map(profile=><option key={profile.id}>{profile.id}</option>)}</select></Label>
                <Label label={t('mission')}><select className={field} value={scope.mission||''} onChange={event=>change('mission',event.target.value||null)}><option value="">{t('choose')}</option>{intents.map(item=><option key={item.key}>{item.key}</option>)}</select></Label>
                <Label label={t('language')}><select className={field} value={scope.language||''} onChange={event=>change('language',event.target.value||null)}><option value="">{t('choose')}</option>{['es','en','pt','fr'].map(language=><option key={language}>{language}</option>)}</select></Label>
                <Label label={t('channel')}><select className={field} value={scope.channel} onChange={event=>change('channel',event.target.value)}>{['web_widget','whatsapp','instagram','messenger','telegram'].map(channel=><option key={channel}>{channel}</option>)}</select></Label>
                <Label label={t('difficulty')}><select className={field} value={scope.difficulty} onChange={event=>change('difficulty',event.target.value)}>{['unknown','standard','multi_step','recovery'].map(difficulty=><option key={difficulty} value={difficulty}>{t(`difficulties.${difficulty}`)}</option>)}</select></Label></div>
            <Label label={t('messages')}><textarea className={field} rows={6} value={messages} onChange={event=>{setMessages(event.target.value);setDirty(true);}}/></Label>
            <p className="text-xs">{t('messagesHelp',{datePlaceholder:'{{fixture.date}}',timePlaceholder:'{{fixture.time}}'})}</p>
            <Label label={t('criteria')}><textarea className={field} rows={3} maxLength={2000} value={criteria} onChange={event=>{setCriteria(event.target.value);setDirty(true);}}/></Label>
            <div className="space-y-3"><h3 className="text-sm font-semibold">{t('assertions')}</h3><p className="text-xs">{t('assertionsHelp')}</p>
                {actions.map((action,index)=><div key={index} className="rounded-lg border p-3 space-y-2"><p className="text-sm">{action.kind==='tool_call'?`${action.tool} · ${t(action.type==='called'?'mustCall':'mustNotCall')}`:`${action.family} · ${t(action.type==='no_row'?'noRecord':'recordExists')}`}</p>
                    <button type="button" className={button} onClick={()=>{setActions(old=>old.filter((_,i)=>i!==index));setDirty(true);}}>{t('remove')}</button></div>)}
                <AssertionBuilder options={options} tools={intent?.tools||[]} add={action=>{setActions(old=>[...old,action]);setDirty(true);}}/>
            </div>
            <button type="button" className={button} disabled={!dirty||!messages.trim()} onClick={()=>void save({expectedRevision:value.revision,scope,
                proposal:{...value.proposal,title,messages:messages.split(/\n\s*\n/).map((text:string)=>text.trim()).filter(Boolean),criteria,expectedActions:actions}})}>{t('saveRevision')}</button>
        </fieldset>
        <fieldset disabled={busy||retired} className="space-y-3 border-t pt-4"><legend className="sr-only">{t('humanChecks')}</legend><h3 className="font-medium">{t('humanChecks')}</h3>
            {(['privacy','correctness','reproduction'] as const).map(key=><label className="flex items-start gap-2 text-sm" key={key}><input type="checkbox" className="mt-1" checked={checks[key]} onChange={event=>setChecks(old=>({...old,[key]:event.target.checked}))}/><span>{t(`checks.${key}`)}</span></label>)}
            <Label label={t('reviewNote')}><textarea className={field} rows={2} maxLength={1500} value={note} onChange={event=>setNote(event.target.value)}/></Label>
            {dirty&&<p role="status" className="text-sm">{t('saveBeforeReview')}</p>}
            <div className="flex flex-wrap gap-2">{(['approved','rejected','retired'] as const).map(decision=><button type="button" key={decision} className={button}
                disabled={decision==='approved'?!canApprove:busy||retired||!note.trim()||dirty}
                onClick={()=>void review({expectedRevision:value.revision,decision,checks,note})}>{t(`actions.${decision}`)}</button>)}</div>
        </fieldset></section>;
}

function AssertionBuilder({options,tools,add}:{options:Options;tools:string[];add:(action:any)=>void}){
    const t=useTranslations('qualityRegressions');const [kind,setKind]=useState('tool_call'),[target,setTarget]=useState(''),[negative,setNegative]=useState(false),[status,setStatus]=useState('');
    const selectedFamily=options.families.find(family=>family.key===target),valid=kind==='tool_call'?tools.includes(target):!!selectedFamily;
    return <div className="grid gap-2 rounded-lg border p-3"><Label label={t('assertionKind')}><select className={field} value={kind} onChange={event=>{setKind(event.target.value);setTarget('');}}><option value="tool_call">{t('toolUse')}</option><option value="db_effect">{t('recordEffect')}</option></select></Label>
        <Label label={t('assertionTarget')}><select className={field} value={target} onChange={event=>setTarget(event.target.value)}><option value="">{t('choose')}</option>{(kind==='tool_call'?tools:options.families.map(item=>item.key)).map(key=><option key={key}>{key}</option>)}</select></Label>
        {kind==='db_effect'&&<Label label={t('recordStatus')}><input className={field} maxLength={80} value={status} onChange={event=>setStatus(event.target.value)}/></Label>}
        {selectedFamily&&!selectedFamily.executable&&<p className="text-xs">{t('verifierOnly')}</p>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={negative} onChange={event=>setNegative(event.target.checked)}/>{t('negativeAssertion')}</label>
        <button type="button" className={button} disabled={!valid} onClick={()=>add(kind==='tool_call'?{kind,type:negative?'not_called':'called',tool:target}:
            {kind,type:negative?'no_row':'row_exists',family:target,table:selectedFamily!.table,...(status.trim()?{where:{status:status.trim()}}:{})})}>{t('addAssertion')}</button></div>;
}
