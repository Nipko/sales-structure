import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { PersonaService } from '../persona/persona.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { ConversationsGateway } from './conversations.gateway';
import { HandoffService } from '../handoff/handoff.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LeadScoringService } from '../crm/services/lead-scoring/lead-scoring.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { NurturingService } from '../automation/nurturing.service';
import { DripSequenceService } from '../automation/drip-sequence.service';
import { NormalizedMessage, OutboundMessage, TenantConfig, TurnContext, RetrievedKnowledgeItem, ModelTier } from '@parallext/shared';
import { IdentityService } from '../identity/identity.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { ResponseValidatorService } from './response-validator.service';
import { CustomerMemoryService } from './customer-memory.service';
import { APPOINTMENT_TOOLS } from './tools/appointment-tools';
import { CATALOG_TOOLS, OFFER_TOOL } from './tools/catalog-tools';
import { FAQ_TOOL, POLICY_TOOL, KB_TOOL } from './tools/knowledge-tools';
import { ORDER_TOOL, CUSTOMER_CONTEXT_TOOL } from './tools/crm-tools';
import { ECOMMERCE_TOOLS, APPLY_DISCOUNT_TOOL } from './tools/ecommerce-tools';
import { GET_RESTAURANT_MENU_TOOL, GET_FITNESS_SCHEDULE_TOOL, LIST_CLINIC_SERVICES_TOOL, CHECK_CLINIC_AVAILABILITY_TOOL } from './tools/vertical-integration-tools';
import { VerticalIntegrationsService } from '../vertical-integrations/vertical-integrations.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { AttributionService } from '../attribution/attribution.service';
import { VACATION_RENTAL_TOOLS } from './tools/vacation-rental-tools';
import { TOURS_TOOLS } from './tools/tours-tools';
import { TREATMENT_TOOLS } from './tools/treatment-tools';
import { LISTINGS_TOOLS } from './tools/listings-tools';
import { VEHICLE_TOOLS } from './tools/vehicle-tools';
import { PETS_TOOLS } from './tools/pets-tools';
import { RESTAURANTS_TOOLS } from './tools/restaurants-tools';
import { GYMS_TOOLS } from './tools/gyms-tools';
import { EDUCATION_TOOLS } from './tools/education-tools';
import { INSURANCE_TOOLS } from './tools/insurance-tools';
import { HOME_SERVICES_TOOLS, PET_SERVICES_TOOLS, PHOTOGRAPHY_TOOLS } from './tools/tier3-tools';
import { BookingEngineService, type BookingState } from './booking-engine.service';
import { ProcedureEngineService } from './procedure-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import { PromptAssemblerService } from './prompt-assembler.service';
import { LanguageDetectorService } from './language-detector.service';
import { BusinessInfoService } from '../business-info/business-info.service';
import { ComplianceService as AnalyticsComplianceService } from '../analytics/compliance.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { MediaProcessingService } from '../media-processing/media-processing.service';
import { AiResolutionService } from '../analytics/ai-resolution.service';

/** Max characters of history to send to the LLM to avoid exceeding context window */
const MAX_HISTORY_CHARS = 12_000;
// Returned when the LLM pipeline errors out. Sent to the customer but NOT counted
// as a successful AI response (no monthly-quota increment, no message_sent event).
const ERROR_FALLBACK_MSG = 'Disculpa, tuve un problema procesando tu mensaje. ¿Podrías repetirlo?';
// Per-tool execution ceiling — a single tool (esp. an external MCP server) must
// never hang the whole conversational turn.
const TOOL_TIMEOUT_MS = 25_000;
// Tools with write side-effects. When the LLM requests more than one of these in
// the SAME turn we fall back to sequential execution: two writers can race on the
// same resource (e.g. two create_appointment / create_*_booking on the same slot →
// double booking, or two place_order). Read-only tools (everything not listed
// here, incl. checks/searches/list_*) are always safe to run concurrently.
// External MCP tools (mcp__*) are treated as writers (unknown side-effects).
const WRITE_TOOLS = new Set<string>([
    // appointments / calendar
    'create_appointment', 'cancel_appointment', 'reschedule_appointment',
    // vacation rental
    'create_property_booking', 'cancel_property_booking',
    // tours
    'create_tour_booking', 'cancel_tour_booking',
    // restaurants / ecommerce orders
    'place_order', 'cancel_order',
    // gyms
    'book_class', 'freeze_membership', 'cancel_class_booking',
    // education
    'enroll_student', 'cancel_enrollment',
    // insurance
    'file_claim', 'cancel_quote',
    // home services
    'create_service_request', 'cancel_service_request',
    // pets / photography
    'register_pet', 'update_pet', 'request_photo_quote', 'cancel_photo_session',
]);
/** A tool call mutates state (or is an opaque external MCP tool) → must not run concurrently with other writers. */
const isWriteTool = (name: string): boolean => name.startsWith('mcp__') || WRITE_TOOLS.has(name);
// Burst debounce window: WhatsApp users send a thought across several quick
// messages. We wait this long for follow-ups and process the batch as one turn.
const DEBOUNCE_MS = 800;

@Injectable()
export class ConversationsService {
    private readonly logger = new Logger(ConversationsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private personaService: PersonaService,
        private llmRouter: LLMRouterService,
        private channelGateway: ChannelGatewayService,
        private outboundQueue: OutboundQueueService,
        private channelToken: ChannelTokenService,
        private gateway: ConversationsGateway,
        private handoffService: HandoffService,
        private knowledgeService: KnowledgeService,
        private leadScoring: LeadScoringService,
        private pipelineService: PipelineService,
        private eventEmitter: EventEmitter2,
        private nurturingService: NurturingService,
        private dripSequenceService: DripSequenceService,
        private identityService: IdentityService,
        private toolExecutor: AIToolExecutorService,
        private responseValidator: ResponseValidatorService,
        private customerMemory: CustomerMemoryService,
        private bookingEngine: BookingEngineService,
        private procedureEngine: ProcedureEngineService,
        private intentInterpreter: IntentInterpreterService,
        private complianceService: AnalyticsComplianceService,
        private analyticsService: AnalyticsService,
        private promptAssembler: PromptAssemblerService,
        private languageDetector: LanguageDetectorService,
        private businessInfoService: BusinessInfoService,
        private throttle: TenantThrottleService,
        private mediaProcessing: MediaProcessingService,
        private aiResolutionService: AiResolutionService,
        private verticalIntegrations: VerticalIntegrationsService,
        private mcpClient: McpClientService,
        private attributionService: AttributionService,
    ) {}

    /**
     * Main entry point for incoming messages from any channel
     */
    async processIncomingMessage(normalizedMsg: NormalizedMessage): Promise<void> {
        const { tenantId, contactId, channelType, content } = normalizedMsg;
        this.logger.log(`Processing inbound message from ${contactId} on ${channelType} for tenant ${tenantId}`);

        // Server-clock receipt time (transient, not persisted) for the customer→reply
        // latency metric — avoids mixing the provider's clock (msg.timestamp) with the
        // worker's clock at send time. Same VPS for API + worker → negligible skew.
        (normalizedMsg as any).receivedAt = Date.now();

        // 0. Debounce bursts: WhatsApp users often send one thought as 3-5 short
        // messages. Buffer them and process the batch as ONE turn (less LLM cost,
        // no interleaved/double replies, better intent). Returns the combined text
        // for the LAST message of the burst; the earlier ones bail here.
        const combined = await this.debounceBurst(normalizedMsg).catch(() => undefined);
        if (combined === null) return; // a newer message arrived — it will flush the batch
        if (combined !== undefined) normalizedMsg.content.text = combined;

        // 1. Resolve Contact & Conversation.
        // Serialize find-or-create per contact: two near-simultaneous first
        // messages would otherwise each create a duplicate lead/conversation.
        // The conversation lock below can't prevent this — it keys on
        // conversation.id, which doesn't exist yet at this point.
        const contactLockKey = `lock:contact:${tenantId}:${channelType}:${contactId}`;
        let contactLockToken: string | null = null;
        for (let i = 0; i < 6 && !contactLockToken; i++) {
            contactLockToken = await this.redis.acquireLockToken(contactLockKey, 10).catch(() => null);
            if (!contactLockToken) await new Promise(r => setTimeout(r, 300));
        }
        let resolved: { contact: any; lead: any; conversation: any };
        try {
            resolved = await this.resolveConversation(tenantId, contactId, channelType, normalizedMsg);
        } finally {
            if (contactLockToken) await this.redis.releaseLockToken(contactLockKey, contactLockToken).catch(() => {});
        }
        const { contact, lead, conversation } = resolved;
        normalizedMsg.conversationId = conversation.id;

        // Click-to-WhatsApp ads attribution (T3.22): capture the ad referral on
        // the first ad-originated message. Best-effort, never blocks the pipeline.
        const referral = (normalizedMsg.metadata as any)?.referral;
        if (referral && contact?.id) {
            this.attributionService.captureReferral(tenantId, {
                contactId: contact.id, conversationId: conversation.id, referral,
            }).catch(() => {});
        }

        // Serialize message processing per conversation to prevent race conditions.
        // If a user sends 2 messages in quick succession, the second waits for the
        // first. The lock uses an ownership token so the release can't delete a
        // lock re-acquired by another turn after a TTL expiry, and a heartbeat
        // renews the TTL so a long turn (media + LLM fallback chains) never loses
        // the lock mid-flight.
        const lockKey = `lock:conv:${conversation.id}`;
        const LOCK_TTL = 30;
        let lockToken = await this.redis.acquireLockToken(lockKey, LOCK_TTL);
        if (!lockToken) {
            // Another message is being processed — wait (budget > TTL) for it to finish.
            for (let i = 0; i < 18; i++) {
                await new Promise(r => setTimeout(r, 2000));
                lockToken = await this.redis.acquireLockToken(lockKey, LOCK_TTL);
                if (lockToken) break;
            }
            if (!lockToken) {
                this.logger.warn(`[Pipeline] Could not acquire lock for conversation ${conversation.id} after waiting — processing anyway`);
            }
        }
        // Heartbeat: keep the lock alive while we process so a turn that legitimately
        // exceeds the TTL doesn't expire its lock and let a concurrent turn in.
        let lockHeartbeat: ReturnType<typeof setInterval> | undefined;
        if (lockToken) {
            const token = lockToken;
            lockHeartbeat = setInterval(() => {
                this.redis.renewLockToken(lockKey, token, LOCK_TTL).catch(() => {});
            }, 10_000);
            lockHeartbeat.unref?.();
        }

        try {

        const schemaName = await this.tenantSchema(tenantId);

        // Re-read the conversation snapshot AFTER acquiring the lock. While we
        // waited, the turn that held the lock may have changed status (e.g.
        // escalated to handoff) or bumped updated_at. The pre-lock snapshot from
        // resolveConversation can be stale, which would mis-route the handoff and
        // new-session checks below.
        try {
            const fresh = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT status, updated_at FROM conversations WHERE id = $1::uuid`,
                [conversation.id],
            );
            if (fresh?.length) {
                conversation.status = fresh[0].status;
                conversation.updated_at = fresh[0].updated_at;
            }
        } catch (e: any) {
            this.logger.debug(`[Pipeline] Snapshot re-read skipped: ${e.message}`);
        }

        // Capture the timestamp of the last message BEFORE we save the new one.
        // This is used later for new-session detection (30 min gap = fresh start).
        const previousMessageAt = conversation.updated_at || conversation.created_at;

        // Track conversation event (contactId here is the normalized external id
        // like a phone number — analytics needs the internal UUID)
        this.analyticsService.trackEvent({
            tenantId, eventType: 'conversation_started',
            conversationId: conversation.id, contactId: contact.id,
            data: { channelType },
        }).catch(() => {});

        // Cancel any pending nurturing follow-ups — customer responded
        this.nurturingService.cancelFollowUp(tenantId, conversation.id).catch(e =>
            this.logger.warn(`Nurturing cancel failed (non-fatal): ${e.message}`),
        );

        // Stop drip sequences when customer replies
        this.dripSequenceService.stopOnReply(tenantId, conversation.id).catch(e =>
            this.logger.warn(`Drip stop-on-reply failed (non-fatal): ${(e as Error).message}`),
        );

        // Auto-progress stage from 'nuevo' to 'respondio' upon user message
        // (schemaName resolved above, right after acquiring the lock).
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE opportunities SET stage = 'respondio' WHERE conversation_id = $1::uuid AND stage = 'nuevo'`,
            [conversation.id],
        );
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE leads
             SET stage = 'respondio'
             WHERE id = (SELECT lead_id FROM opportunities WHERE conversation_id = $1::uuid LIMIT 1)
               AND stage = 'nuevo'`,
            [conversation.id],
        );

        if (lead?.id) {
            await this.pipelineService.syncOpportunityToDeal(tenantId, String(lead.id), 'respondio').catch(e =>
                this.logger.error(`Failed to sync opportunity to deal on customer reply: ${e.message}`)
            );
        }

        // 2. Load Persona & Check Business Hours
        const config = await this.personaService.getPersonaForChannel(tenantId, channelType);
        this.logger.log(`[Pipeline] Persona loaded: ${config?.persona?.name || 'default'} (mode: ${(config as any)?._mode || 'wizard'})`);

        if (!config) {
            this.logger.error(`No active persona found for tenant ${tenantId}`);
            return;
        }

        const bizHours = await this.loadTenantBusinessHours(tenantId);
        const isOpen = this.isWithinBusinessHours(config, bizHours);
        const aiOutsideHours = config.hours?.aiOutsideHours ?? true;

        if (!isOpen && !aiOutsideHours) {
            this.logger.log(`[Pipeline] Outside business hours & AI off — sending after-hours message`);
            const afterHoursMsg = config.hours?.afterHoursMessageOverride || bizHours?.afterHoursMessage || config.hours?.afterHoursMessage;
            await this.sendAfterHoursMessage(tenantId, normalizedMsg, config, afterHoursMsg);
            return;
        }

        // 3. Check if in human handoff mode — skip AI, just save message
        if (conversation.status === 'waiting_human' || conversation.status === 'with_human') {
            this.logger.log(`Conversation ${conversation.id} is in HUMAN HANDOFF mode. Skipping AI.`);
            await this.saveMessage(tenantId, conversation.id, normalizedMsg);
            return;
        }

        // 4. Save User Message
        const inboundMessageId = await this.saveMessage(tenantId, conversation.id, normalizedMsg);
        this.logger.log(`[Pipeline] Message saved for conversation ${conversation.id}`);

        // 4.2 Check if this is a response to an appointment reminder template (Confirm/Reschedule buttons)
        if (content?.text) {
            const btnText = content.text.toLowerCase().trim();
            const isConfirmBtn = /^(✅\s*)?(confirmar asistencia|confirm attendance|confirmar presen[çc]a|confirmer)/i.test(btnText);
            const isRescheduleBtn = /^(🔄\s*)?(reagendar|reschedule|remarcar|reporter)/i.test(btnText);

            if (isConfirmBtn || isRescheduleBtn) {
                try {
                    const upcomingAppt = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                        `SELECT id, service_name FROM appointments
                         WHERE contact_id = $1::uuid
                           AND status IN ('pending', 'confirmed')
                           AND start_at > NOW()
                         ORDER BY start_at ASC LIMIT 1`,
                        [contact.id],
                    );
                    if (upcomingAppt?.length > 0) {
                        if (isConfirmBtn) {
                            await this.prisma.executeInTenantSchema(schemaName,
                                `UPDATE appointments SET status = 'confirmed', updated_at = NOW() WHERE id = $1::uuid`,
                                [upcomingAppt[0].id],
                            );
                            this.logger.log(`[Reminder] Client confirmed appointment ${upcomingAppt[0].id}`);
                            const confirmMsg = `¡Perfecto! Tu cita de *${upcomingAppt[0].service_name}* ha sido confirmada. ¡Te esperamos!`;
                            await this.sendResponse(tenantId, confirmMsg, normalizedMsg);
                            await this.saveAiMessage(tenantId, conversation.id, confirmMsg, normalizedMsg.channelType);
                        } else {
                            this.logger.log(`[Reminder] Client wants to reschedule appointment ${upcomingAppt[0].id}`);
                            const tenantRows = await this.prisma.$queryRawUnsafe(
                                `SELECT slug FROM tenants WHERE id = $1::uuid LIMIT 1`, tenantId,
                            ) as any[];
                            const slug = tenantRows?.[0]?.slug;
                            const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://admin.parallly-chat.cloud';
                            const bookingLink = slug ? `${dashboardUrl}/book/${slug}` : '';
                            const rescheduleMsg = bookingLink
                                ? `¡Claro! Puedes reagendar tu cita aquí: ${bookingLink}\n\nSi prefieres, dime el día y hora que te convenga y te ayudo.`
                                : `¡Claro! Dime el día y hora que te convenga y te ayudo a reagendar tu cita.`;
                            await this.sendResponse(tenantId, rescheduleMsg, normalizedMsg);
                            await this.saveAiMessage(tenantId, conversation.id, rescheduleMsg, normalizedMsg.channelType);
                        }
                        return;
                    }
                } catch (e: any) {
                    this.logger.warn(`Reminder button handler failed (non-fatal): ${e.message}`);
                }
            }
        }

        // 4.3 Check if this is a response to an attendance confirmation
        if (content?.text) {
            const textLower = content.text.toLowerCase().trim();
            const cleanText = textLower.replace(/^[✅❌🔄\s]+/, '');
            const isYes = /^(s[ií]|yes|sim|oui|claro|por supuesto|asist[ií]|fui|s[ií],?\s*asist[ií]|confirmar asistencia|confirm attendance|confirmar presen[çc]a|confirmer|yes,?\s*i attended|sim,?\s*compareci|oui,?\s*j'y [eé]tais)\b/i.test(cleanText);
            const isNo = /^(no|n[aã]o|non|no pude|no asist[ií]|no fui|no pude asistir|could not attend|n[aã]o pude ir|je n'ai pas pu)\b/i.test(cleanText);

            if (isYes || isNo) {
                try {
                    const pendingAppt = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                        `SELECT id, service_name FROM appointments
                         WHERE contact_id = $1::uuid
                           AND status IN ('pending', 'confirmed')
                           AND no_show_followed_up = true
                           AND end_at < NOW()
                           AND end_at > NOW() - INTERVAL '48 hours'
                         ORDER BY end_at DESC LIMIT 1`,
                        [contact.id],
                    );
                    if (pendingAppt?.length > 0) {
                        const apptId = pendingAppt[0].id;
                        if (isYes) {
                            await this.prisma.executeInTenantSchema(schemaName,
                                `UPDATE appointments SET status = 'completed', completed_at = NOW(), completed_by = 'client', updated_at = NOW() WHERE id = $1::uuid`,
                                [apptId],
                            );
                            this.logger.log(`[Attendance] Client confirmed attendance for appointment ${apptId}`);
                            const thankYou = `¡Excelente! Gracias por confirmar tu asistencia a *${pendingAppt[0].service_name}*. ¿Hay algo más en lo que pueda ayudarte?`;
                            await this.sendResponse(tenantId, thankYou, normalizedMsg);
                            await this.saveAiMessage(tenantId, conversation.id, thankYou, normalizedMsg.channelType);
                        } else {
                            await this.prisma.executeInTenantSchema(schemaName,
                                `UPDATE appointments SET status = 'no_show', updated_at = NOW() WHERE id = $1::uuid`,
                                [apptId],
                            );
                            this.logger.log(`[Attendance] Client confirmed no-show for appointment ${apptId}`);
                            const noShowMsg = `Entendido. Lamentamos que no hayas podido asistir a *${pendingAppt[0].service_name}*. ¿Te gustaría agendar una nueva cita?`;
                            await this.sendResponse(tenantId, noShowMsg, normalizedMsg);
                            await this.saveAiMessage(tenantId, conversation.id, noShowMsg, normalizedMsg.channelType);
                        }
                        return; // Don't process through AI — attendance handled
                    }
                } catch (e: any) {
                    this.logger.warn(`Attendance check failed (non-fatal): ${e.message}`);
                }
            }
        }

        // 4.5 Opt-out detection (all channels)
        if (content?.text && this.complianceService.detectOptOut(content.text)) {
            this.logger.warn(`Opt-out detected from ${contactId} on ${channelType}`);
            await this.complianceService.processOptOut(tenantId, {
                leadId: lead?.id,
                phone: contactId,
                channel: channelType,
                triggerMessage: content.text,
                detectedFrom: 'keyword',
            }).catch(e => this.logger.warn(`Opt-out processing failed (non-fatal): ${e.message}`));
        }

        // 5. Check handoff triggers BEFORE generating AI response
        const handoffReason = this.handoffService.shouldHandoff(
            content?.text || '', conversation, config,
        );
        if (handoffReason) {
            this.logger.warn(`HANDOFF TRIGGERED for conversation ${conversation.id}: ${handoffReason}`);
            this.analyticsService.trackEvent({
                tenantId, eventType: 'handoff_triggered',
                conversationId: conversation.id, contactId: contact.id,
                data: { reason: handoffReason },
            }).catch(() => {});
            const handoffResult = await this.handoffService.executeHandoff(tenantId, conversation.id, normalizedMsg, handoffReason);
            const agentName = handoffResult.assignedTo ? (handoffResult as any).assignedAgentName : null;
            let handoffMsg: string;
            if (agentName) {
                handoffMsg = `Entiendo tu solicitud. Te estoy transfiriendo con *${agentName}* de nuestro equipo. Te responderá en un momento. 🙋`;
            } else {
                // Count how many conversations are in queue to give a position
                const queueCount = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                    `SELECT COUNT(*) as cnt FROM conversations WHERE status = 'waiting_human' AND assigned_to IS NULL`,
                    [],
                ).catch(() => [{ cnt: 0 }]);
                const position = Number(queueCount?.[0]?.cnt || 1);
                handoffMsg = position <= 1
                    ? `Entiendo tu solicitud. Te estoy transfiriendo con nuestro equipo de atención. Un agente te responderá en breve. 🙋`
                    : `Entiendo tu solicitud. Te estoy transfiriendo con nuestro equipo de atención. Eres el #${position} en cola. Un agente te atenderá lo antes posible. 🙋`;
            }
            await this.sendResponse(tenantId, handoffMsg, normalizedMsg);
            await this.saveAiMessage(tenantId, conversation.id, handoffMsg, normalizedMsg.channelType);
            return;
        }

        // 5b. Send typing indicator before AI generates response
        try {
            const accessToken = await this.resolveAccessToken(tenantId, channelType);
            if (accessToken) {
                await this.channelGateway.sendTypingIndicator(
                    channelType as any, normalizedMsg.channelAccountId,
                    normalizedMsg.contactId, accessToken,
                );
            }
        } catch { /* non-blocking */ }

        // 6. AI message quota check (per-tenant, per-month)
        // Plans cap monthly AI volume (5K starter / 25K pro / 100K enterprise).
        // Over-quota: skip the LLM call and send a fallback that nudges the
        // tenant to upgrade. We never break the conversation thread for
        // customers — just stop calling the LLM.
        const hasQuota = await this.throttle.hasAiMessageQuota(tenantId);
        if (!hasQuota) {
            this.logger.warn(`[Pipeline] Tenant ${tenantId} exhausted AI message quota for the month. Sending fallback.`);
            const fallback = await this.buildQuotaFallbackMessage(tenantId);
            if (fallback) {
                await this.sendResponse(tenantId, fallback, normalizedMsg);
                await this.saveAiMessage(tenantId, conversation.id, fallback, channelType);
            }
            this.eventEmitter.emit('billing.quota.ai_messages_exhausted', { tenantId });
            return;
        }

        // 7. Generate AI Response
        this.logger.log(`[Pipeline] Generating AI response...`);
        const complexity = this.llmRouter.analyzeComplexity(content?.text || '');
        const sentiment = this.llmRouter.analyzeSentiment(content?.text || '');
        const response = await this.generateResponse(tenantId, conversation, normalizedMsg, config, contact, lead, previousMessageAt, bizHours, inboundMessageId);
        this.logger.log(`[Pipeline] AI response generated: ${response ? response.substring(0, 80) + '...' : 'NULL/EMPTY'}`);

        // Track AI response event + increment monthly quota counter — but NOT for
        // the error fallback (it isn't a real AI answer; counting it inflates the
        // monthly quota and emits a spurious message_sent event).
        if (response && response !== ERROR_FALLBACK_MSG) {
            this.throttle.incrementAiMessageCount(tenantId).catch(() => {});
            this.analyticsService.trackEvent({
                tenantId, eventType: 'message_sent',
                conversationId: conversation.id, contactId: contact.id,
                data: { channelType, responseLength: response.length, source: 'ai' },
            }).catch(() => {});
        }

        // 7. Send Response via Channel Gateway
        // NOTE: Never block responses to inbound messages. If a customer writes,
        // we always respond. Opt-out blocking only applies to proactive outbound
        // (broadcasts, automations, reminders) — not to conversation replies.
        if (response) {
            const draftMode = (config.behavior as any)?.draftMode === true;
            if (draftMode && response !== ERROR_FALLBACK_MSG) {
                // Draft-for-approval (WS3 #6): a human reviews/edits/sends in the
                // console instead of the AI replying directly. Store the suggestion
                // and notify the inbox; the customer gets nothing until approval.
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE conversations SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{pendingDraft}', $2::jsonb), updated_at = NOW() WHERE id = $1::uuid`,
                    [conversation.id, JSON.stringify({ text: response, createdAt: new Date().toISOString() })],
                ).catch(e => this.logger.warn(`Draft persist failed: ${e.message}`));
                this.eventEmitter.emit('draft.suggested', {
                    tenantId, conversationId: conversation.id, text: response, contactName: contact?.name,
                });
                this.logger.log(`[Pipeline] Draft mode — reply suggested to console (not sent to customer)`);
            } else {
                // Deliver long, multi-paragraph replies as 2-3 natural bubbles (more
                // human than a wall of text). Short replies go as one message. Bubbles
                // are staggered so they arrive in order with a brief pause.
                const chunks = this.splitResponseIntoChunks(response);
                const CHUNK_GAP_MS = 1200;
                this.logger.log(`[Pipeline] Sending response via outbound queue (${chunks.length} bubble(s))...`);
                for (let i = 0; i < chunks.length; i++) {
                    await this.sendResponse(tenantId, chunks[i], normalizedMsg, i * CHUNK_GAP_MS);
                    await this.saveAiMessage(tenantId, conversation.id, chunks[i], normalizedMsg.channelType);
                }
                this.logger.log(`[Pipeline] Response sent and saved`);
            }
        } else {
            this.logger.warn(`[Pipeline] No response generated — customer gets no reply`);
        }

        // 8. Auto-progress pipeline stage based on conversation signals
        this.pipelineService.autoProgressFromConversation(tenantId, conversation.id, {
            complexity,
            sentiment,
            messageText: content?.text || '',
            isFirstAiResponse: !!response,
            isCustomerReply: true,
        }).catch(e =>
            this.logger.warn(`Pipeline auto-progress failed (non-fatal): ${e.message}`),
        );

        // 9. Fire-and-forget scoring update
        this.leadScoring.scoreAfterMessage(tenantId, conversation.id).catch(e =>
            this.logger.warn(`Scoring update failed: ${e.message}`),
        );

        // 10. Schedule nurturing follow-up in case customer doesn't respond
        if (response) {
            this.nurturingService.scheduleFollowUp(tenantId, conversation.id, lead.id).catch(e =>
                this.logger.warn(`Nurturing schedule failed (non-fatal): ${e.message}`),
            );
        }

        } finally {
            // Stop the heartbeat and release the conversation lock — but only if we
            // still own it (compare-and-delete), so we never delete a lock another
            // turn re-acquired after a TTL expiry.
            if (lockHeartbeat) clearInterval(lockHeartbeat);
            if (lockToken) {
                await this.redis.releaseLockToken(lockKey, lockToken).catch(e => this.logger.warn(`Lock release failed for ${lockKey}: ${e.message}`));
            }
        }
    }

    /**
     * Resolve or create contact, lead, conversation, and opportunity
     */
    private async resolveConversation(tenantId: string, contactId: string, channelType: string, msg: NormalizedMessage) {
        const schemaName = await this.tenantSchema(tenantId);

        // 1. Find or create contact
        let contact = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM contacts WHERE external_id = $1 AND channel_type = $2`,
            [contactId, channelType],
        ).then(res => res[0]);

        const metaName = (msg.metadata as any)?.contactName || '';
        const metaPic = (msg.metadata as any)?.contactProfilePic || '';

        if (!contact) {
            const phoneNorm = normalizePhoneE164(contactId);
            contact = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO contacts (external_id, channel_type, name, phone, phone_normalized, avatar_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [contactId, channelType, metaName || 'Unknown', contactId, phoneNorm, metaPic || null],
            ).then(res => res[0]);
        } else {
            // Update name/avatar if we now have better data
            const updates: string[] = [];
            const updateParams: any[] = [];
            let pn = 1;

            if (contact.name === 'Unknown' && metaName) {
                updates.push(`name = $${pn++}`);
                updateParams.push(metaName);
            }
            if (!contact.avatar_url && metaPic) {
                updates.push(`avatar_url = $${pn++}`);
                updateParams.push(metaPic);
            }

            if (updates.length > 0) {
                updateParams.push(contact.id);
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE contacts SET ${updates.join(', ')} WHERE id = $${pn}::uuid`,
                    updateParams,
                );
                if (metaName && contact.name === 'Unknown') contact.name = metaName;
                if (metaPic && !contact.avatar_url) contact.avatar_url = metaPic;
            }
        }

        // 1b. Resolve unified identity
        try {
            await this.identityService.resolveOrCreateProfile(tenantId, {
                id: contact.id, phone: contact.phone, email: contact.email,
                name: contact.name, channelType, externalId: contactId,
            });
        } catch (e: any) {
            this.logger.warn(`[Pipeline] Identity resolution failed (non-fatal): ${e.message}`);
        }

        // 2. Find or create lead
        const contactIdStr = String(contact.id);
        let lead = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM leads WHERE contact_id = $1::uuid LIMIT 1`,
            [contactIdStr],
        ).then(res => res[0]);

        let isNewLead = false;
        const resolvedName = (msg.metadata as any)?.contactName as string || '';
        if (!lead) {
            const nameParts = resolvedName.split(' ');
            const firstName = nameParts[0] || 'Unknown';
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

            lead = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO leads (contact_id, first_name, last_name, phone, stage, score) VALUES ($1::uuid, $2, $3, $4, 'nuevo', 10) RETURNING *`,
                [contactIdStr, firstName, lastName, contactId],
            ).then(res => res[0]);
            isNewLead = true;
        } else if (lead.first_name === 'Unknown' && resolvedName) {
            const nameParts = resolvedName.split(' ');
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE leads SET first_name = $1, last_name = $2 WHERE id = $3::uuid`,
                [nameParts[0], nameParts.length > 1 ? nameParts.slice(1).join(' ') : null, lead.id],
            );
        }

        // 3. Find active conversation for same channel, or create new
        let conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM conversations WHERE contact_id = $1::uuid AND channel_type = $2 AND status IN ('active', 'waiting_human', 'with_human') ORDER BY created_at DESC LIMIT 1`,
            [contactIdStr, msg.channelType],
        ).then(res => res[0]);

        if (!conversation) {
            conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO conversations (contact_id, channel_type, channel_account_id, status, stage) VALUES ($1::uuid, $2, $3, 'active', 'greeting') RETURNING *`,
                [contactIdStr, msg.channelType, msg.channelAccountId],
            ).then(res => res[0]);

            // Create an opportunity only if the lead doesn't already have an active one
            const existingOpp = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT id FROM opportunities WHERE lead_id = $1::uuid AND stage NOT IN ('ganado', 'perdido', 'no_interesado') LIMIT 1`,
                [String(lead.id)],
            );
            if (!existingOpp?.length) {
                await this.prisma.executeInTenantSchema(schemaName,
                    `INSERT INTO opportunities (lead_id, conversation_id, stage, score) VALUES ($1::uuid, $2::uuid, 'nuevo', 10)`,
                    [String(lead.id), String(conversation.id)],
                );
            }
        }

        if (lead?.id) {
            const activeOpp = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT stage FROM opportunities WHERE lead_id = $1::uuid AND stage NOT IN ('ganado', 'perdido', 'no_interesado') LIMIT 1`,
                [String(lead.id)],
            );
            const oppStage = activeOpp?.[0]?.stage || 'nuevo';
            await this.pipelineService.syncOpportunityToDeal(tenantId, String(lead.id), oppStage).catch(e =>
                this.logger.error(`Failed to sync opportunity to deal on conversation start: ${e.message}`)
            );
        }

        // Emit lead.captured event for new leads so automation rules can fire
        if (isNewLead) {
            this.eventEmitter.emit('lead.captured', {
                tenantId,
                schemaName,
                leadId: lead.id,
                contactId: contact.id,
                conversationId: conversation.id,
                phone: contactId,
                name: contact.name,
                channel: channelType,
                source: 'whatsapp_inbound',
            });
            this.logger.log(`Emitted lead.captured for new lead ${lead.id}`);
        }

        return { contact, lead, conversation };
    }

    private async loadTenantBusinessHours(tenantId: string): Promise<any | null> {
        const cacheKey = `biz_hours:${tenantId}`;
        const cached = await this.redis.getJson(cacheKey);
        if (cached) return cached;

        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { settings: true },
            });
            const settings = (tenant?.settings as any) || {};
            const bh = settings.businessHours || null;
            if (bh) {
                await this.redis.setJson(cacheKey, bh, 300);
            }
            return bh;
        } catch (e) {
            this.logger.warn(`Failed to load tenant business hours: ${(e as Error).message}`);
            return null;
        }
    }

    private isWithinBusinessHours(config: TenantConfig, bizHours?: any): boolean {
        // Priority: tenant-level business hours > agent-level schedule (backward compat)
        if (bizHours) {
            if (bizHours.is247) return true;

            const schedule = bizHours.schedule;
            if (!schedule || Object.keys(schedule).length === 0) return true;

            const timezone = bizHours.timezone || config.hours?.timezone || 'America/Bogota';
            return this.checkScheduleTime(schedule, timezone, 'english');
        }

        // Fallback: agent-level schedule (legacy)
        if (!config.hours || !config.hours.schedule) return true;

        const schedule: Record<string, any> = config.hours.schedule as any;
        if (Object.keys(schedule).length === 0) return true;

        const values = Object.values(schedule);
        if (values.length >= 7) {
            const all247 = values.every(v =>
                v && typeof v === 'object' && (v as any).start === '00:00' && (v as any).end === '23:59'
            );
            if (all247) return true;
        }

        const timezone = config.hours.timezone || 'America/Bogota';
        return this.checkScheduleTime(schedule, timezone, 'spanish');
    }

    private checkScheduleTime(schedule: Record<string, any>, timezone: string, keyFormat: 'english' | 'spanish'): boolean {
        const now = new Date();
        const localTime = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(now);

        const dayFull = localTime.find(p => p.type === 'weekday')?.value?.toLowerCase() || '';
        const hourPart = localTime.find(p => p.type === 'hour')?.value || '0';
        const minutePart = localTime.find(p => p.type === 'minute')?.value || '0';
        const currentMinutes = parseInt(hourPart) * 60 + parseInt(minutePart);

        let todaySchedule: any;

        if (keyFormat === 'english') {
            // Tenant business hours use English day keys (monday, tuesday, etc.)
            todaySchedule = schedule[dayFull];
            // New format: { enabled, open, close }
            if (todaySchedule && typeof todaySchedule === 'object' && 'enabled' in todaySchedule) {
                if (!todaySchedule.enabled) return false;
                const openKey = todaySchedule.open || todaySchedule.start;
                const closeKey = todaySchedule.close || todaySchedule.end;
                if (!openKey || !closeKey) return false;
                const [startH, startM] = openKey.split(':').map(Number);
                const [endH, endM] = closeKey.split(':').map(Number);
                return currentMinutes >= (startH * 60 + startM) && currentMinutes <= (endH * 60 + endM);
            }
        }

        if (keyFormat === 'spanish') {
            // Agent schedule uses Spanish keys (lun, mar, etc.)
            const dayMapToSpanish: Record<string, string> = {
                sunday: 'dom', monday: 'lun', tuesday: 'mar', wednesday: 'mie',
                thursday: 'jue', friday: 'vie', saturday: 'sab',
            };
            const dayKey = dayMapToSpanish[dayFull] || dayFull;
            todaySchedule = schedule[dayKey] || schedule[dayFull];
        }

        this.logger.debug(`[BusinessHours] day=${dayFull} time=${hourPart}:${minutePart} schedule=${JSON.stringify(todaySchedule)} format=${keyFormat}`);

        if (!todaySchedule || typeof todaySchedule === 'string') return false;

        const startKey = todaySchedule.start || todaySchedule.open;
        const endKey = todaySchedule.end || todaySchedule.close;
        if (!startKey || !endKey) return false;

        const [startH, startM] = startKey.split(':').map(Number);
        const [endH, endM] = endKey.split(':').map(Number);
        return currentMinutes >= (startH * 60 + startM) && currentMinutes <= (endH * 60 + endM);
    }

    private async sendAfterHoursMessage(tenantId: string, msg: NormalizedMessage, config: TenantConfig, afterHoursText?: string) {
        const rawText = afterHoursText || config.hours?.afterHoursMessage;
        if (!rawText) return;

        this.logger.log(`Sending after hours message to ${msg.contactId}`);

        let text = rawText;
        try {
            const lang = config.language || 'es-CO';
            const personaName = config.persona?.name || 'Assistant';
            const result = await this.llmRouter.execute({
                model: 'grok-4-1-fast-non-reasoning',
                messages: [{ role: 'user', content: `Rewrite naturally:\n${text}` }],
                systemPrompt: `You are ${personaName}. Rewrite this after-hours message in ${lang}. Be warm and concise.`,
                temperature: 0.7,
                tenantId,
            });
            text = result.content || text;
        } catch {} // Fallback to raw message

        const outbound: OutboundMessage = {
            tenantId,
            channelType: msg.channelType,
            channelAccountId: msg.channelAccountId,
            to: msg.contactId,
            content: { type: 'text', text },
            // Keep e2e latency coverage consistent with sendResponse/sendMedia.
            metadata: { inboundTs: this.inboundTs(msg) },
        };

        const accessToken = await this.resolveAccessToken(tenantId, msg.channelType);
        await this.outboundQueue.enqueue(outbound, accessToken);
    }

    private async saveMessage(tenantId: string, conversationId: string, msg: NormalizedMessage): Promise<string | undefined> {
        const schemaName = await this.tenantSchema(tenantId);
        const metadataJson = JSON.stringify(msg.metadata || {});

        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, metadata)
             VALUES ($1::uuid, 'inbound', $2, $3, 'delivered', $4::jsonb) RETURNING *`,
            [conversationId, msg.content.type, msg.content.text, metadataJson],
        );

        // Funnel stage 3: stamp first inbound message arrival on the tenant
        // exactly once. The conditional UPDATE is idempotent so subsequent
        // messages skip the write at the row level (no extra read).
        this.prisma.$executeRawUnsafe(
            `UPDATE public.tenants SET first_message_at = NOW()
             WHERE id = $1::uuid AND first_message_at IS NULL`,
            tenantId,
        ).catch(() => { /* non-blocking */ });
        // Update conversation timestamp so new-session detection works correctly
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations SET updated_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
        );
        // Enrich payload so the dashboard can render the right channel icon /
        // contact label even when the conversation is not yet in its list.
        // The messages table has no channel_type column — that lives on
        // conversations — so the frontend was defaulting to 'whatsapp' for
        // first-message-of-an-unknown-conversation events.
        this.gateway.emitNewMessage(tenantId, {
            ...result[0],
            channel_type: msg.channelType,
        }, conversationId);

        this.eventEmitter.emit('message.inbound', {
            tenantId,
            conversationId,
            contactId: msg.contactId,
            phone: msg.metadata?.phone,
            channel: msg.channelType,
            messageType: msg.content.type,
            text: msg.content.text,
        });

        return result[0]?.id as string | undefined;
    }

    private async saveAiMessage(tenantId: string, conversationId: string, text: string, channelType?: string) {
        const schemaName = await this.tenantSchema(tenantId);

        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status)
             VALUES ($1::uuid, 'outbound', 'text', $2, 'delivered') RETURNING *`,
            [conversationId, text],
        );
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations SET updated_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
        );

        // Increment AI message count for resolution tracking (fire-and-forget)
        this.aiResolutionService.ensureResolutionColumns(schemaName).then(() =>
            this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET ai_message_count = COALESCE(ai_message_count, 0) + 1 WHERE id = $1::uuid`,
                [conversationId],
            ),
        ).catch(e => this.logger.warn(`ai_message_count increment failed (non-fatal): ${(e as Error).message}`));
        // If the caller didn't supply channelType (legacy path), fall back to
        // looking it up on the conversation row so the WS payload is honest.
        let resolvedChannel = channelType;
        if (!resolvedChannel) {
            try {
                const conv = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                    `SELECT channel_type FROM conversations WHERE id = $1::uuid`,
                    [conversationId],
                );
                resolvedChannel = conv?.[0]?.channel_type;
            } catch {}
        }
        this.gateway.emitNewMessage(tenantId, {
            ...result[0],
            channel_type: resolvedChannel,
        }, conversationId);
    }

    private async sendResponse(tenantId: string, text: string, inboundMsg: NormalizedMessage, delayMs?: number) {
        const outbound: OutboundMessage = {
            tenantId,
            channelType: inboundMsg.channelType,
            channelAccountId: inboundMsg.channelAccountId,
            to: inboundMsg.contactId,
            content: { type: 'text', text },
            // Server-receipt time (see inboundTs) → the outbound processor computes the
            // customer→reply latency on send, both ends on the server clock.
            metadata: { inboundTs: this.inboundTs(inboundMsg) },
        };

        const accessToken = await this.resolveAccessToken(tenantId, inboundMsg.channelType);
        // Use BullMQ queue for retry resilience (3 attempts, exponential backoff).
        // delayMs staggers chunked bubbles so they arrive in order with a pause.
        await this.outboundQueue.enqueue(outbound, accessToken, delayMs);
    }

    /** Send an image (or other media) to the customer on their channel. */
    private async sendMedia(tenantId: string, inboundMsg: NormalizedMessage, mediaUrl: string, caption: string | undefined, delayMs?: number) {
        const outbound: OutboundMessage = {
            tenantId,
            channelType: inboundMsg.channelType,
            channelAccountId: inboundMsg.channelAccountId,
            to: inboundMsg.contactId,
            content: { type: 'image', mediaUrl, caption },
            metadata: { inboundTs: this.inboundTs(inboundMsg) },
        };
        const accessToken = await this.resolveAccessToken(tenantId, inboundMsg.channelType);
        await this.outboundQueue.enqueue(outbound, accessToken, delayMs);
    }

    /**
     * Epoch ms used as the start of the customer→reply latency metric. Prefers the
     * server-clock receipt time (`receivedAt`, stamped at pipeline entry) so it matches
     * the worker's clock at send time — no cross-clock skew. Falls back to the provider's
     * message timestamp (Meta/Telegram clock, second granularity) only when receivedAt is
     * absent (e.g. a path that didn't go through processIncomingMessage).
     */
    private inboundTs(inboundMsg: NormalizedMessage): number {
        const received = (inboundMsg as any).receivedAt;
        if (typeof received === 'number' && received > 0) return received;
        const t = inboundMsg.timestamp as any;
        return t instanceof Date ? t.getTime() : new Date(t).getTime();
    }

    /**
     * Resolve real Meta access token for a given tenantId and channel type.
     */
    private async resolveAccessToken(tenantId: string, channelType: string = 'whatsapp'): Promise<string> {
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, channelType);
            if (!creds.accessToken) {
                this.logger.error(`[Pipeline] Access token is EMPTY for tenant ${tenantId} channel ${channelType}`);
            }
            return creds.accessToken;
        } catch (e: any) {
            this.logger.error(`[Pipeline] FAILED to resolve WhatsApp token for tenant ${tenantId}: ${e.message}`);
            return '';
        }
    }

    /**
     * Orchestrate the LLM call using the Router and Persona System Prompt.
     * Includes smart history truncation to stay within context window limits.
     */
    private async generateResponse(tenantId: string, conversation: any, msg: NormalizedMessage, config: TenantConfig, contact?: any, lead?: any, previousMessageAt?: any, bizHours?: any, inboundMessageId?: string): Promise<string> {
        let userText = msg.content.text || '';

        // ── Media processing: transcribe audio / describe images ──
        if (msg.content.type === 'audio' || msg.content.type === 'image') {
            const contactDbId = conversation.contact_id || contact?.id || '';
            const recentContext = userText || msg.content.caption || '';

            const mediaResult = await this.mediaProcessing.processMedia(
                msg, contactDbId, conversation.id, recentContext,
            );

            if (mediaResult) {
                userText = mediaResult.text;
                this.logger.log(`[Pipeline] Media processed (${msg.content.type}): ${userText.substring(0, 100)}...`);

                // Persist transcribed/described text so it shows up in future conversation history
                const schemaForUpdate = await this.tenantSchema(tenantId);
                this.prisma.executeInTenantSchema(schemaForUpdate,
                    `UPDATE messages SET content_text = $1
                     WHERE id = (SELECT id FROM messages WHERE conversation_id = $2::uuid AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1)`,
                    [userText, conversation.id],
                ).catch(e => this.logger.warn(`Failed to persist media text (non-fatal): ${e.message}`));
            } else {
                const configuredLang = config.language || 'es';
                return this.mediaProcessing.getFallbackMessage(msg.content.type, configuredLang);
            }
        } else if (msg.content.type !== 'text') {
            const configuredLang = config.language || 'es';
            const lang = (configuredLang).slice(0, 2).toLowerCase();
            const fallbacks: Record<string, string> = {
                es: 'Recibí tu mensaje, pero por ahora solo puedo procesar texto, imágenes y audios. ¿Podrías escribirme lo que necesitas?',
                en: 'I received your message, but I can only process text, images, and audio right now. Could you type what you need?',
                pt: 'Recebi sua mensagem, mas só consigo processar texto, imagens e áudios. Poderia escrever o que precisa?',
                fr: 'J\'ai reçu votre message, mais je ne peux traiter que le texte, les images et l\'audio. Pourriez-vous écrire ce dont vous avez besoin ?',
            };
            return fallbacks[lang] || fallbacks.es;
        }

        // 1. Analyze routing factors
        const complexity = this.llmRouter.analyzeComplexity(userText);
        const sentiment = this.llmRouter.analyzeSentiment(userText);
        const stageScore = this.llmRouter.stageToScore(conversation.stage);

        this.logger.log(`Routing Factors - Complexity: ${complexity}, Sentiment: ${sentiment}, Stage: ${stageScore}`);

        // 2. Resolve schema + new-session detection (must happen before engine/tools)
        const schemaName = await this.tenantSchema(tenantId);

        const lastMsgTime = previousMessageAt || conversation.updated_at || conversation.created_at;
        const timeSinceLastMessage = Date.now() - new Date(lastMsgTime).getTime();
        const isNewSession = timeSinceLastMessage > 30 * 60 * 1000; // 30 minutes

        if (isNewSession) {
            this.logger.log(`[Pipeline] New session detected (${Math.round(timeSinceLastMessage / 60000)} min gap) — clearing stale context`);
            try {
                await this.redis.del(`booking:${conversation.id}`);
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE conversations SET metadata = metadata - 'toolContext' - 'toolContextUpdatedAt' - 'bookingState' - 'bookingStateUpdatedAt' WHERE id = $1::uuid`,
                    [conversation.id],
                );
            } catch {}
            if (conversation.metadata) {
                delete (conversation.metadata as any).toolContext;
                delete (conversation.metadata as any).toolContextUpdatedAt;
                delete (conversation.metadata as any).bookingState;
                delete (conversation.metadata as any).bookingStateUpdatedAt;
            }
        }

        // 3. Start building TURN CONTEXT (Layer 3 of prompt assembly).
        // Prompt is composed later by PromptAssemblerService: Layer 1 (contract) +
        // Layer 2 (persona from config) + Layer 3 (this turn context).
        // Language: default from config, then auto-detect from the inbound text
        // so we follow the customer when they switch languages mid-conversation.
        const configuredLanguage = config.language || 'es-CO';
        // Use the LAST detected language as the fallback (not the tenant default):
        // the detector falls back for inputs under ~3 chars or low margin, so short
        // replies like "ok", "yes", "gracias" were reverting an English/Portuguese
        // conversation back to the tenant default mid-chat.
        const previousLanguage = (conversation.metadata as any)?.detectedLanguage;
        const detectedLanguage = this.languageDetector.detect(userText, previousLanguage || configuredLanguage);
        const userLanguage = detectedLanguage;
        // Persist when it changes so the stickiness carries to the next turn.
        if (detectedLanguage && detectedLanguage !== previousLanguage) {
            this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1::uuid`,
                [conversation.id, JSON.stringify({ detectedLanguage })],
            ).catch(() => { /* non-blocking */ });
        }
        const tz = bizHours?.timezone || config.hours?.timezone || 'America/Bogota';
        const now = new Date();
        const businessHoursStatus: 'open' | 'closed' = this.isWithinBusinessHours(config, bizHours) ? 'open' : 'closed';

        // Step-by-step turn trace (WS5 #1) — accumulated in memory, persisted
        // fire-and-forget at the end. Never affects the turn's behaviour or latency.
        const turnTrace = new TurnTraceContext({ tenantId, conversationId: conversation.id, messageId: inboundMessageId });

        const turnContext: TurnContext = {
            language: userLanguage,
            timezone: tz,
            now: now.toISOString(),
            upcomingDays: this.promptAssembler.computeUpcomingDays(now, tz, 8),
            businessHoursStatus,
        };

        // Long-term memory (#1): inject what we know about this customer across
        // conversations, when the agent has it enabled.
        if (config.llm?.memory?.longTerm && conversation.contact_id) {
            const mem = await this.customerMemory.getMemory(schemaName, conversation.contact_id, userText, tenantId).catch(() => null);
            if (mem) turnContext.customerMemory = mem;
        }

        if (contact) {
            const contactName = contact.name || lead?.first_name || lead?.firstName;
            turnContext.contact = {
                name: contactName,
                email: contact.email,
                phone: contact.phone,
                isKnown: !!(contactName || contact.email),
                knownSince: contact.first_contact_at || contact.created_at,
            };

            // Fetch customer's active bookings and appointments across all verticals
            try {
                const activeBookings: any[] = [];
                const contactId = contact.id;

                // 1. Appointments (future and confirmed)
                const appointments = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT id, service_name, start_at, location, status
                     FROM appointments
                     WHERE contact_id = $1::uuid AND start_at >= NOW() AND status != 'cancelled'
                     ORDER BY start_at ASC LIMIT 5`,
                    [contactId],
                );
                for (const apt of appointments || []) {
                    const dateObj = new Date(apt.start_at);
                    activeBookings.push({
                        id: apt.id,
                        type: 'appointment',
                        name: apt.service_name,
                        status: apt.status,
                        dateLabel: dateObj.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
                        details: apt.location ? `Ubicación: ${apt.location}` : undefined,
                    });
                }

                // 2. Property Bookings (future and confirmed)
                const propBookings = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT b.id, b.check_in, b.check_out, b.status, b.total_price, b.currency, p.name as property_name
                     FROM property_bookings b
                     JOIN properties p ON p.id = b.property_id
                     WHERE b.contact_id = $1::uuid AND b.check_out >= CURRENT_DATE AND b.status != 'cancelled'
                     ORDER BY b.check_in ASC LIMIT 5`,
                    [contactId],
                );
                for (const pb of propBookings || []) {
                    activeBookings.push({
                        id: pb.id,
                        type: 'property',
                        name: pb.property_name,
                        status: pb.status,
                        dateLabel: `Desde ${pb.check_in} hasta ${pb.check_out}`,
                        priceLabel: `${Number(pb.total_price).toLocaleString()} ${pb.currency || 'COP'}`,
                    });
                }

                // 3. Tour Bookings (future and confirmed)
                const tourBookings = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT b.id, b.departure_date, b.departure_time, b.status, b.total_price, b.currency, b.party_size, p.name as package_name
                     FROM tour_bookings b
                     JOIN tour_packages p ON p.id = b.package_id
                     WHERE b.contact_id = $1::uuid AND b.departure_date >= CURRENT_DATE AND b.status != 'cancelled'
                     ORDER BY b.departure_date ASC LIMIT 5`,
                    [contactId],
                );
                for (const tb of tourBookings || []) {
                    const timeLabel = tb.departure_time ? ` a las ${tb.departure_time}` : '';
                    activeBookings.push({
                        id: tb.id,
                        type: 'tour',
                        name: tb.package_name,
                        status: tb.status,
                        dateLabel: `${tb.departure_date}${timeLabel}`,
                        priceLabel: `${Number(tb.total_price).toLocaleString()} ${tb.currency || 'COP'}`,
                        details: `Grupo: ${tb.party_size} personas`,
                    });
                }

                if (activeBookings.length > 0) {
                    turnContext.activeBookings = activeBookings;
                }
            } catch (err: any) {
                this.logger.warn(`Failed to populate activeBookings for contact (non-fatal): ${err.message}`);
            }
        }

        // Business identity — the "who we are" data the agent uses to answer
        // questions about the company. Cached in Redis inside BusinessInfoService.
        try {
            const businessIdentity = await this.businessInfoService.getPrimary(tenantId);
            if (businessIdentity) {
                turnContext.business = {
                    companyName: businessIdentity.companyName,
                    industry: businessIdentity.industry,
                    about: businessIdentity.about,
                    phone: businessIdentity.phone,
                    email: businessIdentity.email,
                    website: businessIdentity.website,
                    address: businessIdentity.address,
                    city: businessIdentity.city,
                    country: businessIdentity.country,
                    socialLinks: businessIdentity.socialLinks,
                };
            }
        } catch (e: any) {
            this.logger.warn(`Business identity lookup failed (non-fatal): ${e.message}`);
        }

        // 3.5 Vertical context — inject industry-specific terminology for the LLM
        try {
            const cacheKey = `vertical:${tenantId}`;
            let verticalConfig = await this.redis.getJson<any>(cacheKey);
            if (!verticalConfig) {
                const tenant = await this.prisma.tenant.findUnique({
                    where: { id: tenantId },
                    select: { settings: true },
                });
                verticalConfig = (tenant?.settings as any)?.verticalConfig;
                if (verticalConfig) {
                    await this.redis.setJson(cacheKey, verticalConfig, 600);
                }
            }
            if (verticalConfig?.terminology) {
                const lang = userLanguage || 'es';
                const t = verticalConfig.terminology;
                turnContext.verticalContext = {
                    customerNoun: t.customerNoun?.[lang] || t.customerNoun?.es,
                    customerNounPlural: t.customerNounPlural?.[lang] || t.customerNounPlural?.es,
                    transactionNoun: t.transactionNoun?.[lang] || t.transactionNoun?.es,
                    serviceNoun: t.serviceNoun?.[lang] || t.serviceNoun?.es,
                };
            }
        } catch (e: any) {
            this.logger.debug(`Vertical context lookup skipped: ${e.message}`);
        }

        // 4. Deterministic Booking Engine (runs BEFORE the LLM — emits interactive
        // messages directly for WhatsApp, or produces text for the LLM to voice).
        const toolsConfig = config.tools?.appointments ?? (config as any)?.tools?.appointments;
        const toolsEnabled = toolsConfig?.enabled === true;
        let tools: any[] = [];
        let bookingState: BookingState = await this.loadBookingState(conversation.id, conversation.metadata);
        let engineProducedText: string | null = null;

        // If a procedure (AOP/SOP) is mid-flow waiting for a field, the current
        // message is the ANSWER to that field — give the procedure engine priority
        // so the booking engine doesn't hijack it and leave the procedure hung.
        const procedureAwaiting = await this.procedureEngine.getState(conversation.id)
            .then(s => !!s?.awaitingField).catch(() => false);

        if (toolsEnabled && !procedureAwaiting) {
            // Tenant-local "today" — toISOString() would be UTC, which rolls over
            // to tomorrow during the evening across all of LatAm (UTC-3…-6) and
            // would make the booking engine treat "hoy" as the next day.
            const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
            const customerProfile = {
                name: contact?.name || lead?.first_name || lead?.firstName,
                email: contact?.email,
                phone: contact?.phone,
            };

            // ═══ PHASE 1: INTERPRET — extract structured intent ═══
            const serviceNames = bookingState.services?.map(s => s.name) || [];
            const upcoming = turnContext.upcomingDays || [];
            const intent = await this.intentInterpreter.interpret(
                userText, bookingState.step, serviceNames, todayISO, upcoming, tenantId,
            );
            this.logger.log(`[Pipeline] INTERPRET: intent=${intent.intent} svc=${intent.serviceMentioned || '-'} date=${intent.dateMentioned || '-'} confirm=${intent.isConfirmation}`);

            // ═══ GREETING & FAREWELL at idle: let LLM handle naturally ═══
            const isGreetOrFarewell = intent.intent === 'greet' || intent.intent === 'farewell';
            const isIdleOrBooked = bookingState.step === 'idle' || bookingState.step === 'booked' || !bookingState.step;

            if (isGreetOrFarewell && isIdleOrBooked) {
                this.logger.log(`[Pipeline] ${intent.intent} (idle): LLM handles with full persona`);
                // Refresh services from DB and update cache so booking engine gets fresh data next turn
                try {
                    const result = await this.toolExecutor.execute(schemaName, tenantId, conversation.contact_id || '', 'list_services', {});
                    bookingState.services = result?.services?.length ? result.services : [];
                    // Update the tenantId-scoped cache so next booking engine call is consistent
                    const svcCacheKey = `booking:services:${tenantId}`;
                    await this.redis.set(svcCacheKey, JSON.stringify(bookingState.services), 300).catch(() => {});
                } catch {}
                await this.persistBookingState(schemaName, conversation.id, bookingState);
                // Skip engine entirely — fall through to LLM
            } else {
                // ═══ PHASE 2: DECIDE — deterministic booking engine ═══
                const engineResult = await this.bookingEngine.process(
                    schemaName, tenantId, conversation.contact_id || '',
                    intent, userText, bookingState, customerProfile, todayISO, userLanguage,
                );

                bookingState = engineResult.state;
                this.logger.log(`[Pipeline] Booking state: ${bookingState.step} | service: ${bookingState.serviceName || '-'} | date: ${bookingState.date || '-'} | time: ${bookingState.time || '-'}`);

                if (engineResult.handled) {
                    this.logger.log(`[Pipeline] Booking engine handled (step: ${bookingState.step})`);

                    // ═══ PHASE 3: EXPRESS — LLM voices the engine's output naturally ═══
                    engineProducedText = engineResult.text || null;
                    tools = []; // NO TOOLS for express phase
                    await this.persistBookingState(schemaName, conversation.id, engineResult.state);
                } else {
                    // Not booking-related — LLM handles.
                    if (bookingState.services?.length) {
                        turnContext.availableServices = bookingState.services.map(s => ({
                            id: s.id,
                            name: s.name,
                            durationMinutes: s.durationMinutes,
                            price: s.price,
                            currency: s.currency,
                        }));
                    }
                    this.logger.log(`[Pipeline] Not booking-related, LLM handles`);
                    await this.persistBookingState(schemaName, conversation.id, engineResult.state);
                }
            }
        }

        // 4b. Deterministic Procedure Engine (T2.12 — AOP/SOP). Runs only when the
        // booking engine didn't take over. If an active procedure is in progress or
        // a trigger matches, it produces a directive the LLM voices (like booking),
        // keeping the flow deterministic. Fully guarded so it can never break chat.
        if (!engineProducedText) {
            try {
                const procResult = await this.procedureEngine.process(
                    schemaName, tenantId, conversation.id, conversation.contact_id || '', userText,
                );
                if (procResult.handled) {
                    tools = [];
                    if (procResult.text) engineProducedText = procResult.text;
                    if (procResult.handoff) {
                        if (!engineProducedText) engineProducedText = 'Te voy a transferir con un agente de nuestro equipo.';
                        try {
                            await this.handoffService.executeHandoff(
                                tenantId, conversation.id, msg, procResult.handoffReason || `Procedimiento: ${procResult.procedureName || ''}`,
                            );
                        } catch (e: any) {
                            this.logger.warn(`[Procedure] handoff failed: ${e.message}`);
                        }
                    }
                    this.logger.log(`[Procedure] handled (proc="${procResult.procedureName}", completed=${!!procResult.completed}, handoff=${!!procResult.handoff})`);
                }
            } catch (e: any) {
                this.logger.warn(`[Procedure] engine error (non-fatal): ${e.message}`);
            }
        }

        // Register catalog + knowledge + CRM tools based on feature flags on the agent.
        const cfgTools = (config.tools ?? (config as any)?.tools) as any;
        if (cfgTools?.appointments?.enabled === true) {
            tools = [...tools, ...APPOINTMENT_TOOLS];
        }
        if (cfgTools?.catalog?.enabled === true) {
            tools = [...tools, ...CATALOG_TOOLS];
        }
        if (cfgTools?.faqs?.enabled === true) {
            tools = [...tools, FAQ_TOOL];
        }
        if (cfgTools?.policies?.enabled === true) {
            tools = [...tools, POLICY_TOOL];
        }
        if (cfgTools?.knowledge?.enabled === true) {
            tools = [...tools, KB_TOOL];
        }
        if (cfgTools?.offers?.enabled === true) {
            tools = [...tools, OFFER_TOOL];
        }
        if (cfgTools?.orders?.enabled === true) {
            tools = [...tools, ORDER_TOOL];
        }
        if (cfgTools?.crm?.enabled === true) {
            tools = [...tools, CUSTOMER_CONTEXT_TOOL];
        }
        // E-commerce dual-skillset tools (T2.17)
        if (cfgTools?.ecommerce?.enabled === true) {
            tools = [...tools, ...ECOMMERCE_TOOLS];
            if (cfgTools.ecommerce.canApplyDiscount === true) {
                tools = [...tools, APPLY_DISCOUNT_TOOL];
            }
        }

        // Vertical integration tools (T3.19) — registered per connected provider
        // (Toast / Mindbody / Cliniko). Connection state is cached (5min), so this
        // is a cheap per-turn check. Guarded so it never breaks the pipeline.
        try {
            const connected = await this.verticalIntegrations.getConnectedProviders(tenantId);
            if (connected.toast) tools = [...tools, GET_RESTAURANT_MENU_TOOL];
            if (connected.mindbody) tools = [...tools, GET_FITNESS_SCHEDULE_TOOL];
            if (connected.cliniko) tools = [...tools, LIST_CLINIC_SERVICES_TOOL, CHECK_CLINIC_AVAILABILITY_TOOL];
        } catch (e: any) {
            this.logger.debug(`[T3.19] vertical integration tool gating skipped: ${e.message}`);
        }

        // External MCP tools (T3.20) — tools discovered from the tenant's connected
        // MCP servers (cached 5min). Namespaced mcp__{server}__{tool}. Guarded.
        try {
            const { tools: mcpTools } = await this.mcpClient.listRemoteTools(tenantId);
            if (mcpTools.length) tools = [...tools, ...mcpTools];
        } catch (e: any) {
            this.logger.debug(`[T3.20] MCP tool registration skipped: ${e.message}`);
        }
        if (cfgTools?.properties?.enabled === true) {
            tools = [...tools, ...VACATION_RENTAL_TOOLS];
        }
        if (cfgTools?.tours?.enabled === true) {
            tools = [...tools, ...TOURS_TOOLS];
        }
        if (cfgTools?.treatments?.enabled === true) {
            tools = [...tools, ...TREATMENT_TOOLS];
        }
        if (cfgTools?.realEstate?.enabled === true) {
            tools = [...tools, ...LISTINGS_TOOLS];
        }
        if (cfgTools?.vehicles?.enabled === true) {
            tools = [...tools, ...VEHICLE_TOOLS];
        }
        if (cfgTools?.pets?.enabled === true) {
            tools = [...tools, ...PETS_TOOLS];
        }
        if (cfgTools?.restaurants?.enabled === true) {
            tools = [...tools, ...RESTAURANTS_TOOLS];
        }
        if (cfgTools?.gyms?.enabled === true) {
            tools = [...tools, ...GYMS_TOOLS];
        }
        if (cfgTools?.education?.enabled === true) {
            tools = [...tools, ...EDUCATION_TOOLS];
        }
        if (cfgTools?.insurance?.enabled === true) {
            tools = [...tools, ...INSURANCE_TOOLS];
        }
        if (cfgTools?.homeServices?.enabled === true) {
            tools = [...tools, ...HOME_SERVICES_TOOLS];
        }
        if (cfgTools?.petServices?.enabled === true) {
            tools = [...tools, ...PET_SERVICES_TOOLS];
        }
        if (cfgTools?.photography?.enabled === true) {
            tools = [...tools, ...PHOTOGRAPHY_TOOLS];
        }

        // When the booking/procedure engine produced a directive, the LLM must
        // ONLY voice that directive — never call tools. The registration block
        // above re-adds tools from the agent's feature flags, overriding the
        // `tools = []` set in the express phase, so enforce it as the last word.
        if (engineProducedText) tools = [];

        if (bookingState.step && bookingState.step !== 'idle') {
            const selectedService = bookingState.serviceId
                ? bookingState.services?.find(s => s.id === bookingState.serviceId)
                : undefined;
            turnContext.bookingState = {
                step: bookingState.step,
                service: bookingState.serviceId ? {
                    id: bookingState.serviceId,
                    name: bookingState.serviceName || selectedService?.name || '',
                    durationMinutes: selectedService?.durationMinutes,
                } : undefined,
                date: bookingState.date,
                slot: bookingState.time,
            };
        }

        // 5. Knowledge retrieval — runs on EVERY turn (booking and non-booking alike).
        // When the booking engine produced a directive, the Layer 1 contract rule
        // "When <directive> is present, communicate ONLY that information" ensures
        // the LLM prioritizes the directive over RAG content. But RAG is still
        // available in context so the LLM can enrich pricing/policy answers naturally.
        try {
            const hasKnowledge = await this.knowledgeService.tenantHasKnowledge(tenantId);
            const ragConfig = config.rag;
            const ragEnabled = ragConfig?.enabled !== false;
            if (hasKnowledge && ragEnabled) {
                // Clamp topK so a misconfigured agent can't flood the prompt with
                // dozens of chunks (cost + context blowout). Chunks are already
                // capped at CHUNK_MAX_CHARS each at ingest time.
                const topK = Math.min(Math.max(1, ragConfig?.topK ?? 5), 10);
                // Default 0.35 — filters out irrelevant chunks. Agents can lower
                // this in their RAG config if they need broader recall.
                const similarityThreshold = ragConfig?.similarityThreshold ?? 0.35;
                const searchThreshold = Math.min(0.25, similarityThreshold);
                // RAG 2.0: rewrite follow-up questions into a standalone search query
                // so anaphora ("¿y eso cuánto sale?") don't embed garbage.
                const searchQuery = await this.rewriteSearchQuery(userText, schemaName, conversation.id, tenantId);
                const ragResults = await this.knowledgeService.searchRelevant(
                    tenantId, searchQuery, topK,
                    {
                        similarityThreshold: searchThreshold,
                        conversationId: conversation.id,
                        language: userLanguage,
                        // Opt-in LLM reranker (adds latency/cost) — off unless the agent enables it.
                        rerank: (config as any).llm?.kbReranker === true,
                    },
                );
                turnTrace.add('kb_retrieval', 'RAG', {
                    topK, threshold: similarityThreshold, retrievedCount: ragResults.length,
                    sources: ragResults.slice(0, 5).map((r: any) => r.title),
                });
                if (ragResults.length > 0) {
                    const retrieved = ragResults.filter((r: any) => r.score >= similarityThreshold);
                    const possible = ragResults.filter((r: any) => r.score >= 0.25 && r.score < similarityThreshold);

                    if (retrieved.length > 0) {
                        turnContext.retrievedKnowledge = retrieved.map((r: any, idx: number) => ({
                            source: 'kb_article' as const,
                            id: String(r.id ?? r.document_id ?? idx),
                            score: typeof r.score === 'number' ? r.score : (typeof r.similarity === 'number' ? r.similarity : undefined),
                            title: r.title,
                            content: r.chunk_text,
                        })) as RetrievedKnowledgeItem[];
                        this.logger.log(`RAG: Injected ${retrieved.length} chunks (topK=${topK}, threshold=${similarityThreshold}) for tenant ${tenantId}`);
                    }

                    if (possible.length > 0) {
                        (turnContext as any).possibleKnowledge = possible.map((r: any, idx: number) => ({
                            source: 'kb_article' as const,
                            id: String(r.id ?? r.document_id ?? idx),
                            score: typeof r.score === 'number' ? r.score : (typeof r.similarity === 'number' ? r.similarity : undefined),
                            title: r.title,
                            content: r.chunk_text,
                        })) as RetrievedKnowledgeItem[];
                        this.logger.log(`RAG (Fuzzy): Injected ${possible.length} possible chunks (score 0.25-${similarityThreshold}) for tenant ${tenantId}`);
                    }
                }
            }
        } catch (ragError: any) {
            this.logger.warn(`RAG search failed (non-fatal): ${ragError.message}`);
        }

        // 5b. E-commerce context (T2.17 — dual-skillset). Inject a small sample of
        // REAL store products + the customer's recent orders so the agent grounds
        // recommendations and support without inventing data. Best-effort.
        if (cfgTools?.ecommerce?.enabled === true) {
            try {
                const products = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                    `SELECT external_id, title, price_cents, currency, inventory_quantity, product_type
                     FROM ecommerce_products WHERE status = 'active'
                     ORDER BY synced_at DESC LIMIT 12`,
                    [],
                );
                if (products?.length) {
                    turnContext.catalog = products.map((p: any) => ({
                        id: String(p.external_id),
                        title: p.title,
                        price: p.price_cents != null ? Number(p.price_cents) / 100 : undefined,
                        currency: p.currency || 'USD',
                        inStock: (p.inventory_quantity ?? 0) > 0,
                        category: p.product_type || undefined,
                    }));
                }
            } catch (e: any) {
                this.logger.debug(`[T2.17] catalog injection skipped: ${e.message}`);
            }
        }
        if ((cfgTools?.ecommerce?.enabled === true || cfgTools?.orders?.enabled === true) && conversation.contact_id) {
            try {
                const orders = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                    `SELECT id, status, total_amount, currency, created_at
                     FROM orders WHERE contact_id = $1::uuid
                     ORDER BY created_at DESC LIMIT 3`,
                    [conversation.contact_id],
                );
                if (orders?.length) {
                    turnContext.recentOrders = orders.map((o: any) => ({
                        id: String(o.id),
                        status: o.status,
                        total: o.total_amount != null ? Number(o.total_amount) : undefined,
                        currency: o.currency || undefined,
                        date: o.created_at ? new Date(o.created_at).toISOString() : undefined,
                    }));
                }
            } catch (e: any) {
                this.logger.debug(`[T2.17] recent orders injection skipped: ${e.message}`);
            }
        }

        // 6. Assemble system prompt.
        // ALWAYS use full 3-layer prompt (contract + persona + turn context).
        // When engine handled: add a directive to the turn context so the LLM
        // knows WHAT to communicate, but generates the HOW naturally.
        // This is directive-based, not template-based — the LLM converses, not translates.
        if (engineProducedText) {
            // Add directive to turn context — tells LLM what to communicate
            turnContext.directive = engineProducedText;
        }

        // 3. Get Conversation History with smart truncation.
        // Fetch the 30 MOST RECENT messages (DESC), not the 30 oldest — long
        // conversations were sending the LLM the start of the chat and losing all
        // recent context. LIMIT 31 + drop the first row removes the current
        // inbound message (already saved above), which is re-added separately as
        // the live user turn — otherwise it would be duplicated in the prompt.
        // Reverse back to chronological order (oldest→newest) for the builders below.
        const historyDesc = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT direction, content_text FROM messages WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 31`,
            [conversation.id],
        );
        const history = (historyDesc || []).slice(1).reverse();

        // Anti-repetition: tell the LLM how many messages exist in this conversation.
        // message_count > 1 means it's a CONTINUATION — don't re-introduce yourself.
        turnContext.messageCount = (history?.length || 0) + 1; // +1 for current message (excluded from history above)

        // Assemble with a cache boundary: the contract+persona prefix is stable
        // across turns and can be cached by the provider (90% off on Anthropic;
        // better OpenAI auto-cache hit-rate). Only the <turn> block changes.
        const { systemPrompt, cachePrefixChars } = this.promptAssembler.assembleWithCacheBoundary(config, turnContext, bizHours);

        let messages: Array<{ role: string; content: string }>;
        if (engineProducedText) {
            // Directive-based: send MINIMAL context. The directive in <turn> tells
            // the LLM WHAT to say. Too much history causes the LLM to ignore the
            // directive and respond to old messages instead.
            // Only include the last 2 exchanges (4 messages) for tone continuity.
            const recentHistory = (history || []).slice(-4);
            messages = recentHistory.map((m: any) => ({
                role: m.direction === 'inbound' ? 'user' : 'assistant',
                content: m.content_text || '',
            }));
            messages.push({ role: 'user', content: userText });
            this.logger.log(`[Pipeline] Express: directive-based with ${messages.length} recent messages`);
        } else if (isNewSession) {
            messages = [{ role: 'user', content: userText }];
            this.logger.log(`[Pipeline] New session: sending only current message (discarded ${history?.length || 0} old messages)`);
        } else {
            messages = this.truncateHistory(history || [], userText);
        }

        // 4. Execute LLM Call using Router (with tool execution loop)
        try {
            const MAX_TOOL_ITERATIONS = 5;
            let currentMessages = [...messages] as any[];
            let finalResponse = '';
            // Media the LLM asked to send (e.g. product images), collected across
            // tool iterations and dispatched after the text reply.
            const mediaToSend: Array<{ url: string; caption?: string }> = [];

            const planFeatures = await this.throttle.getPlanFeatures(tenantId);
            const allowedTiers = this.mapLlmTierToAllowed(planFeatures.llmTier);

            for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
                const hasTools = tools.length > 0;

                // Honor the agent's configured temperature/maxTokens (previously
                // ignored). Tool-calling stays deterministic (0.3) regardless, since
                // a high temperature degrades tool-argument accuracy.
                const personaTemp = typeof config.llm?.temperature === 'number' ? config.llm.temperature : 0.8;
                const personaMaxTokens = typeof config.llm?.maxTokens === 'number' && config.llm.maxTokens > 0
                    ? config.llm.maxTokens : undefined;
                const response = await this.llmRouter.execute({
                    task: hasTools ? 'tool_calling' : 'conversation',
                    messages: currentMessages,
                    systemPrompt,
                    cacheableSystemPromptChars: cachePrefixChars,
                    temperature: hasTools ? 0.3 : personaTemp,
                    maxTokens: personaMaxTokens,
                    tools: hasTools ? tools : undefined,
                    allowedTiers,
                    tenantId,
                    traceContext: {
                        conversationId: conversation.id,
                        kbSources: ((turnContext.retrievedKnowledge as any[]) || [])
                            .map((k: any) => k?.title)
                            .filter(Boolean),
                        stage: engineProducedText ? 'booking' : 'conversation',
                    },
                });

                // Check if LLM wants to call tools
                if (response.toolCalls?.length && hasTools) {
                    this.logger.log(`[Pipeline] LLM requested ${response.toolCalls.length} tool call(s) (iteration ${iteration + 1})`);

                    // Add assistant message with tool calls (using ChatMessage format)
                    currentMessages.push({
                        role: 'assistant',
                        content: response.content || '',
                        toolCalls: response.toolCalls,
                    });

                    // Execute the turn's tools. Read-only tools run concurrently via
                    // Promise.all (each isolated + per-tool timeout). Tools with write
                    // side-effects can race (double booking, two orders), so when the
                    // LLM asks for >1 writer in the same turn we serialize ALL of them
                    // and run them sequentially — never two writers in flight at once.
                    // Tool RESULT order in currentMessages is preserved regardless of
                    // completion order: we collect into a fixed-index array (matched by
                    // toolCallId) and push in the original toolCalls order afterwards.
                    const contactId = conversation.contact_id || '';
                    const toolCalls = response.toolCalls;

                    // Run a single tool call: parse args, timeout-guard, isolate errors,
                    // emit its trace, and capture any _mediaToSend marker. Returns the
                    // sanitized result (media marker stripped) for the tool message.
                    const runTool = async (tc: any): Promise<any> => {
                        let result: any;
                        try {
                            const args = typeof tc.function.arguments === 'string'
                                ? JSON.parse(tc.function.arguments)
                                : (tc.function.arguments || {});
                            result = await this.withTimeout(
                                this.toolExecutor.execute(schemaName, tenantId, contactId, tc.function.name, args, conversation.id),
                                TOOL_TIMEOUT_MS,
                                tc.function.name,
                            );
                        } catch (e: any) {
                            this.logger.warn(`[Pipeline] Tool ${tc.function.name} failed/timed out: ${e.message}`);
                            result = { error: 'tool_failed', retryable: false, message: 'No se pudo ejecutar esta acción en este momento.' };
                        }

                        this.logger.log(`[Pipeline] Tool ${tc.function.name} executed in LLM loop`);
                        turnTrace.add('tool_result', tc.function.name, {
                            ok: !(result && result.error),
                            error: result?.error,
                        });

                        // Capture any media the tool wants sent (e.g. a product image)
                        // and strip the marker so it never reaches the LLM. mediaToSend
                        // is only mutated AFTER the awaited result resolves — one push
                        // per tool, no interleaved access, so it's safe under Promise.all.
                        if (result && result._mediaToSend?.url) {
                            mediaToSend.push({ url: result._mediaToSend.url, caption: result._mediaToSend.caption });
                            delete result._mediaToSend;
                        }
                        return result;
                    };

                    // Decide concurrency: parallelize unless >1 writer would be in flight.
                    const writerCount = toolCalls.filter((tc: any) => isWriteTool(tc.function.name)).length;
                    const runSequential = writerCount > 1;

                    let results: any[];
                    if (runSequential) {
                        this.logger.warn(`[Pipeline] ${writerCount} write-tools this turn — running all ${toolCalls.length} tool(s) sequentially to avoid write races`);
                        results = [];
                        for (const tc of toolCalls) {
                            results.push(await runTool(tc));
                        }
                    } else {
                        // 0 or 1 writer + any number of reads → all concurrent.
                        results = await Promise.all(toolCalls.map((tc: any) => runTool(tc)));
                    }

                    // Append tool results in the ORIGINAL toolCalls order (matched by
                    // index → toolCallId), independent of completion order above.
                    toolCalls.forEach((tc: any, i: number) => {
                        currentMessages.push({
                            role: 'tool',
                            toolCallId: tc.id,
                            content: JSON.stringify(results[i]),
                        });
                    });

                    continue; // Loop back for another LLM call with tool results
                }

                // No tool calls — this is the final text response
                finalResponse = response.content || '[Error Generating AI Response]';
                break;
            }

            // Tool loop exhausted all iterations without ever producing a final text
            // answer (the LLM kept requesting tools). The side effects already ran,
            // so force one last call WITHOUT tools to get a natural reply instead of
            // returning empty and leaving the customer with no response.
            if (!finalResponse) {
                this.logger.warn(`[Pipeline] Tool loop exhausted ${MAX_TOOL_ITERATIONS} iterations without a final answer — forcing a no-tools response`);
                try {
                    const closing = await this.llmRouter.execute({
                        task: 'conversation',
                        messages: currentMessages,
                        systemPrompt,
                        temperature: 0.7,
                        allowedTiers,
                        tenantId,
                        traceContext: { conversationId: conversation.id, stage: 'conversation' },
                    });
                    finalResponse = closing.content || '';
                } catch (e: any) {
                    this.logger.warn(`[Pipeline] Forced no-tools response failed: ${e.message}`);
                }
                if (!finalResponse) {
                    finalResponse = 'Disculpa, estoy teniendo problemas para completar tu solicitud en este momento. ¿Podrías intentarlo de nuevo o reformular tu mensaje?';
                }
            }

            // Booking state already persisted earlier in the engine block

            // Output guardrail (#3): catch invented prices before the reply leaves.
            // Corpus = the system prompt (services/KB/directive/business info) + the
            // whole message thread (history + tool results) — everything the model saw.
            finalResponse = await this.applyOutputGuardrails(
                finalResponse, systemPrompt, currentMessages, allowedTiers, tenantId, conversation.id,
            );
            turnTrace.add('guardrail', 'output', { responseLength: finalResponse?.length || 0 });

            // Long-term memory (#1): periodically distill the conversation into
            // durable facts (fire-and-forget, cheap tier). Cadence keeps cost low.
            if (config.llm?.memory?.longTerm && conversation.contact_id && (turnContext.messageCount || 0) % 6 === 0) {
                this.customerMemory.extractFromConversation(tenantId, schemaName, conversation.id, conversation.contact_id)
                    .catch(() => { /* best-effort */ });
            }

            // Multimodal out (#13): dispatch product images the LLM requested,
            // staggered AFTER the text reply so they land in a natural order.
            for (let i = 0; i < mediaToSend.length; i++) {
                await this.sendMedia(tenantId, msg, mediaToSend[i].url, mediaToSend[i].caption, 2000 + i * 1200);
                await this.saveAiMessage(tenantId, conversation.id, `[📷 ${mediaToSend[i].caption || 'imagen'}]`, msg.channelType);
            }

            // Reset failedAttempts on successful AI response
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations
                 SET metadata = jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{failedAttempts}',
                     '0'::jsonb
                 )
                 WHERE id = $1::uuid`,
                [conversation.id],
            );

            turnTrace.add('decision', 'final_response', {
                finalResponseLength: finalResponse?.length || 0,
                mediaCount: mediaToSend.length,
            });
            // Persist the step-by-step trace, fire-and-forget — tracing never breaks the turn.
            try { this.eventEmitter.emit('llm.turn.steps', turnTrace.toEvent()); } catch { /* ignore */ }

            return finalResponse;
        } catch (e: any) {
            this.logger.error(`[Pipeline] LLM call FAILED: ${e.message}`, e.stack);

            // Increment failed attempts for handoff threshold
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations
                 SET metadata = jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{failedAttempts}',
                     (COALESCE((metadata->>'failedAttempts')::int, 0) + 1)::text::jsonb
                 )
                 WHERE id = $1::uuid`,
                [conversation.id],
            );

            // Trace failed turns too — they're the most valuable for debugging/evals.
            turnTrace.add('decision', 'error', { error: e?.message });
            try { this.eventEmitter.emit('llm.turn.steps', turnTrace.toEvent()); } catch { /* ignore */ }

            return ERROR_FALLBACK_MSG;
        }
    }

    /**
     * Truncate conversation history to stay within MAX_HISTORY_CHARS.
     * Keeps the most recent messages and always includes the current user message.
     */
    /**
     * Debounce a burst of messages from the same contact into one turn.
     * Returns: a combined string for the LAST message of the burst (flusher),
     * `null` for earlier messages (a newer one will flush — caller should bail),
     * or `undefined` when not debounced (media/non-text or Redis unavailable).
     *
     * Coordination is Redis-based (works across processes): each message bumps a
     * sequence and appends its text; after the window only the message still
     * holding the latest sequence drains the buffer (atomic Lua check+drain+del).
     */
    private async debounceBurst(msg: NormalizedMessage): Promise<string | null | undefined> {
        const text = msg.content?.type === 'text' ? (msg.content?.text || '') : '';
        if (!text) return undefined; // media/buttons are distinct turns — no debounce

        const base = `buf:conv:${msg.tenantId}:${msg.channelType}:${msg.contactId}`;
        const seqKey = `${base}:seq`;
        const msgsKey = `${base}:msgs`;

        let mySeq: number;
        try {
            mySeq = await this.redis.incr(seqKey);
            await this.redis.expire(seqKey, 60);
            await this.redis.rpush(msgsKey, text);
            await this.redis.expire(msgsKey, 60);
        } catch {
            return undefined; // Redis hiccup → process this message as-is
        }

        await new Promise(r => setTimeout(r, DEBOUNCE_MS));

        // Atomic flush: only the holder of the latest sequence drains the buffer.
        let parts: string[] | null;
        try {
            parts = await this.redis.getClient().eval(
                `if redis.call('get', KEYS[1]) == ARGV[1] then
                   local m = redis.call('lrange', KEYS[2], 0, -1)
                   redis.call('del', KEYS[2]); redis.call('del', KEYS[1]); return m
                 else return false end`,
                2, seqKey, msgsKey, String(mySeq),
            ) as string[] | null;
        } catch {
            return text; // Redis hiccup → process just this message's text
        }

        if (!parts) return null; // a newer fragment arrived — it will flush the batch
        if (parts.length > 1) {
            this.logger.log(`[Debounce] Flushed ${parts.length} messages as one turn for ${msg.contactId}`);
        }
        return (parts.length ? parts : [text]).join('\n').trim() || text;
    }

    /**
     * RAG 2.0 query rewriting. Follow-up questions ("¿y eso cuánto sale?", "el
     * segundo") embed poorly because the raw text lacks the referent. When the
     * message looks like a follow-up, rewrite it into a standalone search query
     * using recent history (cheap tier). Self-contained questions pass through
     * unchanged so we don't add latency where it isn't needed.
     */
    private async rewriteSearchQuery(userText: string, schemaName: string, conversationId: string, tenantId: string): Promise<string> {
        // Only worth a rewrite for likely follow-ups (short or anaphoric) — a
        // self-contained question passes through so we don't add a call/latency.
        const looksLikeFollowUp = userText.length < 80 ||
            /\b(eso|esa|ese|esos|esas|esto|estos|aquello|ello|lo mismo|tambi[eé]n|el primero|el segundo|la primera|la segunda|cu[aá]nto|y\s)\b/i.test(userText);
        if (!looksLikeFollowUp) return userText;

        // Fetch a little prior context (decoupled from the main history fetch,
        // which happens later in the pipeline). Skip the current inbound (OFFSET 1).
        let recent = '';
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT direction, content_text FROM messages
                 WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 5 OFFSET 1`,
                [conversationId]);
            if (!rows?.length) return userText; // no prior context → nothing to resolve
            recent = rows.reverse()
                .map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${(m.content_text || '').slice(0, 200)}`)
                .join('\n');
        } catch {
            return userText;
        }
        if (!recent) return userText;

        try {
            const resp = await this.llmRouter.execute({
                task: 'conversation',
                messages: [{
                    role: 'user',
                    content: `Dada la conversación, reescribe la ÚLTIMA pregunta del cliente como una consulta de búsqueda autónoma, resolviendo referencias ("eso", "ese", "el segundo") con el contexto. Si ya es autónoma, devuélvela igual. Devuelve SOLO la consulta, sin comillas ni explicación.\n\n${recent}\nCliente: ${userText}`,
                }],
                systemPrompt: 'Reescribes preguntas en consultas de búsqueda autónomas. Devuelves solo la consulta.',
                temperature: 0,
                tenantId,
            });
            const rewritten = resp.content?.trim().replace(/^["']|["']$/g, '');
            if (rewritten && rewritten.length > 2 && rewritten.length < 300) {
                this.logger.debug(`[RAG] Query rewritten: "${userText}" → "${rewritten}"`);
                return rewritten;
            }
        } catch (e: any) {
            this.logger.debug(`[RAG] Query rewrite skipped: ${e.message}`);
        }
        return userText;
    }

    /**
     * Output guardrail: if the response states a price the model wasn't given this
     * turn, do ONE corrective re-generation constrained to context prices. Never
     * blocks the customer — if it still can't be fixed, emits an event for
     * monitoring and sends the best attempt. Regex-cheap unless a mismatch is found.
     */
    private async applyOutputGuardrails(
        response: string,
        systemPrompt: string,
        currentMessages: any[],
        allowedTiers: ModelTier[],
        tenantId: string,
        conversationId: string,
    ): Promise<string> {
        if (!response || response === ERROR_FALLBACK_MSG) return response;

        const corpus = systemPrompt + '\n' + (currentMessages || [])
            .map(m => (typeof m?.content === 'string' ? m.content : '')).join('\n');

        const check = this.responseValidator.validatePrices(response, corpus);
        if (check.ok) return response;

        this.logger.warn(`[Guardrail] Response stated price(s) not in context: ${check.hallucinatedPrices.join(', ')} — corrective retry`);
        try {
            const corrected = await this.llmRouter.execute({
                task: 'conversation',
                messages: [
                    ...currentMessages,
                    { role: 'assistant', content: response },
                    { role: 'user', content: 'Tu respuesta anterior mencionó uno o más precios que NO aparecen en la información que tienes. Reescríbela usando ÚNICAMENTE precios presentes en el contexto; si no tienes el precio exacto, dilo con naturalidad y ofrece confirmarlo. Devuelve solo el mensaje corregido.' },
                ],
                systemPrompt,
                temperature: 0.3,
                allowedTiers,
                tenantId,
            });
            const fixed = corrected.content?.trim();
            if (fixed) {
                const recheck = this.responseValidator.validatePrices(fixed, corpus);
                if (!recheck.ok) {
                    this.eventEmitter.emit('response.guardrail.failed', { tenantId, conversationId, prices: recheck.hallucinatedPrices });
                }
                return fixed;
            }
        } catch (e: any) {
            this.logger.warn(`[Guardrail] corrective retry failed: ${e.message}`);
        }
        // Couldn't correct — surface for monitoring but never drop the customer reply.
        this.eventEmitter.emit('response.guardrail.failed', { tenantId, conversationId, prices: check.hallucinatedPrices });
        return response;
    }

    /**
     * Split a long reply into at most 3 balanced bubbles on paragraph boundaries.
     * Short or single-paragraph replies are returned as-is (never split mid-text),
     * so the common case is unchanged.
     */
    private splitResponseIntoChunks(text: string): string[] {
        const MIN_LEN_TO_CHUNK = 600;
        const MAX_CHUNKS = 3;
        if (!text || text.length <= MIN_LEN_TO_CHUNK) return [text];

        const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
        if (paras.length <= 1) return [text]; // no natural break — don't split mid-paragraph

        const targetLen = Math.ceil(text.length / Math.min(MAX_CHUNKS, paras.length));
        const chunks: string[] = [];
        let cur = '';
        for (const p of paras) {
            if (cur && cur.length + p.length > targetLen && chunks.length < MAX_CHUNKS - 1) {
                chunks.push(cur);
                cur = p;
            } else {
                cur = cur ? `${cur}\n\n${p}` : p;
            }
        }
        if (cur) chunks.push(cur);
        return chunks.length ? chunks : [text];
    }

    /** Resolve `p`, or reject after `ms` so one slow tool can't stall the turn. */
    private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
        return Promise.race([
            p,
            new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Tool ${label} timed out after ${ms}ms`)), ms)),
        ]);
    }

    private truncateHistory(history: any[], currentMessage: string): Array<{ role: string; content: string }> {
        const messages: Array<{ role: string; content: string }> = [];
        let totalChars = currentMessage.length;

        // Build from newest to oldest, then reverse
        for (let i = history.length - 1; i >= 0; i--) {
            const h = history[i];
            const content = h.content_text || '';
            if (totalChars + content.length > MAX_HISTORY_CHARS) break;
            totalChars += content.length;
            messages.unshift({
                role: h.direction === 'inbound' ? 'user' : 'assistant',
                content,
            });
        }

        // Add current message
        messages.push({ role: 'user', content: currentMessage });

        return messages;
    }

    /** Persist booking state to BOTH Redis (fast, reliable) and PostgreSQL (durable). */
    private async persistBookingState(schemaName: string, conversationId: string, state: any): Promise<void> {
        // Redis first — always succeeds, survives PG failures
        const redisKey = `booking:${conversationId}`;
        try {
            await this.redis.set(redisKey, JSON.stringify(state), 3600); // 1h TTL
        } catch (e: any) {
            this.logger.warn(`Redis booking state save failed: ${e.message}`);
        }
        // PostgreSQL — durable but may fail under shared memory pressure
        try {
            const update = { bookingState: state, bookingStateUpdatedAt: new Date().toISOString() };
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1::uuid`,
                [conversationId, JSON.stringify(update)],
            );
        } catch (e: any) {
            this.logger.warn(`PG booking state save failed (Redis has backup): ${e.message}`);
        }
    }

    /** Load booking state: Redis first (fast), fallback to conversation metadata. */
    private async loadBookingState(conversationId: string, conversationMetadata: any): Promise<BookingState> {
        try {
            const redisKey = `booking:${conversationId}`;
            const cached = await this.redis.get(redisKey);
            if (cached) {
                const state = JSON.parse(cached);
                if (state.step) {
                    this.logger.log(`[Pipeline] Booking state loaded from Redis: step=${state.step} svc=${state.serviceName || '-'}`);
                    return state;
                }
            }
        } catch {}
        // Fallback to PG metadata — but only if it's FRESH. The PG backup has no
        // TTL (unlike the 1h Redis key), so without this an abandoned booking could
        // be restored days later and, with date+time already captured, book a slot
        // in the past. Mirror the Redis 1h expiry.
        const state = conversationMetadata?.bookingState;
        if (state?.step && state.step !== 'idle') {
            const updatedAt = conversationMetadata?.bookingStateUpdatedAt;
            const ageMs = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) : Infinity;
            if (ageMs > 3600_000) {
                this.logger.log(`[Pipeline] Discarding stale PG booking state (age ${Math.round(ageMs / 60000)}min) — restarting idle`);
                return { step: 'idle' } as BookingState;
            }
            this.logger.log(`[Pipeline] Booking state loaded from PG metadata: step=${state.step}`);
            return state;
        }
        return state || { step: 'idle' };
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        const cacheKey = `tenant:${tenantId}:schema`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached;
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.redis.set(cacheKey, schema, 600);
        return schema;
    }

    /**
     * Static fallback when the tenant has exhausted their monthly AI quota.
     * We do NOT call the LLM — that's the point of the cap. We pick a polite
     * message in the tenant's preferred language so customers aren't left
     * staring at a black hole. Translation strings are intentionally plain
     * (no variables) to avoid pulling i18n into a hot path.
     */
    private async buildQuotaFallbackMessage(tenantId: string): Promise<string> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { language: true },
        }).catch(() => null);
        const lang = (tenant?.language || 'es').slice(0, 2).toLowerCase();
        const messages: Record<string, string> = {
            es: 'Gracias por tu mensaje. En breve un agente humano te atenderá.',
            en: 'Thanks for your message. A human agent will reach out shortly.',
            pt: 'Obrigado pela sua mensagem. Um atendente humano entrará em contato em breve.',
            fr: 'Merci pour votre message. Un agent humain vous répondra sous peu.',
        };
        return messages[lang] || messages.es;
    }

    async processWidgetMessage(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        contactId: string,
        text: string,
    ): Promise<string | null> {
        const config = await this.personaService.getPersonaForChannel(tenantId, 'web_widget');
        if (!config) return null;

        // Serialize widget turns per conversation, same mutex as the main pipeline
        // (token + heartbeat), so two quick widget messages don't process in parallel.
        const lockKey = `lock:conv:${conversationId}`;
        let lockToken = await this.redis.acquireLockToken(lockKey, 30);
        for (let i = 0; i < 4 && !lockToken; i++) {
            await new Promise(r => setTimeout(r, 500));
            lockToken = await this.redis.acquireLockToken(lockKey, 30);
        }
        let lockHeartbeat: ReturnType<typeof setInterval> | undefined;
        if (lockToken) {
            const tk = lockToken;
            lockHeartbeat = setInterval(() => { this.redis.renewLockToken(lockKey, tk, 30).catch(() => {}); }, 10_000);
            lockHeartbeat.unref?.();
        }

        try {

        const history = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT direction, content_text FROM messages
             WHERE conversation_id = $1::uuid ORDER BY created_at ASC LIMIT 20`,
            [conversationId],
        );

        const conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId],
        );

        const handoffReason = this.handoffService.shouldHandoff(text, conversation?.[0] || {}, config);
        if (handoffReason) {
            await this.handoffService.executeHandoff(tenantId, conversationId, {
                tenantId, conversationId, contactId, channelType: 'web_widget',
                content: { type: 'text', text },
            } as any, handoffReason);
            return 'Te estoy transfiriendo con nuestro equipo de atención. Un agente te responderá en breve.';
        }

        if (conversation?.[0]?.status === 'waiting_human' || conversation?.[0]?.status === 'with_human') {
            return null;
        }

        const now = new Date();
        const turnContext: any = {
            userMessage: text,
            language: 'es',
            channelType: 'web_widget',
            messageCount: (history?.length || 0) + 1,
            timezone: 'America/Bogota',
            now: now.toISOString(),
            upcomingDays: [],
            businessHoursStatus: 'open' as const,
        };
        const systemPrompt = this.promptAssembler.assemble(config, turnContext);

        const chatMessages = (history || []).map((m: any) => ({
            role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.content_text || '',
        }));
        chatMessages.push({ role: 'user' as const, content: text });

        try {
            const response = await this.llmRouter.execute({
                model: 'grok-4-1-fast-non-reasoning',
                messages: chatMessages,
                systemPrompt,
                temperature: 0.8,
                tenantId,
            });
            return response.content || null;
        } catch (err: any) {
            this.logger.warn(`Widget AI failed: ${err.message}`);
            return null;
        }
        } finally {
            if (lockHeartbeat) clearInterval(lockHeartbeat);
            if (lockToken) await this.redis.releaseLockToken(lockKey, lockToken).catch(() => {});
        }
    }

    /**
     * Streaming variant of processWidgetMessage for the web chat widget (#6 Fase-2).
     * Same lock/history/persona/handoff logic, but yields the AI reply token-by-token
     * via the router's executeStream so the widget renders progressively (lower TTFT).
     * It does NOT persist the outbound message nor emit sockets — the gateway does that
     * once the stream closes (mirroring how the gateway persists today). On error it
     * propagates so the gateway can emit widget:stream_error. Messaging channels are
     * untouched (they stay non-streaming).
     */
    async *streamWidgetMessage(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        contactId: string,
        text: string,
    ): AsyncGenerator<string, void, unknown> {
        const config = await this.personaService.getPersonaForChannel(tenantId, 'web_widget');
        if (!config) return;

        const lockKey = `lock:conv:${conversationId}`;
        let lockToken = await this.redis.acquireLockToken(lockKey, 30);
        for (let i = 0; i < 4 && !lockToken; i++) {
            await new Promise(r => setTimeout(r, 500));
            lockToken = await this.redis.acquireLockToken(lockKey, 30);
        }
        let lockHeartbeat: ReturnType<typeof setInterval> | undefined;
        if (lockToken) {
            const tk = lockToken;
            lockHeartbeat = setInterval(() => { this.redis.renewLockToken(lockKey, tk, 30).catch(() => {}); }, 10_000);
            lockHeartbeat.unref?.();
        }

        try {
            const history = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT direction, content_text FROM messages
                 WHERE conversation_id = $1::uuid ORDER BY created_at ASC LIMIT 20`,
                [conversationId],
            );
            const conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT * FROM conversations WHERE id = $1::uuid LIMIT 1`,
                [conversationId],
            );

            const handoffReason = this.handoffService.shouldHandoff(text, conversation?.[0] || {}, config);
            if (handoffReason) {
                await this.handoffService.executeHandoff(tenantId, conversationId, {
                    tenantId, conversationId, contactId, channelType: 'web_widget',
                    content: { type: 'text', text },
                } as any, handoffReason);
                yield 'Te estoy transfiriendo con nuestro equipo de atención. Un agente te responderá en breve.';
                return;
            }
            if (conversation?.[0]?.status === 'waiting_human' || conversation?.[0]?.status === 'with_human') {
                return;
            }

            const now = new Date();
            const turnContext: any = {
                userMessage: text,
                language: 'es',
                channelType: 'web_widget',
                messageCount: (history?.length || 0) + 1,
                timezone: 'America/Bogota',
                now: now.toISOString(),
                upcomingDays: [],
                businessHoursStatus: 'open' as const,
            };
            const systemPrompt = this.promptAssembler.assemble(config, turnContext);
            const chatMessages = (history || []).map((m: any) => ({
                role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: m.content_text || '',
            }));
            chatMessages.push({ role: 'user' as const, content: text });

            for await (const chunk of this.llmRouter.executeStream({
                model: 'grok-4-1-fast-non-reasoning',
                messages: chatMessages,
                systemPrompt,
                temperature: 0.8,
                tenantId,
            })) {
                yield chunk;
            }
        } finally {
            if (lockHeartbeat) clearInterval(lockHeartbeat);
            if (lockToken) await this.redis.releaseLockToken(lockKey, lockToken).catch(() => {});
        }
    }

    private mapLlmTierToAllowed(planTier: string | undefined): ModelTier[] {
        switch (planTier) {
            case 'tier_1':
                return ['tier_1_premium', 'tier_2_standard', 'tier_3_efficient', 'tier_4_budget'];
            case 'tier_2':
                return ['tier_2_standard', 'tier_3_efficient', 'tier_4_budget'];
            case 'tier_3':
            default:
                return ['tier_3_efficient', 'tier_4_budget'];
        }
    }
}
