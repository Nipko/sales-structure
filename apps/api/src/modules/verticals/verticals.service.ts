import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getVerticalDefinition } from './vertical-definitions';
import { TenantVerticalConfig, VerticalDefinition } from '@parallext/shared';

@Injectable()
export class VerticalsService {
    private readonly logger = new Logger(VerticalsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    /**
     * Bootstrap all vertical-specific defaults for a new tenant.
     * Called once during onboarding after schema + default agent are created.
     */
    async bootstrapVertical(
        tenantId: string,
        industry: string,
        subType: string | null,
        lang: string,
    ): Promise<void> {
        const definition = getVerticalDefinition(industry);
        const l = lang || 'es';

        this.logger.log(`Bootstrapping vertical "${industry}" (sub: ${subType || 'none'}) for tenant ${tenantId}`);

        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        // 1. Seed pipeline stages
        await this.seedPipelineStages(tenantId, schemaName, definition, l);

        // 2. Patch default agent with vertical persona
        await this.patchDefaultAgent(schemaName, definition, l);

        // 3. Seed FAQs
        await this.seedFaqs(schemaName, definition, l);

        // 4. Seed services (if booking-enabled)
        if (definition.bookingEnabled && definition.services.length > 0) {
            await this.seedServices(schemaName, definition, l);
        }

        // 5. Save resolved config to tenant
        const resolvedConfig: TenantVerticalConfig = {
            industry,
            subType,
            terminology: definition.terminology,
            sidebar: definition.sidebar,
            dashboard: definition.dashboard,
            bookingEnabled: definition.bookingEnabled,
        };

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    // Merge with existing settings
                    ...(await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }))?.settings as any || {},
                    verticalConfig: resolvedConfig,
                    subType: subType || undefined,
                },
            },
        });

        this.logger.log(`Vertical bootstrap complete for tenant ${tenantId}: ${definition.pipeline.stages.length} stages, ${definition.faqs.length} FAQs, ${definition.services.length} services`);
    }

    /**
     * Get the vertical config for a tenant (dashboard consumption).
     * Cached in Redis for 10 minutes.
     */
    async getVerticalConfig(tenantId: string): Promise<TenantVerticalConfig | null> {
        const cacheKey = `vertical:${tenantId}`;

        // Check Redis cache
        const cached = await this.redis.getJson<TenantVerticalConfig>(cacheKey);
        if (cached) return cached;

        // Load from DB
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });

        const settings = tenant?.settings as any;
        const config = settings?.verticalConfig as TenantVerticalConfig | undefined;

        if (config) {
            await this.redis.setJson(cacheKey, config, 600); // 10 min TTL
        }

        return config || null;
    }

    // ─── Private: Seed Methods ───────────────────────────────

    private async seedPipelineStages(
        tenantId: string,
        schemaName: string,
        definition: VerticalDefinition,
        lang: string,
    ): Promise<void> {
        try {
            for (let i = 0; i < definition.pipeline.stages.length; i++) {
                const stage = definition.pipeline.stages[i];
                const name = stage.name[lang] || stage.name['es'] || stage.slug;
                await this.prisma.$queryRawUnsafe(
                    `INSERT INTO "${schemaName}"."pipeline_stages"
                     (tenant_id, name, slug, color, position, default_probability, sla_hours, is_terminal)
                     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT DO NOTHING`,
                    tenantId, name, stage.slug, stage.color, i, stage.probability, stage.slaHours || null, stage.isTerminal,
                );
            }
            this.logger.debug(`Seeded ${definition.pipeline.stages.length} pipeline stages`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed pipeline stages: ${error.message}`);
        }
    }

    private async patchDefaultAgent(
        schemaName: string,
        definition: VerticalDefinition,
        lang: string,
    ): Promise<void> {
        try {
            // Find the default agent
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            if (!agents || agents.length === 0) return;

            const agent = agents[0];
            const existingConfig = agent.config_json || {};
            const agentDef = definition.agent;

            // Merge vertical persona into existing config
            const patchedConfig = {
                ...existingConfig,
                name: agentDef.name[lang] || agentDef.name['es'],
                personality: {
                    ...(existingConfig.personality || {}),
                    tone: agentDef.tone,
                    formality: agentDef.formality,
                },
                role: agentDef.role[lang] || agentDef.role['es'],
                greeting: agentDef.greeting[lang] || agentDef.greeting['es'],
                rules: agentDef.rules[lang] || agentDef.rules['es'],
                forbiddenTopics: (agentDef.forbiddenTopics[lang] || agentDef.forbiddenTopics['es'] || '')
                    .split('|')
                    .filter(Boolean),
                handoffTriggers: (agentDef.handoffTriggers[lang] || agentDef.handoffTriggers['es'] || '')
                    .split('|')
                    .filter(Boolean),
            };

            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET
                    name = $1,
                    config_json = $2::jsonb
                 WHERE id = $3::uuid`,
                [
                    patchedConfig.name,
                    JSON.stringify(patchedConfig),
                    agent.id,
                ],
            );

            this.logger.debug(`Patched default agent with vertical persona: "${patchedConfig.name}"`);
        } catch (error: any) {
            this.logger.warn(`Failed to patch default agent: ${error.message}`);
        }
    }

    private async seedFaqs(
        schemaName: string,
        definition: VerticalDefinition,
        lang: string,
    ): Promise<void> {
        try {
            for (const faq of definition.faqs) {
                const question = faq.question[lang] || faq.question['es'];
                const answer = faq.answer[lang] || faq.answer['es'];
                await this.prisma.$queryRawUnsafe(
                    `INSERT INTO "${schemaName}"."faqs"
                     (question, answer, category, is_published, search_tsv)
                     VALUES ($1, $2, $3, true, to_tsvector('simple', $1 || ' ' || $2))
                     ON CONFLICT DO NOTHING`,
                    question, answer, faq.category,
                );
            }
            this.logger.debug(`Seeded ${definition.faqs.length} FAQs`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed FAQs: ${error.message}`);
        }
    }

    private async seedServices(
        schemaName: string,
        definition: VerticalDefinition,
        lang: string,
    ): Promise<void> {
        try {
            for (let i = 0; i < definition.services.length; i++) {
                const svc = definition.services[i];
                const name = svc.name[lang] || svc.name['es'];
                const description = svc.description[lang] || svc.description['es'];
                await this.prisma.$queryRawUnsafe(
                    `INSERT INTO "${schemaName}"."services"
                     (name, description, duration_minutes, price, currency, category, is_active, sort_order)
                     VALUES ($1, $2, $3, $4, $5, $6, true, $7)
                     ON CONFLICT DO NOTHING`,
                    name, description, svc.durationMinutes, svc.price, svc.currency, svc.category, i,
                );
            }
            this.logger.debug(`Seeded ${definition.services.length} services`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed services: ${error.message}`);
        }
    }
}
