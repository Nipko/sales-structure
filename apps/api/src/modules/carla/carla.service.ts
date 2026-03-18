import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CarlaService {
    private readonly logger = new Logger(CarlaService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ─── Personality Profiles ─────────────────────────────────────────────────

    async getProfiles(schemaName: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM carla_personality_profiles ORDER BY created_at DESC`
        );
    }

    async createProfile(schemaName: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO carla_personality_profiles (tenant_id, name, tone, language, objectives_json, rules_json, disclaimers, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                data.tenant_id, data.name, data.tone || 'professional',
                data.language || 'es', JSON.stringify(data.objectives || []),
                JSON.stringify(data.rules || []), data.disclaimers || null,
                data.active ?? true
            ]
        );
        return rows[0];
    }

    async updateProfile(schemaName: string, id: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE carla_personality_profiles
             SET name = COALESCE($2, name),
                 tone = COALESCE($3, tone),
                 objectives_json = COALESCE($4, objectives_json),
                 rules_json = COALESCE($5, rules_json),
                 disclaimers = COALESCE($6, disclaimers),
                 active = COALESCE($7, active),
                 updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, data.name, data.tone, data.objectives ? JSON.stringify(data.objectives) : null,
             data.rules ? JSON.stringify(data.rules) : null, data.disclaimers, data.active]
        );
        return rows[0];
    }

    // ─── Prompt Templates ─────────────────────────────────────────────────────

    async getPromptTemplates(schemaName: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM carla_prompt_templates ORDER BY created_at DESC`
        );
    }

    async createPromptTemplate(schemaName: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO carla_prompt_templates (tenant_id, name, campaign_id, course_id, template_type, content, version, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                data.tenant_id, data.name, data.campaign_id || null,
                data.course_id || null, data.template_type || 'system',
                data.content, data.version || 1, data.active ?? true
            ]
        );
        return rows[0];
    }

    async updatePromptTemplate(schemaName: string, id: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE carla_prompt_templates
             SET name = COALESCE($2, name),
                 content = COALESCE($3, content),
                 active = COALESCE($4, active),
                 updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, data.name, data.content, data.active]
        );
        return rows[0];
    }

    // ─── Conversation Context ─────────────────────────────────────────────────

    async getConversationContexts(schemaName: string, conversationId?: string) {
        if (conversationId) {
            return this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM carla_conversation_context WHERE conversation_id = $1 ORDER BY created_at DESC`,
                [conversationId]
            );
        }
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM carla_conversation_context ORDER BY created_at DESC LIMIT 50`
        );
    }

    async saveConversationContext(schemaName: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO carla_conversation_context 
                (conversation_id, lead_id, intent_primary, intent_secondary, confidence, score_delta,
                 should_handoff, handoff_reason, summary_for_agent, tags_to_apply, suggested_stage, context_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
            [
                data.conversation_id, data.lead_id || null,
                data.intent_primary || null, data.intent_secondary || null,
                data.confidence || null, data.score_delta || 0,
                data.should_handoff ?? false, data.handoff_reason || null,
                data.summary_for_agent || null,
                data.tags_to_apply || [], data.suggested_stage || null,
                JSON.stringify(data.context_json || {})
            ]
        );
        return rows[0];
    }

    // ─── Context Builder (for LLM prompt) ─────────────────────────────────────

    async buildCarlaContext(schemaName: string, tenantId: string, conversationId: string) {
        // Fetch active personality
        const profiles = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM carla_personality_profiles WHERE active = true LIMIT 1`
        );
        const personality = profiles[0] || null;

        // Fetch active system prompt template
        const templates = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM carla_prompt_templates WHERE active = true AND template_type = 'system' ORDER BY version DESC LIMIT 1`
        );
        const systemPrompt = templates[0]?.content || '';

        // Fetch last context snapshot
        const contexts = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM carla_conversation_context WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [conversationId]
        );
        const lastContext = contexts[0] || null;

        return {
            personality,
            systemPrompt,
            lastContext,
            tenantId,
            conversationId
        };
    }
}
