/**
 * AI Tool definitions for appointment scheduling.
 * Uses the ToolDefinition interface from @parallext/shared.
 * The LLM providers wrap these in their own format (e.g., OpenAI adds { type: 'function', function: ... }).
 */
import { ToolDefinition } from '@parallext/shared';

export const APPOINTMENT_TOOLS: ToolDefinition[] = [
    {
        name: 'list_services',
        description: 'List all bookable services offered by this business. Call this when a customer wants to schedule an appointment.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'check_availability',
        description: 'Check available time slots for a specific date and service. Returns concrete bookable times.',
        parameters: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
                serviceId: { type: 'string', description: 'Service UUID from list_services' },
                staffId: { type: 'string', description: 'Optional: specific staff member UUID' },
            },
            required: ['date', 'serviceId'],
        },
    },
    {
        name: 'create_appointment',
        description: 'Book a confirmed appointment. ONLY call AFTER the customer explicitly confirms the proposed time. Never book without confirmation.',
        parameters: {
            type: 'object',
            properties: {
                serviceId: { type: 'string', description: 'Service UUID' },
                staffId: { type: 'string', description: 'Staff member UUID to assign' },
                date: { type: 'string', description: 'YYYY-MM-DD' },
                time: { type: 'string', description: 'HH:MM (24h format)' },
                customerName: { type: 'string', description: 'Full name of the customer' },
                customerPhone: { type: 'string', description: 'Phone number' },
                customerEmail: { type: 'string', description: 'Email address' },
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

Tienes acceso a herramientas para gestionar citas. Sigue este flujo EXACTO:

1. Cuando el cliente quiera agendar, usa list_services para conocer los servicios disponibles.
2. Pregunta qué servicio necesita (si no lo ha dicho).
3. Pregunta la fecha preferida.
4. Usa check_availability para ver horarios libres en esa fecha.
5. Presenta MÁXIMO 3 opciones de horario: "Tengo disponible: 10:00, 11:30, y 14:00. ¿Cuál prefieres?"
6. Si no hay disponibilidad, sugiere la siguiente fecha con horarios libres.
7. Una vez el cliente elige horario, recopila información faltante (nombre completo, teléfono).
8. SIEMPRE presenta un resumen antes de confirmar:
   "Perfecto, confirmo tu cita:
   Servicio: [nombre]
   Fecha: [fecha]
   Hora: [hora]
   ¿Confirmas? (sí/no)"
9. SOLO cuando el cliente diga "sí", "confirmo", "dale", o similar, usa create_appointment.
10. Después de agendar, envía un mensaje de confirmación con los detalles.

REGLAS:
- NUNCA agendes sin confirmación explícita del cliente.
- Si el cliente quiere cancelar, usa list_customer_appointments para encontrar la cita, luego cancel_appointment.
- No ofrezcas horarios en el pasado.
- Sé amable y eficiente en el proceso.
`;
