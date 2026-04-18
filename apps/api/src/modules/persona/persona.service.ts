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
