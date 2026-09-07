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
        description: 'Propose a real catalog order. The server returns current products, quantities, unit prices, total and currency for explicit customer confirmation before writing. A changed quote requires new confirmation. Success records a pending order only, never payment, shipment or delivery. Prescription products require human review.',
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
    {
        name:'list_my_catalog_orders', description:'List this customer’s own catalog orders to find an existing purchase before retrying or cancelling. Order status is separate from provider payment status; shipment is not tracked here.',
        parameters:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:50}},required:[]},
    },
    {
        name:'get_catalog_order', description:'Read one catalog order owned by the current customer, including its real lines, total, currency, order status and payment status. Never interpret operator status paid as provider settlement or claim delivery.',
        parameters:{type:'object',properties:{orderId:{type:'string',description:'UUID from this customer’s listed orders'}},required:['orderId']},
    },
    {
        name:'cancel_catalog_order', description:'Propose cancellation of an owned pending or confirmed unpaid catalog order. Requires explicit customer confirmation of the current version. Restores only inventory previously deducted by this order. Active payments, paid orders or missing stock evidence require human review. No refund, payment reversal or shipping cancellation is performed.',
        parameters:{type:'object',properties:{orderId:{type:'string'},reason:{type:'string',maxLength:1000}},required:['orderId']},
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
