/**
 * Catalog + Inventory tools — give the agent live access to the tenant's
 * products and stock. Registered when config.tools.catalog.enabled === true.
 */
import { ToolDefinition } from '@parallext/shared';

export const CATALOG_TOOLS: ToolDefinition[] = [
    {
        name: 'search_products',
        description: 'Search the product catalog by natural-language query (name, description, category). Returns top matches with price and availability. Use when the customer asks about what you sell, or requests a product.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Free-text search query' },
                limit: { type: 'number', description: 'Max results to return (default 5)' },
                category: { type: 'string', description: 'Optional category filter' },
            },
            required: ['query'],
        },
    },
    {
        name: 'get_product',
        description: 'Fetch full details for a single product by its ID or exact name. Use when the customer asks for specifics (description, price, stock) after search_products.',
        parameters: {
            type: 'object',
            properties: {
                productId: { type: 'string', description: 'Product UUID or exact name' },
            },
            required: ['productId'],
        },
    },
    {
        name: 'check_stock',
        description: 'Check current stock level for a product. Use before promising availability or accepting an order.',
        parameters: {
            type: 'object',
            properties: {
                productId: { type: 'string', description: 'Product UUID or exact name' },
            },
            required: ['productId'],
        },
    },
];

/**
 * Active promotions / discounts — registered when config.tools.offers.enabled.
 * Separate from CATALOG_TOOLS so a tenant can enable products without promos.
 */
export const OFFER_TOOL: ToolDefinition = {
    name: 'list_active_offers',
    description: 'List commercial offers and promotions that are currently active (discount, promo, bundle). Use when the customer asks about deals, or proactively when it adds value to the conversation. Never invent promotions.',
    parameters: {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Max offers to return (default 5)' },
        },
        required: [],
    },
};
