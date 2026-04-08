import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class TenantsService {
    private readonly logger = new Logger(TenantsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
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
    async findAll(page = 1, limit = 20) {
        const skip = (page - 1) * limit;

        const [tenants, total] = await Promise.all([
            this.prisma.tenant.findMany({
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    _count: {
                        select: {
                            users: true,
                            channelAccounts: true,
                        },
                    },
                },
            }),
            this.prisma.tenant.count(),
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
}
