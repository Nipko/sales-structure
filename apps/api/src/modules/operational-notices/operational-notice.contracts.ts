import type { OutboundMessage } from '@parallext/shared';

export type OperationalNoticeKind = 'appointment.payment_confirmed' | 'appointment.payment_review'
    | 'gym.waitlist_promoted' | 'education.waitlist_promoted' | 'education.waitlist_review';
export type OperationalNoticeState = 'pending' | 'queued' | 'processing' | 'sent' | 'stored'
    | 'failed' | 'suppressed' | 'reconciliation_required';
export interface OperationalNoticeReference { tenantId: string; noticeId: string; }
export interface OperationalNoticeTransport { prepare(outbound: OutboundMessage): Promise<() => Promise<string | null>>; }
export interface OperationalNoticeDeliveryPort {
    deliver(reference: OperationalNoticeReference, transport: OperationalNoticeTransport): Promise<string>;
}
export const OPERATIONAL_NOTICE_DELIVERY = Symbol('OPERATIONAL_NOTICE_DELIVERY');
export type NoticeQuery = <T = any[]>(sql: string, params?: any[]) => Promise<T>;

/** Durable identity and delivery bookkeeping only. Read content and recipients from current canonical rows. */
export const OPERATIONAL_NOTICE_DDL = `CREATE TABLE IF NOT EXISTS operational_notice_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_key VARCHAR(200) NOT NULL UNIQUE,
    kind VARCHAR(60) NOT NULL CHECK(kind IN ('appointment.payment_confirmed','appointment.payment_review','gym.waitlist_promoted','education.waitlist_promoted','education.waitlist_review')),
    entity_id UUID NOT NULL,
    contact_id UUID,
    conversation_id UUID,
    state VARCHAR(40) NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','queued','processing','sent','stored','failed','suppressed','reconciliation_required')),
    route VARCHAR(30),
    provider_reference VARCHAR(512),
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_code VARCHAR(100),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;
