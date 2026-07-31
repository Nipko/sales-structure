import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

@Injectable()
export class VehicleInventoryService {
    private readonly logger = new Logger(VehicleInventoryService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
    ) {}

    async ensureTables(schemaName: string): Promise<void> {
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

    async listVehicles(schemaName: string, filters?: {
        status?: string; make?: string; category?: string;
        minPrice?: number; maxPrice?: number; condition?: string;
        limit?: number; offset?: number;
    }): Promise<{ items: any[]; total: number }> {
        await this.ensureTables(schemaName);

        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (filters?.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
        if (filters?.make) { conditions.push(`make ILIKE $${idx++}`); params.push(`%${filters.make}%`); }
        if (filters?.category) { conditions.push(`category = $${idx++}`); params.push(filters.category); }
        if (filters?.condition) { conditions.push(`condition = $${idx++}`); params.push(filters.condition); }
        if (filters?.minPrice) { conditions.push(`price_cents >= $${idx++}`); params.push(filters.minPrice); }
        if (filters?.maxPrice) { conditions.push(`price_cents <= $${idx++}`); params.push(filters.maxPrice); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = filters?.limit || 50;
        const offset = filters?.offset || 0;

        const countParams = [...params];
        const countResult: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int as total FROM "${schemaName}".vehicles ${where}`,
            ...countParams,
        );

        params.push(limit, offset);
        const items: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT * FROM "${schemaName}".vehicles ${where}
             ORDER BY is_featured DESC, created_at DESC
             LIMIT $${idx++} OFFSET $${idx++}`,
            ...params,
        );

        return { items, total: countResult[0]?.total || 0 };
    }

    async getVehicle(schemaName: string, vehicleId: string): Promise<any> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT * FROM "${schemaName}".vehicles WHERE id = $1::uuid`,
            vehicleId,
        );
        if (!rows.length) throw new NotFoundException('Vehicle not found');
        return rows[0];
    }

    async createVehicle(tenantId: string, schemaName: string, data: {
        make: string; model: string; year: number; trimLevel?: string;
        vin?: string; licensePlate?: string; color?: string;
        fuelType?: string; transmission?: string; mileageKm?: number;
        condition?: string; priceCents: number; currency?: string;
        category?: string; features?: string[]; photos?: string[];
        description?: string; location?: string; isFeatured?: boolean;
    }): Promise<any> {
        await this.ensureTables(schemaName);

        // El gate del plan ahora es por CANTIDAD, no por bandera. Antes
        // vehicleInventory=false apagaba el controller entero en emprendedor y
        // starter: el trial recibia un 403 crudo al cargar su primer auto y la
        // vertical nacia muerta. Mismo patron que tours/propiedades.
        // Solo cuentan los vehiculos vivos: uno vendido y archivado no debe
        // seguir ocupando cupo.
        const used: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS cnt FROM "${schemaName}".vehicles WHERE status <> 'sold'`,
        );
        await this.throttle.enforcePlanLimit(tenantId, 'maxVehicles', used?.[0]?.cnt || 0, 'vehículos');

        const rows: any[] = await this.prisma.$queryRawUnsafe(`
            INSERT INTO "${schemaName}".vehicles (
                make, model, year, trim_level, vin, license_plate, color,
                fuel_type, transmission, mileage_km, condition, price_cents,
                currency, category, features, photos, description, location, is_featured
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::text[], $16::text[], $17, $18, $19)
            RETURNING *
        `,
            data.make, data.model, data.year, data.trimLevel || null,
            data.vin || null, data.licensePlate || null, data.color || null,
            data.fuelType || 'gasoline', data.transmission || 'automatic',
            data.mileageKm || 0, data.condition || 'new', data.priceCents,
            data.currency || 'COP', data.category || 'sedan',
            data.features || [], data.photos || [],
            data.description || null, data.location || null, data.isFeatured ?? false,
        );
        return rows[0];
    }

    async updateVehicle(schemaName: string, vehicleId: string, data: Record<string, any>): Promise<any> {
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

        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `UPDATE "${schemaName}".vehicles SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            ...params,
        );
        if (!rows.length) throw new NotFoundException('Vehicle not found');
        return rows[0];
    }

    async markSold(schemaName: string, vehicleId: string, soldPriceCents: number, buyerContactId?: string): Promise<any> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(`
            UPDATE "${schemaName}".vehicles
            SET status = 'sold', sold_at = CURRENT_DATE, sold_price_cents = $2, buyer_contact_id = $3::uuid, updated_at = now()
            WHERE id = $1::uuid
            RETURNING *
        `, vehicleId, soldPriceCents, buyerContactId || null);
        if (!rows.length) throw new NotFoundException('Vehicle not found');
        return rows[0];
    }

    async getInventoryStats(schemaName: string): Promise<any> {
        await this.ensureTables(schemaName);
        const rows: any[] = await this.prisma.$queryRawUnsafe(`
            SELECT
                COUNT(*)::int as total,
                COUNT(*) FILTER (WHERE status = 'available')::int as available,
                COUNT(*) FILTER (WHERE status = 'reserved')::int as reserved,
                COUNT(*) FILTER (WHERE status = 'sold')::int as sold,
                COUNT(*) FILTER (WHERE status = 'maintenance')::int as maintenance,
                COALESCE(AVG(price_cents) FILTER (WHERE status = 'available'), 0)::int as avg_price_cents,
                COUNT(DISTINCT make)::int as brands
            FROM "${schemaName}".vehicles
        `);
        return rows[0];
    }

    async scheduleTestDrive(schemaName: string, data: {
        vehicleId: string; contactName: string; contactPhone?: string;
        scheduledDate: string; scheduledTime: string; notes?: string;
    }): Promise<any> {
        await this.ensureTables(schemaName);

        const conflict: any[] = await this.prisma.$queryRawUnsafe(`
            SELECT 1 FROM "${schemaName}".test_drives
            WHERE vehicle_id = $1::uuid AND scheduled_date = $2::date AND scheduled_time = $3::time
            AND status NOT IN ('cancelled', 'completed')
        `, data.vehicleId, data.scheduledDate, data.scheduledTime);

        if (conflict.length > 0) throw new BadRequestException('Test drive slot already booked');

        const rows: any[] = await this.prisma.$queryRawUnsafe(`
            INSERT INTO "${schemaName}".test_drives (vehicle_id, contact_name, contact_phone, scheduled_date, scheduled_time, notes)
            VALUES ($1::uuid, $2, $3, $4::date, $5::time, $6)
            RETURNING *
        `, data.vehicleId, data.contactName, data.contactPhone || null,
           data.scheduledDate, data.scheduledTime, data.notes || null);
        return rows[0];
    }

    async listTestDrives(schemaName: string, filters?: { vehicleId?: string; status?: string; date?: string }): Promise<any[]> {
        await this.ensureTables(schemaName);
        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (filters?.vehicleId) { conditions.push(`td.vehicle_id = $${idx++}::uuid`); params.push(filters.vehicleId); }
        if (filters?.status) { conditions.push(`td.status = $${idx++}`); params.push(filters.status); }
        if (filters?.date) { conditions.push(`td.scheduled_date = $${idx++}::date`); params.push(filters.date); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return this.prisma.$queryRawUnsafe(`
            SELECT td.*, v.make, v.model, v.year, v.color
            FROM "${schemaName}".test_drives td
            JOIN "${schemaName}".vehicles v ON v.id = td.vehicle_id
            ${where}
            ORDER BY td.scheduled_date, td.scheduled_time
        `, ...params);
    }

    async searchVehiclesForAI(schemaName: string, query: {
        make?: string; budgetMax?: number; category?: string;
        fuelType?: string; condition?: string; year?: number;
    }): Promise<any[]> {
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

        return this.prisma.$queryRawUnsafe(`
            SELECT id, make, model, year, trim_level, color, fuel_type, transmission,
                   mileage_km, condition, price_cents, currency, category, features, photos[1] as photo
            FROM "${schemaName}".vehicles
            WHERE ${conditions.join(' AND ')}
            ORDER BY is_featured DESC, price_cents ASC
            LIMIT 10
        `, ...params);
    }
}
