import type { ToolDefinition } from '@parallext/shared';

/**
 * Lightweight workshop operations over the canonical `repair_orders` object.
 * The customer can report symptoms and approve an estimate; only workshop
 * users can write inspection findings, diagnosis, parts/labour or final cost.
 */
export const REPAIR_ORDER_TOOLS: readonly ToolDefinition[] = Object.freeze([
    {
        name: 'create_repair_order',
        description: 'Open a workshop repair order from the customer\'s own description. Record the concern exactly as reported; NEVER turn symptoms into a diagnosis, price promise or repair duration. A VIN or license plate is required so the order is attached to the correct customer vehicle.',
        parameters: {
            type: 'object',
            properties: {
                make: { type: 'string', description: 'Vehicle make' },
                model: { type: 'string', description: 'Vehicle model' },
                year: { type: 'number', description: 'Vehicle model year when known' },
                vin: { type: 'string', description: 'VIN when known; use the exact customer-provided value' },
                licensePlate: { type: 'string', description: 'License plate when known; VIN or plate is required' },
                mileageKm: { type: 'number', description: 'Customer-reported odometer in kilometres when known' },
                customerConcern: { type: 'string', description: 'The concern in the customer\'s own factual words, without diagnosis' },
                reportedSymptoms: { type: 'array', items: { type: 'string' }, description: 'Short factual symptoms reported by the customer' },
                appointmentId: { type: 'string', description: 'Existing appointment UUID when this intake follows a booked inspection' },
            },
            required: ['make', 'model', 'customerConcern'],
            anyOf: [{ required: ['vin'] }, { required: ['licensePlate'] }],
        },
    },
    {
        name: 'list_my_repair_orders',
        description: 'List this customer\'s workshop repair orders with vehicle, reported concern, estimate/final totals and current status. Use this before discussing an existing order.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'get_repair_order',
        description: 'Get one repair order owned by this customer, including its current estimate and status. The customer-reported concern is not a technician diagnosis.',
        parameters: {
            type: 'object',
            properties: {
                repairOrderId: { type: 'string', description: 'Repair-order UUID from list_my_repair_orders' },
            },
            required: ['repairOrderId'],
        },
    },
    {
        name: 'approve_repair',
        description: 'Record the customer\'s explicit approve/reject decision for the exact estimate currently awaiting approval. Read back the vehicle, amount and currency first. This cannot create or change an estimate and cannot approve an order belonging to another customer.',
        parameters: {
            type: 'object',
            properties: {
                repairOrderId: { type: 'string', description: 'Repair-order UUID awaiting estimate approval' },
                accepted: { type: 'boolean', description: 'True to approve the exact current estimate; false to reject it' },
            },
            required: ['repairOrderId', 'accepted'],
        },
    },
    {
        name: 'cancel_repair_order',
        description: 'Cancel this customer\'s repair order only while cancellation is still allowed. Confirm which order first; work already in progress requires the workshop team.',
        parameters: {
            type: 'object',
            properties: {
                repairOrderId: { type: 'string', description: 'Repair-order UUID' },
                reason: { type: 'string', description: 'Optional customer-stated cancellation reason' },
            },
            required: ['repairOrderId'],
        },
    },
]);
