import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantsService } from '../tenants/tenants.service';
import type { Policy, PolicyType } from '@parallext/shared';

const VALID_TYPES: PolicyType[] = ['shipping', 'return', 'warranty', 'cancellation', 'terms', 'privacy'];

/**
 * Policies service — versioned legal/operational policies.
 *
 * Critical data: the agent surfaces these via the `get_policy(type)` tool and
 * MUST NOT invent them. Every update creates a new version while deactivating
 * the previous active one, so history is preserved.
 */
@Injectable()
export class PoliciesService {
    private readonly logger = new Logger(PoliciesService.name);
    private readonly initialized = new Set<string>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly tenantsService: TenantsService,
    ) {}

    private async ensureSchema(tenantId: string): Promise<string> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        if (this.initialized.has(tenantId)) return schemaName;
        const stmts = [
            `CREATE TABLE IF NOT EXISTS "${schemaName}"."policies" (
                "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
                "type" VARCHAR(50) NOT NULL,
                "title" VARCHAR(500) NOT NULL,
                "content" TEXT NOT NULL,
                "version" INTEGER NOT NULL DEFAULT 1,
                "effective_from" TIMESTAMP DEFAULT NOW(),
                "effective_to" TIMESTAMP,
                "is_active" BOOLEAN DEFAULT true,
                "created_by" VARCHAR(255),
                "created_at" TIMESTAMP DEFAULT NOW(),
                "updated_at" TIMESTAMP DEFAULT NOW()
            )`,
            `CREATE UNIQUE INDEX IF NOT EXISTS "idx_policies_active_type_${schemaName}" ON "${schemaName}"."policies" ("type") WHERE "is_active" = true`,
            `CREATE INDEX IF NOT EXISTS "idx_policies_type_version_${schemaName}" ON "${schemaName}"."policies" ("type", "version" DESC)`,
        ];
        for (const sql of stmts) {
            try { await this.prisma.$executeRawUnsafe(sql); }
            catch (e: any) { this.logger.warn(`policies ensureSchema failed: ${e.message}`); }
        }
        this.initialized.add(tenantId);
        return schemaName;
    }

    /** List all ACTIVE policies (one per type) for editing UI. */
    async listActive(tenantId: string): Promise<Policy[]> {
        const schemaName = await this.ensureSchema(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT id, type, title, content, version, effective_from, effective_to, is_active, created_at, updated_at
             FROM "${schemaName}"."policies"
             WHERE is_active = true
             ORDER BY type ASC`,
        ) as any[];
        return rows.map(this.rowToPolicy);
    }

    /** Get the current active policy for a given type. Returns null if none configured. */
    async getActive(tenantId: string, type: PolicyType): Promise<Policy | null> {
        if (!VALID_TYPES.includes(type)) throw new BadRequestException(`Invalid policy type: ${type}`);
        const cacheKey = `policy:${tenantId}:${type}:active`;
        const cached = await this.redis.getJson<Policy>(cacheKey);
        if (cached) return cached;

        const schemaName = await this.ensureSchema(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT id, type, title, content, version, effective_from, effective_to, is_active, created_at, updated_at
             FROM "${schemaName}"."policies"
             WHERE type = $1 AND is_active = true
             LIMIT 1`,
            type,
        ) as any[];
        if (rows.length === 0) return null;
        const policy = this.rowToPolicy(rows[0]);
        await this.redis.setJson(cacheKey, policy, 600);
        return policy;
    }

    /** Full version history for a type — for audit / rollback UI. */
    async listVersions(tenantId: string, type: PolicyType): Promise<Policy[]> {
        if (!VALID_TYPES.includes(type)) throw new BadRequestException(`Invalid policy type: ${type}`);
        const schemaName = await this.ensureSchema(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT id, type, title, content, version, effective_from, effective_to, is_active, created_at, updated_at
             FROM "${schemaName}"."policies"
             WHERE type = $1
             ORDER BY version DESC`,
            type,
        ) as any[];
        return rows.map(this.rowToPolicy);
    }

    /**
     * Create a new version of a policy. Deactivates the previous active one
     * so the unique-active-per-type constraint holds. The new version number
     * is `max(version)+1`.
     */
    async upsert(tenantId: string, input: UpsertPolicyInput, createdBy?: string): Promise<Policy> {
        if (!VALID_TYPES.includes(input.type)) throw new BadRequestException(`Invalid policy type: ${input.type}`);
        const schemaName = await this.ensureSchema(tenantId);

        // Deactivate current active version
        await this.prisma.$executeRawUnsafe(
            `UPDATE "${schemaName}"."policies"
                SET is_active = false, effective_to = NOW(), updated_at = NOW()
              WHERE type = $1 AND is_active = true`,
            input.type,
        );

        // Determine next version number
        const verRows = await this.prisma.$queryRawUnsafe(
            `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM "${schemaName}"."policies" WHERE type = $1`,
            input.type,
        ) as any[];
        const nextVersion = verRows[0]?.next_version ?? 1;

        const rows = await this.prisma.$queryRawUnsafe(
            `INSERT INTO "${schemaName}"."policies"
                (type, title, content, version, is_active, created_by)
             VALUES ($1, $2, $3, $4, true, $5)
             RETURNING id, type, title, content, version, effective_from, effective_to, is_active, created_at, updated_at`,
            input.type, input.title, input.content, nextVersion, createdBy ?? 'system',
        ) as any[];

        await this.redis.del(`policy:${tenantId}:${input.type}:active`);
        return this.rowToPolicy(rows[0]);
    }

    async delete(tenantId: string, id: string): Promise<void> {
        const schemaName = await this.ensureSchema(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `DELETE FROM "${schemaName}"."policies" WHERE id = $1::uuid RETURNING type`,
            id,
        ) as any[];
        if (rows.length === 0) throw new NotFoundException('Policy not found');
        await this.redis.del(`policy:${tenantId}:${rows[0].type}:active`);
    }

    async getPublicBySlug(slug: string, type: PolicyType): Promise<Policy | null> {
        const tenant = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        return this.getActive(tenant.id, type);
    }

    private rowToPolicy(r: any): Policy {
        return {
            id: r.id,
            type: r.type as PolicyType,
            title: r.title,
            content: r.content,
            version: r.version,
            effectiveFrom: r.effective_from,
            effectiveTo: r.effective_to ?? undefined,
            isActive: !!r.is_active,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }
}

export interface UpsertPolicyInput {
    type: PolicyType;
    title: string;
    content: string;
}
