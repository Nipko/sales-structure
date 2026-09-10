"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { api } from '@/lib/api';
import { canReviewNotices, canRecoverNoticeReview, noticeActions, noticeEvidenceKey, reviewNoticeAndRefresh, type OperationalNotice, type NoticeReviewAction, type NoticeReviewRequest } from '@/lib/operational-notices';

const states=['reconciliation_required','failed','pending','queued','processing','sent','stored','suppressed'];
export function NoticeLoadState({loading,error,empty}:{loading:boolean;error:boolean;empty:boolean}){
    const t=useTranslations('operationalNotices');
    return <>{loading&&<p role="status">{t('loading')}</p>}{error&&<p role="alert" className="text-red-700">{t('loadError')}</p>}{!loading&&!error&&empty&&<p>{t('empty')}</p>}</>;
}
export function OperationalNoticeReviewCard({notice,role,verified,onReview,onClose}:{
    notice:OperationalNotice;role?:string|null;verified:boolean;onReview:(request:NoticeReviewRequest)=>Promise<void>;onClose:()=>void;
}){
    const t=useTranslations('operationalNotices'),locale=useLocale();
    const [reason,setReason]=useState(''),[reference,setReference]=useState(''),[confirmed,setConfirmed]=useState(false);
    const [busy,setBusy]=useState(false),[error,setError]=useState('');
    const pending=useRef<NoticeReviewRequest|null>(null);
    const actions=noticeActions(notice,role);
    const date=(value?:string|null)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):t('unknownDate');
    const submit=async(action:NoticeReviewAction,retry=false)=>{
        if(busy||!verified||(retry?!canRecoverNoticeReview(action,role):!actions.includes(action)))return;
        const request=retry?pending.current:{action,expectedRevision:notice.revision,idempotencyKey:crypto.randomUUID(),reason:reason.trim(),...(reference.trim()?{humanReference:reference.trim()}:{})};
        if(!request)return;pending.current=request;setBusy(true);setError('');
        try{await onReview(request);pending.current=null;setReason('');setReference('');setConfirmed(false);}
        catch(cause:any){const code=String(cause?.message||'');setError(code==='notice_resolution_forbidden'?t('resolutionAdminOnly'):t.has(`errors.${code}`)?t(`errors.${code}`):t('reviewFailed'));}
        finally{setBusy(false);}
    };
    if(!canReviewNotices(role))return null;
    return <section className="min-w-0 rounded-xl border bg-card p-4 space-y-4" data-tour-form="operational-notice-review">
        <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{t('reviewTitle')}</h2><button type="button" disabled={busy} onClick={onClose}>{t('close')}</button></div>
        <p>{t.has(`kinds.${notice.kind.replaceAll('.','_')}`)?t(`kinds.${notice.kind.replaceAll('.','_')}`):t('unknownKind')} · {notice.contact_name||t('unknownContact')}</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
            <div><dt className="text-muted-foreground">{t('deliveryState')}</dt><dd>{t.has(`states.${notice.state}`)?t(`states.${notice.state}`):t('states.unknown')}</dd></div>
            <div><dt className="text-muted-foreground">{t('evidence')}</dt><dd>{t(`evidenceStates.${noticeEvidenceKey(notice)}`)}</dd></div>
            <div><dt className="text-muted-foreground">{t('created')}</dt><dd>{date(notice.created_at)}</dd></div>
            <div><dt className="text-muted-foreground">{t('checked')}</dt><dd>{date(notice.verification.checkedAt)}</dd></div>
            <div><dt className="text-muted-foreground">{t('channel')}</dt><dd>{t.has(`channels.${notice.route}`)?t(`channels.${notice.route}`):t('channels.unknown')}</dd></div>
            {notice.verification.receivedAt&&<div><dt>{t('received')}</dt><dd>{date(notice.verification.receivedAt)}</dd></div>}
        </dl>
        <p className="text-sm text-muted-foreground">{t(`evidenceHints.${noticeEvidenceKey(notice)}`)}</p>
        {notice.error_code&&<p className="text-sm">{t.has(`errors.${notice.error_code}`)?t(`errors.${notice.error_code}`):t('unknownIssue')}</p>}
        {notice.provider_reference&&<details className="text-sm"><summary>{t('providerReference')}</summary><p className="break-all mt-2">{notice.provider_reference}</p></details>}
        {!verified&&<p role="alert" className="text-amber-700">{t('notVerified')}</p>}
        {actions.length>0&&<div className="space-y-3">
            <p className="text-sm">{t('reviewHint')}</p>
            {role==='tenant_supervisor'&&<p className="text-sm text-muted-foreground">{t('resolutionAdminOnly')}</p>}
            <label className="block text-sm">{t('reason')}<textarea aria-label={t('reason')} className="mt-1 w-full rounded border bg-background p-2" value={reason} maxLength={1000} disabled={busy||!!pending.current} onChange={event=>setReason(event.target.value)}/></label>
            <label className="block text-sm">{t('humanReference')}<input aria-label={t('humanReference')} className="mt-1 w-full rounded border bg-background p-2" value={reference} maxLength={512} disabled={busy||!!pending.current} onChange={event=>setReference(event.target.value)}/></label>
            <p className="text-xs text-muted-foreground">{t('humanReferenceHint')}</p>
            {actions.includes('suppress')&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy||!!pending.current} onChange={event=>setConfirmed(event.target.checked)}/>{t('suppressionConfirm')}</label>}
            <div className="flex flex-wrap gap-2">{actions.map(action=><button key={action} type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={busy||!verified||reason.trim().length<5||!!pending.current||(action==='suppress'&&!confirmed)} onClick={()=>void submit(action)}>{t(`actions.${action}`)}</button>)}</div>
        </div>}
        {busy&&<p role="status">{t('saving')}</p>}
        {error&&<div role="alert" className="space-y-2 text-sm"><p>{error}</p>{pending.current&&<div className="flex gap-3"><button type="button" disabled={busy||!verified||!canRecoverNoticeReview(pending.current.action,role)} onClick={()=>void submit(pending.current!.action,true)}>{t('retryReview')}</button><button type="button" disabled={busy} onClick={()=>{pending.current=null;setError('');}}>{t('editReview')}</button></div>}</div>}
        <div className="space-y-2"><h3 className="font-medium">{t('history')}</h3>{!notice.reviews?.length?<p className="text-sm text-muted-foreground">{t('noReviews')}</p>:notice.reviews.map(review=><article key={review.id} className="border-t pt-2 text-sm space-y-1">
            <p>{t(`actions.${review.action}`)} · {date(review.created_at)} · {review.actor_name||t('unknownReviewer')} ({t.has(`roles.${review.actor_role}`)?t(`roles.${review.actor_role}`):t('unknownReviewer')})</p>
            <p className="whitespace-pre-wrap break-words">{review.reason==='notice_contact_erased'?t('errors.notice_contact_erased'):review.reason}</p>
            {review.human_reference&&<p className="break-all">{t('reportedReference')}: {review.human_reference}</p>}
            <p>{t('evidence')}: {t(`evidenceStates.${review.evidence?.status||'unknown'}`)}</p>
        </article>)}</div>
    </section>;
}

export function OperationalNoticeWorkspace({tenantId,role,conversationId}:{tenantId:string;role?:string|null;conversationId?:string}){
    const t=useTranslations('operationalNotices');
    const [state,setState]=useState('reconciliation_required'),[items,setItems]=useState<OperationalNotice[]>([]),[cursor,setCursor]=useState<string|null>(null);
    const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(false),[selected,setSelected]=useState<OperationalNotice|null>(null),[detailVerified,setDetailVerified]=useState(false),[detailError,setDetailError]=useState(false);
    const [reviewBusy,setReviewBusy]=useState(false);
    const generation=useRef(0),detailGeneration=useRef(0);
    const load=useCallback(async(next?:string)=>{
        if(!canReviewNotices(role)){setLoading(false);return;}
        const version=++generation.current;setLoading(true);setLoadError(false);
        try{const response=await api.getOperationalNotices(tenantId,{state:state||undefined,conversationId,cursor:next});
            if(!response.success||!Array.isArray(response.data?.items))throw new Error('notice_list_unavailable');
            if(version===generation.current){setItems(previous=>next?[...previous,...response.data!.items]:response.data!.items);setCursor(response.data.nextCursor);}
        }catch{if(version===generation.current)setLoadError(true);}finally{if(version===generation.current)setLoading(false);}
    },[tenantId,state,conversationId,role]);
    useEffect(()=>{setItems([]);setCursor(null);setSelected(null);setDetailVerified(false);detailGeneration.current++;void load();return()=>{generation.current++;detailGeneration.current++;};},[load]);
    const detail=async(id:string)=>{
        const version=++detailGeneration.current;setDetailVerified(false);setDetailError(false);
        try{const response=await api.getOperationalNotice(tenantId,id);if(!response.success||!response.data||response.data.id!==id)throw new Error('notice_detail_unavailable');
            if(version===detailGeneration.current){setSelected(response.data);setDetailVerified(true);}
        }catch{if(version===detailGeneration.current)setDetailError(true);}
    };
    const review=async(request:NoticeReviewRequest)=>{
        if(!selected)throw new Error('notice_detail_unavailable');
        // Always consult the authoritative state, including an uncertain HTTP
        // result. Retrying a review retains the exact request/key in the card.
        setReviewBusy(true);setDetailVerified(false);
        try{
            const result=await reviewNoticeAndRefresh(api,tenantId,selected.id,request);
            if(result.notice)setSelected(result.notice);
            setDetailVerified(result.verified);setDetailError(!result.verified);
            await load();if(result.error)throw new Error(result.error);
        }finally{setReviewBusy(false);}
    };
    if(!canReviewNotices(role))return <p role="alert">{t('forbidden')}</p>;
    return <div className="space-y-5 max-w-6xl mx-auto">
        <Link href="/admin/inbox" className="text-sm underline">{t('backInbox')}</Link>
        <header><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="text-muted-foreground mt-2">{t('description')}</p></header>
        {conversationId&&<p className="text-sm">{t('conversationFilter')} <Link href="/admin/operational-notices" className="underline">{t('clearFilter')}</Link></p>}
        <div className="flex flex-wrap items-end gap-3"><label className="text-sm">{t('filter')}<select disabled={reviewBusy} className="block mt-1 rounded border bg-background p-2" value={state} onChange={event=>setState(event.target.value)}><option value="">{t('allStates')}</option>{states.map(value=><option key={value} value={value}>{t(`states.${value}`)}</option>)}</select></label><button type="button" onClick={()=>{void load();if(selected)void detail(selected.id);}} disabled={loading||reviewBusy} className="rounded border px-3 py-2">{t('refresh')}</button></div>
        <NoticeLoadState loading={loading} error={loadError} empty={!items.length}/>
        <div className="grid gap-5 lg:grid-cols-2"><div className="space-y-3 min-w-0">{items.map(notice=><article key={notice.id} className="rounded-xl border bg-card p-4 space-y-2">
            <h2 className="font-medium">{t.has(`kinds.${notice.kind.replaceAll('.','_')}`)?t(`kinds.${notice.kind.replaceAll('.','_')}`):t('unknownKind')}</h2>
            <p className="text-sm">{notice.contact_name||t('unknownContact')}</p><p className="text-sm">{t.has(`states.${notice.state}`)?t(`states.${notice.state}`):t('states.unknown')} · {t(`evidenceStates.${noticeEvidenceKey(notice)}`)}</p>
            {notice.latestReview&&<p className="text-xs text-muted-foreground">{t('hasHumanReview')}</p>}
            <button type="button" disabled={loadError||loading||reviewBusy} onClick={()=>{setSelected(null);void detail(notice.id);}} className="rounded border px-3 py-2 text-sm">{t('openReview')}</button>
        </article>)}{cursor&&!loadError&&<button type="button" disabled={loading||reviewBusy} onClick={()=>void load(cursor)}>{t('more')}</button>}</div>
            <div className="min-w-0">{detailError&&<p role="alert">{t('detailError')}</p>}{selected&&<OperationalNoticeReviewCard key={selected.id} notice={selected} role={role} verified={detailVerified&&!loadError} onReview={review} onClose={()=>{detailGeneration.current++;setSelected(null);}}/>}</div>
        </div>
    </div>;
}
