/**
 * Restaurants AI tools — give the agent ("Luca") access to the menu,
 * table reservations, and order taking. Registered when
 * config.tools.restaurants.enabled === true (set automatically when
 * a tenant onboards with industry='restaurantes').
 *
 * Reservations route through the existing appointments engine — Luca
 * uses the standard create_appointment tool for those. Orders are the
 * domain-specific addition because they have line items, modifiers,
 * and a kitchen status pipeline.
 */
import { ToolDefinition } from '@parallext/shared';

export const RESTAURANTS_TOOLS: ToolDefinition[] = [
    {
        name: 'get_menu',
        description: 'Search the restaurant menu by query, category, dietary tag, or price ceiling. Use when the customer asks about food, drinks, what is offered, or has dietary restrictions. excludeAllergens filters items containing any of the listed allergens (gluten, lactosa, mariscos, mani). Returns up to 30 items with name, description, price, tags and allergens.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Free-text search ("hamburguesa", "ensalada", "vegano"). Optional.',
                },
                category: {
                    type: 'string',
                    description: 'Category name like "entradas", "bebidas", "postres"',
                },
                tag: {
                    type: 'string',
                    description: 'Dietary tag — vegetariano, vegano, sin_gluten, picante',
                },
                excludeAllergens: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Allergens the customer wants to avoid (gluten, lactosa, mariscos, mani, etc.)',
                },
                maxPrice: {
                    type: 'number',
                    description: 'Maximum price per item in the local currency',
                },
            },
        },
    },
    {
        name: 'get_promotions',
        description: 'List active promotions (happy hour, daily specials, percent or flat discounts). Use when the customer asks about offers, deals, or daily specials. Filters automatically to in-range promotions.',
        parameters: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'place_order',
        description: 'Create a food order. Use when the customer has confirmed which items + quantities they want. orderType=delivery requires deliveryAddress; pickup needs nothing extra; dine_in optionally takes tableNumber. Returns the order ID, total, paymentStatus and a payableReference when chargeable. Pass that opaque reference unchanged to payment tools and never derive one yourself. Always confirm the items + total with the customer before calling this.',
        parameters: {
            type: 'object',
            properties: {
                orderType: {
                    type: 'string',
                    enum: ['delivery', 'pickup', 'dine_in'],
                    description: 'Order type — defaults to delivery',
                },
                customerName: { type: 'string', description: 'Customer full name' },
                customerPhone: { type: 'string', description: 'Customer phone (international format)' },
                deliveryAddress: { type: 'string', description: 'Required when orderType=delivery' },
                deliveryNotes: { type: 'string', description: 'Apartment, gate, references' },
                tableNumber: { type: 'string', description: 'Table number for dine_in' },
                items: {
                    type: 'array',
                    description: 'Order line items',
                    items: {
                        type: 'object',
                        properties: {
                            menuItemId: { type: 'string', description: 'UUID from get_menu — preferred when known' },
                            name: { type: 'string', description: 'Snapshot of the item name (always required)' },
                            quantity: { type: 'number', description: 'Number of units (>= 1)' },
                            unitPrice: { type: 'number', description: 'Price per unit in local currency' },
                            specialInstructions: {
                                type: 'string',
                                description: 'Special prep notes (sin cebolla, picante extra)',
                            },
                        },
                        required: ['name', 'quantity', 'unitPrice'],
                    },
                },
                paymentMethod: {
                    type: 'string',
                    enum: ['cash', 'card', 'payment_link', 'pse', 'transfer'],
                    description: 'How the customer will pay. payment_link uses the tenant active provider selected by the backend; never select a provider by name.',
                },
                notes: { type: 'string', description: 'Free-form note for the kitchen / staff' },
            },
            required: ['orderType', 'items'],
        },
    },
    {
        name: 'cancel_order',
        description: 'Cancel a food order by ID. Orders in "received" status can be cancelled; legacy "pending" or "confirmed" orders are also accepted. Orders in "preparing", "ready", "delivered", or "cancelled" status cannot be cancelled. The customer can only cancel their own orders.',
        parameters: {
            type: 'object',
            properties: {
                orderId: { type: 'string', description: 'Order UUID returned by place_order' },
                reason: { type: 'string', description: 'Reason for cancellation' },
            },
            required: ['orderId'],
        },
    },
    {
        name: 'check_order_status',
        description: 'Check the current status of a food order. Returns status, paymentStatus, a payableReference only when chargeable, items, total, and estimatedDeliveryAt when an ETA was calculated. Use for order progress, payment-link creation, or payment-status lookup. Pass payableReference unchanged and never derive one yourself.',
        parameters: {
            type: 'object',
            properties: {
                orderId: { type: 'string', description: 'Order UUID returned by place_order' },
            },
            required: ['orderId'],
        },
    },
    {
        name: 'list_my_orders',
        description: 'List recent orders for the current customer, including paymentStatus and a payableReference only when chargeable. Use to find an order for cancellation, payment-link creation, or status lookup. Pass payableReference unchanged and never derive one yourself.',
        parameters: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Max orders to return (default 5)' },
            },
        },
    },
];
