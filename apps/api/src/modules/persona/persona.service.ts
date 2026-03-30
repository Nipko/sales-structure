import { Injectable, Logger } from '@nestjs/common';
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
    async getActivePersona(tenantId: string): Promise<TenantConfig | null> {
        // Check cache
        const cacheKey = `persona:${tenantId}:active`;
        const cached = await this.redis.getJson<TenantConfig>(cacheKey);
        if (cached) return cached;

        // Load from database
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        const result = await this.prisma.$queryRawUnsafe(
            `SELECT config_json FROM "${schemaName}".persona_config WHERE is_active = true ORDER BY version DESC LIMIT 1`,
        ) as any[];

        if (!result || result.length === 0) return null;

        const config = result[0].config_json as TenantConfig;

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
        if (behavior.rules.length > 0) {
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
        if (behavior.forbiddenTopics.length > 0) {
            prompt += `## Temas PROHIBIDOS (nunca hablar de esto)\n`;
            behavior.forbiddenTopics.forEach((t) => {
                prompt += `- ${t}\n`;
            });
            prompt += '\n';
        }

        // Handoff triggers
        if (behavior.handoffTriggers.length > 0) {
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
     * Validate persona config structure
     */
    private validateConfig(config: any): void {
        if (!config.persona?.name) throw new Error('Persona name is required');
        if (!config.persona?.role) throw new Error('Persona role is required');
        if (!config.behavior?.rules) throw new Error('Behavior rules are required');
    }
}
