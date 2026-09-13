import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import type { OutboundMessage } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CronLockService } from '../redis/cron-lock.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { WidgetMessageStore, type WidgetMessageReference } from '../widget/widget-message-store.service';
import { EmailService } from '../email/email.service';
import { PushService } from '../push/push.service';
import { resolveReadyTenantContext } from '../../common/utils/tenant-lifecycle.util';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { NoticeSuppressed, type NoticeQuery, type OperationalNoticeReference, type OperationalNoticeTransport } from './operational-notice.contracts';
import { deliveryOutcome } from '../channels/delivery-outcome';
import { ensureOperationalNoticeOutbox } from './operational-notice-outbox';
import { operationalNoticeText } from './operational-notice-text';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import { emailConfirmationsForOperation } from '../../common/utils/served-confirmation-policy.util';
import { escapeReceiptHtml, receiptMoney } from '../email-templates/receipt-format.util';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;


@Injectable()
export class OperationalNoticeService {
    private readonly logger = new Logger(OperationalNoticeService.name);
    constructor(private readonly prisma: PrismaService, private readonly redis: RedisService,
        private readonly throttle: TenantThrottleService, private readonly widget: WidgetMessageStore,
        private readonly email: EmailService, private readonly push: PushService, private readonly cronLock: CronLockService,
        @InjectQueue('outbound-messages') private readonly queue: Queue<any>,
        @Optional() private readonly emailTemplates?: EmailTemplatesService) {}

    @Cron('21 * * * * *')
    async recoverCron(): Promise<void> {
        await this.cronLock.runExclusive('operational-notices.recover', 40, async () => {
            const tenants = await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true, schemaName: true } });
            for (const tenant of tenants) {
                try { await this.recoverTenant(tenant.id); }
                catch (error: any) { this.logger.warn(`Notice recovery failed for ${tenant.id}: ${error?.message}`); }
            }
        }, { prefer: 'worker' });
    }

    async recoverTenant(tenantId: string): Promise<void> {
        const schema = await this.schema(tenantId);
        await ensureOperationalNoticeOutbox(this.prisma, schema);
        await this.prisma.executeInTenantSchema(schema, `UPDATE operational_notice_outbox
            SET state=CASE WHEN route='web_widget' THEN 'failed' ELSE 'reconciliation_required' END,
                lease_token=NULL,lease_expires_at=NULL,error_code='notice_lease_expired',updated_at=NOW()
            WHERE state='processing' AND (lease_expires_at IS NULL OR lease_expires_at<=NOW())`);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema, `SELECT id FROM operational_notice_outbox
            WHERE state IN ('pending','queued','failed') AND attempts<5 AND next_attempt_at<=NOW() ORDER BY created_at,id LIMIT 100`);
        for (const row of rows) {
            const reference = { tenantId, noticeId: row.id };
            const jobId = `operational-notice-${tenantId}-${row.id}`;
            const existing = await this.queue.getJob(jobId);
            if (existing) {
                const state=await existing.getState();
                if (state==='failed'||state==='completed') await existing.retry(state);
            } else {
                await this.queue.add('operational-notice', { operationalNotice: reference }, {
                    jobId, priority: await this.throttle.getPriority(tenantId), attempts: 3,
                    backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 86400 }, removeOnFail: { age: 86400 },
                });
            }
            await this.prisma.executeInTenantSchema(schema, "UPDATE operational_notice_outbox SET state='queued',updated_at=NOW() WHERE id=$1::uuid AND state IN ('pending','failed')", [row.id]);
        }
    }

    async list(tenantId: string): Promise<any[]> {
        const schema = await this.schema(tenantId);
        await ensureOperationalNoticeOutbox(this.prisma, schema);
        return this.prisma.executeInTenantSchema(schema, `SELECT id,kind,entity_id,contact_id,conversation_id,state,route,provider_reference,attempts,error_code,created_at,updated_at,completed_at
            FROM operational_notice_outbox ORDER BY created_at DESC LIMIT 200`);
    }

    async deliver(reference: OperationalNoticeReference, transport: OperationalNoticeTransport): Promise<string> {
        if (!UUID.test(reference.noticeId)) throw new Error('operational_notice_invalid_reference');
        const schema = await this.schema(reference.tenantId), lease = randomUUID();
        const claim = await this.transaction(schema, async query => {
            let row = (await query<any[]>('SELECT * FROM operational_notice_outbox WHERE id=$1::uuid', [reference.noticeId]))[0];
            if (!row) return 'missing';
            if (row.state === 'processing') {
                row = (await query<any[]>('SELECT * FROM operational_notice_outbox WHERE id=$1::uuid FOR UPDATE', [reference.noticeId]))[0];
                if (row.state !== 'processing') return 'retry';
                if (new Date(row.lease_expires_at).getTime() > Date.now()) throw new Error('operational_notice_in_progress');
                await this.finish(query, row.id, row.route === 'web_widget' ? 'failed' : 'reconciliation_required', 'notice_lease_expired');
                return row.route === 'web_widget' ? 'retry' : 'reconciliation_required';
            }
            if (!['pending','queued','failed'].includes(row.state) || Number(row.attempts) >= 5) return row.state;
            let hydrated: any;
            try { hydrated = await this.hydrate(query, schema, reference.tenantId, row); }
            catch (error) {
                if (!(error instanceof NoticeSuppressed)) throw error;
                const current = (await query<any[]>('SELECT * FROM operational_notice_outbox WHERE id=$1::uuid FOR UPDATE', [row.id]))[0];
                if (!current || !['pending','queued','failed'].includes(current.state)) return current?.state || 'missing';
                await this.finish(query, row.id, 'suppressed', error.code); return 'suppressed';
            }
            // Domain writers lock the entity before inserting its event. Match that order.
            row = (await query<any[]>('SELECT * FROM operational_notice_outbox WHERE id=$1::uuid FOR UPDATE', [row.id]))[0];
            if (!row || !['pending','queued','failed'].includes(row.state) || Number(row.attempts)>=5) return row?.state || 'missing';
            await query(`UPDATE operational_notice_outbox SET state='processing',route=$2,conversation_id=$3::uuid,attempts=attempts+1,
                lease_token=$4::uuid,lease_expires_at=NOW()+INTERVAL '120 seconds',started_at=NOW(),error_code=NULL,updated_at=NOW() WHERE id=$1::uuid`,
            [row.id, hydrated.route, hydrated.conversationId, lease]);
            return 'claimed';
        });
        if (claim === 'retry') throw new Error('operational_notice_retry');
        if (claim !== 'claimed') return `notice:${claim}`;
        let widgetReference: WidgetMessageReference | undefined;
        const result = await this.transaction(schema, async query => {
            let row = (await query<any[]>('SELECT * FROM operational_notice_outbox WHERE id=$1::uuid', [reference.noticeId]))[0];
            if (!row || row.state !== 'processing' || row.lease_token !== lease) return 'lease_lost';
            let started = false;
            let localWriteStarted = false;
            try {
                const hydrated = await this.hydrate(query, schema, reference.tenantId, row);
                row = (await query<any[]>('SELECT * FROM operational_notice_outbox WHERE id=$1::uuid FOR UPDATE', [reference.noticeId]))[0];
                if (!row || row.state !== 'processing' || row.lease_token !== lease) return 'lease_lost';
                if (hydrated.route !== row.route) throw new NoticeSuppressed('notice_route_changed');
                const active = await query<any[]>('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=$2 AND is_active=true FOR SHARE', [reference.tenantId, schema]);
                if (!active[0]) throw new NoticeSuppressed('notice_tenant_unavailable');
                if (!(await resolveTenantSubscriptionAccess(this.prisma, reference.tenantId, 'write')).allowed) throw new NoticeSuppressed('notice_subscription_restricted');
                if (new Date(row.lease_expires_at).getTime() <= Date.now()) throw new Error('notice_lease_expired_before_send');
                if (hydrated.route === 'web_widget') {
                    await this.widget.assertAvailable(reference.tenantId);
                    localWriteStarted = true;
                    const message = await this.widget.persistWithQuery(query, schema, reference.tenantId, {
                        conversationId: hydrated.conversationId, contactId: row.contact_id, content: { type:'text', text:hydrated.text },
                        dedupeId:`operational:${row.id}`,source:'ai',
                    });
                    await this.finish(query,row.id,'stored');
                    widgetReference={tenantId:reference.tenantId,conversationId:hydrated.conversationId,messageId:message.id};
                    return 'stored';
                }
                let send: () => Promise<any>;
                if (hydrated.route === 'email') {
                    if (hydrated.emailTemplate) {
                        if (!this.emailTemplates) throw new Error('notice_email_templates_unavailable');
                        const prepared=await this.emailTemplates.renderAndPrepare(schema,hydrated.emailTemplate.slug,
                            hydrated.email,hydrated.emailTemplate.variables,hydrated.emailTemplate.language);
                        if (!prepared) throw new NoticeSuppressed('notice_template_missing');
                        send=prepared;
                    } else {
                        send=this.email.prepareBoundedSend({to:hydrated.email,subject:hydrated.text.split('\n')[0],text:hydrated.text});
                    }
                } else if (hydrated.route === 'operator') {
                    send=()=>this.push.sendToTenantRole(reference.tenantId,hydrated.role || 'tenant_admin', {
                        title:hydrated.text.split('\n')[0],body:hydrated.text,tag:`operational-${row.id}`,
                    });
                } else {
                    send=await transport.prepare(hydrated.outbound);
                }
                started=true;
                const receipt=await send();
                if (!receipt) throw new Error('notice_provider_no_receipt');
                await this.finish(query,row.id,'sent',null,typeof receipt==='string'?receipt.slice(0,512):null); return 'sent';
            } catch (error) {
                // The local message and its outbox outcome are one atomic write.
                // Roll both back even when a JS/adapter error follows persistence.
                if (localWriteStarted) throw error;
                const current = (await query<any[]>('SELECT * FROM operational_notice_outbox WHERE id=$1::uuid FOR UPDATE', [reference.noticeId]))[0];
                if (!current || current.state !== 'processing' || current.lease_token !== lease) return 'lease_lost';
                // `started` is a PROXY for "a request may have left", set just
                // before the send closure runs — and the spend gate lives inside
                // that closure. A refusal therefore arrived with `started` true
                // and closed the row `reconciliation_required` /
                // `notice_delivery_outcome_unknown`, a state this lane's own
                // recovery query excludes. `NoticeSuppressed` is raised only by
                // our own checks, all of them before any request, so it is
                // positive knowledge that nothing was sent — and that outranks
                // the proxy.
                const refused=error instanceof NoticeSuppressed;
                // Shared with the approved-effect lane, which had the identical
                // defect. Two inline copies of one rule is how one gets fixed.
                const outcome=deliveryOutcome({started,refused});
                const state=outcome.state;
                await this.finish(query,row.id,state,
                    outcome.reason==='refused'?(error as NoticeSuppressed).code
                        :outcome.reason==='outcome_unknown'
                            ?'notice_delivery_outcome_unknown':'notice_preflight_failed');
                return state;
            }
        });
        if (widgetReference) this.widget.publish(widgetReference);
        if (result === 'failed') throw new Error('operational_notice_retry');
        return `notice:${result}`;
    }

    private async hydrate(query: NoticeQuery, schema: string, tenantId: string, notice: any): Promise<any> {
        let facts: any;
        if (notice.kind.startsWith('appointment.')) {
            facts=(await query<any[]>(`SELECT a.*,to_char(a.start_at,'YYYY-MM-DD HH24:MI') AS when_text,a.service_name AS name
                FROM appointments a WHERE a.id=$1::uuid FOR SHARE`,[notice.entity_id]))[0];
            const required=notice.kind==='appointment.payment_review'?'review':'confirmed';
            if (!facts || facts.metadata?.source==='eval_gate' || facts.payment_status!=='paid'
                || (required==='confirmed' ? facts.status!=='confirmed' : !facts.metadata?.paymentConfirmationIssue)) throw new NoticeSuppressed('notice_domain_state_changed');
            if (required==='confirmed' && new Date(facts.start_at).getTime()<=Date.now()) throw new NoticeSuppressed('notice_event_expired');
        } else if (notice.kind==='gym.waitlist_promoted') {
            const ref=(await query<any[]>('SELECT class_id FROM class_bookings WHERE id=$1::uuid',[notice.entity_id]))[0];
            const fc=ref && (await query<any[]>(`SELECT *,to_char(scheduled_at,'YYYY-MM-DD HH24:MI') AS when_text FROM fitness_classes WHERE id=$1::uuid FOR SHARE`,[ref.class_id]))[0];
            const booking=fc && (await query<any[]>('SELECT * FROM class_bookings WHERE id=$1::uuid FOR SHARE',[notice.entity_id]))[0];
            facts=booking && {...booking,name:fc.name,when_text:fc.when_text,scheduled_at:fc.scheduled_at,is_cancelled:fc.is_cancelled};
            if (!facts || facts.status!=='confirmed' || facts.is_cancelled || new Date(facts.scheduled_at).getTime()<=Date.now()) throw new NoticeSuppressed('notice_domain_state_changed');
        } else if (notice.kind.startsWith('education.')) {
            const ref=(await query<any[]>('SELECT cohort_id FROM enrollments WHERE id=$1::uuid',[notice.entity_id]))[0];
            const co=ref && (await query<any[]>('SELECT *,starts_at::text AS when_text FROM course_cohorts WHERE id=$1::uuid FOR SHARE',[ref.cohort_id]))[0];
            const enrollment=co && (await query<any[]>('SELECT * FROM enrollments WHERE id=$1::uuid FOR SHARE',[notice.entity_id]))[0];
            facts=enrollment && {...enrollment,name:enrollment.metadata?.enrollmentTerms?.courseName,when_text:co.when_text,starts_at:co.starts_at,cohort_status:co.status};
            const expected=notice.kind==='education.waitlist_review'?'waitlist_review':'enrolled';
            if (!facts || facts.status!==expected || ['cancelled','finished'].includes(facts.cohort_status)) throw new NoticeSuppressed('notice_domain_state_changed');
            if (new Date(facts.starts_at).getTime()<new Date(new Date().toISOString().slice(0,10)).getTime()) throw new NoticeSuppressed('notice_event_expired');
        } else if (notice.kind === 'home_service.emergency') {
            facts=(await query<any[]>(`SELECT * FROM service_requests WHERE id=$1::uuid FOR SHARE`,[notice.entity_id]))[0];
            if (!facts || facts.urgency!=='emergencia' || ['completed','cancelled'].includes(facts.status)) {
                throw new NoticeSuppressed('notice_domain_state_changed');
            }
        } else if (notice.kind === 'tour.booking_confirmed') {
            facts=(await query<any[]>(`SELECT b.*,p.name,p.departure_location,
                    to_char(b.departure_date,'YYYY-MM-DD') AS departure_date_text
                FROM tour_bookings b JOIN tour_packages p ON p.id=b.package_id
                WHERE b.id=$1::uuid FOR SHARE OF b,p`,[notice.entity_id]))[0];
            if (!facts || !['reserved','confirmed','paid'].includes(facts.status)) throw new NoticeSuppressed('notice_domain_state_changed');
        } else if (notice.kind === 'property.booking_confirmed') {
            facts=(await query<any[]>(`SELECT b.*,p.name,p.check_in_instructions,
                    b.check_in::text AS check_in_text,b.check_out::text AS check_out_text
                FROM property_bookings b JOIN properties p ON p.id=b.property_id
                WHERE b.id=$1::uuid FOR SHARE OF b,p`,[notice.entity_id]))[0];
            if (!facts || facts.status!=='confirmed') throw new NoticeSuppressed('notice_domain_state_changed');
        } else if (notice.kind === 'order.confirmed') {
            facts=(await query<any[]>('SELECT * FROM orders WHERE id=$1::uuid FOR SHARE',[notice.entity_id]))[0];
            if (!facts || !['confirmed','paid'].includes(facts.status)) throw new NoticeSuppressed('notice_domain_state_changed');
        } else {
            throw new NoticeSuppressed('notice_kind_unsupported');
        }
        if (facts.contact_id!==notice.contact_id) throw new NoticeSuppressed('notice_contact_changed');
        const erased=await query<any[]>("SELECT to_regclass('customer_memory_erasure')::text AS name");
        if (notice.contact_id && erased[0]?.name && (await query<any[]>('SELECT contact_id FROM customer_memory_erasure WHERE contact_id=$1::uuid',[notice.contact_id])).length) throw new NoticeSuppressed('notice_contact_erased');
        const tenant=await this.prisma.tenant.findUnique({where:{id:tenantId},select:{language:true}});
        if (notice.kind==='appointment.payment_review') return {route:'operator',conversationId:notice.conversation_id||null,text:operationalNoticeText(notice.kind,tenant?.language,{})};
        if (notice.kind==='home_service.emergency') {
            if (!notice.recipient_user_id) throw new NoticeSuppressed('notice_operator_missing');
            const [operator]=await query<any[]>(`SELECT id,email FROM public.users
                WHERE id=$1::uuid AND tenant_id=$2::uuid AND is_active=true
                  AND role IN ('tenant_admin','tenant_supervisor') FOR SHARE`,[notice.recipient_user_id,tenantId]);
            if (!operator?.email) throw new NoticeSuppressed('notice_operator_unavailable');
            return {route:'email',email:operator.email,conversationId:notice.conversation_id||null,
                text:operationalNoticeText(notice.kind,tenant?.language,{
                    service:facts.service_type,customer:facts.customer_name,phone:facts.customer_phone,
                    address:[facts.address,facts.city].filter(Boolean).join(', '),problem:facts.issue_description,
                })};
        }
        if (notice.kind==='tour.booking_confirmed' || notice.kind==='property.booking_confirmed' || notice.kind==='order.confirmed') {
            const family=notice.kind.startsWith('tour.')?'tours':notice.kind.startsWith('property.')?'properties':'orders';
            if (!await emailConfirmationsForOperation(query,[family],facts.conversation_id)) {
                throw new NoticeSuppressed('notice_confirmation_switched_off');
            }
            let email=String(facts.guest_email || '').trim();
            let customerName=String(facts.guest_name || '').trim();
            if (notice.kind==='order.confirmed' && facts.contact_id) {
                const [contact]=await query<any[]>('SELECT name,email FROM contacts WHERE id=$1::uuid FOR SHARE',[facts.contact_id]);
                email=String(contact?.email || '').trim(); customerName=String(contact?.name || '').trim();
            }
            if (!email) throw new NoticeSuppressed('notice_channel_unavailable');
            const language=facts.language || tenant?.language || 'es';
            let emailTemplate:any;
            if (notice.kind==='order.confirmed') {
                const items=await query<any[]>('SELECT product_name,quantity,total_price FROM order_items WHERE order_id=$1::uuid ORDER BY product_id,id',[notice.entity_id]);
                const currency=String(facts.currency || 'COP');
                emailTemplate={slug:'order_confirmation',language,variables:{customer_name:customerName||'Cliente',order_id:String(facts.id),
                    order_items_html:items.map(item=>`<p style="margin:4px 0;font-size:14px;">${escapeReceiptHtml(item.product_name)} &times; ${escapeReceiptHtml(item.quantity)} — ${escapeReceiptHtml(receiptMoney(Number(item.total_price),currency))}</p>`).join(''),
                    order_total:receiptMoney(Number(facts.total_amount),currency),payment_method:String(facts.metadata?.payment_method || 'cash')}};
            } else emailTemplate=notice.kind.startsWith('tour.')?{
                slug:'tour_booking_confirmation',language,variables:{guest_name:facts.guest_name||'Huésped',
                    package_name:facts.name||'',departure_date:facts.departure_date_text||'',departure_time:facts.departure_time||'',
                    party_size:String(facts.party_size||0),adults:String(facts.adults||0),children:String(facts.children||0),
                    total_price:String(facts.total_price||0),currency:facts.currency||'COP',departure_location:facts.departure_location||''},
            }:{
                slug:'property_booking_confirmation',language,variables:{guest_name:facts.guest_name||'Huésped',
                    property_name:facts.name||'',check_in:facts.check_in_text||'',check_out:facts.check_out_text||'',
                    nights:String(facts.nights||0),total_price:String(facts.total_price||0),currency:facts.currency||'COP',
                    check_in_instructions:facts.check_in_instructions||''},
            };
            return {route:'email',email,conversationId:facts.conversation_id||null,emailTemplate,text:''};
        }
        if (!notice.contact_id) throw new NoticeSuppressed('notice_contact_missing');
        const contacts=await query<any[]>('SELECT * FROM contacts WHERE id=$1::uuid FOR SHARE',[notice.contact_id]);
        if (!contacts[0]) throw new NoticeSuppressed('notice_contact_missing');
        const contact=contacts[0];
        const conversations=await query<any[]>(`SELECT c.*,(SELECT MAX(created_at) FROM messages WHERE conversation_id=c.id AND direction='inbound') AS last_inbound_at
            FROM conversations c WHERE c.contact_id=$1::uuid ${notice.conversation_id?'AND c.id=$2::uuid':''}
            ORDER BY c.updated_at DESC,c.id LIMIT 1 FOR SHARE OF c`,notice.conversation_id?[notice.contact_id,notice.conversation_id]:[notice.contact_id]);
        const conversation=conversations[0];
        if (notice.conversation_id && !conversation) throw new NoticeSuppressed('notice_conversation_binding_changed');
        if (conversation && (['archived','closed','resolved'].includes(conversation.status) || conversation.channel_type!==contact.channel_type)) throw new NoticeSuppressed('notice_conversation_unavailable');
        const text=operationalNoticeText(notice.kind,contact.metadata?.language||tenant?.language,{name:facts.name,when:facts.when_text});
        if (!conversation || (conversation.channel_type==='whatsapp' && (!conversation.last_inbound_at || Date.now()-new Date(conversation.last_inbound_at).getTime()>86400000))) {
            if (!contact.email) throw new NoticeSuppressed('notice_channel_unavailable');
            return {route:'email',email:contact.email,text,conversationId:conversation?.id||null};
        }
        if (!['web_widget','whatsapp','telegram','instagram','messenger'].includes(conversation.channel_type)) throw new NoticeSuppressed('notice_channel_unsupported');
        if (conversation.channel_type==='web_widget') await this.widget.assertConversation(query,schema,tenantId,conversation.id,contact.id);
        const outbound: OutboundMessage={tenantId,channelType:conversation.channel_type,channelAccountId:conversation.channel_account_id,to:contact.external_id,
            content:{type:'text',text},dedupeId:`operational-${notice.id}`,metadata:{conversationId:conversation.id}};
        return {route:conversation.channel_type,conversationId:conversation.id,text,outbound};
    }
    private transaction<T>(schema:string,work:(query:NoticeQuery)=>Promise<T>):Promise<T> {
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
            return work(query);
        },{timeout:110000});
    }
    private finish(query:NoticeQuery,id:string,state:string,error:string|null=null,providerReference:string|null=null) {
        return query(`UPDATE operational_notice_outbox SET state=$2::text,error_code=$3,provider_reference=COALESCE($4,provider_reference),lease_token=NULL,lease_expires_at=NULL,
            completed_at=CASE WHEN $2::text IN ('sent','stored','suppressed') THEN NOW() ELSE NULL END,next_attempt_at=NOW()+INTERVAL '60 seconds',updated_at=NOW() WHERE id=$1::uuid`,[id,state,error,providerReference]);
    }
    private async schema(tenantId:string):Promise<string> {
        if (!UUID.test(tenantId)) throw new Error('operational_notice_invalid_tenant');
        const tenant=await resolveReadyTenantContext(this.prisma,this.redis,tenantId);
        if (!tenant || !/^tenant_[a-z0-9_]+$/.test(tenant.schemaName) || tenant.schemaName.startsWith('tenant_eval_')) throw new Error('operational_notice_tenant_unavailable');
        return tenant.schemaName;
    }
}
