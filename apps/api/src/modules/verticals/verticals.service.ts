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

        // 4b. Sub-type specific extras: tours / agencia_viajes get extra FAQs
        // tailored to the operational reality (transfer, child discount,
        // languages, cancellation, meeting point) and the tours.enabled tool
        // flag is turned on so the AI can use search_packages out of the box.
        if (industry === 'turismo' && (subType === 'tours' || subType === 'agencia_viajes')) {
            await this.seedToursExtras(tenantId, schemaName, l);
            await this.enableToursTool(schemaName);
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
            select: { settings: true, industry: true },
        });

        const settings = tenant?.settings as any;
        let config = settings?.verticalConfig as TenantVerticalConfig | undefined;

        // Fallback for tenants created before settings.verticalConfig was
        // persisted: rebuild the config on the fly from tenant.industry and
        // the static vertical definition. We also write it back to settings so
        // future calls don't have to rebuild.
        if (!config && tenant?.industry) {
            const definition = getVerticalDefinition(tenant.industry);
            config = {
                industry: tenant.industry,
                subType: settings?.subType ?? null,
                terminology: definition.terminology,
                sidebar: definition.sidebar,
                dashboard: definition.dashboard,
                bookingEnabled: definition.bookingEnabled,
            };
            try {
                await this.prisma.tenant.update({
                    where: { id: tenantId },
                    data: {
                        settings: {
                            ...(settings || {}),
                            verticalConfig: config,
                        },
                    },
                });
                this.logger.log(`Backfilled verticalConfig for tenant ${tenantId} (industry=${tenant.industry})`);
            } catch (err: any) {
                this.logger.warn(`Failed to persist backfilled verticalConfig for ${tenantId}: ${err?.message}`);
            }
        }

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

    /**
     * Tours / agencia_viajes specific FAQs covering the operational questions
     * customers always ask before booking an experience or package.
     */
    private async seedToursExtras(tenantId: string, schemaName: string, lang: string): Promise<void> {
        try {
            const faqs: Array<{ question: Record<string, string>; answer: Record<string, string>; category: string }> = [
                {
                    question: {
                        es: '¿Incluye traslado desde el hotel?',
                        en: 'Does it include hotel transfer?',
                        pt: 'Inclui traslado do hotel?',
                        fr: 'Le transfert depuis l\'hôtel est-il inclus?',
                    },
                    answer: {
                        es: 'En la mayoría de tours sí está incluido el traslado desde hoteles del centro. Para zonas alejadas puede aplicar un costo extra. Confírmamelo y te cotizo.',
                        en: 'Most tours include transfer from downtown hotels. Outlying areas may have an extra fee. Confirm your hotel and I\'ll quote.',
                        pt: 'A maioria dos tours inclui traslado de hotéis do centro. Áreas distantes podem ter custo extra.',
                        fr: 'La plupart des tours incluent le transfert depuis les hôtels du centre. Zones éloignées : supplément possible.',
                    },
                    category: 'tours',
                },
                {
                    question: {
                        es: '¿Hay descuento para niños?',
                        en: 'Is there a discount for children?',
                        pt: 'Há desconto para crianças?',
                        fr: 'Y a-t-il une réduction pour les enfants?',
                    },
                    answer: {
                        es: 'Sí, ofrecemos descuento para niños según el paquete. Cuéntame las edades para darte el precio exacto.',
                        en: 'Yes, child discount applies depending on the package. Share the ages and I\'ll give you the exact price.',
                        pt: 'Sim, oferecemos desconto para crianças conforme o pacote. Me diga as idades.',
                        fr: 'Oui, une réduction enfant s\'applique selon le forfait. Indiquez-moi les âges.',
                    },
                    category: 'tours',
                },
                {
                    question: {
                        es: '¿En qué idiomas se hace el tour?',
                        en: 'What languages is the tour offered in?',
                        pt: 'Em quais idiomas é o passeio?',
                        fr: 'Dans quelles langues le tour est-il offert?',
                    },
                    answer: {
                        es: 'Trabajamos con guías en español, inglés y según disponibilidad portugués y francés. Indícame tu idioma preferido.',
                        en: 'We have guides in Spanish, English and depending on availability Portuguese and French. Let me know your preferred language.',
                        pt: 'Temos guias em espanhol, inglês e conforme disponibilidade português e francês.',
                        fr: 'Nous avons des guides en espagnol, anglais et selon disponibilité portugais et français.',
                    },
                    category: 'tours',
                },
                {
                    question: {
                        es: '¿Cuál es la política de cancelación?',
                        en: 'What is the cancellation policy?',
                        pt: 'Qual é a política de cancelamento?',
                        fr: 'Quelle est la politique d\'annulation?',
                    },
                    answer: {
                        es: 'Cancelaciones con 48h de anticipación tienen reembolso completo. Menos de 48h aplica cargo del 50%. Sin aviso (no-show) no hay reembolso.',
                        en: 'Cancellations 48h in advance get a full refund. Within 48h a 50% fee applies. No-shows are non-refundable.',
                        pt: 'Cancelamentos com 48h de antecedência têm reembolso total. Menos de 48h aplica taxa de 50%.',
                        fr: 'Annulations 48h à l\'avance : remboursement intégral. Moins de 48h : 50% de frais.',
                    },
                    category: 'politicas',
                },
                {
                    question: {
                        es: '¿Dónde es el punto de encuentro?',
                        en: 'Where is the meeting point?',
                        pt: 'Onde é o ponto de encontro?',
                        fr: 'Où est le point de rencontre?',
                    },
                    answer: {
                        es: 'Te enviaré el punto exacto al confirmar la reserva. Generalmente recogemos en hoteles del centro 15 minutos antes de la salida.',
                        en: 'I\'ll send the exact location once your booking is confirmed. We usually pick up at downtown hotels 15 minutes before departure.',
                        pt: 'Enviarei o ponto exato ao confirmar a reserva. Geralmente buscamos em hotéis do centro 15 minutos antes.',
                        fr: 'J\'enverrai le point exact à la confirmation. Généralement ramassage dans les hôtels du centre 15 minutes avant.',
                    },
                    category: 'logistica',
                },
            ];

            for (const f of faqs) {
                const q = f.question[lang] || f.question['es'];
                const a = f.answer[lang] || f.answer['es'];
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `INSERT INTO faqs (tenant_id, question, answer, category, is_published)
                     VALUES ($1::uuid, $2, $3, $4, true)
                     ON CONFLICT DO NOTHING`,
                    [tenantId, q, a, f.category],
                );
            }
            this.logger.debug(`Seeded ${faqs.length} tours-specific FAQs`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed tours FAQs: ${error.message}`);
        }
    }

    /**
     * Turn on config.tools.tours.enabled for the default agent so the
     * AI can call search_packages / create_tour_booking out of the box.
     */
    private async enableToursTool(schemaName: string): Promise<void> {
        try {
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            const agent = agents?.[0];
            if (!agent) return;

            const config = agent.config_json || {};
            const tools = { ...(config.tools || {}) };
            tools.tours = { ...(tools.tours || {}), enabled: true };
            const newConfig = { ...config, tools };

            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                [JSON.stringify(newConfig), agent.id],
            );
            this.logger.debug('Enabled tours tool on default agent');
        } catch (error: any) {
            this.logger.warn(`Failed to enable tours tool: ${error.message}`);
        }
    }
}
