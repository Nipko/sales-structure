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
            select: { id: true, schemaName: true, settings: true },
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

        // Channel accounts from global table
        const channelsConnected = await this.prisma.channelAccount.count({
            where: { tenantId, isActive: true },
        });

        // Vertical info from tenant.settings JSONB
        const settings = (tenant.settings as any) || {};
        const vertical: string | null = settings.verticalConfig?.industry || null;
        const subType: string | null = settings.verticalConfig?.subType || null;

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
            subType,
            healthScore,
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
     * Acquisition funnel: signups → onboarding done → first message
     * → first paying. Counts tenants created within the window plus
     * step-to-step conversion rates and a signup-source breakdown.
     */
    async getOnboardingFunnel(since: Date) {
        const tenants = await this.prisma.tenant.findMany({
            where: { createdAt: { gte: since } },
            select: {
                id: true,
                createdAt: true,
                onboardingCompletedAt: true,
                firstMessageAt: true,
                signupSource: true,
                subscriptionStatus: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        const totalSignups = tenants.length;
        const onboardingDone = tenants.filter((t: any) => t.onboardingCompletedAt).length;
        const firstMessage = tenants.filter((t: any) => t.firstMessageAt).length;
        const paying = tenants.filter((t: any) =>
            t.subscriptionStatus === 'active' || t.subscriptionStatus === 'past_due'
        ).length;

        const bySource = new Map<string, { source: string; signups: number; onboarded: number; activated: number; paying: number }>();
        for (const t of tenants as any[]) {
            const key = (t.signupSource || 'unknown').slice(0, 40);
            const row = bySource.get(key) || { source: key, signups: 0, onboarded: 0, activated: 0, paying: 0 };
            row.signups += 1;
            if (t.onboardingCompletedAt) row.onboarded += 1;
            if (t.firstMessageAt) row.activated += 1;
            if (t.subscriptionStatus === 'active' || t.subscriptionStatus === 'past_due') row.paying += 1;
            bySource.set(key, row);
        }

        const ttfm = (tenants as any[])
            .filter(t => t.firstMessageAt && t.createdAt)
            .map(t => (t.firstMessageAt.getTime() - t.createdAt.getTime()) / 3_600_000);
        ttfm.sort((a, b) => a - b);
        const medianTtfmHours = ttfm.length > 0 ? ttfm[Math.floor(ttfm.length / 2)] : null;
        const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 1000) / 10 : 0;

        return {
            window: { since: since.toISOString(), until: new Date().toISOString() },
            stages: [
                { key: 'signups',    label: 'Signups',                count: totalSignups,    conversionFromPrev: 100 },
                { key: 'onboarded',  label: 'Onboarding completado',  count: onboardingDone,  conversionFromPrev: pct(onboardingDone, totalSignups) },
                { key: 'activated',  label: 'Primer mensaje',         count: firstMessage,    conversionFromPrev: pct(firstMessage, onboardingDone) },
                { key: 'paying',     label: 'Pagando',                count: paying,          conversionFromPrev: pct(paying, firstMessage) },
            ],
            overallConversion: pct(paying, totalSignups),
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
                createdAt: r.createdAt,
            })),
        };
    }
}
