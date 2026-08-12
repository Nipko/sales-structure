import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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

    async listTriggers(tenantId: string, widgetConfigId: string): Promise<any[]> {
        await this.ensureTable();
        // LEFT JOIN deliberately returns one ownership sentinel even when the
        // widget has no triggers. No row means the config does not belong to the
        // authenticated tenant (or does not exist), which must be indistinguishable.
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT wc.id AS owned_widget_config_id, wt.*
               FROM public.widget_configs wc
               LEFT JOIN public.widget_triggers wt
                 ON wt.widget_config_id = wc.id
              WHERE wc.tenant_id = $1::uuid
                AND wc.id = $2::uuid
              ORDER BY wt.priority ASC NULLS LAST, wt.created_at ASC NULLS LAST`,
            tenantId,
            widgetConfigId,
        );
        this.assertOwned(rows);
        return rows
            .filter((row) => Boolean(row.id))
            .map(({ owned_widget_config_id: _ownedWidgetConfigId, ...trigger }) => trigger);
    }

    async createTrigger(tenantId: string, widgetConfigId: string, data: {
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
             SELECT wc.id, $3, $4::jsonb, $5, $6, $7::jsonb, $8, $9, $10
               FROM public.widget_configs wc
              WHERE wc.tenant_id = $1::uuid
                AND wc.id = $2::uuid
             RETURNING *`,
            tenantId,
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
        return this.assertOwned(rows)[0];
    }

    async updateTrigger(tenantId: string, triggerId: string, data: {
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
            `UPDATE public.widget_triggers AS wt
             SET name = COALESCE($3, wt.name),
                 conditions = COALESCE($4::jsonb, wt.conditions),
                 condition_operator = COALESCE($5, wt.condition_operator),
                 action_type = COALESCE($6, wt.action_type),
                 action_config = COALESCE($7::jsonb, wt.action_config),
                 frequency_minutes = COALESCE($8, wt.frequency_minutes),
                 is_active = COALESCE($9, wt.is_active),
                 priority = COALESCE($10, wt.priority),
                 updated_at = NOW()
             FROM public.widget_configs AS wc
             WHERE wt.id = $2::uuid
               AND wc.id = wt.widget_config_id
               AND wc.tenant_id = $1::uuid
             RETURNING wt.*`,
            tenantId,
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
        return this.assertOwned(rows)[0];
    }

    async deleteTrigger(tenantId: string, triggerId: string): Promise<{ widget_config_id: string }> {
        await this.ensureTable();
        const rows: Array<{ widget_config_id: string }> = await this.prisma.$queryRawUnsafe(
            `DELETE FROM public.widget_triggers AS wt
              USING public.widget_configs AS wc
              WHERE wt.id = $2::uuid
                AND wc.id = wt.widget_config_id
                AND wc.tenant_id = $1::uuid
              RETURNING wt.widget_config_id`,
            tenantId,
            triggerId,
        );
        return this.assertOwned(rows)[0];
    }

    async getTriggersForWidget(tenantId: string, widgetConfigId: string): Promise<any[]> {
        await this.ensureTable();
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT wt.conditions, wt.condition_operator, wt.action_type,
                    wt.action_config, wt.frequency_minutes, wt.priority
               FROM public.widget_triggers wt
               JOIN public.widget_configs wc ON wc.id = wt.widget_config_id
              WHERE wc.tenant_id = $1::uuid
                AND wc.id = $2::uuid
                AND wc.is_active = true
                AND wt.is_active = true
              ORDER BY wt.priority ASC`,
            tenantId,
            widgetConfigId,
        );
        // Keep an explicit public allowlist as defense in depth. Admin labels,
        // database UUIDs and timestamps are not part of the browser contract.
        return rows.map((row) => ({
            conditions: row.conditions,
            condition_operator: row.condition_operator,
            action_type: row.action_type,
            action_config: row.action_config,
            frequency_minutes: row.frequency_minutes,
            priority: row.priority,
        }));
    }

    async countTriggersForWidget(tenantId: string, widgetConfigId: string): Promise<number> {
        await this.ensureTable();
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(wt.id)::int AS count
               FROM public.widget_configs wc
               LEFT JOIN public.widget_triggers wt ON wt.widget_config_id = wc.id
              WHERE wc.tenant_id = $1::uuid
                AND wc.id = $2::uuid
              GROUP BY wc.id`,
            tenantId,
            widgetConfigId,
        );
        return this.assertOwned(rows)[0].count ?? 0;
    }

    private assertOwned<T>(rows: T[]): T[] {
        if (!rows?.length) {
            throw new NotFoundException('Widget trigger resource not found');
        }
        return rows;
    }
}
