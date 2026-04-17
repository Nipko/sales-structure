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
## Herramientas de Agendamiento

Tienes acceso a herramientas para gestionar citas.

### FLUJO CORRECTO:
1. Si NO tienes la lista de servicios en tu contexto, llama list_services.
2. Si YA tienes los servicios en tu contexto, NO vuelvas a llamar list_services.
3. Cuando el cliente mencione un servicio por nombre (ej: "asesoramiento"), identifica el serviceId correspondiente de tu contexto y continúa.
4. Cuando el cliente pregunte por disponibilidad o una fecha, llama check_availability INMEDIATAMENTE con el serviceId y la fecha. Usa la fecha de hoy si dice "hoy".
5. Presenta MÁXIMO 3 horarios disponibles.
6. Cuando el cliente elija un horario, pide solo su nombre completo (el teléfono ya lo tienes del chat).
7. Presenta un resumen breve y pide confirmación.
8. SOLO después de que confirme, llama create_appointment.

### REGLAS CRÍTICAS:
- NUNCA pidas al cliente información que ya tienes (nombre del servicio, teléfono, fecha).
- NUNCA pidas email antes de confirmar el horario. El email es OPCIONAL.
- NUNCA re-preguntes qué servicio quiere si ya lo mencionó.
- Si el cliente dice "asesoramiento" o algo similar, BUSCA en tu contexto el servicio que coincida y usa su serviceId.
- Si hay ambigüedad entre servicios, muestra las opciones y deja que elija.
- Para cancelar: usa list_customer_appointments primero, luego cancel_appointment.
- Sé directo y eficiente. No hagas preguntas innecesarias.
`;
