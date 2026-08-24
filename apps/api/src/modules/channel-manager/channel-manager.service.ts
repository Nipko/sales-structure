import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as crypto from 'crypto';
import {
    TENANT_SECRET_MASK,
    TenantSecretCryptoService,
    isMaskedSecret,
} from '../../common/crypto/tenant-secret-crypto.service';
import {
    mutateTenantSettingsBranchAtomic,
} from '../../common/utils/tenant-settings-branch.util';
import { IntegrationOutboxService } from '../integrations/integration-outbox.service';
import { lodgingSorCacheVersionKey } from './lodging-cache-key.util';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que es una credencial. `accountId` es un identificador, no un secreto. */
export const CHANNEL_MANAGER_SECRET_FIELDS = ['apiKey', 'apiSecret'] as const;

/** `apiKey` → `api_key`: el AAD ata el valor a su campo exacto. */
export const CHANNEL_MANAGER_SECRET_FIELD_IDS: Readonly<Record<string, string>> = Object.freeze({
    apiKey: 'api_key',
    apiSecret: 'api_secret',
});

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
        @Optional() private readonly integrationOutbox?: IntegrationOutboxService,
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
        if (exists.length > 0) {
            await this.ensureSyncGenerationColumns(schemaName);
            return;
        }

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
                sync_generation UUID,
                is_deleted BOOLEAN NOT NULL DEFAULT false,
                deleted_at TIMESTAMPTZ,
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
                sync_generation UUID,
                is_deleted BOOLEAN NOT NULL DEFAULT false,
                deleted_at TIMESTAMPTZ,
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

        await this.ensureSyncGenerationColumns(schemaName);

        this.logger.log(`Channel manager tables created for schema ${schemaName}`);
    }

    private async ensureSyncGenerationColumns(schemaName: string): Promise<void> {
        const statements = [
            `ALTER TABLE "${schemaName}".cm_listings ADD COLUMN IF NOT EXISTS sync_generation UUID`,
            `ALTER TABLE "${schemaName}".cm_listings ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false`,
            `ALTER TABLE "${schemaName}".cm_listings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
            `ALTER TABLE "${schemaName}".cm_reservations ADD COLUMN IF NOT EXISTS sync_generation UUID`,
            `ALTER TABLE "${schemaName}".cm_reservations ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false`,
            `ALTER TABLE "${schemaName}".cm_reservations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
        ];
        // One statement per call: required by PgBouncer transaction mode.
        for (const statement of statements) await this.prisma.$queryRawUnsafe(statement);
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

    /**
     * Lo que el panel puede ver.
     *
     * La lista sale del registro de campos secretos y no de un literal por
     * campo: escrita a mano, un campo secreto nuevo sale sin enmascarar y nadie
     * lo nota hasta que aparece en una respuesta HTTP.
     */
    private redactConfig(config: Record<string, any>): Record<string, any> {
        const out: Record<string, any> = { ...config };
        for (const field of CHANNEL_MANAGER_SECRET_FIELDS) {
            out[field] = config[field] ? TENANT_SECRET_MASK : undefined;
        }
        return out;
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
                field: CHANNEL_MANAGER_SECRET_FIELD_IDS[field],
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
            const expectedProvider = String(stored.provider || 'direct').toLowerCase();
            this.persistRewrappedConfig(tenantId, expectedProvider, rewrap).catch((error: any) => {
                this.logger.warn(`[CM] no se pudo re-cifrar la credencial: ${error?.message}`);
            });
        }
        return config;
    }

    private async persistRewrappedConfig(
        tenantId: string,
        expectedProvider: string,
        rewrap: Record<string, string>,
    ): Promise<void> {
        let changed = false;
        await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'channelManager',
            (raw) => {
                const current = raw && typeof raw === 'object' ? raw as Record<string, any> : null;
                // The rewrap was produced with AAD for the provider observed by
                // the read. If the owner switched provider in the meantime,
                // writing that envelope would poison the new configuration.
                if (!current || String(current.provider || 'direct').toLowerCase() !== expectedProvider) {
                    return current;
                }
                changed = true;
                return { ...current, ...rewrap };
            },
        );
        if (changed) this.logger.log(`[CM] credenciales re-cifradas para ${tenantId}`);
    }

    async updateConfig(tenantId: string, updates: Partial<ChannelManagerConfig>): Promise<ChannelManagerConfig> {
        let previousProvider: string | undefined;
        let providerChanged = false;
        const persisted = await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'channelManager',
            (raw) => {
                const current = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
                const nextProvider = updates.provider ?? current.provider ?? 'direct';
                previousProvider = current.provider;

                // ═══ CAMBIAR DE PROVEEDOR NO ARRASTRA LA CREDENCIAL DEL ANTERIOR ═══
                // El sobre está ligado por AAD a su proveedor. The merge runs
                // while the row is locked so two saves cannot each preserve a
                // different stale credential for the same configuration.
                providerChanged = !!current.provider && current.provider !== nextProvider;
                const carried = (field: 'apiKey' | 'apiSecret'): string | undefined => {
                    const incoming = updates[field];
                    // `***` means preserve the live value, not store the mask.
                    if (incoming !== undefined && !isMaskedSecret(incoming)) return incoming;
                    return providerChanged ? undefined : current[field];
                };

                const merged: ChannelManagerConfig = {
                    provider: nextProvider,
                    apiKey: carried('apiKey'),
                    apiSecret: carried('apiSecret'),
                    accountId: providerChanged
                        ? (updates.accountId ?? undefined)
                        : (updates.accountId ?? current.accountId),
                    syncInterval: updates.syncInterval ?? current.syncInterval ?? 60,
                    autoBlock: updates.autoBlock ?? current.autoBlock ?? true,
                };

                const next: any = { ...merged };
                for (const field of CHANNEL_MANAGER_SECRET_FIELDS) {
                    const value = next[field];
                    if (value === undefined || value === null || value === '') continue;
                    if (this.secrets.isEnvelope(value)) continue;
                    next[field] = this.secrets.encrypt(String(value), {
                        tenantId,
                        scope: 'channel_manager',
                        provider: String(merged.provider || 'direct').toLowerCase(),
                        field: CHANNEL_MANAGER_SECRET_FIELD_IDS[field],
                    });
                }
                return next;
            },
        );
        if (providerChanged) {
            this.logger.warn(
                `[CM] ${tenantId} cambió de ${previousProvider} a ${persisted.provider}: `
                + 'se descartan las credenciales del proveedor anterior',
            );
        }
        // Provider/credential changes can alter whether local reservation
        // writes are allowed. Do not leave the old ownership decision live
        // until the next scheduled provider sync.
        await this.advanceLodgingSorCacheGeneration(tenantId);
        // Devuelve lo redactado: quien guardó ya sabe qué escribió, y el valor
        // no tiene por qué volver a viajar por la respuesta.
        return this.redactConfig(persisted) as ChannelManagerConfig;
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
                 AND r.is_deleted = false
                 AND lower(coalesce(r.status, '')) <> ALL($1::text[])) as active_reservations
            FROM cm_listings l
            WHERE l.status != 'deleted' AND l.is_deleted = false
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
        // The HTTP DTO validates each value as an ISO date, but this service is
        // also called directly by application code.  Keep the invariant at the
        // mutation boundary: a stay is a non-empty half-open range [in, out).
        // In particular, PostgreSQL would happily accept an equal/reversed pair
        // and the overlap predicate below would then protect no nights at all.
        this.assertReservationDateRange(data?.checkIn, data?.checkOut);

        const schemaName = await this.resolveSchemaName(tenantId);
        await this.ensureTables(schemaName);

        // Lock, authoritative-listing read, conflict check and INSERT share one
        // tenant transaction.  The advisory key serializes every reservation
        // attempt for this listing, including disjoint ranges.  The loser of a
        // concurrent overlap waits, then sees the winner before it can INSERT.
        // A row lock alone is not enough when there is no conflicting
        // reservation row yet (the classic phantom/double-booking race).
        const result = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS lock_acquired`,
                [`cm-reservation:${schemaName}:${data.listingId}`],
            );

            const listings = await query<any[]>(
                `SELECT id, external_id, provider, name FROM cm_listings
                  WHERE id = $1::uuid AND is_deleted = false LIMIT 1 FOR UPDATE`,
                [data.listingId],
            );
            if (!listings?.length) throw new NotFoundException('Listing not found');
            const listingProvider = String(listings[0].provider || 'direct').toLowerCase();

            // ═══ EL LIBRO MAYOR ESTÁ AFUERA ═══
            // Provider ownership is re-read under lock.  Return the intent to
            // the caller instead of throwing inside the transaction: the local
            // transaction commits no reservation, then the suppressed outbox
            // intent can be recorded durably in its own transaction.
            if (EXTERNAL_RESERVATION_SYSTEMS.has(listingProvider)) {
                return {
                    kind: 'external' as const,
                    listing: listings[0],
                    listingProvider,
                };
            }

            // Block everything that is not an explicitly releasing status.
            // Unknown future provider states therefore fail closed.
            const conflicts = await query<any[]>(`
                SELECT 1 FROM cm_reservations
                WHERE listing_id = $1::uuid
                AND is_deleted = false
                AND lower(coalesce(status, '')) <> ALL($4::text[])
                AND check_in < $3::date AND check_out > $2::date
                LIMIT 1
            `, [data.listingId, data.checkIn, data.checkOut, [...NON_BLOCKING_RESERVATION_STATUSES]]);

            if (conflicts.length > 0) {
                throw new BadRequestException('Dates conflict with existing reservation');
            }

            const rows = await query<any[]>(`
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
            return { kind: 'created' as const, row: rows[0] };
        });

        if (result.kind === 'external') {
            const subjectId = crypto.createHash('sha256').update([
                data.listingId,
                data.checkIn,
                data.checkOut,
                data.guestEmail || data.guestPhone || data.guestName,
            ].join('|')).digest('hex');
            const intent = await this.integrationOutbox?.enqueue(schemaName, {
                tenantId,
                provider: result.listingProvider,
                operation: 'create_reservation',
                subjectId,
                payload: {
                    listingId: data.listingId,
                    externalListingId: result.listing.external_id,
                    guestName: data.guestName,
                    guestEmail: data.guestEmail,
                    guestPhone: data.guestPhone,
                    checkIn: data.checkIn,
                    checkOut: data.checkOut,
                    guests: data.guests ?? 1,
                    totalCents: data.totalCents ?? 0,
                    currency: data.currency ?? 'USD',
                    source: data.source ?? 'direct',
                },
            }).catch((error: any) => {
                this.logger.warn(`[CM] no se pudo registrar intención externa: ${error?.message}`);
                return undefined;
            });
            throw new ConflictException({
                error: 'external_system_of_record',
                provider: result.listingProvider,
                listingId: data.listingId,
                outboxIntentId: intent?.id,
                writeStatus: intent?.suppressed ? 'suppressed' : 'unavailable',
                message: `Las reservas de "${result.listing.name}" viven en ${result.listingProvider}. `
                    + 'Creala allá y se sincroniza sola; una reserva creada acá no bloquearía '
                    + 'las fechas en el canal y el alojamiento se vendería dos veces.',
            });
        }

        if ((await this.getConfig(tenantId))?.autoBlock) {
            await this.blockDates(schemaName, data.listingId, data.checkIn, data.checkOut);
        }

        return result.row;
    }

    async listReservations(tenantId: string, filters?: {
        listingId?: string; status?: string; fromDate?: string; toDate?: string;
    }): Promise<any[]> {
        const schemaName = await this.resolveSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const conditions: string[] = ['r.is_deleted = false', 'l.is_deleted = false'];
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
                AND r.is_deleted = false
                AND lower(coalesce(r.status, '')) <> ALL($4::text[])
                AND d >= r.check_in AND d < r.check_out
            WHERE l.id = $1::uuid AND l.is_deleted = false
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

        const token = await this.authenticateHostaway(config);
        const headers = { Authorization: `Bearer ${token}` };
        const listingGeneration = crypto.randomUUID();
        const reservationGeneration = crypto.randomUUID();
        const listings = await this.fetchHostawayPages('https://api.hostaway.com/v1/listings', headers);
        const reservations = await this.fetchHostawayPages('https://api.hostaway.com/v1/reservations', headers);
        // Both resources are fetched in full before touching the mirror. The
        // transaction then publishes one coherent generation: a page timeout,
        // a bad reservation reference or a tombstone failure rolls it all back.
        await this.prisma.transactionInTenantSchema(
            schemaName,
            async (query) => {
                for (const l of listings) {
                    await query(`
                        INSERT INTO cm_listings
                        (external_id, provider, name, address, max_guests, base_price_cents, currency,
                         last_synced_at, sync_generation, is_deleted, deleted_at, status)
                        VALUES ($1, 'hostaway', $2, $3, $4, $5, $6, now(), $7::uuid, false, NULL, 'active')
                        ON CONFLICT (external_id, provider) DO UPDATE SET
                            name = EXCLUDED.name, address = EXCLUDED.address,
                            max_guests = EXCLUDED.max_guests, base_price_cents = EXCLUDED.base_price_cents,
                            currency = EXCLUDED.currency, last_synced_at = now(),
                            sync_generation = EXCLUDED.sync_generation, is_deleted = false,
                            deleted_at = NULL, status = 'active'
                    `, [
                        String(l.id), l.name, l.address || null,
                        l.maxGuests || 4, Math.round((l.basePrice || 0) * 100),
                        l.currencyCode || 'USD', listingGeneration,
                    ]);
                }

                for (const r of reservations) {
                    const inserted = await query<any[]>(`
                        INSERT INTO cm_reservations
                        (listing_id, external_id, provider, guest_name, guest_email, guest_phone,
                         check_in, check_out, guests, total_cents, currency, status, source, synced_at,
                         sync_generation, is_deleted, deleted_at)
                        SELECT l.id, $1, 'hostaway', $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, now(),
                               $13::uuid, false, NULL
                        FROM cm_listings l WHERE l.external_id = $12 AND l.provider = 'hostaway'
                        ON CONFLICT (external_id, provider) DO UPDATE SET
                            listing_id = EXCLUDED.listing_id, guest_name = EXCLUDED.guest_name,
                            guest_email = EXCLUDED.guest_email, guest_phone = EXCLUDED.guest_phone,
                            check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
                            guests = EXCLUDED.guests, total_cents = EXCLUDED.total_cents,
                            currency = EXCLUDED.currency, status = EXCLUDED.status, source = EXCLUDED.source,
                            synced_at = now(), sync_generation = EXCLUDED.sync_generation,
                            is_deleted = false, deleted_at = NULL
                        RETURNING id
                    `, [
                        String(r.id), r.guestName || 'Guest', r.guestEmail || null, r.guestPhone || null,
                        r.arrivalDate, r.departureDate, r.numberOfGuests || 1,
                        Math.round((r.totalPrice || 0) * 100), r.currency || 'USD',
                        r.status || 'confirmed', r.channelName || 'hostaway',
                        String(r.listingMapId), reservationGeneration,
                    ]);
                    if (!inserted?.length) {
                        throw new ConflictException(
                            `Hostaway reservation ${String(r.id)} references an unknown listing`,
                        );
                    }
                }

                await query(`
                    UPDATE cm_reservations
                       SET is_deleted = true, deleted_at = now(), status = 'cancelled'
                     WHERE provider = 'hostaway' AND is_deleted = false
                       AND sync_generation IS DISTINCT FROM $1::uuid
                `, [reservationGeneration]);
                await query(`
                    UPDATE cm_listings
                       SET is_deleted = true, deleted_at = now(), status = 'deleted'
                     WHERE provider = 'hostaway' AND is_deleted = false
                       AND sync_generation IS DISTINCT FROM $1::uuid
                `, [listingGeneration]);
            },
            { timeout: 120_000 },
        );

        this.logger.log(
            `Hostaway sync: ${listings.length} listings, ${reservations.length} reservations for tenant ${tenantId}`,
        );
        return { listings: listings.length, reservations: reservations.length };
    }

    /** Credential probe only: authenticates and reads one row, never writes. */
    async testHostawayConnection(tenantId: string): Promise<{
        ok: boolean;
        provider: 'hostaway';
        reachable: boolean;
    }> {
        const config = await this.getConfig(tenantId);
        if (!config || config.provider !== 'hostaway') {
            throw new BadRequestException('Hostaway not configured');
        }
        const token = await this.authenticateHostaway(config);
        await this.http.axiosRef.get('https://api.hostaway.com/v1/listings', {
            headers: { Authorization: `Bearer ${token}` },
            params: { limit: 1, offset: 0 },
            timeout: 15000,
        });
        return { ok: true, provider: 'hostaway', reachable: true };
    }

    private async authenticateHostaway(config: ChannelManagerConfig): Promise<string> {
        const tokenResp = await this.http.axiosRef.post('https://api.hostaway.com/v1/accessTokens', {
            grant_type: 'client_credentials',
            client_id: config.accountId,
            client_secret: config.apiSecret,
        }, { timeout: 15000 });
        const token = tokenResp.data?.access_token;
        if (!token) throw new BadRequestException('Failed to authenticate with Hostaway');
        return token;
    }

    private async fetchHostawayPages(
        url: string,
        headers: Record<string, string>,
    ): Promise<any[]> {
        const limit = 100;
        const all: any[] = [];
        for (let page = 0; page < 500; page++) {
            const offset = page * limit;
            const response = await this.http.axiosRef.get(url, {
                headers,
                params: { limit, offset },
                timeout: 30000,
            });
            const rows = Array.isArray(response.data?.result) ? response.data.result : [];
            all.push(...rows);
            const total = Number(response.data?.count ?? response.data?.total);
            if (!rows.length || rows.length < limit || (Number.isFinite(total) && all.length >= total)) {
                return all;
            }
        }
        throw new Error('Hostaway excedió el límite seguro de páginas');
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

        const row = await this.prisma.transactionInTenantSchema(
            schemaName,
            async (query) => {
                const listings = await query<any[]>(
                    `SELECT id, property_id FROM cm_listings
                      WHERE id = $1::uuid LIMIT 1 FOR UPDATE`,
                    [listingId],
                );
                if (!listings?.length) throw new NotFoundException('Listing not found');

                if (propertyId) {
                    // Serialize all mappings for the same local unit. Without
                    // this lock, two requests could both pass the clash query
                    // and bind two external listings to one property.
                    await query(
                        `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS locked`,
                        [`cm-property:${propertyId}`],
                    );
                    const properties = await query<any[]>(
                        `SELECT id FROM properties WHERE id = $1::uuid LIMIT 1`,
                        [propertyId],
                    );
                    if (!properties?.length) throw new NotFoundException('Property not found');

                    const clash = await query<any[]>(
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

                const updated = await query<any[]>(
                    `UPDATE cm_listings SET property_id = $2::uuid
                      WHERE id = $1::uuid RETURNING *`,
                    [listingId, propertyId],
                );
                return updated?.[0] ?? null;
            },
        );
        // The writer gate caches ownership decisions. Move the whole tenant to
        // a new cache generation so both sides of a remap become unreachable
        // atomically. Old value keys expire on their normal short TTL.
        await this.advanceLodgingSorCacheGeneration(tenantId);
        return row;
    }

    private async advanceLodgingSorCacheGeneration(tenantId: string): Promise<void> {
        try {
            await this.redis.incr(lodgingSorCacheVersionKey(tenantId));
        } catch (error: any) {
            // Resolver reads disable the cache while Redis is unavailable. The
            // warning makes a failed cut observable without reporting the
            // already-committed settings/mapping mutation as if it had failed.
            this.logger.warn(`[CM] no se pudo invalidar el cache SoR de ${tenantId}: ${error?.message}`);
        }
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
              WHERE l.is_deleted = false
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

    /** Validate the half-open stay interval at every service entry point. */
    private assertReservationDateRange(checkIn: string | undefined, checkOut: string | undefined): void {
        const assertDateOnly = (value: string | undefined, field: string): string => {
            if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                throw new BadRequestException(`${field} must use YYYY-MM-DD`);
            }
            const parsed = new Date(`${value}T00:00:00.000Z`);
            if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
                throw new BadRequestException(`${field} must be a valid calendar date`);
            }
            return value;
        };

        const start = assertDateOnly(checkIn, 'checkIn');
        const end = assertDateOnly(checkOut, 'checkOut');
        if (end <= start) {
            throw new BadRequestException('checkOut must be after checkIn');
        }
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
