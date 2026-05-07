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

        // 4c. Dental sub-type: dental-specific FAQs + activate treatments tool
        // so the AI can answer about ongoing orthodontic / multi-session plans.
        if (industry === 'salud' && subType === 'dental') {
            await this.seedDentalExtras(tenantId, schemaName, l);
            await this.enableTreatmentsTool(schemaName);
        }

        // 4d. Inmobiliaria: real-estate-specific FAQs + activate the listings
        // tool so the AI can show actual catalog entries via search_listings.
        if (industry === 'inmobiliaria') {
            await this.seedInmobiliariaExtras(tenantId, schemaName, l);
            await this.enableRealEstateTool(schemaName);
        }

        // 4e. Veterinaria: turn on the pets tool so the AI can register
        // pets, look up vaccination calendars, and triage emergencies.
        if (industry === 'veterinaria') {
            await this.enablePetsTool(schemaName);
        }

        // 4f. Restaurantes: enable the restaurants tool so Luca can
        // look up the menu, list active promotions, and place orders.
        if (industry === 'restaurantes') {
            await this.enableRestaurantsTool(schemaName);
        }

        // 4g. Gimnasios: enable the gyms tool so Alex can show plans,
        // class schedule, and let members book / freeze.
        if (industry === 'gimnasios') {
            await this.enableGymsTool(schemaName);
        }

        // 4h. Education: enable the education tool so Pablo can list
        // courses, show open cohorts, send placement tests and enroll.
        if (industry === 'education') {
            await this.enableEducationTool(schemaName);
        }

        // 4i. Seguros: enable the insurance tool so Roberto can show
        // plans, calculate quotes, look up policies and file claims.
        if (industry === 'seguros') {
            await this.enableInsuranceTool(schemaName);
        }

        // 4j. Tier 3 verticals — light bootstrap: each just flips the
        // appropriate tool flag on the default agent. Pet services and
        // photography reuse the existing services + appointments engine
        // so no per-vertical schema is needed.
        if (industry === 'servicios_hogar') {
            await this.enableSimpleTool(schemaName, 'homeServices');
        }
        if (industry === 'pet_services') {
            await this.enableSimpleTool(schemaName, 'petServices');
        }
        if (industry === 'fotografia') {
            await this.enableSimpleTool(schemaName, 'photography');
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

    /**
     * Dental-specific FAQs covering the operational questions patients ask
     * before booking with a dental clinic.
     */
    private async seedDentalExtras(tenantId: string, schemaName: string, lang: string): Promise<void> {
        try {
            const faqs: Array<{ question: Record<string, string>; answer: Record<string, string>; category: string }> = [
                {
                    question: {
                        es: '¿Trabajan con mi seguro / EPS / convenio?',
                        en: 'Do you work with my insurance / health plan?',
                        pt: 'Trabalham com meu plano de saúde?',
                        fr: 'Travaillez-vous avec mon assurance santé?',
                    },
                    answer: {
                        es: 'Trabajamos con varios convenios. Cuéntame cuál es el tuyo y la doctora confirma cobertura específica al momento de la valoración.',
                        en: 'We work with several plans. Let me know yours and the doctor will confirm specific coverage at your assessment.',
                        pt: 'Trabalhamos com vários planos. Me diga qual é o seu para confirmar a cobertura na avaliação.',
                        fr: 'Nous travaillons avec plusieurs plans. Dites-moi le vôtre et la docteure confirmera à l\'évaluation.',
                    },
                    category: 'seguros',
                },
                {
                    question: {
                        es: '¿Cuánto cuesta una limpieza dental?',
                        en: 'How much does a dental cleaning cost?',
                        pt: 'Quanto custa uma limpeza dental?',
                        fr: 'Combien coûte un détartrage?',
                    },
                    answer: {
                        es: 'El costo de la limpieza varía según el tipo (rutinaria o profunda). Te lo confirmamos exactamente en la valoración previa, que es gratuita.',
                        en: 'Cleaning cost depends on the type (routine or deep). We\'ll confirm at your free initial assessment.',
                        pt: 'O custo varia conforme o tipo (rotina ou profunda). Confirmamos na avaliação prévia gratuita.',
                        fr: 'Le coût varie selon le type (routine ou profond). Nous confirmons à l\'évaluation gratuite.',
                    },
                    category: 'costos',
                },
                {
                    question: {
                        es: '¿Cómo manejan el dolor o miedo al dentista?',
                        en: 'How do you handle dental anxiety or pain?',
                        pt: 'Como lidam com a dor ou medo do dentista?',
                        fr: 'Comment gérez-vous la peur du dentiste ou la douleur?',
                    },
                    answer: {
                        es: 'Trabajamos con anestesia local en todos los procedimientos. Para pacientes con ansiedad alta podemos coordinar sedación consciente con la doctora — agenda valoración para evaluarlo.',
                        en: 'We use local anaesthesia for all procedures. For high anxiety we can coordinate conscious sedation — book an assessment to discuss.',
                        pt: 'Usamos anestesia local em todos os procedimentos. Para alta ansiedade podemos coordenar sedação consciente.',
                        fr: 'Nous utilisons l\'anesthésie locale. Pour l\'anxiété élevée, nous pouvons coordonner une sédation consciente.',
                    },
                    category: 'dolor',
                },
                {
                    question: {
                        es: '¿Cuánto tiempo dura un tratamiento de ortodoncia?',
                        en: 'How long does orthodontic treatment take?',
                        pt: 'Quanto tempo dura o tratamento ortodôntico?',
                        fr: 'Combien de temps dure un traitement d\'orthodontie?',
                    },
                    answer: {
                        es: 'Depende de tu caso, pero generalmente entre 12 y 24 meses con citas mensuales. Si ya tienes ortodoncia con nosotros, puedo consultarte el progreso de tu plan.',
                        en: 'Depends on your case — typically 12-24 months with monthly visits. If you already have orthodontics with us, I can show your plan progress.',
                        pt: 'Depende do caso — geralmente entre 12 e 24 meses com visitas mensais.',
                        fr: 'Dépend du cas — généralement entre 12 et 24 mois avec visites mensuelles.',
                    },
                    category: 'ortodoncia',
                },
                {
                    question: {
                        es: '¿Atienden urgencias dentales?',
                        en: 'Do you handle dental emergencies?',
                        pt: 'Atendem emergências dentárias?',
                        fr: 'Traitez-vous les urgences dentaires?',
                    },
                    answer: {
                        es: 'Sí, manejamos urgencias en horario regular. Si tienes dolor intenso, traumatismo o sangrado abundante, te conecto YA con la clínica para coordinar cita inmediata.',
                        en: 'Yes, we handle emergencies during business hours. If you have severe pain, trauma or heavy bleeding, I\'ll connect you with the clinic right away.',
                        pt: 'Sim, atendemos emergências em horário regular. Para dor intensa, trauma ou sangramento, conecto você imediatamente.',
                        fr: 'Oui, nous traitons les urgences pendant les heures d\'ouverture. Pour douleur intense, traumatisme ou saignement, je vous connecte immédiatement.',
                    },
                    category: 'urgencias',
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
            this.logger.debug(`Seeded ${faqs.length} dental-specific FAQs`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed dental FAQs: ${error.message}`);
        }
    }

    /**
     * Real-estate-specific FAQs covering the operational questions buyers
     * and renters always ask before scheduling a viewing.
     */
    private async seedInmobiliariaExtras(tenantId: string, schemaName: string, lang: string): Promise<void> {
        try {
            const faqs: Array<{ question: Record<string, string>; answer: Record<string, string>; category: string }> = [
                {
                    question: {
                        es: '¿Tienen opciones con financiación / crédito hipotecario?',
                        en: 'Do you offer financing / mortgage options?',
                        pt: 'Têm opções com financiamento / crédito hipotecário?',
                        fr: 'Avez-vous des options de financement / prêt hypothécaire?',
                    },
                    answer: {
                        es: 'Sí, varias propiedades aplican a crédito hipotecario y/o subsidios (Mi Casa Ya, VIS). Cuéntame el rango de precio y zona, y te muestro las opciones que aplican.',
                        en: 'Yes, several listings qualify for mortgage and/or housing subsidies. Tell me your price range and area and I\'ll show what applies.',
                        pt: 'Sim, vários imóveis aceitam financiamento bancário e/ou subsídios habitacionais.',
                        fr: 'Oui, plusieurs biens sont éligibles au financement bancaire et/ou aides au logement.',
                    },
                    category: 'financiacion',
                },
                {
                    question: {
                        es: '¿Cómo agendo una visita a la propiedad?',
                        en: 'How do I schedule a viewing?',
                        pt: 'Como agendo uma visita ao imóvel?',
                        fr: 'Comment puis-je planifier une visite?',
                    },
                    answer: {
                        es: 'Te muestro las propiedades disponibles según tu interés y agendamos visita con el asesor de zona. ¿Qué presupuesto manejas y en qué zona te interesa?',
                        en: 'I\'ll show you matching properties and book the viewing with the zone agent. What\'s your budget and target area?',
                        pt: 'Eu mostro os imóveis disponíveis conforme seu interesse e agendamos a visita.',
                        fr: 'Je vous montre les propriétés correspondantes et organise la visite avec l\'agent de zone.',
                    },
                    category: 'visitas',
                },
                {
                    question: {
                        es: '¿Cuánto cobran de comisión / honorarios?',
                        en: 'What is your commission / fee?',
                        pt: 'Qual é a comissão / honorário?',
                        fr: 'Quelle est votre commission / honoraires?',
                    },
                    answer: {
                        es: 'Para arriendo: el equivalente al primer mes (compartido o asumido por el arrendador, depende del caso). Para venta: porcentaje sobre el cierre, te confirma el asesor al momento de la visita.',
                        en: 'Rentals: typically equivalent to the first month (split varies). Sales: a percentage of the deal — the agent confirms at the viewing.',
                        pt: 'Aluguel: equivalente ao primeiro mês. Venda: percentual sobre o fechamento — confirmado na visita.',
                        fr: 'Location : équivalent au premier mois. Vente : pourcentage sur la transaction — confirmé à la visite.',
                    },
                    category: 'comisiones',
                },
                {
                    question: {
                        es: '¿Qué documentos necesito para arrendar / comprar?',
                        en: 'What documents do I need to rent / buy?',
                        pt: 'Quais documentos preciso para alugar / comprar?',
                        fr: 'Quels documents pour louer / acheter?',
                    },
                    answer: {
                        es: 'Arriendo: cédula, certificado laboral, extractos bancarios y codeudor (depende del inmueble). Compra: capacidad crediticia y separación. Te detallo cuando definamos el inmueble.',
                        en: 'Rent: ID, employment letter, bank statements, co-signer if required. Sale: credit capacity check + earnest money. We detail once we pick the property.',
                        pt: 'Aluguel: documento, comprovante de renda e fiador. Compra: capacidade de crédito + sinal. Detalhamos no imóvel escolhido.',
                        fr: 'Location: pièce d\'identité, justificatifs de revenus, garant. Achat : vérification de solvabilité + acompte.',
                    },
                    category: 'documentos',
                },
                {
                    question: {
                        es: '¿La administración / cuota de condominio está incluida en el precio?',
                        en: 'Is the HOA fee included in the price?',
                        pt: 'A taxa de condomínio está incluída no preço?',
                        fr: 'Les charges sont-elles incluses dans le prix?',
                    },
                    answer: {
                        es: 'En arriendo: la administración generalmente NO está incluida y se paga aparte. En venta: el precio publicado es del inmueble; la administración mensual se informa en la visita.',
                        en: 'Rent: HOA is usually paid separately on top of rent. Sale: listed price is property only; monthly HOA disclosed at viewing.',
                        pt: 'Aluguel: o condomínio geralmente NÃO está incluído. Venda: preço é só do imóvel.',
                        fr: 'Location : les charges sont en général séparées. Vente : prix du bien uniquement.',
                    },
                    category: 'costos',
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
            this.logger.debug(`Seeded ${faqs.length} inmobiliaria-specific FAQs`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed inmobiliaria FAQs: ${error.message}`);
        }
    }

    /**
     * Turn on config.tools.realEstate.enabled so the inmobiliaria AI can
     * call search_listings and show real catalog entries.
     */
    private async enableRealEstateTool(schemaName: string): Promise<void> {
        try {
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            const agent = agents?.[0];
            if (!agent) return;
            const config = agent.config_json || {};
            const tools = { ...(config.tools || {}) };
            tools.realEstate = { ...(tools.realEstate || {}), enabled: true };
            const newConfig = { ...config, tools };
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                [JSON.stringify(newConfig), agent.id],
            );
            this.logger.debug('Enabled realEstate tool on default agent');
        } catch (error: any) {
            this.logger.warn(`Failed to enable realEstate tool: ${error.message}`);
        }
    }

    /**
     * Turn on config.tools.treatments.enabled so the dental AI can read
     * the patient's active treatment plan and upcoming sessions.
     */
    private async enableTreatmentsTool(schemaName: string): Promise<void> {
        try {
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            const agent = agents?.[0];
            if (!agent) return;

            const config = agent.config_json || {};
            const tools = { ...(config.tools || {}) };
            tools.treatments = { ...(tools.treatments || {}), enabled: true };
            const newConfig = { ...config, tools };

            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                [JSON.stringify(newConfig), agent.id],
            );
            this.logger.debug('Enabled treatments tool on default agent');
        } catch (error: any) {
            this.logger.warn(`Failed to enable treatments tool: ${error.message}`);
        }
    }

    /**
     * Turn on config.tools.pets.enabled so the veterinaria AI can manage
     * the tutor's pets, look up vaccination calendars, and triage emergencies.
     */
    private async enablePetsTool(schemaName: string): Promise<void> {
        try {
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            const agent = agents?.[0];
            if (!agent) return;

            const config = agent.config_json || {};
            const tools = { ...(config.tools || {}) };
            tools.pets = { ...(tools.pets || {}), enabled: true };
            const newConfig = { ...config, tools };

            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                [JSON.stringify(newConfig), agent.id],
            );
            this.logger.debug('Enabled pets tool on default agent');
        } catch (error: any) {
            this.logger.warn(`Failed to enable pets tool: ${error.message}`);
        }
    }

    /**
     * Turn on config.tools.restaurants.enabled so Luca can use get_menu,
     * get_promotions, and place_order on restaurant tenants.
     */
    private async enableRestaurantsTool(schemaName: string): Promise<void> {
        try {
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            const agent = agents?.[0];
            if (!agent) return;

            const config = agent.config_json || {};
            const tools = { ...(config.tools || {}) };
            tools.restaurants = { ...(tools.restaurants || {}), enabled: true };
            const newConfig = { ...config, tools };

            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                [JSON.stringify(newConfig), agent.id],
            );
            this.logger.debug('Enabled restaurants tool on default agent');
        } catch (error: any) {
            this.logger.warn(`Failed to enable restaurants tool: ${error.message}`);
        }
    }

    /** Enable gyms tool on default agent for industry='gimnasios'. */
    private async enableGymsTool(schemaName: string): Promise<void> {
        try {
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            const agent = agents?.[0];
            if (!agent) return;

            const config = agent.config_json || {};
            const tools = { ...(config.tools || {}) };
            tools.gyms = { ...(tools.gyms || {}), enabled: true };
            const newConfig = { ...config, tools };

            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                [JSON.stringify(newConfig), agent.id],
            );
            this.logger.debug('Enabled gyms tool on default agent');
        } catch (error: any) {
            this.logger.warn(`Failed to enable gyms tool: ${error.message}`);
        }
    }

    /**
     * Generic tool-enabler for Tier 3 verticals. Each just flips a
     * config.tools.* flag on the default agent — no domain-specific
     * extras needed since these verticals reuse the existing services
     * + appointments + service_requests infrastructure.
     */
    private async enableSimpleTool(schemaName: string, toolKey: string): Promise<void> {
        try {
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            const agent = agents?.[0];
            if (!agent) return;
            const config = agent.config_json || {};
            const tools = { ...(config.tools || {}) };
            tools[toolKey] = { ...(tools[toolKey] || {}), enabled: true };
            const newConfig = { ...config, tools };
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                [JSON.stringify(newConfig), agent.id],
            );
            this.logger.debug(`Enabled ${toolKey} tool on default agent`);
        } catch (error: any) {
            this.logger.warn(`Failed to enable ${toolKey} tool: ${error.message}`);
        }
    }

    /** Enable insurance tool on default agent for industry='seguros'. */
    private async enableInsuranceTool(schemaName: string): Promise<void> {
        try {
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            const agent = agents?.[0];
            if (!agent) return;

            const config = agent.config_json || {};
            const tools = { ...(config.tools || {}) };
            tools.insurance = { ...(tools.insurance || {}), enabled: true };
            const newConfig = { ...config, tools };

            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                [JSON.stringify(newConfig), agent.id],
            );
            this.logger.debug('Enabled insurance tool on default agent');
        } catch (error: any) {
            this.logger.warn(`Failed to enable insurance tool: ${error.message}`);
        }
    }

    /** Enable education tool on default agent for industry='education'. */
    private async enableEducationTool(schemaName: string): Promise<void> {
        try {
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            const agent = agents?.[0];
            if (!agent) return;

            const config = agent.config_json || {};
            const tools = { ...(config.tools || {}) };
            tools.education = { ...(tools.education || {}), enabled: true };
            const newConfig = { ...config, tools };

            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                [JSON.stringify(newConfig), agent.id],
            );
            this.logger.debug('Enabled education tool on default agent');
        } catch (error: any) {
            this.logger.warn(`Failed to enable education tool: ${error.message}`);
        }
    }
}
