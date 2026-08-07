import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getVerticalDefinition } from './vertical-definitions';
import { PERSONA_CACHE_CHANNELS } from '../../common/utils/persona-cache.util';
import {
    TenantVerticalConfig,
    VerticalDefinition,
    VerticalServiceDefinition,
    VerticalStageDefinition,
} from '@parallext/shared';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { LockOwnershipLostError, OwnedLockLease } from '../../common/utils/owned-lock.util';
import { mergeTenantSettingsAtomic } from '../../common/utils/tenant-settings.util';

export const VERTICAL_PROVISIONING_VERSION = 1;

type VerticalProvisioningStatus = 'pending' | 'complete' | 'failed';
type VerticalProvisioningStep =
    | 'quota_plan'
    | 'pipeline'
    | 'persona'
    | 'knowledge'
    | 'agenda'
    | 'vertical_tools'
    | 'config'
    | 'cache'
    | 'invariants';

interface VerticalProvisioningQuotaPolicy {
    pipelineStages: number;
    appointmentServices: number;
    selectedStageSlugs: string[];
    selectedServiceIndexes: number[];
}

export interface VerticalProvisioningState {
    version: number;
    status: VerticalProvisioningStatus;
    industry: string;
    subType: string | null;
    language: string;
    plan: string;
    attempt: number;
    startedAt: string;
    updatedAt: string;
    completedAt?: string;
    currentStep?: VerticalProvisioningStep;
    completedSteps: VerticalProvisioningStep[];
    quotaPolicy?: VerticalProvisioningQuotaPolicy;
    failure?: { step: VerticalProvisioningStep; message: string; at: string };
    invariants?: VerticalProvisioningInvariants;
}

interface VerticalProvisioningInvariants {
    pipelineStages: number;
    appointmentServices: number;
    availabilitySlots: number;
    publishedFaqs: number;
    activeAgents: number;
    requiredTools: string[];
}

export interface QuotaAwareVerticalDefaults {
    pipelineStages: VerticalStageDefinition[];
    services: VerticalServiceDefinition[];
}

function assertQuotaValue(value: unknown, key: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < -1) {
        throw new Error(`Missing or invalid plan quota "${key}"`);
    }
    return value;
}

/**
 * Política explícita defaults-vs-cuota:
 * - los registros existentes nunca se borran;
 * - si ya superan la cuota, el provisioning falla y no declara éxito;
 * - los servicios opcionales ocupan solo la capacidad restante;
 * - el pipeline es estructural e indivisible: si el plan/override no alcanza
 *   para TODAS sus etapas canónicas, el provisioning falla en vez de crear una
 *   vertical mutilada.
 */
export function selectQuotaAwareVerticalDefaults(
    definition: VerticalDefinition,
    services: VerticalServiceDefinition[],
    limits: { pipelineStages: number; appointmentServices: number },
    existing: { stageSlugs?: string[]; serviceNames?: string[] } = {},
): QuotaAwareVerticalDefaults {
    const stageLimit = assertQuotaValue(limits.pipelineStages, 'pipelineStages');
    const serviceLimit = assertQuotaValue(limits.appointmentServices, 'appointmentsServices');
    const existingStageSlugs = [...new Set(existing.stageSlugs || [])];
    const existingServiceNames = [...new Set(existing.serviceNames || [])];

    if (stageLimit !== -1 && existingStageSlugs.length > stageLimit) {
        throw new Error(`Existing pipeline stages (${existingStageSlugs.length}) exceed plan quota (${stageLimit})`);
    }
    if (serviceLimit !== -1 && existingServiceNames.length > serviceLimit) {
        throw new Error(`Existing appointment services (${existingServiceNames.length}) exceed plan quota (${serviceLimit})`);
    }

    const defaultStageSlugs = new Set(definition.pipeline.stages.map((stage) => stage.slug));
    const customStageCount = existingStageSlugs.filter((slug) => !defaultStageSlugs.has(slug)).length;
    const requiredPipelineCapacity = customStageCount + definition.pipeline.stages.length;
    if (stageLimit !== -1 && requiredPipelineCapacity > stageLimit) {
        throw new Error(
            `Plan quota pipelineStages=${stageLimit} is below canonical minimum ` +
            `${requiredPipelineCapacity} for vertical "${definition.industry}"`,
        );
    }

    const allDefaultServiceNames = services.map((service) => new Set(Object.values(service.name)));
    const matchingExistingServiceIndexes = new Set<number>();
    for (const existingName of existingServiceNames) {
        const index = allDefaultServiceNames.findIndex((names) => names.has(existingName));
        if (index >= 0) matchingExistingServiceIndexes.add(index);
    }
    const customServiceCount = existingServiceNames.length - matchingExistingServiceIndexes.size;
    const serviceCapacity = serviceLimit === -1
        ? services.length
        : Math.max(0, serviceLimit - customServiceCount);
    const selectedServiceIndexes = new Set([...matchingExistingServiceIndexes].slice(0, serviceCapacity));
    for (let index = 0; index < services.length && selectedServiceIndexes.size < serviceCapacity; index++) {
        selectedServiceIndexes.add(index);
    }

    return {
        pipelineStages: [...definition.pipeline.stages],
        services: services.filter((_service, index) => selectedServiceIndexes.has(index)),
    };
}

/**
 * Los sub-tipos que cambian lo que el bootstrap siembra.
 *
 * El dueño elegía con cuidado entre cuatro sub-tipos y en la mayoría de las
 * verticales no cambiaba absolutamente nada: `seedServices` y `seedAvailability`
 * corrían para toda industria con `bookingEnabled` sin mirar el sub-tipo. Por
 * eso el hotel recibía "Tour día completo" como servicio agendable de 4 horas,
 * la dark kitchen recibía "Reserva mesa 2-4", la boutique recibía "Corte y
 * estilo", y la farmacia una agendadora de consultas médicas. Todo eso el dueño
 * lo tenía que borrar a mano el día 1, si es que entendía por qué estaba ahí.
 *
 * Sólo entran acá los sub-tipos que REALMENTE ramifican. Regla de cierre del
 * plan: si después de esto un sub-tipo sigue sin cambiar nada, se saca del
 * selector del alta en vez de fingir que significa algo.
 */
interface SubtypeBootstrap {
    /** El sub-tipo no agenda: ni servicios ni horarios semanales. */
    skipAgenda?: boolean;
    /** Atiende 24×7 (guardia, urgencias): los horarios semanales no aplican. */
    roundTheClock?: boolean;
    /** Herramientas extra que su industria no enciende por defecto. */
    extraTools?: string[];
    /**
     * Servicios propios del sub-tipo, que REEMPLAZAN a los de la industria.
     *
     * Los servicios de la vertical son el mínimo común denominador y para
     * algunos sub-tipos eso es directamente otro negocio: un arquitecto no
     * vende "consulta inicial de 30 minutos", vende una visita a obra y un
     * anteproyecto; un contador vende la declaración de renta. Sembrarles el
     * genérico obliga al dueño a borrar y reescribir todo el día 1.
     */
    services?: VerticalServiceDefinition[];
}

/**
 * Las reglas de bootstrap están namespaced por industria. Un mismo slug de
 * sub-tipo puede significar negocios distintos: `turismo/hotel` reserva noches
 * y no usa la agenda genérica, mientras `pet_services/hotel` sí agenda estadías
 * como servicios. Indexarlas solo por `subType` hacía que la segunda heredara
 * accidentalmente el `skipAgenda` de la primera.
 *
 * `boutique` y `delivery` se conservan dentro de su industria aunque ya no estén
 * en el selector actual: son compatibilidad intencional para tenants antiguos,
 * sin volver a convertirlos en reglas globales.
 */
const SUBTYPE_BOOTSTRAP_BY_INDUSTRY: Record<string, Record<string, SubtypeBootstrap>> = {
    moda_belleza: {
        // Boutique de ropa: catálogo, no sillón.
        boutique: { skipAgenda: true, extraTools: ['catalog'] },
        // Paquetes de sesiones (depilación, masajes, etc.).
        spa: { extraTools: ['treatments'] },
        estetica: { extraTools: ['treatments'] },
    },
    salud: {
        // La farmacia despacha, no agenda consultas.
        farmacia: { skipAgenda: true, extraTools: ['catalog'] },
        // Mismo motor de paquetes de sesiones que estética.
        dermatologia: { extraTools: ['treatments'] },
        psicologia: { extraTools: ['treatments'] },
    },
    veterinaria: {
        // Urgencias 24h: reemplaza la grilla semanal de la industria.
        hospital_24h: { roundTheClock: true },
    },
    restaurantes: {
        // Sin salón no hay mesa que reservar.
        dark_kitchen: { skipAgenda: true },
        delivery: { skipAgenda: true },
    },
    turismo: {
        // El alojamiento reserva noches contra `properties`, no franjas de
        // cuatro horas contra `services`.
        hotel: { skipAgenda: true },
        alquiler_vacacional: { skipAgenda: true },
    },
    servicios_profesionales: {
        // Los precios son una base editable; el valor del preset es que el
        // nombre del servicio corresponda al rubro desde el primer día.
        contadores: {
            services: [
                { name: { es: 'Declaración de renta', en: 'Income tax return', pt: 'Declaração de renda', fr: 'Déclaration de revenus' }, description: { es: 'Preparación y presentación de la declaración anual', en: 'Preparation and filing of the annual return', pt: 'Preparação e envio da declaração anual', fr: 'Préparation et dépôt de la déclaration annuelle' }, durationMinutes: 60, price: 250000, currency: 'COP', category: 'tributario' },
                { name: { es: 'Asesoría contable mensual', en: 'Monthly accounting service', pt: 'Assessoria contábil mensal', fr: 'Suivi comptable mensuel' }, description: { es: 'Contabilidad y obligaciones del mes', en: 'Monthly bookkeeping and filings', pt: 'Contabilidade e obrigações do mês', fr: 'Comptabilité et obligations du mois' }, durationMinutes: 60, price: 400000, currency: 'COP', category: 'contable' },
                { name: { es: 'Primera reunión', en: 'First meeting', pt: 'Primeira reunião', fr: 'Premier rendez-vous' }, description: { es: 'Diagnóstico inicial sin compromiso', en: 'Initial assessment, no obligation', pt: 'Diagnóstico inicial sem compromisso', fr: 'Diagnostic initial sans engagement' }, durationMinutes: 30, price: 0, currency: 'COP', category: 'consulta' },
            ],
        },
        arquitectos: {
            services: [
                { name: { es: 'Visita a obra', en: 'Site visit', pt: 'Visita à obra', fr: 'Visite de chantier' }, description: { es: 'Relevamiento en el lugar', en: 'On-site survey', pt: 'Levantamento no local', fr: 'Relevé sur place' }, durationMinutes: 90, price: 200000, currency: 'COP', category: 'relevamiento' },
                { name: { es: 'Anteproyecto', en: 'Preliminary design', pt: 'Anteprojeto', fr: 'Avant-projet' }, description: { es: 'Propuesta inicial de diseño', en: 'Initial design proposal', pt: 'Proposta inicial de projeto', fr: 'Proposition de conception initiale' }, durationMinutes: 60, price: 500000, currency: 'COP', category: 'diseno' },
                { name: { es: 'Primera reunión', en: 'First meeting', pt: 'Primeira reunião', fr: 'Premier rendez-vous' }, description: { es: 'Conversación inicial sobre el proyecto', en: 'Initial conversation about the project', pt: 'Conversa inicial sobre o projeto', fr: 'Premier échange sur le projet' }, durationMinutes: 45, price: 0, currency: 'COP', category: 'consulta' },
            ],
        },
        consultores: {
            services: [
                { name: { es: 'Diagnóstico inicial', en: 'Initial assessment', pt: 'Diagnóstico inicial', fr: 'Diagnostic initial' }, description: { es: 'Relevamiento de la situación actual', en: 'Review of the current situation', pt: 'Levantamento da situação atual', fr: 'Analyse de la situation actuelle' }, durationMinutes: 60, price: 0, currency: 'COP', category: 'consulta' },
                { name: { es: 'Sesión de consultoría', en: 'Consulting session', pt: 'Sessão de consultoria', fr: 'Séance de conseil' }, description: { es: 'Trabajo sobre un tema puntual', en: 'Work on a specific topic', pt: 'Trabalho sobre um tema específico', fr: 'Travail sur un sujet précis' }, durationMinutes: 90, price: 350000, currency: 'COP', category: 'consultoria' },
            ],
        },
        // `abogados` usa correctamente los servicios genéricos de la vertical.
    },
    technology: {
        // Desarrollo y consultoría no "demuestran" nada: relevan.
        desarrollo: {
            services: [
                { name: { es: 'Reunión de relevamiento', en: 'Requirements meeting', pt: 'Reunião de levantamento', fr: 'Réunion de cadrage' }, description: { es: 'Entender qué hay que construir', en: 'Understand what needs to be built', pt: 'Entender o que precisa ser construído', fr: 'Comprendre ce qui doit être construit' }, durationMinutes: 60, price: 0, currency: 'COP', category: 'discovery' },
            ],
        },
        consultoria_ti: {
            services: [
                { name: { es: 'Diagnóstico de infraestructura', en: 'Infrastructure assessment', pt: 'Diagnóstico de infraestrutura', fr: 'Audit d\'infrastructure' }, description: { es: 'Revisión del estado actual', en: 'Review of the current setup', pt: 'Revisão do estado atual', fr: 'Revue de l\'existant' }, durationMinutes: 60, price: 0, currency: 'COP', category: 'discovery' },
            ],
        },
    },
};

const DAY_OF_WEEK_INDEX = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
} as const;

type ScheduleDay = keyof typeof DAY_OF_WEEK_INDEX;

const ROUND_THE_CLOCK_SCHEDULE: Record<ScheduleDay, string> = {
    sun: '00:00-23:59',
    mon: '00:00-23:59',
    tue: '00:00-23:59',
    wed: '00:00-23:59',
    thu: '00:00-23:59',
    fri: '00:00-23:59',
    sat: '00:00-23:59',
};

function resolveSubtypeBootstrap(industry: string, subType?: string | null): SubtypeBootstrap | undefined {
    if (!subType) return undefined;
    return SUBTYPE_BOOTSTRAP_BY_INDUSTRY[industry]?.[subType];
}

@Injectable()
export class VerticalsService {
    private readonly logger = new Logger(VerticalsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly throttle: TenantThrottleService,
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
        const lockKey = `lock:vertical-provision:${tenantId}`;
        const lockTtlSeconds = 120;
        const lockToken = await this.redis.acquireLockToken(lockKey, lockTtlSeconds);
        if (!lockToken) {
            throw new ConflictException('El provisioning vertical ya está en ejecución para este tenant.');
        }
        const lease = new OwnedLockLease(
            this.redis,
            lockKey,
            lockToken,
            lockTtlSeconds,
            this.logger,
            `Vertical provisioning lock lost for tenant ${tenantId}`,
        );
        lease.start();
        const assertLockOwned = () => lease.assertOwned();

        let state: VerticalProvisioningState | null = null;
        try {
            this.logger.log(`Provisioning vertical "${industry}" (sub: ${subType || 'none'}) for tenant ${tenantId}`);
            const schemaName = await this.prisma.getTenantSchemaName(tenantId);
            const plan = await this.throttle.getTenantPlan(tenantId);
            const features = await this.throttle.getPlanFeatures(tenantId);
            const limits = {
                pipelineStages: assertQuotaValue(features.pipelineStages, 'pipelineStages'),
                appointmentServices: assertQuotaValue(features.appointmentsServices, 'appointmentsServices'),
            };
            const bootstrapMode = resolveSubtypeBootstrap(industry, subType);
            const agendaAllowed = definition.bookingEnabled && !bootstrapMode?.skipAgenda;
            const candidateServices = bootstrapMode?.services?.length
                ? bootstrapMode.services
                : definition.services;
            const quotaEligibleServices = agendaAllowed ? candidateServices : [];

            state = await this.initializeProvisioningState(
                tenantId, industry, subType, l, plan, limits, assertLockOwned,
            );

            let usage = await this.readQuotaUsage(schemaName);
            if (state.status === 'complete' && state.quotaPolicy) {
                try {
                    const selectedStages = definition.pipeline.stages.filter((stage) =>
                        state!.quotaPolicy!.selectedStageSlugs.includes(stage.slug));
                    const selectedServices = quotaEligibleServices.filter((_service, index) =>
                        state!.quotaPolicy!.selectedServiceIndexes.includes(index));
                    const effectiveBooking = agendaAllowed && (usage.serviceNames.length > 0 || selectedServices.length > 0);
                    state.invariants = await this.assertProvisioningInvariants(
                        tenantId, schemaName, definition, subType, l, state.quotaPolicy,
                        selectedStages, selectedServices, effectiveBooking,
                    );
                    await this.persistProvisioningState(tenantId, state, assertLockOwned);
                    this.logger.log(`Vertical provisioning already complete and verified for tenant ${tenantId}`);
                    return;
                } catch (error: any) {
                    this.logger.warn(`Completed vertical provisioning failed re-verification; rebuilding: ${error.message}`);
                    state.status = 'pending';
                    state.completedSteps = [];
                    delete state.completedAt;
                    delete state.invariants;
                    await this.persistProvisioningState(tenantId, state, assertLockOwned);
                }
            }

            await this.runProvisioningStep(tenantId, state, 'quota_plan', assertLockOwned, async () => {
                usage = await this.readQuotaUsage(schemaName);
                const selected = selectQuotaAwareVerticalDefaults(definition, quotaEligibleServices, limits, usage);
                state!.quotaPolicy = {
                    ...limits,
                    selectedStageSlugs: selected.pipelineStages.map((stage) => stage.slug),
                    selectedServiceIndexes: selected.services.map((service) => quotaEligibleServices.indexOf(service)),
                };
            });

            if (!state.quotaPolicy) throw new Error('Vertical quota plan was not persisted');
            const selectedStages = definition.pipeline.stages.filter((stage) =>
                state!.quotaPolicy!.selectedStageSlugs.includes(stage.slug));
            const selectedServices = quotaEligibleServices.filter((_service, index) =>
                state!.quotaPolicy!.selectedServiceIndexes.includes(index));
            usage = await this.readQuotaUsage(schemaName);
            const effectiveBooking = agendaAllowed && (usage.serviceNames.length > 0 || selectedServices.length > 0);

            await this.runProvisioningStep(tenantId, state, 'pipeline', assertLockOwned, () =>
                this.seedPipelineStages(
                    tenantId,
                    schemaName,
                    { ...definition, pipeline: { stages: selectedStages } },
                    l,
                ));
            await this.runProvisioningStep(tenantId, state, 'persona', assertLockOwned, () =>
                this.patchDefaultAgent(schemaName, definition, l));
            await this.runProvisioningStep(tenantId, state, 'knowledge', assertLockOwned, async () => {
                await this.seedFaqs(schemaName, definition, l);
                await this.enableSimpleTool(schemaName, 'faqs');
            });
            await this.runProvisioningStep(tenantId, state, 'agenda', assertLockOwned, async () => {
                if (selectedServices.length > 0) {
                    await this.seedServices(schemaName, { ...definition, services: selectedServices }, l);
                }
                if (effectiveBooking) {
                    await this.seedAvailability(tenantId, schemaName, definition, bootstrapMode?.roundTheClock);
                }
                await this.restoreAppointmentsTool(schemaName, effectiveBooking);
            });
            await this.runProvisioningStep(tenantId, state, 'vertical_tools', assertLockOwned, () =>
                this.seedVerticalTools(tenantId, schemaName, industry, subType, l, bootstrapMode));
            await this.runProvisioningStep(tenantId, state, 'config', assertLockOwned, () =>
                this.persistResolvedVerticalConfig(
                    tenantId,
                    {
                        industry,
                        subType,
                        terminology: definition.terminology,
                        sidebar: definition.sidebar,
                        dashboard: definition.dashboard,
                        bookingEnabled: effectiveBooking,
                    },
                    assertLockOwned,
                ));
            await this.runProvisioningStep(tenantId, state, 'cache', assertLockOwned, () =>
                this.invalidateRuntimeCaches(tenantId));
            await this.runProvisioningStep(tenantId, state, 'invariants', assertLockOwned, async () => {
                state!.invariants = await this.assertProvisioningInvariants(
                    tenantId, schemaName, definition, subType, l, state!.quotaPolicy!,
                    selectedStages, selectedServices, effectiveBooking,
                );
            });

            state.status = 'complete';
            state.completedAt = new Date().toISOString();
            state.updatedAt = state.completedAt;
            delete state.failure;
            await this.persistProvisioningState(tenantId, state, assertLockOwned);
            this.logger.log(
                `Vertical provisioning complete for tenant ${tenantId}: ` +
                `${selectedStages.length}/${limits.pipelineStages} stages, ` +
                `${selectedServices.length}/${limits.appointmentServices} services`,
            );
        } catch (error: any) {
            if (error instanceof LockOwnershipLostError || lease.hasLostOwnership()) {
                throw new ConflictException({
                    error: 'vertical_provisioning_lock_lost',
                    message: 'El alta vertical perdió su lock; ningún paso posterior fue confirmado.',
                    tenantId,
                });
            }
            if (state && state.status !== 'failed') {
                const step = state.currentStep || 'invariants';
                state.status = 'failed';
                state.failure = { step, message: error?.message || String(error), at: new Date().toISOString() };
                state.updatedAt = state.failure.at;
                try {
                    await this.persistProvisioningState(tenantId, state, assertLockOwned);
                } catch (persistError: any) {
                    this.logger.error(`Could not persist failed provisioning state: ${persistError.message}`);
                }
            }
            throw error;
        } finally {
            lease.stop();
            await this.redis.releaseLockToken(lockKey, lockToken)
                .catch((error: any) => this.logger.warn(`Could not release vertical provisioning lock: ${error.message}`));
        }
    }

    /**
     * El estado vive en `public.tenants.settings.verticalProvisioning`: evita
     * una migración global, está disponible incluso si el schema tenant quedó
     * a medio crear y puede evolucionar mediante `version`.
     */
    private async initializeProvisioningState(
        tenantId: string,
        industry: string,
        subType: string | null,
        language: string,
        plan: string,
        limits: { pipelineStages: number; appointmentServices: number },
        assertLockOwned: () => Promise<void>,
    ): Promise<VerticalProvisioningState> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) throw new Error(`Tenant ${tenantId} not found while provisioning vertical`);
        const existing = ((tenant.settings as any) || {}).verticalProvisioning as VerticalProvisioningState | undefined;
        const sameIdentity = existing
            && existing.version === VERTICAL_PROVISIONING_VERSION
            && existing.industry === industry
            && existing.subType === subType
            && existing.language === language
            && existing.plan === plan
            && (!existing.quotaPolicy
                || (existing.quotaPolicy.pipelineStages === limits.pipelineStages
                    && existing.quotaPolicy.appointmentServices === limits.appointmentServices));
        const now = new Date().toISOString();
        const resetAfterInvariantFailure = sameIdentity
            && existing?.status === 'failed'
            && existing.failure?.step === 'invariants';
        const state: VerticalProvisioningState = sameIdentity
            ? {
                ...existing,
                status: existing.status === 'complete' ? 'complete' : 'pending',
                attempt: (existing.attempt || 0) + 1,
                updatedAt: now,
                currentStep: undefined,
                failure: existing.status === 'complete' ? undefined : existing.failure,
                // Una invariante es la verificación transversal de todos los pasos.
                // Si falla, no sabemos cuál no produjo su efecto (p. ej. el alta
                // del agente pudo haber tragado un INSERT fallido). Reejecutar los
                // pasos idempotentes es la reparación segura; conservarlos como
                // completos dejaría el retry fallando para siempre.
                completedSteps: resetAfterInvariantFailure ? [] : existing.completedSteps,
            }
            : {
                version: VERTICAL_PROVISIONING_VERSION,
                status: 'pending',
                industry,
                subType,
                language,
                plan,
                attempt: 1,
                startedAt: now,
                updatedAt: now,
                completedSteps: [],
            };
        await this.persistProvisioningState(tenantId, state, assertLockOwned);
        return state;
    }

    private async persistProvisioningState(
        tenantId: string,
        state: VerticalProvisioningState,
        assertLockOwned: () => Promise<void>,
    ): Promise<void> {
        await assertLockOwned();
        await mergeTenantSettingsAtomic(this.prisma, tenantId, {
            verticalProvisioning: state,
        });
    }

    private async runProvisioningStep(
        tenantId: string,
        state: VerticalProvisioningState,
        step: VerticalProvisioningStep,
        assertLockOwned: () => Promise<void>,
        run: () => Promise<void>,
    ): Promise<void> {
        if (state.completedSteps.includes(step)) return;
        state.status = 'pending';
        state.currentStep = step;
        state.updatedAt = new Date().toISOString();
        delete state.failure;
        await this.persistProvisioningState(tenantId, state, assertLockOwned);
        try {
            await assertLockOwned();
            await run();
            await assertLockOwned();
            state.completedSteps = [...state.completedSteps, step];
            state.currentStep = undefined;
            state.updatedAt = new Date().toISOString();
            await this.persistProvisioningState(tenantId, state, assertLockOwned);
        } catch (error: any) {
            if (error instanceof LockOwnershipLostError) throw error;
            const at = new Date().toISOString();
            state.status = 'failed';
            state.currentStep = undefined;
            state.updatedAt = at;
            state.failure = { step, message: error?.message || String(error), at };
            try {
                await this.persistProvisioningState(tenantId, state, assertLockOwned);
            } catch (persistError: any) {
                this.logger.error(`Could not persist failed provisioning step ${step}: ${persistError.message}`);
            }
            throw error;
        }
    }

    private async readQuotaUsage(
        schemaName: string,
    ): Promise<{ stageSlugs: string[]; serviceNames: string[] }> {
        const [stages, services] = await Promise.all([
            this.prisma.executeInTenantSchema<Array<{ slug: string }>>(
                schemaName,
                `SELECT slug FROM pipeline_stages`,
            ),
            this.prisma.executeInTenantSchema<Array<{ name: string }>>(
                schemaName,
                `SELECT name FROM services WHERE is_active = true`,
            ),
        ]);
        return {
            stageSlugs: stages.map((row) => row.slug),
            serviceNames: services.map((row) => row.name),
        };
    }

    private async persistResolvedVerticalConfig(
        tenantId: string,
        config: TenantVerticalConfig,
        assertLockOwned: () => Promise<void>,
    ): Promise<void> {
        await assertLockOwned();
        await mergeTenantSettingsAtomic(this.prisma, tenantId, {
            verticalConfig: config,
            subType: config.subType,
        });
    }

    private async seedVerticalTools(
        tenantId: string,
        schemaName: string,
        industry: string,
        subType: string | null,
        lang: string,
        bootstrapMode?: SubtypeBootstrap,
    ): Promise<void> {
        for (const tool of bootstrapMode?.extraTools || []) {
            await this.enableSimpleTool(schemaName, tool);
        }
        if (industry === 'turismo' && (subType === 'tours' || subType === 'agencia_viajes')) {
            await this.seedToursExtras(tenantId, schemaName, lang);
            await this.enableSimpleTool(schemaName, 'tours');
        }
        if (industry === 'turismo' && (subType === 'hotel' || subType === 'alquiler_vacacional')) {
            await this.enableSimpleTool(schemaName, 'properties');
        }
        if (industry === 'salud' && subType === 'dental') {
            await this.seedDentalExtras(tenantId, schemaName, lang);
            await this.enableSimpleTool(schemaName, 'treatments');
        }
        if (industry === 'inmobiliaria') {
            await this.seedInmobiliariaExtras(tenantId, schemaName, lang);
            await this.enableSimpleTool(schemaName, 'realEstate');
        }

        const toolsByIndustry: Record<string, string[]> = {
            veterinaria: ['pets'],
            restaurantes: ['restaurants'],
            gimnasios: ['gyms'],
            education: ['education'],
            seguros: ['insurance'],
            servicios_hogar: ['homeServices'],
            pet_services: ['petServices', 'pets'],
            fotografia: ['photography'],
            servicios_profesionales: ['professionalServices'],
            retail: ['catalog'],
            otro: ['catalog'],
            automotriz: ['vehicles'],
        };
        for (const tool of toolsByIndustry[industry] || []) {
            await this.enableSimpleTool(schemaName, tool);
        }
        if (industry === 'gimnasios') {
            await this.seedMembershipPlans(schemaName, lang);
        }
    }

    private requiredTools(
        industry: string,
        subType: string | null,
        effectiveBooking: boolean,
        bootstrapMode?: SubtypeBootstrap,
    ): string[] {
        const required = new Set<string>(['faqs', ...(bootstrapMode?.extraTools || [])]);
        if (effectiveBooking) required.add('appointments');
        if (industry === 'turismo' && (subType === 'tours' || subType === 'agencia_viajes')) required.add('tours');
        if (industry === 'turismo' && (subType === 'hotel' || subType === 'alquiler_vacacional')) required.add('properties');
        if (industry === 'salud' && subType === 'dental') required.add('treatments');
        if (industry === 'inmobiliaria') required.add('realEstate');
        const toolsByIndustry: Record<string, string[]> = {
            veterinaria: ['pets'], restaurantes: ['restaurants'], gimnasios: ['gyms'],
            education: ['education'], seguros: ['insurance'], servicios_hogar: ['homeServices'],
            pet_services: ['petServices', 'pets'], fotografia: ['photography'],
            servicios_profesionales: ['professionalServices'], retail: ['catalog'], otro: ['catalog'],
            automotriz: ['vehicles'],
        };
        for (const tool of toolsByIndustry[industry] || []) required.add(tool);
        return [...required];
    }

    private async assertProvisioningInvariants(
        tenantId: string,
        schemaName: string,
        definition: VerticalDefinition,
        subType: string | null,
        lang: string,
        quota: VerticalProvisioningQuotaPolicy,
        selectedStages: VerticalStageDefinition[],
        selectedServices: VerticalServiceDefinition[],
        effectiveBooking: boolean,
    ): Promise<VerticalProvisioningInvariants> {
        const [stageRows, serviceRows, countsRows, faqRows, agents, tenant] = await Promise.all([
            this.prisma.executeInTenantSchema<Array<{ slug: string; terminal_outcome: string | null }>>(
                schemaName,
                `SELECT slug, terminal_outcome FROM pipeline_stages`,
            ),
            this.prisma.executeInTenantSchema<Array<{ name: string }>>(
                schemaName,
                `SELECT name FROM services WHERE is_active = true`,
            ),
            this.prisma.executeInTenantSchema<Array<{ slots: number; faqs: number }>>(
                schemaName,
                `SELECT
                    (SELECT COUNT(*)::int FROM availability_slots WHERE is_active = true) AS slots,
                    (SELECT COUNT(*)::int FROM faqs WHERE is_published = true) AS faqs`,
            ),
            this.prisma.executeInTenantSchema<Array<{ question: string }>>(
                schemaName,
                `SELECT question FROM faqs WHERE is_published = true`,
            ),
            this.prisma.executeInTenantSchema<Array<{ config_json: any }>>(
                schemaName,
                `SELECT config_json FROM agent_personas WHERE is_active = true`,
            ),
            this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
        ]);
        const stageCount = stageRows.length;
        const serviceCount = serviceRows.length;
        if (quota.pipelineStages !== -1 && stageCount > quota.pipelineStages) {
            throw new Error(`Invariant failed: ${stageCount} pipeline stages exceed quota ${quota.pipelineStages}`);
        }
        if (quota.appointmentServices !== -1 && serviceCount > quota.appointmentServices) {
            throw new Error(`Invariant failed: ${serviceCount} appointment services exceed quota ${quota.appointmentServices}`);
        }
        const actualStageBySlug = new Map(stageRows.map((row) => [row.slug, row]));
        for (const stage of selectedStages) {
            const actual = actualStageBySlug.get(stage.slug);
            if (!actual) throw new Error(`Invariant failed: missing pipeline stage "${stage.slug}"`);
            const expectedOutcome = stage.isTerminal ? stage.terminalOutcome : null;
            if (actual.terminal_outcome !== expectedOutcome) {
                throw new Error(`Invariant failed: stage "${stage.slug}" has terminal outcome ${actual.terminal_outcome}`);
            }
        }
        const actualServiceNames = new Set(serviceRows.map((row) => row.name));
        for (const service of selectedServices) {
            const expectedName = service.name[lang] || service.name.es;
            if (!actualServiceNames.has(expectedName)) {
                throw new Error(`Invariant failed: missing appointment service "${expectedName}"`);
            }
        }
        const counts = countsRows[0] || { slots: 0, faqs: 0 };
        const slots = Number(counts.slots || 0);
        const faqs = Number(counts.faqs || 0);
        if (faqs < definition.faqs.length) {
            throw new Error(`Invariant failed: only ${faqs}/${definition.faqs.length} vertical FAQs are published`);
        }
        const actualFaqQuestions = new Set(faqRows.map((row) => row.question));
        for (const faq of definition.faqs) {
            const expectedQuestion = faq.question[lang] || faq.question.es;
            if (!actualFaqQuestions.has(expectedQuestion)) {
                throw new Error(`Invariant failed: missing vertical FAQ "${expectedQuestion}"`);
            }
        }
        if (agents.length === 0) throw new Error('Invariant failed: no active agent persona exists');
        if (effectiveBooking && (serviceCount === 0 || slots === 0)) {
            throw new Error(`Invariant failed: booking requires services and slots (services=${serviceCount}, slots=${slots})`);
        }
        const bootstrapMode = resolveSubtypeBootstrap(definition.industry, subType);
        const requiredTools = this.requiredTools(definition.industry, subType, effectiveBooking, bootstrapMode);
        for (const [index, agent] of agents.entries()) {
            const agentTools = agent.config_json?.tools || {};
            for (const tool of requiredTools) {
                if (agentTools[tool]?.enabled !== true) {
                    if (tool === 'appointments') {
                        const appointmentsConfig = agentTools.appointments;
                        const isExplicitlyDisabled =
                            appointmentsConfig?.enabled === false && appointmentsConfig?.pendingPrerequisites !== true;
                        const hasOtherDomainTool = Object.keys(agentTools).some(
                            (t) => t !== 'appointments' && t !== 'faqs' && t !== 'crm' && t !== 'knowledge' && agentTools[t]?.enabled === true,
                        );
                        if (isExplicitlyDisabled || hasOtherDomainTool) {
                            continue;
                        }
                    }
                    throw new Error(`Invariant failed: active agent ${index + 1} is missing enabled tool "${tool}"`);
                }
            }
        }
        const config = ((tenant?.settings as any) || {}).verticalConfig as TenantVerticalConfig | undefined;
        if (!config || config.industry !== definition.industry || config.subType !== subType || config.bookingEnabled !== effectiveBooking) {
            throw new Error('Invariant failed: persisted verticalConfig does not match resolved provisioning');
        }
        return {
            pipelineStages: stageCount,
            appointmentServices: serviceCount,
            availabilitySlots: slots,
            publishedFaqs: faqs,
            activeAgents: agents.length,
            requiredTools,
        };
    }

    /**
     * Get the vertical config for a tenant (dashboard consumption).
     * Cached in Redis for 10 minutes.
     */
    /**
     * Re-siembra SOLO el contenido de la vertical (FAQs y servicios) para un
     * tenant que ya existe.
     *
     * El bootstrap corre una única vez, al crear el tenant, así que cada FAQ o
     * servicio que se agrega después a `vertical-definitions.ts` no le llega a
     * nadie de los que ya están adentro: el contenido nuevo solo beneficia a
     * los tenants futuros. Esto lo destraba sin pedirle al dueño que copie y
     * pegue nada.
     *
     * Deliberadamente NO toca etapas del embudo, persona del agente,
     * disponibilidad ni flags de herramienta. Esos seeds son de reemplazo y
     * volver a correrlos pisaría lo que el tenant configuró a mano — que es
     * exactamente el bug que el setup wizard tenía y ya se arregló. FAQs y
     * servicios, en cambio, insertan con ON CONFLICT DO NOTHING: solo pueden
     * AGREGAR lo que falta, nunca sobrescribir ni borrar.
     */
    async reseedVerticalContent(
        tenantId: string,
        lang = 'es',
    ): Promise<{ industry: string; faqs: number; services: number }> {
        const config = await this.getVerticalConfig(tenantId);
        const industry = config?.industry;
        if (!industry) {
            throw new BadRequestException('El tenant no tiene una industria configurada.');
        }

        const definition = getVerticalDefinition(industry);
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        await this.seedFaqs(schemaName, definition, lang);

        // El mismo criterio del bootstrap: un sub-tipo que no agenda no recibe
        // servicios, o le volveríamos a llenar la agenda de cosas que no hace.
        const bootstrapMode = resolveSubtypeBootstrap(industry, config?.subType);
        const seedsAgenda = definition.bookingEnabled && !bootstrapMode?.skipAgenda;
        const candidateServices = bootstrapMode?.services?.length
            ? bootstrapMode.services
            : definition.services;
        const features = await this.throttle.getPlanFeatures(tenantId);
        const limits = {
            pipelineStages: assertQuotaValue(features.pipelineStages, 'pipelineStages'),
            appointmentServices: assertQuotaValue(features.appointmentsServices, 'appointmentsServices'),
        };
        const usage = await this.readQuotaUsage(schemaName);
        const quotaDefaults = selectQuotaAwareVerticalDefaults(
            definition,
            seedsAgenda ? candidateServices : [],
            limits,
            usage,
        );
        const servicesToSeed = quotaDefaults.services;
        if (seedsAgenda && servicesToSeed.length > 0) {
            await this.seedServices(schemaName, { ...definition, services: servicesToSeed }, lang);
        }

        this.logger.log(`Reseeded vertical content for tenant ${tenantId} (${industry})`);
        return {
            industry,
            faqs: definition.faqs.length,
            services: servicesToSeed.length,
        };
    }

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
                await mergeTenantSettingsAtomic(this.prisma, tenantId, {
                    verticalConfig: config,
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
                const terminalOutcome = stage.isTerminal ? stage.terminalOutcome : null;
                // El target tiene que ser el índice real: `uidx_pipeline_stages_pipeline_slug`
                // es (pipeline_id, slug) NULLS NOT DISTINCT — no (slug) a secas — porque un
                // segundo embudo reutiliza legítimamente los mismos slugs. El bootstrap
                // inserta con pipeline_id NULL, y ahí el índice sí muerde.
                await this.prisma.$queryRawUnsafe(
                    `INSERT INTO "${schemaName}"."pipeline_stages"
                     (tenant_id, name, slug, color, position, default_probability, sla_hours, is_terminal, terminal_outcome, transition_rules)
                     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
                     ON CONFLICT (pipeline_id, slug) DO UPDATE
                     SET is_terminal = EXCLUDED.is_terminal,
                         terminal_outcome = EXCLUDED.terminal_outcome`,
                     tenantId, name, stage.slug, stage.color, i, stage.probability, stage.slaHours || null, stage.isTerminal,
                     terminalOutcome, JSON.stringify((stage as any).transitionRules || []),
                );
            }
            this.logger.debug(`Seeded ${definition.pipeline.stages.length} pipeline stages`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed pipeline stages: ${error.message}`);
            throw error;
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
     * Excepción deliberada: `forbiddenTopics`, `handoffTriggers` y `rules` se
     * UNEN en vez de rellenarse. Los dos primeros son restricciones aditivas
     * —prohibir de más nunca hace que el bot afirme algo falso, y escalar de
     * más termina en un humano—, así que los límites propios de la industria
     * entran igual aunque la plantilla ya traiga su propia lista. `rules` se
     * suma por otro motivo: son las que le explican al agente cuándo usar las
     * herramientas de su industria, y sin ellas las tools quedan cargadas pero
     * des-instruidas.
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
            if (!agents || agents.length === 0) {
                throw new Error('No default agent persona exists to patch');
            }

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
                //
                // Se UNEN, no se rellenan. Antes, una plantilla que ya traía sus
                // propias reglas dejaba fuera las del registry — y las del
                // registry son justamente las que instruyen las herramientas de
                // la industria (las 6 de gimnasios, las de seguros, las de
                // education). El agente quedaba con las tools cargadas y sin
                // nadie que le explicara cuándo usarlas: sólo la descripción del
                // JSON de cada tool. Afectaba a las 18 verticales.
                //
                // Orden deliberado: primero las de la industria, después las que
                // ya estaban. Lo específico del tenant —sea de la plantilla o
                // editado a mano por el dueño— conserva la última palabra, que
                // es la que más pesa cuando el prompt se ensambla.
                rules: this.mergeStringList(
                    this.splitDefinitionRules(pick(agentDef.rules)),
                    existingRules,
                ),
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
            throw error;
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
            throw error;
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
                     (name, description, duration_minutes, price, currency, category, is_active, sort_order, duration_type)
                     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
                     ON CONFLICT (name) DO NOTHING`,
                    name, description, svc.durationMinutes, svc.price, svc.currency, svc.category, i,
                    // 'open' = disponibilidad por DÍA (checkAvailabilityOpen), para
                    // servicios que no caben en la ventana diaria de slots: un
                    // "Hotel — noche" de 1440 min con slots de 08:00-18:00 daba
                    // "no hay disponibilidad" para siempre, en bucle.
                    svc.durationType || 'fixed',
                );
            }
            this.logger.debug(`Seeded ${definition.services.length} services`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed services: ${error.message}`);
            throw error;
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
        roundTheClock = false,
    ): Promise<void> {
        try {
            // Guardia 24h: la grilla semanal de la industria (9 a 18, sábado
            // medio día) es exactamente al revés de lo que necesita una urgencia.
            const schedule = roundTheClock
                ? ROUND_THE_CLOCK_SCHEDULE
                : (definition.businessHours?.schedule || {});
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
            const toMinutes = (hhmm: string): number => {
                const [h, m] = hhmm.split(':').map(Number);
                return h * 60 + m;
            };

            let inserted = 0;
            for (const [day, range] of days) {
                const dow = DAY_OF_WEEK_INDEX[day.toLowerCase() as ScheduleDay];
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
            throw error;
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
            throw error;
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
            throw error;
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
            throw error;
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
            throw error;
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
            // TODOS los agentes activos, no solo el default. Con multi-canal (un
            // agente por conexión) el segundo agente nacía mudo: el tenant conectaba
            // Instagram, le asignaba un agente y ese agente no tenía las tools de su
            // propia industria. La capacidad es del NEGOCIO, no de un agente.
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_active = true`,
            );
            if (!agents?.length) return;

            for (const agent of agents) {
                const config = agent.config_json || {};
                const tools = { ...(config.tools || {}) };
                // Si el dueño ya la apagó a propósito en ESTE agente, se respeta:
                // solo se enciende lo que no tiene decisión previa explícita.
                if (tools[toolKey] && tools[toolKey].enabled === false) continue;
                tools[toolKey] = { ...(tools[toolKey] || {}), enabled: true };
                const newConfig = { ...config, tools };
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                    [JSON.stringify(newConfig), agent.id],
                );
            }
            this.logger.debug(`Enabled ${toolKey} tool on ${agents.length} active agent(s)`);
        } catch (error: any) {
            this.logger.warn(`Failed to enable ${toolKey} tool: ${error.message}`);
            throw error;
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
    private async restoreAppointmentsTool(schemaName: string, effectiveBooking: boolean): Promise<void> {
        try {
            // TODOS los agentes activos, por lo mismo que enableSimpleTool: con un
            // agente por conexión, el segundo nacía sin agendador porque este
            // método solo miraba al default. Poder agendar es del NEGOCIO.
            const agents = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, config_json FROM agent_personas WHERE is_active = true`,
            );
            if (!agents?.length) return;

            // Los contadores son del tenant, no del agente: se leen una sola vez.
            let counted: { services: number; slots: number } | null = null;

            for (const agent of agents) {
                const config = agent.config_json || {};
                const appointments = config.tools?.appointments;
                if (!appointments || appointments.pendingPrerequisites !== true) continue;

                if (!counted) {
                    // Mismos dos contadores que exige `assertAppointmentsPrerequisites`.
                    const [counts] = await this.prisma.executeInTenantSchema<any[]>(
                        schemaName,
                        `SELECT
                            (SELECT COUNT(*)::int FROM services WHERE is_active = true) AS services,
                            (SELECT COUNT(*)::int FROM availability_slots WHERE is_active = true) AS slots`,
                    );
                    counted = { services: Number(counts?.services || 0), slots: Number(counts?.slots || 0) };
                }

                const restored = {
                    ...appointments,
                    enabled: effectiveBooking && counted.services > 0 && counted.slots > 0,
                };
                delete restored.pendingPrerequisites;

                const newConfig = { ...config, tools: { ...config.tools, appointments: restored } };
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `UPDATE agent_personas SET config_json = $1::jsonb WHERE id = $2::uuid`,
                    [JSON.stringify(newConfig), agent.id],
                );

                if (restored.enabled) {
                    this.logger.debug(`Re-enabled appointments tool on agent ${agent.id} (services=${counted.services}, slots=${counted.slots})`);
                } else {
                    this.logger.warn(
                        `Appointments tool left OFF after vertical bootstrap on agent ${agent.id} (services=${counted.services}, slots=${counted.slots}) — the tenant must finish setting up the agenda`,
                    );
                }
            }
        } catch (error: any) {
            this.logger.warn(`Failed to restore appointments tool: ${error.message}`);
            throw error;
        }
    }

    /**
     * Siembra los planes de membresía del gimnasio.
     *
     * `get_membership_plans` es la primera tool que usa cualquier interesado
     * ("¿cuánto sale?") y devolvía una lista vacía en todo tenant nuevo: la
     * tabla `membership_plans` no la escribía el bootstrap y el dueño tenía que
     * descubrir /admin/memberships por su cuenta antes de que el bot pudiera
     * responder el precio. La conversación más frecuente del rubro moría en la
     * primera pregunta.
     *
     * Tres planes porque es el patrón real del rubro (mensual / trimestral /
     * anual con descuento) y porque un solo plan no deja al agente comparar,
     * que es donde vende. Los precios son un punto de partida COP editable, no
     * una recomendación: lo importante es que el dueño encuentre filas hechas y
     * las ajuste, en vez de una tabla vacía.
     */
    private async seedMembershipPlans(schemaName: string, lang: string): Promise<void> {
        try {
            const existing = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT COUNT(*)::int AS cnt FROM membership_plans`,
            );
            if (Number(existing?.[0]?.cnt || 0) > 0) {
                this.logger.debug('Membership plans already seeded — skipping');
                return;
            }

            const L = (loc: Record<string, string>) => loc[lang] || loc.es;
            const PLANS = [
                {
                    name: { es: 'Mensual', en: 'Monthly', pt: 'Mensal', fr: 'Mensuel' },
                    description: {
                        es: 'Acceso ilimitado al gimnasio + 8 clases grupales al mes',
                        en: 'Unlimited gym access + 8 group classes per month',
                        pt: 'Acesso ilimitado + 8 aulas em grupo por mês',
                        fr: 'Accès illimité + 8 cours collectifs par mois',
                    },
                    durationDays: 30, price: 150000, credits: 8, pt: 0, guests: 1, freeze: 0, order: 1,
                },
                {
                    name: { es: 'Trimestral', en: 'Quarterly', pt: 'Trimestral', fr: 'Trimestriel' },
                    description: {
                        es: 'Tres meses con clases ilimitadas y 15 días de congelamiento',
                        en: 'Three months with unlimited classes and 15 freeze days',
                        pt: 'Três meses com aulas ilimitadas e 15 dias de congelamento',
                        fr: 'Trois mois avec cours illimités et 15 jours de gel',
                    },
                    // class_credits_per_period NULL = ilimitado (así lo lee bookClass).
                    durationDays: 90, price: 390000, credits: null, pt: 1, guests: 3, freeze: 15, order: 2,
                },
                {
                    name: { es: 'Anual', en: 'Annual', pt: 'Anual', fr: 'Annuel' },
                    description: {
                        es: 'Un año con clases ilimitadas, 4 sesiones de entrenamiento personal y 30 días de congelamiento',
                        en: 'One year with unlimited classes, 4 personal training sessions and 30 freeze days',
                        pt: 'Um ano com aulas ilimitadas, 4 sessões de personal e 30 dias de congelamento',
                        fr: 'Un an avec cours illimités, 4 séances de coaching et 30 jours de gel',
                    },
                    durationDays: 365, price: 1320000, credits: null, pt: 4, guests: 10, freeze: 30, order: 3,
                },
            ];

            for (const p of PLANS) {
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `INSERT INTO membership_plans
                        (name, description, duration_days, price, currency,
                         class_credits_per_period, personal_training_credits,
                         guest_passes, freeze_allowance_days, sort_order)
                     VALUES ($1, $2, $3, $4, 'COP', $5, $6, $7, $8, $9)`,
                    [L(p.name), L(p.description), p.durationDays, p.price,
                        p.credits, p.pt, p.guests, p.freeze, p.order],
                );
            }
            this.logger.debug(`Seeded ${PLANS.length} membership plans`);
        } catch (error: any) {
            this.logger.warn(`Failed to seed membership plans: ${error.message}`);
            throw error;
        }
    }

}
