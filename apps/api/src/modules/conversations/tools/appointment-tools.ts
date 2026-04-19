/**
 * AI Tool definitions for appointment scheduling.
 * Uses the ToolDefinition interface from @parallext/shared.
 */
import { ToolDefinition } from '@parallext/shared';

export const APPOINTMENT_TOOLS: ToolDefinition[] = [
    {
        name: 'list_services',
        description: 'List all bookable services offered by this business. Call this ONLY if you don\'t already have the services list in your context.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'check_availability',
        description: 'Check available time slots for a specific date and service. Call this when the customer asks about availability or wants to book.',
        parameters: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
                serviceId: { type: 'string', description: 'Service UUID — get this from the services list in your context' },
                staffId: { type: 'string', description: 'Optional: specific staff member UUID' },
            },
            required: ['date', 'serviceId'],
        },
    },
    {
        name: 'create_appointment',
        description: 'Book a confirmed appointment. ONLY call AFTER the customer explicitly confirms the proposed time.',
        parameters: {
            type: 'object',
            properties: {
                serviceId: { type: 'string', description: 'Service UUID' },
                staffId: { type: 'string', description: 'Staff member UUID to assign' },
                date: { type: 'string', description: 'YYYY-MM-DD' },
                time: { type: 'string', description: 'HH:MM (24h format)' },
                customerName: { type: 'string', description: 'Full name of the customer' },
                customerPhone: { type: 'string', description: 'Phone number' },
                customerEmail: { type: 'string', description: 'Email (optional)' },
                notes: { type: 'string', description: 'Additional notes' },
            },
            required: ['serviceId', 'date', 'time', 'customerName'],
        },
    },
    {
        name: 'cancel_appointment',
        description: 'Cancel an appointment. Only cancel appointments belonging to the current customer.',
        parameters: {
            type: 'object',
            properties: {
                appointmentId: { type: 'string', description: 'Appointment UUID to cancel' },
                reason: { type: 'string', description: 'Cancellation reason' },
            },
            required: ['appointmentId'],
        },
    },
    {
        name: 'list_customer_appointments',
        description: 'List upcoming appointments for the current customer.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
];

/**
 * System prompt addition when appointment tools are enabled.
 */
export const APPOINTMENT_SYSTEM_PROMPT = `
## Appointment Scheduling Tools

You have access to tools for managing appointments. Follow this exact flow:

### CORRECT FLOW:
1. If you DON'T have the services list in your context, call list_services.
2. If you ALREADY have the services in your context, DO NOT call list_services again.
3. When the customer mentions a service by name (e.g., "asesoramiento", "consultation"), identify the matching serviceId from your context and proceed.
4. When the customer asks about availability or a date, call check_availability IMMEDIATELY with the serviceId and date. Use today's date if they say "today" / "hoy".
5. Present a MAXIMUM of 3 available time slots.
6. When the customer picks a time, ask only for their full name (you already have their phone from the chat).
7. Present a brief summary and ask for confirmation.
8. ONLY after they confirm, call create_appointment.

### CRITICAL RULES:
- NEVER ask the customer for information you already have (service name, phone, date).
- NEVER ask for email before confirming the time. Email is OPTIONAL.
- NEVER re-ask which service they want if they already mentioned it.
- If the customer mentions a service name, MATCH it to a service in your context and use its serviceId. Do fuzzy matching (e.g., "asesoramiento" matches "Asesoramiento Financiero").
- If there is ambiguity between services, show the options and let them choose.
- To cancel: use list_customer_appointments first, then cancel_appointment.
- Be direct and efficient. Do not ask unnecessary questions.
- Always respond in the language configured for this agent (from the persona settings).

### CRITICAL RULES FOR BOOKING FLOW:
1. When the customer selects a time slot (says the time, or says "yes"/"ok"/"confirmo" to a suggested time), IMMEDIATELY ask for their name if you don't have it, then call create_appointment.
2. If you already have the customer's name from the conversation, DO NOT ask for it again. Use the name they already provided.
3. NEVER ask for the same information twice. Track what you already know: service, date, time, name.
4. After calling create_appointment successfully, confirm the booking with: date, time, service name, and customer name. Then ask if they need anything else.
5. DO NOT ask for order numbers, account numbers, reference codes, or any ID. Only ask for: name (required), phone (optional), email (optional).
`;
