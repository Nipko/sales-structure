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
    private initializedTenants = new Set<string>();

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

        // Required fields — skip when appointments tool is active (tool has its own flow)
        const appointmentsEnabled = (config as any)?.tools?.appointments?.enabled === true;
        if (behavior.requiredFields && Object.keys(behavior.requiredFields).length > 0 && !appointmentsEnabled) {
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
     * Deep merge two config objects (template overrides default).
     */
    private deepMergeConfig(target: any, source: any): any {
        const output = { ...target };
        for (const key of Object.keys(source)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
                output[key] = this.deepMergeConfig(target[key], source[key]);
            } else if (source[key] !== undefined) {
                output[key] = source[key];
            }
        }
        return output;
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

    // ── Multi-Agent Table Migration ─────────────────────────────

    /**
     * Ensure agent_personas and agent_templates tables exist in tenant schema.
     * Called lazily on first multi-agent access. Safe to call multiple times (IF NOT EXISTS).
     */
    async ensureMultiAgentTables(tenantId: string): Promise<void> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);

        await this.prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}"."agent_personas" (
                "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                "name" VARCHAR(255) NOT NULL,
                "template_id" VARCHAR(100),
                "is_active" BOOLEAN DEFAULT true,
                "is_default" BOOLEAN DEFAULT false,
                "config_json" JSONB NOT NULL,
                "channels" TEXT[] DEFAULT '{}',
                "schedule_mode" VARCHAR(20) DEFAULT '24_7',
                "version" INTEGER DEFAULT 1,
                "created_by" VARCHAR(255),
                "created_at" TIMESTAMP DEFAULT NOW(),
                "updated_at" TIMESTAMP DEFAULT NOW()
            )
        `);

        await this.prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}"."agent_templates" (
                "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                "name" VARCHAR(255) NOT NULL,
                "description" TEXT,
                "icon" VARCHAR(50) DEFAULT 'bot',
                "config_json" JSONB NOT NULL,
                "is_builtin" BOOLEAN DEFAULT false,
                "created_by" VARCHAR(255),
                "created_at" TIMESTAMP DEFAULT NOW()
            )
        `);

        // Create indexes (one per call — Prisma doesn't allow multiple statements)
        await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_agent_personas_active_${schemaName}" ON "${schemaName}"."agent_personas" ("is_active")`);
        await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_agent_personas_channels_${schemaName}" ON "${schemaName}"."agent_personas" USING GIN ("channels")`);
        await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_agent_personas_default_${schemaName}" ON "${schemaName}"."agent_personas" ("is_default") WHERE "is_default" = true`);
    }

    private async ensureTablesForTenant(tenantId: string): Promise<void> {
        if (this.initializedTenants.has(tenantId)) return;
        await this.ensureMultiAgentTables(tenantId);
        this.initializedTenants.add(tenantId);
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

        await this.ensureTablesForTenant(tenantId);
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
     * List all agent personas for a tenant.
     * Auto-migrates from legacy persona_config if no agents exist yet.
     */
    async listAgents(tenantId: string): Promise<any[]> {
        await this.ensureTablesForTenant(tenantId);
        const schemaName = await this.tenantsService.getSchemaName(tenantId);

        let agents = await this.prisma.$queryRawUnsafe(
            `SELECT id, name, template_id, is_active, is_default, config_json, channels, schedule_mode, version, created_by, created_at, updated_at
             FROM "${schemaName}".agent_personas ORDER BY is_default DESC, created_at ASC`,
        ) as any[];

        // Auto-migrate from legacy persona_config if no agents exist
        if (agents.length === 0) {
            const legacy = await this.prisma.$queryRawUnsafe(
                `SELECT config_json FROM "${schemaName}".persona_config WHERE is_active = true ORDER BY version DESC LIMIT 1`,
            ) as any[];

            if (legacy.length > 0) {
                const config = legacy[0].config_json;
                await this.prisma.$executeRawUnsafe(
                    `INSERT INTO "${schemaName}".agent_personas (name, config_json, is_active, is_default, channels, schedule_mode, created_by)
                     VALUES ($1, $2::jsonb, true, true, $3::text[], '24_7', 'migration')`,
                    config?.persona?.name || 'Default Agent',
                    JSON.stringify(config),
                    ['whatsapp', 'instagram', 'messenger', 'telegram', 'sms'],
                );

                agents = await this.prisma.$queryRawUnsafe(
                    `SELECT id, name, template_id, is_active, is_default, config_json, channels, schedule_mode, version, created_by, created_at, updated_at
                     FROM "${schemaName}".agent_personas ORDER BY is_default DESC, created_at ASC`,
                ) as any[];

                this.logger.log(`Auto-migrated legacy persona_config to agent_personas for tenant ${tenantId}`);
            }
        }

        return agents;
    }

    /**
     * Get a single agent by ID
     */
    async getAgent(tenantId: string, agentId: string): Promise<any> {
        await this.ensureTablesForTenant(tenantId);
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
        await this.ensureTablesForTenant(tenantId);
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

        // Merge template config with default persona so all required fields exist
        const defaultBase = this.buildDefaultPersona(tenantId);
        const mergedConfig = this.deepMergeConfig(defaultBase, data.configJson || {});
        // Override persona name/role with the agent name
        if (data.name && mergedConfig.persona) {
            mergedConfig.persona.name = mergedConfig.persona.name || data.name;
        }

        const rows = await this.prisma.$queryRawUnsafe(
            `INSERT INTO "${schemaName}".agent_personas (name, template_id, config_json, channels, schedule_mode, is_default, created_by)
             VALUES ($1, $2, $3::jsonb, $4::text[], $5, $6, $7) RETURNING *`,
            data.name,
            data.templateId || null,
            JSON.stringify(mergedConfig),
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
        const builtins = this.getBuiltinTemplates();
        let userTemplates: any[] = [];
        try {
            await this.ensureTablesForTenant(tenantId);
            const schemaName = await this.tenantsService.getSchemaName(tenantId);
            userTemplates = await this.prisma.$queryRawUnsafe(
                `SELECT * FROM "${schemaName}".agent_templates WHERE is_builtin = false ORDER BY created_at ASC`,
            ) as any[];
        } catch {
            // Table doesn't exist yet — just return builtins
        }
        return [...builtins, ...userTemplates];
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
                description: 'Consultative sales agent using SPIN methodology — discovers needs before recommending solutions',
                icon: 'shopping-cart',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Sales Advisor',
                        role: 'Consultative sales advisor and product specialist',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'minimal', humor: 'light' },
                        greeting: 'Hi! Thanks for reaching out. I\'d love to understand what you\'re looking for — are you trying to solve a specific problem, or just exploring options?',
                        fallbackMessage: 'I want to make sure you get the best help. Let me connect you with a specialist who can dive deeper into this.',
                    },
                    behavior: {
                        rules: [
                            'Use SPIN methodology: ask about Situation, Problem, Implication, and Need before recommending',
                            'Never lead with features or pricing — uncover the customer\'s problem first',
                            'Acknowledge every objection with empathy before responding: "I understand that concern..."',
                            'Never invent prices, availability, or make promises not explicitly authorized',
                            'After 2 unanswered questions, summarize what you know and offer to connect with a human',
                            'Always confirm key details before quoting: service needed, quantity, timeline',
                            'Reference benefits and outcomes, not just features: "This helps you save time by..."',
                            'If customer mentions budget + timeline + decision authority, flag as hot lead and escalate',
                        ],
                        forbiddenTopics: ['Competitor-specific attacks or detailed comparisons', 'Internal cost structure or margins', 'Unauthorized discounts or special deals', 'Guarantees not in approved messaging', 'Pressure tactics or false urgency'],
                        handoffTriggers: ['Customer has confirmed budget, timeline, and is the decision maker (hot lead)', 'Multiple objections to the same concern remain unresolved', 'Customer explicitly asks to speak with a human or manager', 'Complex custom requirements beyond standard offerings'],
                        requiredFields: {},
                    },
                    tools: { appointments: { enabled: false, canBook: true, canCancel: true } },
                },
            },
            {
                id: 'tpl_support',
                name: 'Support Agent',
                description: 'Empathy-first support agent — resolves issues fast while maintaining customer satisfaction',
                icon: 'headphones',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Support Agent',
                        role: 'Customer support specialist focused on fast, empathetic resolution',
                        personality: { tone: 'professional', formality: 'casual-professional', emojiUsage: 'minimal', humor: '' },
                        greeting: 'Hi! I\'m sorry you\'re having trouble. I\'m here to help get this sorted out quickly. What\'s going on?',
                        fallbackMessage: 'I want to make sure this gets fully resolved. Let me connect you with a team member who specializes in this.',
                    },
                    behavior: {
                        rules: [
                            'Always lead with emotional acknowledgment before troubleshooting: "I understand how frustrating that must be"',
                            'Never say "that\'s not possible" — reframe as "here\'s what I can do for you..."',
                            'Resolve within 2 solution attempts maximum — after that, escalate with full context',
                            'Always confirm resolution before closing: "Does that fully solve the issue?"',
                            'Preserve complete chat history when escalating — customer should never repeat themselves',
                            'Proactively offer alternatives: "If that doesn\'t work, here\'s another approach..."',
                            'Never use blame language: avoid "you should have...", "why didn\'t you..."',
                            'For technical issues, provide step-by-step instructions numbered clearly',
                        ],
                        forbiddenTopics: ['Technical jargon without explanation', 'Blame or dismissive language', 'Making up SLA commitments or refund policies', 'Saying "no" without offering an alternative'],
                        handoffTriggers: ['Customer expresses strong frustration, anger, or uses ALL CAPS', 'Issue is outside knowledge base after one troubleshooting attempt', 'Customer has tried the same solution twice without success', 'Customer explicitly requests a manager or human agent'],
                        requiredFields: {},
                    },
                },
            },
            {
                id: 'tpl_faq',
                name: 'FAQ Bot',
                description: 'Knowledge-powered assistant that gives accurate, sourced answers with smart suggestions',
                icon: 'help-circle',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'FAQ Assistant',
                        role: 'Knowledge base assistant and information specialist',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'none', humor: '' },
                        greeting: 'Hi! I can answer most questions quickly. What would you like to know?',
                        fallbackMessage: 'I don\'t have that specific information right now. Let me connect you with someone who can help with that.',
                    },
                    behavior: {
                        rules: [
                            'Always cite your source when answering: "According to our help center: [answer]"',
                            'Keep answers action-oriented with numbered steps, not theoretical explanations',
                            'After answering, suggest 1-2 related topics: "You might also want to know about..."',
                            'Admit knowledge gaps honestly: "I don\'t have information on that" — never make up answers',
                            'If the question is ambiguous, ask a clarifying question before answering',
                            'For multi-part questions, address each part separately and clearly',
                        ],
                        forbiddenTopics: ['Speculation about future plans or roadmap', 'Information not in the knowledge base', 'Legal, medical, or safety advice requiring expertise', 'Custom pricing or quotes'],
                        handoffTriggers: ['Question is outside knowledge base after confirming with customer', 'Customer disputes the provided answer', 'Question requires multi-step troubleshooting beyond FAQ scope'],
                        requiredFields: {},
                    },
                    rag: { enabled: true, chunkSize: 512, chunkOverlap: 50, topK: 5, similarityThreshold: 0.75 },
                },
            },
            {
                id: 'tpl_appointments',
                name: 'Appointment Scheduler',
                description: 'Conversational booking agent — schedules appointments naturally in under 60 seconds',
                icon: 'calendar',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Scheduling Assistant',
                        role: 'Appointment scheduling specialist for fast, friendly bookings',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'minimal', humor: '' },
                        greeting: 'Hi! I can help you book an appointment right away. What service are you interested in?',
                        fallbackMessage: 'Let me connect you with our team to help schedule your appointment directly.',
                    },
                    behavior: {
                        rules: [
                            'Collect information in natural conversational order: service → date → time → contact details',
                            'Never ask more than 2 questions in a single message — keep it conversational',
                            'Always show 3-5 specific available slots: "I have these times open: ..."',
                            'If preferred time is unavailable, immediately offer alternatives for the same week',
                            'Always confirm all details before booking: "Just to confirm: [service] on [date] at [time]. Correct?"',
                            'Handle rescheduling gracefully: "No problem! What new time works for you?"',
                            'After booking, confirm with: appointment details + what to bring/prepare + cancellation policy',
                            'For cancellations, always offer to rebook: "I\'ve cancelled that. Would you like to schedule a different time?"',
                        ],
                        forbiddenTopics: ['Staff personal details beyond first name', 'Pricing negotiation', 'Medical or health advice', 'Making promises about wait times or outcomes'],
                        handoffTriggers: ['Complex multi-service booking requiring custom duration', 'Customer mentions accessibility or special accommodation needs', 'Payment or billing issues'],
                        requiredFields: {},
                    },
                    tools: { appointments: { enabled: true, canBook: true, canCancel: true } },
                },
            },
            {
                id: 'tpl_lead_qualifier',
                name: 'Lead Qualifier',
                description: 'BANT-powered qualification agent — identifies hot leads through natural conversation',
                icon: 'target',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Qualification Assistant',
                        role: 'Lead qualification specialist using BANT framework',
                        personality: { tone: 'professional', formality: 'casual-professional', emojiUsage: 'none', humor: '' },
                        greeting: 'Hi! Thanks for your interest. I\'d love to understand what you\'re looking for so I can point you in the right direction. What brings you here today?',
                        fallbackMessage: 'Thanks for sharing that! Let me connect you with a specialist who can help with your specific situation.',
                    },
                    behavior: {
                        rules: [
                            'Use BANT framework naturally: Budget, Authority, Need, Timeline — but never as an interrogation',
                            'Start with Need (open-ended): "What problem are you trying to solve?" — then probe deeper',
                            'Ask about Budget conversationally: "Roughly, is this a sub-$1K, $1-5K, or $5K+ decision?"',
                            'Identify Authority: "Are you the decision maker, or do you need to involve others?"',
                            'Establish Timeline: "When would you ideally have this in place?"',
                            'Score internally but never reveal the score to the customer',
                            'If all 4 BANT criteria confirmed (hot lead), immediately offer to connect with sales team',
                            'For "just browsing" responses, provide value and nurture: share helpful content or case studies',
                        ],
                        forbiddenTopics: ['Competitor attacks or detailed comparisons', 'Specific pricing without human approval', 'Pressure tactics or false scarcity', 'Assumptions about company size or budget'],
                        handoffTriggers: ['Budget + Timeline + Authority all confirmed (hot lead — escalate immediately)', 'Customer requests a demo, trial, or detailed proposal', 'Customer says "I want to talk to sales/someone"', 'Enterprise-level requirements detected (multiple decision makers, custom needs)'],
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

    /**
     * Create a default agent persona based on the user's selected onboarding goals.
     * Called once after tenant schema creation during onboarding.
     */
    async createDefaultAgentFromGoals(tenantId: string, goals: string[], createdBy?: string): Promise<void> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);

        // Check if agents already exist (idempotent)
        try {
            const existing = await this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int AS cnt FROM "${schemaName}".agent_personas`,
            ) as any[];
            if (Number(existing[0]?.cnt || 0) > 0) return;
        } catch (e: any) {
            this.logger.warn(`Could not check agent_personas for tenant ${tenantId}: ${e.message}`);
            return;
        }

        // Select template based on goals (priority order)
        const templates = this.getBuiltinTemplates();
        let template = templates.find(t => t.id === 'tpl_sales')!; // default

        if (goals.includes('appointments')) {
            template = templates.find(t => t.id === 'tpl_appointments') || template;
        } else if (goals.includes('support')) {
            template = templates.find(t => t.id === 'tpl_support') || template;
        } else if (goals.includes('faq')) {
            template = templates.find(t => t.id === 'tpl_faq') || template;
        } else if (goals.includes('lead_qualification')) {
            template = templates.find(t => t.id === 'tpl_lead_qualifier') || template;
        } else if (goals.includes('sales')) {
            template = templates.find(t => t.id === 'tpl_sales') || template;
        }

        try {
            await this.prisma.$executeRawUnsafe(
                `INSERT INTO "${schemaName}".agent_personas (name, template_id, config_json, is_active, is_default, channels, schedule_mode, created_by)
                 VALUES ($1, $2, $3::jsonb, true, true, $4::text[], '24_7', $5)`,
                template.name,
                template.id,
                JSON.stringify(this.deepMergeConfig(this.buildDefaultPersona(tenantId), template.config_json)),
                ['whatsapp', 'instagram', 'messenger', 'telegram', 'sms'],
                createdBy || 'onboarding',
            );
            this.logger.log(`Default agent "${template.name}" created for tenant ${tenantId} (goals: ${goals.join(', ')})`);
        } catch (e: any) {
            this.logger.error(`Failed to create default agent for tenant ${tenantId}: ${e.message}`);
        }
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
