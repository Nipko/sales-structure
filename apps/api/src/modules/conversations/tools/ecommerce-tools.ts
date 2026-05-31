/**
 * E-commerce sales tools (T2.17) — dual-skillset agent. Give the agent live
 * access to the connected store catalog (Shopify/WooCommerce → ecommerce_products)
 * and the customer's order status, plus a gated discount action for upsell.
 *
 * Registered based on feature flags:
 * - config.tools.ecommerce.enabled         → RECOMMEND_PRODUCTS_TOOL + GET_ORDER_STATUS_TOOL
 * - config.tools.ecommerce.canApplyDiscount → APPLY_DISCOUNT_TOOL (gated)
 */
import { ToolDefinition } from '@parallext/shared';

export const RECOMMEND_PRODUCTS_TOOL: ToolDefinition = {
    name: 'recommend_products',
    description: 'Recommend products from the REAL connected store catalog that match the customer\'s need or budget. Use when the customer expresses interest, asks what to buy, or for upsell/cross-sell. Returns real products with price and stock — never invent products.',
    parameters: {
        type: 'object',
        properties: {
            search: { type: 'string', description: 'What the customer is looking for (free text)' },
            maxPrice: { type: 'number', description: 'Optional max price in the store currency major units (e.g. 50 = $50)' },
            category: { type: 'string', description: 'Optional product category / type filter' },
        },
        required: [],
    },
};

export const GET_ORDER_STATUS_TOOL: ToolDefinition = {
    name: 'get_order_status',
    description: 'Get the status of the current customer\'s order. Use when the customer asks where their order is, shipping, or order details. The contact is already resolved — pass orderId only if the customer references a specific order; otherwise the most recent order is returned.',
    parameters: {
        type: 'object',
        properties: {
            orderId: { type: 'string', description: 'Optional specific order ID the customer mentioned' },
        },
        required: [],
    },
};

export const APPLY_DISCOUNT_TOOL: ToolDefinition = {
    name: 'apply_discount',
    description: 'Approve a discount for the current customer to help close a sale. Only call when negotiating and within the allowed maximum. Returns an approved discount code and the (possibly clamped) percentage, or a refusal if the request exceeds the cap. Never promise a discount without calling this tool.',
    parameters: {
        type: 'object',
        properties: {
            percent: { type: 'number', description: 'Requested discount percentage (e.g. 10 = 10%)' },
            reason: { type: 'string', description: 'Short reason for the discount (e.g. "first purchase", "bundle")' },
        },
        required: ['percent'],
    },
};

/** Read tools always registered when ecommerce is enabled. */
export const ECOMMERCE_TOOLS: ToolDefinition[] = [RECOMMEND_PRODUCTS_TOOL, GET_ORDER_STATUS_TOOL];
