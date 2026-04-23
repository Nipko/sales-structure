import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
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
import { NormalizedMessage, OutboundMessage, TenantConfig, TurnContext, RetrievedKnowledgeItem } from '@parallext/shared';
import { IdentityService } from '../identity/identity.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { APPOINTMENT_TOOLS } from './tools/appointment-tools';
import { CATALOG_TOOLS, OFFER_TOOL } from './tools/catalog-tools';
import { FAQ_TOOL, POLICY_TOOL, KB_TOOL } from './tools/knowledge-tools';
import { ORDER_TOOL, CUSTOMER_CONTEXT_TOOL } from './tools/crm-tools';
import { BookingEngineService, type BookingState } from './booking-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { LanguageDetectorService } from './language-detector.service';
import { BusinessInfoService } from '../business-info/business-info.service';
import { ComplianceService as AnalyticsComplianceService } from '../analytics/compliance.service';
import { AnalyticsService } from '../analytics/analytics.service';

/** Max characters of history to send to the LLM to avoid exceeding context window */
const MAX_HISTORY_CHARS = 12_000;

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
        private identityService: IdentityService,
        private toolExecutor: AIToolExecutorService,
        private bookingEngine: BookingEngineService,
        private intentInterpreter: IntentInterpreterService,
        private complianceService: AnalyticsComplianceService,
        private analyticsService: AnalyticsService,
        private promptAssembler: PromptAssemblerService,
        private languageDetector: LanguageDetectorService,
        private businessInfoService: BusinessInfoService,
    ) {}

    /**
     * Main entry point for incoming messages from any channel
     */
    async processIncomingMessage(normalizedMsg: NormalizedMessage): Promise<void> {
        const { tenantId, contactId, channelType, content } = normalizedMsg;
        this.logger.log(`Processing inbound message from ${contactId} on ${channelType} for tenant ${tenantId}`);

        // 1. Resolve Contact & Conversation
        const { contact, lead, conversation } = await this.resolveConversation(tenantId, contactId, channelType, normalizedMsg);
        normalizedMsg.conversationId = conversation.id;

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

        // Auto-progress stage from 'nuevo' to 'respondio' upon user message
        const schemaName = await this.tenantSchema(tenantId);
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

        // 2. Load Persona & Check Business Hours
        const config = await this.personaService.getPersonaForChannel(tenantId, channelType);
        this.logger.log(`[Pipeline] Persona loaded: ${config?.persona?.name || 'default'} (mode: ${(config as any)?._mode || 'wizard'})`);

        if (!config) {
            this.logger.error(`No active persona found for tenant ${tenantId}`);
            return;
        }

        if (!this.isWithinBusinessHours(config)) {
            this.logger.log(`[Pipeline] Outside business hours — sending after-hours message`);
            await this.sendAfterHoursMessage(tenantId, normalizedMsg, config);
            return;
        }

        // 3. Check if in human handoff mode — skip AI, just save message
        if (conversation.status === 'waiting_human' || conversation.status === 'with_human') {
            this.logger.log(`Conversation ${conversation.id} is in HUMAN HANDOFF mode. Skipping AI.`);
            await this.saveMessage(tenantId, conversation.id, normalizedMsg);
            return;
        }

        // 4. Save User Message
        await this.saveMessage(tenantId, conversation.id, normalizedMsg);
        this.logger.log(`[Pipeline] Message saved for conversation ${conversation.id}`);

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
            await this.handoffService.executeHandoff(tenantId, conversation.id, normalizedMsg, handoffReason);
            const handoffMsg = `Entiendo. Te comunicaré ahora mismo con nuestro equipo de asistencia humana. En un momento te responderán.`;
            await this.sendResponse(tenantId, handoffMsg, normalizedMsg);
            await this.saveAiMessage(tenantId, conversation.id, handoffMsg);
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

        // 6. Generate AI Response
        this.logger.log(`[Pipeline] Generating AI response...`);
        const complexity = this.llmRouter.analyzeComplexity(content?.text || '');
        const sentiment = this.llmRouter.analyzeSentiment(content?.text || '');
        const response = await this.generateResponse(tenantId, conversation, normalizedMsg, config, contact, lead, previousMessageAt);
        this.logger.log(`[Pipeline] AI response generated: ${response ? response.substring(0, 80) + '...' : 'NULL/EMPTY'}`);

        // Track AI response event
        if (response) {
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
            this.logger.log(`[Pipeline] Sending response via outbound queue...`);
            await this.sendResponse(tenantId, response, normalizedMsg);
            await this.saveAiMessage(tenantId, conversation.id, response);
            this.logger.log(`[Pipeline] Response sent and saved`);
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

        if (!contact) {
            contact = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO contacts (external_id, channel_type, name, phone) VALUES ($1, $2, $3, $4) RETURNING *`,
                [contactId, channelType, msg.metadata?.contactName || 'Unknown', contactId],
            ).then(res => res[0]);
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
        if (!lead) {
            const contactName = (msg.metadata as any)?.contactName as string || '';
            const nameParts = contactName.split(' ');
            const firstName = nameParts[0] || 'Unknown';
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

            lead = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO leads (contact_id, first_name, last_name, phone, stage, score) VALUES ($1::uuid, $2, $3, $4, 'nuevo', 10) RETURNING *`,
                [contactIdStr, firstName, lastName, contactId],
            ).then(res => res[0]);
            isNewLead = true;
        }

        // 3. Find active conversation or create new
        let conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM conversations WHERE contact_id = $1::uuid AND status IN ('active', 'waiting_human', 'with_human') ORDER BY created_at DESC LIMIT 1`,
            [contactIdStr],
        ).then(res => res[0]);

        if (!conversation) {
            conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO conversations (contact_id, channel_type, channel_account_id, status, stage) VALUES ($1::uuid, $2, $3, 'active', 'greeting') RETURNING *`,
                [contactIdStr, msg.channelType, msg.channelAccountId],
            ).then(res => res[0]);

            // Create an active opportunity tied to this new conversation
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO opportunities (lead_id, conversation_id, stage, score) VALUES ($1::uuid, $2::uuid, 'nuevo', 10)`,
                [String(lead.id), String(conversation.id)],
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

    private isWithinBusinessHours(config: TenantConfig): boolean {
        if (!config.hours || !config.hours.schedule) return true;

        const schedule: Record<string, any> = config.hours.schedule as any;
        // If schedule is empty, agent is always available
        if (Object.keys(schedule).length === 0) return true;

        // Detect 24/7 pattern: all 7 days with 00:00-23:59
        const values = Object.values(schedule);
        if (values.length >= 7) {
            const all247 = values.every(v =>
                v && typeof v === 'object' && (v as any).start === '00:00' && (v as any).end === '23:59'
            );
            if (all247) return true;
        }

        const now = new Date();
        const timezone = config.hours.timezone || 'America/Bogota';

        const localTime = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(now);

        const dayPartEn = localTime.find(p => p.type === 'weekday')?.value?.toLowerCase() || '';
        const hourPart = localTime.find(p => p.type === 'hour')?.value || '0';
        const minutePart = localTime.find(p => p.type === 'minute')?.value || '0';
        const currentMinutes = parseInt(hourPart) * 60 + parseInt(minutePart);

        // Map English day abbreviations to Spanish keys used in config
        const dayMap: Record<string, string> = {
            sun: 'dom', mon: 'lun', tue: 'mar', wed: 'mie', thu: 'jue', fri: 'vie', sat: 'sab',
        };
        const dayKey = dayMap[dayPartEn] || dayPartEn;

        // Try both Spanish key and English key (backward compat)
        const todaySchedule = schedule[dayKey] || schedule[dayPartEn];

        this.logger.debug(`[BusinessHours] day=${dayPartEn} key=${dayKey} time=${hourPart}:${minutePart} schedule=${JSON.stringify(todaySchedule)} keys=${Object.keys(schedule).join(',')}`);

        // No schedule for today or explicitly closed (null or string like "cerrado")
        if (!todaySchedule || typeof todaySchedule === 'string') return false;

        const [startH, startM] = todaySchedule.start.split(':').map(Number);
        const [endH, endM] = todaySchedule.end.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }

    private async sendAfterHoursMessage(tenantId: string, msg: NormalizedMessage, config: TenantConfig) {
        if (!config.hours?.afterHoursMessage) return;

        this.logger.log(`Sending after hours message to ${msg.contactId}`);

        // Translate afterHoursMessage to tenant language via EXPRESS
        let text = config.hours.afterHoursMessage;
        try {
            const lang = config.language || 'es-CO';
            const personaName = config.persona?.name || 'Assistant';
            const result = await this.llmRouter.execute({
                model: 'grok-4-1-fast-non-reasoning',
                messages: [{ role: 'user', content: `Rewrite naturally:\n${text}` }],
                systemPrompt: `You are ${personaName}. Rewrite this after-hours message in ${lang}. Be warm and concise.`,
                temperature: 0.7,
            });
            text = result.content || text;
        } catch {} // Fallback to raw message

        const outbound: OutboundMessage = {
            tenantId,
            channelType: msg.channelType,
            channelAccountId: msg.channelAccountId,
            to: msg.contactId,
            content: { type: 'text', text },
        };

        const accessToken = await this.resolveAccessToken(tenantId, msg.channelType);
        await this.outboundQueue.enqueue(outbound, accessToken);
    }

    private async saveMessage(tenantId: string, conversationId: string, msg: NormalizedMessage) {
        const schemaName = await this.tenantSchema(tenantId);
        const metadataJson = JSON.stringify(msg.metadata || {});

        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, metadata)
             VALUES ($1::uuid, 'inbound', $2, $3, 'delivered', $4::jsonb) RETURNING *`,
            [conversationId, msg.content.type, msg.content.text, metadataJson],
        );
        this.gateway.emitNewMessage(tenantId, result[0], conversationId);
    }

    private async saveAiMessage(tenantId: string, conversationId: string, text: string) {
        const schemaName = await this.tenantSchema(tenantId);

        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status)
             VALUES ($1::uuid, 'outbound', 'text', $2, 'delivered') RETURNING *`,
            [conversationId, text],
        );
        this.gateway.emitNewMessage(tenantId, result[0], conversationId);
    }

    private async sendResponse(tenantId: string, text: string, inboundMsg: NormalizedMessage) {
        const outbound: OutboundMessage = {
            tenantId,
            channelType: inboundMsg.channelType,
            channelAccountId: inboundMsg.channelAccountId,
            to: inboundMsg.contactId,
            content: { type: 'text', text },
        };

        const accessToken = await this.resolveAccessToken(tenantId, inboundMsg.channelType);
        // Use BullMQ queue for retry resilience (3 attempts, exponential backoff)
        await this.outboundQueue.enqueue(outbound, accessToken);
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
    private async generateResponse(tenantId: string, conversation: any, msg: NormalizedMessage, config: TenantConfig, contact?: any, lead?: any, previousMessageAt?: any): Promise<string> {
        if (msg.content.type !== 'text') {
            return `He recibido tu mensaje multimedia, pero por ahora solo puedo procesar texto. ¿Puedes describirlo?`;
        }

        const userText = msg.content.text || '';

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
        const detectedLanguage = this.languageDetector.detect(userText, configuredLanguage);
        const userLanguage = detectedLanguage;
        const tz = config.hours?.timezone || 'America/Bogota';
        const now = new Date();
        const businessHoursStatus: 'open' | 'closed' = this.isWithinBusinessHours(config) ? 'open' : 'closed';

        const turnContext: TurnContext = {
            language: userLanguage,
            timezone: tz,
            now: now.toISOString(),
            upcomingDays: this.promptAssembler.computeUpcomingDays(now, tz, 8),
            businessHoursStatus,
        };

        if (contact) {
            const contactName = contact.name || lead?.first_name || lead?.firstName;
            turnContext.contact = {
                name: contactName,
                email: contact.email,
                phone: contact.phone,
                isKnown: !!(contactName || contact.email),
                knownSince: contact.first_contact_at || contact.created_at,
            };
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

        // 4. Deterministic Booking Engine (runs BEFORE the LLM — emits interactive
        // messages directly for WhatsApp, or produces text for the LLM to voice).
        const toolsConfig = config.tools?.appointments ?? (config as any)?.tools?.appointments;
        const toolsEnabled = toolsConfig?.enabled === true;
        let tools: any[] = [];
        let bookingState: BookingState = (conversation.metadata as any)?.bookingState || { step: 'idle' };
        let engineProducedText: string | null = null;

        if (toolsEnabled) {
            const todayISO = now.toISOString().split('T')[0];
            const customerProfile = {
                name: contact?.name || lead?.first_name || lead?.firstName,
                email: contact?.email,
                phone: contact?.phone,
            };

            // ═══ PHASE 1: INTERPRET — extract structured intent ═══
            const serviceNames = bookingState.services?.map(s => s.name) || [];
            const upcoming = turnContext.upcomingDays || [];
            const intent = await this.intentInterpreter.interpret(
                userText, bookingState.step, serviceNames, todayISO, upcoming,
            );
            this.logger.log(`[Pipeline] INTERPRET: intent=${intent.intent} svc=${intent.serviceMentioned || '-'} date=${intent.dateMentioned || '-'} confirm=${intent.isConfirmation}`);

            // ═══ GREETING & FAREWELL at idle: let LLM handle naturally ═══
            const isGreetOrFarewell = intent.intent === 'greet' || intent.intent === 'farewell';
            const isIdleOrBooked = bookingState.step === 'idle' || bookingState.step === 'booked' || !bookingState.step;

            if (isGreetOrFarewell && isIdleOrBooked) {
                this.logger.log(`[Pipeline] ${intent.intent} (idle): LLM handles with full persona`);
                // Pre-load services so they're ready if user asks about them next turn
                if (!bookingState.services?.length) {
                    try {
                        const result = await this.toolExecutor.execute(schemaName, tenantId, conversation.contact_id || '', 'list_services', {});
                        if (result?.services?.length) bookingState.services = result.services;
                    } catch {}
                }
                await this.persistBookingState(schemaName, conversation.id, bookingState);
                // Skip engine entirely — fall through to LLM
            } else {
                // ═══ PHASE 2: DECIDE — deterministic booking engine ═══
                const engineResult = await this.bookingEngine.process(
                    schemaName, tenantId, conversation.contact_id || '',
                    intent, userText, bookingState, customerProfile, todayISO,
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

        // Register catalog + knowledge + CRM tools based on feature flags on the agent.
        const cfgTools = (config.tools ?? (config as any)?.tools) as any;
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

        // 5. Knowledge retrieval — STRUCTURED items in turn context, not prose.
        // Respects the agent's rag config (topK + similarityThreshold) which
        // was previously dead code. Hybrid search handles the rest.
        if (!engineProducedText) {
            try {
                const hasKnowledge = await this.knowledgeService.tenantHasKnowledge(tenantId);
                const ragConfig = config.rag;
                const ragEnabled = ragConfig?.enabled !== false;
                if (hasKnowledge && ragEnabled) {
                    const topK = ragConfig?.topK ?? 5;
                    const similarityThreshold = ragConfig?.similarityThreshold ?? 0;
                    const ragResults = await this.knowledgeService.searchRelevant(
                        tenantId, userText, topK, { similarityThreshold },
                    );
                    if (ragResults.length > 0) {
                        turnContext.retrievedKnowledge = ragResults.map((r: any, idx: number) => ({
                            source: 'kb_article' as const,
                            id: String(r.id ?? r.document_id ?? idx),
                            score: typeof r.score === 'number' ? r.score : (typeof r.similarity === 'number' ? r.similarity : undefined),
                            title: r.title,
                            content: r.chunk_text,
                        })) as RetrievedKnowledgeItem[];
                        this.logger.log(`RAG: Injected ${ragResults.length} chunks (topK=${topK}, threshold=${similarityThreshold}) for tenant ${tenantId}`);
                    }
                }
            } catch (ragError: any) {
                this.logger.warn(`RAG search failed (non-fatal): ${ragError.message}`);
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

        // 3. Get Conversation History with smart truncation
        const history = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT direction, content_text FROM messages WHERE conversation_id = $1::uuid ORDER BY created_at ASC LIMIT 30`,
            [conversation.id],
        );

        // Anti-repetition: tell the LLM how many messages exist in this conversation.
        // message_count > 1 means it's a CONTINUATION — don't re-introduce yourself.
        turnContext.messageCount = (history?.length || 0) + 1; // +1 for current message already saved

        const systemPrompt = this.promptAssembler.assemble(config, turnContext);

        let messages: Array<{ role: string; content: string }>;
        if (engineProducedText) {
            // Directive-based: LLM gets the user's actual message + conversation history
            // The directive is in <turn><directive> telling the LLM WHAT to communicate
            // The LLM generates the response naturally using its full persona
            if (isNewSession) {
                messages = [{ role: 'user', content: userText }];
            } else {
                messages = this.truncateHistory(history || [], userText);
            }
            this.logger.log(`[Pipeline] Express: directive-based with full persona + ${messages.length} history messages`);
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

            for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
                // Dual-model routing: Grok for conversation, Gemini for tools
                const hasTools = tools.length > 0;
                const conversationModel = 'grok-4-1-fast-non-reasoning'; // Natural, emotional, cheap
                const toolModel = 'gemini-2.5-pro';       // Best tool calling (99.3%)
                const selectedModel = hasTools ? toolModel : conversationModel;

                const response = await this.llmRouter.execute({
                    model: selectedModel,
                    messages: currentMessages,
                    systemPrompt,
                    temperature: hasTools ? 0.3 : 0.8, // Lower temp for tools, higher for natural conversation
                    tools: hasTools ? tools : undefined,
                    routingFactors: {
                        ticketValue: 50,
                        complexity,
                        conversationStage: stageScore,
                        sentiment,
                        intentType: complexity,
                    },
                });

                // Check if LLM wants to call tools
                if (response.toolCalls?.length && toolsEnabled) {
                    this.logger.log(`[Pipeline] LLM requested ${response.toolCalls.length} tool call(s) (iteration ${iteration + 1})`);

                    // Add assistant message with tool calls (using ChatMessage format)
                    currentMessages.push({
                        role: 'assistant',
                        content: response.content || '',
                        toolCalls: response.toolCalls,
                    });

                    // Execute each tool and update booking state
                    const contactId = conversation.contact_id || '';
                    for (const tc of response.toolCalls) {
                        const args = typeof tc.function.arguments === 'string'
                            ? JSON.parse(tc.function.arguments)
                            : tc.function.arguments;

                        const result = await this.toolExecutor.execute(
                            schemaName, tenantId, contactId, tc.function.name, args,
                        );

                        // Log tool result
                        if (toolsEnabled) {
                            this.logger.log(`[Pipeline] Tool ${tc.function.name} executed in LLM loop`);
                        }

                        currentMessages.push({
                            role: 'tool',
                            toolCallId: tc.id,
                            content: JSON.stringify(result),
                        });
                    }

                    continue; // Loop back for another LLM call with tool results
                }

                // No tool calls — this is the final text response
                finalResponse = response.content || '[Error Generating AI Response]';
                break;
            }

            // Booking state already persisted earlier in the engine block

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

            return 'Disculpa, tuve un problema procesando tu mensaje. ¿Podrías repetirlo?';
        }
    }

    /**
     * Truncate conversation history to stay within MAX_HISTORY_CHARS.
     * Keeps the most recent messages and always includes the current user message.
     */
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

    /** Helper to resolve tenant schema name (cached in Redis) */
    private async persistBookingState(schemaName: string, conversationId: string, state: any): Promise<void> {
        try {
            const update = { bookingState: state, bookingStateUpdatedAt: new Date().toISOString() };
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1::uuid`,
                [conversationId, JSON.stringify(update)],
            );
        } catch (e: any) {
            this.logger.warn(`Failed to persist booking state: ${e.message}`);
        }
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        const cacheKey = `tenant:${tenantId}:schema`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached;
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.redis.set(cacheKey, schema, 600);
        return schema;
    }

}
