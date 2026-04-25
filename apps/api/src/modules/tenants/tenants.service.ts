import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

@Injectable()
export class TenantsService {
    private readonly logger = new Logger(TenantsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private throttle: TenantThrottleService,
        @InjectQueue('outbound-messages') private outboundQueue: Queue,
        @InjectQueue('broadcast-messages') private broadcastQueue: Queue,
        @InjectQueue('automation-jobs') private automationQueue: Queue,
        @InjectQueue('nurturing') private nurturingQueue: Queue,
        @InjectQueue('conversation-snooze') private snoozeQueue: Queue,
    ) { }

    /**
     * Create a new tenant with its isolated database schema
     */
    async create(data: {
        name: string;
        slug: string;
        industry: string;
        language?: string;
        plan?: string;
    }) {
        // Check slug uniqueness
        const existing = await this.prisma.tenant.findUnique({
            where: { slug: data.slug },
        });
        if (existing) {
            throw new ConflictException(`Tenant slug "${data.slug}" already exists`);
        }

        const schemaName = `tenant_${data.slug.replace(/-/g, '_')}`;

        // Create tenant record
        const tenant = await this.prisma.tenant.create({
            data: {
                name: data.name,
                slug: data.slug,
                industry: data.industry,
                language: data.language || 'es-CO',
                schemaName,
                plan: data.plan || 'starter',
            },
        });

        // Create isolated database schema
        try {
            this.logger.log(`Creating schema "${schemaName}" for tenant "${data.name}"...`);
            await this.prisma.createTenantSchema(schemaName);
            this.logger.log(`Schema "${schemaName}" created successfully`);
        } catch (error) {
            // Rollback tenant creation if schema fails
            this.logger.error(`Failed to create schema: ${error}`);
            await this.prisma.tenant.delete({ where: { id: tenant.id } });
            throw error;
        }

        // Audit log
        await this.prisma.auditLog.create({
            data: {
                tenantId: tenant.id,
                action: 'tenant_created',
                resource: 'tenant',
                details: { name: data.name, slug: data.slug, schemaName },
            },
        });

        return tenant;
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

        return { tenants, total, page, limit };
    }

    /**
     * Get tenant by ID with caching
     */
    async findById(id: string) {
        // Check cache first
        const cached = await this.redis.getJson<any>(`tenant:${id}:config`);
        if (cached) return cached;

        const tenant = await this.prisma.tenant.findUnique({
            where: { id },
            include: {
                channelAccounts: true,
                _count: {
                    select: { users: true },
                },
            },
        });

        if (!tenant) {
            throw new NotFoundException(`Tenant ${id} not found`);
        }

        // Cache for 5 minutes
        await this.redis.setJson(`tenant:${id}:config`, tenant, 300);

        return tenant;
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

        return tenant;
    }

    /**
     * Get the schema name for a tenant
     */
    async getSchemaName(tenantId: string): Promise<string> {
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
     * Update tenant settings
     */
    async update(id: string, data: Partial<{ name: string; industry: string; language: string; isActive: boolean; settings: any }>) {
        // Merge settings with existing instead of replacing
        if (data.settings) {
            const existing = await this.prisma.tenant.findUnique({ where: { id }, select: { settings: true } });
            const existingSettings = (existing?.settings as any) || {};
            data.settings = { ...existingSettings, ...data.settings };
        }

        const tenant = await this.prisma.tenant.update({
            where: { id },
            data,
        });

        // Invalidate cache
        await this.redis.del(`tenant:${id}:config`);
        await this.redis.del(`tenant:${id}:schema`);

        return tenant;
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

        // Invalidate cache
        await this.redis.del(`tenant:${id}:config`);

        return tenant;
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
}
