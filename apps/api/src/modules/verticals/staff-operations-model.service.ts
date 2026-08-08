import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface OperationalLocation {
    id: string;
    name: string;
    timezone: string;
    isActive: boolean;
}

export interface OperationalResource {
    id: string;
    locationId: string | null;
    resourceType: string;
    name: string;
    capacity: number;
    isActive: boolean;
}

export interface StaffOperationsBinding {
    staffProfileId: string;
    userId: string | null;
    locationId: string | null;
    calendarIntegrationId: string | null;
    resourceIds: string[];
}

export interface StaffOperationsBindingInput {
    /** Optional platform user; never inferred from staffProfileId. */
    userId?: string | null;
    locationId?: string | null;
    calendarIntegrationId?: string | null;
    resourceIds?: string[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z_]+\/[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)?)$/;
const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Explicit relation layer between staff profiles and operational identities.
 * A staff profile, public user, location, calendar integration and physical
 * resource are distinct entities. This service validates tenant ownership for
 * each reference and never treats matching UUID values as a relationship.
 */
@Injectable()
export class StaffOperationsModelService {
    constructor(private readonly prisma: PrismaService) {}

    async createLocation(
        schemaName: string,
        input: { name: string; timezone: string },
    ): Promise<OperationalLocation> {
        const name = this.requiredText(input.name, 'name', 200);
        if (!TIMEZONE_PATTERN.test(input.timezone || '')) {
            throw new BadRequestException('timezone must be an IANA timezone');
        }
        try {
            new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format(new Date(0));
        } catch {
            throw new BadRequestException('timezone must be a valid IANA timezone');
        }
        const id = randomUUID();
        const rows: any[] = await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO operational_locations (id, name, timezone)
             VALUES ($1::uuid, $2, $3)
             RETURNING id, name, timezone, is_active`,
            [id, name, input.timezone],
        );
        return this.mapLocation(rows[0]);
    }

    async createResource(
        schemaName: string,
        input: { locationId?: string | null; resourceType: string; name: string; capacity: number },
    ): Promise<OperationalResource> {
        const locationId = this.optionalUuid(input.locationId, 'locationId');
        const name = this.requiredText(input.name, 'name', 200);
        if (!RESOURCE_TYPE_PATTERN.test(input.resourceType || '')) {
            throw new BadRequestException('resourceType is invalid');
        }
        if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 1_000_000) {
            throw new BadRequestException('capacity must be an integer between 1 and 1000000');
        }

        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            if (locationId) {
                const locations = await query<any[]>(
                    `SELECT id FROM operational_locations
                     WHERE id = $1::uuid AND is_active = true`,
                    [locationId],
                );
                if (!locations?.length) throw new NotFoundException('Operational location not found');
            }
            const rows = await query<any[]>(
                `INSERT INTO operational_resources
                    (id, location_id, resource_type, name, capacity)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5)
                 RETURNING id, location_id, resource_type, name, capacity, is_active`,
                [randomUUID(), locationId, input.resourceType, name, input.capacity],
            );
            return this.mapResource(rows[0]);
        });
    }

    async upsertBinding(
        tenantId: string,
        schemaName: string,
        staffProfileIdInput: string,
        input: StaffOperationsBindingInput,
    ): Promise<StaffOperationsBinding> {
        const staffProfileId = this.uuid(staffProfileIdInput, 'staffProfileId');
        const userId = this.optionalUuid(input.userId, 'userId');
        const locationId = this.optionalUuid(input.locationId, 'locationId');
        const calendarIntegrationId = this.optionalUuid(
            input.calendarIntegrationId,
            'calendarIntegrationId',
        );
        const resourceIds = [...new Set((input.resourceIds || []).map((id) => this.uuid(id, 'resourceId')))];
        if (resourceIds.length > 100) throw new BadRequestException('At most 100 resources can be linked');
        this.uuid(tenantId, 'tenantId');

        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const staff = await query<any[]>(
                `SELECT id FROM staff_members WHERE id = $1::uuid AND is_active = true FOR UPDATE`,
                [staffProfileId],
            );
            if (!staff?.length) throw new NotFoundException('Staff profile not found');

            if (userId) {
                const users = await query<any[]>(
                    `SELECT id FROM public.users
                     WHERE id = $1::uuid AND tenant_id = $2::uuid AND is_active = true`,
                    [userId, tenantId],
                );
                if (!users?.length) {
                    throw new ConflictException({
                        error: 'staff_user_tenant_mismatch',
                        message: 'The platform user does not belong to this tenant.',
                    });
                }
            }

            if (locationId) {
                const locations = await query<any[]>(
                    `SELECT id FROM operational_locations
                     WHERE id = $1::uuid AND is_active = true`,
                    [locationId],
                );
                if (!locations?.length) throw new NotFoundException('Operational location not found');
            }

            if (calendarIntegrationId) {
                const integrations = await query<any[]>(
                    `SELECT id FROM calendar_integrations
                     WHERE id = $1::uuid AND is_active = true`,
                    [calendarIntegrationId],
                );
                if (!integrations?.length) throw new NotFoundException('Calendar integration not found');
            }

            if (resourceIds.length) {
                const resources = await query<any[]>(
                    `SELECT id, location_id FROM operational_resources
                     WHERE id = ANY($1::uuid[]) AND is_active = true
                     FOR UPDATE`,
                    [resourceIds],
                );
                if (resources.length !== resourceIds.length) {
                    throw new NotFoundException('One or more operational resources were not found');
                }
                if (locationId && resources.some((resource) => (
                    resource.location_id && resource.location_id !== locationId
                ))) {
                    throw new ConflictException({
                        error: 'staff_resource_location_mismatch',
                        message: 'Every linked resource must belong to the selected location.',
                    });
                }
            }

            await query(
                `INSERT INTO staff_operational_bindings
                    (staff_id, user_id, location_id, calendar_integration_id, updated_at)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, NOW())
                 ON CONFLICT (staff_id) DO UPDATE
                 SET user_id = EXCLUDED.user_id,
                     location_id = EXCLUDED.location_id,
                     calendar_integration_id = EXCLUDED.calendar_integration_id,
                     updated_at = NOW()`,
                [staffProfileId, userId, locationId, calendarIntegrationId],
            );
            await query(
                `DELETE FROM staff_resource_assignments WHERE staff_id = $1::uuid`,
                [staffProfileId],
            );
            if (resourceIds.length) {
                await query(
                    `INSERT INTO staff_resource_assignments (staff_id, resource_id)
                     SELECT $1::uuid, resource_id
                     FROM unnest($2::uuid[]) AS resource_id
                     ON CONFLICT DO NOTHING`,
                    [staffProfileId, resourceIds],
                );
            }
            return {
                staffProfileId,
                userId,
                locationId,
                calendarIntegrationId,
                resourceIds,
            };
        });
    }

    async getBinding(schemaName: string, staffProfileIdInput: string): Promise<StaffOperationsBinding> {
        const staffProfileId = this.uuid(staffProfileIdInput, 'staffProfileId');
        const rows: any[] = await this.prisma.executeInTenantSchema(
            schemaName,
            `SELECT b.staff_id, b.user_id, b.location_id, b.calendar_integration_id,
                    COALESCE(array_agg(a.resource_id ORDER BY a.resource_id)
                        FILTER (WHERE a.resource_id IS NOT NULL), '{}') AS resource_ids
             FROM staff_operational_bindings b
             LEFT JOIN staff_resource_assignments a ON a.staff_id = b.staff_id
             WHERE b.staff_id = $1::uuid
             GROUP BY b.staff_id, b.user_id, b.location_id, b.calendar_integration_id`,
            [staffProfileId],
        );
        if (!rows.length) throw new NotFoundException('Staff operations binding not found');
        return {
            staffProfileId: rows[0].staff_id,
            userId: rows[0].user_id || null,
            locationId: rows[0].location_id || null,
            calendarIntegrationId: rows[0].calendar_integration_id || null,
            resourceIds: rows[0].resource_ids || [],
        };
    }

    private uuid(value: string, field: string): string {
        if (!UUID_PATTERN.test(value || '')) throw new BadRequestException(`${field} must be a UUID`);
        return value.toLowerCase();
    }

    private optionalUuid(value: string | null | undefined, field: string): string | null {
        return value == null || value === '' ? null : this.uuid(value, field);
    }

    private requiredText(value: string, field: string, max: number): string {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized || normalized.length > max) {
            throw new BadRequestException(`${field} is required and must be at most ${max} characters`);
        }
        return normalized;
    }

    private mapLocation(row: any): OperationalLocation {
        return {
            id: row.id,
            name: row.name,
            timezone: row.timezone,
            isActive: row.is_active,
        };
    }

    private mapResource(row: any): OperationalResource {
        return {
            id: row.id,
            locationId: row.location_id || null,
            resourceType: row.resource_type,
            name: row.name,
            capacity: Number(row.capacity),
            isActive: row.is_active,
        };
    }
}
