import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as crypto from 'crypto';

export interface ChannelManagerConfig {
    provider: 'hostaway' | 'guesty' | 'ical' | 'direct';
    apiKey?: string;
    apiSecret?: string;
    accountId?: string;
    syncInterval: number;
    autoBlock: boolean;
}

export interface PropertyListing {
    id: string;
    externalId: string;
    provider: string;
    name: string;
    address?: string;
    checkInTime?: string;
    checkOutTime?: string;
    maxGuests?: number;
    basePrice?: number;
    currency?: string;
    status: string;
    lastSyncedAt?: string;
}

@Injectable()
export class ChannelManagerService {
    private readonly logger = new Logger(ChannelManagerService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly http: HttpService,
    ) {}

    async ensureTables(schemaName: string): Promise<void> {
        const exists: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'cm_listings'`,
            schemaName,
        );
        if (exists.length > 0) return;

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".cm_listings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                external_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                name TEXT NOT NULL,
                address TEXT,
                check_in_time TEXT DEFAULT '15:00',
                check_out_time TEXT DEFAULT '11:00',
                max_guests INT DEFAULT 4,
                base_price_cents INT DEFAULT 0,
                currency TEXT DEFAULT 'USD',
                status TEXT DEFAULT 'active',
                amenities TEXT[] DEFAULT '{}',
                photos TEXT[] DEFAULT '{}',
                property_id UUID,
                last_synced_at TIMESTAMPTZ DEFAULT now(),
                created_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(external_id, provider)
            )
        `);

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".cm_reservations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                listing_id UUID NOT NULL REFERENCES "${schemaName}".cm_listings(id) ON DELETE CASCADE,
                external_id TEXT,
                provider TEXT NOT NULL,
                guest_name TEXT NOT NULL,
                guest_email TEXT,
                guest_phone TEXT,
                check_in DATE NOT NULL,
                check_out DATE NOT NULL,
                guests INT DEFAULT 1,
                total_cents INT DEFAULT 0,
                currency TEXT DEFAULT 'USD',
                status TEXT DEFAULT 'confirmed',
                source TEXT,
                notes TEXT,
                contact_id UUID,
                synced_at TIMESTAMPTZ DEFAULT now(),
                created_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(external_id, provider)
            )
        `);

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".cm_availability (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                listing_id UUID NOT NULL REFERENCES "${schemaName}".cm_listings(id) ON DELETE CASCADE,
                date DATE NOT NULL,
                is_available BOOLEAN DEFAULT true,
                price_cents INT,
                min_nights INT DEFAULT 1,
                notes TEXT,
                UNIQUE(listing_id, date)
            )
        `);

        this.logger.log(`Channel manager tables created for schema ${schemaName}`);
    }

    async getConfig(tenantId: string): Promise<ChannelManagerConfig | null> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        return (tenant?.settings as any)?.channelManager || null;
    }

    async updateConfig(tenantId: string, updates: Partial<ChannelManagerConfig>): Promise<ChannelManagerConfig> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const settings = (tenant.settings as any) || {};
        const current = settings.channelManager || {};

        const merged: ChannelManagerConfig = {
            provider: updates.provider ?? current.provider ?? 'direct',
            apiKey: updates.apiKey ?? current.apiKey,
            apiSecret: updates.apiSecret ?? current.apiSecret,
            accountId: updates.accountId ?? current.accountId,
            syncInterval: updates.syncInterval ?? current.syncInterval ?? 60,
            autoBlock: updates.autoBlock ?? current.autoBlock ?? true,
        };

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { settings: { ...settings, channelManager: { ...merged } } as any },
        });
        return merged;
    }

    async listListings(schemaName: string): Promise<any[]> {
        await this.ensureTables(schemaName);
        return this.prisma.$queryRawUnsafe(`
            SELECT l.*,
                (SELECT COUNT(*)::int FROM "${schemaName}".cm_reservations r
                 WHERE r.listing_id = l.id AND r.check_out >= CURRENT_DATE AND r.status = 'confirmed') as active_reservations
            FROM "${schemaName}".cm_listings l
            WHERE l.status != 'deleted'
            ORDER BY l.name
        `);
    }

    async createListing(schemaName: string, data: {
        name: string; address?: string; externalId?: string; provider?: string;
        checkInTime?: string; checkOutTime?: string; maxGuests?: number;
        basePriceCents?: number; currency?: string; propertyId?: string;
    }): Promise<any> {
        await this.ensureTables(schemaName);
        const rows: any[] = await this.prisma.$queryRawUnsafe(`
            INSERT INTO "${schemaName}".cm_listings
            (external_id, provider, name, address, check_in_time, check_out_time,
             max_guests, base_price_cents, currency, property_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)
            RETURNING *
        `,
            data.externalId || crypto.randomUUID(), data.provider || 'direct',
            data.name, data.address || null,
            data.checkInTime || '15:00', data.checkOutTime || '11:00',
            data.maxGuests || 4, data.basePriceCents || 0,
            data.currency || 'USD', data.propertyId || null,
        );
        return rows[0];
    }

    async createReservation(schemaName: string, data: {
        listingId: string; guestName: string; guestEmail?: string;
        guestPhone?: string; checkIn: string; checkOut: string;
        guests?: number; totalCents?: number; currency?: string;
        source?: string; notes?: string;
    }): Promise<any> {
        await this.ensureTables(schemaName);

        const conflicts: any[] = await this.prisma.$queryRawUnsafe(`
            SELECT 1 FROM "${schemaName}".cm_reservations
            WHERE listing_id = $1::uuid AND status = 'confirmed'
            AND check_in < $3::date AND check_out > $2::date
        `, data.listingId, data.checkIn, data.checkOut);

        if (conflicts.length > 0) throw new BadRequestException('Dates conflict with existing reservation');

        const rows: any[] = await this.prisma.$queryRawUnsafe(`
            INSERT INTO "${schemaName}".cm_reservations
            (listing_id, provider, guest_name, guest_email, guest_phone,
             check_in, check_out, guests, total_cents, currency, source, notes)
            VALUES ($1::uuid, 'direct', $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11)
            RETURNING *
        `,
            data.listingId, data.guestName, data.guestEmail || null,
            data.guestPhone || null, data.checkIn, data.checkOut,
            data.guests || 1, data.totalCents || 0, data.currency || 'USD',
            data.source || 'direct', data.notes || null,
        );

        if ((await this.getConfigForSchema(schemaName))?.autoBlock) {
            await this.blockDates(schemaName, data.listingId, data.checkIn, data.checkOut);
        }

        return rows[0];
    }

    async listReservations(schemaName: string, filters?: {
        listingId?: string; status?: string; fromDate?: string; toDate?: string;
    }): Promise<any[]> {
        await this.ensureTables(schemaName);
        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (filters?.listingId) { conditions.push(`r.listing_id = $${idx++}::uuid`); params.push(filters.listingId); }
        if (filters?.status) { conditions.push(`r.status = $${idx++}`); params.push(filters.status); }
        if (filters?.fromDate) { conditions.push(`r.check_out >= $${idx++}::date`); params.push(filters.fromDate); }
        if (filters?.toDate) { conditions.push(`r.check_in <= $${idx++}::date`); params.push(filters.toDate); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return this.prisma.$queryRawUnsafe(`
            SELECT r.*, l.name as listing_name
            FROM "${schemaName}".cm_reservations r
            JOIN "${schemaName}".cm_listings l ON l.id = r.listing_id
            ${where}
            ORDER BY r.check_in ASC
        `, ...params);
    }

    async getAvailability(schemaName: string, listingId: string, from: string, to: string): Promise<any[]> {
        await this.ensureTables(schemaName);
        return this.prisma.$queryRawUnsafe(`
            SELECT d::date as date,
                CASE WHEN a.is_available IS NOT NULL THEN a.is_available
                     WHEN r.id IS NOT NULL THEN false
                     ELSE true END as available,
                COALESCE(a.price_cents, l.base_price_cents) as price_cents,
                COALESCE(a.min_nights, 1) as min_nights,
                r.guest_name as reserved_by
            FROM generate_series($2::date, $3::date, '1 day') d
            CROSS JOIN "${schemaName}".cm_listings l
            LEFT JOIN "${schemaName}".cm_availability a ON a.listing_id = l.id AND a.date = d
            LEFT JOIN "${schemaName}".cm_reservations r ON r.listing_id = l.id
                AND r.status = 'confirmed' AND d >= r.check_in AND d < r.check_out
            WHERE l.id = $1::uuid
            ORDER BY d
        `, listingId, from, to);
    }

    async syncHostaway(tenantId: string): Promise<{ listings: number; reservations: number }> {
        const config = await this.getConfig(tenantId);
        if (!config || config.provider !== 'hostaway') throw new BadRequestException('Hostaway not configured');

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');
        await this.ensureTables(tenant.schemaName);

        const tokenResp = await this.http.axiosRef.post('https://api.hostaway.com/v1/accessTokens', {
            grant_type: 'client_credentials',
            client_id: config.accountId,
            client_secret: config.apiSecret,
        });
        const token = tokenResp.data?.access_token;
        if (!token) throw new BadRequestException('Failed to authenticate with Hostaway');

        const headers = { Authorization: `Bearer ${token}` };

        const listingsResp = await this.http.axiosRef.get('https://api.hostaway.com/v1/listings', { headers });
        const listings = listingsResp.data?.result || [];
        let listingCount = 0;

        for (const l of listings) {
            await this.prisma.$queryRawUnsafe(`
                INSERT INTO "${tenant.schemaName}".cm_listings
                (external_id, provider, name, address, max_guests, base_price_cents, currency, last_synced_at)
                VALUES ($1, 'hostaway', $2, $3, $4, $5, $6, now())
                ON CONFLICT (external_id, provider) DO UPDATE SET
                    name = EXCLUDED.name, address = EXCLUDED.address,
                    max_guests = EXCLUDED.max_guests, base_price_cents = EXCLUDED.base_price_cents,
                    last_synced_at = now()
            `,
                String(l.id), l.name, l.address || null,
                l.maxGuests || 4, Math.round((l.basePrice || 0) * 100),
                l.currencyCode || 'USD',
            );
            listingCount++;
        }

        const reservationsResp = await this.http.axiosRef.get('https://api.hostaway.com/v1/reservations', { headers });
        const reservations = reservationsResp.data?.result || [];
        let resCount = 0;

        for (const r of reservations) {
            await this.prisma.$queryRawUnsafe(`
                INSERT INTO "${tenant.schemaName}".cm_reservations
                (listing_id, external_id, provider, guest_name, guest_email, guest_phone,
                 check_in, check_out, guests, total_cents, currency, status, source, synced_at)
                SELECT l.id, $1, 'hostaway', $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, now()
                FROM "${tenant.schemaName}".cm_listings l WHERE l.external_id = $12 AND l.provider = 'hostaway'
                ON CONFLICT (external_id, provider) DO UPDATE SET
                    guest_name = EXCLUDED.guest_name, check_in = EXCLUDED.check_in,
                    check_out = EXCLUDED.check_out, status = EXCLUDED.status, synced_at = now()
            `,
                String(r.id), r.guestName || 'Guest', r.guestEmail || null, r.guestPhone || null,
                r.arrivalDate, r.departureDate, r.numberOfGuests || 1,
                Math.round((r.totalPrice || 0) * 100), r.currency || 'USD',
                r.status || 'confirmed', r.channelName || 'hostaway',
                String(r.listingMapId),
            );
            resCount++;
        }

        this.logger.log(`Hostaway sync: ${listingCount} listings, ${resCount} reservations for tenant ${tenantId}`);
        return { listings: listingCount, reservations: resCount };
    }

    private async blockDates(schemaName: string, listingId: string, checkIn: string, checkOut: string): Promise<void> {
        await this.prisma.$queryRawUnsafe(`
            INSERT INTO "${schemaName}".cm_availability (listing_id, date, is_available)
            SELECT $1::uuid, d::date, false
            FROM generate_series($2::date, ($3::date - interval '1 day'), '1 day') d
            ON CONFLICT (listing_id, date) DO UPDATE SET is_available = false
        `, listingId, checkIn, checkOut);
    }

    private async getConfigForSchema(schemaName: string): Promise<ChannelManagerConfig | null> {
        const tenant = await this.prisma.tenant.findFirst({
            where: { schemaName },
            select: { settings: true },
        });
        return (tenant?.settings as any)?.channelManager || null;
    }
}
