import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getVerticalDefinition } from './vertical-definitions';
import { PERSONA_CACHE_CHANNELS } from '../../common/utils/persona-cache.util';
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

        // 3. Seed FAQs + turn the FAQ tool on. Sembrarlas sin encender
        // `tools.faqs` las dejaba visibles solo en el portal público: el
        // registro de FAQ_TOOL en el pipeline exige el flag
        // (`conversations.service.ts`, `cfgTools?.faqs?.enabled === true`).
        await this.seedFaqs(schemaName, definition, l);
        await this.enableSimpleTool(schemaName, 'faqs');

        // 4. Seed services (if booking-enabled)
        if (definition.bookingEnabled && definition.services.length > 0) {
            await this.seedServices(schemaName, definition, l);
        }

        // 4a. Seed la disponibilidad semanal. Va junto con los servicios porque
        // el agendador necesita las dos cosas: con servicios pero sin slots el
        // bot ofrece turnos y después responde "no hay disponibilidad" siempre.
        if (definition.bookingEnabled) {
            await this.seedAvailability(tenantId, schemaName, definition);
        }

        // 4a-bis. Con la agenda ya sembrada, devolver la herramienta de citas al estado
        // que pedía la plantilla. `createDefaultAgentFromGoals` corre ANTES que este
        // bootstrap (auth.service), así que ahí el schema todavía no tenía servicios ni
        // horarios y la apagó dejando un marcador; sin este paso los tenants de
        // salud/belleza/veterinaria/… arrancarían sin agendador. Va fuera del `if` a
        // propósito: aunque la vertical no sea de agenda hay que limpiar el marcador
        // (el método no toca nada si no está, y decide por los contadores reales).
        await this.restoreAppointmentsTool(schemaName);

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

        // 6. Tirar abajo los caches calientes que sirven lo que acabamos de
        // escribir (persona por canal, servicios del agendador, verticalConfig).
        await this.invalidateRuntimeCaches(tenantId);

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
                // El target tiene que ser el índice real: `uidx_pipeline_stages_pipeline_slug`
                // es (pipeline_id, slug) NULLS NOT DISTINCT — no (slug) a secas — porque un
                // segundo embudo reutiliza legítimamente los mismos slugs. El bootstrap
                // inserta con pipeline_id NULL, y ahí el índice sí muerde.
                await this.prisma.$queryRawUnsafe(
                    `INSERT INTO "${schemaName}"."pipeline_stages"
                     (tenant_id, name, slug, color, position, default_probability, sla_hours, is_terminal, transition_rules)
                     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
                     ON CONFLICT (pipeline_id, slug) DO NOTHING`,
                    tenantId, name, stage.slug, stage.color, i, stage.probability, stage.slaHours || null, stage.isTerminal,
                    JSON.stringify((stage as any).transitionRules || []),
                );
            }
            this.logger.debug(`Seeded ${definition.pipeline.stages.length} pipeline stages`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed pipeline stages: ${error.message}`);
        }
    }

    /**
     * Funde la persona de la vertical dentro de `config_json` respetando el
     * shape canónico que lee el ensamblador del prompt: `config.persona.*` y
     * `config.behavior.*` (`PersonaService.buildGuidedPersonaBlock`). Hasta
     * ahora esto escribía name/role/greeting/rules/forbiddenTopics/
     * handoffTriggers en la RAÍZ del JSON, un lugar sin ningún lector en
     * runtime: la persona de las 18 industrias se cortaba ahí en silencio.
     *
     * DECISIÓN DE DISEÑO — el patch RELLENA HUECOS, no pisa:
     *  - La plantilla vertical que `createDefaultAgentFromGoals` insertó un
     *    paso antes es la fuente real y está mejor escrita (reglas por
     *    producto, requiredFields, fallbackMessage); el registry es un resumen.
     *  - Este método también corre en cualquier re-seed sobre un tenant vivo,
     *    donde pisar borraría lo que el dueño del negocio editó a mano.
     * Excepción deliberada: `forbiddenTopics` y `handoffTriggers` se UNEN en
     * vez de rellenarse. Son restricciones aditivas —prohibir de más nunca
     * hace que el bot afirme algo falso, y escalar de más termina en un
     * humano—, así que los límites propios de la industria entran igual
     * aunque la plantilla ya traiga su propia lista.
     */
    private async patchDefaultAgent(
        schemaName: string,
        definition: VerticalDefinition,
        lang: string,
    ): Promise<void> {
        try {
            // Find the default agent
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, name, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            if (!agents || agents.length === 0) return;

            const agent = agents[0];
            const existingConfig = agent.config_json || {};
            const agentDef = definition.agent;
            const pick = (loc: Record<string, string> | undefined): string =>
                (loc?.[lang] || loc?.['es'] || '').trim();

            const existingPersona = existingConfig.persona || {};
            const existingPersonality = existingPersona.personality || {};
            const existingBehavior = existingConfig.behavior || {};
            const existingRules = Array.isArray(existingBehavior.rules) ? existingBehavior.rules.filter(Boolean) : [];

            const persona = {
                ...existingPersona,
                name: this.orFallback(existingPersona.name, pick(agentDef.name)),
                role: this.orFallback(existingPersona.role, pick(agentDef.role)),
                greeting: this.orFallback(existingPersona.greeting, pick(agentDef.greeting)),
                personality: {
                    ...existingPersonality,
                    tone: this.orFallback(existingPersonality.tone, agentDef.tone),
                    formality: this.orFallback(existingPersonality.formality, agentDef.formality),
                },
            };

            const behavior = {
                ...existingBehavior,
                // `rules` viene como un párrafo en el registry y el lector espera
                // un array: mismo criterio de corte que los otros dos campos.
                rules: existingRules.length > 0 ? existingRules : this.splitDefinitionRules(pick(agentDef.rules)),
                forbiddenTopics: this.mergeStringList(
                    existingBehavior.forbiddenTopics,
                    this.splitDefinitionList(pick(agentDef.forbiddenTopics)),
                ),
                handoffTriggers: this.mergeStringList(
                    existingBehavior.handoffTriggers,
                    this.splitDefinitionList(pick(agentDef.handoffTriggers)),
                ),
            };

            const patchedConfig = { ...existingConfig, persona, behavior };

            // La columna `name` sigue al nombre EFECTIVO de la persona. Antes se
            // pisaba con el del registry mientras el bot se presentaba con el de
            // la plantilla: la lista decía "Roberto" y el cliente leía "Andrés".
            const displayName = persona.name || agent.name || 'Asistente';

            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET
                    name = $1,
                    config_json = $2::jsonb
                 WHERE id = $3::uuid`,
                [
                    displayName,
                    JSON.stringify(patchedConfig),
                    agent.id,
                ],
            );

            this.logger.debug(`Patched default agent with vertical persona: "${displayName}"`);
        } catch (error: any) {
            this.logger.warn(`Failed to patch default agent: ${error.message}`);
        }
    }

    /** Devuelve el valor actual si tiene contenido; si no, el de la vertical. */
    private orFallback(current: any, fallback: string): string {
        return typeof current === 'string' && current.trim().length > 0 ? current : fallback;
    }

    /** 'a|b|c' → ['a','b','c'] (formato del registry para listas). */
    private splitDefinitionList(raw: string): string[] {
        if (!raw) return [];
        return raw.split('|').map((item) => item.trim()).filter(Boolean);
    }

    /**
     * Las reglas del registry son prosa ("Haz X. Nunca hagas Y."), no una lista
     * separada por '|'. Cortamos por oración para que cada una baje al prompt
     * como un <rule> propio, y soportamos igual el separador '|' por si alguna
     * definición futura lo usa.
     */
    private splitDefinitionRules(raw: string): string[] {
        if (!raw) return [];
        if (raw.includes('|')) return this.splitDefinitionList(raw);
        return raw
            .split(/\.\s+/)
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => (item.endsWith('.') ? item : `${item}.`));
    }

    /** Une dos listas de strings sin duplicados (comparación case-insensitive). */
    private mergeStringList(current: any, extra: string[]): string[] {
        const base = Array.isArray(current) ? current.filter((item: any) => typeof item === 'string' && item.trim()) : [];
        const seen = new Set(base.map((item: string) => item.trim().toLowerCase()));
        const merged = [...base];
        for (const item of extra) {
            const key = item.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(item);
        }
        return merged;
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
                     ON CONFLICT (question) DO NOTHING`,
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
                     ON CONFLICT (name) DO NOTHING`,
                    name, description, svc.durationMinutes, svc.price, svc.currency, svc.category, i,
                );
            }
            this.logger.debug(`Seeded ${definition.services.length} services`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed services: ${error.message}`);
        }
    }

    /**
     * Siembra la disponibilidad semanal desde `definition.businessHours`, el
     * único horario que la plataforma ya tiene escrito y traducido para las 18
     * verticales. Sin filas en `availability_slots` el agendador arranca
     * encendido pero `check_availability` devuelve siempre "no hay
     * disponibilidad": el bot ofrece turnos que no puede tomar.
     *
     * Las filas replican exactamente el shape que escribe
     * `AppointmentsService.saveAvailability`, así que el tenant puede
     * reemplazarlas desde Citas → Config sin ninguna sorpresa.
     */
    private async seedAvailability(
        tenantId: string,
        schemaName: string,
        definition: VerticalDefinition,
    ): Promise<void> {
        try {
            const schedule = definition.businessHours?.schedule || {};
            const days: Array<[string, unknown]> = Object.entries(schedule);
            if (days.length === 0) return;

            // La tabla no tiene UNIQUE sobre el que apoyar un ON CONFLICT, así
            // que la idempotencia es este guard: si el tenant ya tiene horarios
            // (propios o de un bootstrap anterior) no tocamos nada.
            const existing = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT COUNT(*)::int AS cnt FROM availability_slots`,
            );
            if (Number(existing?.[0]?.cnt || 0) > 0) {
                this.logger.debug('Availability already configured — skipping seed');
                return;
            }

            // `availability_slots.user_id` es NOT NULL y el runtime lo resuelve
            // contra public.users (nombre del staff en los turnos ofrecidos), así
            // que tiene que ser un usuario real: el dueño del tenant.
            const owner =
                (await this.prisma.user.findFirst({
                    where: { tenantId, isActive: true, role: 'tenant_admin' },
                    orderBy: { createdAt: 'asc' },
                    select: { id: true },
                })) ||
                (await this.prisma.user.findFirst({
                    where: { tenantId, isActive: true },
                    orderBy: { createdAt: 'asc' },
                    select: { id: true },
                }));

            if (!owner) {
                this.logger.warn(`No user found for tenant ${tenantId} — skipping availability seed`);
                return;
            }

            // 0=domingo … 6=sábado, igual que `availability_slots.day_of_week`.
            const dayIndex: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
            const toMinutes = (hhmm: string): number => {
                const [h, m] = hhmm.split(':').map(Number);
                return h * 60 + m;
            };

            let inserted = 0;
            for (const [day, range] of days) {
                const dow = dayIndex[day.toLowerCase()];
                if (dow === undefined || typeof range !== 'string') continue;

                const [rawStart, rawEnd] = range.split('-').map((part) => part.trim());
                if (!/^\d{1,2}:\d{2}$/.test(rawStart || '') || !/^\d{1,2}:\d{2}$/.test(rawEnd || '')) continue;

                // Cierres a medianoche ('11:00-00:00'): la columna es TIME sin
                // fecha, y un fin <= inicio genera cero turnos en el generador.
                const end = toMinutes(rawEnd) <= toMinutes(rawStart) ? '23:59' : rawEnd;

                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `INSERT INTO availability_slots (id, user_id, day_of_week, start_time, end_time, is_active, created_at)
                     VALUES ($1::uuid, $2::uuid, $3, $4::time, $5::time, true, NOW())`,
                    [randomUUID(), owner.id, dow, rawStart, end],
                );
                inserted++;
            }

            this.logger.debug(`Seeded ${inserted} availability slots from vertical business hours`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed availability slots: ${error.message}`);
        }
    }

    /**
     * El bootstrap reescribe `config_json` y siembra servicios, pero los caches
     * que los sirven en caliente sobreviven: persona por canal (600s),
     * servicios del agendador (300s) y el propio verticalConfig. En el alta
     * están fríos; esto hace seguro cualquier re-seed sobre un tenant vivo.
     *
     * `PersonaService.invalidatePersonaCaches` hace exactamente esto, pero es
     * privado, así que replicamos el borrado con el RedisService ya inyectado.
     */
    private async invalidateRuntimeCaches(tenantId: string): Promise<void> {
        try {
            await this.redis.del(`vertical:${tenantId}`);
            await this.redis.del(`booking:services:${tenantId}`);
            await this.redis.del(`persona:${tenantId}:active`);

            for (const ch of PERSONA_CACHE_CHANNELS) {
                await this.redis.del(`persona:${tenantId}:channel:${ch}`);
            }

            // El pipeline lee siempre la variante por-cuenta cuando hay conexión
            // (`persona:{tenant}:channel:{type}:acct:{accountId}`).
            const accounts = await this.prisma.channelAccount.findMany({
                where: { tenantId, isActive: true },
                select: { channelType: true, accountId: true },
            });
            for (const acct of accounts) {
                await this.redis.del(`persona:${tenantId}:channel:${acct.channelType}:acct:${acct.accountId}`);
            }
        } catch (error: any) {
            this.logger.warn(`Failed to invalidate caches after vertical bootstrap: ${error.message}`);
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
                        es: 'Las tarifas para niños dependen del paquete y de la edad. Contame cuántos van y qué edades tienen, y te confirmo el precio exacto.',
                        en: 'Child rates depend on the package and the age. Tell me how many children and their ages, and I\'ll confirm the exact price.',
                        pt: 'As tarifas para crianças dependem do pacote e da idade. Me diga quantas vão e as idades, e confirmo o preço exato.',
                        fr: 'Les tarifs enfants dépendent du forfait et de l\'âge. Dites-moi combien d\'enfants et leurs âges, et je vous confirme le prix exact.',
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
                        es: 'Depende del tour y de la disponibilidad de guías. Decime qué idioma preferís y te confirmo si lo tenemos para la fecha que buscás.',
                        en: 'It depends on the tour and guide availability. Tell me your preferred language and I\'ll confirm whether we have it for your date.',
                        pt: 'Depende do passeio e da disponibilidade de guias. Me diga o idioma que prefere e confirmo se temos para a sua data.',
                        fr: 'Cela dépend du tour et de la disponibilité des guides. Dites-moi la langue que vous préférez et je vous confirme pour votre date.',
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
                        es: 'Tenemos condiciones de cancelación según cuánto falte para la salida. Contame la fecha de tu reserva y te confirmo exactamente cómo aplica en tu caso.',
                        en: 'Cancellation terms depend on how far ahead of departure you cancel. Tell me your booking date and I\'ll confirm exactly how it applies to you.',
                        pt: 'As condições de cancelamento dependem de quanto falta para a saída. Me diga a data da sua reserva e confirmo exatamente como se aplica.',
                        fr: 'Les conditions d\'annulation dépendent du délai avant le départ. Dites-moi la date de votre réservation et je vous confirme ce qui s\'applique.',
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
                    `INSERT INTO faqs (question, answer, category, is_published, search_tsv)
                     VALUES ($1, $2, $3, true, to_tsvector('simple', $1 || ' ' || $2))
                     ON CONFLICT (question) DO NOTHING`,
                    [q, a, f.category],
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
                        es: 'El costo varía según el tipo de limpieza (rutinaria o profunda). Te lo confirmamos en la valoración previa. ¿Querés que te agende una?',
                        en: 'The cost depends on the type of cleaning (routine or deep). We\'ll confirm it at the initial assessment. Want me to book you one?',
                        pt: 'O custo varia conforme o tipo de limpeza (rotina ou profunda). Confirmamos na avaliação prévia. Quer que eu agende uma?',
                        fr: 'Le coût dépend du type de nettoyage (routine ou profond). Nous le confirmons lors de l\'évaluation. Voulez-vous que je vous en réserve une ?',
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
                        es: 'Es una preocupación muy común y la tenemos en cuenta. Las opciones de manejo del dolor y de la ansiedad las evalúa la profesional según tu caso — agendá una valoración y lo conversan.',
                        en: 'It\'s a very common concern and we take it seriously. Pain and anxiety management options are assessed case by case — book an assessment and you can discuss it.',
                        pt: 'É uma preocupação muito comum e levamos a sério. As opções de manejo da dor e da ansiedade são avaliadas caso a caso — agende uma avaliação para conversar.',
                        fr: 'C\'est une préoccupation très courante et nous en tenons compte. Les options de gestion de la douleur et de l\'anxiété s\'évaluent au cas par cas — réservez une évaluation pour en parler.',
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
                        es: 'Si tenés dolor intenso, un golpe o sangrado abundante, te conecto YA con la clínica para que lo vean cuanto antes. No esperes a que pase.',
                        en: 'If you have severe pain, an injury or heavy bleeding, I\'ll connect you with the clinic right now so they can see you as soon as possible. Don\'t wait it out.',
                        pt: 'Se você está com dor intensa, uma pancada ou sangramento abundante, conecto você AGORA com a clínica para atenderem o quanto antes. Não espere passar.',
                        fr: 'Si vous avez une douleur intense, un choc ou un saignement abondant, je vous mets en relation avec la clinique tout de suite. N\'attendez pas que ça passe.',
                    },
                    category: 'urgencias',
                },
            ];

            for (const f of faqs) {
                const q = f.question[lang] || f.question['es'];
                const a = f.answer[lang] || f.answer['es'];
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `INSERT INTO faqs (question, answer, category, is_published, search_tsv)
                     VALUES ($1, $2, $3, true, to_tsvector('simple', $1 || ' ' || $2))
                     ON CONFLICT (question) DO NOTHING`,
                    [q, a, f.category],
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
                        es: 'La financiación depende de cada propiedad y de tu perfil. Contame el rango de precio y la zona que te interesa, y reviso qué opciones aplican en tu caso.',
                        en: 'Financing depends on the property and your profile. Tell me your price range and the area you\'re after, and I\'ll check which options apply.',
                        pt: 'O financiamento depende de cada imóvel e do seu perfil. Me diga a faixa de preço e a região, e verifico quais opções se aplicam.',
                        fr: 'Le financement dépend du bien et de votre profil. Dites-moi votre budget et le quartier, et je vérifie les options possibles.',
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
                        es: 'Los honorarios dependen de si es arriendo o venta y del inmueble. Te los confirma el asesor sobre la propiedad concreta que te interese, antes de cualquier compromiso.',
                        en: 'Fees depend on whether it\'s a rental or a sale, and on the property. The agent confirms them for the specific listing you\'re interested in, before any commitment.',
                        pt: 'Os honorários dependem de ser aluguel ou venda e do imóvel. O corretor confirma para o imóvel específico que te interessa, antes de qualquer compromisso.',
                        fr: 'Les honoraires dépendent s\'il s\'agit d\'une location ou d\'une vente, et du bien. Le conseiller vous les confirme pour le bien qui vous intéresse, avant tout engagement.',
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
                    `INSERT INTO faqs (question, answer, category, is_published, search_tsv)
                     VALUES ($1, $2, $3, true, to_tsvector('simple', $1 || ' ' || $2))
                     ON CONFLICT (question) DO NOTHING`,
                    [q, a, f.category],
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

    /**
     * Devuelve la herramienta de citas al estado que pedía la plantilla, una vez
     * que el bootstrap ya sembró servicios y disponibilidad.
     *
     * `PersonaService.createDefaultAgentFromGoals` corre antes que este bootstrap
     * y apaga las citas si el schema recién creado todavía no tiene agenda (un
     * throw ahí dejaría al tenant sin ningún agente). Deja el marcador
     * `tools.appointments.pendingPrerequisites`, que es lo único que distingue
     * "la apagamos nosotros" de "la plantilla la trae apagada a propósito"
     * (tpl_sales, tpl_faq): sin ese marcador no se toca nada.
     *
     * El marcador se borra siempre al evaluarlo — si la siembra no alcanzó, la
     * herramienta queda apagada de forma limpia y el tenant puede encenderla
     * desde Agente → Herramientas cuando complete su agenda (el gate de
     * `updateAgent` la validará ahí).
     */
    private async restoreAppointmentsTool(schemaName: string): Promise<void> {
        try {
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_default = true LIMIT 1`,
            );
            const agent = agents?.[0];
            if (!agent) return;

            const config = agent.config_json || {};
            const appointments = config.tools?.appointments;
            if (!appointments || appointments.pendingPrerequisites !== true) return;

            // Mismos dos contadores que exige `assertAppointmentsPrerequisites`.
            const [counts] = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT
                    (SELECT COUNT(*)::int FROM services WHERE is_active = true) AS services,
                    (SELECT COUNT(*)::int FROM availability_slots WHERE is_active = true) AS slots`,
            );
            const services = Number(counts?.services || 0);
            const slots = Number(counts?.slots || 0);

            const restored = { ...appointments, enabled: services > 0 && slots > 0 };
            delete restored.pendingPrerequisites;

            const newConfig = { ...config, tools: { ...config.tools, appointments: restored } };
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                [JSON.stringify(newConfig), agent.id],
            );

            if (restored.enabled) {
                this.logger.debug(`Re-enabled appointments tool (services=${services}, slots=${slots})`);
            } else {
                this.logger.warn(
                    `Appointments tool left OFF after vertical bootstrap (services=${services}, slots=${slots}) — the tenant must finish setting up the agenda`,
                );
            }
        } catch (error: any) {
            this.logger.warn(`Failed to restore appointments tool: ${error.message}`);
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
