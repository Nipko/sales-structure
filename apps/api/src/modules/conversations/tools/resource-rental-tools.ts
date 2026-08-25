/**
 * Resource rentals — alquiler de vehículos y guardería/hotel de mascotas.
 *
 * `ResourceRentalsService` already owned locks, per-night capacity, overlap
 * checks and a dashboard at `/admin/resource-rentals`. What it never had was a
 * way in from a conversation: the manifest promised the capability, the menu
 * showed the object, and the agent could only offer to pass the customer to a
 * human. Worse for boarding, the one read it did have counted occupancy from a
 * different table than the writer, so "sí hay cupo" and "no se pudo reservar"
 * could happen in the same turn.
 *
 * These tools close that loop against the single system of record.
 * Registered when `config.tools.resourceRentals.enabled === true`.
 */
import { ToolDefinition } from '@parallext/shared';

/** Vehicle rental — `automotriz/alquiler`. */
export const VEHICLE_RENTAL_TOOLS: ToolDefinition[] = [
    {
        name: 'check_vehicle_rental_availability',
        description: 'Check whether a specific vehicle is free for a pick-up/drop-off date range before offering it. Get the vehicleId from search_vehicles first. The range is half-open: the drop-off day itself is not occupied. Returns available:true/false plus the conflicting dates when it is taken. NEVER promise a vehicle without calling this.',
        parameters: {
            type: 'object',
            properties: {
                vehicleId: { type: 'string', description: 'Vehicle UUID from search_vehicles' },
                startDate: { type: 'string', description: 'Pick-up date YYYY-MM-DD' },
                endDate: { type: 'string', description: 'Drop-off date YYYY-MM-DD (must be after startDate)' },
            },
            required: ['vehicleId', 'startDate', 'endDate'],
        },
    },
    {
        name: 'create_vehicle_rental',
        description: 'Submit a vehicle-rental request for human eligibility review. Success means REQUEST RECEIVED, never reserved or approved. Call it after confirming vehicle, dates and driver intake. Identity, licence, insurance and payment always remain pending until staff reviews evidence; the agent must say that clearly.',
        parameters: {
            type: 'object',
            properties: {
                vehicleId: { type: 'string', description: 'Vehicle UUID from search_vehicles' },
                startDate: { type: 'string', description: 'Pick-up date YYYY-MM-DD' },
                endDate: { type: 'string', description: 'Drop-off date YYYY-MM-DD' },
                driverName: { type: 'string', description: 'Name of the person who will drive' },
                driverPhone: { type: 'string', description: 'Contact phone for the rental (optional)' },
                declaredAge: { type: 'integer', description: 'Age declared by the driver; it is intake only and never proves eligibility (optional)' },
                licenseCountry: { type: 'string', description: 'Two-letter country code that issued the licence, when declared (optional)' },
                pickupLocation: { type: 'string', description: 'Requested pick-up branch or address (optional)' },
                pickupAt: { type: 'string', description: 'Requested pick-up ISO date-time, including timezone when known (optional)' },
                returnLocation: { type: 'string', description: 'Requested return branch or address (optional)' },
                returnAt: { type: 'string', description: 'Requested return ISO date-time, including timezone when known (optional)' },
                extras: { type: 'array', items: { type: 'string' }, description: 'Requested child seat, extra driver or other extras (optional)' },
                notes: { type: 'string', description: 'Pick-up branch, extras, or anything the team must know (optional)' },
            },
            required: ['vehicleId', 'startDate', 'endDate', 'driverName'],
        },
    },
    {
        name: 'list_my_vehicle_rentals',
        description: "List this customer's vehicle rentals (upcoming and in progress) with dates, vehicle and status. Use when they ask about \"mi alquiler\", want to change or cancel one, or ask what they have reserved.",
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'get_vehicle_rental',
        description: 'Fetch one vehicle rental in full by its ID — dates, vehicle, status and notes. Use after list_my_vehicle_rentals when the customer asks about a specific reservation.',
        parameters: {
            type: 'object',
            properties: {
                rentalId: { type: 'string', description: 'Rental UUID from list_my_vehicle_rentals' },
            },
            required: ['rentalId'],
        },
    },
    {
        name: 'cancel_vehicle_rental',
        description: "Cancel one of this customer's vehicle rentals. Only their own reservations can be cancelled, and only before the vehicle is returned. Confirm WHICH rental with the customer before calling.",
        parameters: {
            type: 'object',
            properties: {
                rentalId: { type: 'string', description: 'Rental UUID from list_my_vehicle_rentals' },
                reason: { type: 'string', description: 'Why the customer is cancelling (optional)' },
            },
            required: ['rentalId'],
        },
    },
];

/** Pet boarding / daycare — `pet_services/guarderia` and `pet_services/hotel`. */
export const PET_BOARDING_TOOLS: ToolDefinition[] = [
    {
        name: 'create_pet_boarding',
        description: 'Reserve a daycare or boarding stay for one of the tutor\'s pets. This is the ONLY way the stay actually exists — never tell the tutor the spot is held unless this succeeded. Requires the petId (from list_pets_for_contact) and the boarding serviceId (from list_pet_services). The range is half-open: the pick-up day is not charged as a night. The server re-checks per-night capacity under a lock.',
        parameters: {
            type: 'object',
            properties: {
                petId: { type: 'string', description: 'Pet UUID from list_pets_for_contact' },
                serviceId: { type: 'string', description: 'Boarding/daycare service UUID from list_pet_services' },
                startDate: { type: 'string', description: 'Drop-off date YYYY-MM-DD' },
                endDate: { type: 'string', description: 'Pick-up date YYYY-MM-DD (must be after startDate)' },
                notes: { type: 'string', description: 'Feeding, medication, behaviour or anything the team must know (optional)' },
            },
            required: ['petId', 'serviceId', 'startDate', 'endDate'],
        },
    },
    {
        name: 'list_my_pet_boardings',
        description: "List this tutor's daycare/boarding stays (upcoming and in progress) with pet, dates and status. Use when they ask about \"la guardería\", \"la estadía\", want to change or cancel one.",
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'get_pet_boarding',
        description: 'Fetch one daycare/boarding stay in full by its ID — pet, service, dates, status and care notes.',
        parameters: {
            type: 'object',
            properties: {
                boardingId: { type: 'string', description: 'Boarding UUID from list_my_pet_boardings' },
            },
            required: ['boardingId'],
        },
    },
    {
        name: 'cancel_pet_boarding',
        description: "Cancel one of this tutor's daycare/boarding stays. Only their own reservations can be cancelled, and only before check-out. Confirm WHICH stay with the tutor before calling.",
        parameters: {
            type: 'object',
            properties: {
                boardingId: { type: 'string', description: 'Boarding UUID from list_my_pet_boardings' },
                reason: { type: 'string', description: 'Why the tutor is cancelling (optional)' },
            },
            required: ['boardingId'],
        },
    },
];

export const RESOURCE_RENTAL_TOOLS: ToolDefinition[] = [
    ...VEHICLE_RENTAL_TOOLS,
    ...PET_BOARDING_TOOLS,
];
