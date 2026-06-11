import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

export interface CustomerMemory {
    facts: string[];
    summary?: string;
}

const MAX_FACTS = 12;          // cap stored facts so the block stays compact
const MEMORY_BLOCK_FACTS = 8;  // how many to inject into the prompt
const RETRIEVE_K = 8;          // semantic top-K facts injected per turn
const FACT_DEDUP_DISTANCE = 0.15; // cosine distance < this ⇒ same fact (update, not insert)

/**
 * Long-term customer memory.
 *
 * Phase 1: a Mem0-style merged row per contact in customer_memories (facts JSONB +
 * summary) maintained by a cheap LLM. Kept as the "previous memory" the extractor
 * merges/cleans at the text level.
 *
 * Phase 2 (this file): an additive semantic layer in customer_memory_facts —
 * each durable fact stored with its embedding so the upsert dedups SEMANTICALLY
 * (cosine) and getMemory retrieves the top-K facts relevant to the current turn,
 * keyed by the UNIFIED IdentityService customer (profile) with a fallback to the
 * contact before identity resolution. Reuses KnowledgeService.generateEmbedding
 * (same OpenAI pipeline + usage tracking). Everything is best-effort and degrades
 * gracefully when OpenAI embeddings aren't configured.
 */
@Injectable()
export class CustomerMemoryService {
    private readonly logger = new Logger(CustomerMemoryService.name);
    private readonly ensuredSchemas = new Set<string>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly llmRouter: LLMRouterService,
        private readonly knowledge: KnowledgeService,
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
            // Semantic per-fact layer (one statement per call — PgBouncer tx mode).
            await this.prisma.executeInTenantSchema(schema,
                `CREATE TABLE IF NOT EXISTS customer_memory_facts (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    owner_kind VARCHAR(16) NOT NULL DEFAULT 'profile',
                    owner_id UUID NOT NULL,
                    fact_text TEXT NOT NULL,
                    embedding vector(1536),
                    seen_count INTEGER NOT NULL DEFAULT 1,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                 )`);
            await this.prisma.executeInTenantSchema(schema,
                `CREATE INDEX IF NOT EXISTS idx_cmf_owner ON customer_memory_facts (owner_kind, owner_id)`);
            this.ensuredSchemas.add(schema);
        } catch (e: any) {
            if (/already exists|duplicate|23505|42P07/i.test(e?.message || '')) {
                this.ensuredSchemas.add(schema);
            } else {
                this.logger.warn(`[Memory] ensureTable failed for ${schema}: ${e.message}`);
            }
        }
    }

    /** Resolve the unified customer (profile) for a contact, or fall back to contact. */
    private async resolveOwner(schema: string, contactId: string): Promise<{ kind: 'profile' | 'contact'; id: string }> {
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT customer_profile_id FROM contact_identities WHERE contact_id = $1::uuid LIMIT 1`,
                [contactId]);
            const pid = rows?.[0]?.customer_profile_id;
            if (pid) return { kind: 'profile', id: pid };
        } catch { /* table may not exist for this tenant — fall back */ }
        return { kind: 'contact', id: contactId };
    }

    /**
     * Compact memory for prompt injection. With `query` set, returns the facts most
     * relevant to this turn (semantic top-K); without it, the merged Phase-1 set
     * (e.g. for the extractor's "previous memory" input). Returns null when nothing
     * is known.
     */
    async getMemory(schema: string, contactId: string, query?: string): Promise<CustomerMemory | null> {
        if (!contactId) return null;
        try {
            const memRows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT facts, summary FROM customer_memories WHERE contact_id = $1::uuid`,
                [contactId]);
            const summary = memRows?.[0]?.summary || undefined;
            const mergedFacts = Array.isArray(memRows?.[0]?.facts)
                ? memRows[0].facts.filter((f: any) => typeof f === 'string')
                : [];

            let facts: string[];
            if (query && query.trim()) {
                facts = await this.retrieveFacts(schema, contactId, query.trim());
                if (!facts.length) facts = mergedFacts; // fall back to the merged view
            } else {
                facts = mergedFacts;
            }

            if (!facts.length && !summary) return null;
            return { facts: facts.slice(0, MEMORY_BLOCK_FACTS), summary };
        } catch {
            return null;
        }
    }

    /** Semantic top-K facts for the owner; falls back to most-recent when embeddings are off. */
    private async retrieveFacts(schema: string, contactId: string, query: string): Promise<string[]> {
        try {
            const owner = await this.resolveOwner(schema, contactId);
            let emb: number[] | null = null;
            try { emb = await this.knowledge.generateEmbedding(query.slice(0, 1000)); } catch { emb = null; }
            if (emb) {
                const embStr = `[${emb.join(',')}]`;
                const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                    `SELECT fact_text FROM customer_memory_facts
                      WHERE owner_kind = $1 AND owner_id = $2::uuid AND embedding IS NOT NULL
                      ORDER BY embedding <=> $3::vector LIMIT $4`,
                    [owner.kind, owner.id, embStr, RETRIEVE_K]);
                return (rows || []).map(r => r.fact_text).filter((f: any) => typeof f === 'string');
            }
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT fact_text FROM customer_memory_facts
                  WHERE owner_kind = $1 AND owner_id = $2::uuid
                  ORDER BY last_seen_at DESC LIMIT $3`,
                [owner.kind, owner.id, MEMORY_BLOCK_FACTS]);
            return (rows || []).map(r => r.fact_text).filter((f: any) => typeof f === 'string');
        } catch {
            return [];
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

            // Merged view (Phase-1) — drives the next extraction's "previous memory".
            await this.prisma.executeInTenantSchema(schema,
                `INSERT INTO customer_memories (contact_id, facts, summary, updated_at)
                 VALUES ($1::uuid, $2::jsonb, $3, NOW())
                 ON CONFLICT (contact_id) DO UPDATE SET facts = EXCLUDED.facts, summary = EXCLUDED.summary, updated_at = NOW()`,
                [contactId, JSON.stringify(facts), summary]);

            // Semantic layer (Phase-2) — per-fact embedding + dedup for retrieval.
            await this.upsertFactsSemantic(schema, contactId, facts).catch(() => {});

            this.logger.log(`[Memory] Updated memory for contact ${contactId} (${facts.length} facts)`);
        } catch (e: any) {
            this.logger.warn(`[Memory] extract failed for contact ${contactId}: ${e.message}`);
        }
    }

    /** Embed each fact and upsert it semantically (cosine dedup) under the owner. */
    private async upsertFactsSemantic(schema: string, contactId: string, facts: string[]): Promise<void> {
        const owner = await this.resolveOwner(schema, contactId);
        for (const fact of facts) {
            const text = (fact || '').trim().slice(0, 300);
            if (!text) continue;
            let emb: number[] | null = null;
            try { emb = await this.knowledge.generateEmbedding(text); } catch { emb = null; }

            if (!emb) {
                // No embeddings — only guard against exact-duplicate inserts.
                await this.prisma.executeInTenantSchema(schema,
                    `INSERT INTO customer_memory_facts (owner_kind, owner_id, fact_text)
                     SELECT $1, $2::uuid, $3
                     WHERE NOT EXISTS (SELECT 1 FROM customer_memory_facts WHERE owner_kind = $1 AND owner_id = $2::uuid AND fact_text = $3)`,
                    [owner.kind, owner.id, text]).catch(() => {});
                continue;
            }

            const embStr = `[${emb.join(',')}]`;
            const near = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT id, (embedding <=> $3::vector) AS distance
                   FROM customer_memory_facts
                  WHERE owner_kind = $1 AND owner_id = $2::uuid AND embedding IS NOT NULL
                  ORDER BY embedding <=> $3::vector LIMIT 1`,
                [owner.kind, owner.id, embStr]).catch(() => [] as any[]);

            const hit = near?.[0];
            if (hit && Number(hit.distance) < FACT_DEDUP_DISTANCE) {
                await this.prisma.executeInTenantSchema(schema,
                    `UPDATE customer_memory_facts
                        SET fact_text = $2, embedding = $3::vector, last_seen_at = NOW(), seen_count = seen_count + 1
                      WHERE id = $1::uuid`,
                    [hit.id, text, embStr]).catch(() => {});
            } else {
                await this.prisma.executeInTenantSchema(schema,
                    `INSERT INTO customer_memory_facts (owner_kind, owner_id, fact_text, embedding)
                     VALUES ($1, $2::uuid, $3, $4::vector)`,
                    [owner.kind, owner.id, text, embStr]).catch(() => {});
            }
        }

        // Prune to the MAX_FACTS most-recent facts per owner.
        await this.prisma.executeInTenantSchema(schema,
            `DELETE FROM customer_memory_facts
              WHERE owner_kind = $1 AND owner_id = $2::uuid
                AND id NOT IN (
                    SELECT id FROM customer_memory_facts
                     WHERE owner_kind = $1 AND owner_id = $2::uuid
                     ORDER BY last_seen_at DESC LIMIT $3)`,
            [owner.kind, owner.id, MAX_FACTS]).catch(() => {});
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
