/**
 * CRM + Orders tools — let the agent look up the current contact's history
 * and enrich responses with CRM context (lead score, tags, pipeline stage).
 *
 * Registered based on feature flags:
 * - config.tools.orders.enabled → ORDER_TOOL
 * - config.tools.crm.enabled    → CUSTOMER_CONTEXT_TOOL
 */
import { ToolDefinition } from '@parallext/shared';

export const ORDER_TOOL: ToolDefinition = {
    name: 'list_customer_orders',
    description: 'List the current customer\'s recent orders (status, total, date). Use when the customer asks about their order, shipping status, or purchase history. The contact is already resolved — no contactId parameter needed.',
    parameters: {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'How many recent orders to return (default 5)' },
            status: { type: 'string', description: 'Optional filter: pending, confirmed, processing, completed, cancelled, refunded' },
        },
        required: [],
    },
};

export const CUSTOMER_CONTEXT_TOOL: ToolDefinition = {
    name: 'get_customer_context',
    description: 'Fetch CRM context for the current customer: lead score, tags, pipeline stage, last interaction, total conversations. Use this at the start of a high-stakes conversation (refund request, complaint, VIP customer) to personalize the reply. The contact is already resolved.',
    parameters: { type: 'object', properties: {}, required: [] },
};

export const CRM_TOOLS: ToolDefinition[] = [ORDER_TOOL, CUSTOMER_CONTEXT_TOOL];
