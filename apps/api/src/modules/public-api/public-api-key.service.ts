import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import * as crypto from 'crypto';

const VALID_SCOPES = [
    'read:contacts', 'write:contacts',
    'read:deals', 'write:deals',
    'read:conversations', 'write:messages',
    'read:appointments', 'write:appointments',
    'read:webhooks', 'write:webhooks',
    'read:analytics',
] as const;

type ValidScope = (typeof VALID_SCOPES)[number];

const CACHE_TTL = 60;

@Injectable()
export class PublicApiKeyService {
    private readonly logger = new Logger(PublicApiKeyService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly throttle: TenantThrottleService,
    ) {}

    async createKey(
        tenantId: string,
        userId: string,
        data: { name: string; scopes: string[]; expiresAt?: Date },
    ): Promise<{ id: string; key: string; keyPrefix: string; name: string; scopes: string[]; expiresAt: Date | null }> {
        const enabled = await this.throttle.isFeatureEnabled(tenantId, 'publicApi');
        if (!enabled) {
            throw new BadRequestException('Public API is not available on your current plan');
        }

        const maxKeys = await this.throttle.getPlanLimit(tenantId, 'publicApiKeys');
        const existingCount = await this.prisma.apiKey.count({
            where: { tenantId, revokedAt: null },
        });
        if (existingCount >= maxKeys) {
            throw new BadRequestException(`API key limit reached (${maxKeys} allowed on your plan)`);
        }

        const invalidScopes = data.scopes.filter(s => !(VALID_SCOPES as readonly string[]).includes(s));
        if (invalidScopes.length > 0) {
            throw new BadRequestException(`Invalid scopes: ${invalidScopes.join(', ')}`);
        }

        const rawKey = 'pk_live_' + crypto.randomBytes(32).toString('hex');
        const keyPrefix = rawKey.substring(0, 12);
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const planFeatures = await this.throttle.getPlanFeatures(tenantId);
        const rpm = typeof planFeatures.publicApiRateLimit === 'number' ? planFeatures.publicApiRateLimit : 60;

        const record = await this.prisma.apiKey.create({
            data: {
                tenantId,
                keyPrefix,
                keyHash,
                name: data.name,
                scopes: data.scopes,
                rateLimitRpm: rpm,
                expiresAt: data.expiresAt || null,
                createdBy: userId,
                isActive: true,
            },
        });

        this.logger.log(`API key created: ${record.id} (tenant=${tenantId}, prefix=${keyPrefix})`);

        return {
            id: record.id,
            key: rawKey,
            keyPrefix,
            name: record.name,
            scopes: record.scopes,
            expiresAt: record.expiresAt,
        };
    }

    async listKeys(tenantId: string): Promise<Array<{
        id: string; keyPrefix: string; name: string; scopes: string[];
        rateLimitRpm: number; lastUsedAt: Date | null; expiresAt: Date | null;
        isActive: boolean; createdAt: Date;
    }>> {
        const keys = await this.prisma.apiKey.findMany({
            where: { tenantId, revokedAt: null },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true, keyPrefix: true, name: true, scopes: true,
                rateLimitRpm: true, lastUsedAt: true, expiresAt: true,
                isActive: true, createdAt: true,
            },
        });
        return keys;
    }

    async revokeKey(tenantId: string, keyId: string): Promise<void> {
        const key = await this.prisma.apiKey.findFirst({
            where: { id: keyId, tenantId },
        });
        if (!key) throw new NotFoundException('API key not found');

        await this.prisma.apiKey.update({
            where: { id: keyId },
            data: { revokedAt: new Date(), isActive: false },
        });

        await this.redis.del(`api_key:${key.keyHash}`);
        this.logger.log(`API key revoked: ${keyId} (tenant=${tenantId})`);
    }

    async rotateKey(
        tenantId: string,
        keyId: string,
    ): Promise<{ id: string; key: string; keyPrefix: string; name: string; scopes: string[]; expiresAt: Date | null }> {
        const existing = await this.prisma.apiKey.findFirst({
            where: { id: keyId, tenantId, revokedAt: null },
        });
        if (!existing) throw new NotFoundException('API key not found');

        await this.prisma.apiKey.update({
            where: { id: keyId },
            data: { revokedAt: new Date(), isActive: false },
        });
        await this.redis.del(`api_key:${existing.keyHash}`);

        const rawKey = 'pk_live_' + crypto.randomBytes(32).toString('hex');
        const keyPrefix = rawKey.substring(0, 12);
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const record = await this.prisma.apiKey.create({
            data: {
                tenantId,
                keyPrefix,
                keyHash,
                name: existing.name,
                scopes: existing.scopes,
                rateLimitRpm: existing.rateLimitRpm,
                expiresAt: existing.expiresAt,
                createdBy: existing.createdBy,
                isActive: true,
            },
        });

        this.logger.log(`API key rotated: ${keyId} -> ${record.id} (tenant=${tenantId})`);

        return {
            id: record.id,
            key: rawKey,
            keyPrefix,
            name: record.name,
            scopes: record.scopes,
            expiresAt: record.expiresAt,
        };
    }

    async validateKey(rawKey: string): Promise<{
        tenantId: string; scopes: string[]; keyId: string; rateLimitRpm: number;
    } | null> {
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const cacheKey = `api_key:${keyHash}`;

        const cached = await this.redis.getJson(cacheKey);
        if (cached) {
            return cached as { tenantId: string; scopes: string[]; keyId: string; rateLimitRpm: number };
        }

        const record = await this.prisma.apiKey.findUnique({ where: { keyHash } });
        if (!record) return null;
        if (!record.isActive) return null;
        if (record.revokedAt) return null;
        if (record.expiresAt && record.expiresAt < new Date()) return null;

        const result = {
            tenantId: record.tenantId,
            scopes: record.scopes,
            keyId: record.id,
            rateLimitRpm: record.rateLimitRpm,
        };

        await this.redis.setJson(cacheKey, result, CACHE_TTL);

        // Fire-and-forget: update lastUsedAt
        this.prisma.apiKey.update({
            where: { id: record.id },
            data: { lastUsedAt: new Date() },
        }).catch(() => {});

        return result;
    }
}
