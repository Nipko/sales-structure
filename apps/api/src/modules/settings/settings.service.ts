import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface PlatformSettings {
    llm: {
        openai_api_key?: string;
        anthropic_api_key?: string;
        google_ai_api_key?: string;
        xai_api_key?: string;
        deepseek_api_key?: string;
        default_model?: string;
        default_temperature?: number;
        max_tokens?: number;
    };
    whatsapp: {
        verify_token?: string;
        app_secret?: string;
        phone_number_id?: string;
        access_token?: string;
        business_account_id?: string;
    };
    chatwoot: {
        url?: string;
        api_token?: string;
        account_id?: string;
        inbox_id?: string;
    };
    general: {
        platform_name?: string;
        default_language?: string;
        default_timezone?: string;
        max_conversations_per_tenant?: number;
        enable_analytics?: boolean;
        enable_rag?: boolean;
    };
}

@Injectable()
export class SettingsService {
    private readonly logger = new Logger(SettingsService.name);
    private readonly CACHE_KEY = 'platform:settings';
    private readonly CACHE_TTL = 300; // 5 minutes

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    /**
     * Get all platform settings (from cache or DB)
     */
    async getSettings(): Promise<PlatformSettings> {
        // Try cache first
        const cached = await this.redis.getJson<PlatformSettings>(this.CACHE_KEY);
        if (cached) return cached;

        // Fetch from DB
        const rows = await this.prisma.$queryRaw<any[]>`
      SELECT key, value, is_secret FROM platform_settings ORDER BY category, key
    `;

        const settings = this.rowsToSettings(rows);
        await this.redis.setJson(this.CACHE_KEY, settings, this.CACHE_TTL);
        return settings;
    }

    /**
     * Get settings for display (masks secrets)
     */
    async getSettingsForDisplay(): Promise<PlatformSettings> {
        const rows = await this.prisma.$queryRaw<any[]>`
      SELECT key, value, is_secret, category, label FROM platform_settings ORDER BY category, key
    `;

        const settings = this.rowsToSettings(rows, true);
        return settings;
    }

    /**
     * Update one or more settings
     */
    async updateSettings(updates: Record<string, string>): Promise<void> {
        for (const [key, value] of Object.entries(updates)) {
            if (value === undefined || value === null) continue;
            // Skip masked values (user didn't change them)
            if (value.includes('•••')) continue;

            await this.prisma.$executeRaw`
        INSERT INTO platform_settings (key, value, updated_at)
        VALUES (${key}, ${value}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
      `;
        }

        // Invalidate cache
        await this.redis.del(this.CACHE_KEY);
        this.logger.log(`Updated ${Object.keys(updates).length} settings`);
    }

    /**
     * Get a specific setting value
     */
    async getValue(key: string): Promise<string | null> {
        const settings = await this.getSettings();
        const [category, field] = key.split('.');
        return (settings as any)[category]?.[field] || null;
    }

    /**
     * Convert DB rows to structured settings
     */
    private rowsToSettings(rows: any[], maskSecrets = false): PlatformSettings {
        const settings: PlatformSettings = {
            llm: {},
            whatsapp: {},
            chatwoot: {},
            general: { enable_analytics: true, enable_rag: true },
        };

        for (const row of rows) {
            const [category, field] = row.key.split('.');
            if (category && field && (settings as any)[category] !== undefined) {
                let value = row.value;
                if (maskSecrets && row.is_secret && value) {
                    // Show only last 4 characters
                    value = '•••' + value.slice(-4);
                }
                (settings as any)[category][field] = value;
            }
        }

        return settings;
    }
}
