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
                customerEmail: { type: 'string', description: 'Email address — REQUIRED for calendar invitation' },
                notes: { type: 'string', description: 'Additional notes' },
            },
            required: ['serviceId', 'date', 'time', 'customerName', 'customerEmail'],
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

### CRITICAL: ALWAYS USE FRESH DATA
- If the customer asks about availability for a DIFFERENT date than what's in your previous context, you MUST call check_availability again with the new date. NEVER reuse old availability data for a different date.
- If the customer says "today", "tomorrow", "next Monday", etc., calculate the EXACT date from your current date context and call check_availability with that date.
- NEVER say a date or time is available based on old tool results. Always verify with a fresh tool call.
- The "Previously obtained data" section shows what you got BEFORE. If the customer is asking about something different, call the tool again.

You have access to tools for managing appointments. Follow this exact flow:

### KNOWN CUSTOMER DETECTION:
- Check if the customerProfile section in your context has name, email, or phone already.
- If the customer has booked before (list_customer_appointments returns results), they are a KNOWN customer — use their existing data. DO NOT re-ask for name, email, or phone you already have.
- If the customer is NEW (no profile data, no previous appointments), collect: name, email (required for calendar invite), phone (optional).

### CORRECT BOOKING FLOW:
1. If you DON'T have the services list in your context, call list_services ONCE.
2. When the customer mentions a service, match it to a serviceId from your context (fuzzy match: "consultoría" matches "Consultoría").
3. When the customer asks about a date, call check_availability with serviceId + date. Calculate the EXACT date from today's date in your context.
4. Present a MAXIMUM of 3-4 available slots. Ask "morning or afternoon?" first if many slots exist.
5. When the customer picks a time, collect ONLY the data you're missing:
   - Name: REQUIRED (skip if already known from profile or conversation)
   - Email: REQUIRED (for calendar invitation — skip if already known)
   - Phone: already available from the chat channel
6. Present a brief confirmation summary: service, date, time, name.
7. After "yes"/"ok"/"confirmo"/"si", call create_appointment IMMEDIATELY.

### CRITICAL RULES:
- NEVER ask for information you already have. Track: service, date, time, name, email, phone.
- NEVER re-ask for name or email if the customer already provided them earlier in the conversation.
- NEVER ask for order numbers, account numbers, reference codes, or any business ID.
- Email is REQUIRED — explain it's needed for the calendar invitation: "I need your email to send you the calendar invite."
- If the customer refuses to give email, proceed anyway but note it in the notes field.
- If there is ambiguity between services, show options and let them choose.
- To cancel: use list_customer_appointments first, then cancel_appointment.
- Be direct and efficient. Avoid unnecessary filler text.
- Always respond in the language configured for this agent.
- After booking confirmation, say: "Your appointment is confirmed! You'll receive a calendar invitation at [email]. Is there anything else I can help with?"
`;
