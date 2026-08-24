/**
 * Tier 3 verticals AI tools: home services dispatch, pet services
 * (grooming/daycare/hotel) and photography. Each set is registered
 * by a separate config flag so a tenant only sees the relevant tools.
 */
import { ToolDefinition } from '@parallext/shared';

// ── Home services (servicios_hogar) ──────────────────────────────

export const HOME_SERVICES_TOOLS: ToolDefinition[] = [
    {
        name: 'list_home_services',
        description: 'List the active field-service visit types configured by this business. Returns the authoritative serviceId, duration and simultaneous capacity. Call this before checking or scheduling a visit.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'check_home_service_availability',
        description: 'Check live capacity for one configured field-service visit at a tenant-local start time. Duration and end time come from the service catalogue, never from the model. This is a read only; create_service_request rechecks atomically before it confirms a scheduled visit.',
        parameters: {
            type: 'object',
            properties: {
                serviceId: { type: 'string', description: 'Service UUID returned by list_home_services' },
                startAt: { type: 'string', description: 'Tenant-local ISO date-time, for example 2026-09-10T09:00:00' },
            },
            required: ['serviceId', 'startAt'],
        },
    },
    {
        name: 'create_service_request',
        description: 'Create a field-service request (plomería, electricidad, fumigación, limpieza, jardinería, otro). A preferred date/window is intake only and does not promise a visit. To confirm a scheduled visit, first call list_home_services and check_home_service_availability, then send both serviceId and scheduledAt; the writer rechecks capacity atomically. Always confirm address + name + phone before calling.',
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
                serviceId: { type: 'string', description: 'Configured service UUID; required together with scheduledAt to confirm a visit' },
                scheduledAt: { type: 'string', description: 'Tenant-local ISO date-time; requires serviceId. Omit both to record a pending request without promising a slot.' },
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
        description: 'Check whether the configured daycare or boarding service has capacity for the full date range. For boarding (hotel canino), pass checkOut to validate every occupied night. Pet size and special-needs suitability are not represented in the capacity model and must be confirmed by the team.',
        parameters: {
            type: 'object',
            properties: {
                checkIn: { type: 'string', description: 'Drop-off date YYYY-MM-DD' },
                checkOut: { type: 'string', description: 'Pick-up date YYYY-MM-DD (boarding only)' },
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
        description: 'Check whether a specific date is free for a full-day photo shoot. Returns a boolean availability result and the number of active appointments/photo sessions already using that date; it does not return time windows.',
        parameters: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'YYYY-MM-DD' },
            },
            required: ['date'],
        },
    },
    {
        name: 'request_photo_quote',
        description: 'Register a photography session request for team follow-up and atomically hold its full-day date for a limited time. This creates a photo_sessions record but does not calculate or promise a price. If the date was taken after the availability check, it fails with photo_date_unavailable: offer another date and never claim it was reserved. Confirm the date and customer name before calling; include phone, package, location, session type, and special requests when known.',
        parameters: {
            type: 'object',
            properties: {
                sessionType: {
                    type: 'string',
                    enum: ['wedding', 'portrait', 'event', 'product', 'family', 'newborn', 'other'],
                    description: 'Type of photography session stored on the request',
                },
                packageName: { type: 'string' },
                date: { type: 'string', description: 'YYYY-MM-DD' },
                location: { type: 'string', description: 'Where the shoot will happen' },
                customerName: { type: 'string' },
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

// ── Servicios profesionales (abogados / contadores / arquitectos) ──

export const PROFESSIONAL_SERVICES_TOOLS: ToolDefinition[] = [
    {
        // Deliberadamente sin parámetros. El "caso" es la oportunidad del
        // embudo y su UUID solo existe puertas adentro: pedirle un id al
        // cliente garantiza que la tool nunca se use. Se resuelve por el
        // contacto de la conversación, igual que list_my_requests.
        name: 'get_case_status',
        description: 'Look up the status of this customer\'s own case(s) with the firm. Use when they ask "¿cómo va mi caso?", "¿hay novedades?", "¿en qué quedó lo mío?", "¿avanzó el trámite?". Takes no parameters — it resolves the cases from the contact you are already talking to. Returns a short readable reference, the current stage and when it last moved. If there are no cases, take their details and escalate to the professional in charge instead of guessing. NEVER state fees, outcomes or legal/tax opinions from this data.',
        parameters: { type: 'object', properties: {} },
    },
];
