/**
 * Gym AI tools — give the agent ("Alex") access to the membership
 * catalog, the class schedule, and member-specific actions like booking
 * a class or freezing a membership. Registered when
 * config.tools.gyms.enabled === true (set automatically when a tenant
 * onboards with industry='gimnasios').
 *
 * Important: book_class and freeze_membership reference the member by
 * ID, not the contact ID — the agent should call get_my_membership
 * first to resolve the current contact's member record.
 */
import { ToolDefinition } from '@parallext/shared';

export const GYMS_TOOLS: ToolDefinition[] = [
    {
        name: 'get_membership_plans',
        description: 'List all active membership plans with price, duration, class credits and perks. Use when the customer asks about plans, prices, or what is included.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'get_class_schedule',
        description: 'List upcoming fitness classes available for booking in the next N days. Optionally filter by class type (yoga, crossfit, spinning, pilates). Returns scheduled time, instructor, available spots, and credits required.',
        parameters: {
            type: 'object',
            properties: {
                daysAhead: {
                    type: 'number',
                    description: 'How many days ahead to look — defaults to 7. Max 30.',
                },
                classType: {
                    type: 'string',
                    description: 'Filter by class type. Common: yoga, crossfit, spinning, pilates, hiit.',
                },
            },
        },
    },
    {
        name: 'get_my_membership',
        description: 'Look up the current contact\'s active membership: plan, period dates, credits remaining, status. Returns null if the contact is not yet a member. Always call BEFORE book_class or freeze_membership.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'book_class',
        description: 'Reserve a spot in a fitness class for the current member. Decrements available_spots and class_credits_remaining. Use only after the customer has confirmed which class + time, and you have already called get_my_membership to verify they have an active membership. If the class is full this does NOT fail: it puts the member on the waitlist and returns waitlisted=true with their position — read the returned "message" and never tell them the spot is confirmed in that case.',
        parameters: {
            type: 'object',
            properties: {
                classId: { type: 'string', description: 'Class UUID from get_class_schedule' },
                memberId: { type: 'string', description: 'Member UUID from get_my_membership' },
            },
            required: ['classId', 'memberId'],
        },
    },
    {
        name: 'freeze_membership',
        description: 'Freeze the current member\'s membership for N days. Use when the member explicitly requests it (vacation, injury, travel). Plan-level freeze allowance applies — the tool will reject if exceeded.',
        parameters: {
            type: 'object',
            properties: {
                memberId: { type: 'string', description: 'Member UUID from get_my_membership' },
                days: { type: 'number', description: 'Days to freeze (1-180)' },
            },
            required: ['memberId', 'days'],
        },
    },
    {
        name: 'get_my_class_bookings',
        description: 'List the current contact\'s upcoming confirmed bookings and waitlist entries, including bookingId, class name and time. Call before cancelling or when recovering a reservation from an earlier conversation.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'cancel_class_booking',
        description: 'Cancel an owned upcoming class reservation or waitlist entry. Only confirmed reservations restore consumed credits; waiting entries never consumed them. First call get_my_class_bookings and obtain confirmation for the selected class and time.',
        parameters: {
            type: 'object',
            properties: {
                bookingId: { type: 'string', description: 'Booking UUID returned by get_my_class_bookings or book_class' },
            },
            required: ['bookingId'],
        },
    },
];
