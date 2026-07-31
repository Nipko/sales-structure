import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Real Estate Listings — long-term sale/rent. Distinct from vacation-rental
 * (short-term stays) so search criteria, fields and operational flow stay
 * focused on the inmobiliaria use case.
 *
 * Neighborhood-based zone routing: when a contact asks about a specific
 * neighborhood, the listing_zone_agents table maps that zone to the agent
 * who specialises in it, and the conversation gets assigned automatically.
 */
@Injectable()
export class ListingsService {
    private readonly logger = new Logger(ListingsService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ── CRUD ──────────────────────────────────────────────────────

    async list(schemaName: string, filters: {
        transactionType?: 'sale' | 'rent';
        status?: string;
        includeInactive?: boolean;
    } = {}): Promise<any[]> {
        const conds: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (!filters.includeInactive) conds.push(`is_active = true`);
        if (filters.transactionType) {
            conds.push(`transaction_type = $${idx}`);
            params.push(filters.transactionType);
            idx++;
        }
        if (filters.status) {
            conds.push(`status = $${idx}`);
            params.push(filters.status);
            idx++;
        }

        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM real_estate_listings ${where} ORDER BY created_at DESC LIMIT 200`,
            params,
        );
    }

    async getById(schemaName: string, listingId: string): Promise<any | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM real_estate_listings WHERE id = $1::uuid`,
            [listingId],
        );
        return rows?.[0] || null;
    }

    async create(schemaName: string, data: any): Promise<any> {
        if (!data.name || !data.transactionType) {
            throw new BadRequestException('name and transactionType are required');
        }
        const tx = data.transactionType === 'sale' ? 'sale' : 'rent';

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO real_estate_listings (
                name, transaction_type, property_kind, price, currency,
                rent_period, hoa_fee, deposit, min_rental_months, financing_available,
                bedrooms, bathrooms, area_m2, parking_spots, stratum, year_built,
                address, neighborhood, city, country, latitude, longitude,
                description, amenities, images, external_url, status, assigned_agent_id, metadata
             ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16,
                $17, $18, $19, $20, $21, $22,
                $23, $24::jsonb, $25::jsonb, $26, $27, $28::uuid, $29::jsonb
             ) RETURNING *`,
            [
                data.name, tx, data.propertyKind || 'apartment',
                data.price || null, data.currency || 'COP',
                data.rentPeriod || 'monthly', data.hoaFee || null, data.deposit || null,
                data.minRentalMonths || null, !!data.financingAvailable,
                data.bedrooms || 1, data.bathrooms || 1, data.areaM2 || null,
                data.parkingSpots || 0, data.stratum || null, data.yearBuilt || null,
                data.address || null, data.neighborhood || null, data.city || null,
                data.country || 'CO', data.latitude || null, data.longitude || null,
                data.description || null,
                JSON.stringify(data.amenities || []),
                JSON.stringify(data.images || []),
                data.externalUrl || null,
                data.status || 'available',
                data.assignedAgentId || null,
                JSON.stringify(data.metadata || {}),
            ],
        );
        return rows?.[0];
    }

    async update(schemaName: string, listingId: string, data: any): Promise<any> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        const fields: Record<string, string> = {
            name: 'name', transactionType: 'transaction_type',
            propertyKind: 'property_kind', price: 'price', currency: 'currency',
            rentPeriod: 'rent_period', hoaFee: 'hoa_fee', deposit: 'deposit',
            minRentalMonths: 'min_rental_months', financingAvailable: 'financing_available',
            bedrooms: 'bedrooms', bathrooms: 'bathrooms', areaM2: 'area_m2',
            parkingSpots: 'parking_spots', stratum: 'stratum', yearBuilt: 'year_built',
            address: 'address', neighborhood: 'neighborhood', city: 'city',
            country: 'country', latitude: 'latitude', longitude: 'longitude',
            description: 'description', externalUrl: 'external_url',
            status: 'status', isActive: 'is_active',
        };
        for (const [jsKey, dbKey] of Object.entries(fields)) {
            if (data[jsKey] !== undefined) {
                sets.push(`"${dbKey}" = $${idx}`);
                params.push(data[jsKey]);
                idx++;
            }
        }
        if (data.assignedAgentId !== undefined) {
            sets.push(`"assigned_agent_id" = $${idx}::uuid`);
            params.push(data.assignedAgentId || null);
            idx++;
        }
        const jsonFields: Record<string, string> = {
            amenities: 'amenities', images: 'images', metadata: 'metadata',
        };
        for (const [jsKey, dbKey] of Object.entries(jsonFields)) {
            if (data[jsKey] !== undefined) {
                sets.push(`"${dbKey}" = $${idx}::jsonb`);
                params.push(JSON.stringify(data[jsKey]));
                idx++;
            }
        }

        if (sets.length === 0) return this.getById(schemaName, listingId);
        sets.push(`updated_at = NOW()`);
        params.push(listingId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE real_estate_listings SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            params,
        );
        return rows?.[0];
    }

    async delete(schemaName: string, listingId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE real_estate_listings SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [listingId],
        );
    }

    // ── Search (used by AI tool + dashboard) ──────────────────────

    async search(schemaName: string, params: {
        transactionType?: 'sale' | 'rent';
        propertyKind?: string;
        maxPrice?: number;
        minPrice?: number;
        minBedrooms?: number;
        neighborhood?: string;
        city?: string;
        minAreaM2?: number;
        limit?: number;
    }): Promise<any[]> {
        const conds: string[] = ['is_active = true', `status = 'available'`];
        const vals: any[] = [];
        let idx = 1;

        if (params.transactionType) {
            conds.push(`transaction_type = $${idx}`);
            vals.push(params.transactionType);
            idx++;
        }
        if (params.propertyKind) {
            conds.push(`property_kind = $${idx}`);
            vals.push(params.propertyKind);
            idx++;
        }
        if (params.maxPrice) {
            conds.push(`price <= $${idx}`);
            vals.push(params.maxPrice);
            idx++;
        }
        if (params.minPrice) {
            conds.push(`price >= $${idx}`);
            vals.push(params.minPrice);
            idx++;
        }
        if (params.minBedrooms) {
            conds.push(`bedrooms >= $${idx}`);
            vals.push(params.minBedrooms);
            idx++;
        }
        if (params.minAreaM2) {
            conds.push(`area_m2 >= $${idx}`);
            vals.push(params.minAreaM2);
            idx++;
        }
        if (params.neighborhood) {
            conds.push(`(neighborhood ILIKE $${idx} OR address ILIKE $${idx})`);
            vals.push(`%${params.neighborhood}%`);
            idx++;
        }
        if (params.city) {
            conds.push(`city ILIKE $${idx}`);
            vals.push(`%${params.city}%`);
            idx++;
        }

        const limit = Math.min(params.limit || 10, 50);
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, name, transaction_type, property_kind, price, currency,
                    bedrooms, bathrooms, area_m2, parking_spots, stratum,
                    address, neighborhood, city, description, images, status
             FROM real_estate_listings
             WHERE ${conds.join(' AND ')}
             ORDER BY created_at DESC
             LIMIT ${limit}`,
            vals,
        );
    }

    // ── Zone agent mapping (routing) ──────────────────────────────

    async listZoneAgents(schemaName: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM listing_zone_agents ORDER BY city, neighborhood`,
        );
    }

    async setZoneAgent(schemaName: string, neighborhood: string, agentId: string, city?: string): Promise<any> {
        if (!neighborhood || !agentId) {
            throw new BadRequestException('neighborhood and agentId are required');
        }
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            // El target del ON CONFLICT tiene que ser EXACTAMENTE la expresión
            // del índice único. Era `(neighborhood, city)` sobre un índice donde
            // `city` es NULLABLE, y en Postgres los NULL son distintos entre sí:
            // reasignar el asesor de un barrio sin ciudad creaba una fila nueva
            // cada vez, y resolveAgentForZone devolvía cualquiera de ellas.
            `INSERT INTO listing_zone_agents (neighborhood, city, agent_id)
             VALUES ($1, $2, $3::uuid)
             ON CONFLICT (neighborhood, COALESCE(city, ''))
             DO UPDATE SET agent_id = EXCLUDED.agent_id
             RETURNING *`,
            [neighborhood, city || null, agentId],
        );
        return rows?.[0];
    }

    async removeZoneAgent(schemaName: string, mappingId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM listing_zone_agents WHERE id = $1::uuid`,
            [mappingId],
        );
    }

    /** Resolve which agent owns a given zone — used when assigning a new lead. */
    async resolveAgentForZone(schemaName: string, neighborhood: string, city?: string): Promise<string | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT agent_id FROM listing_zone_agents
             WHERE neighborhood ILIKE $1
               AND ($2::varchar IS NULL OR city ILIKE $2)
             ORDER BY city NULLS LAST LIMIT 1`,
            [neighborhood, city || null],
        );
        return rows?.[0]?.agent_id || null;
    }
}
