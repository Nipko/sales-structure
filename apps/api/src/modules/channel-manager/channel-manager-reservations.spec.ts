import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ChannelManagerService } from './channel-manager.service';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

/**
 * La puerta de servicio del channel manager.
 *
 * El writer del agente ya falla cerrado cuando el PMS es dueño del calendario
 * (`LodgingSourceOfTruthService`). `POST /channel-manager/reservations` no
 * preguntaba nada: insertaba `provider = 'direct'` en CUALQUIER listado,
 * incluidos los de Hostaway. Una fila local que el proveedor nunca ve no
 * bloquea las fechas del lado del canal, así que el mismo departamento se
 * vendía dos veces —una acá y otra en Airbnb— y el huésped se enteraba al
 * llegar. Es el mismo defecto que la asimetría de arriba existe para evitar,
 * entrando por otra puerta.
 *
 * Y el conflicto se medía contra `status = 'confirmed'`, una palabra que
 * Hostaway no usa: manda `new`, `modified`, `ownerStay`. Una estadía
 * sincronizada no bloqueaba nada.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_cm';
const LISTING_ID = 'b36c1e0c-c71b-4837-8f30-048e94bba422';

function buildService(listing: { provider: string; name?: string } | null, conflicts: any[] = []) {
    const executeInTenantSchema = jest.fn().mockResolvedValue([]);
    const query = jest.fn(async (sql: string, _params: any[] = []) => {
        if (sql.includes('pg_advisory_xact_lock')) return [{ lock_acquired: '1' }];
        if (sql.includes('FROM cm_listings')) {
            return listing ? [{
                id: LISTING_ID,
                external_id: 'remote-listing-1',
                name: listing.name || 'Depto 401',
                provider: listing.provider,
            }] : [];
        }
        if (sql.includes('SELECT 1 FROM cm_reservations')) return conflicts;
        if (sql.includes('INSERT INTO cm_reservations')) return [{ id: 'new-reservation' }];
        throw new Error(`Unexpected SQL in reservation test: ${sql}`);
    });
    const transactionInTenantSchema = jest.fn(async (_schema: string, run: any) => run(query));

    const prisma = {
        executeInTenantSchema,
        transactionInTenantSchema,
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
        tenant: { findUnique: jest.fn().mockResolvedValue({ schemaName, settings: {} }) },
    };
    const service = new ChannelManagerService(
        prisma as any,
        { get: jest.fn().mockResolvedValue(schemaName), set: jest.fn(), del: jest.fn() } as any,
        { axiosRef: { get: jest.fn() } } as any,
        new TenantSecretCryptoService(),
    );
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(service as any, 'resolveSchemaName').mockResolvedValue(schemaName);
    jest.spyOn(service as any, 'ensureTables').mockResolvedValue(undefined);
    jest.spyOn(service, 'getConfig').mockResolvedValue(null as any);
    return { service, executeInTenantSchema, transactionInTenantSchema, query };
}

const RESERVATION = {
    listingId: LISTING_ID,
    guestName: 'Ana',
    checkIn: '2026-09-10',
    checkOut: '2026-09-14',
};

describe('una reserva no se crea acá cuando el libro mayor está afuera', () => {
    it.each(['hostaway', 'guesty', 'HOSTAWAY'])(
        'rechaza el alta sobre un listado de %s',
        async (provider) => {
            const { service, query } = buildService({ provider });

            await expect(service.createReservation(tenantId, RESERVATION))
                .rejects.toBeInstanceOf(ConflictException);

            // Y no escribió nada: tomó el lock y leyó el listado bajo
            // FOR UPDATE, pero no midió conflicto ni insertó una fila local.
            expect(query.mock.calls.some(([sql]) => /INSERT INTO cm_reservations/.test(sql))).toBe(false);
            expect(query.mock.calls.some(([sql]) => /SELECT 1 FROM cm_reservations/.test(sql))).toBe(false);
            expect(query.mock.calls.some(([sql]) => /FROM cm_listings[\s\S]*FOR UPDATE/.test(sql))).toBe(true);
        },
    );

    it('el motivo dice dónde crearla, no sólo que no se puede', async () => {
        const { service } = buildService({ provider: 'hostaway', name: 'Loft Chapinero' });

        // Un "no se puede" sin destino deja al dueño buscando el botón que no
        // existe; el que sí funciona está en el proveedor.
        await expect(service.createReservation(tenantId, RESERVATION)).rejects.toMatchObject({
            response: {
                error: 'external_system_of_record',
                provider: 'hostaway',
                message: expect.stringContaining('hostaway'),
            },
        });
    });

    it('un listado directo sí puede recibir la reserva', async () => {
        const { service, query } = buildService({ provider: 'direct' });

        const result = await service.createReservation(tenantId, RESERVATION);

        expect(result).toMatchObject({ id: 'new-reservation' });
        expect(query.mock.calls.some(([sql]) => /INSERT INTO cm_reservations/.test(sql))).toBe(true);
    });

    it('un listado iCal también: el feed es del propio tenant', async () => {
        // Un feed iCal es el calendario del tenant publicado hacia las OTAs. La
        // reserva directa es el caso normal, y el bloqueo viaja en el export.
        const { service } = buildService({ provider: 'ical' });

        await expect(service.createReservation(tenantId, RESERVATION)).resolves.toBeTruthy();
    });

    it('un listado inexistente no crea una reserva huérfana', async () => {
        const { service } = buildService(null);

        await expect(service.createReservation(tenantId, RESERVATION))
            .rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('el conflicto se mide por lo que ocupa, no por una palabra', () => {
    it('pregunta por lo que NO libera la fecha', async () => {
        const { service, query } = buildService({ provider: 'direct' });

        await service.createReservation(tenantId, RESERVATION);

        const conflictCall = query.mock.calls.find(([sql]) => /SELECT 1 FROM cm_reservations/.test(sql)) as any[];
        const [sql, params] = conflictCall;
        // La consulta ya no nombra `confirmed`: invierte la pregunta.
        expect(String(sql)).not.toMatch(/status\s*=\s*'confirmed'/);
        expect(String(sql)).toMatch(/<>\s*ALL/);

        const nonBlocking = params[3] as string[];
        // Lo que libera está listado…
        expect(nonBlocking).toEqual(expect.arrayContaining(['cancelled', 'declined', 'expired']));
        // …y lo que ocupa NO, aunque el proveedor lo llame distinto cada vez.
        for (const occupying of ['new', 'modified', 'ownerstay', 'confirmed', 'awaitingpayment']) {
            expect(nonBlocking).not.toContain(occupying);
        }
    });

    it('una estadía sincronizada bloquea el alta', async () => {
        const { service } = buildService({ provider: 'direct' }, [{ '?column?': 1 }]);

        await expect(service.createReservation(tenantId, RESERVATION))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('un estado desconocido bloquea: no saber no es estar libre', async () => {
        // El predicado es "todo lo que no está en la lista de liberadores", así
        // que un estado que el proveedor invente mañana ocupa por defecto.
        const { service, query } = buildService({ provider: 'direct' });

        await service.createReservation(tenantId, RESERVATION);

        const conflictCall = query.mock.calls.find(([sql]) => /SELECT 1 FROM cm_reservations/.test(sql)) as any[];
        const nonBlocking = conflictCall[1][3] as string[];
        expect(nonBlocking).not.toContain('un_estado_que_no_existe_todavia');
    });
});

describe('el rango se valida en el boundary del servicio', () => {
    it.each([
        ['2026-09-10', '2026-09-10'],
        ['2026-09-11', '2026-09-10'],
        ['2026-02-30', '2026-03-02'],
        ['2026-09-10T10:00:00Z', '2026-09-11'],
    ])('rechaza checkIn=%s / checkOut=%s antes de tocar la base', async (checkIn, checkOut) => {
        const { service, transactionInTenantSchema } = buildService({ provider: 'direct' });

        await expect(service.createReservation(tenantId, {
            ...RESERVATION,
            checkIn,
            checkOut,
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(transactionInTenantSchema).not.toHaveBeenCalled();
    });
});

describe('contrato atómico contra sobreventa concurrente', () => {
    it('encierra lock, lectura autoritativa, conflicto e INSERT en la misma transacción', async () => {
        const { service, query, transactionInTenantSchema, executeInTenantSchema } =
            buildService({ provider: 'direct' });

        await service.createReservation(tenantId, RESERVATION);

        expect(transactionInTenantSchema).toHaveBeenCalledWith(schemaName, expect.any(Function));
        const sqls = query.mock.calls.map(([sql]) => String(sql));
        const lockIndex = sqls.findIndex(sql => sql.includes('pg_advisory_xact_lock'));
        const listingIndex = sqls.findIndex(sql => sql.includes('FROM cm_listings'));
        const conflictIndex = sqls.findIndex(sql => sql.includes('SELECT 1 FROM cm_reservations'));
        const insertIndex = sqls.findIndex(sql => sql.includes('INSERT INTO cm_reservations'));

        expect([lockIndex, listingIndex, conflictIndex, insertIndex]).toEqual([0, 1, 2, 3]);
        expect(sqls[listingIndex]).toMatch(/FOR UPDATE/i);
        expect(query.mock.calls[lockIndex]?.[1]?.[0]).toBe(
            `cm-reservation:${schemaName}:${LISTING_ID}`,
        );
        // executeInTenantSchema may later maintain the derived availability
        // calendar, but never performs the authoritative conflict/INSERT pair.
        expect(executeInTenantSchema.mock.calls.some(([, sql]) =>
            /SELECT 1 FROM cm_reservations|INSERT INTO cm_reservations/.test(String(sql)),
        )).toBe(false);
    });

    it('dos altas solapadas simultáneas producen una sola reserva', async () => {
        const stored: Array<{ checkIn: string; checkOut: string }> = [];
        const insertCalls: string[] = [];
        let transactionTail = Promise.resolve();

        const transactionInTenantSchema = jest.fn(async (_schema: string, run: any) => {
            const predecessor = transactionTail;
            let release!: () => void;
            transactionTail = new Promise<void>(resolve => { release = resolve; });
            await predecessor;

            const query = jest.fn(async (sql: string, params: any[] = []) => {
                if (sql.includes('pg_advisory_xact_lock')) return [{ lock_acquired: '1' }];
                if (sql.includes('FROM cm_listings')) {
                    return [{
                        id: LISTING_ID,
                        external_id: 'local-listing',
                        name: 'Depto 401',
                        provider: 'direct',
                    }];
                }
                if (sql.includes('SELECT 1 FROM cm_reservations')) {
                    const [, requestedIn, requestedOut] = params;
                    return stored.some(row => row.checkIn < requestedOut && row.checkOut > requestedIn)
                        ? [{ conflict: 1 }]
                        : [];
                }
                if (sql.includes('INSERT INTO cm_reservations')) {
                    insertCalls.push(sql);
                    stored.push({ checkIn: params[4], checkOut: params[5] });
                    return [{ id: `reservation-${stored.length}` }];
                }
                throw new Error(`Unexpected concurrency SQL: ${sql}`);
            });

            try {
                return await run(query);
            } finally {
                release();
            }
        });
        const prisma: any = {
            transactionInTenantSchema,
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
        };
        const service = new ChannelManagerService(
            prisma,
            { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
            { axiosRef: {} } as any,
            new TenantSecretCryptoService(),
        );
        jest.spyOn(service as any, 'resolveSchemaName').mockResolvedValue(schemaName);
        jest.spyOn(service as any, 'ensureTables').mockResolvedValue(undefined);
        jest.spyOn(service, 'getConfig').mockResolvedValue(null as any);

        const outcomes = await Promise.allSettled([
            service.createReservation(tenantId, RESERVATION),
            service.createReservation(tenantId, { ...RESERVATION, guestName: 'Luis' }),
        ]);

        expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toBeInstanceOf(BadRequestException);
        expect(stored).toHaveLength(1);
        expect(insertCalls).toHaveLength(1);
        expect(transactionInTenantSchema).toHaveBeenCalledTimes(2);
    });
});
