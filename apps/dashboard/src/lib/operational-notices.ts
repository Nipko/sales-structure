export type NoticeReviewAction='observe'|'verify'|'suppress';
export interface NoticeVerification {
    status:'unknown'|'provider_accepted'|'web_stored'|'web_received';source:'none'|'outbox_receipt'|'widget_message';
    checkedAt:string;messageId?:string;providerReference?:string;receivedAt?:string;
}
export interface NoticeReview {
    id:string;actor_id?:string;actor_name?:string|null;actor_role:string;action:NoticeReviewAction;reason:string;human_reference:string|null;
    resulting_state:string;evidence:NoticeVerification;created_at:string;
}
export interface OperationalNotice {
    id:string;kind:string;entity_id:string|null;contact_id:string|null;contact_name:string|null;conversation_id:string|null;
    state:string;route:string|null;provider_reference:string|null;attempts:number;error_code:string|null;
    created_at:string;updated_at:string;completed_at:string|null;revision:string;verification:NoticeVerification;
    latestReview:NoticeReview|null;reviewable:boolean;reviews?:NoticeReview[];
}
export interface NoticeReviewRequest {action:NoticeReviewAction;expectedRevision:string;idempotencyKey:string;reason:string;humanReference?:string;}
export interface OperationalNoticeList {items:OperationalNotice[];nextCursor:string|null;}
export const canReviewNotices=(role?:string|null)=>['tenant_admin','tenant_supervisor','super_admin'].includes(role||'');
export const canSuppressNotice=(role?:string|null)=>['tenant_admin','super_admin'].includes(role||'');
/** A completed suppression may be recovered with its original key even though
 * starting another suppression is no longer an available state transition. */
export const canRecoverNoticeReview=(action:NoticeReviewAction,role?:string|null)=>
    canReviewNotices(role)&&(action==='observe'||canSuppressNotice(role));
export function noticeActions(notice:OperationalNotice,role?:string|null):NoticeReviewAction[]{
    if(!canReviewNotices(role)||!notice.reviewable)return [];
    if(role==='tenant_supervisor')return ['observe'];
    return ['verify','observe',...(canSuppressNotice(role)&&['reconciliation_required','failed'].includes(notice.state)?['suppress']:[])] as NoticeReviewAction[];
}
/** References entered by humans never change this evidence label. */
export function noticeEvidenceKey(notice:OperationalNotice):NoticeVerification['status']{
    return ['provider_accepted','web_stored','web_received'].includes(notice.verification?.status)?notice.verification.status:'unknown';
}
export async function reviewNoticeAndRefresh(client:{
    reviewOperationalNotice(tenantId:string,noticeId:string,body:NoticeReviewRequest):Promise<{success:boolean;error?:unknown}>;
    getOperationalNotice(tenantId:string,noticeId:string):Promise<{success:boolean;data?:OperationalNotice;error?:unknown}>;
},tenantId:string,noticeId:string,request:NoticeReviewRequest){
    let error:string|null=null;
    try{const response=await client.reviewOperationalNotice(tenantId,noticeId,request);if(!response.success)error=String(response.error||'notice_review_failed');}
    catch(cause:any){error=String(cause?.message||'notice_review_failed');}
    try{
        const response=await client.getOperationalNotice(tenantId,noticeId);
        if(!response.success||!response.data||response.data.id!==noticeId)throw new Error('notice_detail_unavailable');
        return {notice:response.data,verified:true,error};
    }catch{return {notice:null,verified:false,error:error||'notice_detail_unavailable'};}
}
