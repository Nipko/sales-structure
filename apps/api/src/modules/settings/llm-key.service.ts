import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as crypto from 'crypto';

const PROVIDER_TO_DB_KEY: Record<string, string> = {
    openai: 'llm.openai_api_key',
    anthropic: 'llm.anthropic_api_key',
    google: 'llm.google_ai_api_key',
    xai: 'llm.xai_api_key',
    deepseek: 'llm.deepseek_api_key',
};

const DB_KEY_TO_PROVIDER: Record<string, string> = Object.fromEntries(
    Object.entries(PROVIDER_TO_DB_KEY).map(([k, v]) => [v, k]),
);

const ENV_FALLBACKS: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    xai: 'XAI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
};

@Injectable()
export class LlmKeyService {
    private readonly logger = new Logger(LlmKeyService.name);
    private cache = new Map<string, string>();
    private cacheLoadedAt = 0;
    private readonly CACHE_TTL_MS = 30_000;

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    async getKey(provider: string): Promise<string | undefined> {
        await this.ensureCache();
        return this.cache.get(provider) || undefined;
    }

    async isConfigured(provider: string): Promise<boolean> {
        const key = await this.getKey(provider);
        return !!key && key.length > 5;
    }

    async setKey(provider: string, plainKey: string): Promise<void> {
        const dbKey = PROVIDER_TO_DB_KEY[provider];
        if (!dbKey) throw new Error(`Unknown LLM provider: ${provider}`);

        const value = plainKey ? this.encrypt(plainKey) : '';
        await this.prisma.$executeRaw`
            INSERT INTO platform_settings (key, value, category, is_secret, updated_at)
            VALUES (${dbKey}, ${value}, 'llm', true, NOW())
            ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
        `;

        this.invalidateCache();
        this.logger.log(`LLM key updated for provider: ${provider}`);
    }

    async deleteKey(provider: string): Promise<void> {
        await this.setKey(provider, '');
    }

    async getMaskedKeys(): Promise<Record<string, string>> {
        const result: Record<string, string> = {};
        for (const [provider, dbKey] of Object.entries(PROVIDER_TO_DB_KEY)) {
            const key = await this.getKey(provider);
            result[dbKey] = key ? ('•••' + key.slice(-4)) : '';
        }
        return result;
    }

    resolveProviderFromDbKey(dbKey: string): string | undefined {
        return DB_KEY_TO_PROVIDER[dbKey];
    }

    isLlmKeyField(key: string): boolean {
        return key in DB_KEY_TO_PROVIDER;
    }

    invalidateCache(): void {
        this.cache.clear();
        this.cacheLoadedAt = 0;
        this.redis.del('platform:settings').catch(() => {});
    }

    private async ensureCache(): Promise<void> {
        if (this.cacheLoadedAt > 0 && Date.now() - this.cacheLoadedAt < this.CACHE_TTL_MS) return;

        try {
            const rows = await this.prisma.$queryRaw<{ key: string; value: string }[]>`
                SELECT key, value FROM platform_settings
                WHERE key LIKE 'llm.%_api_key' AND value != ''
            `;

            this.cache.clear();
            for (const row of rows) {
                const provider = DB_KEY_TO_PROVIDER[row.key];
                if (!provider) continue;
                try {
                    const value = this.isEncrypted(row.value) ? this.decrypt(row.value) : row.value;
                    if (value && value.length > 5) this.cache.set(provider, value);
                } catch {
                    this.logger.warn(`Failed to decrypt key for ${provider} — re-save from dashboard`);
                }
            }
        } catch (e: any) {
            this.logger.warn(`Failed to load LLM keys from DB: ${e.message}`);
        }

        for (const [provider, envVar] of Object.entries(ENV_FALLBACKS)) {
            if (!this.cache.has(provider)) {
                const envVal = process.env[envVar];
                if (envVal && envVal.length > 5) this.cache.set(provider, envVal);
            }
        }

        this.cacheLoadedAt = Date.now();
    }

    private encrypt(plaintext: string): string {
        const key = process.env.ENCRYPTION_KEY;
        if (!key || key.length < 64) {
            this.logger.warn('ENCRYPTION_KEY not set — storing LLM key as base64 (DEV ONLY)');
            return Buffer.from(plaintext).toString('base64');
        }
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex').subarray(0, 32), iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${tag}:${encrypted}`;
    }

    private decrypt(ciphertext: string): string {
        const key = process.env.ENCRYPTION_KEY;
        if (!key || key.length < 64) {
            return Buffer.from(ciphertext, 'base64').toString('utf8');
        }
        const [ivHex, tagHex, encryptedHex] = ciphertext.split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex').subarray(0, 32), Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    private isEncrypted(value: string): boolean {
        if (!value.includes(':')) return false;
        const parts = value.split(':');
        return parts.length === 3 && parts[0].length === 32;
    }
}
