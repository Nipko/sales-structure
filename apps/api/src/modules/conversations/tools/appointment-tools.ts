/**
 * AI Tool definitions for appointment scheduling.
 * Uses the ToolDefinition interface from @parallext/shared.
 */
import { ToolDefinition } from '@parallext/shared';

export const APPOINTMENT_TOOLS: ToolDefinition[] = [
    {
        name: 'list_services',
        description: 'List all bookable services. Call ONCE at the start of a booking conversation.',
        parameters: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'check_availability',
        description: 'Check available time slots for a date + service. MUST call before showing any availability.',
        parameters: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'YYYY-MM-DD format' },
                serviceId: { type: 'string', description: 'Service UUID or name' },
                staffId: { type: 'string', description: 'Optional staff UUID' },
            },
            required: ['date', 'serviceId'],
        },
    },
    {
        name: 'create_appointment',
        description: 'Book an appointment. Call ONLY after customer confirms time, name, and email.',
        parameters: {
            type: 'object',
            properties: {
                serviceId: { type: 'string', description: 'Service UUID or name' },
                staffId: { type: 'string', description: 'Staff UUID' },
                date: { type: 'string', description: 'YYYY-MM-DD' },
                time: { type: 'string', description: 'HH:MM 24h format' },
                customerName: { type: 'string', description: 'Customer full name' },
                customerPhone: { type: 'string', description: 'Phone number' },
                customerEmail: { type: 'string', description: 'Email for calendar invite' },
                notes: { type: 'string', description: 'Notes' },
            },
            required: ['serviceId', 'date', 'time', 'customerName', 'customerEmail'],
        },
    },
    {
        name: 'cancel_appointment',
        description: 'Cancel an appointment by ID.',
        parameters: {
            type: 'object',
            properties: {
                appointmentId: { type: 'string', description: 'Appointment UUID' },
                reason: { type: 'string', description: 'Reason' },
            },
            required: ['appointmentId'],
        },
    },
    {
        name: 'list_customer_appointments',
        description: 'List upcoming appointments for the current customer.',
        parameters: { type: 'object', properties: {}, required: [] },
    },
];

/**
 * Booking state machine — tracks progress through the booking flow.
 * Stored in conversation.metadata.bookingState
 */
export interface BookingState {
    step: 'idle' | 'has_services' | 'has_service' | 'has_date' | 'has_slots' | 'has_time' | 'collecting_info' | 'confirmed';
    services?: Array<{ id: string; name: string; duration: number; price: number; currency: string }>;
    serviceId?: string;
    serviceName?: string;
    date?: string;
    slots?: Array<{ time: string; endTime: string }>;
    time?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
}

/**
 * Build a concise, state-aware prompt for the booking flow.
 * This replaces the massive APPOINTMENT_SYSTEM_PROMPT.
 */
export function buildBookingPrompt(state: BookingState, customerProfile: { name?: string; email?: string; phone?: string }): string {
    const lines: string[] = ['## Appointment Booking'];

    // Inject what we already know
    if (state.services?.length) {
        lines.push(`\nServices available: ${state.services.map(s => `"${s.name}" (${s.duration}min, $${s.price} ${s.currency}, id:${s.id})`).join(', ')}`);
    }
    if (state.serviceName) lines.push(`Selected service: ${state.serviceName} (id: ${state.serviceId})`);
    if (state.date) lines.push(`Selected date: ${state.date}`);
    if (state.slots?.length) {
        lines.push(`Available slots: ${state.slots.map(s => s.time).join(', ')}`);
    }
    if (state.time) lines.push(`Selected time: ${state.time}`);

    // Customer data we already have
    const name = state.customerName || customerProfile.name;
    const email = state.customerEmail || customerProfile.email;
    const phone = state.customerPhone || customerProfile.phone;
    if (name) lines.push(`Customer name: ${name}`);
    if (email) lines.push(`Customer email: ${email}`);
    if (phone) lines.push(`Customer phone: ${phone}`);

    // Tell the LLM exactly what to do NEXT based on current step
    lines.push('\n## YOUR NEXT ACTION:');

    switch (state.step) {
        case 'idle':
            lines.push('The customer wants to book. Call list_services to show what\'s available.');
            break;
        case 'has_services':
            lines.push('Services are listed above. Ask which service the customer wants, OR if they already mentioned one, match it and proceed.');
            break;
        case 'has_service':
            lines.push(`Service "${state.serviceName}" is selected. Ask what DATE the customer prefers. Use the date reference from your context to calculate exact dates.`);
            break;
        case 'has_date':
            lines.push(`Service and date are set. Call check_availability with serviceId="${state.serviceId}" and date="${state.date}" NOW.`);
            break;
        case 'has_slots':
            lines.push(`Show the available slots listed above. Ask which time the customer prefers. Show max 4-5 slots.`);
            break;
        case 'has_time':
            if (!name) lines.push('Ask for the customer\'s full name.');
            else if (!email) lines.push('Ask for the customer\'s email (explain: "I need your email to send the calendar invitation").');
            else lines.push(`Confirm: "${state.serviceName}" on ${state.date} at ${state.time} for ${name}. Ask "Should I confirm this booking?"`);
            break;
        case 'collecting_info':
            if (!name) lines.push('Ask for name.');
            else if (!email) lines.push('Ask for email for calendar invitation.');
            else lines.push(`All info collected. Call create_appointment with serviceId="${state.serviceId}", date="${state.date}", time="${state.time}", customerName="${name}", customerEmail="${email}".`);
            break;
        case 'confirmed':
            lines.push('Appointment is booked! Tell the customer the details and that they\'ll receive a calendar invitation. Ask if they need anything else.');
            break;
    }

    lines.push('\n## RULES:');
    lines.push('- NEVER invent availability. Only show times from check_availability tool results.');
    lines.push('- NEVER re-ask for information shown above (service, date, time, name, email).');
    lines.push('- NEVER ask for email or name until AFTER the customer has selected a time slot.');
    lines.push('- Follow the NEXT ACTION instruction above exactly. Do not skip steps or add extra questions.');
    lines.push('- If customer says "yes"/"si"/"ok"/"confirmo", call create_appointment immediately.');
    lines.push('- Keep responses to 1-3 sentences maximum. No filler text.');
    lines.push('- Respond in the language the customer is using.');

    return lines.join('\n');
}

/**
 * Update booking state based on tool results.
 * Called after each tool execution to advance the state machine.
 */
export function updateBookingState(state: BookingState, toolName: string, toolArgs: any, toolResult: any): BookingState {
    const next = { ...state };

    switch (toolName) {
        case 'list_services':
            if (toolResult.services?.length) {
                next.step = 'has_services';
                next.services = toolResult.services;

                // If only 1 service, auto-select it
                if (toolResult.services.length === 1) {
                    next.step = 'has_service';
                    next.serviceId = toolResult.services[0].id;
                    next.serviceName = toolResult.services[0].name;
                }
            }
            break;

        case 'check_availability':
            next.date = toolArgs.date;
            if (toolResult.available && toolResult.slots?.length) {
                next.step = 'has_slots';
                next.slots = toolResult.slots;
            }
            // Resolve serviceId if it was passed as name
            if (toolArgs.serviceId && !next.serviceId) {
                next.serviceId = toolArgs.serviceId;
            }
            break;

        case 'create_appointment':
            if (toolResult.success) {
                next.step = 'confirmed';
                next.time = toolArgs.time;
                next.customerName = toolArgs.customerName;
                next.customerEmail = toolArgs.customerEmail;
            }
            break;
    }

    return next;
}

/**
 * Try to advance the booking state from the user's message.
 * Detects service selection, date mention, time selection, name/email.
 */
export function advanceStateFromMessage(state: BookingState, userText: string, services?: any[], todayDate?: string): BookingState {
    const next = { ...state };
    const text = userText.toLowerCase().trim();

    // Detect "hoy"/"today" as date
    if (state.step === 'has_service' && !state.date && todayDate) {
        if (text.includes('hoy') || text.includes('today')) {
            next.step = 'has_date';
            next.date = todayDate;
        }
    }

    // Detect service selection (if we have services and no service selected yet)
    if ((state.step === 'has_services' || state.step === 'idle') && state.services?.length && !state.serviceId) {
        // Fuzzy match: check if ANY word from service name appears in user text
        let bestMatch: { svc: any; score: number } | null = null;
        for (const svc of state.services) {
            const svcWords = svc.name.toLowerCase().split(/\s+/);
            const matchedWords = svcWords.filter((w: string) => w.length > 3 && text.includes(w));
            const score = matchedWords.length / svcWords.length;
            if (score > 0.3 && (!bestMatch || score > bestMatch.score)) {
                bestMatch = { svc, score };
            }
        }
        if (bestMatch) {
            next.step = 'has_service';
            next.serviceId = bestMatch.svc.id;
            next.serviceName = bestMatch.svc.name;
        }
    }

    // Detect time selection from slots
    if (state.step === 'has_slots' && state.slots?.length) {
        // Match patterns like "9:30", "09:30", "a las 10", "10am", "10:00"
        const timeMatch = text.match(/(\d{1,2})[:\.]?(\d{2})?\s*(am|pm)?/i);
        if (timeMatch) {
            let hour = parseInt(timeMatch[1]);
            const min = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
            if (timeMatch[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12;
            if (timeMatch[3]?.toLowerCase() === 'am' && hour === 12) hour = 0;
            const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

            // Check if this time is in our available slots
            const matchedSlot = state.slots.find(s => s.time === timeStr);
            if (matchedSlot) {
                next.step = 'has_time';
                next.time = matchedSlot.time;
            }
        }
    }

    // Detect confirmation ("si", "yes", "ok", "confirmo", "dale")
    if (state.step === 'has_time' || state.step === 'collecting_info') {
        const confirmWords = ['si', 'sí', 'yes', 'ok', 'confirmo', 'dale', 'listo', 'confirmar', 'perfecto'];
        if (confirmWords.some(w => text === w || text.startsWith(w + ' ') || text.startsWith(w + ','))) {
            if (next.customerName && next.customerEmail) {
                next.step = 'collecting_info'; // Ready to call create_appointment
            }
        }
    }

    return next;
}
