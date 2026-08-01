/**
 * Tier 3 verticals AI tools: home services dispatch, pet services
 * (grooming/daycare/hotel) and photography. Each set is registered
 * by a separate config flag so a tenant only sees the relevant tools.
 */
import { ToolDefinition } from '@parallext/shared';

// ── Home services (servicios_hogar) ──────────────────────────────

export const HOME_SERVICES_TOOLS: ToolDefinition[] = [
    {
        name: 'create_service_request',
        description: 'Create a field-service request (plomería, electricidad, fumigación, limpieza, jardinería, otro). Use when a customer reports a problem at home/office. Captures urgency, address, and issue description so a technician can be dispatched. Always confirm address + name + phone before calling.',
        parameters: {
            type: 'object',
            properties: {
                serviceType: {
                    type: 'string',
                    enum: ['plomeria', 'electricidad', 'fumigacion', 'limpieza', 'jardineria', 'cerrajeria', 'pintura', 'otro'],
                },
                urgency: {
                    type: 'string',
                    enum: ['emergencia', 'alta', 'normal', 'flexible'],
                    description: 'emergencia = water flooding / no power / safety risk. alta = same day. normal = within 2-3 days. flexible = whenever fits.',
                },
                customerName: { type: 'string' },
                customerPhone: { type: 'string' },
                address: { type: 'string', description: 'Full street address' },
                addressNotes: { type: 'string', description: 'Apartment, building, gate code, references' },
                city: { type: 'string' },
                issueDescription: { type: 'string', description: 'What is the problem? Free-form description' },
                preferredDate: { type: 'string', description: 'YYYY-MM-DD if customer mentions a date' },
                preferredTimeWindow: { type: 'string', description: 'mañana / tarde / noche or HH:MM-HH:MM' },
            },
            required: ['serviceType', 'issueDescription'],
        },
    },
    {
        name: 'check_request_status',
        description: 'Look up the status of a previously created service request. Returns current stage (pending/scheduled/dispatched/in_progress/completed) plus assigned technician name + scheduled time when available. Requires the request UUID — if the customer does not give you one (they almost never have it), call list_my_requests instead.',
        parameters: {
            type: 'object',
            properties: {
                requestId: { type: 'string', description: 'Request UUID returned by create_service_request' },
            },
            required: ['requestId'],
        },
    },
    {
        // "¿Ya viene el técnico?" es el segundo mensaje del rubro, y hasta ahora
        // la única forma de responderlo exigía un UUID que el cliente nunca vio:
        // el id sólo existe dentro del turno en que se creó la solicitud.
        name: 'list_my_requests',
        description: 'List this customer\'s own service requests, newest first, with status, technician and scheduled time. Use this whenever the customer asks about "my request", "is the technician coming?", "what happened with my repair" — they will not have a request ID.',
        parameters: {
            type: 'object',
            properties: {
                onlyOpen: { type: 'boolean', description: 'Default true — only requests that are not completed or cancelled' },
            },
        },
    },
    {
        name: 'cancel_service_request',
        description: 'Cancel a service request. Only requests in "pending" or "scheduled" status can be cancelled — requests already dispatched or in progress cannot. The customer can only cancel their own requests.',
        parameters: {
            type: 'object',
            properties: {
                requestId: { type: 'string', description: 'Request UUID returned by create_service_request' },
                reason: { type: 'string', description: 'Reason for cancellation' },
            },
            required: ['requestId'],
        },
    },
];

// ── Pet services (peluquería pet, guardería, hotel canino) ───────

export const PET_SERVICES_TOOLS: ToolDefinition[] = [
    {
        name: 'list_pet_services',
        description: 'List the pet services this business offers (peluquería, guardería diurna, hotel canino, paseos). Returns name + duration + price for each. Powers the menu of options the agent can offer.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'check_daycare_availability',
        description: 'Check whether daycare slots are open on a specific date. For boarding (hotel canino) call with checkOut to validate the full stay window.',
        parameters: {
            type: 'object',
            properties: {
                checkIn: { type: 'string', description: 'Drop-off date YYYY-MM-DD' },
                checkOut: { type: 'string', description: 'Pick-up date YYYY-MM-DD (boarding only)' },
                petSize: {
                    type: 'string',
                    enum: ['small', 'medium', 'large', 'xlarge'],
                    description: 'Affects which kennel size is needed',
                },
            },
            required: ['checkIn'],
        },
    },
];

// ── Photography / wedding planners ───────────────────────────────

export const PHOTOGRAPHY_TOOLS: ToolDefinition[] = [
    {
        name: 'list_photo_packages',
        description: 'List photography packages this studio offers (sesión familiar, boda, evento corporativo, producto). Returns name + duration + deliverables + price.',
        parameters: { type: 'object', properties: {} },
    },
    {
        // "¿Me muestras trabajos anteriores?" es la pregunta que cierra la venta
        // en este rubro, y sin esta tool el agente solo podía describir las fotos
        // con palabras. Las imágenes salen del banco de medios del tenant, así
        // que el modelo no elige qué mandar: solo pide que se mande.
        name: 'send_portfolio',
        description: 'Send the studio\'s portfolio photos to the customer. Use whenever they ask to see previous work, examples, "fotos de trabajos anteriores", "¿tienen ejemplos?" or want to judge the style before booking. Sends real images from the studio\'s media library — do NOT describe or invent image links yourself, just call this. Optionally pass a category to narrow it (boda, familiar, producto, corporativo); if that category has no photos it falls back to the general portfolio.',
        parameters: {
            type: 'object',
            properties: {
                category: {
                    type: 'string',
                    description: 'Optional shoot type to filter by, e.g. boda / familiar / producto / corporativo / retrato',
                },
            },
        },
    },
    {
        name: 'check_date_availability',
        description: 'Check whether a specific date is open for a shoot. Returns available time windows. CRITICAL for wedding photographers — prevents double booking.',
        parameters: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'YYYY-MM-DD' },
                duration: { type: 'number', description: 'Estimated hours of coverage' },
                eventType: {
                    type: 'string',
                    enum: ['familiar', 'boda', 'corporativo', 'producto', 'retrato', 'evento_social'],
                },
            },
            required: ['date'],
        },
    },
    {
        name: 'request_photo_quote',
        description: 'Generate a quote for a specific date + package. Captures the lead even if they don\'t book immediately. Always confirm name + email + phone before calling.',
        parameters: {
            type: 'object',
            properties: {
                packageName: { type: 'string' },
                date: { type: 'string', description: 'YYYY-MM-DD' },
                duration: { type: 'number', description: 'Hours of coverage' },
                location: { type: 'string', description: 'Where the shoot will happen' },
                customerName: { type: 'string' },
                customerEmail: { type: 'string' },
                customerPhone: { type: 'string' },
                specialRequests: { type: 'string' },
            },
            required: ['date', 'customerName'],
        },
    },
    {
        name: 'cancel_photo_session',
        description: 'Cancel a previously scheduled photo session. Only sessions in "scheduled" status can be cancelled. The customer can only cancel their own sessions.',
        parameters: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session UUID returned by request_photo_quote' },
                reason: { type: 'string', description: 'Reason for cancellation' },
            },
            required: ['sessionId'],
        },
    },
];
