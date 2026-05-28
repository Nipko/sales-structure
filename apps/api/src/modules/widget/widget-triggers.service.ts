import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class WidgetTriggersService {
    private readonly logger = new Logger(WidgetTriggersService.name);
    private readonly TABLE_CACHE_KEY = 'widget_triggers_table_ok';

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    private async ensureTable(): Promise<void> {
        const cached = await this.redis.get(this.TABLE_CACHE_KEY);
        if (cached) return;

        await this.prisma.$queryRawUnsafe(
            `CREATE TABLE IF NOT EXISTS public.widget_triggers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                widget_config_id UUID NOT NULL,
                name TEXT NOT NULL,
                conditions JSONB DEFAULT '[]',
                condition_operator TEXT DEFAULT 'AND',
                action_type TEXT DEFAULT 'show_bubble_message',
                action_config JSONB DEFAULT '{}',
                frequency_minutes INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT true,
                priority INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )`,
        );

        await this.prisma.$queryRawUnsafe(
            `CREATE INDEX IF NOT EXISTS idx_widget_triggers_config
             ON public.widget_triggers (widget_config_id)
             WHERE is_active = true`,
        );

        await this.redis.set(this.TABLE_CACHE_KEY, '1', 86400);
        this.logger.log('widget_triggers table ensured');
    }

    async listTriggers(widgetConfigId: string): Promise<any[]> {
        await this.ensureTable();
        return this.prisma.$queryRawUnsafe(
            `SELECT * FROM public.widget_triggers
             WHERE widget_config_id = $1::uuid
             ORDER BY priority ASC, created_at ASC`,
            widgetConfigId,
        );
    }

    async createTrigger(widgetConfigId: string, data: {
        name: string;
        conditions?: any[];
        conditionOperator?: string;
        actionType?: string;
        actionConfig?: any;
        frequencyMinutes?: number;
        isActive?: boolean;
        priority?: number;
    }): Promise<any> {
        await this.ensureTable();
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `INSERT INTO public.widget_triggers
             (widget_config_id, name, conditions, condition_operator, action_type, action_config, frequency_minutes, is_active, priority)
             VALUES ($1::uuid, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8, $9)
             RETURNING *`,
            widgetConfigId,
            data.name,
            JSON.stringify(data.conditions || []),
            data.conditionOperator || 'AND',
            data.actionType || 'show_bubble_message',
            JSON.stringify(data.actionConfig || {}),
            data.frequencyMinutes ?? 0,
            data.isActive ?? true,
            data.priority ?? 0,
        );
        return rows[0];
    }

    async updateTrigger(triggerId: string, data: {
        name?: string;
        conditions?: any[];
        conditionOperator?: string;
        actionType?: string;
        actionConfig?: any;
        frequencyMinutes?: number;
        isActive?: boolean;
        priority?: number;
    }): Promise<any> {
        await this.ensureTable();
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `UPDATE public.widget_triggers
             SET name = COALESCE($2, name),
                 conditions = COALESCE($3::jsonb, conditions),
                 condition_operator = COALESCE($4, condition_operator),
                 action_type = COALESCE($5, action_type),
                 action_config = COALESCE($6::jsonb, action_config),
                 frequency_minutes = COALESCE($7, frequency_minutes),
                 is_active = COALESCE($8, is_active),
                 priority = COALESCE($9, priority),
                 updated_at = NOW()
             WHERE id = $1::uuid
             RETURNING *`,
            triggerId,
            data.name ?? null,
            data.conditions ? JSON.stringify(data.conditions) : null,
            data.conditionOperator ?? null,
            data.actionType ?? null,
            data.actionConfig ? JSON.stringify(data.actionConfig) : null,
            data.frequencyMinutes ?? null,
            data.isActive ?? null,
            data.priority ?? null,
        );
        return rows[0];
    }

    async deleteTrigger(triggerId: string): Promise<void> {
        await this.ensureTable();
        await this.prisma.$queryRawUnsafe(
            `DELETE FROM public.widget_triggers WHERE id = $1::uuid`,
            triggerId,
        );
    }

    async getTriggersForWidget(widgetConfigId: string): Promise<any[]> {
        await this.ensureTable();
        return this.prisma.$queryRawUnsafe(
            `SELECT id, name, conditions, condition_operator, action_type, action_config, frequency_minutes, priority
             FROM public.widget_triggers
             WHERE widget_config_id = $1::uuid AND is_active = true
             ORDER BY priority ASC`,
            widgetConfigId,
        );
    }

    async countTriggersForWidget(widgetConfigId: string): Promise<number> {
        await this.ensureTable();
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int as count FROM public.widget_triggers WHERE widget_config_id = $1::uuid`,
            widgetConfigId,
        );
        return rows[0]?.count ?? 0;
    }
}
