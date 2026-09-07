"use client";
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
export interface StockEvidenceOrder {id:string;version:number;items:{id:string;productName:string;quantity:number;stockDeducted:number|null}[]}
export function stockEvidenceComplete(order:StockEvidenceOrder,values:Record<string,string>,source:string,reason:string):boolean{
    const missing=order.items.filter(item=>item.stockDeducted===null);
    return missing.length>0&&!!source.trim()&&!!reason.trim()&&missing.every(item=>values[item.id]==='0'||values[item.id]===String(item.quantity));
}
export function OrderStockEvidenceReview({tenantId,order,onClose,onSaved}:{tenantId:string;order:StockEvidenceOrder;onClose:()=>void;onSaved:()=>void}){
    const t=useTranslations('orders.integrity'),[values,setValues]=useState<Record<string,string>>({}),[source,setSource]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(false);
    const missing=order.items.filter(item=>item.stockDeducted===null),complete=stockEvidenceComplete(order,values,source,reason);
    const submit=async()=>{
        if(!complete||busy)return;setBusy(true);setError(false);
        const result=await api.recordOrderStockEvidence(tenantId,order.id,{expectedVersion:order.version,source,reason,lines:missing.map(item=>({lineId:item.id,stockDeducted:Number(values[item.id])}))}).catch(()=>null);
        setBusy(false);if(result?.success)onSaved();else setError(true);
    };
    return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4"><div role="dialog" aria-modal="true" aria-label={t('stockReview')} data-tour-form="stock-evidence" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-card p-6">
        <h2 className="text-lg font-semibold">{t('stockReview')}</h2><p className="my-3 text-sm text-muted-foreground">{t('stockEvidenceHelp')}</p>
        {missing.map(item=><label key={item.id} className="my-3 block text-sm">{item.productName} × {item.quantity}<select disabled={busy} aria-label={`${t('stockReview')}: ${item.productName}`} value={values[item.id]??''} onChange={event=>setValues(previous=>({...previous,[item.id]:event.target.value}))} className="mt-2 block w-full rounded-lg border bg-card p-2">
            <option value="">{t('stockUnknown')}</option><option value="0">{t('stockNotDeducted')}</option><option value={String(item.quantity)}>{t('stockWasDeducted',{quantity:item.quantity})}</option>
        </select></label>)}
        <label className="my-3 block text-sm">{t('evidenceSource')}<input disabled={busy} value={source} maxLength={500} onChange={event=>setSource(event.target.value)} className="mt-2 block w-full rounded-lg border bg-card p-2"/></label>
        <label className="my-3 block text-sm">{t('evidenceReason')}<textarea disabled={busy} value={reason} maxLength={1000} onChange={event=>setReason(event.target.value)} className="mt-2 block w-full rounded-lg border bg-card p-2"/></label>
        {error&&<p role="alert" className="my-3 text-sm text-destructive">{t('stockReviewError')}</p>}
        <div className="mt-5 flex flex-wrap gap-3"><button disabled={busy} onClick={onClose} className="rounded-lg border px-4 py-2">{t('closeReview')}</button><button disabled={busy||!complete} onClick={()=>void submit()} className="rounded-lg bg-primary px-4 py-2 text-white disabled:opacity-50">{t('saveStockEvidence')}</button></div>
    </div></div>;
}
