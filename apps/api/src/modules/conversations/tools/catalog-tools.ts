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
    {
        name: 'send_product_image',
        description: 'Send the customer real photos of a specific product (up to 3 from the catalog). Use when showing/recommending a product would benefit from a visual — e.g. after the customer asks to see it or expresses interest. Only call with a product you got from search_products/get_product. The images are sent for you: do not paste links or describe them in your reply.',
        parameters: {
            type: 'object',
            properties: {
                productId: { type: 'string', description: 'Product UUID or exact name' },
            },
            required: ['productId'],
        },
    },
    // The catalog's missing sale step. A retail tenant could search, price and
    // photograph a product and then had NOTHING to close with: `place_order`
    // belongs to the restaurant toolset, so the agent said "listo, tu pedido
    // quedó registrado" and no order ever existed.
    {
        name: 'place_catalog_order',
        description: 'Create a real order for catalog products. This is the only way an order actually gets recorded — never tell the customer their order is placed unless this succeeded. Call it after the customer confirmed WHAT they want and HOW MANY. Prices come from the catalog, never from you: pass the productId and quantity and the server prices it.',
        parameters: {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    description: 'Products the customer is ordering',
                    items: {
                        type: 'object',
                        properties: {
                            productId: { type: 'string', description: 'Product UUID from search_products/get_product' },
                            quantity: { type: 'number', description: 'How many units (minimum 1)' },
                        },
                        required: ['productId', 'quantity'],
                    },
                },
                notes: { type: 'string', description: 'Delivery address, preferences or anything the team must know (optional)' },
            },
            required: ['items'],
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
