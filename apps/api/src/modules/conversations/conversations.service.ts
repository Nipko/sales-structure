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
import { NormalizedMessage, OutboundMessage, TenantConfig } from '@parallext/shared';
import { IdentityService } from '../identity/identity.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { APPOINTMENT_TOOLS, APPOINTMENT_SYSTEM_PROMPT } from './tools/appointment-tools';
import { ComplianceService as AnalyticsComplianceService } from '../analytics/compliance.service';

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
        private complianceService: AnalyticsComplianceService,
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
        const config = await this.personaService.getActivePersona(tenantId);
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
        const response = await this.generateResponse(tenantId, conversation, normalizedMsg, config);
        this.logger.log(`[Pipeline] AI response generated: ${response ? response.substring(0, 80) + '...' : 'NULL/EMPTY'}`);

        // 7. Send Response via Channel Gateway
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

        // No schedule for today or explicitly closed (null or string like "cerrado")
        if (!todaySchedule || typeof todaySchedule === 'string') return false;

        const [startH, startM] = todaySchedule.start.split(':').map(Number);
        const [endH, endM] = todaySchedule.end.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    private async sendAfterHoursMessage(tenantId: string, msg: NormalizedMessage, config: TenantConfig) {
        if (!config.hours?.afterHoursMessage) return;

        this.logger.log(`Sending after hours message to ${msg.contactId}`);

        const outbound: OutboundMessage = {
            tenantId,
            channelType: msg.channelType,
            channelAccountId: msg.channelAccountId,
            to: msg.contactId,
            content: { type: 'text', text: config.hours.afterHoursMessage },
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
    private async generateResponse(tenantId: string, conversation: any, msg: NormalizedMessage, config: TenantConfig): Promise<string> {
        if (msg.content.type !== 'text') {
            return `He recibido tu mensaje multimedia, pero por ahora solo puedo procesar texto. ¿Puedes describirlo?`;
        }

        const userText = msg.content.text || '';

        // 1. Analyze routing factors
        const complexity = this.llmRouter.analyzeComplexity(userText);
        const sentiment = this.llmRouter.analyzeSentiment(userText);
        const stageScore = this.llmRouter.stageToScore(conversation.stage);

        this.logger.log(`Routing Factors - Complexity: ${complexity}, Sentiment: ${sentiment}, Stage: ${stageScore}`);

        // 2. Build Prompt (with optional RAG context)
        let systemPrompt = this.personaService.buildSystemPrompt(config);

        // 2b. Inject AI tools prompt if appointments tool is enabled
        const toolsConfig = (config as any)?.tools?.appointments;
        const toolsEnabled = toolsConfig?.enabled === true;
        let tools: any[] = [];

        if (toolsEnabled) {
            systemPrompt += '\n' + APPOINTMENT_SYSTEM_PROMPT;
            tools = [...APPOINTMENT_TOOLS];

            // Inject tool context from previous turns (persisted in conversation metadata)
            const prevContext = (conversation.metadata as any)?.toolContext;
            if (prevContext) {
                const ctxLines: string[] = ['\n## Previously obtained data (DO NOT re-ask for this):'];
                if (prevContext.list_services?.services?.length) {
                    ctxLines.push('Available services:');
                    for (const svc of prevContext.list_services.services) {
                        ctxLines.push(`- "${svc.name}" → serviceId: ${svc.id}, duration: ${svc.durationMinutes}min, price: $${svc.price} ${svc.currency}`);
                    }
                    ctxLines.push('IMPORTANT: When the customer mentions a service by name, use the corresponding serviceId from this list. DO NOT call list_services again.');
                }
                if (prevContext.check_availability) {
                    const avail = prevContext.check_availability;
                    ctxLines.push(`\nAvailability checked for ${avail.date}:`);
                    if (avail.available && avail.slots?.length) {
                        for (const slot of avail.slots) {
                            ctxLines.push(`- ${slot.time}-${slot.endTime}${slot.staffName ? ` with ${slot.staffName}` : ''}`);
                        }
                    } else {
                        ctxLines.push('- No availability for that date');
                    }
                }
                if (prevContext.create_appointment?.appointment) {
                    const apt = prevContext.create_appointment.appointment;
                    ctxLines.push(`\nAppointment already booked: ${apt.service} on ${apt.date} at ${apt.time} (${apt.status})`);
                }
                systemPrompt += '\n' + ctxLines.join('\n');
                this.logger.log(`[Pipeline] Injected tool context from previous turns: ${Object.keys(prevContext).join(', ')}`);
            }

            this.logger.log(`[Pipeline] AI tools enabled: appointments (${tools.length} tools)`);
        }

        // 2c. Inject knowledge base context if available
        try {
            const hasKnowledge = await this.knowledgeService.tenantHasKnowledge(tenantId);
            if (hasKnowledge) {
                const ragResults = await this.knowledgeService.searchRelevant(tenantId, userText, 5);
                if (ragResults.length > 0) {
                    const contextBlock = ragResults.map(r => r.chunk_text).join('\n\n');
                    systemPrompt = `${systemPrompt}\n\n[Contexto de base de conocimiento]\n${contextBlock}\n[Fin del contexto]`;
                    this.logger.log(`RAG: Injected ${ragResults.length} chunks for tenant ${tenantId}`);
                }
            }
        } catch (ragError: any) {
            this.logger.warn(`RAG search failed (non-fatal): ${ragError.message}`);
        }

        // 3. Get Conversation History with smart truncation
        const schemaName = await this.tenantSchema(tenantId);
        const history = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT direction, content_text FROM messages WHERE conversation_id = $1::uuid ORDER BY created_at ASC LIMIT 30`,
            [conversation.id],
        );

        const messages = this.truncateHistory(history || [], userText);

        // 4. Execute LLM Call using Router (with tool execution loop)
        try {
            const MAX_TOOL_ITERATIONS = 5;
            let currentMessages = [...messages] as any[];
            let finalResponse = '';

            for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
                const response = await this.llmRouter.execute({
                    model: 'gpt-4o-mini',
                    messages: currentMessages,
                    systemPrompt,
                    temperature: 0.7,
                    tools: tools.length > 0 ? tools : undefined,
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

                    // Execute each tool and add results
                    const contactId = conversation.contact_id || '';
                    for (const tc of response.toolCalls) {
                        const args = typeof tc.function.arguments === 'string'
                            ? JSON.parse(tc.function.arguments)
                            : tc.function.arguments;

                        const result = await this.toolExecutor.execute(
                            schemaName, tenantId, contactId, tc.function.name, args,
                        );

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

            // Persist tool context for subsequent turns
            if (toolsEnabled) {
                const toolContext: Record<string, any> = {};
                for (const msg of currentMessages) {
                    if ((msg as any).role === 'tool' && (msg as any).content) {
                        try {
                            const parsed = JSON.parse((msg as any).content);
                            // Find the tool name from the preceding assistant message
                            const assistantMsg = currentMessages.find(
                                (m: any) => m.toolCalls?.some((tc: any) => tc.id === (msg as any).toolCallId)
                            ) as any;
                            const toolCall = assistantMsg?.toolCalls?.find((tc: any) => tc.id === (msg as any).toolCallId);
                            if (toolCall) {
                                toolContext[toolCall.function.name] = parsed;
                            }
                        } catch { /* ignore parse errors */ }
                    }
                }

                if (Object.keys(toolContext).length > 0) {
                    await this.prisma.executeInTenantSchema(schemaName,
                        `UPDATE conversations
                         SET metadata = jsonb_set(
                             COALESCE(metadata, '{}'::jsonb),
                             '{toolContext}',
                             COALESCE(metadata->'toolContext', '{}'::jsonb) || $2::jsonb
                         )
                         WHERE id = $1::uuid`,
                        [conversation.id, JSON.stringify(toolContext)],
                    );
                    this.logger.log(`[Pipeline] Persisted tool context: ${Object.keys(toolContext).join(', ')}`);
                }
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
    private async tenantSchema(tenantId: string): Promise<string> {
        const cacheKey = `tenant:${tenantId}:schema`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached;
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.redis.set(cacheKey, schema, 600);
        return schema;
    }
}
