import { Injectable, Logger } from '@nestjs/common';
import { ToolDefinition } from '@parallext/shared';

const MAX_TOOLS_PER_TURN = 10;
const MIN_SCORE = 0.15;

/**
 * Lightweight retrieval for tools (D2 fix for 71 tools bloat).
 * Gorilla paper: >30 tools <60% accuracy without retrieval.
 * We do BM25-ish keyword overlap + vertical boost, no embeddings to keep p99 <5ms.
 * Falls back to flag-based list if query empty.
 */
@Injectable()
export class ToolRetrievalService {
    private readonly logger = new Logger(ToolRetrievalService.name);

    /**
     * Score and filter candidate tools to topK most relevant for this turn.
     *
     * `pinned` tools are ALWAYS kept, whatever they score. That is not a tuning
     * knob, it is a correctness requirement: relevance is computed from the
     * customer's current message, and the message that closes a sale is "sí" —
     * two characters, dropped by the tokenizer, matching nothing. Every tool
     * then scored zero and the fallback returned the first ten by registration
     * order (the appointment family), so `create_property_booking`,
     * `place_order`, `enroll_student` and `book_class` vanished from the exact
     * turn where they had to run, and the confirmation could never execute.
     *
     * @param query user text + vertical context + booking state
     * @param candidates all enabled tools for tenant (flag-filtered)
     * @param topK max tools to return (10)
     * @param pinned tool names that must survive the cut
     */
    retrieveRelevantTools(
        query: string,
        candidates: ToolDefinition[],
        topK = MAX_TOOLS_PER_TURN,
        pinned?: ReadonlySet<string>,
    ): ToolDefinition[] {
        if (!candidates.length) return candidates;

        const mustKeep = pinned?.size
            ? candidates.filter(t => pinned.has(t.name))
            : [];
        // The pinned set is small and bounded (the tenant's confirmable writers),
        // but it must never squeeze the reads out entirely: the budget grows
        // instead of the reads shrinking to nothing.
        const budget = Math.max(topK, mustKeep.length + Math.ceil(topK / 2));
        if (candidates.length <= budget) return candidates;

        const optional = mustKeep.length
            ? candidates.filter(t => !pinned!.has(t.name))
            : candidates;
        const slots = budget - mustKeep.length;

        const queryTokens = this.tokenize(query);
        if (!query || !queryTokens.length) return [...mustKeep, ...optional.slice(0, slots)];

        const scored = optional.map(tool => {
            const descTokens = this.tokenize(`${tool.name} ${tool.description} ${JSON.stringify(tool.parameters || {})}`);
            // BM25-ish: overlap + length norm
            const overlap = queryTokens.filter(t => descTokens.some(d => d.includes(t) || t.includes(d))).length;
            const score = overlap / Math.sqrt(descTokens.length) + (descTokens.some(d => queryTokens.includes(d)) ? 0.1 : 0);
            // Boost vacation/realEstate when query mentions property terms even if description generic
            const verticalBoost = this.verticalBoost(queryTokens, tool.name);
            return { tool, score: score + verticalBoost };
        });

        scored.sort((a, b) => b.score - a.score);
        const filtered = scored.filter(s => s.score >= MIN_SCORE).slice(0, slots);
        // If nothing scores, keep at least `slots` generic (booking/catalog/knowledge always useful)
        const result = filtered.length ? filtered.map(s => s.tool) : scored.slice(0, slots).map(s => s.tool);

        // Always keep core tools if they were in candidates: they are the safety net
        const coreNames = new Set(['search_knowledge_base', 'search_faqs', 'get_policy', 'list_services']);
        for (const c of optional) {
            if (coreNames.has(c.name) && !result.some(r => r.name === c.name) && result.length < slots) {
                result.push(c);
            }
        }

        const final = [...mustKeep, ...result.slice(0, slots)];
        this.logger.debug(`[ToolRetrieval] ${candidates.length} → ${final.length} (${mustKeep.length} pinned) for query "${query.slice(0, 60)}"`);
        return final;
    }

    private tokenize(text: string): string[] {
        return (text || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .split(/[^a-z0-9]+/)
            .filter(t => t.length > 2);
    }

    private verticalBoost(queryTokens: string[], toolName: string): number {
        const q = queryTokens.join(' ');
        if (q.includes('propiedad') || q.includes('casa') || q.includes('apartamento') || q.includes('alojamiento') || q.includes('reserva')) {
            if (toolName.includes('property') || toolName.includes('list_properties')) return 0.5;
        }
        if (q.includes('cita') || q.includes('reserva') || q.includes('turno') || q.includes('agendar')) {
            if (toolName.includes('appointment') || toolName.includes('check_availability')) return 0.5;
        }
        if (q.includes('menu') || q.includes('plato') || q.includes('pedido') || q.includes('delivery')) {
            if (toolName.includes('menu') || toolName.includes('place_order')) return 0.5;
        }
        return 0;
    }
}
