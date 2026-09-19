import 'reflect-metadata';
import { resolveWriteCurrency } from './write-currency.util';
import { RegionalProfileService } from '../../modules/tenants/regional-profile.service';
import { CatalogService } from '../../modules/catalog/catalog.service';
import { EducationService } from '../../modules/education/education.service';
import { GymsService } from '../../modules/gyms/gyms.service';
import { HomeServicesService } from '../../modules/home-services/home-services.service';
import { InventoryService } from '../../modules/inventory/inventory.service';
import { PhotographyService } from '../../modules/photography/photography.service';
import { RestaurantsService } from '../../modules/restaurants/restaurants.service';
import { ToursService } from '../../modules/tours/tours.service';

/**
 * D17 (sep-2026) — la moneda de una fila comercial escrita a mano.
 *
 * Ocho escritores llamaban `normalizeCurrencyCode(data.currency)`, cuyo
 * `fallback` es `'COP'`. Ninguna de sus pantallas manda moneda de forma fiable,
 * así que TODO plato, plan, curso, producto, paquete, sesión y solicitud que un
 * dueño cargaba a mano se guardaba en pesos colombianos estuviera donde
 * estuviera el negocio — y de ahí sale hacia el agente, que se lo dice al
 * cliente sin conversión y sin que nadie lo haya elegido.
 *
 * Lo que fija esta prueba es el ORDEN: lo explícito gana, si no la moneda
 * operativa del negocio, y si tampoco se sabe, NULL. NULL no es lo mismo que
 * omitir la columna: las ocho columnas son `VARCHAR(10) DEFAULT 'COP'`, así que
 * la única forma de no volver a estampar Colombia es pasar el NULL explícito.
 */

const SCHEMA = 'tenant_demo';
const TENANT = '11111111-1111-4111-8111-111111111111';

describe('resolveWriteCurrency — el orden, y dónde se detiene', () => {
    const regional = (value: string | null) => ({ operatingCurrencyFor: jest.fn().mockResolvedValue(value) });

    it('lo explícito gana y ni siquiera consulta al negocio', async () => {
        const source = regional('MXN');
        await expect(resolveWriteCurrency('brl', TENANT, source)).resolves.toBe('BRL');
        expect(source.operatingCurrencyFor).not.toHaveBeenCalled();
    });

    it('sin moneda explícita, la operativa del negocio', async () => {
        const source = regional('MXN');
        await expect(resolveWriteCurrency(undefined, TENANT, source)).resolves.toBe('MXN');
        expect(source.operatingCurrencyFor).toHaveBeenCalledWith(TENANT);
    });

    it('la cadena vacía es "no sé", no un valor', async () => {
        // Es la forma exacta en que llegaba el defecto: la pantalla mandaba
        // `operatingCurrency || ""` y del otro lado `""` volvía a ser COP.
        const source = regional('PEN');
        await expect(resolveWriteCurrency('', TENANT, source)).resolves.toBe('PEN');
    });

    it('si el negocio no declaró dónde opera, NULL — nunca COP', async () => {
        await expect(resolveWriteCurrency('', TENANT, regional(null))).resolves.toBeNull();
    });

    it('sin tenant en alcance, NULL', async () => {
        await expect(resolveWriteCurrency(undefined, undefined, regional('MXN'))).resolves.toBeNull();
    });

    it('sin resolvedor, NULL', async () => {
        await expect(resolveWriteCurrency(undefined, TENANT, undefined)).resolves.toBeNull();
    });

    it('una moneda presente pero mal formada es un error del llamador, no una oportunidad', async () => {
        await expect(resolveWriteCurrency('pesos', TENANT, regional('MXN'))).rejects.toThrow();
    });
});

/**
 * La dependencia tiene que LLEGAR a cada escritor.
 *
 * El parámetro es opcional en la FIRMA para que los fixtures que construyen
 * estos servicios a mano sigan compilando. Si un ciclo de imports borrara el
 * tipo, o el proveedor global desapareciera, cada escritor volvería a resolver
 * NULL para todos y el síntoma sería indistinguible de "este negocio no declaró
 * su país". Sin esta prueba, la regresión se vería como funcionamiento normal.
 */
describe('los ocho escritores conservan el tipo que el contenedor tiene que emparejar', () => {
    it.each([
        ['CatalogService', CatalogService],
        ['EducationService', EducationService],
        ['GymsService', GymsService],
        ['HomeServicesService', HomeServicesService],
        ['InventoryService', InventoryService],
        ['PhotographyService', PhotographyService],
        ['RestaurantsService', RestaurantsService],
        ['ToursService', ToursService],
    ])('%s pide RegionalProfileService', (_name, target) => {
        const params = Reflect.getMetadata('design:paramtypes', target as any) as any[];
        expect(params).toContain(RegionalProfileService);
    });
});

/** `createItem` escribe la moneda como 5º parámetro del INSERT. */
function restaurantSubject(operatingCurrency: string | null | undefined) {
    const calls: Array<{ sql: string; params: any[] }> = [];
    const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params?: any[]): Promise<any[]> => {
        calls.push({ sql, params: params || [] });
        return [{ id: 'row', name: 'Plato', currency: null }];
    });
    const regional = operatingCurrency === undefined
        ? undefined
        : { operatingCurrencyFor: jest.fn().mockResolvedValue(operatingCurrency) };
    const service = new RestaurantsService(
        { executeInTenantSchema } as any, { emit: jest.fn() } as any, undefined, regional as any,
    );
    return { service, calls, regional };
}

const insertedCurrency = (calls: Array<{ sql: string; params: any[] }>) => {
    const insert = calls.find((c) => c.sql.includes('INSERT INTO menu_items'));
    expect(insert).toBeDefined();
    return insert!.params[4];
};

describe('un plato cargado a mano toma la moneda de SU negocio', () => {
    it('usa la moneda operativa cuando el modal no manda ninguna', async () => {
        const { service, calls, regional } = restaurantSubject('MXN');
        await service.createItem(SCHEMA, { name: 'Plato', price: 120 }, TENANT);
        expect(regional!.operatingCurrencyFor).toHaveBeenCalledWith(TENANT);
        expect(insertedCurrency(calls)).toBe('MXN');
    });

    it('escribe NULL —no COP— cuando el negocio no dijo dónde opera', async () => {
        const { service, calls } = restaurantSubject(null);
        await service.createItem(SCHEMA, { name: 'Plato', price: 120 }, TENANT);
        expect(insertedCurrency(calls)).toBeNull();
    });

    it('escribe NULL cuando no hay tenant en alcance', async () => {
        const { service, calls } = restaurantSubject(undefined);
        await service.createItem(SCHEMA, { name: 'Plato', price: 120 });
        expect(insertedCurrency(calls)).toBeNull();
    });

    it('nunca pisa una moneda que el llamador dijo explícitamente', async () => {
        const { service, calls, regional } = restaurantSubject('MXN');
        await service.createItem(SCHEMA, { name: 'Plato', price: 120, currency: 'brl' }, TENANT);
        expect(insertedCurrency(calls)).toBe('BRL');
        expect(regional!.operatingCurrencyFor).not.toHaveBeenCalled();
    });

    it('resuelve igual cuando el editor guarda un plato que ya existía', async () => {
        // La pantalla reenvía el formulario entero, con `currency: ""` cuando el
        // hook contestó "no sé". Sin esta rama, ese `""` volvía a ser COP.
        const { service, calls } = restaurantSubject('PEN');
        await service.updateItem(SCHEMA, '22222222-2222-4222-8222-222222222222', { currency: '' }, TENANT);
        const update = calls.find((c) => c.sql.includes('UPDATE menu_items'));
        expect(update).toBeDefined();
        expect(update!.params).toContain('PEN');
    });
});

/**
 * El producto del panel de inventario es el caso sin pantalla: su modal no
 * manda moneda NUNCA, así que el único escalón que lo salva es el segundo.
 */
describe('un producto cargado a mano toma la moneda de SU negocio', () => {
    function inventorySubject(operatingCurrency: string | null) {
        const calls: Array<{ sql: string; params: any[] }> = [];
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params?: any[]): Promise<any[]> => {
            calls.push({ sql, params: params || [] });
            return [{ id: 'product' }];
        });
        const service = new InventoryService(
            {
                executeInTenantSchema,
                tenant: { findUnique: jest.fn().mockResolvedValue({ schemaName: SCHEMA }) },
            } as any,
            { get: jest.fn(), set: jest.fn() } as any,
            { emit: jest.fn() } as any,
            { operatingCurrencyFor: jest.fn().mockResolvedValue(operatingCurrency) } as any,
        );
        // `getTenantSchema`/`ensureInventoryTables` hablan con PostgreSQL y no
        // son lo que esta prueba mide.
        (service as any).getTenantSchema = jest.fn().mockResolvedValue(SCHEMA);
        (service as any).ensureInventoryTables = jest.fn().mockResolvedValue(undefined);
        return { service, calls };
    }

    const productCurrency = (calls: Array<{ sql: string; params: any[] }>) => {
        const insert = calls.find((c) => c.sql.includes('INSERT INTO products'));
        expect(insert).toBeDefined();
        return insert!.params[4];
    };

    it('toma la operativa aunque el modal no la mande', async () => {
        const { service, calls } = inventorySubject('CLP');
        await service.createProduct(TENANT, { name: 'Jarabe', sku: 'J-1', price: 12000, stock: 3 });
        expect(productCurrency(calls)).toBe('CLP');
    });

    it('deja NULL cuando no se sabe, en vez de pesos colombianos', async () => {
        const { service, calls } = inventorySubject(null);
        await service.createProduct(TENANT, { name: 'Jarabe', sku: 'J-1', price: 12000, stock: 3 });
        expect(productCurrency(calls)).toBeNull();
    });
});
