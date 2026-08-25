/**
 * Vertical-integration AI tools (T3.19) — connect the agent to the tenant's real
 * external system-of-record. Registered per connected provider:
 *  - Toast    → GET_RESTAURANT_MENU_TOOL
 *  - Mindbody → GET_FITNESS_SCHEDULE_TOOL
 *  - Cliniko  → LIST_CLINIC_SERVICES_TOOL + CHECK_CLINIC_AVAILABILITY_TOOL
 */
import { ToolDefinition } from '@parallext/shared';

export const GET_RESTAURANT_MENU_TOOL: ToolDefinition = {
    name: 'get_restaurant_menu',
    description: "Get the restaurant's live menu (items, groups and prices) from the connected POS (Toast). Use when the customer asks what's on the menu, prices, or to take an order. Never invent menu items.",
    parameters: { type: 'object', properties: {}, required: [] },
};

export const GET_FITNESS_SCHEDULE_TOOL: ToolDefinition = {
    name: 'get_fitness_schedule',
    description: 'Get a mirrored upcoming class schedule (class, instructor, time and location) from Mindbody for discovery only. It does NOT provide live capacity or prove a spot is available. If the customer asks to check capacity, hold, book or cancel, report live_capacity_unavailable and offer a team handoff or waitlist.',
    parameters: { type: 'object', properties: {}, required: [] },
};

export const LIST_CLINIC_SERVICES_TOOL: ToolDefinition = {
    name: 'list_clinic_services',
    description: 'List the clinic\'s appointment types/services (name, duration, price) from the connected practice system (Cliniko). Use when the customer asks what services or appointments are offered.',
    parameters: { type: 'object', properties: {}, required: [] },
};

export const CHECK_CLINIC_AVAILABILITY_TOOL: ToolDefinition = {
    name: 'check_clinic_availability',
    description: 'Check available appointment times for a clinic service (Cliniko). Call list_clinic_services first to get the appointmentTypeId. Use when the customer wants to book or asks for availability.',
    parameters: {
        type: 'object',
        properties: {
            appointmentTypeId: { type: 'string', description: 'The Cliniko appointment type id (from list_clinic_services)' },
            from: { type: 'string', description: 'Optional start date YYYY-MM-DD' },
            to: { type: 'string', description: 'Optional end date YYYY-MM-DD' },
        },
        required: ['appointmentTypeId'],
    },
};
