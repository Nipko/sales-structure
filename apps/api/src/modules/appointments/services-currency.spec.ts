import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ServicesService } from './services.service';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * D17 (sep-2026) — la moneda de un servicio creado a mano.
 *
 * El modal del panel no manda `currency`. Nunca lo mandó. Del otro lado,
 * `normalizeCurrencyCode(data.currency)` tenía `fallback = 'COP'`, así que TODO
 * servicio que un dueño escribía a mano se guardaba en pesos colombianos
 * estuviera donde estuviera el negocio — y de ahí salía hacia el agente, que se
 * lo decía al cliente.
 *
 * Lo que fija esta prueba es el orden: lo explícito gana, si no la moneda
 * operativa del negocio, y si tampoco se sabe, NULL. NULL no es lo mismo que
 * omitir la columna: `services.currency` tiene `DEFAULT 'COP'`, así que la
 * única forma de no volver a estampar Colombia es pasar el NULL explícito.
 */

const SCHEMA = 'tenant_demo';
const TENANT = '11111111-1111-4111-8111-111111111111';

const ROW = {
    id: '22222222-2222-4222-8222-222222222222', name: 'Consulta', description: null,
    duration_minutes: 30, duration_minutes_max: null, duration_type: 'fixed', buffer_minutes: 0,
    price: '800', currency: null, color: '#6c5ce7', is_active: true, sort_order: 0, category: null,
    max_concurrent: 1, rebook_after_days: null, required_fields: [], payment_policy: 'none',
    deposit_percent: null, deposit_amount: null, price_status: 'confirmed',
};

/** `operatingCurrencyFor` es lo único que este servicio le pide al perfil regional. */
function subject(operatingCurrency: string | null | undefined) {
    const inserts: Array<{ sql: string; params: any[] }> = [];
    const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params?: any[]): Promise<any[]> => {
        if (sql.startsWith('SELECT * FROM services WHERE id')) return [ROW];
        inserts.push({ sql, params: params || [] });
        return [];
    });
    const redis = { del: jest.fn().mockResolvedValue(undefined) };
    const events = { emit: jest.fn() };
    const regional = operatingCurrency === undefined
        ? undefined
        : { operatingCurrencyFor: jest.fn().mockResolvedValue(operatingCurrency) };
    const service = new ServicesService(
        { executeInTenantSchema } as any, redis as any, events as any, regional as any,
    );
    return { service, inserts, regional };
}

/** La moneda es el 7º parámetro del INSERT de `create`. */
const insertedCurrency = (inserts: Array<{ sql: string; params: any[] }>) => {
    const insert = inserts.find((i) => i.sql.includes('INSERT INTO services'));
    expect(insert).toBeDefined();
    return insert!.params[6];
};

describe('a hand-made service takes the currency of ITS business', () => {
    it('uses the operating currency when the modal sends none', async () => {
        const { service, inserts, regional } = subject('MXN');
        await service.create(SCHEMA, { name: 'Consulta', price: 800 }, TENANT);
        expect(regional!.operatingCurrencyFor).toHaveBeenCalledWith(TENANT);
        expect(insertedCurrency(inserts)).toBe('MXN');
    });

    it('writes NULL — not COP — when the business has not said where it operates', async () => {
        const { service, inserts } = subject(null);
        await service.create(SCHEMA, { name: 'Consulta', price: 800 }, TENANT);
        expect(insertedCurrency(inserts)).toBeNull();
    });

    it('writes NULL when there is no tenant in scope at all', async () => {
        const { service, inserts } = subject(undefined);
        await service.create(SCHEMA, { name: 'Consulta', price: 800 });
        expect(insertedCurrency(inserts)).toBeNull();
    });

    it('never overrides a currency the caller stated explicitly', async () => {
        const { service, inserts, regional } = subject('MXN');
        await service.create(SCHEMA, { name: 'Consulta', price: 800, currency: 'brl' }, TENANT);
        expect(insertedCurrency(inserts)).toBe('BRL');
        expect(regional!.operatingCurrencyFor).not.toHaveBeenCalled();
    });

    it('resolves the same way when the editor saves an existing service', async () => {
        const { service, inserts } = subject('PEN');
        await service.update(SCHEMA, ROW.id, { currency: '' }, TENANT);
        const update = inserts.find((i) => i.sql.includes('UPDATE services'));
        expect(update).toBeDefined();
        expect(update!.params).toContain('PEN');
    });

    it('reads a row with no currency as null, never as a code', async () => {
        const { service } = subject('PEN');
        const row = await service.getById(SCHEMA, ROW.id);
        expect(row.currency).toBeNull();
    });
});

/**
 * La dependencia opcional tiene que LLEGAR.
 *
 * `@Optional()` es cómodo y silencioso: si el tipo se borrara por un ciclo de
 * imports, o el proveedor dejara de estar en el contenedor, Nest inyectaría
 * `undefined`, `resolveWriteCurrency` devolvería NULL para todos y el síntoma
 * sería idéntico a "este negocio no declaró su país". Sin esta prueba, la
 * regresión se vería como funcionamiento normal.
 */
describe('the currency resolver is actually wired, not silently absent', () => {
    it('keeps the constructor type intact for the container to match', () => {
        const params = Reflect.getMetadata('design:paramtypes', ServicesService) as any[];
        expect(params[3]).toBe(RegionalProfileService);
    });

    it('resolves the regional profile out of the container', async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                ServicesService,
                { provide: PrismaService, useValue: { executeInTenantSchema: jest.fn() } },
                { provide: RedisService, useValue: { del: jest.fn() } },
                { provide: EventEmitter2, useValue: { emit: jest.fn() } },
                { provide: RegionalProfileService, useValue: { operatingCurrencyFor: jest.fn().mockResolvedValue('CLP') } },
            ],
        }).compile();

        const service = moduleRef.get(ServicesService);
        expect((service as any).regional).toBeDefined();
        await expect((service as any).resolveWriteCurrency(undefined, TENANT)).resolves.toBe('CLP');
    });
});
