import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as crypto from 'crypto';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que es una credencial. `accountId` es un identificador, no un secreto. */
const CHANNEL_MANAGER_SECRET_FIELDS = ['apiKey', 'apiSecret'] as const;

/**
 * Proveedores cuyo libro mayor de reservas vive AFUERA.
 *
 * `ical` no está: un feed iCal es el calendario del propio tenant publicado
 * hacia las OTAs, así que una reserva directa sobre ese listado es exactamente
 * el caso normal —se crea acá y el bloqueo viaja en el feed exportado—. Estos
 * dos tienen su propia API de reservas y su propio estado autoritativo.
 */
const EXTERNAL_RESERVATION_SYSTEMS: ReadonlySet<string> = new Set(['hostaway', 'guesty']);

/**
 * Los estados que LIBERAN la fecha. Todo lo demás ocupa.
 *
 * La lista es de lo que libera, no de lo que ocupa, a propósito: los estados
 * los inventa el proveedor —Hostaway manda `new`, `modified`, `ownerStay`,
 * `awaitingPayment`— y una lista de "ocupa" se queda corta con el próximo que
 * agreguen. Un estado desconocido bloquea: no saber si ocupa no es saber que
 * está libre. `ownerStay` no está acá porque el dueño ocupando el
 * departamento lo ocupa igual.
 */
const NON_BLOCKING_RESERVATION_STATUSES: readonly string[] = Object.freeze([
    'cancelled', 'canceled', 'declined', 'expired', 'rejected', 'no_show',
    'inquiry', 'inquirypreapproved', 'inquirydenied',
    'inquirytimedout', 'inquirynotpossible',
]);

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
        private readonly secrets: TenantSecretCryptoService,
    ) {}

    /**
     * Takes an already-resolved schema name (never a tenantId): the DDL below
     * cannot go through executeInTenantSchema — CREATE TABLE / REFERENCES need
     * a literal qualifier, not SET LOCAL search_path — so this is the only
     * place left that interpolates the identifier by hand. The assert is what
     * turns a wrong argument into a readable 400 instead of a raw 3F000.
     */
    async ensureTables(schemaName: string): Promise<void> {
        this.prisma.assertTenantSchemaName(schemaName);

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
        const stored = (tenant?.settings as any)?.channelManager;
        if (!stored) return null;
        return await this.decryptConfig(tenantId, stored) as ChannelManagerConfig;
    }

    /**
     * El config para MOSTRAR: nunca descifra.
     *
     * El panel sólo necesita saber si hay credencial, no cuál es. Descifrar
     * para volver a taparlo con `***` sería sacar el secreto de su sobre por
     * un motivo que no lo necesita.
     */
    async getRedactedConfig(tenantId: string): Promise<any | null> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const stored = (tenant?.settings as any)?.channelManager;
        return stored ? this.redactConfig(stored) : null;
    }

    private redactConfig(config: Record<string, any>): Record<string, any> {
        return {
            ...config,
            apiKey: config.apiKey ? '***' : undefined,
            apiSecret: config.apiSecret ? '***' : undefined,
        };
    }

    /**
     * Descifra en memoria, y deja pasar lo que todavía está en claro marcándolo
     * para reescritura: lo viejo se re-guarda cifrado en el mismo camino, sin
     * una migración aparte que alguien tenga que acordarse de correr.
     */
    private async decryptConfig(
        tenantId: string,
        stored: Record<string, any>,
    ): Promise<Record<string, any>> {
        const config = { ...stored };
        const rewrap: Record<string, string> = {};
        for (const field of CHANNEL_MANAGER_SECRET_FIELDS) {
            const value = stored[field];
            if (value === undefined || value === null || value === '') continue;
            const context = {
                tenantId,
                scope: 'channel_manager' as const,
                provider: String(stored.provider || 'direct').toLowerCase(),
                field: field === 'apiKey' ? 'api_key' : 'api_secret',
            };
            try {
                const result = this.secrets.readCompatible(value, context);
                config[field] = result.plaintext;
                if (result.needsRewrap) {
                    // Best-effort: sin clave usable la credencial legible se
                    // sigue usando y se reintenta en la próxima lectura.
                    try {
                        rewrap[field] = this.secrets.encrypt(result.plaintext, context);
                    } catch (error: any) {
                        this.logger.warn(`[CM] no se pudo cifrar ${field}: ${error?.code}`);
                    }
                }
            } catch (error: any) {
                // Un secreto ilegible no se degrada a texto plano: se deja
                // ausente y la llamada al proveedor falla, que es lo honesto.
                this.logger.warn(`[CM] secreto ilegible ${field}: ${error?.code || error?.message}`);
                delete config[field];
            }
        }
        if (Object.keys(rewrap).length) {
            this.persistRewrappedConfig(tenantId, rewrap).catch((error: any) => {
                this.logger.warn(`[CM] no se pudo re-cifrar la credencial: ${error?.message}`);
            });
        }
        return config;
    }

    private async persistRewrappedConfig(
        tenantId: string,
        rewrap: Record<string, string>,
    ): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) return;
        const settings = (tenant.settings as any) || {};
        const current = settings.channelManager;
        if (!current) return;
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: { ...settings, channelManager: { ...current, ...rewrap } } as any,
            },
        });
        this.logger.log(`[CM] credenciales re-cifradas para ${tenantId}`);
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

        // Los secretos se cifran ANTES de tocar la base. Un valor que ya venía
        // cifrado (se conservó porque el panel mandó `***`) no se vuelve a
        // cifrar; uno nuevo en claro sí.
        const persisted: any = { ...merged };
        for (const field of CHANNEL_MANAGER_SECRET_FIELDS) {
            const value = (persisted as any)[field];
            if (value === undefined || value === null || value === '') continue;
            if (this.secrets.isEnvelope(value)) continue;
            (persisted as any)[field] = this.secrets.encrypt(String(value), {
                tenantId,
                scope: 'channel_manager',
                provider: String(merged.provider || 'direct').toLowerCase(),
                field: field === 'apiKey' ? 'api_key' : 'api_secret',
            });
        }

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { settings: { ...settings, channelManager: persisted } as any },
        });
        // Devuelve lo redactado: quien guardó ya sabe qué escribió, y el valor
        // no tiene por qué volver a viajar por la respuesta.
        return this.redactConfig(merged) as ChannelManagerConfig;
    }

    async listListings(tenantId: string): Promise<any[]> {
        const schemaName = await this.resolveSchemaName(tenantId);
        await this.ensureTables(schemaName);
        // El contador cuenta lo que OCUPA, no lo que dice una palabra que el
        // proveedor no usa: `status = 'confirmed'` dejaba en cero un listado de
        // Hostaway lleno de estadías `new`.
        return this.prisma.executeInTenantSchema<any[]>(schemaName, `
            SELECT l.*,
                (SELECT COUNT(*)::int FROM cm_reservations r
                 WHERE r.listing_id = l.id AND r.check_out >= CURRENT_DATE
                 AND lower(coalesce(r.status, '')) <> ALL($1::text[])) as active_reservations
            FROM cm_listings l
            WHERE l.status != 'deleted'
            ORDER BY l.name
        `, [[...NON_BLOCKING_RESERVATION_STATUSES]]);
    }

    async createListing(tenantId: string, data: {
        name: string; address?: string; externalId?: string; provider?: string;
        checkInTime?: string; checkOutTime?: string; maxGuests?: number;
        basePriceCents?: number; currency?: string; propertyId?: string;
    }): Promise<any> {
        const schemaName = await this.resolveSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName, `
            INSERT INTO cm_listings
            (external_id, provider, name, address, check_in_time, check_out_time,
             max_guests, base_price_cents, currency, property_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)
            RETURNING *
        `, [
            data.externalId || crypto.randomUUID(), data.provider || 'direct',
            data.name, data.address || null,
            data.checkInTime || '15:00', data.checkOutTime || '11:00',
            data.maxGuests || 4, data.basePriceCents || 0,
            data.currency || 'USD', data.propertyId || null,
        ]);
        return rows[0];
    }

    async createReservation(tenantId: string, data: {
        listingId: string; guestName: string; guestEmail?: string;
        guestPhone?: string; checkIn: string; checkOut: string;
        guests?: number; totalCents?: number; currency?: string;
        source?: string; notes?: string;
    }): Promise<any> {
        const schemaName = await this.resolveSchemaName(tenantId);
        await this.ensureTables(schemaName);

        const listings = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, provider, name FROM cm_listings WHERE id = $1::uuid LIMIT 1`,
            [data.listingId],
        );
        if (!listings?.length) throw new NotFoundException('Listing not found');
        const listingProvider = String(listings[0].provider || 'direct').toLowerCase();

        // ═══ EL LIBRO MAYOR ESTÁ AFUERA ═══
        //
        // Esto insertaba `provider = 'direct'` en CUALQUIER listado, incluidos
        // los de Hostaway. Una reserva de Hostaway se crea en Hostaway: una
        // fila local que el proveedor nunca ve no bloquea nada del lado del
        // canal, así que el mismo departamento se podía vender dos veces —una
        // acá y otra en Airbnb— y el huésped se enteraba al llegar.
        //
        // Escribir en el proveedor tampoco es la salida: no hay credencial de
        // escritura certificada y hacerlo a ciegas es peor. Se rechaza con el
        // motivo, que es lo honesto mientras el escritor externo no exista.
        if (EXTERNAL_RESERVATION_SYSTEMS.has(listingProvider)) {
            throw new ConflictException({
                error: 'external_system_of_record',
                provider: listingProvider,
                listingId: data.listingId,
                message: `Las reservas de "${listings[0].name}" viven en ${listingProvider}. `
                    + 'Creala allá y se sincroniza sola; una reserva creada acá no bloquearía '
                    + 'las fechas en el canal y el alojamiento se vendería dos veces.',
            });
        }

        // El conflicto se medía contra `status = 'confirmed'`, y Hostaway nunca
        // manda esa palabra: manda `new`, `modified`, `ownerStay`. Una estadía
        // sincronizada no bloqueaba nada y la fecha se volvía a vender.
        //
        // Se invierte la pregunta: bloquea todo lo que NO libera la fecha. Un
        // estado desconocido bloquea, porque no saber si ocupa no es saber que
        // está libre.
        const conflicts = await this.prisma.executeInTenantSchema<any[]>(schemaName, `
            SELECT 1 FROM cm_reservations
            WHERE listing_id = $1::uuid
            AND lower(coalesce(status, '')) <> ALL($4::text[])
            AND check_in < $3::date AND check_out > $2::date
        `, [data.listingId, data.checkIn, data.checkOut, [...NON_BLOCKING_RESERVATION_STATUSES]]);

        if (conflicts.length > 0) throw new BadRequestException('Dates conflict with existing reservation');

        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName, `
            INSERT INTO cm_reservations
            (listing_id, provider, guest_name, guest_email, guest_phone,
             check_in, check_out, guests, total_cents, currency, source, notes)
            VALUES ($1::uuid, 'direct', $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            data.listingId, data.guestName, data.guestEmail || null,
            data.guestPhone || null, data.checkIn, data.checkOut,
            data.guests || 1, data.totalCents || 0, data.currency || 'USD',
            data.source || 'direct', data.notes || null,
        ]);

        if ((await this.getConfig(tenantId))?.autoBlock) {
            await this.blockDates(schemaName, data.listingId, data.checkIn, data.checkOut);
        }

        return rows[0];
    }

    async listReservations(tenantId: string, filters?: {
        listingId?: string; status?: string; fromDate?: string; toDate?: string;
    }): Promise<any[]> {
        const schemaName = await this.resolveSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (filters?.listingId) { conditions.push(`r.listing_id = $${idx++}::uuid`); params.push(filters.listingId); }
        if (filters?.status) { conditions.push(`r.status = $${idx++}`); params.push(filters.status); }
        if (filters?.fromDate) { conditions.push(`r.check_out >= $${idx++}::date`); params.push(filters.fromDate); }
        if (filters?.toDate) { conditions.push(`r.check_in <= $${idx++}::date`); params.push(filters.toDate); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return this.prisma.executeInTenantSchema<any[]>(schemaName, `
            SELECT r.*, l.name as listing_name
            FROM cm_reservations r
            JOIN cm_listings l ON l.id = r.listing_id
            ${where}
            ORDER BY r.check_in ASC
        `, params);
    }

    async getAvailability(tenantId: string, listingId: string, from: string, to: string): Promise<any[]> {
        const schemaName = await this.resolveSchemaName(tenantId);
        await this.ensureTables(schemaName);
        return this.prisma.executeInTenantSchema<any[]>(schemaName, `
            SELECT d::date as date,
                CASE WHEN a.is_available IS NOT NULL THEN a.is_available
                     WHEN r.id IS NOT NULL THEN false
                     ELSE true END as available,
                COALESCE(a.price_cents, l.base_price_cents) as price_cents,
                COALESCE(a.min_nights, 1) as min_nights,
                r.guest_name as reserved_by
            FROM generate_series($2::date, $3::date, '1 day') d
            CROSS JOIN cm_listings l
            LEFT JOIN cm_availability a ON a.listing_id = l.id AND a.date = d
            LEFT JOIN cm_reservations r ON r.listing_id = l.id
                AND lower(coalesce(r.status, '')) <> ALL($4::text[])
                AND d >= r.check_in AND d < r.check_out
            WHERE l.id = $1::uuid
            ORDER BY d
        `, [listingId, from, to, [...NON_BLOCKING_RESERVATION_STATUSES]]);
    }

    async syncHostaway(tenantId: string): Promise<{ listings: number; reservations: number }> {
        const config = await this.getConfig(tenantId);
        if (!config || config.provider !== 'hostaway') throw new BadRequestException('Hostaway not configured');

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');
        const schemaName = tenant.schemaName;
        await this.ensureTables(schemaName);

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
            await this.prisma.executeInTenantSchema<any[]>(schemaName, `
                INSERT INTO cm_listings
                (external_id, provider, name, address, max_guests, base_price_cents, currency, last_synced_at)
                VALUES ($1, 'hostaway', $2, $3, $4, $5, $6, now())
                ON CONFLICT (external_id, provider) DO UPDATE SET
                    name = EXCLUDED.name, address = EXCLUDED.address,
                    max_guests = EXCLUDED.max_guests, base_price_cents = EXCLUDED.base_price_cents,
                    last_synced_at = now()
            `, [
                String(l.id), l.name, l.address || null,
                l.maxGuests || 4, Math.round((l.basePrice || 0) * 100),
                l.currencyCode || 'USD',
            ]);
            listingCount++;
        }

        const reservationsResp = await this.http.axiosRef.get('https://api.hostaway.com/v1/reservations', { headers });
        const reservations = reservationsResp.data?.result || [];
        let resCount = 0;

        for (const r of reservations) {
            await this.prisma.executeInTenantSchema<any[]>(schemaName, `
                INSERT INTO cm_reservations
                (listing_id, external_id, provider, guest_name, guest_email, guest_phone,
                 check_in, check_out, guests, total_cents, currency, status, source, synced_at)
                SELECT l.id, $1, 'hostaway', $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, now()
                FROM cm_listings l WHERE l.external_id = $12 AND l.provider = 'hostaway'
                ON CONFLICT (external_id, provider) DO UPDATE SET
                    guest_name = EXCLUDED.guest_name, check_in = EXCLUDED.check_in,
                    check_out = EXCLUDED.check_out, status = EXCLUDED.status, synced_at = now()
            `, [
                String(r.id), r.guestName || 'Guest', r.guestEmail || null, r.guestPhone || null,
                r.arrivalDate, r.departureDate, r.numberOfGuests || 1,
                Math.round((r.totalPrice || 0) * 100), r.currency || 'USD',
                r.status || 'confirmed', r.channelName || 'hostaway',
                String(r.listingMapId),
            ]);
            resCount++;
        }

        this.logger.log(`Hostaway sync: ${listingCount} listings, ${resCount} reservations for tenant ${tenantId}`);
        return { listings: listingCount, reservations: resCount };
    }

    /**
     * Internal callers already hold a resolved schema name, so this one keeps
     * taking it instead of paying a second tenant lookup per reservation.
     */
    /**
     * Bridge a Parallly property to a Channel Manager listing, or unbridge it.
     *
     * This mapping is the switch that decides who owns the unit's calendar, so
     * it is deliberate and one-to-one: a listing already bound to another
     * property is rejected rather than silently re-pointed, because a wrong
     * mapping makes the conversational writer refuse the wrong units — or worse,
     * allow the wrong ones.
     */
    async mapListingToProperty(
        tenantId: string,
        listingId: string,
        propertyId: string | null,
    ): Promise<any> {
        const schemaName = await this.resolveSchemaName(tenantId);
        await this.ensureTables(schemaName);
        if (!UUID_PATTERN.test(listingId || '')) {
            throw new BadRequestException('listingId must be a valid UUID');
        }
        if (propertyId !== null && !UUID_PATTERN.test(propertyId || '')) {
            throw new BadRequestException('propertyId must be a valid UUID or null');
        }

        const listings = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id FROM cm_listings WHERE id = $1::uuid LIMIT 1`,
            [listingId],
        );
        if (!listings?.length) throw new NotFoundException('Listing not found');

        if (propertyId) {
            const properties = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id FROM properties WHERE id = $1::uuid LIMIT 1`,
                [propertyId],
            );
            if (!properties?.length) throw new NotFoundException('Property not found');

            const clash = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id FROM cm_listings
                  WHERE property_id = $1::uuid AND id <> $2::uuid
                  LIMIT 1`,
                [propertyId, listingId],
            );
            if (clash?.length) {
                throw new ConflictException({
                    error: 'property_already_mapped',
                    listingId: clash[0].id,
                    message: 'Ese alojamiento ya está enlazado a otra publicación del channel manager.',
                });
            }
        }

        const updated = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE cm_listings SET property_id = $2::uuid WHERE id = $1::uuid RETURNING *`,
            [listingId, propertyId],
        );
        // The writer gate reads this mapping through a 60s cache; drop it so the
        // change takes effect on the next turn instead of the next minute.
        await this.redis.del(`lodging:sor:${tenantId}:${propertyId}`).catch(() => undefined);
        return updated?.[0] ?? null;
    }

    /** Properties bridged to a listing, for the mapping screen and audits. */
    async listMappings(tenantId: string): Promise<any[]> {
        const schemaName = await this.resolveSchemaName(tenantId);
        await this.ensureTables(schemaName);
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT l.id AS listing_id, l.name AS listing_name, l.provider,
                    l.external_id, l.last_synced_at, l.property_id,
                    p.name AS property_name
               FROM cm_listings l
               LEFT JOIN properties p ON p.id = l.property_id
              ORDER BY l.name ASC`,
        );
    }

    private async blockDates(schemaName: string, listingId: string, checkIn: string, checkOut: string): Promise<void> {
        await this.prisma.executeInTenantSchema<any[]>(schemaName, `
            INSERT INTO cm_availability (listing_id, date, is_available)
            SELECT $1::uuid, d::date, false
            FROM generate_series($2::date, ($3::date - interval '1 day'), '1 day') d
            ON CONFLICT (listing_id, date) DO UPDATE SET is_available = false
        `, [listingId, checkIn, checkOut]);
    }

    /**
     * The controller hands over a tenantId (that is what @CurrentTenant carries),
     * so every tenant-scoped entry point converts it here. Passing the id straight
     * into SQL is what made Postgres look for a schema named like a UUID.
     */
    private async resolveSchemaName(tenantId: string): Promise<string> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        return schemaName;
    }
}
