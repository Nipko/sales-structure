import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import {
    assertOptionalContactId,
    requireTenantContact,
} from '../../common/utils/tenant-contact.util';
import { resolveNativeEvidenceOpportunity } from '../../common/utils/native-evidence-opportunity.util';
import {
    LodgingSorResolution,
    LodgingSourceOfTruthService,
    localWriterAllowed,
} from '../channel-manager/lodging-source-of-truth.service';
import {
    describePaymentPolicy,
    validatePaymentPolicyInput,
    holdStillAliveSql,
    PAYMENT_HOLD_MS,
    PENDING_PAYMENT_STATUS,
    resolvePaymentPolicy,
} from '../../common/utils/payment-policy.util';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Quién creó la reserva. `property_bookings` no guarda un `source` — las
 * estadías importadas de Airbnb/Booking viven en `ical_blocks`, con su propio
 * `source` —, así que el dueño veía una etiqueta de origen vacía y no podía
 * distinguir lo que hizo el agente de lo que cargó él a mano.
 *
 * El dato ya estaba: sólo el agente pasa `conversation_id` al reservar
 * (`createBooking` lo recibe del turno; el alta manual del panel no lo manda).
 * Se deriva en la consulta en lugar de agregar una columna: no hay migración,
 * y las filas viejas quedan clasificadas igual que las nuevas.
 */
const BOOKING_ORIGIN_SQL = `CASE WHEN conversation_id IS NOT NULL THEN 'agent' ELSE 'manual' END`;

interface StayRange {
    checkIn: string;
    checkOut: string;
    nights: number;
}

@Injectable()
export class PropertiesService {
    private readonly logger = new Logger(PropertiesService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
        private readonly emailTemplates: EmailTemplatesService,
        // Optional so the many specs that build this service by hand keep
        // working. When absent the tenant behaves as Channel-Manager-free,
        // which is what a tenant without the integration is.
        private readonly lodgingSor?: LodgingSourceOfTruthService,
    ) {}

    /**
     * Who owns this unit's calendar right now.
     *
     * `local` cuando no hay resolutor cableado o el tenant no tiene Channel
     * Manager: ese es el caso ordinario, no uno degradado.
     *
     * Lo que cambió: un fallo del resolutor ya **no** devuelve `local`. Este
     * `catch` era el tercero de los tres caminos por los que una unidad de
     * Hostaway terminaba escribiéndose acá — los otros dos estaban dentro del
     * propio resolutor. No poder averiguar quién administra el calendario no
     * autoriza a escribir en él.
     */
    private async resolveSor(
        tenantId: string | undefined,
        schemaName: string,
        propertyId: string,
    ): Promise<LodgingSorResolution> {
        // Sin resolutor no hay integración en este despliegue, y sin tenantId
        // no hay a quién preguntarle: las dos son ausencias, no fallas.
        if (!this.lodgingSor || !tenantId) {
            return { sor: 'local', connected: false, stale: false, health: 'unknown' };
        }
        try {
            return await this.lodgingSor.resolveForProperty(tenantId, schemaName, propertyId);
        } catch (error: any) {
            this.logger.error(`[Lodging] SoR resolution failed: ${error?.message}`);
            return {
                sor: 'unknown',
                connected: false,
                stale: true,
                health: 'unknown',
                writerBlockedReason: 'ownership_unknown',
            };
        }
    }

    /**
     * Nights the Channel Manager already sold for this unit.
     *
     * Read from the local mirror, never from the provider API: an availability
     * question must not depend on a third party being up. Freshness is reported
     * separately so the agent can say the calendar may be behind instead of
     * pretending certainty.
     */
    private async channelManagerConflicts(
        schemaName: string,
        listingId: string,
        checkIn: string,
        checkOut: string,
    ): Promise<Array<{ source: string; check_in: string; check_out: string }>> {
        try {
            return await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT COALESCE(source, provider, 'channel_manager') AS source,
                        check_in::text AS check_in,
                        check_out::text AS check_out
                   FROM cm_reservations
                  WHERE listing_id = $1::uuid
                    AND is_deleted = false
                    AND status NOT IN ('cancelled', 'declined', 'expired')
                    AND check_in < $3::date
                    AND check_out > $2::date
                  LIMIT 1`,
                [listingId, checkIn, checkOut],
            );
        } catch (error: any) {
            // A mirror we cannot read is not an empty mirror. Surfacing this as
            // "no conflicts" is exactly the double booking this guard exists to
            // prevent, so report it as a blocking conflict instead.
            this.logger.warn(`[Lodging] cm_reservations read failed: ${error?.message}`);
            return [{ source: 'channel_manager_unreadable', check_in: checkIn, check_out: checkOut }];
        }
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

    private assertUuid(value: unknown, field: string): string {
        if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
            throw new BadRequestException(`${field} must be a valid UUID`);
        }
        return value;
    }

    private validateStayRange(checkIn: unknown, checkOut: unknown): StayRange {
        const validCheckIn = this.assertDateOnly(checkIn, 'checkIn');
        const validCheckOut = this.assertDateOnly(checkOut, 'checkOut');
        const checkInMs = Date.parse(`${validCheckIn}T00:00:00.000Z`);
        const checkOutMs = Date.parse(`${validCheckOut}T00:00:00.000Z`);
        const nights = (checkOutMs - checkInMs) / 86_400_000;

        if (nights <= 0) {
            throw new BadRequestException('checkOut must be after checkIn');
        }
        return { checkIn: validCheckIn, checkOut: validCheckOut, nights };
    }

    private assertPropertyBookable(property: any): void {
        if (!property) throw new NotFoundException('Property not found');
        if (property.is_active !== true) {
            throw new BadRequestException('Property is inactive and cannot be booked');
        }
    }

    /** Resolve a date-only value in the tenant timezone (never in server/UTC time). */
    async getTenantLocalDate(tenantId: string, now: Date = new Date()): Promise<string> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const settings = (tenant.settings as any) || {};
        const timezone = settings.businessHours?.timezone || settings.timezone || 'America/Bogota';
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).formatToParts(now);
            const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
            return this.assertDateOnly(`${values.year}-${values.month}-${values.day}`, 'from');
        } catch (error) {
            if (error instanceof BadRequestException) throw error;
            throw new BadRequestException(`Tenant timezone is invalid: ${timezone}`);
        }
    }

    async list(schemaName: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM properties WHERE is_active = true ORDER BY sort_order, name`,
        );
    }

    async getById(schemaName: string, propertyId: string): Promise<any> {
        // La validación vive acá, donde vive el `::uuid`, y no en cada llamador:
        // el id suele venir de una tool call del LLM, que manda el slug o el
        // nombre. Sin esto Postgres tira 22P02 crudo y el modelo no sabe qué
        // corregir; con esto todo llamador recibe el mismo error accionable.
        this.assertUuid(propertyId, 'propertyId');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM properties WHERE id = $1::uuid`,
            [propertyId],
        );
        return rows?.[0] || null;
    }

    async create(tenantId: string, schemaName: string, data: any): Promise<any> {
        const existing = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int as cnt FROM properties WHERE is_active = true`,
        );
        await this.throttle.enforcePlanLimit(tenantId, 'maxProperties', existing?.[0]?.cnt || 0, 'propiedades');

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO properties (name, description, address, city, max_guests, bedrooms, bathrooms,
             night_price, cleaning_fee, currency, min_nights, check_in_time, check_out_time,
             amenities, house_rules, check_in_instructions, images, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::time, $13::time, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb)
             RETURNING *`,
            [
                data.name, data.description ?? null, data.address ?? null, data.city ?? null,
                data.maxGuests ?? 4, data.bedrooms ?? 1, data.bathrooms ?? 1,
                data.nightPrice ?? 0, data.cleaningFee ?? 0, data.currency ?? 'COP',
                data.minNights ?? 1, data.checkInTime ?? '15:00', data.checkOutTime ?? '11:00',
                JSON.stringify(data.amenities || []), data.houseRules || null,
                data.checkInInstructions || null, JSON.stringify(data.images || []),
                JSON.stringify(data.metadata || {}),
            ],
        );
        return rows?.[0];
    }

    async update(schemaName: string, propertyId: string, data: any): Promise<any> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        const fields: Record<string, string> = {
            name: 'name', description: 'description', address: 'address', city: 'city',
            maxGuests: 'max_guests', bedrooms: 'bedrooms', bathrooms: 'bathrooms',
            nightPrice: 'night_price', cleaningFee: 'cleaning_fee', currency: 'currency',
            minNights: 'min_nights', checkInTime: 'check_in_time', checkOutTime: 'check_out_time',
            houseRules: 'house_rules', checkInInstructions: 'check_in_instructions', isActive: 'is_active',
        };

        // La política de confirmación viaja aparte porque se valida: un
        // "anticipo" sin monto le cobraría el total al huésped creyendo el dueño
        // que configuró una seña.
        const policy = validatePaymentPolicyInput(data);
        if (policy.error) throw new BadRequestException(policy.error);
        for (const [dbKey, value] of Object.entries(policy.values)) {
            sets.push(`"${dbKey}" = $${idx}`);
            params.push(value);
            idx++;
        }

        const timeCols = new Set(['check_in_time', 'check_out_time']);
        for (const [jsKey, dbKey] of Object.entries(fields)) {
            if (data[jsKey] !== undefined) {
                const cast = timeCols.has(dbKey) ? '::time' : '';
                sets.push(`"${dbKey}" = $${idx}${cast}`);
                params.push(data[jsKey]);
                idx++;
            }
        }
        if (data.amenities !== undefined) { sets.push(`amenities = $${idx}::jsonb`); params.push(JSON.stringify(data.amenities)); idx++; }
        if (data.images !== undefined) { sets.push(`images = $${idx}::jsonb`); params.push(JSON.stringify(data.images)); idx++; }

        if (sets.length === 0) return this.getById(schemaName, propertyId);

        sets.push(`updated_at = NOW()`);
        params.push(propertyId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE properties SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            params,
        );
        return rows?.[0];
    }

    async delete(schemaName: string, propertyId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE properties SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [propertyId],
        );
    }

    /**
     * Check if a property is available for given dates.
     * Checks both ical_blocks (external) and property_bookings (direct).
     */
    async checkAvailability(
        schemaName: string,
        propertyId: string,
        checkIn: string,
        checkOut: string,
        tenantId?: string,
    ): Promise<any> {
        this.assertUuid(propertyId, 'propertyId');
        const stay = this.validateStayRange(checkIn, checkOut);
        const property = await this.getById(schemaName, propertyId);
        this.assertPropertyBookable(property);
        const sor = await this.resolveSor(tenantId, schemaName, propertyId);

        // Hotel semantics: both persisted and requested ranges are half-open.
        // A departure on D therefore does not conflict with a new arrival on D.
        const conflicts = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT source, check_in, check_out FROM (
                SELECT source, check_in, check_out FROM ical_blocks
                WHERE property_id = $1::uuid AND is_deleted = false
                  AND check_in < $3::date
                  AND CASE WHEN date_range_semantics < 2
                           THEN check_out >= $2::date
                           ELSE check_out > $2::date END
                UNION ALL
                SELECT 'direct' as source, check_in, check_out FROM property_bookings
                WHERE property_id = $1::uuid AND status NOT IN ('cancelled') AND ${holdStillAliveSql()}
                  AND check_in < $3::date AND check_out > $2::date
            ) conflicts LIMIT 1`,
            [propertyId, stay.checkIn, stay.checkOut],
        );

        // A unit bridged to a Channel Manager has a second registry of sold
        // nights. Reading only the local one is how the agent offered a night
        // Hostaway had already sold.
        const externalConflicts = sor.sor === 'channel_manager' && sor.listingId
            ? await this.channelManagerConflicts(schemaName, sor.listingId, stay.checkIn, stay.checkOut)
            : [];

        const totalPrice = Number(property.night_price) * stay.nights + Number(property.cleaning_fee);
        // La política viaja con la disponibilidad porque es lo que el agente
        // necesita ANTES de confirmar: si hay que pagar, no puede decir
        // "confirmada" — tiene que decir que queda pendiente y mandar el enlace.
        const paymentPolicy = resolvePaymentPolicy(property, totalPrice);

        const allConflicts = [...(conflicts || []), ...externalConflicts];

        return {
            available: allConflicts.length === 0,
            conflictSource: allConflicts[0]?.source || null,
            // The agent must be able to say where this answer comes from and
            // how old it is; a Channel Manager mirror is not a live PMS read.
            source: sor.sor === 'channel_manager' ? 'channel_manager' : 'tenant_db',
            asOf: sor.lastSyncedAt || new Date().toISOString(),
            // `unknown` también viaja como vieja. Es la mitad de lectura del
            // mismo defecto: si no se pudo determinar quién administra el
            // calendario, esta respuesta se calculó SÓLO con el registro local
            // y decir `stale: false` la presenta como completa. Puede faltarle
            // justo la noche que el PMS ya vendió.
            stale: sor.sor === 'local' ? false : sor.stale,
            health: sor.health,
            // When the PMS owns the calendar, no conversational writer may
            // close this stay — say so here so the tool never promises it.
            canBookDirectly: localWriterAllowed(sor),
            writerBlockedReason: sor.writerBlockedReason ?? null,
            nightPrice: Number(property.night_price),
            nights: stay.nights,
            cleaningFee: Number(property.cleaning_fee),
            totalPrice,
            currency: property.currency,
            minNights: property.min_nights,
            requiresPaymentToConfirm: paymentPolicy.requiresPayment,
            amountDueToConfirm: paymentPolicy.dueAmount,
            paymentChoice: paymentPolicy.customerChooses ? 'deposit_or_full' : undefined,
            // Los flags le dicen QUÉ pasa; esto le dice CÓMO proceder. Va en
            // texto porque es lo que el modelo obedece: "no la des por
            // confirmada hasta que el pago esté acreditado".
            paymentNote: describePaymentPolicy(paymentPolicy),
        };
    }

    /**
     * Get calendar view for a month — returns array of dates with status.
     */
    async getCalendar(schemaName: string, propertyId: string, month: string): Promise<any[]> {
        this.assertUuid(propertyId, 'propertyId');
        const match = /^(\d{4})-(\d{2})$/.exec(month || '');
        const year = Number(match?.[1]);
        const monthNumber = Number(match?.[2]);
        if (!match || monthNumber < 1 || monthNumber > 12) {
            throw new BadRequestException('month must be valid and use YYYY-MM format');
        }
        const startDate = `${match[1]}-${match[2]}-01`;
        const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
        const nextMonthStart = nextMonthDate.toISOString().slice(0, 10);
        const endDate = new Date(nextMonthDate.getTime() - 86_400_000).toISOString().slice(0, 10);

        // Fetch intervals that overlap the half-open month range.
        const blocks = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, check_in, check_out, source, summary, date_range_semantics,
                    NULL::text as origin FROM ical_blocks
             WHERE property_id = $1::uuid AND is_deleted = false
               AND check_in < $3::date
               AND CASE WHEN date_range_semantics < 2
                        THEN check_out >= $2::date
                        ELSE check_out > $2::date END
             UNION ALL
             SELECT id, check_in, check_out, 'direct' as source, guest_name as summary,
                    2::smallint as date_range_semantics,
                    ${BOOKING_ORIGIN_SQL} as origin
               FROM property_bookings
             WHERE property_id = $1::uuid AND status NOT IN ('cancelled') AND ${holdStillAliveSql()}
               AND check_in < $3::date AND check_out > $2::date`,
            [propertyId, startDate, nextMonthStart],
        );

        // Build day-by-day calendar
        const calendar: any[] = [];
        const start = new Date(`${startDate}T00:00:00.000Z`);
        const end = new Date(`${endDate}T00:00:00.000Z`);

        for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            let status = 'available';
            let source: string | null = null;
            let blockId: string | null = null;
            let summary: string | null = null;
            let origin: string | null = null;

            for (const block of blocks || []) {
                const bIn = new Date(block.check_in).toISOString().split('T')[0];
                const bOut = new Date(block.check_out).toISOString().split('T')[0];
                const occupiesDate = Number(block.date_range_semantics ?? 1) < 2
                    ? dateStr >= bIn && dateStr <= bOut
                    : dateStr >= bIn && dateStr < bOut;
                if (occupiesDate) {
                    status = block.source === 'direct' ? 'booked' : 'blocked';
                    source = block.source;
                    blockId = block.id;
                    summary = block.summary || null;
                    origin = block.origin || null;
                    break;
                }
            }

            calendar.push({ date: dateStr, status, source, blockId, summary, origin });
        }

        return calendar;
    }

    /**
     * Create a manual calendar block. The dashboard selects an inclusive date
     * range (a one-day block sends checkIn === checkOut), so manual rows retain
     * v1 semantics even though bookings and synced iCal events are half-open.
     */
    async createBlock(schemaName: string, propertyId: string, data: { checkIn: string, checkOut: string, summary?: string }): Promise<any> {
        this.assertUuid(propertyId, 'propertyId');
        const checkIn = this.assertDateOnly(data?.checkIn, 'checkIn');
        const inclusiveCheckOut = this.assertDateOnly(data?.checkOut, 'checkOut');
        if (inclusiveCheckOut < checkIn) {
            throw new BadRequestException('checkOut must be on or after checkIn');
        }
        const exclusiveEnd = new Date(`${inclusiveCheckOut}T00:00:00.000Z`);
        exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
        const requestedCheckOut = exclusiveEnd.toISOString().slice(0, 10);

        const externalUid = 'manual-' + Math.random().toString(36).substring(2, 15);
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS lock_acquired`,
                [`${schemaName}:${propertyId}`],
            );
            const propertyRows = await query<any[]>(
                `SELECT * FROM properties WHERE id = $1::uuid FOR UPDATE`,
                [propertyId],
            );
            this.assertPropertyBookable(propertyRows?.[0]);

            const conflicts = await query<any[]>(
                `SELECT source FROM (
                    SELECT source FROM ical_blocks
                     WHERE property_id = $1::uuid AND is_deleted = false
                       AND check_in < $3::date
                       AND CASE WHEN date_range_semantics < 2
                                THEN check_out >= $2::date
                                ELSE check_out > $2::date END
                    UNION ALL
                    SELECT 'direct' AS source FROM property_bookings
                     WHERE property_id = $1::uuid AND status NOT IN ('cancelled') AND ${holdStillAliveSql()}
                       AND check_in < $3::date AND check_out > $2::date
                 ) conflicts LIMIT 1`,
                [propertyId, checkIn, requestedCheckOut],
            );
            if (conflicts?.length) {
                throw new ConflictException({
                    message: 'Property is not available for these dates',
                    conflictSource: conflicts[0].source || 'unknown',
                });
            }

            const rows = await query<any[]>(
                `INSERT INTO ical_blocks
                 (property_id, external_uid, source, check_in, check_out, date_range_semantics, summary)
                 VALUES ($1::uuid, $2, 'Manual', $3::date, $4::date, 1, $5)
                 RETURNING *`,
                [propertyId, externalUid, checkIn, inclusiveCheckOut, data.summary || 'Bloqueo Manual'],
            );
            return rows?.[0];
        });
    }

    /**
     * Delete a calendar block (manual or imported).
     *
     * Imported blocks are legitimately removable — an OTA that stops exporting
     * an event can leave a block stranded — but the next sync re-creates it if
     * the feed still carries the UID, so the UI has to say so.
     */
    async deleteBlock(schemaName: string, blockId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            // No `updated_at` here: ical_blocks never had that column, so the
            // old query raised 42703 and the 500 was swallowed by the dashboard
            // — unblocking silently did nothing for every block, ever.
            `UPDATE ical_blocks SET is_deleted = true WHERE id = $1::uuid`,
            [blockId],
        );
    }

    /**
     * Create a direct booking.
     */
    async createBooking(schemaName: string, propertyId: string, data: any): Promise<any> {
        this.assertUuid(propertyId, 'propertyId');
        if (!data || typeof data !== 'object') {
            throw new BadRequestException('Booking payload is required');
        }

        // Fail closed when the Channel Manager owns this unit. There is no
        // write-back to the PMS yet, so a local row here is a booking the host's
        // real calendar never learns about — a double booking with extra steps.
        // Blocking is the honest outcome until write-back is certified.
        const sor = await this.resolveSor(data.tenantId, schemaName, propertyId);
        if (!localWriterAllowed(sor)) {
            // Se pregunta "¿está permitido?" y no "¿es del channel manager?".
            // La comparación anterior bloqueaba UN estado y dejaba pasar todo
            // lo demás por omisión — incluido el estado que significa "no sé
            // quién administra este calendario", que es el que menos debe pasar.
            const ownershipUnknown = sor.sor === 'unknown';
            throw new ConflictException({
                error: ownershipUnknown ? 'lodging_ownership_unknown' : 'channel_manager_owns_calendar',
                provider: sor.provider,
                asOf: sor.lastSyncedAt ?? null,
                stale: sor.stale,
                message: ownershipUnknown
                    ? 'No pude confirmar la disponibilidad de este alojamiento en este momento. El equipo te confirma la reserva.'
                    : 'Este alojamiento se administra desde el channel manager del negocio. La reserva la confirma el equipo.',
            });
        }
        const contactId = assertOptionalContactId(data.contactId);
        if (data.conversationId != null) this.assertUuid(data.conversationId, 'conversationId');
        const stay = this.validateStayRange(data.checkIn, data.checkOut);
        const guestsCount = data.guestsCount ?? 1;
        if (!Number.isInteger(guestsCount) || guestsCount < 1) {
            throw new BadRequestException('guestsCount must be an integer greater than or equal to 1');
        }

        // Lock, read, conflict check and insert all share one tenant-scoped
        // transaction. Concurrent attempts for the same property serialize on
        // the xact lock; the loser observes the winner before it can insert.
        const created = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const canonicalContactId = await requireTenantContact(query, contactId);

            const opportunityId = await resolveNativeEvidenceOpportunity(query, {
                contactId: canonicalContactId,
                conversationId: data.conversationId,
                trustedOpportunityId: data.opportunityId,
            });
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS lock_acquired`,
                [`${schemaName}:${propertyId}`],
            );

            const propertyRows = await query<any[]>(
                `SELECT * FROM properties WHERE id = $1::uuid FOR UPDATE`,
                [propertyId],
            );
            const property = propertyRows?.[0];

            // Duplicado del MISMO contacto. El chequeo de conflictos de abajo
            // mira la propiedad, no la persona: si el agente reemite la llamada
            // —un reintento, un "sí" repetido— la segunda reserva se solapa con
            // la primera y el conflicto la rechaza… salvo que sean fechas
            // distintas o el modelo proponga otro alojamiento. Tours tiene esta
            // guarda desde hace meses; alojamiento nunca la tuvo.
            //
            // Va DENTRO de la transacción y después del advisory lock, si no dos
            // llamadas simultáneas la esquivan las dos.
            const duplicate = canonicalContactId ? await query<any[]>(
                `SELECT id FROM property_bookings
                  WHERE contact_id = $1::uuid
                    AND property_id = $2::uuid
                    AND check_in = $3::date
                    AND check_out = $4::date
                    AND status NOT IN ('cancelled', 'expired')
                  LIMIT 1`,
                [canonicalContactId, propertyId, stay.checkIn, stay.checkOut],
            ) : [];
            if (duplicate?.length) {
                throw new BadRequestException({
                    error: 'duplicate_property_booking',
                    bookingId: duplicate[0].id,
                    message: 'Este contacto ya tiene una reserva para ese alojamiento y esas fechas.',
                });
            }
            this.assertPropertyBookable(property);

            const minNights = Number(property.min_nights ?? 1);
            if (stay.nights < minNights) {
                throw new BadRequestException(`Stay must be at least ${minNights} night${minNights === 1 ? '' : 's'}`);
            }
            const maxGuests = Number(property.max_guests ?? 1);
            if (guestsCount > maxGuests) {
                throw new BadRequestException(`Property accommodates a maximum of ${maxGuests} guests`);
            }

            const conflicts = await query<any[]>(
                `SELECT source, check_in, check_out FROM (
                    SELECT source, check_in, check_out FROM ical_blocks
                    WHERE property_id = $1::uuid AND is_deleted = false
                      AND check_in < $3::date
                      AND CASE WHEN date_range_semantics < 2
                               THEN check_out >= $2::date
                               ELSE check_out > $2::date END
                    UNION ALL
                    SELECT 'direct' as source, check_in, check_out FROM property_bookings
                    WHERE property_id = $1::uuid AND status NOT IN ('cancelled') AND ${holdStillAliveSql()}
                      AND check_in < $3::date AND check_out > $2::date
                 ) conflicts LIMIT 1`,
                [propertyId, stay.checkIn, stay.checkOut],
            );
            if (conflicts?.length) {
                throw new ConflictException({
                    message: 'Property is not available for these dates',
                    conflictSource: conflicts[0].source || 'unknown',
                });
            }

            const nightPrice = Number(property.night_price ?? 0);
            const cleaningFee = Number(property.cleaning_fee ?? 0);
            const totalPrice = nightPrice * stay.nights + cleaningFee;
            // Si el dueño exige pago para confirmar, la estadía nace pendiente y
            // con las fechas RETENIDAS por 20 minutos mientras el huésped paga.
            // El listener del cobro la confirma, revalidando disponibilidad.
            //
            // La retención es la única forma de que la promesa sea cierta: sin
            // ella el huésped recibía un enlace, pagaba, y podía encontrarse con
            // que las fechas se habían ido mientras pagaba. Vencida la
            // retención el cupo se libera solo, por reloj, sin depender de que
            // ningún proceso corra.
            const policy = resolvePaymentPolicy(property, totalPrice);
            const status = policy.requiresPayment ? PENDING_PAYMENT_STATUS : 'confirmed';
            const holdExpiresAt = policy.requiresPayment
                ? new Date(Date.now() + PAYMENT_HOLD_MS)
                : null;
            // Sólo cuando es un anticipo: el resolvedor de cobros lee esta
            // columna con COALESCE, así que dejarla en NULL cobra el total.
            const amountDue = policy.requiresPayment
                && policy.dueAmount != null
                && policy.dueAmount < totalPrice
                ? policy.dueAmount : null;
            const rows = await query<any[]>(
                `INSERT INTO property_bookings
                 (property_id, contact_id, opportunity_id, conversation_id, guest_name, guest_email, guest_phone,
                  guests_count, check_in, check_out, nights, night_price, cleaning_fee, total_price, currency, status,
                  amount_due, hold_expires_at)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::date, $10::date, $11, $12, $13, $14, $15, $16, $17, $18)
                 RETURNING *`,
                [
                    propertyId,
                    canonicalContactId, opportunityId, data.conversationId || null,
                    data.guestName, data.guestEmail || null, data.guestPhone || null,
                    guestsCount, stay.checkIn, stay.checkOut,
                    stay.nights, nightPrice, cleaningFee, totalPrice, property.currency, status,
                    amountDue, holdExpiresAt,
                ],
            );
            if (!rows?.[0]) throw new Error('Property booking was not created');
            return { booking: rows[0], property, policy };
        });

        const booking = created.booking;
        const property = created.property;
        const totalPrice = Number(booking.total_price ?? 0);
        this.logger.log(`Direct booking created for property ${propertyId}: ${stay.checkIn} to ${stay.checkOut}`);

        // After successful booking insert, try to send confirmation email (fire-and-forget)
        try {
            if (data.guestEmail) {
                // Check if confirmation emails are enabled for properties
                let emailConfirmationsEnabled = true;
                try {
                    const personaRows = await this.prisma.executeInTenantSchema<any[]>(
                        schemaName,
                        `SELECT config_json FROM agent_personas WHERE is_active = true LIMIT 1`,
                        []
                    );
                    if (personaRows && personaRows.length > 0) {
                        const config = personaRows[0].config_json || {};
                        const propertiesTool = config.tools?.properties;
                        if (propertiesTool && propertiesTool.emailConfirmations === false) {
                            emailConfirmationsEnabled = false;
                        }
                    }
                } catch (err) {
                    this.logger.error(`Error checking persona settings for properties: ${err.message}`);
                }

                if (emailConfirmationsEnabled) {
                    // TODO(i18n): this is a guest-facing email — pass the guest's
                    // detected/preferred language as the trailing `lang` arg once
                    // it's captured. Defaults to 'es' (unchanged behaviour).
                    await this.emailTemplates.renderAndSend(schemaName, 'property_booking_confirmation', data.guestEmail, {
                        guest_name: data.guestName || 'Huésped',
                        property_name: property?.name || '',
                        check_in: stay.checkIn,
                        check_out: stay.checkOut,
                        nights: String(stay.nights),
                        total_price: String(totalPrice),
                        currency: booking.currency,
                        check_in_instructions: property?.check_in_instructions || '',
                    });
                }
            }
        } catch (e: any) {
            this.logger.warn(`Booking confirmation email failed: ${e.message}`);
        }

        // La política viaja con la reserva porque quien la lee —la herramienta,
        // y a través de ella el agente— tiene que saber que esto NO está
        // confirmado todavía. Sin esto el agente decía "quedó confirmada" sobre
        // una estadía que nadie pagó y que ni siquiera ocupa la fecha.
        return {
            ...booking,
            awaitingPayment: created.policy.requiresPayment,
            amountDueToConfirm: created.policy.requiresPayment ? created.policy.dueAmount : undefined,
            paymentChoice: created.policy.customerChooses ? 'deposit_or_full' : undefined,
        };
    }

    async cancelBooking(schemaName: string, bookingId: string): Promise<void> {
        this.assertUuid(bookingId, 'bookingId');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE property_bookings
                SET status = 'cancelled', updated_at = NOW()
              WHERE id = $1::uuid
              RETURNING id`,
            [bookingId],
        );
        if (!rows?.length) throw new NotFoundException('Booking not found');
    }

    async listBookings(schemaName: string, propertyId: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT *, ${BOOKING_ORIGIN_SQL} AS origin
               FROM property_bookings WHERE property_id = $1::uuid ORDER BY check_in DESC`,
            [propertyId],
        );
    }

    /**
     * Reservas de TODAS las propiedades (con nombre de propiedad), para la
     * agenda del agente (app móvil): estadías vigentes o futuras, próximas
     * primero. En semántica half-open, una estadía sigue vigente mientras
     * `check_out > fromDate`; el día de salida ya está libre.
     */
    async listUpcomingBookings(schemaName: string, fromDate: string): Promise<any[]> {
        const validFromDate = this.assertDateOnly(fromDate, 'from');
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT b.*, p.name as property_name,
                    CASE WHEN b.conversation_id IS NOT NULL THEN 'agent' ELSE 'manual' END AS origin
               FROM property_bookings b
               LEFT JOIN properties p ON p.id = b.property_id
              WHERE b.status != 'cancelled' AND b.check_out > $1::date
              ORDER BY b.check_in ASC, b.check_out ASC, b.created_at ASC
              LIMIT 200`,
            [validFromDate],
        );
    }

    /**
     * Every stay, across every unit — the register a host actually works from.
     *
     * The only global read was `listUpcomingBookings`, capped at 200 future
     * rows with no filters and no history, and the dashboard never called it.
     * To find a booking a host had to open a property card and then its
     * Reservas tab, which is why the audit could not find one at all — and why
     * an agent, who is not allowed to manage the property catalogue, could not
     * reach a reservation their own conversation had created.
     */
    async listAllBookings(
        schemaName: string,
        filters: {
            status?: string;
            propertyId?: string;
            /** Stays overlapping this window. Half-open, like every other range. */
            from?: string;
            to?: string;
            /** Guest name, email or phone. */
            search?: string;
            limit?: number;
            offset?: number;
        } = {},
    ): Promise<{ bookings: any[]; total: number; limit: number; offset: number }> {
        const conditions: string[] = [];
        const params: any[] = [];

        if (filters.status) {
            const status = String(filters.status).trim().toLowerCase();
            if (!/^[a-z_]{1,30}$/.test(status)) {
                throw new BadRequestException('status must be a simple identifier');
            }
            conditions.push(`b.status = $${params.length + 1}`);
            params.push(status);
        }
        if (filters.propertyId) {
            this.assertUuid(filters.propertyId, 'propertyId');
            conditions.push(`b.property_id = $${params.length + 1}::uuid`);
            params.push(filters.propertyId);
        }
        if (filters.from) {
            const from = this.assertDateOnly(filters.from, 'from');
            conditions.push(`b.check_out > $${params.length + 1}::date`);
            params.push(from);
        }
        if (filters.to) {
            const to = this.assertDateOnly(filters.to, 'to');
            conditions.push(`b.check_in < $${params.length + 1}::date`);
            params.push(to);
        }
        if (filters.search) {
            const term = `%${String(filters.search).trim().slice(0, 80)}%`;
            conditions.push(
                `(b.guest_name ILIKE $${params.length + 1}`
                + ` OR b.guest_email ILIKE $${params.length + 1}`
                + ` OR b.guest_phone ILIKE $${params.length + 1})`,
            );
            params.push(term);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
        const offset = Math.max(Number(filters.offset) || 0, 0);

        const totalRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int AS total FROM property_bookings b ${where}`,
            params,
        );

        const bookings = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT b.*, p.name AS property_name, p.city AS property_city,
                    ${BOOKING_ORIGIN_SQL} AS origin,
                    c.name AS contact_name
               FROM property_bookings b
               LEFT JOIN properties p ON p.id = b.property_id
               LEFT JOIN contacts c ON c.id = b.contact_id
               ${where}
              ORDER BY b.check_in DESC, b.created_at DESC
              LIMIT ${limit} OFFSET ${offset}`,
            params,
        );

        return { bookings, total: Number(totalRows?.[0]?.total ?? 0), limit, offset };
    }
}
