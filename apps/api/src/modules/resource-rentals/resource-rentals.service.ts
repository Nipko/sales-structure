import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
    assertOptionalContactId,
    requireTenantContact,
} from '../../common/utils/tenant-contact.util';
import { resolveNativeEvidenceOpportunity } from '../../common/utils/native-evidence-opportunity.util';
import {
    RentalEligibilityStatus,
    validateResourceRentalDetails,
    VehicleRentalDetails,
} from '@parallext/shared';

export type ResourceRentalType = 'vehicle_rental' | 'pet_boarding';
export type VehicleRentalStatus =
    | 'pending_review'
    | 'reserved'
    | 'picked_up'
    | 'returned'
    | 'rejected'
    | 'cancelled';
export type PetBoardingStatus = 'reserved' | 'checked_in' | 'checked_out' | 'cancelled';
export type ResourceRentalStatus = VehicleRentalStatus | PetBoardingStatus;

export interface CreateResourceRentalInput {
    type: ResourceRentalType;
    resourceId: string;
    serviceId?: string;
    contactId?: string;
    opportunityId?: string;
    customerName?: string;
    customerPhone?: string;
    startDate: string;
    endDate: string;
    notes?: string;
    metadata?: Record<string, unknown>;
}

export type RentalEligibilityDimension = 'identity' | 'driverLicense' | 'insurance' | 'payment';

export interface RecordRentalInspectionInput {
    inspectionType: 'pickup' | 'return';
    odometer?: number;
    fuelPercent?: number;
    conditionNotes: string;
    mediaIds?: string[];
    handoffMethod: 'otp' | 'signature' | 'manual';
    handoffEvidenceRef: string;
    expectedVersion?: number;
}

export interface ReportRentalDamageInput {
    inspectionId?: string;
    description: string;
    amountCents?: number;
    currency?: string;
    mediaIds?: string[];
}

interface RentalRange {
    startDate: string;
    endDate: string;
    nights: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RENTAL_TYPES: ResourceRentalType[] = ['vehicle_rental', 'pet_boarding'];
const VEHICLE_STATUSES: VehicleRentalStatus[] = [
    'pending_review', 'reserved', 'picked_up', 'returned', 'rejected', 'cancelled',
];
const BOARDING_STATUSES: PetBoardingStatus[] = ['reserved', 'checked_in', 'checked_out', 'cancelled'];
const ALL_STATUSES = new Set<ResourceRentalStatus>([...VEHICLE_STATUSES, ...BOARDING_STATUSES]);
const TERMINAL_STATUSES = new Set<ResourceRentalStatus>(['returned', 'checked_out', 'rejected', 'cancelled']);
const ELIGIBILITY_DIMENSIONS: RentalEligibilityDimension[] = [
    'identity', 'driverLicense', 'insurance', 'payment',
];
const ELIGIBILITY_STATUSES: RentalEligibilityStatus[] = [
    'pending', 'verified', 'rejected', 'not_required',
];
const MAX_RENTAL_DAYS = 366;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

@Injectable()
export class ResourceRentalsService {
    constructor(private readonly prisma: PrismaService) {}

    async list(
        schemaName: string,
        filters: {
            type?: string;
            status?: string;
            resourceId?: string;
            /** Scopes the list to one customer. Required by the agent's `list_my_*` reads. */
            contactId?: string;
            /** Excludes rentals already cancelled/returned/checked out. */
            activeOnly?: boolean;
            from?: string;
            to?: string;
            limit?: number;
        } = {},
    ): Promise<any[]> {
        const conditions: string[] = [];
        const params: any[] = [];
        let index = 1;

        if (filters.type) {
            const type = this.assertRentalType(filters.type);
            conditions.push(`r.rental_type = $${index++}`);
            params.push(type);
        }
        if (filters.status) {
            const status = this.assertKnownStatus(filters.status);
            conditions.push(`r.status = $${index++}`);
            params.push(status);
        }
        if (filters.resourceId) {
            const resourceId = this.assertUuid(filters.resourceId, 'resourceId');
            conditions.push(`r.resource_id = $${index++}::uuid`);
            params.push(resourceId);
        }
        // Ownership is a filter, not a post-read check: a conversation must never
        // load another customer's rentals into the model's context first and
        // discard them afterwards.
        if (filters.contactId) {
            const contactId = this.assertUuid(filters.contactId, 'contactId');
            conditions.push(`r.contact_id = $${index++}::uuid`);
            params.push(contactId);
        }
        if (filters.activeOnly) {
            conditions.push(`r.status NOT IN ('cancelled', 'returned', 'checked_out')`);
        }

        const from = filters.from ? this.assertDateOnly(filters.from, 'from') : undefined;
        const to = filters.to ? this.assertDateOnly(filters.to, 'to') : undefined;
        if (from && to && to <= from) {
            throw new BadRequestException('to must be after from');
        }
        // The query range is half-open too: a rental ending on `from`, or
        // starting on `to`, is outside the requested window.
        if (from) {
            conditions.push(`r.end_date > $${index++}::date`);
            params.push(from);
        }
        if (to) {
            conditions.push(`r.start_date < $${index++}::date`);
            params.push(to);
        }

        const requestedLimit = filters.limit ?? 100;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new BadRequestException('limit must be a positive integer');
        }
        const limit = Math.min(requestedLimit, 500);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT r.*,
                    CASE
                        WHEN r.rental_type = 'vehicle_rental'
                            THEN CONCAT_WS(' ', v.make, v.model, v.year::text)
                        ELSE p.name
                    END AS resource_name,
                    v.make AS vehicle_make,
                    v.model AS vehicle_model,
                    v.year AS vehicle_year,
                    p.name AS pet_name,
                    p.species AS pet_species,
                    s.name AS service_name,
                    s.category AS service_category,
                    c.name AS contact_name,
                    c.phone AS contact_phone
             FROM resource_rentals r
             LEFT JOIN vehicles v
               ON r.rental_type = 'vehicle_rental' AND v.id = r.resource_id
             LEFT JOIN pets p
               ON r.rental_type = 'pet_boarding' AND p.id = r.resource_id
             LEFT JOIN services s ON s.id = r.service_id
             LEFT JOIN contacts c ON c.id = r.contact_id
             ${where}
             ORDER BY r.start_date ASC, r.created_at DESC
             LIMIT ${limit}`,
            params,
        );
    }

    async create(
        schemaName: string,
        input: CreateResourceRentalInput,
        actorId?: string,
    ): Promise<any> {
        if (!input || typeof input !== 'object') {
            throw new BadRequestException('Rental payload is required');
        }
        const type = this.assertRentalType(input.type);
        const resourceId = this.assertUuid(input.resourceId, 'resourceId');
        const range = this.assertRange(input.startDate, input.endDate);
        const contactId = assertOptionalContactId(input.contactId);
        if (type === 'vehicle_rental' && !contactId) {
            throw new BadRequestException('contactId is required for vehicle_rental');
        }
        const createdBy = actorId && UUID_PATTERN.test(actorId) ? actorId : null;
        const rawMetadata = input.metadata ?? {};
        if (typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
            throw new BadRequestException('metadata must be an object');
        }
        const metadata = { ...rawMetadata };
        // `metadata.details` deja de ser texto libre.
        //
        // El conductor, el depósito, el contrato, la jaula y el grupo de patio
        // terminaban acá cuando terminaban, y cada llamador los escribía
        // distinto: el panel guardaba `driverName`, un import ponía
        // `driver_name` y el agente no escribía ninguno. Nadie podía construir
        // una pantalla encima porque no había dos filas con la misma forma.
        if (type === 'vehicle_rental') {
            const supplied = ((metadata as any).details ?? {}) as Record<string, any>;
            const driverName = String(supplied.driver?.name || input.customerName || '').trim();
            if (!driverName) {
                throw new BadRequestException('A driver name is required for vehicle_rental');
            }
            // Only intake fields cross this boundary. Eligibility decisions,
            // odometer readings, deposit capture and signature acceptance have
            // dedicated protected endpoints and cannot be smuggled into create.
            (metadata as any).details = {
                driver: {
                    ...(supplied.driver ?? {}),
                    name: driverName,
                    ...(supplied.driver?.phone || !input.customerPhone
                        ? {}
                        : { phone: input.customerPhone }),
                },
                // Intake is not adjudication. Every dimension starts pending;
                // neither the LLM nor the create endpoint may turn a statement
                // into verified identity, licence, insurance or payment.
                // Ignore any caller-supplied adjudication. Only the protected
                // eligibility endpoint may move these dimensions out of pending.
                eligibility: this.pendingEligibility(),
                ...(supplied.pickup ? { pickup: supplied.pickup } : {}),
                ...(supplied.dropoff ? { dropoff: supplied.dropoff } : {}),
                ...(supplied.extras ? { extras: supplied.extras } : {}),
                ...(supplied.deposit ? {
                    deposit: {
                        amountCents: supplied.deposit.amountCents,
                        currency: supplied.deposit.currency,
                        status: 'pending',
                    },
                } : {}),
                ...(supplied.contract ? {
                    contract: {
                        ...(supplied.contract.documentUrl ? { documentUrl: supplied.contract.documentUrl } : {}),
                        signed: false,
                    },
                } : {}),
            };
        }
        if ((metadata as any).details !== undefined) {
            const validated = validateResourceRentalDetails(type, (metadata as any).details);
            if (validated.errors.length) {
                throw new BadRequestException({
                    error: 'invalid_rental_details',
                    // Los errores, no un booleano: "los datos son inválidos" sin
                    // decir cuál es lo que hace que el dueño pruebe cinco veces
                    // y se rinda.
                    details: validated.errors,
                });
            }
            (metadata as any).details = validated.details;
        }

        if (type === 'vehicle_rental') {
            if (input.serviceId != null) {
                throw new BadRequestException('serviceId is only valid for pet_boarding');
            }
            return this.createVehicleRental(
                schemaName,
                { ...input, metadata },
                range,
                resourceId,
                contactId!,
                createdBy,
            );
        }

        const serviceId = this.assertUuid(input.serviceId, 'serviceId');
        return this.createPetBoarding(
            schemaName,
            { ...input, metadata },
            range,
            resourceId,
            serviceId,
            contactId,
            createdBy,
        );
    }

    /** Single rental with its resource labels. Returns null when it does not exist. */
    async getById(schemaName: string, rentalId: string): Promise<any | null> {
        const id = this.assertUuid(rentalId, 'rentalId');
        const found = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT r.*,
                    CASE
                        WHEN r.rental_type = 'vehicle_rental'
                            THEN CONCAT_WS(' ', v.make, v.model, v.year::text)
                        ELSE p.name
                    END AS resource_name,
                    s.name AS service_name,
                    s.category AS service_category
             FROM resource_rentals r
             LEFT JOIN vehicles v
               ON r.rental_type = 'vehicle_rental' AND v.id = r.resource_id
             LEFT JOIN pets p
               ON r.rental_type = 'pet_boarding' AND p.id = r.resource_id
             LEFT JOIN services s ON s.id = r.service_id
             WHERE r.id = $1::uuid
             LIMIT 1`,
            [id],
        );
        const rental = found?.[0] ?? null;
        if (!rental) return null;
        const [events, inspections, damages] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM resource_rental_events
                  WHERE rental_id = $1::uuid ORDER BY created_at ASC, id ASC`,
                [id],
            ),
            this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM resource_rental_inspections
                  WHERE rental_id = $1::uuid ORDER BY created_at ASC, id ASC`,
                [id],
            ),
            this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM resource_rental_damages
                  WHERE rental_id = $1::uuid ORDER BY created_at DESC, id DESC`,
                [id],
            ),
        ]);
        return { ...rental, events, inspections, damages };
    }

    /**
     * Answers "is this free?" with the SAME predicates the writer enforces.
     *
     * The conversational read and the actual reservation used to count from
     * different tables — the agent quoted capacity from `appointments` while the
     * booking was written to `resource_rentals` — so a customer could be told
     * there was room and be refused in the same turn. Availability now derives
     * from the writer's own overlap and per-night capacity queries; if they ever
     * disagree it is because someone changed one of them here.
     */
    async checkAvailability(
        schemaName: string,
        input: {
            type: string;
            /** Vehicle id for `vehicle_rental`. Optional for boarding. */
            resourceId?: string;
            /** Boarding service id. Required for `pet_boarding`. */
            serviceId?: string;
            startDate: string;
            endDate: string;
        },
    ): Promise<{
        available: boolean;
        type: ResourceRentalType;
        startDate: string;
        endDate: string;
        nights: number;
        capacity?: number;
        reason?: string;
        conflictStart?: string;
        conflictEnd?: string;
        fullNight?: string;
    }> {
        const type = this.assertRentalType(input?.type);
        const range = this.assertRange(input?.startDate, input?.endDate);

        if (type === 'vehicle_rental') {
            const vehicleId = this.assertUuid(input?.resourceId, 'resourceId');
            const vehicles = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, status FROM vehicles WHERE id = $1::uuid LIMIT 1`,
                [vehicleId],
            );
            if (!vehicles?.length) throw new NotFoundException('Vehicle not found');
            if (vehicles[0].status !== 'available') {
                return { available: false, type, ...range, reason: 'vehicle_not_available' };
            }
            const overlaps = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT start_date::text AS start_date, end_date::text AS end_date
                 FROM resource_rentals
                 WHERE rental_type = 'vehicle_rental'
                   AND resource_id = $1::uuid
                   AND status IN ('reserved', 'picked_up')
                   AND start_date < $3::date
                   AND end_date > $2::date
                 ORDER BY start_date ASC
                 LIMIT 1`,
                [vehicleId, range.startDate, range.endDate],
            );
            if (overlaps?.length) {
                return {
                    available: false,
                    type,
                    ...range,
                    reason: 'already_rented',
                    conflictStart: overlaps[0].start_date,
                    conflictEnd: overlaps[0].end_date,
                };
            }
            return { available: true, type, ...range };
        }

        const serviceId = this.assertUuid(input?.serviceId, 'serviceId');
        const services = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, category, max_concurrent, is_active
             FROM services WHERE id = $1::uuid LIMIT 1`,
            [serviceId],
        );
        const service = services?.[0];
        if (!service) throw new NotFoundException('Boarding service not found');
        if (service.is_active !== true) {
            return { available: false, type, ...range, reason: 'service_inactive' };
        }
        const category = String(service.category || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        if (!['hotel', 'guarderia'].includes(category)) {
            return { available: false, type, ...range, reason: 'service_not_boarding' };
        }
        const capacity = Number(service.max_concurrent);
        if (!Number.isInteger(capacity) || capacity < 1) {
            return { available: false, type, ...range, reason: 'capacity_not_configured' };
        }
        const fullNights = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `WITH requested_nights AS (
                SELECT generate_series(
                    $2::date,
                    ($3::date - INTERVAL '1 day')::date,
                    INTERVAL '1 day'
                )::date AS night
             )
             SELECT n.night::text AS night, COUNT(r.id)::int AS occupied
             FROM requested_nights n
             LEFT JOIN resource_rentals r
               ON r.rental_type = 'pet_boarding'
              AND r.service_id = $1::uuid
              AND r.status IN ('reserved', 'checked_in')
              AND r.start_date <= n.night
              AND r.end_date > n.night
             GROUP BY n.night
             HAVING COUNT(r.id) >= $4::int
             ORDER BY n.night
             LIMIT 1`,
            [serviceId, range.startDate, range.endDate, capacity],
        );
        if (fullNights?.length) {
            return {
                available: false,
                type,
                ...range,
                capacity,
                reason: 'no_capacity',
                fullNight: fullNights[0].night,
            };
        }
        return { available: true, type, ...range, capacity };
    }

    /**
     * Cancellation asked for by the customer in a conversation.
     *
     * `transition` requires a staff role because it is the dashboard's path.
     * The customer's authority is different and narrower: they may cancel their
     * own reservation and nothing else, so ownership is verified inside the same
     * transaction that writes the status.
     */
    async cancelForContact(
        schemaName: string,
        rentalId: string,
        contactId: string,
        reason?: string,
    ): Promise<any> {
        const id = this.assertUuid(rentalId, 'rentalId');
        const owner = this.assertUuid(contactId, 'contactId');

        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows = await query<any[]>(
                `SELECT * FROM resource_rentals WHERE id = $1::uuid FOR UPDATE`,
                [id],
            );
            const rental = rows?.[0];
            if (!rental) throw new NotFoundException('Resource rental not found');
            if (String(rental.contact_id || '').toLowerCase() !== owner.toLowerCase()) {
                throw new ForbiddenException('This reservation belongs to another customer');
            }
            const currentStatus = this.assertKnownStatus(rental.status);
            if (currentStatus === 'cancelled') return rental;
            if (rental.rental_type === 'vehicle_rental'
                && !['pending_review', 'reserved'].includes(currentStatus)) {
                throw new ConflictException(`Vehicle rental cannot be cancelled by the customer in status ${currentStatus}`);
            }
            if (TERMINAL_STATUSES.has(currentStatus)) {
                throw new ConflictException(`Rental is terminal in status ${currentStatus}`);
            }

            const note = reason ? String(reason).slice(0, 500) : null;
            const updated = await query<any[]>(
                `UPDATE resource_rentals
                    SET status = 'cancelled',
                        notes = CASE WHEN $2::text IS NULL THEN notes
                                     ELSE CONCAT_WS(E'\n', notes, $2::text) END,
                        version = version + 1,
                        updated_at = NOW()
                  WHERE id = $1::uuid
                RETURNING *`,
                [id, note ? `Cancelación del cliente: ${note}` : null],
            );
            await this.insertEvent(query, id, 'rental_cancelled', currentStatus, 'cancelled', null, {
                source: 'customer',
                reason: note,
            }, 'customer');
            return updated[0];
        });
    }

    async transition(
        schemaName: string,
        rentalId: string,
        targetStatus: string,
        actorRole?: string,
        actorId?: string,
    ): Promise<any> {
        const id = this.assertUuid(rentalId, 'rentalId');
        const requestedStatus = this.assertKnownStatus(targetStatus);

        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows = await query<any[]>(
                `SELECT * FROM resource_rentals WHERE id = $1::uuid FOR UPDATE`,
                [id],
            );
            const rental = rows?.[0];
            if (!rental) throw new NotFoundException('Resource rental not found');

            const type = this.assertRentalType(rental.rental_type);
            const validStatuses = type === 'vehicle_rental' ? VEHICLE_STATUSES : BOARDING_STATUSES;
            if (!validStatuses.some((status) => status === requestedStatus)) {
                throw new ConflictException(
                    `Status ${requestedStatus} is not valid for ${type}`,
                );
            }

            const currentStatus = this.assertKnownStatus(rental.status);
            if (currentStatus === requestedStatus) return rental;
            if (TERMINAL_STATUSES.has(currentStatus)) {
                throw new ConflictException(`Rental is terminal in status ${currentStatus}`);
            }
            if (TERMINAL_STATUSES.has(requestedStatus) && !this.canMakeTerminalTransition(actorRole)) {
                throw new ForbiddenException(
                    'Only tenant administrators and supervisors can complete or cancel rentals',
                );
            }

            const allowed = type === 'vehicle_rental'
                ? this.vehicleTransitions(currentStatus)
                : this.boardingTransitions(currentStatus);
            if (!allowed.includes(requestedStatus)) {
                throw new ConflictException(
                    `Invalid ${type} transition: ${currentStatus} -> ${requestedStatus}`,
                );
            }

            const updated = await query<any[]>(
                `UPDATE resource_rentals
                 SET status = $1, version = version + 1, updated_at = NOW()
                 WHERE id = $2::uuid
                 RETURNING *`,
                [requestedStatus, id],
            );
            await this.insertEvent(
                query,
                id,
                requestedStatus === 'cancelled' ? 'rental_cancelled' : 'status_changed',
                currentStatus,
                requestedStatus,
                actorId,
                {},
            );
            return updated[0];
        });
    }

    /**
     * Actualiza los detalles operativos de un alquiler o una estadía.
     *
     * Es una fusión superficial a propósito: quien registra el kilometraje de
     * entrada no debería tener que reenviar el conductor y el depósito para no
     * borrarlos. Y no toca el estado — para eso está `transition`, que tiene
     * sus propias reglas de quién puede cerrarlo.
     */
    async updateDetails(
        schemaName: string,
        rentalId: string,
        details: unknown,
        actorId?: string,
        actorRole?: string,
        expectedVersion?: number,
    ): Promise<any> {
        const id = this.assertUuid(rentalId, 'rentalId');
        if (!details || typeof details !== 'object' || Array.isArray(details)) {
            throw new BadRequestException('details must be an object');
        }
        const incoming = details as Record<string, any>;
        if (incoming.eligibility !== undefined) {
            throw new BadRequestException('Use the eligibility review endpoint');
        }

        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows = await query<any[]>(
                `SELECT id, rental_type, status, metadata, version FROM resource_rentals
                  WHERE id = $1::uuid FOR UPDATE`,
                [id],
            );
            const rental = rows?.[0];
            if (!rental) throw new NotFoundException('Resource rental not found');

            const type = this.assertRentalType(rental.rental_type);
            this.assertExpectedVersion(expectedVersion, rental.version);
            if (type === 'vehicle_rental') {
                const protectedMutation = incoming.deposit !== undefined
                    || incoming.contract?.signed === true;
                if (protectedMutation && !this.canMakeTerminalTransition(actorRole)) {
                    throw new ForbiddenException(
                        'Only tenant administrators and supervisors can record deposit or signature evidence',
                    );
                }
                const depositStatus = String(incoming.deposit?.status || '');
                if (['held', 'returned', 'withheld'].includes(depositStatus)
                    && !String(incoming.deposit?.evidenceRef || '').trim()) {
                    throw new BadRequestException(
                        `deposit.evidenceRef is required when deposit status is ${depositStatus}`,
                    );
                }
            }
            const current = (rental.metadata as any)?.details ?? {};
            const merged = {
                ...current,
                ...incoming,
                ...(incoming.driver ? { driver: { ...(current.driver ?? {}), ...incoming.driver } } : {}),
                ...(incoming.deposit ? { deposit: { ...(current.deposit ?? {}), ...incoming.deposit } } : {}),
                ...(incoming.contract ? { contract: { ...(current.contract ?? {}), ...incoming.contract } } : {}),
                ...(incoming.pickup ? { pickup: { ...(current.pickup ?? {}), ...incoming.pickup } } : {}),
                ...(incoming.dropoff ? { dropoff: { ...(current.dropoff ?? {}), ...incoming.dropoff } } : {}),
            };
            const validated = validateResourceRentalDetails(type, merged);
            if (validated.errors.length) {
                throw new BadRequestException({
                    error: 'invalid_rental_details',
                    details: validated.errors,
                });
            }

            const metadata = { ...((rental.metadata as any) || {}), details: validated.details };
            const updated = await query<any[]>(
                `UPDATE resource_rentals
                    SET metadata = $1::jsonb, version = version + 1, updated_at = NOW()
                  WHERE id = $2::uuid
                  RETURNING *`,
                [JSON.stringify(metadata), id],
            );
            await this.insertEvent(query, id, 'details_updated', rental.status, rental.status, actorId, {
                fields: Object.keys(incoming).sort(),
            });
            return updated[0];
        });
    }

    async reviewEligibility(
        schemaName: string,
        rentalId: string,
        input: {
            dimension: RentalEligibilityDimension;
            status: RentalEligibilityStatus;
            evidenceRef?: string;
            reason?: string;
            expectedVersion?: number;
        },
        actorId?: string,
        actorRole?: string,
    ): Promise<any> {
        if (!this.canMakeTerminalTransition(actorRole)) {
            throw new ForbiddenException('Only tenant administrators and supervisors can review eligibility');
        }
        const id = this.assertUuid(rentalId, 'rentalId');
        if (!ELIGIBILITY_DIMENSIONS.includes(input?.dimension)) {
            throw new BadRequestException(`dimension must be one of ${ELIGIBILITY_DIMENSIONS.join(', ')}`);
        }
        if (!ELIGIBILITY_STATUSES.includes(input?.status)) {
            throw new BadRequestException(`status must be one of ${ELIGIBILITY_STATUSES.join(', ')}`);
        }
        if (!Number.isInteger(input?.expectedVersion) || Number(input.expectedVersion) < 1) {
            throw new BadRequestException('expectedVersion is required');
        }
        const evidenceRef = String(input?.evidenceRef || '').trim().slice(0, 2000);
        const reason = String(input?.reason || '').trim().slice(0, 500);
        if (input.status === 'verified' && !evidenceRef) {
            throw new BadRequestException('evidenceRef is required when eligibility is verified');
        }
        if ((input.status === 'rejected' || input.status === 'not_required') && !reason) {
            throw new BadRequestException(`reason is required when eligibility is ${input.status}`);
        }

        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows = await query<any[]>(
                `SELECT id, rental_type, status, metadata, version
                   FROM resource_rentals WHERE id = $1::uuid FOR UPDATE`,
                [id],
            );
            const rental = rows?.[0];
            if (!rental) throw new NotFoundException('Resource rental not found');
            if (rental.rental_type !== 'vehicle_rental') {
                throw new ConflictException('Eligibility review only applies to vehicle rentals');
            }
            if (!['pending_review', 'reserved'].includes(rental.status)) {
                throw new ConflictException(`Eligibility cannot change in status ${rental.status}`);
            }
            this.assertExpectedVersion(input.expectedVersion, rental.version);
            const current = (rental.metadata as any)?.details ?? {};
            const eligibility = {
                ...(current.eligibility ?? this.pendingEligibility()),
                [input.dimension]: {
                    status: input.status,
                    ...(evidenceRef ? { evidenceRef } : {}),
                    ...(reason ? { reason } : {}),
                    checkedAt: new Date().toISOString(),
                    ...(this.validActorId(actorId) ? { checkedBy: actorId } : {}),
                },
            };
            const validated = validateResourceRentalDetails('vehicle_rental', {
                ...current,
                eligibility,
            });
            if (validated.errors.length) {
                throw new BadRequestException({ error: 'invalid_rental_details', details: validated.errors });
            }
            const metadata = {
                ...((rental.metadata as any) || {}),
                details: validated.details,
            };
            const updated = await query<any[]>(
                `UPDATE resource_rentals
                    SET metadata = $1::jsonb, version = version + 1, updated_at = NOW()
                  WHERE id = $2::uuid RETURNING *`,
                [JSON.stringify(metadata), id],
            );
            await this.insertEvent(query, id, 'eligibility_reviewed', rental.status, rental.status, actorId, {
                dimension: input.dimension,
                status: input.status,
                evidenceRef: evidenceRef || null,
                reason: reason || null,
            });
            return updated[0];
        });
    }

    async approveVehicleRental(
        schemaName: string,
        rentalId: string,
        expectedVersion: number,
        actorId?: string,
        actorRole?: string,
    ): Promise<any> {
        if (!this.canMakeTerminalTransition(actorRole)) {
            throw new ForbiddenException('Only tenant administrators and supervisors can approve rentals');
        }
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
            throw new BadRequestException('expectedVersion is required');
        }
        const id = this.assertUuid(rentalId, 'rentalId');
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows = await query<any[]>(
                `SELECT * FROM resource_rentals WHERE id = $1::uuid FOR UPDATE`,
                [id],
            );
            const rental = rows?.[0];
            if (!rental) throw new NotFoundException('Resource rental not found');
            if (rental.rental_type !== 'vehicle_rental') {
                throw new ConflictException('Only vehicle rental requests require eligibility approval');
            }
            if (rental.status === 'reserved') return rental;
            if (rental.status !== 'pending_review') {
                throw new ConflictException(`Rental cannot be approved in status ${rental.status}`);
            }
            this.assertExpectedVersion(expectedVersion, rental.version);
            const details = (rental.metadata as any)?.details as VehicleRentalDetails | undefined;
            if (!this.eligibilityIsCleared(details?.eligibility)) {
                throw new ConflictException({
                    message: 'Identity, driver licence, insurance and payment must be reviewed before approval',
                    reason: 'eligibility_incomplete',
                });
            }
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS lock_acquired`,
                [`${schemaName}:resource-rental:vehicle:${rental.resource_id}`],
            );
            const vehicle = await query<any[]>(
                `SELECT id, status FROM vehicles WHERE id = $1::uuid FOR UPDATE`,
                [rental.resource_id],
            );
            if (!vehicle?.length || vehicle[0].status !== 'available') {
                throw new ConflictException({ message: 'Vehicle is not available for rental', reason: 'vehicle_not_available' });
            }
            const overlaps = await query<any[]>(
                `SELECT id, start_date, end_date FROM resource_rentals
                  WHERE rental_type = 'vehicle_rental'
                    AND resource_id = $1::uuid AND id <> $2::uuid
                    AND status IN ('reserved', 'picked_up')
                    AND start_date < $4::date AND end_date > $3::date
                  LIMIT 1`,
                [rental.resource_id, id, rental.start_date, rental.end_date],
            );
            if (overlaps.length) {
                throw new ConflictException({
                    message: 'Vehicle is already rented for part of this date range',
                    reason: 'already_rented',
                    conflictStart: overlaps[0].start_date,
                    conflictEnd: overlaps[0].end_date,
                });
            }
            const updated = await query<any[]>(
                `UPDATE resource_rentals SET status = 'reserved', version = version + 1,
                        updated_at = NOW() WHERE id = $1::uuid RETURNING *`,
                [id],
            );
            await this.insertEvent(query, id, 'rental_approved', 'pending_review', 'reserved', actorId, {});
            return updated[0];
        });
    }

    async rejectVehicleRental(
        schemaName: string,
        rentalId: string,
        reasonValue: unknown,
        expectedVersion: number,
        actorId?: string,
        actorRole?: string,
    ): Promise<any> {
        if (!this.canMakeTerminalTransition(actorRole)) {
            throw new ForbiddenException('Only tenant administrators and supervisors can reject rentals');
        }
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
            throw new BadRequestException('expectedVersion is required');
        }
        const id = this.assertUuid(rentalId, 'rentalId');
        const reason = String(reasonValue || '').trim().slice(0, 500);
        if (!reason) throw new BadRequestException('reason is required');
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows = await query<any[]>(
                `SELECT * FROM resource_rentals WHERE id = $1::uuid FOR UPDATE`,
                [id],
            );
            const rental = rows?.[0];
            if (!rental) throw new NotFoundException('Resource rental not found');
            if (rental.rental_type !== 'vehicle_rental' || rental.status !== 'pending_review') {
                throw new ConflictException(`Rental cannot be rejected in status ${rental.status}`);
            }
            this.assertExpectedVersion(expectedVersion, rental.version);
            const updated = await query<any[]>(
                `UPDATE resource_rentals SET status = 'rejected', version = version + 1,
                        updated_at = NOW() WHERE id = $1::uuid RETURNING *`,
                [id],
            );
            await this.insertEvent(query, id, 'rental_rejected', 'pending_review', 'rejected', actorId, { reason });
            return updated[0];
        });
    }

    async recordInspection(
        schemaName: string,
        rentalId: string,
        input: RecordRentalInspectionInput,
        actorId?: string,
    ): Promise<any> {
        const id = this.assertUuid(rentalId, 'rentalId');
        if (!Number.isInteger(input?.expectedVersion) || Number(input.expectedVersion) < 1) {
            throw new BadRequestException('expectedVersion is required');
        }
        if (!['pickup', 'return'].includes(input?.inspectionType)) {
            throw new BadRequestException('inspectionType must be pickup or return');
        }
        const odometer = input.odometer === undefined ? null : Number(input.odometer);
        if (odometer === null || !Number.isSafeInteger(odometer) || odometer < 0 || odometer > POSTGRES_INTEGER_MAX) {
            throw new BadRequestException(`odometer must be an integer between 0 and ${POSTGRES_INTEGER_MAX}`);
        }
        const fuel = input.fuelPercent === undefined ? null : Number(input.fuelPercent);
        if (fuel !== null && (!Number.isInteger(fuel) || fuel < 0 || fuel > 100)) {
            throw new BadRequestException('fuelPercent must be an integer between 0 and 100');
        }
        const notes = String(input.conditionNotes || '').trim().slice(0, 4000);
        if (!notes) throw new BadRequestException('conditionNotes is required');
        if (!['otp', 'signature', 'manual'].includes(input.handoffMethod)) {
            throw new BadRequestException('handoffMethod must be otp, signature or manual');
        }
        const evidenceRef = String(input.handoffEvidenceRef || '').trim().slice(0, 2000);
        if (!evidenceRef) throw new BadRequestException('handoffEvidenceRef is required');
        if (input.handoffMethod === 'otp' && /^\d{4,8}$/.test(evidenceRef)) {
            throw new BadRequestException('Store the OTP verification reference, never the raw code');
        }
        const mediaIds = this.assertUuidList(input.mediaIds, 'mediaIds');
        if (!mediaIds.length) {
            throw new BadRequestException('At least one inspection photo is required');
        }

        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows = await query<any[]>(
                `SELECT * FROM resource_rentals WHERE id = $1::uuid FOR UPDATE`,
                [id],
            );
            const rental = rows?.[0];
            if (!rental) throw new NotFoundException('Resource rental not found');
            if (rental.rental_type !== 'vehicle_rental') {
                throw new ConflictException('Vehicle inspections only apply to vehicle rentals');
            }
            this.assertExpectedVersion(input.expectedVersion, rental.version);
            const expectedStatus = input.inspectionType === 'pickup' ? 'reserved' : 'picked_up';
            const targetStatus = input.inspectionType === 'pickup' ? 'picked_up' : 'returned';
            if (rental.status !== expectedStatus) {
                throw new ConflictException(`${input.inspectionType} inspection requires status ${expectedStatus}`);
            }
            const details = (rental.metadata as any)?.details as VehicleRentalDetails | undefined;
            if (input.inspectionType === 'pickup') {
                if (!this.eligibilityIsCleared(details?.eligibility)) {
                    throw new ConflictException('Eligibility must be cleared before pickup');
                }
                if (details?.contract?.signed !== true) {
                    throw new ConflictException('Signed contract evidence is required before pickup');
                }
            } else if (details?.odometerOut != null && odometer < details.odometerOut) {
                throw new ConflictException('Return odometer cannot be lower than pickup odometer');
            }
            await this.requireMedia(query, mediaIds);
            const inserted = await query<any[]>(
                `INSERT INTO resource_rental_inspections (
                    rental_id, inspection_type, odometer, fuel_percent, condition_notes,
                    media_ids, handoff_method, handoff_evidence_ref, created_by
                 ) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::uuid)
                 RETURNING *`,
                [
                    id, input.inspectionType, odometer, fuel, notes, JSON.stringify(mediaIds),
                    input.handoffMethod, evidenceRef, this.validActorId(actorId),
                ],
            );
            const mergedDetails = {
                ...(details ?? {}),
                [input.inspectionType === 'pickup' ? 'odometerOut' : 'odometerIn']: odometer,
            };
            const validated = validateResourceRentalDetails('vehicle_rental', mergedDetails);
            if (validated.errors.length) {
                throw new BadRequestException({ error: 'invalid_rental_details', details: validated.errors });
            }
            const metadata = { ...((rental.metadata as any) || {}), details: validated.details };
            const updated = await query<any[]>(
                `UPDATE resource_rentals
                    SET status = $1, metadata = $2::jsonb, version = version + 1, updated_at = NOW()
                  WHERE id = $3::uuid RETURNING *`,
                [targetStatus, JSON.stringify(metadata), id],
            );
            await this.insertEvent(
                query,
                id,
                `${input.inspectionType}_inspection_recorded`,
                expectedStatus,
                targetStatus,
                actorId,
                { inspectionId: inserted[0].id, mediaCount: mediaIds.length, handoffMethod: input.handoffMethod },
            );
            return { rental: updated[0], inspection: inserted[0] };
        });
    }

    async reportDamage(
        schemaName: string,
        rentalId: string,
        input: ReportRentalDamageInput,
        actorId?: string,
    ): Promise<any> {
        const id = this.assertUuid(rentalId, 'rentalId');
        const inspectionId = input?.inspectionId
            ? this.assertUuid(input.inspectionId, 'inspectionId')
            : null;
        const description = String(input?.description || '').trim().slice(0, 4000);
        if (!description) throw new BadRequestException('description is required');
        const amount = input?.amountCents === undefined ? null : Number(input.amountCents);
        if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0 || amount > POSTGRES_INTEGER_MAX)) {
            throw new BadRequestException(`amountCents must be an integer between 0 and ${POSTGRES_INTEGER_MAX}`);
        }
        const currency = input?.currency ? String(input.currency).trim().toUpperCase() : null;
        if ((amount === null) !== (currency === null) || (currency && !/^[A-Z]{3}$/.test(currency))) {
            throw new BadRequestException('amountCents and three-letter currency must be provided together');
        }
        const mediaIds = this.assertUuidList(input?.mediaIds, 'mediaIds');
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rentals = await query<any[]>(
                `SELECT id, rental_type, status FROM resource_rentals WHERE id = $1::uuid FOR UPDATE`,
                [id],
            );
            const rental = rentals?.[0];
            if (!rental) throw new NotFoundException('Resource rental not found');
            if (rental.rental_type !== 'vehicle_rental' || !['picked_up', 'returned'].includes(rental.status)) {
                throw new ConflictException('Damage can only be reported after pickup');
            }
            if (inspectionId) {
                const inspections = await query<any[]>(
                    `SELECT id FROM resource_rental_inspections
                      WHERE id = $1::uuid AND rental_id = $2::uuid LIMIT 1`,
                    [inspectionId, id],
                );
                if (!inspections.length) throw new BadRequestException('inspectionId does not belong to this rental');
            }
            await this.requireMedia(query, mediaIds);
            const rows = await query<any[]>(
                `INSERT INTO resource_rental_damages (
                    rental_id, inspection_id, description, amount_cents, currency, media_ids, created_by
                 ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::uuid)
                 RETURNING *`,
                [id, inspectionId, description, amount, currency, JSON.stringify(mediaIds), this.validActorId(actorId)],
            );
            await this.insertEvent(query, id, 'damage_reported', rental.status, rental.status, actorId, {
                damageId: rows[0].id,
                inspectionId,
                amountCents: amount,
                currency,
                mediaCount: mediaIds.length,
            });
            return rows[0];
        });
    }

    private async createVehicleRental(
        schemaName: string,
        input: CreateResourceRentalInput,
        range: RentalRange,
        vehicleId: string,
        contactId: string,
        createdBy: string | null,
    ): Promise<any> {
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const validatedContactId = await requireTenantContact(query, contactId);
            const opportunityId = await resolveNativeEvidenceOpportunity(query, {
                contactId: validatedContactId,
                trustedOpportunityId: input.opportunityId,
            });
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS lock_acquired`,
                [`${schemaName}:resource-rental:vehicle:${vehicleId}`],
            );
            const vehicles = await query<any[]>(
                `SELECT id, make, model, year, status
                 FROM vehicles WHERE id = $1::uuid FOR UPDATE`,
                [vehicleId],
            );
            const vehicle = vehicles?.[0];
            if (!vehicle) throw new NotFoundException('Vehicle not found');
            if (vehicle.status !== 'available') {
                throw new ConflictException('Vehicle is not available for rental');
            }

            const overlaps = await query<any[]>(
                `SELECT id, start_date, end_date
                 FROM resource_rentals
                 WHERE rental_type = 'vehicle_rental'
                   AND resource_id = $1::uuid
                   AND status IN ('reserved', 'picked_up')
                   AND start_date < $3::date
                   AND end_date > $2::date
                 LIMIT 1`,
                [vehicleId, range.startDate, range.endDate],
            );
            if (overlaps.length) {
                throw new ConflictException({
                    message: 'Vehicle is already rented for part of this date range',
                    conflictStart: overlaps[0].start_date,
                    conflictEnd: overlaps[0].end_date,
                });
            }

            return this.insertRental(query, {
                ...input,
                type: 'vehicle_rental',
                resourceId: vehicleId,
                serviceId: null,
                contactId: validatedContactId,
                opportunityId,
                createdBy,
                range,
            });
        });
    }

    private async createPetBoarding(
        schemaName: string,
        input: CreateResourceRentalInput,
        range: RentalRange,
        petId: string,
        serviceId: string,
        contactId: string | null,
        createdBy: string | null,
    ): Promise<any> {
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            // Capacity is shared by service, while double-booking protection is
            // shared by pet. Both locks live until commit.
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS lock_acquired`,
                [`${schemaName}:resource-rental:boarding-service:${serviceId}`],
            );
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS lock_acquired`,
                [`${schemaName}:resource-rental:pet:${petId}`],
            );

            const pets = await query<any[]>(
                `SELECT id, name, is_active, contact_id FROM pets WHERE id = $1::uuid FOR UPDATE`,
                [petId],
            );
            const pet = pets?.[0];
            if (!pet) throw new NotFoundException('Pet not found');
            if (pet.is_active !== true) {
                throw new ConflictException('Pet is inactive and cannot be boarded');
            }
            const canonicalContactId = await requireTenantContact(
                query,
                assertOptionalContactId(pet.contact_id),
            );
            if (!canonicalContactId) {
                throw new ConflictException('Pet has no owner contact');
            }
            if (contactId && contactId.toLowerCase() !== canonicalContactId.toLowerCase()) {
                throw new ConflictException('contactId does not match the pet owner');
            }
            const opportunityId = await resolveNativeEvidenceOpportunity(query, {
                contactId: canonicalContactId,
                trustedOpportunityId: input.opportunityId,
            });

            const services = await query<any[]>(
                `SELECT id, name, category, max_concurrent, is_active
                 FROM services WHERE id = $1::uuid FOR UPDATE`,
                [serviceId],
            );
            const service = services?.[0];
            if (!service) throw new NotFoundException('Boarding service not found');
            if (service.is_active !== true) {
                throw new ConflictException('Boarding service is inactive');
            }
            const category = String(service.category || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();
            if (!['hotel', 'guarderia'].includes(category)) {
                throw new ConflictException(
                    'Service category must be hotel or guarderia for pet boarding',
                );
            }
            const capacity = Number(service.max_concurrent);
            if (!Number.isInteger(capacity) || capacity < 1) {
                throw new ConflictException('Boarding service capacity must be at least 1');
            }

            const petOverlap = await query<any[]>(
                `SELECT id, start_date, end_date
                 FROM resource_rentals
                 WHERE rental_type = 'pet_boarding'
                   AND resource_id = $1::uuid
                   AND status IN ('reserved', 'checked_in')
                   AND start_date < $3::date
                   AND end_date > $2::date
                 LIMIT 1`,
                [petId, range.startDate, range.endDate],
            );
            if (petOverlap.length) {
                throw new ConflictException({
                    message: 'Pet already has boarding for part of this date range',
                    conflictStart: petOverlap[0].start_date,
                    conflictEnd: petOverlap[0].end_date,
                });
            }

            // Check every occupied night in [start_date, end_date). Adjacent
            // checkout/check-in dates therefore never collide.
            const fullNights = await query<any[]>(
                `WITH requested_nights AS (
                    SELECT generate_series(
                        $2::date,
                        ($3::date - INTERVAL '1 day')::date,
                        INTERVAL '1 day'
                    )::date AS night
                 )
                 SELECT n.night, COUNT(r.id)::int AS occupied
                 FROM requested_nights n
                 LEFT JOIN resource_rentals r
                   ON r.rental_type = 'pet_boarding'
                  AND r.service_id = $1::uuid
                  AND r.status IN ('reserved', 'checked_in')
                  AND r.start_date <= n.night
                  AND r.end_date > n.night
                 GROUP BY n.night
                 HAVING COUNT(r.id) >= $4::int
                 ORDER BY n.night
                 LIMIT 1`,
                [serviceId, range.startDate, range.endDate, capacity],
            );
            if (fullNights.length) {
                throw new ConflictException({
                    message: 'Boarding service has no capacity for every requested night',
                    fullNight: fullNights[0].night,
                    capacity,
                });
            }

            return this.insertRental(query, {
                ...input,
                type: 'pet_boarding',
                resourceId: petId,
                serviceId,
                contactId: canonicalContactId,
                opportunityId,
                createdBy,
                range,
            });
        });
    }

    private async insertRental(
        query: <R = any[]>(sql: string, params?: any[]) => Promise<R>,
        data: Omit<CreateResourceRentalInput, 'serviceId' | 'contactId' | 'opportunityId'> & {
            serviceId: string | null;
            contactId: string | null;
            opportunityId: string | null;
            createdBy: string | null;
            range: RentalRange;
        },
    ): Promise<any> {
        const initialStatus: ResourceRentalStatus = data.type === 'vehicle_rental'
            ? 'pending_review'
            : 'reserved';
        const rows = await query<any[]>(
            `INSERT INTO resource_rentals (
                rental_type, resource_id, service_id, contact_id, opportunity_id,
                customer_name, customer_phone, start_date, end_date,
                status, notes, metadata, created_by
             ) VALUES (
                $1, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
                $6, $7, $8::date, $9::date,
                $10, $11, $12::jsonb, $13::uuid
             ) RETURNING *`,
            [
                data.type,
                data.resourceId,
                data.serviceId,
                data.contactId,
                data.opportunityId,
                data.customerName || null,
                data.customerPhone || null,
                data.range.startDate,
                data.range.endDate,
                initialStatus,
                data.notes || null,
                JSON.stringify(data.metadata || {}),
                data.createdBy,
            ],
        );
        await this.insertEvent(
            query,
            rows[0].id,
            data.type === 'vehicle_rental' ? 'rental_requested' : 'rental_reserved',
            null,
            initialStatus,
            data.createdBy,
            { source: data.createdBy ? 'dashboard' : 'agent' },
        );
        return rows[0];
    }

    private pendingEligibility() {
        return {
            identity: { status: 'pending' as const },
            driverLicense: { status: 'pending' as const },
            insurance: { status: 'pending' as const },
            payment: { status: 'pending' as const },
        };
    }

    private eligibilityIsCleared(value: unknown): boolean {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        return ELIGIBILITY_DIMENSIONS.every((dimension) => {
            const status = (value as any)?.[dimension]?.status;
            return status === 'verified' || status === 'not_required';
        });
    }

    private assertExpectedVersion(expected: unknown, actual: unknown): void {
        if (expected === undefined || expected === null) return;
        const version = Number(expected);
        if (!Number.isInteger(version) || version < 1) {
            throw new BadRequestException('expectedVersion must be a positive integer');
        }
        if (version !== Number(actual)) {
            throw new ConflictException({
                message: 'Resource rental changed; reload before trying again',
                reason: 'version_conflict',
                expectedVersion: version,
                actualVersion: Number(actual),
            });
        }
    }

    private validActorId(value: unknown): string | null {
        return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
    }

    private assertUuidList(value: unknown, field: string): string[] {
        if (value === undefined || value === null) return [];
        if (!Array.isArray(value)) throw new BadRequestException(`${field} must be an array`);
        if (value.length > 20) throw new BadRequestException(`${field} cannot contain more than 20 items`);
        return Array.from(new Set(value.map((item, index) => this.assertUuid(item, `${field}[${index}]`))));
    }

    private async requireMedia(
        query: <R = any[]>(sql: string, params?: any[]) => Promise<R>,
        mediaIds: string[],
    ): Promise<void> {
        if (!mediaIds.length) return;
        const rows = await query<any[]>(
            `SELECT id FROM media_files WHERE id = ANY($1::uuid[])`,
            [mediaIds],
        );
        if (rows.length !== mediaIds.length) {
            throw new BadRequestException('One or more mediaIds do not exist in this tenant');
        }
    }

    private async insertEvent(
        query: <R = any[]>(sql: string, params?: any[]) => Promise<R>,
        rentalId: string,
        eventType: string,
        fromStatus: string | null,
        toStatus: string | null,
        actorId: unknown,
        payload: Record<string, unknown>,
        actorType?: 'tenant_user' | 'agent' | 'customer' | 'system',
    ): Promise<void> {
        await query(
            `INSERT INTO resource_rental_events (
                rental_id, event_type, from_status, to_status, actor_id, actor_type, payload
             ) VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7::jsonb)`,
            [
                rentalId,
                eventType,
                fromStatus,
                toStatus,
                this.validActorId(actorId),
                actorType || (this.validActorId(actorId) ? 'tenant_user' : 'agent'),
                JSON.stringify(payload),
            ],
        );
    }

    private assertRentalType(value: unknown): ResourceRentalType {
        if (typeof value !== 'string' || !RENTAL_TYPES.includes(value as ResourceRentalType)) {
            throw new BadRequestException('type must be vehicle_rental or pet_boarding');
        }
        return value as ResourceRentalType;
    }

    private assertKnownStatus(value: unknown): ResourceRentalStatus {
        if (typeof value !== 'string' || !ALL_STATUSES.has(value as ResourceRentalStatus)) {
            throw new BadRequestException(`Invalid resource rental status: ${String(value || '')}`);
        }
        return value as ResourceRentalStatus;
    }

    private assertUuid(value: unknown, field: string): string {
        if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
            throw new BadRequestException(`${field} must be a valid UUID`);
        }
        return value;
    }

    private assertDateOnly(value: unknown, field: string): string {
        if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) {
            throw new BadRequestException(`${field} must be a valid date in YYYY-MM-DD format`);
        }
        const parsed = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
            throw new BadRequestException(`${field} must be a valid date in YYYY-MM-DD format`);
        }
        return value;
    }

    private assertRange(startDate: unknown, endDate: unknown): RentalRange {
        const start = this.assertDateOnly(startDate, 'startDate');
        const end = this.assertDateOnly(endDate, 'endDate');
        const nights = (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000;
        if (nights <= 0) throw new BadRequestException('endDate must be after startDate');
        if (nights > MAX_RENTAL_DAYS) {
            throw new BadRequestException(`Rental range cannot exceed ${MAX_RENTAL_DAYS} days`);
        }
        return { startDate: start, endDate: end, nights };
    }

    private canMakeTerminalTransition(role?: string): boolean {
        return role === 'tenant_admin' || role === 'tenant_supervisor' || role === 'super_admin';
    }

    private vehicleTransitions(status: ResourceRentalStatus): ResourceRentalStatus[] {
        // Pickup/return only happen through recordInspection so evidence and
        // status change share one transaction. The generic endpoint can cancel
        // but can never bypass inspection, contract or eligibility gates.
        if (status === 'pending_review') return ['cancelled'];
        if (status === 'reserved') return ['cancelled'];
        if (status === 'picked_up') return ['cancelled'];
        return [];
    }

    private boardingTransitions(status: ResourceRentalStatus): ResourceRentalStatus[] {
        if (status === 'reserved') return ['checked_in', 'cancelled'];
        if (status === 'checked_in') return ['checked_out', 'cancelled'];
        return [];
    }
}
