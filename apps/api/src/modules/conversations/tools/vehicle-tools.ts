/**
 * Vehicle dealership tools — let the agent show the tenant's real vehicle inventory
 * to the customer (search, details, photo) instead of asking the human team.
 * Registered when config.tools.vehicles.enabled === true.
 */
import { ToolDefinition } from '@parallext/shared';

export const VEHICLE_TOOLS: ToolDefinition[] = [
    {
        name: 'search_vehicles',
        description: 'Search the dealership\'s available vehicle inventory. Use when the customer asks about cars/vehicles for sale. Returns available vehicles with make, model, year, price, mileage and condition.',
        parameters: {
            type: 'object',
            properties: {
                make: { type: 'string', description: 'Brand / make of interest (partial match — "Toyota" matches "Toyota Corolla")' },
                budgetMax: { type: 'number', description: 'Maximum budget in the local currency (NOT cents) — e.g. 20000 for $20,000' },
                category: { type: 'string', description: 'Body type / category (e.g. sedan, SUV, pickup) — exact match' },
                fuelType: { type: 'string', description: 'Fuel type (e.g. gasoline, diesel, hybrid, electric) — exact match' },
                condition: { type: 'string', description: 'Condition (e.g. new, used) — exact match' },
                year: { type: 'number', description: 'Minimum model year' },
            },
        },
    },
    {
        name: 'get_vehicle_details',
        description: 'Get full details of a vehicle (trim, color, transmission, mileage, features, description, location). Use after the customer expresses interest in a specific vehicle from search_vehicles.',
        parameters: {
            type: 'object',
            properties: {
                vehicleId: { type: 'string', description: 'Vehicle UUID returned by search_vehicles' },
            },
            required: ['vehicleId'],
        },
    },
    {
        name: 'send_vehicle_image',
        description: 'Send the customer a real photo of a specific vehicle. Use when showing/recommending a vehicle would benefit from a visual. Only call with a vehicleId you got from search_vehicles.',
        parameters: {
            type: 'object',
            properties: {
                vehicleId: { type: 'string', description: 'Vehicle UUID returned by search_vehicles' },
            },
            required: ['vehicleId'],
        },
    },
    // The dealership's actual sale step. Without it the agent could search,
    // describe and photograph a car and then had nothing to close with: it
    // announced "te agendo la prueba de manejo" and nothing was ever recorded.
    {
        name: 'schedule_test_drive',
        description: 'Book a test drive for a specific vehicle. This is how a test drive actually gets recorded — never tell the customer their test drive is scheduled unless this succeeded. Call it only after the customer chose a vehicle (vehicleId from search_vehicles) and agreed on a day and time. If the slot is taken the call fails and you must offer another time.',
        parameters: {
            type: 'object',
            properties: {
                vehicleId: { type: 'string', description: 'Vehicle UUID returned by search_vehicles' },
                contactName: { type: 'string', description: 'Full name of the person who will drive' },
                scheduledDate: { type: 'string', description: 'Date in YYYY-MM-DD' },
                scheduledTime: { type: 'string', description: 'Time in HH:MM (24h), local to the dealership' },
                notes: { type: 'string', description: 'Anything the team should know (optional)' },
            },
            required: ['vehicleId', 'contactName', 'scheduledDate', 'scheduledTime'],
        },
    },
];
