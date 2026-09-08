import { WidgetMessageStore, type WidgetMessageReference } from '../widget/widget-message-store.service';
import { widgetHandoffNotice } from '../widget/widget-handoff-messages';
import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { ChannelType, NormalizedMessage, OutboundMessage } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { HandoffService } from '../handoff/handoff.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ApprovalEffectSuppressed, type ApprovedEffectDeliveryPort, type ApprovedEffectReference, type ApprovedEffectTransport } from '../channels/approved-effect-delivery.port';
import { approvedEffectDescriptors, approvalMediaItems } from './tool-approval-effects.contracts';
import { assertServedAgentAuthority, assertServedAgentConnectionAuthority, validServedAgentAuthority, ServedAgentAuthorityError } from '../persona/served-agent-authority';
import { revisionHash } from '../evaluation-revision/evaluation-revision';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNELS = new Set(['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget']);
type Query = <T = any[]>(sql: string, params?: any[]) => Promise<T>;

/** Resumes only delivery, never the approved command. An uncertain external attempt is never resent. */
@Injectable()
export class ToolApprovalEffectsService implements ApprovedEffectDeliveryPort {
    constructor(private readonly prisma: PrismaService, private readonly outbound: OutboundQueueService,
        private readonly handoff: HandoffService, @Optional() private readonly widgetMessages?: WidgetMessageStore) {}

    async schedule(tenantId: string, ticketId: string): Promise<void> {
        if (!UUID.test(ticketId)) throw new Error('approval_effect_invalid_reference');
        const schema = await this.schema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT e.id FROM tool_approval_effects e JOIN tool_approval_tickets t ON t.id=e.ticket_id
             WHERE e.ticket_id=$1::uuid AND t.status='approved' AND t.resume_state='completed'
               AND e.state IN ('pending','queued','failed') AND e.attempts < 5
               AND e.next_attempt_at <= NOW()
               AND NOT EXISTS(SELECT 1 FROM customer_memory_erasure erased WHERE erased.contact_id=t.contact_id)
             ORDER BY e.kind,e.item_index`, [ticketId]);
        for (const row of rows) {
            // Safe to replay even if the outbox publisher crashes before committing its acknowledgement.
            await this.outbound.enqueueApprovedEffect({ tenantId, ticketId, effectId: row.id });
            await this.prisma.executeInTenantSchema(schema,
                `UPDATE tool_approval_effects SET state='queued',error_code=NULL,updated_at=NOW()
                 WHERE id=$1::uuid AND state IN ('pending','failed')`, [row.id]);
        }
    }

    async recoverTenant(tenantId: string): Promise<void> {
        const schema = await this.schema(tenantId);
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE tool_approval_effects e SET state=CASE WHEN e.kind <> 'handoff' AND EXISTS(
                SELECT 1 FROM tool_approval_tickets t JOIN tool_execution_ledger l ON l.id=t.execution_ledger_id
                WHERE t.id=e.ticket_id AND l.channel_type='web_widget') THEN 'failed' ELSE 'reconciliation_required' END,error_code='delivery_lease_expired',
                lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
             WHERE state='processing' AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())`);
        const tickets = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT DISTINCT ticket_id FROM tool_approval_effects
             WHERE state IN ('pending','queued','failed') AND attempts < 5 AND next_attempt_at <= NOW()
             LIMIT 100`);
        for (const ticket of tickets) await this.schedule(tenantId, ticket.ticket_id);
    }

    async deliver(reference: ApprovedEffectReference, transport: ApprovedEffectTransport): Promise<string | null> {
        if (![reference.ticketId, reference.effectId].every(id => UUID.test(id))) throw new Error('approval_effect_invalid_reference');
        const schema = await this.schema(reference.tenantId);
        const effect = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT e.kind,e.state,l.channel_type FROM tool_approval_effects e JOIN tool_approval_tickets t ON t.id=e.ticket_id
                JOIN tool_execution_ledger l ON l.id=t.execution_ledger_id WHERE e.id=$1::uuid AND t.id=$2::uuid`, [reference.effectId,reference.ticketId]);
        if (effect[0]?.channel_type === 'web_widget' && ['media','payment_link'].includes(effect[0]?.kind)) {
            if (['stored','sent','completed','suppressed','reconciliation_required'].includes(effect[0].state)) return `effect:${effect[0].state}`;
            return this.deliverApprovedWidget(reference, schema);
        }
        // Canonical handoff lazily prepares columns. Do that before our transaction
        // reads the conversation: cross-connection ALTER would otherwise deadlock.
        if (effect[0]?.kind === 'handoff') await this.handoff.prepareDelivery(reference.tenantId);
        const lease = randomUUID();
        // Persist the attempt BEFORE provider work, independently of its later transaction.
        const claim = await this.privacyTransaction(schema, async query => {
            const rows = await this.load(query, reference, true);
            const row = rows[0];
            if (!row) return 'missing';
            if (row.state === 'processing') {
                if (new Date(row.lease_expires_at).getTime() <= Date.now()) {
                    const safeLocal=row.channel_type==='web_widget'&&row.kind!=='handoff';
                    await this.finish(query,reference.effectId,safeLocal?'failed':'reconciliation_required','delivery_lease_expired');
                    return safeLocal?'retry_local':'reconciliation_required';
                }
                return 'processing';
            }
            if (!['pending', 'queued', 'failed'].includes(row.state) || Number(row.attempts) >= 5) return row.state;
            const invalid = this.invalidBinding(row);
            if (invalid) { await this.finish(query, reference.effectId, 'suppressed', invalid); return 'suppressed'; }
            await query(`UPDATE tool_approval_effects SET state='processing',attempts=attempts+1,lease_token=$2::uuid,
                lease_expires_at=NOW()+INTERVAL '120 seconds',error_code=NULL,updated_at=NOW() WHERE id=$1::uuid`, [reference.effectId, lease]);
            return 'claimed';
        });
        if (claim === 'processing') throw new Error('approval_effect_in_progress');
        if (claim === 'retry_local') throw new Error('approval_effect_preflight_failed');
        if (claim !== 'claimed') return `effect:${claim}`;

        let widgetReference: WidgetMessageReference | undefined;
        const outcome = await this.privacyTransaction(schema, async query => {
            let row = (await this.load(query, reference, true))[0];
            if (row?.kind !== 'handoff' && row?.conversation_id) await query('SELECT id FROM conversations WHERE id=$1::uuid FOR UPDATE', [row.conversation_id]);
            if (row?.kind !== 'handoff' && row?.contact_id) await query('SELECT id FROM contacts WHERE id=$1::uuid FOR UPDATE', [row.contact_id]);
            row = (await this.load(query, reference, true))[0];
            if (!row || row.state !== 'processing' || row.lease_token !== lease) return { value: 'effect:lease_lost' };
            if (new Date(row.lease_expires_at).getTime() <= Date.now()) {
                const safeLocal=row.channel_type==='web_widget'&&row.kind!=='handoff';
                await this.finish(query, reference.effectId, safeLocal?'failed':'reconciliation_required', 'delivery_lease_expired');
                return { value: safeLocal?'effect:failed':'effect:reconciliation_required', retry: safeLocal };
            }
            const invalid = this.invalidBinding(row);
            if (invalid) { await this.finish(query, reference.effectId, 'suppressed', invalid); return { value: 'effect:suppressed' }; }
            // A channel changed after initial classification. Never let it enter
            // the local writer without the operational authority transaction.
            if (row.channel_type === 'web_widget' && ['media','payment_link'].includes(row.kind)) {
                await this.finish(query, reference.effectId, 'suppressed', 'approval_effect_binding_changed');
                return { value: 'effect:suppressed' };
            }
            const active = await query<any[]>('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=$2 AND is_active=true FOR SHARE', [reference.tenantId,schema]);
            if (!active[0]) { await this.finish(query, reference.effectId, 'suppressed', 'approval_effect_tenant_unavailable'); return { value: 'effect:suppressed' }; }
            let started = false;
            try {
                const descriptors = approvedEffectDescriptors(row.tool_name, row.ledger_status, row.response_payload || {});
                if (!descriptors.some(item => item.kind === row.kind && item.itemIndex === row.item_index)) {
                    throw new ApprovalEffectSuppressed('approval_effect_result_changed');
                }
                const outbound = await this.hydrate(query, reference, row);
                const widget=row.channel_type==='web_widget';
                let widgetBinding:any;
                if(widget){
                    if(!this.widgetMessages)throw new ApprovalEffectSuppressed('widget_delivery_unavailable');
                    await this.widgetMessages.assertAvailable(reference.tenantId);
                    widgetBinding=await this.widgetMessages.assertConversation(query,schema,reference.tenantId,row.conversation_id,row.contact_id);
                }
                const storeWidget = async (content: OutboundMessage['content']) => {
                    const message=await this.widgetMessages!.persistWithQuery(query,schema,reference.tenantId,{
                        conversationId:row.conversation_id,contactId:row.contact_id,content,source:'approval',
                        dedupeId:`approval:${reference.effectId}`,approvalEffectId:reference.effectId});
                    await this.finish(query,reference.effectId,'stored');
                    widgetReference={tenantId:reference.tenantId,conversationId:row.conversation_id,messageId:message.id};
                    return {value:'effect:stored'};
                };
                const send = widget ? null : await transport.prepare(outbound);
                const stillActive = async () => {
                    const activeLease = await query<any[]>(`SELECT id FROM tool_approval_effects WHERE id=$1::uuid AND lease_token=$2::uuid AND state='processing' AND lease_expires_at>NOW()`, [reference.effectId,lease]);
                    if (!activeLease[0]) throw new Error('approval_effect_lease_lost');
                };
                await stillActive();
                if (row.kind === 'handoff') {
                    // Existing canonical handoff owns routing, notes and notifications. Its partial
                    // failure cannot safely be retried, because these downstream effects lack receipts.
                    started = true;
                    const message: NormalizedMessage = {
                        id: reference.effectId, tenantId: reference.tenantId, conversationId: row.conversation_id,
                        contactId: row.external_id, channelType: row.channel_type as ChannelType,
                        channelAccountId: row.channel_account_id, direction: 'inbound', status: 'delivered',
                        content: { type: 'text', text: '' }, timestamp: new Date(), metadata: { approvalTicketId: reference.ticketId },
                    };
                    await this.handoff.executeHandoff(reference.tenantId, row.conversation_id, message,
                        `Approved tool: ${row.tool_name}`, { beforeSideEffect: stillActive, awaitNotifications: true });
                    if(widget)return await storeWidget({type:'text',text:widgetHandoffNotice(widgetBinding?.locale)});
                    await this.finish(query, reference.effectId, 'completed');
                    return { value: 'effect:completed' };
                }
                if(widget)return await storeWidget(outbound.content);
                started = true;
                const providerId = await send!();
                if (!providerId) throw new Error('approval_effect_provider_no_receipt');
                await this.finish(query, reference.effectId, 'sent');
                return { value: `effect:sent:${reference.effectId}` };
            } catch (error) {
                const suppressed = error instanceof ApprovalEffectSuppressed;
                const state = started ? 'reconciliation_required' : suppressed ? 'suppressed' : 'failed';
                const code = started ? 'delivery_outcome_unknown' : suppressed ? error.code : 'delivery_preflight_failed';
                await this.finish(query, reference.effectId, state, code);
                return { value: `effect:${state}`, retry: state === 'failed' };
            }
        });
        if (widgetReference) this.widgetMessages!.publish(widgetReference);
        if (outcome.retry) throw new Error('approval_effect_preflight_failed');
        return outcome.value;
    }

    /** Local delivery has no provider boundary: authority, message and receipt
     * commit together. Accepted receipts are historical facts, not new actions. */
    private async deliverApprovedWidget(reference: ApprovedEffectReference, schema: string): Promise<string> {
        let availabilityError: unknown;
        try {
            if (!this.widgetMessages) throw new Error('widget_delivery_unavailable');
            await this.widgetMessages.assertAvailable(reference.tenantId);
        } catch (error) { availabilityError = error; }
        let published: WidgetMessageReference | undefined;
        let failureReceipt: {state:string; attempts:number; updatedAt:string; scope:any} | undefined;
        let outcome: {value:string; retry?:boolean};
        try { outcome = await this.privacyTransaction(schema, async query => {
            const before = (await this.load(query, reference, false))[0];
            if (!before) return { value: 'effect:missing' };
            const terminal = (state: string) => ['stored','sent','completed','suppressed','reconciliation_required'].includes(state);
            if (terminal(before.state)) return { value: `effect:${before.state}` };
            const authorityHash = this.widgetAuthorityHash(before);
            let authorityError = this.widgetAuthorityError(before, schema, reference.tenantId);
            // No effect/ticket/ledger/conversation row locks before tenant/agent.
            if (!authorityError) {
                try { await assertServedAgentConnectionAuthority(query, schema, before.operational_scope,
                    before.channel_type, before.channel_account_id); }
                catch (error) {
                    if (!(error instanceof ServedAgentAuthorityError)) throw error;
                    authorityError = error.code;
                }
            } else {
                await query('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=$2 FOR SHARE', [reference.tenantId,schema]);
            }
            let row = (await this.load(query, reference, true))[0];
            if (!row) return { value: 'effect:missing' };
            if (terminal(row.state)) return { value: `effect:${row.state}` };
            if (row.state === 'processing') {
                if (new Date(row.lease_expires_at).getTime() > Date.now()) throw new Error('approval_effect_in_progress');
                await this.finish(query, reference.effectId, 'failed', 'delivery_lease_expired');
                return { value: 'effect:failed', retry: true };
            }
            if (!['pending','queued','failed'].includes(row.state) || Number(row.attempts) >= 5) return { value: `effect:${row.state}` };
            if (authorityHash !== this.widgetAuthorityHash(row)) authorityError = 'approval_effect_authority_changed';
            if (authorityError) {
                await this.finish(query, reference.effectId, 'suppressed', authorityError);
                return { value: 'effect:suppressed' };
            }
            if (row.conversation_id) await query('SELECT id FROM conversations WHERE id=$1::uuid FOR UPDATE', [row.conversation_id]);
            if (row.contact_id) await query('SELECT id FROM contacts WHERE id=$1::uuid FOR UPDATE', [row.contact_id]);
            row = (await this.load(query, reference, true))[0];
            const invalid = this.invalidBinding(row) || (authorityHash !== this.widgetAuthorityHash(row) ? 'approval_effect_authority_changed' : null);
            if (invalid) { await this.finish(query, reference.effectId, 'suppressed', invalid); return { value: 'effect:suppressed' }; }
            failureReceipt = {state:row.state,attempts:Number(row.attempts),updatedAt:row.effect_updated_at,scope:row.operational_scope};
            if (availabilityError) throw availabilityError;
            try {
                if (row.channel_type !== 'web_widget' || row.ledger_channel_type !== 'web_widget'
                    || !['media','payment_link'].includes(row.kind)) throw new ApprovalEffectSuppressed('approval_effect_binding_changed');
                if (!approvedEffectDescriptors(row.tool_name,row.ledger_status,row.response_payload || {})
                    .some(item => item.kind === row.kind && item.itemIndex === row.item_index))
                    throw new ApprovalEffectSuppressed('approval_effect_result_changed');
                if (!this.widgetMessages) throw new ApprovalEffectSuppressed('widget_delivery_unavailable');
                const outbound = await this.hydrate(query, reference, row);
                await query('UPDATE tool_approval_effects SET attempts=attempts+1 WHERE id=$1::uuid', [reference.effectId]);
                const message = await this.widgetMessages.persistWithQuery(query,schema,reference.tenantId,{
                    conversationId:row.conversation_id,contactId:row.contact_id,content:outbound.content,source:'approval',
                    dedupeId:`approval:${reference.effectId}`,approvalEffectId:reference.effectId });
                await this.finish(query,reference.effectId,'stored');
                published = {tenantId:reference.tenantId,conversationId:row.conversation_id,messageId:message.id};
                return {value:'effect:stored'};
            } catch (error) {
                if (!(error instanceof ApprovalEffectSuppressed)) throw error; // SQL failures roll back message and receipt together.
                await this.finish(query, reference.effectId, 'suppressed', error.code);
                return { value: 'effect:suppressed' };
            }
        }); } catch (error) {
            // SQL rollback restores attempts too. Record bounded retry metadata
            // separately, but never degrade an accepted or replaced receipt.
            if (failureReceipt) await this.privacyTransaction(schema, async query => {
                try { await assertServedAgentAuthority(query, schema, failureReceipt!.scope); }
                catch (changed) { if (!(changed instanceof ServedAgentAuthorityError)) throw changed; }
                await query(`UPDATE tool_approval_effects SET state='failed',attempts=attempts+1,error_code='delivery_preflight_failed',
                    next_attempt_at=NOW()+INTERVAL '60 seconds',updated_at=NOW()
                    WHERE id=$1::uuid AND ticket_id=$2::uuid AND state=$3 AND state IN ('pending','queued','failed')
                        AND attempts=$4 AND updated_at=$5::timestamptz`,
                [reference.effectId,reference.ticketId,failureReceipt!.state,failureReceipt!.attempts,failureReceipt!.updatedAt]);
            }).catch(() => undefined);
            throw error;
        }
        if (published) this.widgetMessages!.publish(published);
        if (outcome.retry) throw new Error('approval_effect_preflight_failed');
        return outcome.value;
    }

    private widgetAuthorityHash(row: any): string {
        return revisionHash({scope:row.operational_scope ?? null,draft:row.draft_review ?? null,
            ledger:row.execution_ledger_id,kind:row.kind,channel:row.channel_type,account:row.channel_account_id,
            ledgerChannel:row.ledger_channel_type});
    }

    private widgetAuthorityError(row: any, schema: string, tenantId: string): string | null {
        const scope = row.operational_scope, draft = row.draft_review;
        if (!validServedAgentAuthority(scope,schema,tenantId)) return 'approval_effect_authority_required';
        if (scope.kind === 'legacy') return draft ? 'approval_effect_authority_mismatch' : null;
        // The ledger's server-owned scope is this proposal's origin. Conversation
        // attribution retains its first agent for analytics, even after another
        // agent legitimately serves and receives approval for a new action.
        if (draft) return draft.agentId === scope.agentId && draft.agentVersion === scope.version ? null : 'approval_effect_authority_mismatch';
        return null;
    }

    private async hydrate(query: Query, reference: ApprovedEffectReference, row: any): Promise<OutboundMessage> {
        if (!CHANNELS.has(row.channel_type)) throw new ApprovalEffectSuppressed('approval_effect_channel_unsupported');
        const base: OutboundMessage = { tenantId: reference.tenantId, channelType: row.channel_type,
            channelAccountId: row.channel_account_id, to: row.external_id, content: { type: 'text' },
            metadata: { approvalTicketId: reference.ticketId, approvalEffectId: reference.effectId, approvalEffectKind: row.kind, conversationId: row.conversation_id } };
        if (row.kind === 'handoff') return base;
        const result = row.response_payload || {};
        if (row.kind === 'media') {
            const item = approvalMediaItems(result)[row.item_index];
            if (!this.https(item?.url)) throw new ApprovalEffectSuppressed('approval_effect_invalid_media');
            return { ...base, content: { type: 'image', mediaUrl: item.url,
                ...(typeof item.caption === 'string' ? { caption: item.caption.slice(0, 2000) } : {}) } };
        }
        if (!UUID.test(result.operationId || '') || !this.https(result.paymentLink)) {
            throw new ApprovalEffectSuppressed('approval_effect_invalid_payment_link');
        }
        const payments = await query<any[]>(`SELECT response_payload FROM payment_operation_ledger
            WHERE id=$1::uuid AND execution_ledger_id=$2::uuid AND operation_kind='payment_link' AND status='succeeded'`,
        [result.operationId, row.execution_ledger_id]);
        const canonical = payments[0]?.response_payload;
        if (!canonical || canonical.paymentLink !== result.paymentLink || canonical.linkCreated !== true
            || canonical.paymentStatus !== 'pending' || canonical.paid !== false) {
            throw new ApprovalEffectSuppressed('approval_effect_payment_link_unverified');
        }
        return { ...base, content: { type: 'text', text: canonical.paymentLink } };
    }

    private invalidBinding(row: any): string | null {
        if (row.erased || !row.contact_id || !row.conversation_id || !row.external_id) return 'approval_effect_contact_unavailable';
        if (row.ticket_status !== 'approved' || row.resume_state !== 'completed') return 'approval_effect_not_approved';
        if (row.contact_id !== row.ledger_contact_id || row.contact_id !== row.conversation_contact_id
            || row.conversation_id !== row.ledger_conversation_id || row.channel_type !== row.contact_channel_type
            || row.ledger_channel_type !== row.channel_type || !row.channel_account_id) return 'approval_effect_binding_changed';
        if (['closed', 'resolved', 'archived'].includes(row.conversation_status)) return 'approval_effect_conversation_closed';
        return null;
    }

    private load(query: Query, reference: ApprovedEffectReference, lock: boolean): Promise<any[]> {
        return query(`SELECT e.*,e.updated_at::text AS effect_updated_at, t.status AS ticket_status,t.resume_state,t.contact_id,t.conversation_id,t.execution_ledger_id,
            l.tool_name,l.status AS ledger_status,l.response_payload,l.contact_id AS ledger_contact_id,
            l.request_payload->'operationalScope' AS operational_scope,l.request_payload->'draftReview' AS draft_review,
            l.conversation_id AS ledger_conversation_id,l.channel_type AS ledger_channel_type,
            c.contact_id AS conversation_contact_id,c.channel_type,c.channel_account_id,c.status AS conversation_status,
            contact.external_id,contact.channel_type AS contact_channel_type,
            EXISTS(SELECT 1 FROM customer_memory_erasure erased WHERE erased.contact_id=t.contact_id) AS erased
            FROM tool_approval_effects e JOIN tool_approval_tickets t ON t.id=e.ticket_id
            JOIN tool_execution_ledger l ON l.id=t.execution_ledger_id
            LEFT JOIN conversations c ON c.id=t.conversation_id LEFT JOIN contacts contact ON contact.id=t.contact_id
            WHERE e.id=$1::uuid AND t.id=$2::uuid ${lock ? 'FOR UPDATE OF e, t, l' : ''}`, [reference.effectId, reference.ticketId]);
    }

    private finish(query: Query, id: string, state: string, error?: string) {
        return query(`UPDATE tool_approval_effects SET state=$2::text,error_code=$3,lease_token=NULL,lease_expires_at=NULL,
            completed_at=CASE WHEN $2::text IN ('sent','stored','completed','suppressed') THEN NOW() ELSE NULL END,
            next_attempt_at=NOW()+INTERVAL '60 seconds',updated_at=NOW() WHERE id=$1::uuid`, [id, state, error || null]);
    }
    private privacyTransaction<T>(schema: string, callback: (query: Query) => Promise<T>): Promise<T> {
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text`, [`agent-privacy:${schema}`]);
            return callback(query);
        }, { timeout: 110_000 });
    }
    private async schema(tenantId: string): Promise<string> {
        if (!UUID.test(tenantId)) throw new Error('approval_effect_invalid_reference');
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { schemaName: true, isActive: true } });
        if (!tenant?.isActive || !tenant.schemaName || !/^tenant_[a-z0-9_]+$/.test(tenant.schemaName)
            || tenant.schemaName.startsWith('tenant_eval_')) throw new Error('approval_effect_tenant_unavailable');
        return tenant.schemaName;
    }
    private https(value: unknown): value is string {
        try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password; }
        catch { return false; }
    }
}
