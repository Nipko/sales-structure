import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WidgetTriggersService {
    private readonly logger = new Logger(WidgetTriggersService.name);

    constructor(private readonly prisma: PrismaService) {}

    async listTriggers(widgetConfigId: string): Promise<any[]> {
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
        await this.prisma.$queryRawUnsafe(
            `DELETE FROM public.widget_triggers WHERE id = $1::uuid`,
            triggerId,
        );
    }

    async getTriggersForWidget(widgetConfigId: string): Promise<any[]> {
        return this.prisma.$queryRawUnsafe(
            `SELECT id, name, conditions, condition_operator, action_type, action_config, frequency_minutes, priority
             FROM public.widget_triggers
             WHERE widget_config_id = $1::uuid AND is_active = true
             ORDER BY priority ASC`,
            widgetConfigId,
        );
    }

    async countTriggersForWidget(widgetConfigId: string): Promise<number> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int as count FROM public.widget_triggers WHERE widget_config_id = $1::uuid`,
            widgetConfigId,
        );
        return rows[0]?.count ?? 0;
    }
}
