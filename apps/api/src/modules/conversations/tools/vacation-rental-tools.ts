/**
 * Vacation Rental tools — give the agent live access to the tenant's
 * properties, availability, and direct bookings.
 * Registered when config.tools.properties.enabled === true.
 */
import { ToolDefinition } from '@parallext/shared';

export const VACATION_RENTAL_TOOLS: ToolDefinition[] = [
    {
        name: 'list_properties',
        description: 'List all available properties for the host. Optionally filter by guest count and dates.',
        parameters: {
            type: 'object',
            properties: {
                guests: { type: 'number', description: 'Number of guests' },
                checkIn: { type: 'string', description: 'Check-in date YYYY-MM-DD' },
                checkOut: { type: 'string', description: 'Check-out date YYYY-MM-DD' },
            },
        },
    },
    {
        name: 'check_property_availability',
        description: 'Check if a specific property is available for given dates and get pricing.',
        parameters: {
            type: 'object',
            properties: {
                propertyId: { type: 'string', description: 'Property UUID (retrieve it by calling list_properties first; do NOT pass the property name)' },
                checkIn: { type: 'string', description: 'Check-in date YYYY-MM-DD' },
                checkOut: { type: 'string', description: 'Check-out date YYYY-MM-DD' },
                guests: { type: 'number', description: 'Number of guests' },
            },
            required: ['propertyId', 'checkIn', 'checkOut'],
        },
    },
    {
        name: 'get_property_details',
        description: 'Get full details of a property including amenities, rules, and pricing.',
        parameters: {
            type: 'object',
            properties: {
                propertyId: { type: 'string', description: 'Property UUID (retrieve it by calling list_properties first; do NOT pass the property name)' },
            },
            required: ['propertyId'],
        },
    },
    {
        name: 'get_check_in_instructions',
        description: 'Get check-in instructions for a property (door code, WiFi, parking).',
        parameters: {
            type: 'object',
            properties: {
                propertyId: { type: 'string', description: 'Property UUID (retrieve it by calling list_properties first; do NOT pass the property name)' },
            },
            required: ['propertyId'],
        },
    },
    {
        name: 'create_property_booking',
        description: 'Create a direct booking for a property. Checks availability first.',
        parameters: {
            type: 'object',
            properties: {
                propertyId: { type: 'string', description: 'Property UUID (retrieve it by calling list_properties first; do NOT pass the property name)' },
                checkIn: { type: 'string', description: 'Check-in date YYYY-MM-DD' },
                checkOut: { type: 'string', description: 'Check-out date YYYY-MM-DD' },
                guestName: { type: 'string', description: 'Guest full name' },
                guestPhone: { type: 'string', description: 'Guest phone number' },
                guests: { type: 'number', description: 'Number of guests' },
            },
            required: ['propertyId', 'checkIn', 'checkOut', 'guestName'],
        },
    },
    {
        name: 'cancel_property_booking',
        description: 'Cancel a property booking by ID. The customer can only cancel their own bookings. Blocked dates are released. Use when the guest wants to cancel a previously made reservation.',
        parameters: {
            type: 'object',
            properties: {
                bookingId: { type: 'string', description: 'Booking UUID returned by create_property_booking' },
                reason: { type: 'string', description: 'Reason for cancellation' },
            },
            required: ['bookingId'],
        },
    },
    {
        name: 'list_my_property_bookings',
        description: 'List all property bookings for the current guest. Use before cancel_property_booking so the guest can identify which booking to cancel.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'send_property_image',
        description: 'Send the guest a real photo of a specific property. Use when showing/recommending a property would benefit from a visual (e.g. the guest asks to see it). Only call with a propertyId you got from list_properties.',
        parameters: {
            type: 'object',
            properties: {
                propertyId: { type: 'string', description: 'Property UUID (retrieve it by calling list_properties first; do NOT pass the property name)' },
            },
            required: ['propertyId'],
        },
    },
];
