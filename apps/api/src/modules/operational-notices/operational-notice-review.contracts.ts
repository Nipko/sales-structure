import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { NoticeQuery } from './operational-notice.contracts';

export const NOTICE_REVIEW_ROLES = ['super_admin','tenant_admin','tenant_supervisor'];
export type NoticeReviewAction = 'observe' | 'verify' | 'suppress';
export interface NoticeReviewInput {
    action: NoticeReviewAction; expectedRevision: string; idempotencyKey: string;
    reason: string; humanReference?: string;
}
export interface NoticeReceiptEvidence {
    status: 'unknown' | 'provider_accepted' | 'web_stored' | 'web_received';
    source: 'none' | 'outbox_receipt' | 'widget_message';
    checkedAt: string; messageId?: string; providerReference?: string; receivedAt?: string;
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const noticeUuid=(value:unknown):value is string=>typeof value==='string'&&UUID.test(value);
export function noticeReviewInput(value:unknown):NoticeReviewInput {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new BadRequestException('notice_review_invalid');
    const v=value as Record<string,unknown>;
    if(!['observe','verify','suppress'].includes(String(v.action))||!noticeUuid(v.idempotencyKey)
        ||typeof v.expectedRevision!=='string'||! /^[a-f0-9]{32}$/.test(v.expectedRevision)
        ||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.trim().length>1000
        ||(v.humanReference!==undefined&&(typeof v.humanReference!=='string'||v.humanReference.trim().length>512)))
        throw new BadRequestException('notice_review_invalid');
    return {action:v.action as NoticeReviewAction,expectedRevision:v.expectedRevision,idempotencyKey:v.idempotencyKey,
        reason:v.reason.trim(),...(typeof v.humanReference==='string'&&v.humanReference.trim()?{humanReference:v.humanReference.trim()}:{})};
}
export function noticeReviewHash(input:NoticeReviewInput):string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/** Only canonical server records can verify an outcome. A human reference is
 * deliberately not an input; no provider polling or effect is performed here. */
export async function noticeReceiptEvidence(query:NoticeQuery,tenantId:string,notice:any):Promise<NoticeReceiptEvidence> {
    const unknown:NoticeReceiptEvidence={status:'unknown',source:'none',checkedAt:new Date().toISOString()};
    if(notice.error_code==='notice_contact_erased'||!notice.contact_id)return unknown;
    if(notice.route==='web_widget'&&notice.conversation_id){
        const exists=await query<any[]>("SELECT to_regclass('messages')::text AS name");
        if(!exists[0]?.name)return unknown;
        const externalId=`widget:outbound:${createHash('sha256').update(`${tenantId}:${notice.conversation_id}:operational:${notice.id}`).digest('hex')}`;
        const rows=await query<any[]>(`SELECT m.id,m.status,m.metadata FROM messages m JOIN conversations c ON c.id=m.conversation_id
            WHERE m.external_id=$1 AND m.conversation_id=$2::uuid AND c.contact_id=$3::uuid
                AND c.channel_type='web_widget' AND m.direction='outbound' AND m.metadata->>'channel'='web_widget'
                AND m.metadata->>'source'='ai' AND m.metadata->>'widgetSessionId' IS NOT NULL`,[externalId,notice.conversation_id,notice.contact_id]);
        if(rows.length!==1)return unknown;
        const row=rows[0],receivedAt=row.metadata?.widgetReceivedAt;
        const received=row.status==='delivered'&&typeof receivedAt==='string'&&Number.isFinite(Date.parse(receivedAt));
        return {...unknown,status:received?'web_received':'web_stored',source:'widget_message',messageId:row.id,...(received?{receivedAt}:{})};
    }
    if(notice.state==='sent'&&typeof notice.provider_reference==='string'&&notice.provider_reference.trim())
        return {...unknown,status:'provider_accepted',source:'outbox_receipt',providerReference:notice.provider_reference};
    return unknown;
}

export const NOTICE_REVIEW_DDL=`CREATE TABLE IF NOT EXISTS operational_notice_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), notice_id UUID NOT NULL REFERENCES operational_notice_outbox(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL, actor_role VARCHAR(40) NOT NULL,
    action VARCHAR(20) NOT NULL CHECK(action IN ('observe','verify','suppress')),
    idempotency_key UUID NOT NULL, request_hash CHAR(64) NOT NULL, expected_revision CHAR(32) NOT NULL,
    reason TEXT NOT NULL, human_reference TEXT, prior_state VARCHAR(40) NOT NULL, resulting_state VARCHAR(40) NOT NULL,
    evidence JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(notice_id,idempotency_key)
)`;
