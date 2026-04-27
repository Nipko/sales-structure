import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { LLMRouterService } from '../../../ai/router/llm-router.service';

@Injectable()
export class CrmInsightsService {
    private readonly logger = new Logger(CrmInsightsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private llmRouter: LLMRouterService,
    ) {}

    /**
     * Generate AI-powered next-best-action for a lead.
     * Considers: score, stage, last activity, message count, days since contact.
     */
    async getInsight(tenantId: string, leadId: string): Promise<{ action: string; reasoning: string } | null> {
        // Check cache (15 min)
        const cacheKey = `crm_insight:${tenantId}:${leadId}`;
        const cached = await this.redis.getJson<{ action: string; reasoning: string }>(cacheKey);
        if (cached) return cached;

        try {
            const schema = await this.getSchema(tenantId);

            // Gather lead context
            const lead = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT l.first_name, l.last_name, l.stage, l.score, l.phone, l.email, l.is_vip,
                        l.created_at, l.last_contacted_at, l.primary_intent,
                        c.name as company_name
                 FROM leads l
                 LEFT JOIN companies c ON c.id = l.company_id
                 WHERE l.id = $1::uuid LIMIT 1`,
                [leadId],
            );
            if (!lead?.length) return null;

            const l = lead[0];

            // Recent message count
            const msgCount = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*) as cnt FROM messages m
                 JOIN conversations c ON c.id = m.conversation_id
                 JOIN contacts ct ON ct.id = c.contact_id
                 JOIN leads ld ON ld.contact_id = ct.id
                 WHERE ld.id = $1::uuid AND m.created_at > NOW() - INTERVAL '7 days'`,
                [leadId],
            );

            const daysSinceContact = l.last_contacted_at
                ? Math.round((Date.now() - new Date(l.last_contacted_at).getTime()) / 86400000)
                : null;

            const context = `Lead: ${l.first_name || ''} ${l.last_name || ''} | Stage: ${l.stage} | Score: ${l.score}/10 | VIP: ${l.is_vip ? 'Yes' : 'No'} | Company: ${l.company_name || 'N/A'} | Phone: ${l.phone ? 'Yes' : 'No'} | Email: ${l.email ? 'Yes' : 'No'} | Intent: ${l.primary_intent || 'unknown'} | Messages last 7d: ${msgCount?.[0]?.cnt || 0} | Days since last contact: ${daysSinceContact ?? 'Never'} | Created: ${new Date(l.created_at).toLocaleDateString()}`;

            const prompt = `You are a CRM sales assistant. Given this lead data, suggest ONE specific next-best-action and explain why in 1-2 sentences.

${context}

Respond in JSON format: {"action": "...", "reasoning": "..."}
The action should be concrete (e.g., "Call to schedule a demo", "Send pricing info via WhatsApp", "Mark as lost — no engagement in 30 days").
Keep it under 40 words total. Respond in Spanish.`;

            const response = await this.llmRouter.execute({
                model: 'grok-4-1-fast-non-reasoning',
                messages: [{ role: 'user', content: prompt }],
                maxTokens: 150,
                temperature: 0.3,
            });

            const text = response?.content || '';
            // Extract JSON from response
            const jsonMatch = text.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const insight = { action: parsed.action || '', reasoning: parsed.reasoning || '' };
                await this.redis.setJson(cacheKey, insight, 900); // 15 min cache
                return insight;
            }

            return null;
        } catch (e: any) {
            this.logger.warn(`CRM insight generation failed: ${e.message}`);
            return null;
        }
    }

    private async getSchema(tenantId: string): Promise<string> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`;
        if (!tenant?.[0]?.schema_name) throw new Error('Tenant not found');
        return tenant[0].schema_name;
    }
}
