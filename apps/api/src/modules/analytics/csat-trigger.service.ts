import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class CsatTriggerService {
    private readonly logger = new Logger(CsatTriggerService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`
            SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
        `;
        if (tenant && tenant.length > 0) {
            const schema = tenant[0].schema_name;
            await this.redis.set(`tenant:${tenantId}:schema`, schema, 3600);
            return schema;
        }
        return null;
    }

    async triggerCSATSurvey(tenantId: string, conversationId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Insert survey record
        const result = await this.prisma.executeInTenantSchema<any[]>(schema, `
            INSERT INTO csat_surveys (conversation_id, sent_at)
            VALUES ($1::uuid, NOW())
            RETURNING *
        `, [conversationId]);

        // Set Redis flag for pending CSAT
        await this.redis.set(`csat:pending:${conversationId}`, '1', 86400); // 24h TTL

        this.logger.log(`Triggered CSAT survey for conversation ${conversationId}`);

        const surveyText = 'Del 1 al 5, donde 1 es muy insatisfecho y 5 es muy satisfecho, como calificarias tu experiencia con nosotros? Tambien puedes dejarnos un comentario adicional.';

        return {
            survey: result[0],
            message: surveyText,
        };
    }

    async processCSATResponse(tenantId: string, conversationId: string, rating: number, feedback?: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const params: any[] = [Number(rating), conversationId];
        let feedbackClause = '';
        if (feedback !== undefined) {
            feedbackClause = ', feedback = $3';
            params.push(feedback);
        }

        const result = await this.prisma.executeInTenantSchema<any[]>(schema, `
            UPDATE csat_surveys
            SET rating = $1, responded_at = NOW()${feedbackClause}
            WHERE conversation_id = $2::uuid AND responded_at IS NULL
            RETURNING *
        `, params);

        // Clear Redis flag
        await this.redis.del(`csat:pending:${conversationId}`);

        this.logger.log(`Processed CSAT response for conversation ${conversationId}: rating=${rating}`);
        return result[0] || null;
    }

    async hasPendingCSAT(tenantId: string, conversationId: string): Promise<boolean> {
        const flag = await this.redis.get(`csat:pending:${conversationId}`);
        return flag === '1';
    }

    async getCSATReport(tenantId: string, startDate: string, endDate: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Average rating and count by rating
        const summary = await this.prisma.executeInTenantSchema<any[]>(schema, `
            SELECT
                AVG(rating)::numeric(3,2) as avg_rating,
                COUNT(*)::int as total_responses,
                COUNT(*) FILTER (WHERE rating = 1)::int as rating_1,
                COUNT(*) FILTER (WHERE rating = 2)::int as rating_2,
                COUNT(*) FILTER (WHERE rating = 3)::int as rating_3,
                COUNT(*) FILTER (WHERE rating = 4)::int as rating_4,
                COUNT(*) FILTER (WHERE rating = 5)::int as rating_5
            FROM csat_surveys
            WHERE responded_at IS NOT NULL
              AND sent_at >= $1::timestamp
              AND sent_at <= $2::timestamp
        `, [startDate, endDate]);

        // Trend by date
        const trend = await this.prisma.executeInTenantSchema<any[]>(schema, `
            SELECT
                DATE(sent_at) as date,
                AVG(rating)::numeric(3,2) as avg_rating,
                COUNT(*)::int as responses
            FROM csat_surveys
            WHERE responded_at IS NOT NULL
              AND sent_at >= $1::timestamp
              AND sent_at <= $2::timestamp
            GROUP BY DATE(sent_at)
            ORDER BY date ASC
        `, [startDate, endDate]);

        return {
            summary: summary[0] || null,
            trend,
        };
    }
}
