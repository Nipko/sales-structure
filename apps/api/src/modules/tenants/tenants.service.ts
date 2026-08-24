import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import {
    InvalidVerticalSelectionError,
    resolveVerticalSelection,
} from '../verticals/vertical-identifiers';
import { VerticalsService } from '../verticals/verticals.service';
import { PersonaService } from '../persona/persona.service';
import { BusinessInfoService } from '../business-info/business-info.service';
import { InvitationsService } from '../invitations/invitations.service';
import { validateEmailDomain } from '../../common/utils/email.util';
import { LockOwnershipLostError, OwnedLockLease } from '../../common/utils/owned-lock.util';
import {
    mergeTenantSettingsAtomic,
    firstReservedTenantSetting,
    firstUnsupportedGenericTenantSetting,
    redactReservedTenantSettings,
    redactReservedTenantSettingsFromRecord,
} from '../../common/utils/tenant-settings.util';
import type { ServiceExecutionContext } from '../../common/types/execution-context';
import { persistenceDisabled } from '../../common/types/execution-context';
import {
    TENANT_LIFECYCLE_LOCK_TTL_SECONDS,
    tenantLifecycleLockKey,
    tenantPurgingFenceKey,
} from '../../common/utils/tenant-lifecycle.util';
import { TenantDetailResponseDto } from './dto/tenant-detail-response.dto';
import { diagnoseTenantStall } from './tenant-stall-diagnosis.util';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../quality/agent-quality-events';

export const TENANT_PLAN_SLUGS = ['emprendedor', 'starter', 'pro', 'enterprise', 'custom'] as const;
export type TenantPlanSlug = typeof TENANT_PLAN_SLUGS[number];
export const TENANT_LANGUAGE_TAGS = ['es-CO', 'es-MX', 'es-ES', 'en-US', 'pt-BR', 'fr-FR'] as const;

type TenantProvisioningStage = 'owner' | 'schema' | 'agent' | 'businessInfo' | 'vertical' | 'invitation' | 'activation';

interface TenantProvisioningState {
    version: 3;
    source: 'super_admin';
    status: 'pending' | 'failed' | 'complete';
    selection: {
        industry: string;
        subType: string | null;
        plan: TenantPlanSlug;
        ownerEmail: string;
        isInternal: boolean;
    };
    stages: Record<TenantProvisioningStage, boolean>;
    currentStage?: TenantProvisioningStage;
    error?: string;
    startedAt: string;
    updatedAt: string;
    completedAt?: string;
}

export interface TenantReadPrincipal {
    role: string;
    tenantId?: string | null;
}

interface TenantDetailCacheEntry {
    version: typeof TENANT_DETAIL_CACHE_VERSION;
    data: TenantDetailResponseDto;
}

const TENANT_DETAIL_CACHE_VERSION = 2 as const;
const tenantDetailCacheKey = (tenantId: string) => `tenant:${tenantId}:detail-safe:v${TENANT_DETAIL_CACHE_VERSION}`;
const legacyTenantConfigCacheKey = (tenantId: string) => `tenant:${tenantId}:config`;

@Injectable()
export class TenantsService {
    private readonly logger = new Logger(TenantsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private throttle: TenantThrottleService,
        @Inject(forwardRef(() => PersonaService)) private personaService: PersonaService,
        @Inject(forwardRef(() => BusinessInfoService)) private businessInfoService: BusinessInfoService,
        private verticalsService: VerticalsService,
        private invitationsService: InvitationsService,
        @InjectQueue('outbound-messages') private outboundQueue: Queue,
        @InjectQueue('broadcast-messages') private broadcastQueue: Queue,
        @InjectQueue('automation-jobs') private automationQueue: Queue,
        @InjectQueue('nurturing') private nurturingQueue: Queue,
        @InjectQueue('conversation-snooze') private snoozeQueue: Queue,
        @Optional() private readonly events?: EventEmitter2,
    ) { }

    /**
     * Create a new tenant with its isolated database schema
     */
    async create(data: {
        name: string;
        slug: string;
        industry: string;
        subType?: string | null;
        language?: string;
        plan?: string;
        isInternal?: boolean;
        ownerEmail: string;
        ownerFirstName: string;
        ownerLastName?: string;
    }, actorUserId?: string) {
        const name = data.name?.trim();
        const slug = (data.slug || '').trim().toLowerCase();
        const language = data.language || 'es-CO';
        const plan = (data.plan || 'emprendedor') as TenantPlanSlug;
        const isInternal = data.isInternal === true;
        const ownerEmail = (data.ownerEmail || '').trim().toLowerCase();
        const ownerFirstName = (data.ownerFirstName || '').trim();
        const ownerLastName = (data.ownerLastName || '').trim();

        if (!name) throw new BadRequestException('El nombre del tenant es obligatorio');
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 50) {
            throw new BadRequestException('El slug debe usar solo minúsculas, números y guiones');
        }
        if (!TENANT_PLAN_SLUGS.includes(plan)) {
            throw new BadRequestException({
                error: 'invalid_tenant_plan',
                message: `El plan "${plan}" no está soportado`,
                allowedPlans: TENANT_PLAN_SLUGS,
            });
        }
        if (!(TENANT_LANGUAGE_TAGS as readonly string[]).includes(language)) {
            throw new BadRequestException({
                error: 'invalid_tenant_language',
                message: `El idioma "${language}" no está soportado`,
                allowedLanguages: TENANT_LANGUAGE_TAGS,
            });
        }
        if (!ownerFirstName) {
            throw new BadRequestException('El nombre del propietario es obligatorio');
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
            throw new BadRequestException({ error: 'invalid_owner_email', message: 'El correo del propietario no es válido' });
        }
        validateEmailDomain(ownerEmail);

        let selection;
        try {
            // Alta hecha por un super_admin: además de lo ofrecido, puede
            // poner al tenant en un piloto. Un perfil cerrado sigue cerrado.
            selection = resolveVerticalSelection(data.industry, data.subType, 'admin_create');
        } catch (error) {
            if (error instanceof InvalidVerticalSelectionError) {
                throw new BadRequestException({
                    error: 'invalid_vertical_selection',
                    message: error.message,
                    industry: error.industry,
                    subType: error.subType,
                });
            }
            throw error;
        }
        const { industry, subType } = selection;
        // The slug is the only stable identity available before the tenant row
        // exists. Lock it before the first INSERT so two API instances cannot
        // both create/claim resources for the same administrative request.
        const lockKey = `lock:tenant-provision:slug:${slug}`;
        const lockTtlSeconds = 120;
        const lockToken = await this.redis.acquireLockToken(lockKey, lockTtlSeconds);
        if (!lockToken) {
            throw new ConflictException({
                error: 'tenant_provisioning_in_progress',
                message: 'El alta de este tenant ya está en ejecución',
                slug,
            });
        }
        const lease = new OwnedLockLease(
            this.redis,
            lockKey,
            lockToken,
            lockTtlSeconds,
            this.logger,
            `Administrative tenant provisioning lock lost for slug ${slug}`,
        );
        lease.start();
        let lifecycleLease: OwnedLockLease | null = null;
        let lifecycleToken: string | null = null;
        let lifecycleTenantId: string | null = null;
        const assertLockOwned = async () => {
            await lease.assertOwned();
            if (lifecycleLease) await lifecycleLease.assertOwned();
        };

        try {
        await assertLockOwned();
        const requestedSchemaName = `tenant_${slug.replace(/-/g, '_')}`;
        const now = new Date().toISOString();

        let tenant = await this.prisma.tenant.findUnique({ where: { slug } });
        let schemaName = tenant?.schemaName || requestedSchemaName;
        const resolvedLifecycleTenantId = tenant?.id || randomUUID();
        lifecycleTenantId = resolvedLifecycleTenantId;
        const lifecycleKey = tenantLifecycleLockKey(resolvedLifecycleTenantId);
        lifecycleToken = await this.redis.acquireLockToken(lifecycleKey, TENANT_LIFECYCLE_LOCK_TTL_SECONDS);
        if (!lifecycleToken) {
            throw new ConflictException({
                error: 'tenant_lifecycle_in_progress',
                message: 'El ciclo de vida de este tenant ya está siendo modificado',
                tenantId: lifecycleTenantId,
            });
        }
        lifecycleLease = new OwnedLockLease(
            this.redis,
            lifecycleKey,
            lifecycleToken,
            TENANT_LIFECYCLE_LOCK_TTL_SECONDS,
            this.logger,
            `Administrative tenant lifecycle lock lost for ${lifecycleTenantId}`,
        );
        lifecycleLease.start();
        await assertLockOwned();
        if (await this.redis.get(tenantPurgingFenceKey(resolvedLifecycleTenantId))) {
            throw new ConflictException({ error: 'tenant_purge_in_progress', tenantId: resolvedLifecycleTenantId });
        }
        let provisioning: TenantProvisioningState;
        let provisioningWasComplete = false;

        if (tenant) {
            const existingState = (tenant.settings as any)?.provisioning as TenantProvisioningState | undefined;
            const sameRequest = existingState?.source === 'super_admin'
                && tenant.name === name
                && tenant.industry === industry
                && tenant.language === language
                && tenant.plan === plan
                && existingState.selection?.subType === subType
                && existingState.selection?.ownerEmail === ownerEmail
                && (existingState.selection?.isInternal === true) === isInternal;

            if (!sameRequest) {
                throw new ConflictException(`Tenant slug "${slug}" already exists`);
            }
            provisioningWasComplete = existingState.status === 'complete';
            const existingStages = existingState.stages as Partial<Record<TenantProvisioningStage, boolean>>;
            provisioning = {
                ...existingState,
                version: 3,
                selection: { industry, subType, plan, ownerEmail, isInternal },
                stages: {
                    owner: existingStages.owner === true,
                    schema: existingStages.schema === true,
                    agent: existingStages.agent === true,
                    businessInfo: existingStages.businessInfo === true,
                    vertical: existingStages.vertical === true,
                    invitation: existingStages.invitation === true,
                    activation: existingStages.activation === true,
                },
            };
            this.logger.warn(`Resuming failed tenant provisioning for ${tenant.id} at ${existingState.currentStage || 'unknown'}`);
        } else {
            const activePlan = await this.prisma.billingPlan.findFirst({
                where: { slug: plan, isActive: true },
                select: { slug: true },
            });
            if (!activePlan) {
                throw new BadRequestException({
                    error: 'tenant_plan_unavailable',
                    message: `El plan "${plan}" no está disponible para altas`,
                });
            }
            provisioning = {
                version: 3,
                source: 'super_admin',
                status: 'pending',
                selection: { industry, subType, plan, ownerEmail, isInternal },
                stages: {
                    owner: false,
                    schema: false,
                    agent: false,
                    businessInfo: false,
                    vertical: false,
                    invitation: false,
                    activation: false,
                },
                startedAt: now,
                updatedAt: now,
            };
            try {
                await assertLockOwned();
                tenant = await this.prisma.tenant.create({
                    data: {
                        id: lifecycleTenantId,
                        name,
                        slug,
                        industry,
                        language,
                        schemaName: requestedSchemaName,
                        plan,
                        isInternal,
                        isActive: false,
                        signupSource: 'super_admin',
                        settings: { subType, provisioning } as any,
                    },
                });
            } catch (error: any) {
                if (error?.code === 'P2002') {
                    throw new ConflictException({
                        error: 'tenant_slug_conflict',
                        message: `El slug "${slug}" ya está en uso`,
                    });
                }
                throw error;
            }
        }

        const persistProvisioning = async (
            next: TenantProvisioningState,
            extra?: { isActive?: boolean; onboardingCompletedAt?: Date },
        ) => {
            await assertLockOwned();
            await mergeTenantSettingsAtomic(this.prisma, tenant!.id, {
                subType,
                provisioning: next,
            }, extra);
            const current = await this.prisma.tenant.findUnique({
                where: { id: tenant!.id },
            });
            if (!current) throw new Error(`Tenant ${tenant!.id} disappeared during provisioning`);
            return current;
        };

        const runStage = async (stage: TenantProvisioningStage, work: () => Promise<void>) => {
            if (provisioning.stages[stage]) return;
            provisioning = {
                ...provisioning,
                status: 'pending',
                currentStage: stage,
                error: undefined,
                updatedAt: new Date().toISOString(),
            };
            await persistProvisioning(provisioning);
            try {
                await assertLockOwned();
                await work();
                await assertLockOwned();
                provisioning = {
                    ...provisioning,
                    stages: { ...provisioning.stages, [stage]: true },
                    updatedAt: new Date().toISOString(),
                };
                await persistProvisioning(provisioning);
            } catch (error: any) {
                if (error instanceof LockOwnershipLostError || lease.hasLostOwnership()) throw error;
                const message = error?.message || String(error);
                provisioning = {
                    ...provisioning,
                    status: 'failed',
                    currentStage: stage,
                    error: message.slice(0, 1000),
                    updatedAt: new Date().toISOString(),
                };
                await persistProvisioning(provisioning, { isActive: false }).catch((persistError: any) => {
                    this.logger.error(`Could not persist provisioning failure for ${tenant!.id}: ${persistError.message}`);
                });
                this.logger.error(`Tenant ${tenant!.id} provisioning failed at ${stage}: ${message}`);
                throw new InternalServerErrorException({
                    error: 'tenant_provisioning_failed',
                    message: `No se pudo completar el alta en la etapa "${stage}". Puedes reintentar con los mismos datos.`,
                    tenantId: tenant!.id,
                    stage,
                });
            }
        };

        await runStage('owner', async () => {
            const existingOwner = await this.prisma.user.findUnique({ where: { email: ownerEmail } });
            if (existingOwner) {
                if (existingOwner.tenantId === tenant!.id
                    && existingOwner.role === 'tenant_admin'
                    && existingOwner.isActive) {
                    return;
                }
                if (existingOwner.tenantId === null
                    && existingOwner.role === 'tenant_admin'
                    && existingOwner.isActive) {
                    await this.throttle.enforcePlanLimit(tenant!.id, 'seats', 0, 'usuarios');
                    await assertLockOwned();
                    await this.prisma.user.update({
                        where: { id: existingOwner.id },
                        data: {
                            tenantId: tenant!.id,
                            onboardingCompleted: isInternal,
                        },
                    });
                    return;
                }
                throw new ConflictException({
                    error: 'owner_email_unavailable',
                    message: 'El correo del propietario ya pertenece a otra cuenta o tenant',
                });
            }

            await this.throttle.enforcePlanLimit(tenant!.id, 'seats', 0, 'usuarios');
            await assertLockOwned();
            await this.prisma.user.create({
                data: {
                    email: ownerEmail,
                    firstName: ownerFirstName,
                    lastName: ownerLastName,
                    role: 'tenant_admin',
                    tenantId: tenant!.id,
                    isActive: true,
                    emailVerified: false,
                    onboardingCompleted: false,
                    authProvider: 'invitation',
                },
            });

            const createdOwner = await this.prisma.user.findUnique({ where: { email: ownerEmail } });
            if (!createdOwner || createdOwner.tenantId !== tenant!.id || createdOwner.role !== 'tenant_admin') {
                throw new Error('No se pudo crear el propietario del tenant');
            }
        });

        const assertOwnerOwnership = async () => {
            await assertLockOwned();
            const owner = await this.prisma.user.findUnique({ where: { email: ownerEmail } });
            if (!owner
                || owner.tenantId !== tenant!.id
                || owner.role !== 'tenant_admin'
                || !owner.isActive) {
                throw new ConflictException({
                    error: 'tenant_owner_invalid',
                    message: 'El propietario ya no pertenece activamente a este tenant',
                    tenantId: tenant!.id,
                });
            }
            return owner;
        };
        await assertOwnerOwnership();
        if (provisioningWasComplete && provisioning.stages.activation) return tenant;

        await runStage('schema', async () => {
            this.logger.log(`Allocating schema from "${schemaName}" for tenant "${name}"...`);
            schemaName = await this.prisma.createTenantSchema(schemaName);
            if (!await this.isTenantSchemaReady(schemaName)) {
                throw new Error('El schema quedó incompleto después de crearlo');
            }
        });

        await runStage('agent', async () => {
            await this.personaService.createDefaultAgentFromGoals(
                tenant!.id,
                [],
                'super_admin',
                industry,
                subType || undefined,
            );
            const rows = await this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int AS cnt FROM "${schemaName}".agent_personas WHERE is_active = true`,
            ) as any[];
            if (Number(rows[0]?.cnt || 0) < 1) throw new Error('No se creó el agente predeterminado');
        });

        await runStage('businessInfo', async () => {
            const identity = await this.businessInfoService.upsertPrimary(tenant!.id, {
                companyName: name,
                industry,
            });
            if (!identity?.id) throw new Error('No se creó la identidad del negocio');
        });

        await runStage('vertical', async () => {
            await this.verticalsService.bootstrapVertical(
                tenant!.id,
                industry,
                subType,
                language.split('-')[0] || 'es',
                { assertLifecycleOwned: () => lifecycleLease!.assertOwned() },
            );
            const config = await this.verticalsService.getVerticalConfig(tenant!.id);
            if (config?.industry !== industry || (config?.subType || null) !== subType) {
                throw new Error('El bootstrap vertical no produjo la configuración solicitada');
            }
        });

        await runStage('invitation', async () => {
            const owner = await assertOwnerOwnership();

            const needsInvitation = owner.authProvider === 'invitation'
                && !owner.password
                && owner.emailVerified !== true;
            if (!needsInvitation) return;

            const pendingInvitation = await this.prisma.tenantInvitation.findFirst({
                where: {
                    tenantId: tenant!.id,
                    email: ownerEmail,
                    acceptedAt: null,
                    revokedAt: null,
                    expiresAt: { gt: new Date() },
                },
                select: { id: true },
            });
            if (pendingInvitation) return;

            await assertLockOwned();
            const invitation = await this.invitationsService.create({
                tenantId: tenant!.id,
                email: ownerEmail,
                role: 'tenant_admin',
                invitedByUserId: actorUserId,
            });
            if (!invitation?.id) throw new Error('No se creó la invitación del propietario');
        });

        // Administrative provisioning must classify the account before it can
        // become operational. Internal/demo tenants are explicitly usable and
        // non-billable. Commercial tenants remain inactive/onboarding-pending;
        // the invited owner completes the normal country/cycle/payment flow,
        // which creates the canonical TRIALING or PENDING_AUTH subscription.
        await runStage('activation', async () => {
            const owner = await assertOwnerOwnership();
            const completedAt = isInternal ? new Date() : null;
            await assertLockOwned();
            await this.prisma.$transaction(async (tx: any) => {
                await tx.tenant.update({
                    where: { id: tenant!.id },
                    data: {
                        isInternal,
                        isActive: isInternal,
                        onboardingCompletedAt: completedAt,
                    },
                });
                await tx.user.update({
                    where: { id: owner.id },
                    data: { onboardingCompleted: isInternal },
                });
            });
            tenant = await this.prisma.tenant.findUnique({ where: { id: tenant!.id } });
            if (!tenant) throw new Error('El tenant desapareció durante su clasificación de facturación');
        });

        await assertOwnerOwnership();
        const completedAt = new Date().toISOString();
        provisioning = {
            ...provisioning,
            status: 'complete',
            currentStage: undefined,
            error: undefined,
            updatedAt: completedAt,
            completedAt,
        };
        tenant = await persistProvisioning(provisioning);

        await assertLockOwned();
        await this.prisma.auditLog.create({
            data: {
                tenantId: tenant.id,
                userId: actorUserId,
                action: 'tenant_created',
                resource: 'tenant',
                details: {
                    name, slug, schemaName, industry, subType, plan, ownerEmail,
                    isInternal,
                    accessState: isInternal ? 'internal_active' : 'commercial_onboarding_required',
                    provisioning: 'complete',
                },
            },
        }).catch((error: any) => this.logger.warn(`Tenant ${tenant!.id} audit failed: ${error.message}`));

        return tenant;
        } catch (error: unknown) {
            if (error instanceof LockOwnershipLostError || lease.hasLostOwnership() || lifecycleLease?.hasLostOwnership()) {
                throw new ConflictException({
                    error: 'tenant_provisioning_lock_lost',
                    message: 'El alta perdió su lock y fue detenida antes del siguiente commit.',
                    slug,
                });
            }
            throw error;
        } finally {
            if (lifecycleLease && lifecycleToken && lifecycleTenantId) {
                lifecycleLease.stop();
                await this.redis.releaseLockToken(tenantLifecycleLockKey(lifecycleTenantId), lifecycleToken)
                    .catch((error: any) => this.logger.warn(`Could not release lifecycle lock for ${lifecycleTenantId}: ${error.message}`));
            }
            lease.stop();
            await this.redis.releaseLockToken(lockKey, lockToken).catch((error: any) => {
                this.logger.warn(`Could not release provisioning lock for ${slug}: ${error.message}`);
            });
        }
    }

    async getProvisioningPlans() {
        const plans = await this.prisma.billingPlan.findMany({
            where: { slug: { in: [...TENANT_PLAN_SLUGS] }, isActive: true },
            select: { slug: true },
            orderBy: { sortOrder: 'asc' },
        });
        const allowed = new Set<string>(TENANT_PLAN_SLUGS);
        // `plan` va anotado a mano: en CI `tsc` corre antes de `prisma generate`, así
        // que el modelo es `any` y el callback sin anotar rompe el build con TS7006.
        return plans
            .map((plan: { slug: string }) => plan.slug)
            .filter((slug: string): slug is TenantPlanSlug => allowed.has(slug));
    }

    private async isTenantSchemaReady(schemaName: string): Promise<boolean> {
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT table_name
               FROM information_schema.tables
              WHERE table_schema = $1
                AND table_name IN ('agent_personas', 'companies', 'pipeline_stages', 'faqs')`,
            schemaName,
        ) as Array<{ table_name: string }>;
        return new Set(rows.map((row) => row.table_name)).size === 4;
    }

    /**
     * Get all tenants (super admin only)
     */
    async findAll(page = 1, limit = 20, status?: string) {
        const skip = (page - 1) * limit;

        const where: any = {};
        if (status) {
            switch (status) {
                case 'active':
                    where.isActive = true;
                    where.subscriptionStatus = 'active';
                    break;
                case 'trialing':
                    where.isActive = true;
                    where.subscriptionStatus = 'trialing';
                    break;
                case 'past_due':
                    where.subscriptionStatus = 'past_due';
                    break;
                case 'cancelled':
                    where.subscriptionStatus = 'cancelled';
                    break;
                case 'suspended':
                    where.isActive = false;
                    break;
            }
        }

        const [tenants, total] = await Promise.all([
            this.prisma.tenant.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    industry: true,
                    plan: true,
                    isActive: true,
                    language: true,
                    subscriptionStatus: true,
                    trialEndsAt: true,
                    currentPeriodEnd: true,
                    settings: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: {
                        select: {
                            users: true,
                            channelAccounts: true,
                        },
                    },
                },
            }),
            this.prisma.tenant.count({ where }),
        ]);

        // Adjunta a cada tenant si entró por cupón (canje de meses gratis). Es la
        // "modalidad" que el dueño necesita ver e filtrar desde la vista de
        // empresas, no solo desde /admin/coupons. Los canjes viven en la tabla
        // global billing_coupon_redemptions (tenant_id TEXT, sin FK).
        const couponByTenant = await this.buildCouponSummary(tenants.map((t: any) => t.id));
        const withCoupon = tenants.map((t: any) => ({
            ...redactReservedTenantSettingsFromRecord(t),
            coupon: couponByTenant.get(t.id) ?? null,
        }));

        return { tenants: withCoupon, total, page, limit };
    }

    /**
     * Resuelve, para un conjunto de tenants, su canje de cupón MÁS RECIENTE (o
     * null). Una sola consulta con IN sobre la tabla indexada por tenant_id.
     */
    private async buildCouponSummary(tenantIds: string[]): Promise<Map<string, {
        code: string | null;
        source: string | null;
        freeMonths: number | null;
        redeemedAt: Date;
        revoked: boolean;
    }>> {
        const map = new Map<string, any>();
        if (tenantIds.length === 0) return map;

        const rows = await this.prisma.billingCouponRedemption.findMany({
            where: { tenantId: { in: tenantIds } },
            orderBy: { redeemedAt: 'desc' },
            include: { coupon: { select: { code: true, freeMonths: true } } },
        });

        for (const r of rows) {
            // El más reciente gana: findMany viene ordenado desc, así que la
            // primera fila de cada tenant es la que queda.
            if (map.has(r.tenantId)) continue;
            const meta = (r.metadata || {}) as Record<string, any>;
            map.set(r.tenantId, {
                code: r.coupon?.code ?? null,
                source: meta.source ?? null,
                freeMonths: meta.freeMonths ?? r.coupon?.freeMonths ?? null,
                redeemedAt: r.redeemedAt,
                revoked: !!meta.revokedAt,
            });
        }
        return map;
    }

    /**
     * Get an allow-listed tenant detail view. Authorization happens before any
     * cache lookup so a tenant-scoped principal can never probe another
     * tenant's cached record.
     */
    async findById(id: string, principal: TenantReadPrincipal): Promise<TenantDetailResponseDto> {
        this.assertCanReadTenant(id, principal);

        // The old `tenant:${id}:config` entries contain full ChannelAccount
        // records. Never read them: use a versioned key and envelope instead.
        const cached = await this.redis.getJson<TenantDetailCacheEntry>(tenantDetailCacheKey(id));
        if (cached?.version === TENANT_DETAIL_CACHE_VERSION && cached.data?.id === id) {
            return this.toTenantDetailResponse(cached.data);
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                slug: true,
                industry: true,
                language: true,
                isActive: true,
                isInternal: true,
                plan: true,
                settings: true,
                operatingCurrency: true,
                operatingCurrencyLockedAt: true,
                subscriptionStatus: true,
                trialEndsAt: true,
                currentPeriodEnd: true,
                onboardingCompletedAt: true,
                firstChannelConnectedAt: true,
                firstMessageAt: true,
                createdAt: true,
                updatedAt: true,
                channelAccounts: {
                    select: {
                        id: true,
                        channelType: true,
                        displayName: true,
                        isActive: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
                // El plan COBRADO, que puede diferir del de `plan` (límites):
                // `PUT /billing-admin/tenants/:id/plan` es un override
                // deliberado de permisos que no toca la suscripción.
                subscription: {
                    select: { status: true, plan: { select: { slug: true } } },
                },
                _count: {
                    select: { users: true },
                },
            },
        });

        if (!tenant) {
            throw new NotFoundException(`Tenant ${id} not found`);
        }

        const response = this.toTenantDetailResponse(tenant);

        // Cache only the sanitized DTO, never the Prisma model.
        await this.redis.setJson<TenantDetailCacheEntry>(tenantDetailCacheKey(id), {
            version: TENANT_DETAIL_CACHE_VERSION,
            data: response,
        }, 300);

        return response;
    }

    private assertCanReadTenant(id: string, principal: TenantReadPrincipal): void {
        if (principal?.role === 'super_admin') return;
        if (principal?.role === 'tenant_admin' && principal.tenantId === id) return;

        throw new ForbiddenException('Cannot access another tenant');
    }

    /**
     * Marcar/desmarcar un tenant como propio de la empresa.
     *
     * Vive acá y no en el controller porque la ficha se sirve de una caché de
     * 5 minutos: escribir la columna sin invalidarla dejaba al panel mostrando
     * el estado viejo, y el operador marcaba sin ver ningún cambio.
     */
    async setInternal(
        id: string,
        isInternal: boolean,
        actor: { userId?: string | null; email?: string | null },
        reason: string,
    ): Promise<{ id: string; name: string; isInternal: boolean }> {
        const subscription = await this.prisma.billingSubscription.findUnique({ where: { tenantId: id } });
        if (!isInternal && subscription?.cancellationReason?.startsWith('comp: internal-use')) {
            throw new BadRequestException({
                error: 'internal_reactivation_required',
                message: 'Reactiva y rearma la facturación mediante el flujo explícito antes de desmarcar este tenant como interno.',
            });
        }
        if (subscription?.providerSubscriptionId
            && !['cancelled', 'expired'].includes(subscription.status)) {
            throw new BadRequestException({
                error: 'live_billing_mandate',
                message: 'Cancela primero la suscripción activa en el proveedor; marcarla interna no detiene un mandato remoto.',
                provider: subscription.provider,
                mandateId: subscription.providerSubscriptionId,
            });
        }
        const tenant = await this.prisma.$transaction(async (tx: any) => {
            const updated = await tx.tenant.update({
                where: { id },
                data: { isInternal },
                select: { id: true, name: true, isInternal: true },
            });

            if (isInternal && subscription) {
                // Disable the engine before retiring queued work. A worker that
                // picked up a scheduled attempt concurrently will fail its live
                // revalidation on engine_disabled and cannot move money.
                await tx.billingSubscription.update({
                    where: { id: subscription.id },
                    data: {
                        engine: 'disabled',
                        nextChargeAt: null,
                        cancellationReason: `comp: internal-use — ${reason}`,
                        dunningState: 'none',
                    },
                });
                // This read happens after engine=disabled in the SAME
                // transaction. A worker that already reserved becomes visible
                // here and rolls the conversion back; a worker that revalidates
                // after commit sees engine_disabled and cannot charge.
                const unresolved = await tx.billingChargeAttempt.findFirst({
                    where: {
                        subscriptionId: subscription.id,
                        OR: [
                            { status: { in: ['in_flight', 'pending_provider'] } },
                            { failureClass: 'indeterminate' },
                        ],
                    },
                    select: { id: true, status: true, reference: true },
                });
                if (unresolved) {
                    throw new BadRequestException({
                        error: 'billing_charge_unresolved',
                        message: 'Resuelve primero el cobro en curso; podría haberse debitado y no es seguro convertir la cuenta.',
                        attemptId: unresolved.id,
                        reference: unresolved.reference,
                    });
                }
                await tx.billingChargeAttempt.updateMany({
                    where: { subscriptionId: subscription.id, status: 'scheduled' },
                    data: {
                        status: 'superseded',
                        failureCode: 'tenant_marked_internal',
                        settledAt: new Date(),
                    },
                });
            }
            return updated;
        });

        if (isInternal && subscription) {
            await this.redis.del(`tenant_plan:${id}`);
            await this.redis.del(`sub_status:${id}`);
            await this.redis.del(`plan_features:${id}`);
        }
        await this.redis.del(`sub_internal:${id}`);

        await this.redis.del(tenantDetailCacheKey(id));
        await this.redis.del(legacyTenantConfigCacheKey(id));

        await this.prisma.auditLog.create({
            data: {
                tenantId: id,
                userId: actor.userId ?? null,
                action: isInternal ? 'tenant.marked_internal' : 'tenant.unmarked_internal',
                resource: 'tenants',
                details: { reason, actor: actor.email ?? null },
            },
        });
        this.logger.log(
            `[Tenants] ${tenant.name} ${isInternal ? 'marcado' : 'desmarcado'} como propio por `
            + `${actor.email ?? actor.userId ?? 'desconocido'} — ${reason}`,
        );
        return tenant;
    }

    private toTenantDetailResponse(source: any): TenantDetailResponseDto {
        return {
            id: source.id,
            name: source.name,
            slug: source.slug,
            industry: source.industry,
            language: source.language,
            isActive: source.isActive,
            isInternal: source.isInternal === true,
            plan: source.plan,
            billedPlan: source.subscription?.plan?.slug ?? null,
            settings: redactReservedTenantSettings(source.settings) as TenantDetailResponseDto['settings'],
            operatingCurrency: source.operatingCurrency ?? null,
            operatingCurrencyLockedAt: source.operatingCurrencyLockedAt ?? null,
            subscriptionStatus: source.subscriptionStatus ?? null,
            trialEndsAt: source.trialEndsAt ?? null,
            currentPeriodEnd: source.currentPeriodEnd ?? null,
            onboardingCompletedAt: source.onboardingCompletedAt ?? null,
            firstChannelConnectedAt: source.firstChannelConnectedAt ?? null,
            firstMessageAt: source.firstMessageAt ?? null,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt,
            channelAccounts: Array.isArray(source.channelAccounts)
                ? source.channelAccounts.map((channel: any) => ({
                    id: channel.id,
                    channelType: channel.channelType,
                    displayName: channel.displayName,
                    isActive: channel.isActive,
                    createdAt: channel.createdAt,
                    updatedAt: channel.updatedAt,
                }))
                : [],
            _count: { users: Number(source._count?.users || 0) },
        };
    }

    /**
     * Get tenant by slug
     */
    async findBySlug(slug: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { slug },
        });

        if (!tenant) {
            throw new NotFoundException(`Tenant "${slug}" not found`);
        }

        return redactReservedTenantSettingsFromRecord(tenant);
    }

    /**
     * Get the schema name for a tenant
     */
    async getSchemaName(tenantId: string, executionContext?: ServiceExecutionContext): Promise<string> {
        // Introspection must not warm Redis. Resolve directly from the source of
        // truth whenever the caller explicitly disables persistence.
        if (persistenceDisabled(executionContext)) {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { schemaName: true },
            });
            if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);
            return tenant.schemaName;
        }

        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });

        if (!tenant) {
            throw new NotFoundException(`Tenant ${tenantId} not found`);
        }

        await this.redis.set(`tenant:${tenantId}:schema`, tenant.schemaName, 600);
        return tenant.schemaName;
    }

    /**
     * Update tenant settings.
     *
     * Vertical identity is immutable through this generic endpoint. Changing
     * only the public column/config would leave pipeline, FAQs, tools, persona,
     * and booking data from the previous vertical. A dedicated migration flow
     * must perform that operation as an auditable, resumable unit.
     */
    async update(id: string, data: Partial<{
        name: string;
        industry: string;
        subType: string | null;
        language: string;
        isActive: boolean;
        settings: any;
    }>) {
        if (data.language && !(TENANT_LANGUAGE_TAGS as readonly string[]).includes(data.language)) {
            throw new BadRequestException({
                error: 'invalid_tenant_language',
                message: `El idioma "${data.language}" no está soportado`,
                allowedLanguages: TENANT_LANGUAGE_TAGS,
            });
        }
        // Normalize historic subtype aliases before comparing an immutable
        // selection. Otherwise saving an unrelated field on a legacy tenant
        // looks like a forbidden vertical change (old id vs canonical target),
        // or persists the split identity again. The vertical service fences
        // the target contract pending full reprovisioning.
        if (typeof (this.verticalsService as any)?.getVerticalConfig === 'function') {
            await this.verticalsService.getVerticalConfig(id).catch((error: any) => {
                this.logger.warn(`Could not reconcile vertical identity before tenant update ${id}: ${error?.message}`);
            });
        }
        const existing = await this.prisma.tenant.findUnique({
            where: { id },
            select: { industry: true, settings: true },
        });
        if (!existing) {
            throw new NotFoundException(`Tenant ${id} not found`);
        }
        const existingSettings = (existing.settings as any) || {};
        const existingSubType = existingSettings.verticalConfig?.subType
            ?? existingSettings.subType
            ?? null;
        const {
            subType: requestedSubType,
            settings: requestedSettings,
            ...tenantData
        } = data;

        const reservedKey = firstReservedTenantSetting(requestedSettings);
        if (reservedKey) {
            // El mensaje nombra la clave real. Decir siempre `tenantPayments`
            // mandaba a buscar el problema al lugar equivocado.
            throw new BadRequestException({
                error: 'reserved_tenant_setting',
                key: reservedKey,
                message: `settings.${reservedKey} solo puede administrarse mediante su integración dedicada.`,
            });
        }

        const unsupportedKey = firstUnsupportedGenericTenantSetting(requestedSettings);
        if (unsupportedKey) {
            throw new BadRequestException({
                error: 'unsupported_tenant_setting',
                key: unsupportedKey,
                message: `settings.${unsupportedKey} no pertenece al contrato genérico del tenant.`,
            });
        }

        const selectionWasProvided = data.industry !== undefined || requestedSubType !== undefined;
        let nextIndustry = existing.industry;
        let nextSubType = existingSubType;

        if (selectionWasProvided) {
            const rawIndustry = data.industry ?? existing.industry;
            const rawSubType = requestedSubType !== undefined
                ? requestedSubType
                : existingSubType;
            try {
                const resolved = resolveVerticalSelection(rawIndustry, rawSubType);
                nextIndustry = resolved.industry;
                nextSubType = resolved.subType;
            } catch (error) {
                if (error instanceof InvalidVerticalSelectionError) {
                    throw new BadRequestException({
                        error: 'invalid_vertical_selection',
                        message: error.message,
                        industry: error.industry,
                        subType: error.subType,
                    });
                }
                throw error;
            }

            const verticalChanged = nextIndustry !== existing.industry || nextSubType !== existingSubType;
            if (verticalChanged) {
                throw new ConflictException({
                    error: 'vertical_migration_required',
                    message: 'Cambiar la vertical requiere el flujo explícito de migración para evitar datos híbridos.',
                    from: { industry: existing.industry, subType: existingSubType },
                    to: { industry: nextIndustry, subType: nextSubType },
                });
            }

            // Aliases that resolve to the same canonical identity are accepted,
            // but the stored column remains canonical.
            tenantData.industry = nextIndustry;
        }

        if (requestedSettings) {
            await mergeTenantSettingsAtomic(this.prisma, id, requestedSettings);
        }

        const tenant = Object.keys(tenantData).length > 0
            ? await this.prisma.tenant.update({ where: { id }, data: tenantData })
            : await this.prisma.tenant.findUnique({ where: { id } });
        if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);

        // Invalidate both the current safe detail view and any legacy payload
        // left behind during a rolling deployment.
        await this.redis.del(tenantDetailCacheKey(id));
        await this.redis.del(legacyTenantConfigCacheKey(id));
        await this.redis.del(`tenant:${id}:schema`);

        const qualitySettingsChanged = requestedSettings && [
            'businessHours',
            'chatReasons',
            'customerTypes',
        ].some((key) => Object.prototype.hasOwnProperty.call(requestedSettings, key));
        if (qualitySettingsChanged) {
            this.events?.emit(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
                tenantId: id,
                source: 'tenant_settings',
            });
        }

        return redactReservedTenantSettingsFromRecord(tenant);
    }

    /**
     * Get all users belonging to a tenant
     */
    async getUsersByTenantId(tenantId: string) {
        // Verify tenant exists
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) {
            throw new NotFoundException(`Tenant ${tenantId} not found`);
        }

        const users = await this.prisma.user.findMany({
            where: { tenantId },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
                createdAt: true,
                lastLoginAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        return users;
    }

    /**
     * Deactivate a tenant (soft delete)
     */
    async deactivate(id: string) {
        const tenant = await this.prisma.tenant.update({
            where: { id },
            data: { isActive: false },
        });

        // Audit log
        await this.prisma.auditLog.create({
            data: {
                tenantId: id,
                action: 'tenant_deactivated',
                resource: 'tenant',
                details: { name: tenant.name },
            },
        });

        // Invalidate both current and legacy detail cache shapes.
        await this.redis.del(tenantDetailCacheKey(id));
        await this.redis.del(legacyTenantConfigCacheKey(id));

        return redactReservedTenantSettingsFromRecord(tenant);
    }

    // ── Super Admin Platform Methods ─────────────────────────────

    /**
     * Platform KPIs — counts by subscription status, users, channels, signups.
     */
    async getPlatformStats() {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

        const [
            totalTenants,
            activeTenants,
            trialingTenants,
            pastDueTenants,
            cancelledTenants,
            suspendedTenants,
            totalUsers,
            totalChannels,
            recentSignups7d,
            recentSignups30d,
        ] = await Promise.all([
            this.prisma.tenant.count(),
            this.prisma.tenant.count({ where: { isActive: true, subscriptionStatus: 'active' } }),
            this.prisma.tenant.count({ where: { isActive: true, subscriptionStatus: 'trialing' } }),
            this.prisma.tenant.count({ where: { subscriptionStatus: 'past_due' } }),
            this.prisma.tenant.count({ where: { subscriptionStatus: 'cancelled' } }),
            this.prisma.tenant.count({ where: { isActive: false } }),
            this.prisma.user.count(),
            this.prisma.channelAccount.count({ where: { isActive: true } }),
            this.prisma.tenant.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
            this.prisma.tenant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
        ]);

        // Cross-tenant metrics (iterate active schemas)
        let messagesToday = 0;
        let pendingHandoffs = 0;
        try {
            const activeSchemas = await this.prisma.$queryRaw<any[]>`
                SELECT schema_name FROM tenants WHERE is_active = true
            `;
            for (const t of activeSchemas || []) {
                try {
                    const msgResult = await this.prisma.executeInTenantSchema<any[]>(
                        t.schema_name,
                        `SELECT COUNT(*)::int as cnt FROM messages WHERE created_at::date = CURRENT_DATE`,
                    );
                    messagesToday += msgResult?.[0]?.cnt || 0;
                } catch { /* table may not exist */ }
                try {
                    const hResult = await this.prisma.executeInTenantSchema<any[]>(
                        t.schema_name,
                        `SELECT COUNT(*)::int as cnt FROM conversations WHERE status = 'waiting_human'`,
                    );
                    pendingHandoffs += hResult?.[0]?.cnt || 0;
                } catch { /* table may not exist */ }
            }
        } catch (e: any) {
            this.logger.warn(`Cross-tenant metrics failed: ${e.message}`);
        }

        // Country distribution
        const geoTenants = await this.prisma.tenant.findMany({
            select: {
                billingCountry: true,
                language: true,
            },
        });

        const countryMap: Record<string, string> = {
            'CO': 'Colombia',
            'MX': 'México',
            'AR': 'Argentina',
            'CL': 'Chile',
            'PE': 'Perú',
            'EC': 'Ecuador',
            'VE': 'Venezuela',
            'BO': 'Bolivia',
            'UY': 'Uruguay',
            'PY': 'Paraguay',
            'CR': 'Costa Rica',
            'PA': 'Panamá',
            'GT': 'Guatemala',
            'HN': 'Honduras',
            'SV': 'El Salvador',
            'NI': 'Nicaragua',
            'DO': 'República Dominicana',
            'ES': 'España',
            'US': 'Estados Unidos',
            'BR': 'Brasil',
        };

        const countryCounts: Record<string, number> = {};
        for (const t of geoTenants) {
            let code = t.billingCountry?.trim().toUpperCase();
            if (!code && t.language) {
                const parts = t.language.split('-');
                if (parts.length > 1) {
                    code = parts[1].trim().toUpperCase();
                }
            }
            if (!code) {
                code = 'OTROS';
            }
            countryCounts[code] = (countryCounts[code] || 0) + 1;
        }

        const totalGeo = geoTenants.length || 1;
        const countryDistribution = Object.entries(countryCounts).map(([code, count]) => {
            const countryName = countryMap[code] || (code === 'OTROS' ? 'Otros' : code);
            return {
                countryCode: code,
                countryName,
                count,
                percentage: Math.round((count / totalGeo) * 100),
            };
        }).sort((a, b) => b.count - a.count);

        return {
            totalTenants,
            activeTenants,
            trialingTenants,
            pastDueTenants,
            cancelledTenants,
            suspendedTenants,
            totalUsers,
            totalChannels,
            recentSignups7d,
            recentSignups30d,
            messagesToday,
            pendingHandoffs,
            countryDistribution,
        };
    }

    /**
     * Billing summary — MRR, plan distribution, recent/failed payments, total revenue.
     */
    async getPlatformBilling() {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

        // Plan distribution (group active subscriptions by plan)
        const activeSubs = await this.prisma.billingSubscription.findMany({
            where: { status: { in: ['active', 'trialing'] } },
            include: { plan: { select: { slug: true, priceUsdCents: true } } },
        });

        // Compute MRR from active (non-trialing) subscriptions
        let mrrCents = 0;
        const planCounts: Record<string, number> = {};
        for (const sub of activeSubs) {
            const slug = (sub as any).plan?.slug || 'unknown';
            planCounts[slug] = (planCounts[slug] || 0) + 1;
            if (sub.status === 'active') {
                mrrCents += (sub as any).plan?.priceUsdCents || 0;
            }
        }

        const planDistribution = Object.entries(planCounts).map(([plan, count]) => ({ plan, count }));

        // Recent payments (last 20)
        const recentPayments = await this.prisma.billingPayment.findMany({
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
                id: true,
                tenantId: true,
                amountCents: true,
                currency: true,
                status: true,
                provider: true,
                paidAt: true,
                createdAt: true,
            },
        });

        // Failed payments last 30d
        const failedPayments = await this.prisma.billingPayment.findMany({
            where: {
                status: 'failed',
                createdAt: { gte: thirtyDaysAgo },
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                tenantId: true,
                amountCents: true,
                currency: true,
                failureReason: true,
                createdAt: true,
            },
        });

        // Total revenue (sum of succeeded payments)
        const succeededPayments = await this.prisma.billingPayment.aggregate({
            where: { status: 'succeeded' },
            _sum: { amountCents: true },
        });

        return {
            mrr: mrrCents / 100,
            planDistribution,
            recentPayments,
            failedPayments,
            totalRevenue: (succeededPayments._sum.amountCents || 0) / 100,
        };
    }

    /**
     * Usage across all active tenants — automation/outbound current + limits.
     */
    async getPlatformUsage() {
        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true, name: true, plan: true },
            orderBy: { name: 'asc' },
        });

        const usageData = await Promise.all(
            tenants.map(async (t: any) => {
                const [automation, outbound] = await Promise.all([
                    this.throttle.getUsage(t.id, 'automation'),
                    this.throttle.getUsage(t.id, 'outbound'),
                ]);
                return {
                    tenantId: t.id,
                    tenantName: t.name,
                    plan: t.plan,
                    usage: {
                        automationCurrent: automation.current,
                        automationLimit: automation.limit,
                        outboundCurrent: outbound.current,
                        outboundLimit: outbound.limit,
                    },
                };
            }),
        );

        return usageData;
    }

    /**
     * Engagement metrics for a specific tenant (super_admin).
     */
    async getTenantEngagement(tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                id: true, schemaName: true, settings: true, createdAt: true,
                onboardingCompletedAt: true, firstChannelConnectedAt: true, firstMessageAt: true,
            },
        });
        if (!tenant) {
            throw new NotFoundException(`Tenant ${tenantId} not found`);
        }

        const schema = tenant.schemaName;
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

        // Activity metrics — each in its own try/catch for resilience
        let messages7d = 0;
        let messages30d = 0;
        let conversationsActive = 0;
        let handoffsPending = 0;

        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS count FROM messages WHERE created_at >= $1`,
                [sevenDaysAgo],
            );
            messages7d = rows[0]?.count || 0;
        } catch (e) {
            this.logger.warn(`Engagement: messages7d query failed for ${tenantId}: ${e.message}`);
        }

        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS count FROM messages WHERE created_at >= $1`,
                [thirtyDaysAgo],
            );
            messages30d = rows[0]?.count || 0;
        } catch (e) {
            this.logger.warn(`Engagement: messages30d query failed for ${tenantId}: ${e.message}`);
        }

        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS count FROM conversations WHERE status = 'active'`,
                [],
            );
            conversationsActive = rows[0]?.count || 0;
        } catch (e) {
            this.logger.warn(`Engagement: conversationsActive query failed for ${tenantId}: ${e.message}`);
        }

        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS count FROM conversations WHERE status = 'waiting_human'`,
                [],
            );
            handoffsPending = rows[0]?.count || 0;
        } catch (e) {
            this.logger.warn(`Engagement: handoffsPending query failed for ${tenantId}: ${e.message}`);
        }

        // Configuration completeness
        let agentsCount = 0;
        let faqsCount = 0;
        let servicesCount = 0;
        let pipelineStagesCount = 0;

        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS count FROM agent_personas`,
                [],
            );
            agentsCount = rows[0]?.count || 0;
        } catch (e) {
            this.logger.warn(`Engagement: agentsCount query failed for ${tenantId}: ${e.message}`);
        }

        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS count FROM faqs`,
                [],
            );
            faqsCount = rows[0]?.count || 0;
        } catch (e) {
            this.logger.warn(`Engagement: faqsCount query failed for ${tenantId}: ${e.message}`);
        }

        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS count FROM services`,
                [],
            );
            servicesCount = rows[0]?.count || 0;
        } catch (e) {
            this.logger.warn(`Engagement: servicesCount query failed for ${tenantId}: ${e.message}`);
        }

        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS count FROM pipeline_stages`,
                [],
            );
            pipelineStagesCount = rows[0]?.count || 0;
        } catch (e) {
            this.logger.warn(`Engagement: pipelineStagesCount query failed for ${tenantId}: ${e.message}`);
        }

        // Agent list — the "Config IA" tab renders each agent with its channels.
        // The frontend accesses `agents.length`/`.map`, so this MUST be an array:
        // a missing field there throws and blanks the whole tab.
        let agents: Array<{ id: string; name: string; channels: string[]; isDefault: boolean }> = [];
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT id, name, is_default, channels
                   FROM agent_personas
                  WHERE is_active = true
                  ORDER BY is_default DESC, created_at ASC`,
                [],
            );
            agents = rows.map((r) => ({
                id: r.id,
                name: r.name,
                channels: Array.isArray(r.channels) ? r.channels : [],
                isDefault: r.is_default === true,
            }));
        } catch (e) {
            this.logger.warn(`Engagement: agents query failed for ${tenantId}: ${e.message}`);
        }

        // Pipeline stages — same contract requirement (frontend reads `.length`).
        let pipelineStages: Array<{ name: string; color: string | null; position: number }> = [];
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT name, color, position FROM pipeline_stages ORDER BY position ASC`,
                [],
            );
            pipelineStages = rows.map((r) => ({
                name: r.name,
                color: r.color ?? null,
                position: Number(r.position) || 0,
            }));
        } catch (e) {
            this.logger.warn(`Engagement: pipelineStages query failed for ${tenantId}: ${e.message}`);
        }

        // Channel accounts from global table
        const channelsConnected = await this.prisma.channelAccount.count({
            where: { tenantId, isActive: true },
        });

        // Vertical info from tenant.settings JSONB
        const settings = (tenant.settings as any) || {};
        const vertical: string | null = settings.verticalConfig?.industry || null;
        const subType: string | null = settings.verticalConfig?.subType || null;

        // ¿Sigue vivo? El score dice "qué tan completo está", no "cuándo fue la
        // última vez". Para saber si un tenant se apagó hace falta una fecha.
        let lastMessageAt: Date | null = null;
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT MAX(created_at) AS last_at FROM messages`,
                [],
            );
            lastMessageAt = rows[0]?.last_at ? new Date(rows[0].last_at) : null;
        } catch (e) {
            this.logger.warn(`Engagement: lastMessageAt query failed for ${tenantId}: ${e.message}`);
        }

        const lastLogin = await this.prisma.user.aggregate({
            where: { tenantId },
            _max: { lastLoginAt: true },
        }).catch(() => null);
        const lastLoginAt = lastLogin?._max?.lastLoginAt ?? null;

        // Un canal conectado sin agente enlazado recibe mensajes que nadie
        // responde — peor que no tenerlo, porque el cliente cree que anda.
        const channelsWithoutAgent = Math.max(0, channelsConnected - agents.length);

        // Health score calculation
        const channelBonus = channelsConnected > 0 ? 20 : 0;
        const agentBonus = agentsCount > 0 ? 20 : 0;
        const faqBonus = faqsCount >= 3 ? 15 : (faqsCount > 0 ? 8 : 0);
        const serviceBonus = servicesCount > 0 ? 10 : 0;
        const activityBonus = messages7d > 0 ? 35 : (messages30d > 0 ? 15 : 0);
        const healthScore = channelBonus + agentBonus + faqBonus + serviceBonus + activityBonus;

        return {
            messages7d,
            messages30d,
            conversationsActive,
            handoffsPending,
            agentsCount,
            faqsCount,
            servicesCount,
            channelsConnected,
            pipelineStagesCount,
            vertical,
            // `industry` is what the dashboard's EngagementData expects; keep
            // `vertical` too for any existing consumer.
            industry: vertical,
            subType,
            healthScore,
            agents,
            pipelineStages,
            lastLoginAt,
            lastMessageAt,
            createdAt: tenant.createdAt,
            onboardingCompletedAt: tenant.onboardingCompletedAt,
            // Las causas concretas, ya ordenadas por severidad. El score dice
            // cuán completo está; esto dice qué hacer al respecto.
            stallFindings: diagnoseTenantStall({
                onboardingCompletedAt: tenant.onboardingCompletedAt,
                firstChannelConnectedAt: tenant.firstChannelConnectedAt,
                firstMessageAt: tenant.firstMessageAt,
                lastLoginAt,
                lastMessageAt,
                channelsConnected,
                agentsCount,
                channelsWithoutAgent,
                faqsCount,
                messages7d,
                messages30d,
                handoffsPending,
                createdAt: tenant.createdAt,
            }),
        };
    }

    /**
     * Platform health — Redis, Postgres, BullMQ queue stats.
     */
    async getPlatformHealth() {
        // Redis health
        let redisOk = false;
        try {
            const pong = await this.redis.getClient().ping();
            redisOk = pong === 'PONG';
        } catch {
            redisOk = false;
        }

        // Postgres health
        let postgresOk = false;
        try {
            await this.prisma.$queryRawUnsafe('SELECT 1');
            postgresOk = true;
        } catch {
            postgresOk = false;
        }

        // Queue stats
        const queueDefs = [
            { queue: this.outboundQueue, name: 'outbound-messages' },
            { queue: this.broadcastQueue, name: 'broadcast-messages' },
            { queue: this.automationQueue, name: 'automation-jobs' },
            { queue: this.nurturingQueue, name: 'nurturing' },
            { queue: this.snoozeQueue, name: 'conversation-snooze' },
        ];

        const queues = await Promise.all(
            queueDefs.map(async ({ queue, name }) => {
                try {
                    const counts = await queue.getJobCounts();
                    return {
                        name,
                        waiting: counts.waiting || 0,
                        active: counts.active || 0,
                        delayed: counts.delayed || 0,
                        failed: counts.failed || 0,
                    };
                } catch {
                    return { name, waiting: -1, active: -1, delayed: -1, failed: -1 };
                }
            }),
        );

        return {
            services: {
                api: true,
                redis: redisOk,
                postgres: postgresOk,
            },
            queues,
        };
    }

    /**
     * Inspect actual jobs in one of the BullMQ queues. Used by the
     * super_admin queue inspector: click a row in /admin/health to
     * see what's actually queued (especially useful when "waiting" is
     * non-zero and you want to know if it's one tenant flooding or
     * something stuck).
     *
     * `state` is the BullMQ job state: waiting | active | delayed |
     * failed | completed. Limit caps results at 100.
     */
    private getQueueByName(queueName: string): any | null {
        const queueMap: Record<string, any> = {
            'outbound-messages': this.outboundQueue,
            'broadcast-messages': this.broadcastQueue,
            'automation-jobs': this.automationQueue,
            'nurturing': this.nurturingQueue,
            'conversation-snooze': this.snoozeQueue,
        };
        return queueMap[queueName] || null;
    }

    async getQueueJobs(queueName: string, state: string, limit = 50): Promise<any[]> {
        const queue = this.getQueueByName(queueName);
        if (!queue) return [];

        const validStates = ['waiting', 'active', 'delayed', 'failed', 'completed'];
        if (!validStates.includes(state)) return [];

        const cap = Math.min(limit, 100);
        try {
            const jobs = await queue.getJobs([state], 0, cap - 1, true);
            return jobs.map((j: any) => {
                const data = j.data || {};
                const summary = data.tenantId
                    ? `tenant=${String(data.tenantId).slice(0, 8)}…`
                    : data.to
                        ? `to=${String(data.to).slice(0, 12)}…`
                        : data.contactId
                            ? `contact=${String(data.contactId).slice(0, 8)}…`
                            : '';
                return {
                    id: j.id,
                    name: j.name,
                    summary,
                    tenantId: data.tenantId || null,
                    channelType: data.channelType || data.channel || null,
                    timestamp: j.timestamp ? new Date(j.timestamp).toISOString() : null,
                    delay: j.delay || 0,
                    attemptsMade: j.attemptsMade || 0,
                    failedReason: j.failedReason || null,
                    processedOn: j.processedOn ? new Date(j.processedOn).toISOString() : null,
                    finishedOn: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
                };
            });
        } catch (e: any) {
            this.logger.warn(`Failed to fetch jobs from ${queueName}/${state}: ${e.message}`);
            return [];
        }
    }

    /**
     * Full job detail with payload + opts + stack trace. Sensitive
     * fields are redacted: accessToken, refresh_token, password, secret
     * are replaced with '[REDACTED]'. Used by the inspector's expanded
     * row view.
     */
    async getQueueJobDetail(queueName: string, jobId: string): Promise<any | null> {
        const queue = this.getQueueByName(queueName);
        if (!queue) return null;
        try {
            const job = await queue.getJob(jobId);
            if (!job) return null;

            const REDACT = (obj: any): any => {
                if (!obj || typeof obj !== 'object') return obj;
                if (Array.isArray(obj)) return obj.map(REDACT);
                const SENSITIVE = /(accesstoken|refreshtoken|refresh_token|password|secret|api[_-]?key|apikey|authorization|token)/i;
                const out: any = {};
                for (const [k, v] of Object.entries(obj)) {
                    if (SENSITIVE.test(k) && typeof v === 'string') {
                        out[k] = `[REDACTED ${v.length}ch]`;
                    } else if (v && typeof v === 'object') {
                        out[k] = REDACT(v);
                    } else {
                        out[k] = v;
                    }
                }
                return out;
            };

            const state = await job.getState().catch(() => 'unknown');
            return {
                id: job.id,
                name: job.name,
                state,
                data: REDACT(job.data),
                opts: {
                    priority: job.opts?.priority,
                    attempts: job.opts?.attempts,
                    backoff: job.opts?.backoff,
                    delay: job.opts?.delay,
                    removeOnComplete: job.opts?.removeOnComplete,
                    removeOnFail: job.opts?.removeOnFail,
                },
                returnvalue: REDACT(job.returnvalue),
                stacktrace: job.stacktrace || [],
                failedReason: job.failedReason || null,
                attemptsMade: job.attemptsMade || 0,
                timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
                processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
                finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
                progress: job.progress,
            };
        } catch (e: any) {
            this.logger.warn(`Failed to fetch job detail ${queueName}/${jobId}: ${e.message}`);
            return null;
        }
    }

    /**
     * Remove a single job from a queue. Works for any state — BullMQ
     * also kills the job's lock if it's currently active. Returns true
     * when the job existed and was removed.
     */
    async removeQueueJob(queueName: string, jobId: string, actor?: string): Promise<boolean> {
        const queue = this.getQueueByName(queueName);
        if (!queue) return false;
        try {
            const job = await queue.getJob(jobId);
            if (!job) return false;
            const state = await job.getState().catch(() => 'unknown');
            const tenantId = job.data?.tenantId || null;
            await job.remove();
            // Audit trail — surfaced in /admin/audit
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    action: 'queue_job_removed',
                    resource: queueName,
                    details: { jobId, state, name: job.name, removedBy: actor || 'super_admin' },
                },
            }).catch(() => {});
            return true;
        } catch (e: any) {
            this.logger.warn(`Failed to remove job ${queueName}/${jobId}: ${e.message}`);
            return false;
        }
    }

    /**
     * Retry a failed job. BullMQ moves it back to 'waiting' and resets
     * the attempts counter. Returns false when the job isn't in a
     * retryable state.
     */
    async retryQueueJob(queueName: string, jobId: string, actor?: string): Promise<boolean> {
        const queue = this.getQueueByName(queueName);
        if (!queue) return false;
        try {
            const job = await queue.getJob(jobId);
            if (!job) return false;
            await job.retry();
            await this.prisma.auditLog.create({
                data: {
                    tenantId: job.data?.tenantId || null,
                    action: 'queue_job_retried',
                    resource: queueName,
                    details: { jobId, name: job.name, retriedBy: actor || 'super_admin' },
                },
            }).catch(() => {});
            return true;
        } catch (e: any) {
            this.logger.warn(`Failed to retry job ${queueName}/${jobId}: ${e.message}`);
            return false;
        }
    }

    /**
     * Bulk-clean jobs in a given state. olderThanMs is a grace window
     * (e.g. 86400000 = only clean jobs older than 24h). Returns the
     * count of removed jobs. Use cautiously — 'waiting' clean drops
     * pending work that hasn't been processed yet.
     */
    async cleanQueue(
        queueName: string,
        state: 'completed' | 'wait' | 'waiting' | 'active' | 'delayed' | 'failed',
        olderThanMs = 0,
        limit = 1000,
        actor?: string,
    ): Promise<number> {
        const queue = this.getQueueByName(queueName);
        if (!queue) return 0;

        // BullMQ uses 'wait' (not 'waiting') for the clean() type param
        const bullmqState = state === 'waiting' ? 'wait' : state;
        const validStates = ['completed', 'wait', 'active', 'delayed', 'failed'];
        if (!validStates.includes(bullmqState)) return 0;

        try {
            const removed = await queue.clean(olderThanMs, Math.min(limit, 1000), bullmqState as any);
            const count = Array.isArray(removed) ? removed.length : Number(removed) || 0;
            await this.prisma.auditLog.create({
                data: {
                    tenantId: null,
                    action: 'queue_cleaned',
                    resource: queueName,
                    details: { state, olderThanMs, limit, removed: count, cleanedBy: actor || 'super_admin' },
                },
            }).catch(() => {});
            this.logger.log(`[Queue] Cleaned ${count} ${state} jobs from ${queueName}`);
            return count;
        } catch (e: any) {
            this.logger.warn(`Failed to clean ${queueName}/${state}: ${e.message}`);
            return 0;
        }
    }

    /**
     * Acquisition funnel: account signup → onboarding done → first message →
     * paying. The first event lives on User because a Tenant does not exist
     * until onboarding completes; counting tenants made the first transition
     * tautologically 100% and erased every abandoned signup.
     */
    async getOnboardingFunnel(since: Date) {
        const signups = await this.prisma.user.findMany({
            where: {
                isSelfServeSignup: true,
                createdAt: { gte: since },
            },
            select: {
                id: true,
                createdAt: true,
                signupSource: true,
                tenant: {
                    select: {
                        onboardingCompletedAt: true,
                        firstChannelConnectedAt: true,
                        firstMessageAt: true,
                        subscriptionStatus: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        const totalSignups = signups.length;
        const onboardingDone = signups.filter((s: any) => s.tenant?.onboardingCompletedAt).length;
        const channelConnected = signups.filter((s: any) => s.tenant?.firstChannelConnectedAt).length;
        const firstMessage = signups.filter((s: any) => s.tenant?.firstMessageAt).length;
        const paying = signups.filter((s: any) =>
            s.tenant?.subscriptionStatus === 'active' || s.tenant?.subscriptionStatus === 'past_due'
        ).length;

        const bySource = new Map<string, { source: string; signups: number; onboarded: number; channelConnected: number; activated: number; paying: number }>();
        for (const signup of signups as any[]) {
            const tenant = signup.tenant;
            const key = (signup.signupSource || 'unknown').slice(0, 40);
            const row = bySource.get(key) || { source: key, signups: 0, onboarded: 0, channelConnected: 0, activated: 0, paying: 0 };
            row.signups += 1;
            if (tenant?.onboardingCompletedAt) row.onboarded += 1;
            if (tenant?.firstChannelConnectedAt) row.channelConnected += 1;
            if (tenant?.firstMessageAt) row.activated += 1;
            if (tenant?.subscriptionStatus === 'active' || tenant?.subscriptionStatus === 'past_due') row.paying += 1;
            bySource.set(key, row);
        }

        // TTFV (time-to-first-value): horas signup → primer canal conectado.
        const ttfc = (signups as any[])
            .filter(s => s.tenant?.firstChannelConnectedAt && s.createdAt)
            .map(s => (s.tenant.firstChannelConnectedAt.getTime() - s.createdAt.getTime()) / 3_600_000);
        ttfc.sort((a, b) => a - b);
        const medianTtfcHours = ttfc.length > 0 ? ttfc[Math.floor(ttfc.length / 2)] : null;

        const ttfm = (signups as any[])
            .filter(s => s.tenant?.firstMessageAt && s.createdAt)
            .map(s => (s.tenant.firstMessageAt.getTime() - s.createdAt.getTime()) / 3_600_000);
        ttfm.sort((a, b) => a - b);
        const medianTtfmHours = ttfm.length > 0 ? ttfm[Math.floor(ttfm.length / 2)] : null;
        const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 1000) / 10 : 0;

        return {
            window: { since: since.toISOString(), until: new Date().toISOString() },
            stages: [
                { key: 'signups',          label: 'Signups',                count: totalSignups,     conversionFromPrev: 100 },
                { key: 'onboarded',        label: 'Onboarding completado',  count: onboardingDone,   conversionFromPrev: pct(onboardingDone, totalSignups) },
                { key: 'channelConnected', label: 'Canal conectado',        count: channelConnected, conversionFromPrev: pct(channelConnected, onboardingDone) },
                { key: 'activated',        label: 'Primer mensaje',         count: firstMessage,     conversionFromPrev: pct(firstMessage, channelConnected) },
                { key: 'paying',           label: 'Pagando',                count: paying,           conversionFromPrev: pct(paying, firstMessage) },
            ],
            overallConversion: pct(paying, totalSignups),
            medianTimeToFirstChannelHours: medianTtfcHours,
            medianTimeToFirstMessageHours: medianTtfmHours,
            bySource: Array.from(bySource.values()).sort((a, b) => b.signups - a.signups),
        };
    }

    /**
     * Cross-tenant audit log viewer for super_admin. Filters are
     * additive — pass nothing to get the most recent 100 across the
     * platform; supply tenantId to scope to one tenant; supply action
     * (substring) to filter by event type. since=ISO date.
     */
    async getAuditLogs(filters: {
        tenantId?: string;
        action?: string;
        since?: string;
        limit?: number;
        offset?: number;
    }) {
        const where: any = {};
        if (filters.tenantId) where.tenantId = filters.tenantId;
        if (filters.action) where.action = { contains: filters.action };
        if (filters.since) where.createdAt = { gte: new Date(filters.since) };

        const [rows, total] = await Promise.all([
            this.prisma.auditLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: Math.min(filters.limit || 100, 500),
                skip: filters.offset || 0,
            }),
            this.prisma.auditLog.count({ where }),
        ]);

        // Hydrate tenantId → tenant.name in a single round-trip
        const tenantIds = Array.from(new Set(rows.map((r: any) => r.tenantId).filter(Boolean))) as string[];
        const tenants = tenantIds.length > 0
            ? await this.prisma.tenant.findMany({
                where: { id: { in: tenantIds } },
                select: { id: true, name: true, slug: true },
            })
            : [];
        const tenantMap = new Map<string, any>(tenants.map((t: any) => [t.id, t]));

        // Same for the actor. Without it the viewer can show WHAT happened but
        // never WHO did it — which would make the impersonation rows useless.
        const userIds = Array.from(new Set(rows.map((r: any) => r.userId).filter(Boolean))) as string[];
        const users = userIds.length > 0
            ? await this.prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, email: true, firstName: true, lastName: true, role: true },
            }).catch(() => [])
            : [];
        const userMap = new Map<string, any>(users.map((u: any) => [u.id, u]));

        return {
            total,
            rows: rows.map((r: any) => ({
                id: r.id,
                action: r.action,
                resource: r.resource,
                details: r.details,
                tenantId: r.tenantId,
                tenantName: r.tenantId ? tenantMap.get(r.tenantId)?.name : null,
                tenantSlug: r.tenantId ? tenantMap.get(r.tenantId)?.slug : null,
                userId: r.userId,
                actorEmail: r.userId ? userMap.get(r.userId)?.email ?? null : null,
                actorName: r.userId
                    ? [userMap.get(r.userId)?.firstName, userMap.get(r.userId)?.lastName]
                        .filter(Boolean).join(' ').trim() || null
                    : null,
                actorRole: r.userId ? userMap.get(r.userId)?.role ?? null : null,
                ip: r.ip,
                createdAt: r.createdAt,
            })),
        };
    }
}
