import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { APPOINTMENT_SERVICE_TERMS_COLUMNS, appointmentServiceTerms } from '../appointments/appointment-service-terms';
import { vehicleAppointmentTerms, VehicleAppointmentError } from '../appointments/vehicle-appointment-capacity';
import { ScheduleTestDriveDto } from './schedule-test-drive.dto';

@Injectable()
export class VehicleInventoryService {
    private readonly logger = new Logger(VehicleInventoryService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
        @Inject(forwardRef(() => AppointmentsService)) private readonly appointments: AppointmentsService,
    ) {}

    /**
     * Takes an already-resolved schema name because the DDL below interpolates
     * it by hand: CREATE TABLE / REFERENCES cannot run through the search_path
     * helper. The assertion is the only thing standing between a caller that
     * confuses tenantId with schema name and a raw Postgres 3F000.
     */
    async ensureTables(schemaName: string): Promise<void> {
        this.prisma.assertTenantSchemaName(schemaName);

        const exists: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'vehicles'`,
            schemaName,
        );
        if (exists.length > 0) return;

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".vehicles (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                make TEXT NOT NULL,
                model TEXT NOT NULL,
                year INT NOT NULL,
                trim_level TEXT,
                vin TEXT,
                license_plate TEXT,
                color TEXT,
                fuel_type TEXT DEFAULT 'gasoline',
                transmission TEXT DEFAULT 'automatic',
                mileage_km INT DEFAULT 0,
                condition TEXT DEFAULT 'new',
                price_cents INT NOT NULL,
                currency TEXT DEFAULT 'COP',
                status TEXT DEFAULT 'available',
                category TEXT DEFAULT 'sedan',
                features TEXT[] DEFAULT '{}',
                photos TEXT[] DEFAULT '{}',
                description TEXT,
                location TEXT,
                is_featured BOOLEAN DEFAULT false,
                acquired_at DATE,
                sold_at DATE,
                sold_price_cents INT,
                buyer_contact_id UUID,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        `);

        await this.prisma.$queryRawUnsafe(`
            CREATE INDEX IF NOT EXISTS idx_vehicles_status ON "${schemaName}".vehicles(status)
        `);

        await this.prisma.$queryRawUnsafe(`
            CREATE INDEX IF NOT EXISTS idx_vehicles_make_model ON "${schemaName}".vehicles(make, model)
        `);

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".vehicle_inquiries (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                vehicle_id UUID NOT NULL REFERENCES "${schemaName}".vehicles(id) ON DELETE CASCADE,
                contact_id UUID,
                contact_name TEXT,
                contact_phone TEXT,
                contact_email TEXT,
                inquiry_type TEXT DEFAULT 'info',
                notes TEXT,
                status TEXT DEFAULT 'new',
                assigned_to UUID,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        `);

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".test_drives (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                vehicle_id UUID NOT NULL REFERENCES "${schemaName}".vehicles(id) ON DELETE CASCADE,
                contact_id UUID,
                contact_name TEXT NOT NULL,
                contact_phone TEXT,
                scheduled_date DATE NOT NULL,
                scheduled_time TIME NOT NULL,
                duration_min INT DEFAULT 30,
                status TEXT DEFAULT 'scheduled',
                notes TEXT,
                assigned_to UUID,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        `);

        this.logger.log(`Vehicle inventory tables created for schema ${schemaName}`);
    }

    async listVehicles(tenantId: string, filters?: {
        status?: string; search?: string; make?: string; category?: string;
        minPrice?: number; maxPrice?: number; condition?: string;
        limit?: number; offset?: number;
    }): Promise<{ items: any[]; total: number }> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);

        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (filters?.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
        if (filters?.search) {
            conditions.push(`(
                make ILIKE $${idx}
                OR model ILIKE $${idx}
                OR COALESCE(license_plate, '') ILIKE $${idx}
                OR COALESCE(vin, '') ILIKE $${idx}
                OR year::text ILIKE $${idx}
            )`);
            params.push(`%${filters.search.trim()}%`);
            idx++;
        }
        if (filters?.make) { conditions.push(`make ILIKE $${idx++}`); params.push(`%${filters.make}%`); }
        if (filters?.category) { conditions.push(`category = $${idx++}`); params.push(filters.category); }
        if (filters?.condition) { conditions.push(`condition = $${idx++}`); params.push(filters.condition); }
        if (filters?.minPrice) { conditions.push(`price_cents >= $${idx++}`); params.push(filters.minPrice); }
        if (filters?.maxPrice) { conditions.push(`price_cents <= $${idx++}`); params.push(filters.maxPrice); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const requestedLimit = filters?.limit ?? 50;
        const requestedOffset = filters?.offset ?? 0;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new BadRequestException('limit must be a positive integer');
        }
        if (!Number.isInteger(requestedOffset) || requestedOffset < 0) {
            throw new BadRequestException('offset must be a non-negative integer');
        }
        const limit = Math.min(requestedLimit, 100);
        const offset = requestedOffset;

        const countParams = [...params];
        const countResult = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int as total FROM vehicles ${where}`,
            countParams,
        );

        params.push(limit, offset);
        const items = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM vehicles ${where}
             ORDER BY is_featured DESC, created_at DESC
             LIMIT $${idx++} OFFSET $${idx++}`,
            params,
        );

        return { items, total: countResult[0]?.total || 0 };
    }

    async getVehicle(tenantId: string, vehicleId: string): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM vehicles WHERE id = $1::uuid`,
            [vehicleId],
        );
        if (!rows.length) throw new NotFoundException('Vehicle not found');
        return rows[0];
    }

    async createVehicle(tenantId: string, data: {
        make: string; model: string; year: number; trimLevel?: string;
        vin?: string; licensePlate?: string; color?: string;
        fuelType?: string; transmission?: string; mileageKm?: number;
        condition?: string; priceCents: number; currency?: string;
        category?: string; features?: string[]; photos?: string[];
        description?: string; location?: string; isFeatured?: boolean;
    }): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);

        // El gate del plan ahora es por CANTIDAD, no por bandera. Antes
        // vehicleInventory=false apagaba el controller entero en emprendedor y
        // starter: el trial recibia un 403 crudo al cargar su primer auto y la
        // vertical nacia muerta. Mismo patron que tours/propiedades.
        // Solo cuentan los vehiculos vivos: uno vendido y archivado no debe
        // seguir ocupando cupo.
        const used = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int AS cnt FROM vehicles WHERE status <> 'sold'`,
        );
        await this.throttle.enforcePlanLimit(tenantId, 'maxVehicles', used?.[0]?.cnt || 0, 'vehículos');

        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName, `
            INSERT INTO vehicles (
                make, model, year, trim_level, vin, license_plate, color,
                fuel_type, transmission, mileage_km, condition, price_cents,
                currency, category, features, photos, description, location, is_featured
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::text[], $16::text[], $17, $18, $19)
            RETURNING *
        `, [
            data.make, data.model, data.year, data.trimLevel || null,
            data.vin || null, data.licensePlate || null, data.color || null,
            data.fuelType || 'gasoline', data.transmission || 'automatic',
            data.mileageKm || 0, data.condition || 'new', data.priceCents,
            data.currency || 'COP', data.category || 'sedan',
            data.features || [], data.photos || [],
            data.description || null, data.location || null, data.isFeatured ?? false,
        ]);
        return rows[0];
    }

    async updateVehicle(tenantId: string, vehicleId: string, data: Record<string, any>): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const fieldMap: Record<string, string> = {
            make: 'make', model: 'model', year: 'year', trimLevel: 'trim_level',
            vin: 'vin', licensePlate: 'license_plate', color: 'color',
            fuelType: 'fuel_type', transmission: 'transmission', mileageKm: 'mileage_km',
            condition: 'condition', priceCents: 'price_cents', currency: 'currency',
            status: 'status', category: 'category', description: 'description',
            location: 'location', isFeatured: 'is_featured',
        };

        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        for (const [key, col] of Object.entries(fieldMap)) {
            if (data[key] !== undefined) {
                sets.push(`${col} = $${idx++}`);
                params.push(data[key]);
            }
        }
        if (data.features !== undefined) { sets.push(`features = $${idx++}::text[]`); params.push(data.features); }
        if (data.photos !== undefined) { sets.push(`photos = $${idx++}::text[]`); params.push(data.photos); }

        if (!sets.length) throw new BadRequestException('No fields to update');
        sets.push('updated_at = now()');
        params.push(vehicleId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE vehicles SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            params,
        );
        if (!rows.length) throw new NotFoundException('Vehicle not found');
        return rows[0];
    }

    async markSold(tenantId: string, vehicleId: string, soldPriceCents: number, buyerContactId?: string): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName, `
            UPDATE vehicles
            SET status = 'sold', sold_at = CURRENT_DATE, sold_price_cents = $2, buyer_contact_id = $3::uuid, updated_at = now()
            WHERE id = $1::uuid
            RETURNING *
        `, [vehicleId, soldPriceCents, buyerContactId || null]);
        if (!rows.length) throw new NotFoundException('Vehicle not found');
        return rows[0];
    }

    async getInventoryStats(tenantId: string): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName, `
            SELECT
                COUNT(*)::int as total,
                COUNT(*) FILTER (WHERE status = 'available')::int as available,
                COUNT(*) FILTER (WHERE status = 'reserved')::int as reserved,
                COUNT(*) FILTER (WHERE status = 'sold')::int as sold,
                COUNT(*) FILTER (WHERE status = 'maintenance')::int as maintenance,
                COALESCE(AVG(price_cents) FILTER (WHERE status = 'available'), 0)::int as avg_price_cents,
                COUNT(DISTINCT make)::int as brands
            FROM vehicles
        `);
        return rows[0];
    }

    async scheduleTestDrive(tenantId: string, data: ScheduleTestDriveDto): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
        if (![data.vehicleId, data.contactId, data.serviceId, data.staffId, data.requestKey].every(id => typeof id === 'string' && uuid.test(id))) {
            throw new BadRequestException({ error: 'test_drive_identity_required' });
        }
        const [service] = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT ${APPOINTMENT_SERVICE_TERMS_COLUMNS} FROM services WHERE id=$1::uuid AND is_active=true`, [data.serviceId]);
        if (!service || (service.duration_type || 'fixed') !== 'fixed' || !['in_person', 'hybrid'].includes(service.location_type || 'in_person')
            || !Number.isInteger(Number(service.duration_minutes)) || Number(service.duration_minutes) < 1 || Number(service.duration_minutes) > 1440) {
            throw new BadRequestException({ error: 'test_drive_service_contract_required' });
        }
        const [vehicle] = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            'SELECT id,make,model,year,trim_level,vin,license_plate,status FROM vehicles WHERE id=$1::uuid', [data.vehicleId]);
        let terms: ReturnType<typeof vehicleAppointmentTerms>;
        try { terms = vehicleAppointmentTerms(vehicle); }
        catch (error) {
            if (error instanceof VehicleAppointmentError) throw new BadRequestException({ error: error.vehicleCode });
            throw error;
        }
        const startAt = `${data.scheduledDate}T${data.scheduledTime}:00`;
        const start = Date.parse(`${startAt}Z`);
        if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 19) !== startAt) {
            throw new BadRequestException({ error: 'invalid_test_drive_time' });
        }
        // UTC arithmetic preserves the local wall clock; create validates the tenant timezone.
        const endAt = new Date(start + Number(service.duration_minutes) * 60_000).toISOString().slice(0, 19);
        return this.appointments.create(schemaName, {
            contactId: data.contactId, conversationId: data.conversationId, serviceId: data.serviceId,
            serviceName: service.name, assignedTo: data.staffId, startAt, endAt,
            customerName: data.contactName, customerPhone: data.contactPhone, customerEmail: data.contactEmail,
            notes: data.notes, metadata: { vehicleId: data.vehicleId }, source: 'manual',
        }, { vehicleRequestKey: data.requestKey, expectedServiceTerms: appointmentServiceTerms(service), expectedVehicleTerms: terms });
    }

    async listTestDrives(tenantId: string, filters?: { vehicleId?: string; status?: string; date?: string }): Promise<any[]> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (filters?.vehicleId) { conditions.push(`td.vehicle_id = $${idx++}::uuid::text`); params.push(filters.vehicleId); }
        if (filters?.status) { conditions.push(`td.status = $${idx++}`); params.push(filters.status); }
        if (filters?.date) { conditions.push(`td.scheduled_date = $${idx++}::date`); params.push(filters.date); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const [legacyTable] = await this.prisma.executeInTenantSchema<any[]>(schemaName, "SELECT to_regclass('test_drives')::text AS name");
        const legacy = legacyTable?.name ? `UNION ALL
            SELECT id, vehicle_id::text, contact_name, contact_phone, scheduled_date, scheduled_time,
                status, notes, 'legacy'::text AS source, NULL::uuid AS appointment_id FROM test_drives` : '';
        return this.prisma.executeInTenantSchema<any[]>(schemaName, `
            SELECT td.id, td.vehicle_id, td.contact_name, td.contact_phone,
                to_char(td.scheduled_date,'YYYY-MM-DD') AS scheduled_date,
                td.scheduled_time::text AS scheduled_time, td.status, td.notes, td.source, td.appointment_id,
                v.make, v.model, v.year, v.color
            FROM (
                SELECT id, COALESCE(metadata->>'vehicleId',metadata->>'vehicle_id') AS vehicle_id,
                    customer_name AS contact_name, customer_phone AS contact_phone,
                    start_at::date AS scheduled_date, start_at::time AS scheduled_time,
                    status, notes, 'appointment'::text AS source, id AS appointment_id
                FROM appointments WHERE metadata ? 'vehicleId' OR metadata ? 'vehicle_id'
                ${legacy}
            ) td
            LEFT JOIN vehicles v ON v.id::text = td.vehicle_id
            ${where}
            ORDER BY td.scheduled_date DESC, td.scheduled_time DESC, td.id
            LIMIT 100
        `, params);
    }

    async searchVehiclesForAI(tenantId: string, query: {
        make?: string; budgetMax?: number; category?: string;
        fuelType?: string; condition?: string; year?: number;
    }): Promise<any[]> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const conditions: string[] = [`status = 'available'`];
        const params: any[] = [];
        let idx = 1;

        if (query.make) { conditions.push(`make ILIKE $${idx++}`); params.push(`%${query.make}%`); }
        if (query.budgetMax) { conditions.push(`price_cents <= $${idx++}`); params.push(query.budgetMax); }
        if (query.category) { conditions.push(`category = $${idx++}`); params.push(query.category); }
        if (query.fuelType) { conditions.push(`fuel_type = $${idx++}`); params.push(query.fuelType); }
        if (query.condition) { conditions.push(`condition = $${idx++}`); params.push(query.condition); }
        if (query.year) { conditions.push(`year >= $${idx++}`); params.push(query.year); }

        return this.prisma.executeInTenantSchema<any[]>(schemaName, `
            SELECT id, make, model, year, trim_level, color, fuel_type, transmission,
                   mileage_km, condition, price_cents, currency, category, features, photos[1] as photo
            FROM vehicles
            WHERE ${conditions.join(' AND ')}
            ORDER BY is_featured DESC, price_cents ASC
            LIMIT 10
        `, params);
    }
}
