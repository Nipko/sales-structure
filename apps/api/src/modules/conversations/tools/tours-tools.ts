/**
 * Tours / Travel Packages tools — give the agent live access to the tenant's
 * tour catalog, departure availability, and direct bookings.
 * Registered when config.tools.tours.enabled === true.
 *
 * Difference vs vacation-rental: tours are scheduled experiences with a
 * departure date (and optional time), and are charged per person, not per
 * night. Multi-day packages (duration_type='days') and same-day experiences
 * (duration_type='hours') share this tool surface — the LLM treats them
 * uniformly via duration_type/duration_value in the response.
 */
import { ToolDefinition } from '@parallext/shared';

export const TOURS_TOOLS: ToolDefinition[] = [
    {
        name: 'search_packages',
        description: 'Search tour packages and travel experiences offered by this business. Use when the customer asks about available tours, day trips, multi-day packages, or experiences. Returns matching packages with price, duration, languages and whether they have inventory for the requested date.',
        parameters: {
            type: 'object',
            properties: {
                destination: {
                    type: 'string',
                    description: 'Destination or theme keyword (e.g. "Cartagena", "snorkel", "city tour")',
                },
                durationType: {
                    type: 'string',
                    enum: ['hours', 'days'],
                    description: 'Filter by same-day experiences (hours) or multi-day packages (days)',
                },
                date: {
                    type: 'string',
                    description: 'Departure date YYYY-MM-DD — when supplied, only packages with availability that day are returned',
                },
                partySize: {
                    type: 'number',
                    description: 'Number of travellers — used together with date to filter by capacity',
                },
                maxPrice: {
                    type: 'number',
                    description: 'Maximum price per person in the local currency',
                },
            },
        },
    },
    {
        name: 'get_package_details',
        description: 'Get full details of a tour package: includes/excludes, what to bring, languages, cancellation policy, and currently available departure dates.',
        parameters: {
            type: 'object',
            properties: {
                packageId: { type: 'string', description: 'Package UUID' },
            },
            required: ['packageId'],
        },
    },
    {
        name: 'check_package_availability',
        description: 'Check if a tour package has seats available on a specific date for a given party size. Returns seats remaining or "unlimited" for custom packages without fixed inventory.',
        parameters: {
            type: 'object',
            properties: {
                packageId: { type: 'string', description: 'Package UUID' },
                date: { type: 'string', description: 'Departure date YYYY-MM-DD' },
                partySize: { type: 'number', description: 'Number of travellers' },
            },
            required: ['packageId', 'date', 'partySize'],
        },
    },
    {
        name: 'create_tour_booking',
        description: 'Reserve seats on a tour package for the customer. Decrements available capacity. Booking is created in "reserved" status — payment is handled separately. Returns paymentStatus and a payableReference when chargeable; pass that opaque reference unchanged to payment tools and never derive one yourself.',
        parameters: {
            type: 'object',
            properties: {
                packageId: { type: 'string', description: 'Package UUID' },
                departureDate: { type: 'string', description: 'Departure date YYYY-MM-DD' },
                departureTime: { type: 'string', description: 'Optional departure time HH:MM' },
                partySize: { type: 'number', description: 'Total travellers (adults + children)' },
                adults: { type: 'number', description: 'Number of adults' },
                children: { type: 'number', description: 'Number of children (apply child_discount_pct if any)' },
                guestName: { type: 'string', description: 'Lead traveller full name' },
                guestPhone: { type: 'string', description: 'Phone in international format' },
                guestEmail: { type: 'string', description: 'Email (optional but useful for confirmations)' },
                language: { type: 'string', description: 'Preferred tour language (es/en/pt/fr)' },
                specialRequests: { type: 'string', description: 'Any special requests (allergies, accessibility, anniversary, etc.)' },
            },
            required: ['packageId', 'departureDate', 'partySize', 'guestName'],
        },
    },
    {
        name: 'cancel_tour_booking',
        description: 'Cancel a tour booking by ID. The customer can only cancel their own bookings. Seats are restored to inventory. Use when the customer wants to cancel a previously booked tour.',
        parameters: {
            type: 'object',
            properties: {
                bookingId: { type: 'string', description: 'Booking UUID returned by create_tour_booking' },
                reason: { type: 'string', description: 'Reason for cancellation' },
            },
            required: ['bookingId'],
        },
    },
    {
        name: 'list_my_tour_bookings',
        description: 'List all tour bookings for the current customer, including paymentStatus and a payableReference only when chargeable. Use before cancellation, payment-link creation, or payment-status lookup. Pass payableReference unchanged and never derive one yourself.',
        parameters: { type: 'object', properties: {} },
    },
];
