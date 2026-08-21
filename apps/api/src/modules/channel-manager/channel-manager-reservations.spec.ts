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
    const executeInTenantSchema = jest.fn()
        // (1) el listado
        .mockResolvedValueOnce(listing ? [{ id: LISTING_ID, name: listing.name || 'Depto 401', provider: listing.provider }] : [])
        // (2) los conflictos
        .mockResolvedValueOnce(conflicts)
        // (3) el INSERT
        .mockResolvedValue([{ id: 'new-reservation' }]);

    const prisma = {
        executeInTenantSchema,
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
        tenant: { findUnique: jest.fn().mockResolvedValue({ schemaName, settings: {} }) },
    };
    const service = new ChannelManagerService(
        prisma as any,
        { axiosRef: { get: jest.fn() } } as any,
        { get: jest.fn().mockResolvedValue(schemaName), set: jest.fn() } as any,
        new TenantSecretCryptoService(),
    );
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(service as any, 'resolveSchemaName').mockResolvedValue(schemaName);
    jest.spyOn(service as any, 'ensureTables').mockResolvedValue(undefined);
    jest.spyOn(service, 'getConfig').mockResolvedValue(null as any);
    return { service, executeInTenantSchema };
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
            const { service, executeInTenantSchema } = buildService({ provider });

            await expect(service.createReservation(tenantId, RESERVATION))
                .rejects.toBeInstanceOf(ConflictException);

            // Y no escribió nada: sólo leyó el listado.
            expect(executeInTenantSchema).toHaveBeenCalledTimes(1);
            expect(String(executeInTenantSchema.mock.calls[0][1])).toMatch(/FROM cm_listings/);
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
        const { service, executeInTenantSchema } = buildService({ provider: 'direct' });

        const result = await service.createReservation(tenantId, RESERVATION);

        expect(result).toMatchObject({ id: 'new-reservation' });
        expect(String(executeInTenantSchema.mock.calls[2][1])).toMatch(/INSERT INTO cm_reservations/);
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
        const { service, executeInTenantSchema } = buildService({ provider: 'direct' });

        await service.createReservation(tenantId, RESERVATION);

        const [, sql, params] = executeInTenantSchema.mock.calls[1] as any[];
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
        const { service, executeInTenantSchema } = buildService({ provider: 'direct' });

        await service.createReservation(tenantId, RESERVATION);

        const nonBlocking = (executeInTenantSchema.mock.calls[1] as any[])[2][3] as string[];
        expect(nonBlocking).not.toContain('un_estado_que_no_existe_todavia');
    });
});
