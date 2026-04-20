/**
 * Knowledge tools — structured sources the agent can query when the turn
 * context's <retrieved_knowledge> doesn't already contain the answer.
 *
 * - search_faqs: first-class Q&A pairs (high precision)
 * - get_policy:   legal/operational policies (never hallucinated)
 * - search_knowledge_base: unstructured docs (semantic RAG)
 */
import { ToolDefinition } from '@parallext/shared';

export const FAQ_TOOL: ToolDefinition = {
    name: 'search_faqs',
    description: 'Search the tenant\'s structured FAQ database for a canonical answer. Use this BEFORE falling back to search_knowledge_base when the customer asks a common question (hours, shipping, returns, account setup, etc.).',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'The customer\'s question, or keywords from it' },
            limit: { type: 'number', description: 'Max FAQs to return (default 3)' },
        },
        required: ['query'],
    },
};

export const POLICY_TOOL: ToolDefinition = {
    name: 'get_policy',
    description: 'Fetch the current, authoritative version of a business policy (shipping, return, warranty, cancellation, terms, privacy). ALWAYS use this instead of inventing policy details.',
    parameters: {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                enum: ['shipping', 'return', 'warranty', 'cancellation', 'terms', 'privacy'],
                description: 'Policy type',
            },
        },
        required: ['type'],
    },
};

export const KB_TOOL: ToolDefinition = {
    name: 'search_knowledge_base',
    description: 'Semantic search over the tenant\'s knowledge base (articles, manuals, long-form documents). Use when search_faqs returns no good match and the customer needs a detailed explanation.',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'The customer\'s question, or keywords from it' },
            limit: { type: 'number', description: 'Max chunks to return (default 5)' },
        },
        required: ['query'],
    },
};

export const KNOWLEDGE_TOOLS: ToolDefinition[] = [FAQ_TOOL, POLICY_TOOL, KB_TOOL];
