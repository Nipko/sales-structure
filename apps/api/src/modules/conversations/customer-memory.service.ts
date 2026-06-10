import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LLMRouterService } from '../ai/router/llm-router.service';

export interface CustomerMemory {
    facts: string[];
    summary?: string;
}

const MAX_FACTS = 12;          // cap stored facts so the block stays compact
const MEMORY_BLOCK_FACTS = 8;  // how many to inject into the prompt

/**
 * Long-term customer memory (#1, Phase 1). Mem0-style extract+update done by a
 * cheap LLM (no pgvector yet — one compact memory row per contact; the model
 * merges/dedups facts). Injected each turn so the agent doesn't "forget" the
 * customer across sessions / the 30-min new-session gap.
 *
 * Phase 2 (noted, not built): pgvector for semantic dedup/retrieval at scale and
 * keying by the unified IdentityService customer instead of per-contact.
 */
@Injectable()
export class CustomerMemoryService {
    private readonly logger = new Logger(CustomerMemoryService.name);
    private readonly ensuredSchemas = new Set<string>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly llmRouter: LLMRouterService,
    ) {}

    private async ensureTable(schema: string): Promise<void> {
        if (this.ensuredSchemas.has(schema)) return;
        try {
            await this.prisma.executeInTenantSchema(schema,
                `CREATE TABLE IF NOT EXISTS customer_memories (
                    contact_id UUID PRIMARY KEY,
                    facts JSONB NOT NULL DEFAULT '[]'::jsonb,
                    summary TEXT,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                 )`);
            this.ensuredSchemas.add(schema);
        } catch (e: any) {
            if (/already exists|duplicate|23505|42P07/i.test(e?.message || '')) {
                this.ensuredSchemas.add(schema);
            } else {
                this.logger.warn(`[Memory] ensureTable failed for ${schema}: ${e.message}`);
            }
        }
    }

    /** Compact memory for prompt injection. Returns null when nothing is known. */
    async getMemory(schema: string, contactId: string): Promise<CustomerMemory | null> {
        if (!contactId) return null;
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT facts, summary FROM customer_memories WHERE contact_id = $1::uuid`,
                [contactId]);
            const row = rows?.[0];
            if (!row) return null;
            const facts = Array.isArray(row.facts) ? row.facts.filter((f: any) => typeof f === 'string') : [];
            if (!facts.length && !row.summary) return null;
            return { facts: facts.slice(0, MEMORY_BLOCK_FACTS), summary: row.summary || undefined };
        } catch {
            // Table not created yet for this tenant, or a transient error — no memory.
            return null;
        }
    }

    /**
     * Extract durable facts + a rolling summary from a conversation and merge them
     * into the contact's memory. Best-effort, fire-and-forget — never throws into
     * the chat pipeline.
     */
    async extractFromConversation(tenantId: string, schema: string, conversationId: string, contactId: string): Promise<void> {
        if (!contactId || !conversationId) return;
        try {
            const msgs = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT direction, content_text FROM messages
                 WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 30`,
                [conversationId]);
            if (!msgs?.length) return;

            const transcript = msgs.reverse()
                .map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${(m.content_text || '').slice(0, 300)}`)
                .join('\n');

            await this.ensureTable(schema);
            const existing = await this.getMemory(schema, contactId);

            const prompt = `Sos un sistema de memoria de cliente. A partir de la memoria previa y el historial reciente, ` +
                `devolvé un JSON {"facts": string[], "summary": string}:\n` +
                `- facts: hechos DURADEROS y útiles del cliente (preferencias, datos, intereses, contexto recurrente). ` +
                `Fusioná con los previos, eliminá duplicados y lo obsoleto, máximo ${MAX_FACTS}, en español, cada uno breve. ` +
                `No guardes datos sensibles innecesarios.\n` +
                `- summary: 1-2 frases sobre quién es este cliente y en qué anda.\n\n` +
                `Memoria previa: ${JSON.stringify(existing || { facts: [], summary: '' })}\n\n` +
                `Historial reciente:\n${transcript}\n\nDevolvé SOLO el JSON.`;

            const resp = await this.llmRouter.execute({
                task: 'conversation',
                messages: [{ role: 'user', content: prompt }],
                systemPrompt: 'Extraés memoria estructurada de clientes. Devolvés SOLO JSON válido, sin texto adicional.',
                temperature: 0.2,
                tenantId,
            });

            const parsed = this.parseJson(resp.content);
            if (!parsed) return;
            const facts = Array.isArray(parsed.facts)
                ? parsed.facts.filter((f: any) => typeof f === 'string' && f.trim()).map((f: string) => f.trim()).slice(0, MAX_FACTS)
                : [];
            const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
                ? parsed.summary.trim().slice(0, 500)
                : (existing?.summary ?? null);
            if (!facts.length && !summary) return;

            await this.prisma.executeInTenantSchema(schema,
                `INSERT INTO customer_memories (contact_id, facts, summary, updated_at)
                 VALUES ($1::uuid, $2::jsonb, $3, NOW())
                 ON CONFLICT (contact_id) DO UPDATE SET facts = EXCLUDED.facts, summary = EXCLUDED.summary, updated_at = NOW()`,
                [contactId, JSON.stringify(facts), summary]);

            this.logger.log(`[Memory] Updated memory for contact ${contactId} (${facts.length} facts)`);
        } catch (e: any) {
            this.logger.warn(`[Memory] extract failed for contact ${contactId}: ${e.message}`);
        }
    }

    private parseJson(content?: string): any | null {
        if (!content) return null;
        try {
            return JSON.parse(content.replace(/```json?\n?/gi, '').replace(/```/g, '').trim());
        } catch {
            return null;
        }
    }
}
