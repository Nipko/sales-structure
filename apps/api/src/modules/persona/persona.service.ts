import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
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
        private throttleService: TenantThrottleService,
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
     * Build Layer 2 of the system prompt: the PERSONA block.
     *
     * Returns ONLY the <persona>...</persona> section. The universal Contract
     * (Layer 1) and dynamic Turn Context (Layer 3) are composed separately in
     * PromptAssemblerService — this method must NOT include date, language, RAG,
     * global rules, or anything that varies per turn.
     *
     * In `editorMode: 'prompt'`, the user's custom prompt replaces the guided
     * body but is still wrapped in <persona> tags so Layer 1 + Layer 3 can
     * still be applied by the assembler.
     */
    buildSystemPrompt(config: TenantConfig): string {
        const editorMode = (config.editorMode ?? (config as any)._mode) as 'guided' | 'prompt' | undefined;
        const customPrompt = config.customPrompt ?? (config as any)._customPrompt;

        if (editorMode === 'prompt' && typeof customPrompt === 'string' && customPrompt.trim().length > 0) {
            return `<persona>\n${customPrompt.trim()}\n</persona>`;
        }

        return this.buildGuidedPersonaBlock(config);
    }

    /**
     * Build the guided persona block from the structured config.
     * All fields come from the user's agent config — no hardcoded rules.
     */
    private buildGuidedPersonaBlock(config: TenantConfig): string {
        const persona = config.persona;
        const behavior = config.behavior;
        const hours = config.hours;
        const lines: string[] = ['<persona>'];

        // Identity
        lines.push('  <identity>');
        lines.push(`    <name>${persona.name || ''}</name>`);
        lines.push(`    <role>${persona.role || ''}</role>`);
        if (persona.greeting) lines.push(`    <greeting>${persona.greeting}</greeting>`);
        if (persona.fallbackMessage) lines.push(`    <fallback_message>${persona.fallbackMessage}</fallback_message>`);
        lines.push('  </identity>');

        // Personality
        const p = persona.personality;
        if (p) {
            lines.push('  <personality>');
            if (p.tone) lines.push(`    <tone>${p.tone}</tone>`);
            if (p.formality) lines.push(`    <formality>${p.formality}</formality>`);
            if (p.emojiUsage) lines.push(`    <emoji_usage>${p.emojiUsage}</emoji_usage>`);
            if (p.humor) lines.push(`    <humor>${p.humor}</humor>`);
            lines.push('  </personality>');
        }

        // Rules (persona-defined, NOT global)
        if (behavior?.rules?.length > 0) {
            lines.push('  <rules>');
            behavior.rules.forEach((rule) => {
                lines.push(`    <rule>${rule}</rule>`);
            });
            lines.push('  </rules>');
        }

        // Forbidden topics
        if (behavior?.forbiddenTopics?.length > 0) {
            lines.push('  <forbidden_topics>');
            behavior.forbiddenTopics.forEach((topic) => {
                lines.push(`    <topic>${topic}</topic>`);
            });
            lines.push('  </forbidden_topics>');
        }

        // Handoff triggers
        if (behavior?.handoffTriggers?.length > 0) {
            lines.push('  <handoff_triggers>');
            behavior.handoffTriggers.forEach((trigger) => {
                lines.push(`    <trigger>${trigger}</trigger>`);
            });
            lines.push('  </handoff_triggers>');
        }

        // Required fields — only when appointments tool is NOT active
        const toolsCfg = (config.tools ?? (config as any)?.tools) as any;
        const appointmentsEnabled = toolsCfg?.appointments?.enabled === true;
        if (behavior?.requiredFields && Object.keys(behavior.requiredFields).length > 0 && !appointmentsEnabled) {
            lines.push('  <required_information>');
            for (const [context, fields] of Object.entries(behavior.requiredFields)) {
                lines.push(`    <context name="${context}">`);
                fields.forEach((f) => {
                    lines.push(`      <field name="${f.field}">${f.question}</field>`);
                });
                lines.push('    </context>');
            }
            lines.push('  </required_information>');
        }

        // Business hours schedule (static config — the COMPUTED open/closed goes in Layer 3)
        if (hours?.schedule && Object.keys(hours.schedule).length > 0) {
            lines.push('  <business_hours>');
            if (hours.timezone) lines.push(`    <timezone>${hours.timezone}</timezone>`);
            for (const [day, value] of Object.entries(hours.schedule)) {
                if (typeof value === 'string') {
                    lines.push(`    <day name="${day}">${value}</day>`);
                } else if (value && typeof value === 'object') {
                    const v = value as any;
                    lines.push(`    <day name="${day}" start="${v.start ?? ''}" end="${v.end ?? ''}" />`);
                }
            }
            if (hours.afterHoursMessage) {
                lines.push(`    <after_hours_message>${hours.afterHoursMessage}</after_hours_message>`);
            }
            lines.push('  </business_hours>');
        }

        lines.push('</persona>');
        return lines.join('\n');
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
    private async countActiveAgents(schemaName: string): Promise<number> {
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS cnt FROM "${schemaName}".agent_personas WHERE is_active = true`,
        ) as any[];
        return Number(rows[0]?.cnt || 0);
    }

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

        // Enforce plan's maxAgents at the server level. The UI already hides
        // the "add agent" button past the limit, but without this check a
        // direct API call bypasses the restriction and lets any tenant exceed
        // their quota.
        const planFeatures = await this.throttleService.getPlanFeatures(tenantId);
        const currentCount = await this.countActiveAgents(schemaName);
        if (currentCount >= planFeatures.maxAgents) {
            throw new ForbiddenException({
                error: 'agent_limit_reached',
                message: `Tu plan permite hasta ${planFeatures.maxAgents} agente${planFeatures.maxAgents === 1 ? '' : 's'}. Actualizá tu plan para agregar más.`,
                currentCount,
                maxAgents: planFeatures.maxAgents,
            });
        }

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
        // Get tenant language to return templates in the right language
        let tenantLang = 'es';
        try {
            const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { language: true } });
            tenantLang = (tenant?.language || 'es-CO').split('-')[0]; // es-CO → es
        } catch {}
        const builtins = this.getBuiltinTemplates(tenantLang);
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
     * Built-in templates — returns in the tenant's language.
     * Spanish is the primary language (LATAM market). English as fallback for non-es.
     * Portuguese and French get English versions (LLM adapts the tone regardless).
     */
    private getBuiltinTemplates(lang: string = 'es'): any[] {
        if (lang !== 'es') return this.getBuiltinTemplatesEn();
        return [
            {
                id: 'tpl_sales',
                name: 'Sales Advisor',
                description: 'Consultative sales agent using SPIN methodology — discovers needs before recommending solutions',
                icon: 'shopping-cart',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Asesor de Ventas',
                        role: 'Asesor comercial consultivo y especialista en productos',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'minimal', humor: 'light' },
                        greeting: '¡Hola! Gracias por escribirnos. Me encantaría entender qué estás buscando — ¿estás tratando de resolver algo específico o solo explorando opciones?',
                        fallbackMessage: 'Quiero asegurarme de que recibas la mejor ayuda. Déjame conectarte con un especialista que pueda profundizar más.',
                    },
                    behavior: {
                        rules: [
                            'Usar metodología SPIN: preguntar sobre Situación, Problema, Implicación y Necesidad antes de recomendar',
                            'Nunca empezar con características o precios — primero descubrir la necesidad del cliente',
                            'Reconocer cada objeción con empatía antes de responder: "Entiendo esa preocupación..."',
                            'Nunca inventar precios, disponibilidad ni hacer promesas no autorizadas',
                            'Después de 2 preguntas sin respuesta, resumir lo que sabes y ofrecer conectar con un humano',
                            'Siempre confirmar detalles clave antes de cotizar: servicio, cantidad, plazo',
                            'Hablar de beneficios y resultados, no solo características: "Esto te ayuda a ahorrar tiempo..."',
                            'Si el cliente menciona presupuesto + plazo + autoridad de decisión, marcar como lead caliente y escalar',
                        ],
                        forbiddenTopics: ['Ataques o comparaciones con la competencia', 'Estructura de costos interna o márgenes', 'Descuentos no autorizados', 'Garantías fuera del mensaje aprobado', 'Tácticas de presión o urgencia falsa'],
                        handoffTriggers: ['Cliente ha confirmado presupuesto, plazo y es el decisor (lead caliente)', 'Múltiples objeciones al mismo tema sin resolver', 'Cliente pide hablar con un humano o gerente', 'Requerimientos complejos fuera de la oferta estándar'],
                        requiredFields: {},
                    },
                    tools: { appointments: { enabled: false, canBook: true, canCancel: true } },
                },
            },
            {
                id: 'tpl_support',
                name: 'Agente de Soporte',
                description: 'Agente de soporte empático — resuelve problemas rápido manteniendo la satisfacción del cliente',
                icon: 'headphones',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Agente de Soporte',
                        role: 'Especialista en soporte al cliente enfocado en resolución rápida y empática',
                        personality: { tone: 'professional', formality: 'casual-professional', emojiUsage: 'minimal', humor: '' },
                        greeting: '¡Hola! Lamento que tengas inconvenientes. Estoy aquí para ayudarte a resolverlo rápido. ¿Qué está pasando?',
                        fallbackMessage: 'Quiero asegurarme de que esto se resuelva completamente. Déjame conectarte con alguien de nuestro equipo que se especializa en esto.',
                    },
                    behavior: {
                        rules: [
                            'Siempre empezar reconociendo la emoción antes de resolver: "Entiendo lo frustrante que debe ser..."',
                            'Nunca decir "eso no es posible" — reformular como "lo que puedo hacer por ti es..."',
                            'Resolver en máximo 2 intentos — después escalar con contexto completo',
                            'Siempre confirmar resolución antes de cerrar: "¿Eso resuelve completamente tu problema?"',
                            'Al escalar, pasar historial completo — el cliente no debe repetir nada',
                            'Ofrecer alternativas proactivamente: "Si eso no funciona, hay otra opción..."',
                            'Nunca usar lenguaje de culpa: evitar "deberías haber...", "¿por qué no...?"',
                            'Para problemas técnicos, dar instrucciones paso a paso numeradas',
                        ],
                        forbiddenTopics: ['Jerga técnica sin explicación', 'Lenguaje de culpa o despectivo', 'Inventar compromisos de SLA o políticas de reembolso', 'Decir "no" sin ofrecer alternativa'],
                        handoffTriggers: ['Cliente expresa frustración fuerte, enojo o usa MAYÚSCULAS', 'Problema fuera del conocimiento base después de un intento', 'Cliente ha probado la misma solución dos veces sin éxito', 'Cliente solicita hablar con un gerente o agente humano'],
                        requiredFields: {},
                    },
                },
            },
            {
                id: 'tpl_faq',
                name: 'Bot de Preguntas Frecuentes',
                description: 'Asistente basado en conocimiento que da respuestas precisas con sugerencias inteligentes',
                icon: 'help-circle',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Asistente FAQ',
                        role: 'Asistente de base de conocimiento y especialista en información',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'none', humor: '' },
                        greeting: '¡Hola! Puedo responder la mayoría de preguntas rápido. ¿Qué te gustaría saber?',
                        fallbackMessage: 'No tengo esa información específica en este momento. Déjame conectarte con alguien que pueda ayudarte.',
                    },
                    behavior: {
                        rules: [
                            'Siempre citar la fuente al responder: "Según nuestro centro de ayuda: [respuesta]"',
                            'Mantener respuestas orientadas a la acción con pasos numerados, no explicaciones teóricas',
                            'Después de responder, sugerir 1-2 temas relacionados: "También te puede interesar saber sobre..."',
                            'Admitir honestamente las lagunas de conocimiento: "No tengo información sobre eso" — nunca inventar',
                            'Si la pregunta es ambigua, hacer una pregunta de clarificación antes de responder',
                            'Para preguntas de varias partes, abordar cada parte por separado y con claridad',
                        ],
                        forbiddenTopics: ['Especulación sobre planes futuros', 'Información no verificada', 'Asesoría legal, médica o de seguridad', 'Cotizaciones personalizadas'],
                        handoffTriggers: ['Pregunta fuera del conocimiento base', 'Cliente disputa la respuesta dada', 'Pregunta requiere solución técnica avanzada'],
                        requiredFields: {},
                    },
                    rag: { enabled: true, chunkSize: 512, chunkOverlap: 50, topK: 5, similarityThreshold: 0.75 },
                },
            },
            {
                id: 'tpl_appointments',
                name: 'Agendador de Citas',
                description: 'Agente de reservas conversacional — agenda citas de forma natural en menos de 60 segundos',
                icon: 'calendar',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Asistente de Agenda',
                        role: 'Especialista en agendamiento de citas rápido y amigable',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'minimal', humor: '' },
                        greeting: '¡Hola! Puedo ayudarte a agendar una cita ahora mismo. ¿Qué servicio te interesa?',
                        fallbackMessage: 'Déjame conectarte con nuestro equipo para agendar tu cita directamente.',
                    },
                    behavior: {
                        rules: [
                            'Recopilar información en orden conversacional natural: servicio → fecha → hora → datos de contacto',
                            'Nunca hacer más de 2 preguntas en un solo mensaje — mantenerlo conversacional',
                            'Siempre mostrar 3-5 horarios específicos disponibles',
                            'Si el horario preferido no está disponible, ofrecer alternativas de la misma semana',
                            'Siempre confirmar todos los detalles antes de reservar: "Para confirmar: [servicio] el [fecha] a las [hora]. ¿Correcto?"',
                            'Manejar reprogramaciones con amabilidad: "¡No hay problema! ¿Qué nuevo horario te funciona?"',
                            'Después de reservar, confirmar con: detalles de la cita + qué llevar/preparar',
                            'Para cancelaciones, siempre ofrecer reagendar',
                        ],
                        forbiddenTopics: ['Datos personales del staff más allá del nombre', 'Negociación de precios', 'Asesoría médica o de salud', 'Promesas sobre tiempos de espera'],
                        handoffTriggers: ['Reserva compleja multi-servicio', 'Cliente menciona necesidades de accesibilidad', 'Problemas de pago o facturación'],
                        requiredFields: {},
                    },
                    tools: { appointments: { enabled: true, canBook: true, canCancel: true } },
                },
            },
            {
                id: 'tpl_lead_qualifier',
                name: 'Calificador de Leads',
                description: 'Agente de calificación BANT — identifica leads calientes a través de conversación natural',
                icon: 'target',
                is_builtin: true,
                config_json: {
                    persona: {
                        name: 'Asistente de Calificación',
                        role: 'Especialista en calificación de leads usando metodología BANT',
                        personality: { tone: 'professional', formality: 'casual-professional', emojiUsage: 'none', humor: '' },
                        greeting: '¡Hola! Gracias por tu interés. Me encantaría entender qué estás buscando para orientarte mejor. ¿Qué te trae por aquí?',
                        fallbackMessage: '¡Gracias por compartir eso! Déjame conectarte con un especialista que pueda ayudarte con tu situación específica.',
                    },
                    behavior: {
                        rules: [
                            'Usar metodología BANT naturalmente: Presupuesto, Autoridad, Necesidad, Plazo — sin que parezca interrogatorio',
                            'Empezar con Necesidad (pregunta abierta): "¿Qué problema estás tratando de resolver?" — luego profundizar',
                            'Preguntar sobre Presupuesto conversacionalmente: "Aproximadamente, ¿estamos hablando de menos de $1M, entre $1-5M, o más?"',
                            'Identificar Autoridad: "¿Eres tú quien toma la decisión, o necesitas involucrar a alguien más?"',
                            'Establecer Plazo: "¿Para cuándo idealmente necesitarías tener esto implementado?"',
                            'Calificar internamente pero nunca revelar el puntaje al cliente',
                            'Si los 4 criterios BANT están confirmados (lead caliente), ofrecer conectar con equipo de ventas inmediatamente',
                            'Para respuestas de "solo estoy mirando", aportar valor y nutrir: compartir información útil',
                        ],
                        forbiddenTopics: ['Ataques o comparaciones con competencia', 'Precios específicos sin aprobación', 'Tácticas de presión o escasez falsa', 'Suposiciones sobre tamaño de empresa o presupuesto'],
                        handoffTriggers: ['Presupuesto + Plazo + Autoridad confirmados (lead caliente — escalar inmediatamente)', 'Cliente solicita demo, prueba o propuesta detallada', 'Cliente dice "quiero hablar con alguien de ventas"', 'Requerimientos enterprise detectados'],
                        requiredFields: {},
                    },
                },
            },
            {
                id: 'tpl_blank',
                name: 'Agente en Blanco',
                description: 'Empieza desde cero con una configuración limpia',
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

    /** English versions of built-in templates (for non-Spanish tenants) */
    private getBuiltinTemplatesEn(): any[] {
        return [
            {
                id: 'tpl_sales', name: 'Sales Advisor', icon: 'shopping-cart', is_builtin: true,
                description: 'Consultative sales agent — discovers needs before recommending solutions',
                config_json: {
                    persona: { name: 'Sales Advisor', role: 'Consultative sales advisor and product specialist',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'minimal', humor: 'light' },
                        greeting: 'Hi! Thanks for reaching out. I\'d love to understand what you\'re looking for — are you trying to solve a specific problem, or just exploring options?',
                        fallbackMessage: 'I want to make sure you get the best help. Let me connect you with a specialist.' },
                    behavior: {
                        rules: ['Use SPIN methodology: ask about Situation, Problem, Implication, and Need before recommending', 'Never lead with features or pricing — uncover the customer\'s problem first', 'Acknowledge every objection with empathy before responding', 'Never invent prices, availability, or make promises not explicitly authorized', 'After 2 unanswered questions, summarize what you know and offer to connect with a human', 'Always confirm key details before quoting', 'Reference benefits and outcomes, not just features', 'If customer mentions budget + timeline + decision authority, flag as hot lead and escalate'],
                        forbiddenTopics: ['Competitor attacks', 'Internal cost structure', 'Unauthorized discounts', 'Pressure tactics'],
                        handoffTriggers: ['Hot lead confirmed (budget+timeline+authority)', 'Multiple unresolved objections', 'Customer asks for human', 'Complex custom requirements'],
                        requiredFields: {} },
                    tools: { appointments: { enabled: false, canBook: true, canCancel: true } },
                },
            },
            {
                id: 'tpl_support', name: 'Support Agent', icon: 'headphones', is_builtin: true,
                description: 'Empathy-first support agent — resolves issues fast while maintaining satisfaction',
                config_json: {
                    persona: { name: 'Support Agent', role: 'Customer support specialist focused on fast, empathetic resolution',
                        personality: { tone: 'professional', formality: 'casual-professional', emojiUsage: 'minimal', humor: '' },
                        greeting: 'Hi! I\'m sorry you\'re having trouble. I\'m here to help get this sorted out quickly.',
                        fallbackMessage: 'Let me connect you with a team member who specializes in this.' },
                    behavior: {
                        rules: ['Lead with emotional acknowledgment before troubleshooting', 'Never say "that\'s not possible" — reframe positively', 'Resolve within 2 attempts — then escalate with full context', 'Always confirm resolution before closing', 'Never use blame language', 'Provide step-by-step instructions for technical issues'],
                        forbiddenTopics: ['Jargon without explanation', 'Blame language', 'Making up SLA commitments'],
                        handoffTriggers: ['Strong frustration detected', 'Issue outside knowledge base', 'Customer requests manager'],
                        requiredFields: {} },
                },
            },
            {
                id: 'tpl_faq', name: 'FAQ Bot', icon: 'help-circle', is_builtin: true,
                description: 'Knowledge-powered assistant with accurate, sourced answers',
                config_json: {
                    persona: { name: 'FAQ Assistant', role: 'Knowledge base assistant',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'none', humor: '' },
                        greeting: 'Hi! I can answer most questions quickly. What would you like to know?',
                        fallbackMessage: 'I don\'t have that information. Let me connect you with someone who can help.' },
                    behavior: {
                        rules: ['Cite sources when answering', 'Keep answers action-oriented with numbered steps', 'Suggest related topics after answering', 'Admit knowledge gaps honestly', 'Ask clarifying questions for ambiguous queries'],
                        forbiddenTopics: ['Speculation', 'Unverified information', 'Legal/medical advice'],
                        handoffTriggers: ['Question outside knowledge base', 'Customer disputes answer'],
                        requiredFields: {} },
                    rag: { enabled: true, chunkSize: 512, chunkOverlap: 50, topK: 5, similarityThreshold: 0.75 },
                },
            },
            {
                id: 'tpl_appointments', name: 'Appointment Scheduler', icon: 'calendar', is_builtin: true,
                description: 'Conversational booking agent — schedules appointments naturally',
                config_json: {
                    persona: { name: 'Scheduling Assistant', role: 'Appointment scheduling specialist',
                        personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'minimal', humor: '' },
                        greeting: 'Hi! I can help you book an appointment right away. What service are you interested in?',
                        fallbackMessage: 'Let me connect you with our team to help schedule your appointment.' },
                    behavior: {
                        rules: ['Collect info naturally: service → date → time → contact details', 'Never ask more than 2 questions per message', 'Show 3-5 available slots', 'Offer alternatives if preferred time unavailable', 'Always confirm details before booking', 'Handle rescheduling gracefully'],
                        forbiddenTopics: ['Staff personal details', 'Price negotiation', 'Medical advice'],
                        handoffTriggers: ['Complex multi-service booking', 'Accessibility needs', 'Payment issues'],
                        requiredFields: {} },
                    tools: { appointments: { enabled: true, canBook: true, canCancel: true } },
                },
            },
            {
                id: 'tpl_lead_qualifier', name: 'Lead Qualifier', icon: 'target', is_builtin: true,
                description: 'BANT-powered qualification agent — identifies hot leads naturally',
                config_json: {
                    persona: { name: 'Qualification Assistant', role: 'Lead qualification specialist using BANT',
                        personality: { tone: 'professional', formality: 'casual-professional', emojiUsage: 'none', humor: '' },
                        greeting: 'Hi! Thanks for your interest. What brings you here today?',
                        fallbackMessage: 'Let me connect you with a specialist for your situation.' },
                    behavior: {
                        rules: ['Use BANT naturally: Budget, Authority, Need, Timeline', 'Start with Need (open-ended)', 'Ask about Budget conversationally', 'Identify Authority', 'Establish Timeline', 'Score internally, never reveal score', 'Hot lead = connect with sales immediately', 'Nurture "just browsing" with value'],
                        forbiddenTopics: ['Competitor attacks', 'Unauthorized pricing', 'Pressure tactics'],
                        handoffTriggers: ['BANT confirmed (hot lead)', 'Demo/trial request', 'Enterprise requirements'],
                        requiredFields: {} },
                },
            },
            {
                id: 'tpl_blank', name: 'Blank Agent', icon: 'plus', is_builtin: true,
                description: 'Start from scratch with a clean configuration',
                config_json: {
                    persona: { name: '', role: '', personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'minimal', humor: '' }, greeting: '', fallbackMessage: '' },
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

        // Select template based on goals — use tenant language for template content
        let tenantLang = 'es';
        try {
            const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { language: true } });
            tenantLang = (tenant?.language || 'es-CO').split('-')[0];
        } catch {}
        const templates = this.getBuiltinTemplates(tenantLang);
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
