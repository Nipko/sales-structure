import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantsService } from '../tenants/tenants.service';
import * as yaml from 'js-yaml';
import { TenantConfig } from '@parallext/shared';

/**
 * Persona Configuration Engine
 * Loads, validates, and caches tenant persona configurations.
 * This is "the heart" of the platform — the focus of each new client onboarding.
 */
@Injectable()
export class PersonaService {
    private readonly logger = new Logger(PersonaService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private tenantsService: TenantsService,
    ) { }

    /**
     * Load the active persona config for a tenant.
     * Checks Redis cache first, then database.
     */
    async getActivePersona(tenantId: string): Promise<TenantConfig> {
        // Check cache
        const cacheKey = `persona:${tenantId}:active`;
        const cached = await this.redis.getJson<TenantConfig>(cacheKey);
        if (cached) return cached;

        // Load from database
        let config: TenantConfig | null = null;
        try {
            const schemaName = await this.tenantsService.getSchemaName(tenantId);
            const result = await this.prisma.$queryRawUnsafe(
                `SELECT config_json FROM "${schemaName}".persona_config WHERE is_active = true ORDER BY version DESC LIMIT 1`,
            ) as any[];

            if (result && result.length > 0) {
                config = result[0].config_json as TenantConfig;
            }
        } catch (e: any) {
            this.logger.warn(`Could not load persona for tenant ${tenantId}: ${e.message}`);
        }

        // Fallback: use default persona so new tenants work immediately
        if (!config) {
            this.logger.log(`Using default persona for tenant ${tenantId} (no persona_config found)`);
            config = this.buildDefaultPersona(tenantId);
        }

        // Cache for 10 minutes
        await this.redis.setJson(cacheKey, config, 600);

        return config;
    }

    /**
     * Save or update a persona config from YAML
     */
    async savePersonaFromYaml(tenantId: string, yamlContent: string, createdBy?: string): Promise<TenantConfig> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);

        // Parse YAML to JSON
        const configJson = yaml.load(yamlContent) as TenantConfig;

        // Validate the config structure
        this.validateConfig(configJson);

        // Prevent activating the appointments tool without prerequisites in the
        // tenant schema. Without this gate, the AI tool ends up returning
        // "no hay disponibilidad" forever and the tenant does not realize the
        // agenda was never set up.
        const appointmentsEnabled = (configJson as any)?.tools?.appointments?.enabled === true;
        if (appointmentsEnabled) {
            await this.assertAppointmentsPrerequisites(tenantId, schemaName);
        }

        // Deactivate previous versions
        await this.prisma.$executeRawUnsafe(
            `UPDATE "${schemaName}".persona_config SET is_active = false WHERE is_active = true`,
        );

        // Get next version number
        const versionResult = await this.prisma.$queryRawUnsafe(
            `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM "${schemaName}".persona_config`,
        ) as any[];
        const nextVersion = versionResult[0]?.next_version || 1;

        // Insert new config
        await this.prisma.$executeRawUnsafe(
            `INSERT INTO "${schemaName}".persona_config (config_yaml, config_json, version, is_active, created_by)
       VALUES ($1, $2::jsonb, $3, true, $4)`,
            yamlContent,
            JSON.stringify(configJson),
            nextVersion,
            createdBy || 'system',
        );

        // Invalidate cache
        await this.redis.del(`persona:${tenantId}:active`);

        this.logger.log(`Persona config v${nextVersion} saved for tenant ${tenantId}`);
        return configJson;
    }

    /**
     * Build the system prompt from persona config
     */
    buildSystemPrompt(config: TenantConfig): string {
        // If a custom prompt was provided, use it directly
        const customPrompt = (config as any)._customPrompt;
        if (customPrompt && (config as any)._mode === 'prompt') {
            return customPrompt;
        }

        const persona = config.persona;
        const behavior = config.behavior;

        let prompt = `Eres ${persona.name}, ${persona.role}.\n\n`;

        // Personality
        prompt += `## Tu Personalidad\n`;
        prompt += `- Tono: ${persona.personality.tone}\n`;
        prompt += `- Formalidad: ${persona.personality.formality}\n`;
        prompt += `- Uso de emojis: ${persona.personality.emojiUsage}\n`;
        prompt += `- Humor: ${persona.personality.humor}\n\n`;

        // Rules
        if (behavior.rules?.length > 0) {
            prompt += `## Reglas Estrictas (DEBES seguir siempre)\n`;
            behavior.rules.forEach((rule, i) => {
                prompt += `${i + 1}. ${rule}\n`;
            });
            prompt += '\n';
        }

        // Required fields
        if (behavior.requiredFields) {
            prompt += `## Información que DEBES recopilar\n`;
            for (const [context, fields] of Object.entries(behavior.requiredFields)) {
                prompt += `### Para ${context}:\n`;
                fields.forEach((f) => {
                    prompt += `- ${f.field}: "${f.question}"\n`;
                });
            }
            prompt += '\n';
        }

        // Forbidden topics
        if (behavior.forbiddenTopics?.length > 0) {
            prompt += `## Temas PROHIBIDOS (nunca hablar de esto)\n`;
            behavior.forbiddenTopics.forEach((t) => {
                prompt += `- ${t}\n`;
            });
            prompt += '\n';
        }

        // Handoff triggers
        if (behavior.handoffTriggers?.length > 0) {
            prompt += `## Escalar a agente humano cuando:\n`;
            behavior.handoffTriggers.forEach((t) => {
                prompt += `- ${t}\n`;
            });
            prompt += '\n';
        }

        // Business hours
        if (config.hours) {
            prompt += `## Horario del negocio\n`;
            prompt += `Zona horaria: ${config.hours.timezone}\n`;
            for (const [day, hours] of Object.entries(config.hours.schedule)) {
                prompt += `- ${day}: ${hours}\n`;
            }
            prompt += '\n';
        }

        return prompt;
    }

    /**
     * Get persona config version history
     */
    async getVersionHistory(tenantId: string): Promise<any[]> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        return this.prisma.$queryRawUnsafe(
            `SELECT id, version, is_active, created_by, created_at FROM "${schemaName}".persona_config ORDER BY version DESC`,
        ) as Promise<any[]>;
    }

    /**
     * Build a sensible default persona for tenants that haven't configured one yet.
     * Uses the tenant name from the DB if available.
     */
    private buildDefaultPersona(tenantId: string): TenantConfig {
        return {
            id: tenantId,
            name: 'Default',
            slug: 'default',
            industry: 'general',
            language: 'es-CO',
            isActive: true,
            persona: {
                name: 'Asistente',
                role: 'Asistente virtual de atención al cliente',
                personality: {
                    tone: 'amigable, profesional',
                    formality: 'casual-professional',
                    emojiUsage: 'minimal',
                    humor: 'ligero',
                },
                greeting: '¡Hola! Soy tu asistente virtual. ¿En qué puedo ayudarte hoy?',
                fallbackMessage: 'No tengo esa información en este momento. Déjame conectarte con alguien de nuestro equipo.',
            },
            behavior: {
                rules: [
                    'Responder siempre en español de forma clara y profesional',
                    'Nunca inventar información que no tengas',
                    'Si no puedes resolver la consulta, ofrecer hablar con un humano',
                ],
                requiredFields: {},
                forbiddenTopics: [],
                handoffTriggers: [
                    'Solicitud explícita de hablar con un humano',
                    'Quejas o reclamos formales',
                ],
            },
            llm: {
                temperature: 0.7,
                maxTokens: 800,
                routing: {
                    tiers: {
                        tier_1_premium: { models: ['gpt-4o'], costLevel: 'high' },
                        tier_2_standard: { models: ['gpt-4o-mini'], costLevel: 'medium' },
                        tier_3_efficient: { models: ['gpt-4o-mini'], costLevel: 'low' },
                        tier_4_budget: { models: ['gpt-4o-mini'], costLevel: 'very_low' },
                    },
                    factors: {},
                    fallback: 'auto_upgrade',
                },
                memory: { shortTerm: 20, longTerm: false, summaryAfter: 30 },
            },
            rag: { enabled: false, chunkSize: 512, chunkOverlap: 50, topK: 5, similarityThreshold: 0.75 },
            hours: {
                timezone: 'America/Bogota',
                schedule: {},
                afterHoursMessage: '',
            },
        };
    }

    /**
     * Validate persona config structure
     */
    private validateConfig(config: any): void {
        if (!config.persona?.name) throw new Error('Persona name is required');
        if (!config.persona?.role) throw new Error('Persona role is required');
        if (!config.behavior?.rules) throw new Error('Behavior rules are required');
    }

    // ── Multi-Agent System ──────────────────────────────────────

    /**
     * Get the persona assigned to a specific channel.
     * Falls back to default persona, then to auto-generated default.
     */
    async getPersonaForChannel(tenantId: string, channelType: string): Promise<TenantConfig> {
        // Check cache first
        const cacheKey = `persona:${tenantId}:channel:${channelType}`;
        const cached = await this.redis.getJson<TenantConfig>(cacheKey);
        if (cached) return cached;

        const schemaName = await this.tenantsService.getSchemaName(tenantId);

        // 1. Find agent assigned to this channel
        let config: TenantConfig | null = null;
        try {
            const rows = await this.prisma.$queryRawUnsafe(
                `SELECT config_json FROM "${schemaName}".agent_personas
                 WHERE is_active = true AND $1 = ANY(channels)
                 ORDER BY updated_at DESC LIMIT 1`,
                channelType,
            ) as any[];
            if (rows.length > 0) config = rows[0].config_json as TenantConfig;
        } catch (e: any) {
            this.logger.warn(`agent_personas lookup failed for ${tenantId}/${channelType}: ${e.message}`);
        }

        // 2. Fallback to default agent
        if (!config) {
            try {
                const rows = await this.prisma.$queryRawUnsafe(
                    `SELECT config_json FROM "${schemaName}".agent_personas
                     WHERE is_active = true AND is_default = true LIMIT 1`,
                ) as any[];
                if (rows.length > 0) config = rows[0].config_json as TenantConfig;
            } catch {}
        }

        // 3. Fallback to legacy persona_config
        if (!config) {
            return this.getActivePersona(tenantId);
        }

        await this.redis.setJson(cacheKey, config, 600);
        return config;
    }

    /**
     * List all agent personas for a tenant
     */
    async listAgents(tenantId: string): Promise<any[]> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        return this.prisma.$queryRawUnsafe(
            `SELECT id, name, template_id, is_active, is_default, config_json, channels, schedule_mode, version, created_by, created_at, updated_at
             FROM "${schemaName}".agent_personas ORDER BY is_default DESC, created_at ASC`,
        ) as Promise<any[]>;
    }

    /**
     * Get a single agent by ID
     */
    async getAgent(tenantId: string, agentId: string): Promise<any> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT * FROM "${schemaName}".agent_personas WHERE id = $1::uuid`,
            agentId,
        ) as any[];
        return rows[0] || null;
    }

    /**
     * Create a new agent persona
     */
    async createAgent(tenantId: string, data: {
        name: string;
        templateId?: string;
        configJson: any;
        channels?: string[];
        scheduleMode?: string;
        isDefault?: boolean;
        createdBy?: string;
    }): Promise<any> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);

        // If setting as default, unset other defaults
        if (data.isDefault) {
            await this.prisma.$executeRawUnsafe(
                `UPDATE "${schemaName}".agent_personas SET is_default = false WHERE is_default = true`,
            );
        }

        // Check channel conflicts
        if (data.channels && data.channels.length > 0) {
            for (const ch of data.channels) {
                const conflicts = await this.prisma.$queryRawUnsafe(
                    `SELECT id, name FROM "${schemaName}".agent_personas
                     WHERE is_active = true AND $1 = ANY(channels)`,
                    ch,
                ) as any[];
                if (conflicts.length > 0) {
                    // Remove channel from conflicting agent
                    await this.prisma.$executeRawUnsafe(
                        `UPDATE "${schemaName}".agent_personas SET channels = array_remove(channels, $1), updated_at = NOW() WHERE id = $2::uuid`,
                        ch, conflicts[0].id,
                    );
                    this.logger.log(`Removed channel ${ch} from agent ${conflicts[0].name} (${conflicts[0].id})`);
                }
            }
        }

        const rows = await this.prisma.$queryRawUnsafe(
            `INSERT INTO "${schemaName}".agent_personas (name, template_id, config_json, channels, schedule_mode, is_default, created_by)
             VALUES ($1, $2, $3::jsonb, $4::text[], $5, $6, $7) RETURNING *`,
            data.name,
            data.templateId || null,
            JSON.stringify(data.configJson),
            data.channels || [],
            data.scheduleMode || '24_7',
            data.isDefault || false,
            data.createdBy || 'system',
        ) as any[];

        // Invalidate cache for affected channels
        if (data.channels) {
            for (const ch of data.channels) {
                await this.redis.del(`persona:${tenantId}:channel:${ch}`);
            }
        }
        await this.redis.del(`persona:${tenantId}:active`);

        return rows[0];
    }

    /**
     * Update an existing agent
     */
    async updateAgent(tenantId: string, agentId: string, data: {
        name?: string;
        configJson?: any;
        channels?: string[];
        scheduleMode?: string;
        isActive?: boolean;
        isDefault?: boolean;
    }): Promise<any> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);

        if (data.isDefault) {
            await this.prisma.$executeRawUnsafe(
                `UPDATE "${schemaName}".agent_personas SET is_default = false WHERE is_default = true AND id != $1::uuid`,
                agentId,
            );
        }

        // Handle channel reassignment conflicts
        if (data.channels) {
            for (const ch of data.channels) {
                await this.prisma.$executeRawUnsafe(
                    `UPDATE "${schemaName}".agent_personas SET channels = array_remove(channels, $1), updated_at = NOW() WHERE id != $2::uuid AND $1 = ANY(channels)`,
                    ch, agentId,
                );
            }
        }

        const sets: string[] = ['updated_at = NOW()'];
        const params: any[] = [];
        let paramIdx = 1;

        if (data.name !== undefined) { sets.push(`name = $${paramIdx}`); params.push(data.name); paramIdx++; }
        if (data.configJson !== undefined) { sets.push(`config_json = $${paramIdx}::jsonb`); params.push(JSON.stringify(data.configJson)); paramIdx++; }
        if (data.channels !== undefined) { sets.push(`channels = $${paramIdx}::text[]`); params.push(data.channels); paramIdx++; }
        if (data.scheduleMode !== undefined) { sets.push(`schedule_mode = $${paramIdx}`); params.push(data.scheduleMode); paramIdx++; }
        if (data.isActive !== undefined) { sets.push(`is_active = $${paramIdx}`); params.push(data.isActive); paramIdx++; }
        if (data.isDefault !== undefined) { sets.push(`is_default = $${paramIdx}`); params.push(data.isDefault); paramIdx++; }

        sets.push(`version = version + 1`);
        params.push(agentId);

        const rows = await this.prisma.$queryRawUnsafe(
            `UPDATE "${schemaName}".agent_personas SET ${sets.join(', ')} WHERE id = $${paramIdx}::uuid RETURNING *`,
            ...params,
        ) as any[];

        // Invalidate caches
        await this.redis.del(`persona:${tenantId}:active`);
        const agent = rows[0];
        if (agent?.channels) {
            for (const ch of agent.channels) {
                await this.redis.del(`persona:${tenantId}:channel:${ch}`);
            }
        }

        return agent;
    }

    /**
     * Delete (soft) an agent — set inactive
     */
    async deleteAgent(tenantId: string, agentId: string): Promise<void> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);

        // Don't allow deleting the default agent
        const agent = await this.getAgent(tenantId, agentId);
        if (agent?.is_default) {
            throw new BadRequestException('Cannot delete the default agent. Set another agent as default first.');
        }

        await this.prisma.$executeRawUnsafe(
            `UPDATE "${schemaName}".agent_personas SET is_active = false, channels = '{}', updated_at = NOW() WHERE id = $1::uuid`,
            agentId,
        );

        await this.redis.del(`persona:${tenantId}:active`);
    }

    /**
     * Duplicate an agent
     */
    async duplicateAgent(tenantId: string, agentId: string, createdBy?: string): Promise<any> {
        const agent = await this.getAgent(tenantId, agentId);
        if (!agent) throw new BadRequestException('Agent not found');

        return this.createAgent(tenantId, {
            name: `${agent.name} (copy)`,
            templateId: agent.template_id,
            configJson: agent.config_json,
            channels: [], // Don't copy channel assignments
            scheduleMode: agent.schedule_mode,
            isDefault: false,
            createdBy: createdBy || 'system',
        });
    }

    /**
     * Save an agent's config as a reusable template
     */
    async saveAsTemplate(tenantId: string, agentId: string, name: string, description: string, createdBy?: string): Promise<any> {
        const agent = await this.getAgent(tenantId, agentId);
        if (!agent) throw new BadRequestException('Agent not found');

        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `INSERT INTO "${schemaName}".agent_templates (name, description, config_json, is_builtin, created_by)
             VALUES ($1, $2, $3::jsonb, false, $4) RETURNING *`,
            name, description || '', JSON.stringify(agent.config_json), createdBy || 'system',
        ) as any[];
        return rows[0];
    }

    /**
     * List templates (built-in + user-saved)
     */
    async listTemplates(tenantId: string): Promise<any[]> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        try {
            return await this.prisma.$queryRawUnsafe(
                `SELECT * FROM "${schemaName}".agent_templates ORDER BY is_builtin DESC, created_at ASC`,
            ) as any[];
        } catch {
            return this.getBuiltinTemplates();
        }
    }

    /**
     * Delete a user-created template
     */
    async deleteTemplate(tenantId: string, templateId: string): Promise<void> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        await this.prisma.$executeRawUnsafe(
            `DELETE FROM "${schemaName}".agent_templates WHERE id = $1::uuid AND is_builtin = false`,
            templateId,
        );
    }

    /**
     * Built-in templates (always available)
     */
    private getBuiltinTemplates(): any[] {
        return [
            {
                id: 'tpl_sales',
                name: 'Sales Advisor',
                description: 'Friendly and persuasive agent focused on converting leads and closing sales',
                icon: 'shopping-cart',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Sales Advisor',
                        role: 'Sales advisor and product specialist',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'moderate', humor: 'light' },
                        greeting: 'Hi! I\'m here to help you find exactly what you need. What are you looking for?',
                        fallbackMessage: 'Let me connect you with a specialist who can help you better.',
                    },
                    behavior: {
                        rules: ['Never invent prices or availability', 'Always confirm details before quoting', 'Offer to connect with a human if unable to resolve in 3 messages'],
                        forbiddenTopics: ['Competitor pricing', 'Internal company matters'],
                        handoffTriggers: ['Customer explicitly asks for a human', 'Formal complaints', 'Complex negotiations'],
                        requiredFields: {},
                    },
                },
            },
            {
                id: 'tpl_support',
                name: 'Support Agent',
                description: 'Professional and empathetic agent for customer support and issue resolution',
                icon: 'headphones',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Support Agent',
                        role: 'Customer support specialist',
                        personality: { tone: 'professional', formality: 'formal', emojiUsage: 'minimal', humor: '' },
                        greeting: 'Hello! I\'m here to help you resolve any issues. How can I assist you today?',
                        fallbackMessage: 'I\'m escalating this to our support team. Someone will follow up shortly.',
                    },
                    behavior: {
                        rules: ['Always acknowledge the customer\'s issue first', 'Provide step-by-step solutions', 'Escalate if the issue requires technical intervention'],
                        forbiddenTopics: [],
                        handoffTriggers: ['Technical issues beyond FAQ scope', 'Billing disputes', 'Account security concerns'],
                        requiredFields: {},
                    },
                },
            },
            {
                id: 'tpl_faq',
                name: 'FAQ Bot',
                description: 'Concise and helpful agent that answers frequently asked questions',
                icon: 'help-circle',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'FAQ Assistant',
                        role: 'Information assistant',
                        personality: { tone: 'friendly', formality: 'casual', emojiUsage: 'minimal', humor: '' },
                        greeting: 'Hi! Ask me anything and I\'ll do my best to help.',
                        fallbackMessage: 'I don\'t have that information right now. Let me connect you with someone who can help.',
                    },
                    behavior: {
                        rules: ['Keep answers concise and clear', 'Reference knowledge base when available', 'Suggest related topics proactively'],
                        forbiddenTopics: [],
                        handoffTriggers: ['Question not in knowledge base after 2 attempts'],
                        requiredFields: {},
                    },
                },
            },
            {
                id: 'tpl_appointments',
                name: 'Appointment Scheduler',
                description: 'Efficient agent specialized in booking and managing appointments',
                icon: 'calendar',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Scheduling Assistant',
                        role: 'Appointment scheduling specialist',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'minimal', humor: '' },
                        greeting: 'Hello! I can help you schedule an appointment. What service are you interested in?',
                        fallbackMessage: 'Let me connect you with our team to help schedule your appointment.',
                    },
                    behavior: {
                        rules: ['Always confirm date, time and service before booking', 'Offer alternative slots if preferred time is unavailable', 'Send booking confirmation details'],
                        forbiddenTopics: [],
                        handoffTriggers: ['Complex scheduling requirements', 'Cancellation of multiple appointments'],
                        requiredFields: {},
                    },
                    tools: { appointments: { enabled: true, canBook: true, canCancel: true } },
                },
            },
            {
                id: 'tpl_lead_qualifier',
                name: 'Lead Qualifier',
                description: 'Strategic agent that qualifies leads through intelligent conversation',
                icon: 'target',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Qualification Assistant',
                        role: 'Lead qualification specialist',
                        personality: { tone: 'professional', formality: 'casual-professional', emojiUsage: 'none', humor: '' },
                        greeting: 'Hi! I\'d love to learn more about what you\'re looking for so I can connect you with the right person.',
                        fallbackMessage: 'Thanks for your interest! Let me connect you with a specialist.',
                    },
                    behavior: {
                        rules: ['Gather: name, company, budget range, timeline, decision-making role', 'Score leads based on responses', 'Escalate hot leads immediately'],
                        forbiddenTopics: ['Detailed pricing without qualification'],
                        handoffTriggers: ['Lead score above 70', 'Budget confirmed and timeline under 30 days', 'Decision maker identified'],
                        requiredFields: {},
                    },
                },
            },
            {
                id: 'tpl_blank',
                name: 'Blank Agent',
                description: 'Start from scratch with a clean configuration',
                icon: 'plus',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: '',
                        role: '',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'minimal', humor: '' },
                        greeting: '',
                        fallbackMessage: '',
                    },
                    behavior: { rules: [], forbiddenTopics: [], handoffTriggers: [], requiredFields: {} },
                },
            },
        ];
    }

    private async assertAppointmentsPrerequisites(tenantId: string, schemaName: string): Promise<void> {
        const [servicesRow] = (await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS cnt FROM "${schemaName}".services WHERE is_active = true`,
        )) as any[];
        const [slotsRow] = (await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS cnt FROM "${schemaName}".availability_slots WHERE is_active = true`,
        )) as any[];
        const services = Number(servicesRow?.cnt || 0);
        const slots = Number(slotsRow?.cnt || 0);

        if (services === 0 || slots === 0) {
            const missing: string[] = [];
            if (services === 0) missing.push('servicios');
            if (slots === 0) missing.push('horarios de disponibilidad');
            const msg = `No se puede activar el agendador de citas sin ${missing.join(' y ')} configurados. Ir a Citas → Config y completar antes de habilitar la herramienta.`;
            this.logger.warn(`Rejected persona save for tenant ${tenantId}: appointments enabled without prerequisites (services=${services}, slots=${slots})`);
            throw new BadRequestException({
                error: 'appointments_prerequisites_missing',
                message: msg,
                missing,
            });
        }
    }
}
