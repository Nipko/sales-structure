import { ConflictException } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import {
    LodgingSourceOfTruthService,
    localWriterAllowed,
} from '../channel-manager/lodging-source-of-truth.service';

/**
 * Dos registros vendían las mismas noches.
 *
 * El agente leía y escribía `properties`/`property_bookings`; Channel Manager
 * mantenía `cm_listings`/`cm_reservations` alimentado desde Hostaway. No había
 * puente ni write-back: una reserva de Hostaway era invisible para el agente y
 * una reserva del agente nunca llegaba al PMS. Los dos podían vender la misma
 * noche.
 *
 * La regla es asimétrica a propósito, porque el peligro está en la escritura:
 * las lecturas SUMAN el espejo del channel manager, y el writer local se apaga
 * cuando el PMS es dueño del calendario.
 */

const schemaName = 'tenant_lodging';
const tenantId = '11111111-1111-4111-8111-111111111111';
const PROPERTY_ID = 'a36c1e0c-c71b-4837-8f30-048e94bba421';
const LISTING_ID = 'b36c1e0c-c71b-4837-8f30-048e94bba422';

const PROPERTY_ROW = {
    id: PROPERTY_ID,
    name: 'Amazon Minimalist',
    is_active: true,
    night_price: '200000',
    cleaning_fee: '50000',
    currency: 'COP',
    min_nights: 1,
    max_guests: 4,
};

function buildService(sorResolution: any, queries: any[] = []) {
    const executeInTenantSchema = jest.fn();
    // getById → property row; then the conflict UNION; then cm_reservations.
    executeInTenantSchema.mockResolvedValueOnce([PROPERTY_ROW]);
    for (const value of queries) executeInTenantSchema.mockResolvedValueOnce(value);
    executeInTenantSchema.mockResolvedValue([]);

    const lodgingSor = {
        resolveForProperty: jest.fn().mockResolvedValue(sorResolution),
        invalidate: jest.fn(),
    } as unknown as LodgingSourceOfTruthService;

    const service = new PropertiesService(
        { executeInTenantSchema, transactionInTenantSchema: jest.fn() } as any,
        {} as any,
        {} as any,
        lodgingSor,
    );
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    return { service, executeInTenantSchema, lodgingSor };
}

const LOCAL: any = { sor: 'local', connected: false, stale: false, health: 'unknown' };
const CM_OWNED: any = {
    sor: 'channel_manager',
    connected: true,
    provider: 'hostaway',
    listingId: LISTING_ID,
    lastSyncedAt: new Date().toISOString(),
    stale: false,
    health: 'healthy',
    writerBlockedReason: 'channel_manager_owns_calendar',
};

describe('la disponibilidad suma los dos registros', () => {
    it('un alojamiento propio no consulta el espejo del channel manager', async () => {
        const { service, executeInTenantSchema } = buildService(LOCAL, [[]]);

        const result: any = await service.checkAvailability(
            schemaName, PROPERTY_ID, '2026-09-01', '2026-09-05', tenantId,
        );

        expect(result.available).toBe(true);
        expect(result.canBookDirectly).toBe(true);
        expect(result.source).toBe('tenant_db');
        const sqls = executeInTenantSchema.mock.calls.map(c => String(c[1]));
        expect(sqls.some(sql => /cm_reservations/i.test(sql))).toBe(false);
    });

    it('una noche vendida en Hostaway bloquea la disponibilidad local', async () => {
        const { service } = buildService(CM_OWNED, [
            [], // sin conflictos locales
            [{ source: 'airbnb', check_in: '2026-09-02', check_out: '2026-09-04' }],
        ]);

        const result: any = await service.checkAvailability(
            schemaName, PROPERTY_ID, '2026-09-01', '2026-09-05', tenantId,
        );

        expect(result.available).toBe(false);
        expect(result.conflictSource).toBe('airbnb');
        expect(result.source).toBe('channel_manager');
    });

    it('un espejo ilegible NO se interpreta como calendario libre', async () => {
        const executeInTenantSchema = jest.fn()
            .mockResolvedValueOnce([PROPERTY_ROW])   // getById
            .mockResolvedValueOnce([])               // conflictos locales
            .mockRejectedValueOnce(new Error('relation "cm_reservations" does not exist'));

        const service = new PropertiesService(
            { executeInTenantSchema, transactionInTenantSchema: jest.fn() } as any,
            {} as any, {} as any,
            { resolveForProperty: jest.fn().mockResolvedValue(CM_OWNED), invalidate: jest.fn() } as any,
        );
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

        const result: any = await service.checkAvailability(
            schemaName, PROPERTY_ID, '2026-09-01', '2026-09-05', tenantId,
        );

        // Exactamente el modo de fallo que este guard existe para evitar:
        // "no pude leer" jamás debe leerse como "no hay nada reservado".
        expect(result.available).toBe(false);
        expect(result.conflictSource).toBe('channel_manager_unreadable');
    });

    it('declara frescura y salud cuando el espejo quedó atrás', async () => {
        const staleSor = {
            ...CM_OWNED,
            lastSyncedAt: new Date(Date.now() - 86_400_000).toISOString(),
            stale: true,
            health: 'degraded',
        };
        const { service } = buildService(staleSor, [[], []]);

        const result: any = await service.checkAvailability(
            schemaName, PROPERTY_ID, '2026-09-01', '2026-09-05', tenantId,
        );

        expect(result.stale).toBe(true);
        expect(result.health).toBe('degraded');
        expect(Date.parse(result.asOf)).not.toBeNaN();
    });

    it('sin resolutor inyectado el tenant se comporta como propio', async () => {
        const executeInTenantSchema = jest.fn()
            .mockResolvedValueOnce([PROPERTY_ROW])
            .mockResolvedValue([]);
        const service = new PropertiesService(
            { executeInTenantSchema, transactionInTenantSchema: jest.fn() } as any,
            {} as any, {} as any,
        );

        const result: any = await service.checkAvailability(
            schemaName, PROPERTY_ID, '2026-09-01', '2026-09-05', tenantId,
        );

        expect(result.canBookDirectly).toBe(true);
        expect(result.source).toBe('tenant_db');
    });
});

describe('el writer local se apaga cuando el PMS es dueño del calendario', () => {
    it('rechaza la reserva antes de abrir la transacción', async () => {
        const transactionInTenantSchema = jest.fn();
        const service = new PropertiesService(
            { executeInTenantSchema: jest.fn().mockResolvedValue([]), transactionInTenantSchema } as any,
            {} as any, {} as any,
            { resolveForProperty: jest.fn().mockResolvedValue(CM_OWNED), invalidate: jest.fn() } as any,
        );

        await expect(service.createBooking(schemaName, PROPERTY_ID, {
            tenantId, guestName: 'Nir', checkIn: '2026-09-01', checkOut: '2026-09-05',
        })).rejects.toBeInstanceOf(ConflictException);

        // Lo que importa: nunca se escribió nada. Una fila local acá es una
        // reserva que el calendario real del anfitrión no conoce.
        expect(transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('el rechazo nombra al proveedor y su frescura', async () => {
        const service = new PropertiesService(
            { executeInTenantSchema: jest.fn().mockResolvedValue([]), transactionInTenantSchema: jest.fn() } as any,
            {} as any, {} as any,
            { resolveForProperty: jest.fn().mockResolvedValue(CM_OWNED), invalidate: jest.fn() } as any,
        );

        await service.createBooking(schemaName, PROPERTY_ID, {
            tenantId, guestName: 'Nir', checkIn: '2026-09-01', checkOut: '2026-09-05',
        }).catch((e: any) => {
            expect(e.response).toMatchObject({
                error: 'channel_manager_owns_calendar',
                provider: 'hostaway',
            });
            expect(e.response.message).not.toMatch(/cm_listings|SELECT|uuid/i);
        });
        expect.assertions(2);
    });

    it('un alojamiento propio sí llega a la transacción', async () => {
        const transactionInTenantSchema = jest.fn().mockRejectedValue(new Error('stop here'));
        const service = new PropertiesService(
            { executeInTenantSchema: jest.fn().mockResolvedValue([]), transactionInTenantSchema } as any,
            {} as any, {} as any,
            { resolveForProperty: jest.fn().mockResolvedValue(LOCAL), invalidate: jest.fn() } as any,
        );

        await expect(service.createBooking(schemaName, PROPERTY_ID, {
            tenantId, guestName: 'Nir', checkIn: '2026-09-01', checkOut: '2026-09-05',
        })).rejects.toThrow('stop here');
        expect(transactionInTenantSchema).toHaveBeenCalled();
    });
});

describe('el resolutor de fuente de verdad', () => {
    function buildResolver(config: any, listingRows: any[] | Error) {
        const executeInTenantSchema = listingRows instanceof Error
            ? jest.fn().mockRejectedValue(listingRows)
            : jest.fn().mockResolvedValue(listingRows);
        const redis = {
            get: jest.fn().mockResolvedValue(null),
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
        };
        const channelManager = { getConfig: jest.fn().mockResolvedValue(config) };
        const service = new LodgingSourceOfTruthService(
            { executeInTenantSchema } as any, redis as any, channelManager as any,
        );
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
        return { service, redis, channelManager, executeInTenantSchema };
    }

    it('sin conexión el alojamiento es local', async () => {
        const { service } = buildResolver(null, []);
        const result = await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);
        expect(result).toMatchObject({ sor: 'local', connected: false });
    });

    it('provider "direct" significa que el negocio usa Parallly como calendario', async () => {
        const { service } = buildResolver({ provider: 'direct', syncInterval: 60 }, []);
        const result = await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);
        expect(result.sor).toBe('local');
    });

    it('conectado pero sin enlazar esta unidad falla cerrado', async () => {
        const { service } = buildResolver({ provider: 'hostaway', syncInterval: 60 }, []);
        const result = await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);
        expect(result).toMatchObject({
            sor: 'unknown', connected: true, provider: 'hostaway',
            writerBlockedReason: 'ownership_unknown',
        });
        expect(localWriterAllowed(result)).toBe(false);
    });

    it('una unidad enlazada pasa a ser propiedad del channel manager y bloquea el writer', async () => {
        const { service } = buildResolver(
            { provider: 'hostaway', syncInterval: 60 },
            [{ id: LISTING_ID, provider: 'hostaway', last_synced_at: new Date().toISOString() }],
        );
        const result = await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);
        expect(result).toMatchObject({
            sor: 'channel_manager',
            listingId: LISTING_ID,
            writerBlockedReason: 'channel_manager_owns_calendar',
            stale: false,
        });
    });

    it('un espejo viejo se marca stale y degradado', async () => {
        const { service } = buildResolver(
            { provider: 'hostaway', syncInterval: 60 },
            [{ id: LISTING_ID, provider: 'hostaway', last_synced_at: new Date(Date.now() - 10 * 3600_000).toISOString() }],
        );
        const result = await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);
        expect(result.stale).toBe(true);
        expect(result.health).toBe('degraded');
    });

    it('sin sincronizar nunca, el espejo es stale', async () => {
        const { service } = buildResolver(
            { provider: 'hostaway', syncInterval: 60 },
            [{ id: LISTING_ID, provider: 'hostaway', last_synced_at: null }],
        );
        const result = await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);
        expect(result.stale).toBe(true);
    });

    it('un tenant conectado pero sin tablas cm_* queda bloqueado hasta sincronizar/mapear', async () => {
        const { service } = buildResolver(
            { provider: 'hostaway', syncInterval: 60 },
            new Error('relation "cm_listings" does not exist'),
        );
        const result = await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);
        expect(result).toMatchObject({ sor: 'unknown', connected: true });
    });

    it('cachea la decisión para no resolverla en cada turno', async () => {
        const { service, redis } = buildResolver({ provider: 'direct', syncInterval: 60 }, []);
        await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);
        expect(redis.setJson).toHaveBeenCalledWith(
            `lodging:sor:${tenantId}:v0:${PROPERTY_ID}`, expect.any(Object), expect.any(Number),
        );
    });
});

/**
 * ═══ "NO PUDE AVERIGUARLO" NO ES "ES LOCAL" ═══
 *
 * El archivo afirmaba que una propiedad que se sabe mapeada nunca se degrada a
 * local por un error transitorio, "porque la fila del mapeo se lee en la misma
 * consulta que la config". Eran dos lecturas separadas y las dos devolvían
 * `local` al fallar; el llamador tenía un tercer `catch` que hacía lo mismo.
 *
 * `local` es el estado que PERMITE escribir. Cada uno de esos tres caminos era
 * una forma de que el agente vendiera una noche que Hostaway ya había vendido.
 */
describe('una unidad mapeada nunca degrada a escritura local', () => {
    function buildResolver(configResult: any, listingResult: any[] | Error) {
        const executeInTenantSchema = listingResult instanceof Error
            ? jest.fn().mockRejectedValue(listingResult)
            : jest.fn().mockResolvedValue(listingResult);
        const redis = {
            get: jest.fn().mockResolvedValue(null),
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
        };
        const getConfig = configResult instanceof Error
            ? jest.fn().mockRejectedValue(configResult)
            : jest.fn().mockResolvedValue(configResult);
        const service = new LodgingSourceOfTruthService(
            { executeInTenantSchema } as any, redis as any, { getConfig } as any,
        );
        for (const level of ['warn', 'error', 'debug'] as const) {
            jest.spyOn((service as any).logger, level).mockImplementation(() => undefined);
        }
        return { service, redis, getConfig, executeInTenantSchema };
    }

    const mapped = [{ id: LISTING_ID, provider: 'hostaway', last_synced_at: new Date().toISOString() }];

    it('la config ilegible ya no convierte una unidad de Hostaway en local', async () => {
        // `getConfig` DESCIFRA: una clave de cifrado rotada bastaba para que
        // esta unidad pasara a escribirse localmente. Ahora el mapeo se lee
        // primero y no depende de poder descifrar nada.
        const { service } = buildResolver(new Error('bad decrypt'), mapped);

        const result = await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);

        expect(result).toMatchObject({
            sor: 'channel_manager',
            listingId: LISTING_ID,
            // El proveedor sale de la fila, no de la config que no se pudo leer.
            provider: 'hostaway',
            writerBlockedReason: 'channel_manager_owns_calendar',
        });
    });

    it('una consulta que falla es `unknown`, no `local`', async () => {
        const { service } = buildResolver(
            { provider: 'hostaway', syncInterval: 60 },
            new Error('canceling statement due to statement timeout'),
        );

        const result = await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);

        expect(result.sor).toBe('unknown');
        expect(localWriterAllowed(result)).toBe(false);
        expect(result.writerBlockedReason).toBe('ownership_unknown');
    });

    it('un permiso denegado tampoco concluye `local`', async () => {
        const denied: any = new Error('permission denied for table cm_listings');
        denied.code = '42501';
        const { service } = buildResolver({ provider: 'hostaway', syncInterval: 60 }, denied);

        expect((await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID)).sor)
            .toBe('unknown');
    });

    it('la tabla ausente sólo concluye local cuando no hay PMS externo', async () => {
        // Es el único error que puede concluir `local`, y por eso se reconoce
        // por el código de PostgreSQL y no por "algo salió mal".
        const absent: any = new Error('relation "tenant_x.cm_listings" does not exist');
        absent.code = '42P01';
        const { service } = buildResolver({ provider: 'hostaway', syncInterval: 60 }, absent);

        const result = await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);

        expect(result).toMatchObject({ sor: 'unknown', connected: true, provider: 'hostaway' });
        expect(localWriterAllowed(result)).toBe(false);
    });

    it('`unknown` no se cachea: un tropiezo no bloquea un minuto entero', async () => {
        const { service, redis } = buildResolver(
            { provider: 'hostaway', syncInterval: 60 }, new Error('connection reset'),
        );

        await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);

        expect(redis.setJson).not.toHaveBeenCalled();
    });

    it('...y una decisión firme sí se cachea', async () => {
        const { service, redis } = buildResolver({ provider: 'hostaway', syncInterval: 60 }, mapped);
        await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);
        expect(redis.setJson).toHaveBeenCalled();
    });

    it('sin mapeo y con la config ilegible queda unknown, nunca local', async () => {
        const { service } = buildResolver(new Error('settings unreadable'), []);

        const result = await service.resolveForProperty(tenantId, schemaName, PROPERTY_ID);

        expect(result.sor).toBe('unknown');
        expect(localWriterAllowed(result)).toBe(false);
    });
});
