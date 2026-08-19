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
     * @param query user text + vertical context + booking state
     * @param candidates all enabled tools for tenant (flag-filtered)
     * @param topK max tools to return (10)
     */
    retrieveRelevantTools(query: string, candidates: ToolDefinition[], topK = MAX_TOOLS_PER_TURN): ToolDefinition[] {
        if (!query || !candidates.length) return candidates;
        if (candidates.length <= topK) return candidates;

        const queryTokens = this.tokenize(query);
        if (!queryTokens.length) return candidates.slice(0, topK);

        const scored = candidates.map(tool => {
            const descTokens = this.tokenize(`${tool.name} ${tool.description} ${JSON.stringify(tool.parameters || {})}`);
            // BM25-ish: overlap + length norm
            const overlap = queryTokens.filter(t => descTokens.some(d => d.includes(t) || t.includes(d))).length;
            const score = overlap / Math.sqrt(descTokens.length) + (descTokens.some(d => queryTokens.includes(d)) ? 0.1 : 0);
            // Boost vacation/realEstate when query mentions property terms even if description generic
            const verticalBoost = this.verticalBoost(queryTokens, tool.name);
            return { tool, score: score + verticalBoost };
        });

        scored.sort((a, b) => b.score - a.score);
        const filtered = scored.filter(s => s.score >= MIN_SCORE).slice(0, topK);
        // If nothing scores, keep at least topK generic (booking/catalog/knowledge always useful)
        const result = filtered.length ? filtered.map(s => s.tool) : scored.slice(0, topK).map(s => s.tool);

        // Always keep core tools if they were in candidates: they are the safety net
        const coreNames = new Set(['search_knowledge_base', 'search_faqs', 'get_policy', 'list_services']);
        for (const c of candidates) {
            if (coreNames.has(c.name) && !result.some(r => r.name === c.name) && result.length < topK) {
                result.push(c);
            }
        }

        this.logger.debug(`[ToolRetrieval] ${candidates.length} → ${result.length} for query "${query.slice(0, 60)}"`);
        return result.slice(0, topK);
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
