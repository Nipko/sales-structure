import type { PrismaService } from '../prisma/prisma.service';
import { OPERATIONAL_NOTICE_DDL, type NoticeQuery, type OperationalNoticeKind } from './operational-notice.contracts';

const prepared = new WeakMap<object, Set<string>>();
export async function operationalContactWasErased(query: NoticeQuery, contactId?: string | null): Promise<boolean> {
    if (!contactId) return false;
    const [table] = await query<any[]>("SELECT to_regclass('customer_memory_erasure')::text AS name");
    return !!table?.name && (await query<any[]>('SELECT contact_id FROM customer_memory_erasure WHERE contact_id=$1::uuid',[contactId])).length>0;
}
export function operationalNoticesAllowed(schema: string): boolean {
    if (!/^tenant_[a-z0-9_]+$/.test(schema)) throw new Error('operational_notice_invalid_schema');
    return !schema.startsWith('tenant_eval_');
}

/** Prepare before the domain transaction acquires business rows; failures must not silently lose the intent. */
export async function ensureOperationalNoticeOutbox(prisma: PrismaService, schema: string): Promise<void> {
    if (!operationalNoticesAllowed(schema) || prepared.get(prisma)?.has(schema)) return;
    await prisma.transactionInTenantSchema(schema, async query => {
        await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`${schema}:operational-notice-schema`]);
        await query(OPERATIONAL_NOTICE_DDL);
        await query('ALTER TABLE operational_notice_outbox ADD COLUMN IF NOT EXISTS recipient_user_id UUID');
        await query('ALTER TABLE operational_notice_outbox ADD COLUMN IF NOT EXISTS recipient_email TEXT');
        await query('ALTER TABLE operational_notice_outbox ADD COLUMN IF NOT EXISTS payload JSONB');
        const [kindConstraint] = await query<any[]>(`SELECT pg_get_constraintdef(oid) AS definition
            FROM pg_constraint WHERE conrelid='operational_notice_outbox'::regclass
              AND conname='operational_notice_outbox_kind_check'`);
        if (!String(kindConstraint?.definition || '').includes('push.domain_event')) {
            await query('ALTER TABLE operational_notice_outbox DROP CONSTRAINT IF EXISTS operational_notice_outbox_kind_check');
            await query(`ALTER TABLE operational_notice_outbox ADD CONSTRAINT operational_notice_outbox_kind_check
                CHECK(kind IN ('appointment.payment_confirmed','appointment.payment_review','appointment.operator_slack','analytics.threshold_alert','analytics.scheduled_report','gym.waitlist_promoted',
                    'education.waitlist_promoted','education.waitlist_review','home_service.emergency',
                    'tour.booking_confirmed','property.booking_confirmed','order.confirmed','handoff.sla_escalated','push.domain_event'))`);
        }
        await query("CREATE INDEX IF NOT EXISTS idx_operational_notice_due ON operational_notice_outbox(state,next_attempt_at) WHERE state IN ('pending','queued','failed')");
    });
    const schemas = prepared.get(prisma) || new Set<string>(); schemas.add(schema); prepared.set(prisma, schemas);
}

export async function enqueueOperationalPushNotices(query: NoticeQuery, schema: string, input: {
    entityId: string; eventKey: string; contactId?: string | null; conversationId?: string | null;
    recipientUserId?: string | null; roles?: Array<'tenant_admin' | 'tenant_supervisor'>;
    payload: { title: string; body: string; url: string; tag: string; eventType: string };
}): Promise<string[]> {
    if (!operationalNoticesAllowed(schema)) return [];
    const roles = input.roles || [];
    const rows = await query<any[]>(`INSERT INTO operational_notice_outbox(
            event_key,kind,entity_id,contact_id,conversation_id,recipient_user_id,payload,state)
        SELECT $1 || ':' || u.id::text,'push.domain_event',$2::uuid,$3::uuid,$4::uuid,u.id,$5::jsonb,'pending'
          FROM public.tenants t JOIN public.users u ON u.tenant_id=t.id
         WHERE t.schema_name=$6 AND t.is_active=true AND u.is_active=true
           AND (($7::uuid IS NOT NULL AND u.id=$7::uuid)
             OR ($7::uuid IS NULL AND u.role=ANY($8::text[])))
        ON CONFLICT(event_key) DO NOTHING RETURNING id`, [input.eventKey, input.entityId,
        input.contactId || null, input.conversationId || null, JSON.stringify(input.payload), schema,
        input.recipientUserId || null, roles]);
    return rows.map(row => row.id);
}

/**
 * Snapshot one durable intent per active operator. A role may have many users,
 * and each SMTP transaction needs its own authority and receipt; one row per
 * role would hide several remote effects behind one state.
 */
export async function enqueueOperationalNoticesForTenantRoles(query: NoticeQuery, schema: string, input: {
    kind: 'home_service.emergency' | 'handoff.sla_escalated'; entityId: string; contactId?: string | null;
    conversationId?: string | null; roles: Array<'tenant_admin' | 'tenant_supervisor'>; revision?: string;
}): Promise<string[]> {
    if (!operationalNoticesAllowed(schema)) return [];
    const rows = await query<any[]>(`INSERT INTO operational_notice_outbox(
            event_key,kind,entity_id,contact_id,conversation_id,recipient_user_id,state)
        SELECT $1 || ':' || u.id::text || ':' || $7,$2,$3::uuid,$4::uuid,$5::uuid,u.id,'pending'
          FROM public.tenants t
          JOIN public.users u ON u.tenant_id=t.id
         WHERE t.schema_name=$6 AND t.is_active=true AND u.is_active=true AND u.role=ANY($8::text[])
        ON CONFLICT(event_key) DO NOTHING RETURNING id`, [input.kind, input.kind, input.entityId,
        input.contactId || null, input.conversationId || null, schema, input.revision || '1', input.roles]);
    return rows.map(row => row.id);
}

/** Called inside the same transaction that confirms a payment or promotes a waitlist entry. */
export async function enqueueOperationalNotice(query: NoticeQuery, schema: string, input: {
    kind: OperationalNoticeKind; entityId: string; contactId?: string | null; conversationId?: string | null;
    revision?: string; historical?: boolean; notBefore?: Date | string | null;
    recipientEmail?: string | null; payload?: Record<string, unknown> | null;
}): Promise<string | null> {
    if (!operationalNoticesAllowed(schema)) return null;
    const eventKey = `${input.kind}:${input.entityId}:${input.revision || '1'}`;
    const rows = await query<any[]>(`INSERT INTO operational_notice_outbox(event_key,kind,entity_id,contact_id,conversation_id,state,error_code,next_attempt_at,recipient_email,payload)
        VALUES($1,$2,$3::uuid,$4::uuid,$5::uuid,$6,$7,COALESCE($8::timestamptz,NOW()),$9,$10::jsonb)
        ON CONFLICT(event_key) DO NOTHING RETURNING id`, [eventKey, input.kind, input.entityId, input.contactId || null,
        input.conversationId || null, input.historical ? 'reconciliation_required' : 'pending', input.historical ? 'historical_delivery_unverified' : null,
        input.notBefore || null,input.recipientEmail || null,input.payload ? JSON.stringify(input.payload) : null]);
    return rows[0]?.id || null;
}
