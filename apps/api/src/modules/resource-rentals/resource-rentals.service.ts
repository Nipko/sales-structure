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

export type ResourceRentalType = 'vehicle_rental' | 'pet_boarding';
export type VehicleRentalStatus = 'reserved' | 'picked_up' | 'returned' | 'cancelled';
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

interface RentalRange {
    startDate: string;
    endDate: string;
    nights: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RENTAL_TYPES: ResourceRentalType[] = ['vehicle_rental', 'pet_boarding'];
const VEHICLE_STATUSES: VehicleRentalStatus[] = ['reserved', 'picked_up', 'returned', 'cancelled'];
const BOARDING_STATUSES: PetBoardingStatus[] = ['reserved', 'checked_in', 'checked_out', 'cancelled'];
const ALL_STATUSES = new Set<ResourceRentalStatus>([...VEHICLE_STATUSES, ...BOARDING_STATUSES]);
const TERMINAL_STATUSES = new Set<ResourceRentalStatus>(['returned', 'checked_out', 'cancelled']);
const MAX_RENTAL_DAYS = 366;

@Injectable()
export class ResourceRentalsService {
    constructor(private readonly prisma: PrismaService) {}

    async list(
        schemaName: string,
        filters: {
            type?: string;
            status?: string;
            resourceId?: string;
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
        const createdBy = actorId && UUID_PATTERN.test(actorId) ? actorId : null;
        const metadata = input.metadata ?? {};
        if (typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new BadRequestException('metadata must be an object');
        }

        if (type === 'vehicle_rental') {
            if (input.serviceId != null) {
                throw new BadRequestException('serviceId is only valid for pet_boarding');
            }
            if (!contactId) {
                throw new BadRequestException('contactId is required for vehicle_rental');
            }
            return this.createVehicleRental(schemaName, input, range, resourceId, contactId, createdBy);
        }

        const serviceId = this.assertUuid(input.serviceId, 'serviceId');
        return this.createPetBoarding(
            schemaName,
            input,
            range,
            resourceId,
            serviceId,
            contactId,
            createdBy,
        );
    }

    async transition(
        schemaName: string,
        rentalId: string,
        targetStatus: string,
        actorRole?: string,
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
                 SET status = $1, updated_at = NOW()
                 WHERE id = $2::uuid
                 RETURNING *`,
                [requestedStatus, id],
            );
            return updated[0];
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
        const rows = await query<any[]>(
            `INSERT INTO resource_rentals (
                rental_type, resource_id, service_id, contact_id, opportunity_id,
                customer_name, customer_phone, start_date, end_date,
                status, notes, metadata, created_by
             ) VALUES (
                $1, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
                $6, $7, $8::date, $9::date,
                'reserved', $10, $11::jsonb, $12::uuid
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
                data.notes || null,
                JSON.stringify(data.metadata || {}),
                data.createdBy,
            ],
        );
        return rows[0];
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
        if (status === 'reserved') return ['picked_up', 'cancelled'];
        if (status === 'picked_up') return ['returned', 'cancelled'];
        return [];
    }

    private boardingTransitions(status: ResourceRentalStatus): ResourceRentalStatus[] {
        if (status === 'reserved') return ['checked_in', 'cancelled'];
        if (status === 'checked_in') return ['checked_out', 'cancelled'];
        return [];
    }
}
