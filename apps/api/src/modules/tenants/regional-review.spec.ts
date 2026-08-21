import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RegionalProfileService } from './regional-profile.service';
import { RegionalConflictCronService } from './regional-conflict-cron.service';

/**
 * La rama `declared` era inalcanzable.
 *
 * El perfil regional distingue lo que el dueño DECLARÓ de lo que el sistema
 * dedujo o puso por defecto, y detecta cuándo las señales se contradicen. Pero
 * `queueConflictsForReview` **no tenía ningún llamador** —la tabla de revisión
 * estaba permanentemente vacía— y no existía forma de convertir una decisión
 * en la columna que el resto del sistema lee. Así que el país siempre llegaba
 * `inferred` o `fallback`, y un `fallback` es exactamente lo que hace que un
 * teléfono no se normalice y que el agente hable en la moneda equivocada.
 *
 * Detectar sin poder decidir es un diagnóstico sin tratamiento.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';
const reviewId = '22222222-2222-4222-8222-222222222222';

function buildService(options: {
    review?: any;
    profile?: any;
} = {}) {
    const updates: any[] = [];
    const reviewUpdates: any[] = [];
    const prisma = {
        tenant: {
            findUnique: jest.fn().mockResolvedValue({ id: tenantId }),
            findMany: jest.fn().mockResolvedValue([{ id: tenantId }]),
            update: jest.fn(async (args: any) => { updates.push(args); return {}; }),
        },
        regionalIdentityReview: {
            findFirst: jest.fn().mockResolvedValue(options.review ?? null),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn(async (args: any) => { reviewUpdates.push(args); return {}; }),
            updateMany: jest.fn(async (args: any) => { reviewUpdates.push(args); return { count: 1 }; }),
        },
    };
    const redis = {
        getJson: jest.fn().mockResolvedValue(null),
        setJson: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RegionalProfileService(prisma as any, redis as any);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    if (options.profile) {
        jest.spyOn(service, 'resolve').mockResolvedValue(options.profile);
    }
    return { service, prisma, redis, updates, reviewUpdates };
}

const CURRENCY_REVIEW = {
    id: reviewId,
    tenantId,
    field: 'currency',
    status: 'pending',
    candidates: [
        { value: 'USD', from: 'tenants.operating_currency' },
        { value: 'COP', from: 'country_default' },
    ],
    suggested: 'USD',
};

describe('resolver una revisión escribe el valor declarado', () => {
    it('escribe la columna del campo y cierra la revisión', async () => {
        const { service, updates, reviewUpdates } = buildService({ review: CURRENCY_REVIEW });

        const result = await service.resolveReview(tenantId, reviewId, {
            value: 'USD', resolvedBy: 'user-1',
        });

        expect(result).toEqual({ field: 'currency', value: 'USD' });
        expect(updates[0].data).toEqual({ operatingCurrency: 'USD' });
        expect(reviewUpdates[0].data).toMatchObject({ status: 'resolved', resolvedBy: 'user-1' });
    });

    it('invalida el perfil cacheado: si no, sigue diciendo lo viejo', async () => {
        const { service, redis } = buildService({ review: CURRENCY_REVIEW });

        await service.resolveReview(tenantId, reviewId, { value: 'USD', resolvedBy: 'user-1' });

        expect(redis.del).toHaveBeenCalledWith(`regional:${tenantId}`);
    });

    it('sólo acepta uno de los valores detectados', async () => {
        const { service, updates } = buildService({ review: CURRENCY_REVIEW });

        // Un campo libre acá sería otra puerta para escribir la identidad
        // regional sin que nadie mire — que es de donde vino el problema.
        await expect(service.resolveReview(tenantId, reviewId, {
            value: 'EUR', resolvedBy: 'user-1',
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(updates).toEqual([]);
    });

    it('un valor con formato inválido no se escribe', async () => {
        const { service, updates } = buildService({
            review: { ...CURRENCY_REVIEW, candidates: [{ value: 'dolares', from: 'x' }] },
        });

        await expect(service.resolveReview(tenantId, reviewId, {
            value: 'dolares', resolvedBy: 'user-1',
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(updates).toEqual([]);
    });

    it('una revisión de otro tenant no existe para éste', async () => {
        const { service } = buildService({ review: null });

        await expect(service.resolveReview(tenantId, reviewId, {
            value: 'USD', resolvedBy: 'user-1',
        })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('una revisión ya resuelta no se resuelve dos veces', async () => {
        const { service, updates } = buildService({
            review: { ...CURRENCY_REVIEW, status: 'resolved' },
        });

        await expect(service.resolveReview(tenantId, reviewId, {
            value: 'USD', resolvedBy: 'user-1',
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(updates).toEqual([]);
    });
});

describe('declarar sin conflicto previo', () => {
    it.each([
        ['operating_country', 'mx', { operatingCountry: 'MX' }],
        ['phone_region', 'ar', { phoneRegion: 'AR' }],
        ['currency', 'mxn', { operatingCurrency: 'MXN' }],
        ['timezone', 'America/Mexico_City', { operatingTimezone: 'America/Mexico_City' }],
        ['locale', 'es-MX', { defaultLocale: 'es-MX' }],
    ])('%s escribe su propia columna', async (field, value, expected) => {
        // Nada se deduce de nada: elegir el país no cambia la moneda por su
        // cuenta, porque un negocio colombiano que cobra en dólares existe y
        // "corregirlo" le cambiaría los precios.
        const { service, updates } = buildService();

        await service.declare(tenantId, field, value, 'user-1');

        expect(updates[0].data).toEqual(expected);
    });

    it('el caso más común no tiene conflicto y aun así puede declarar', async () => {
        // Un tenant que nunca declaró nada tiene una sola señal, o ninguna: no
        // produce revisión. Sin esta puerta seguiría sin poder decir su país.
        const { service, updates } = buildService();

        await service.declare(tenantId, 'operating_country', 'MX', 'user-1');

        expect(updates).toHaveLength(1);
    });

    it('una zona horaria inventada no se guarda', async () => {
        const { service, updates } = buildService();

        await expect(service.declare(tenantId, 'timezone', 'America/Atlantis', 'user-1'))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(updates).toEqual([]);
    });

    it('un campo desconocido no escribe nada', async () => {
        const { service, updates } = buildService();

        await expect(service.declare(tenantId, 'lo_que_sea', 'X', 'user-1'))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(updates).toEqual([]);
    });

    it('declarar contesta el conflicto abierto sobre ese campo', async () => {
        const { service, reviewUpdates } = buildService();

        await service.declare(tenantId, 'currency', 'MXN', 'user-1');

        expect(reviewUpdates[0].where).toMatchObject({ tenantId, field: 'currency', status: 'pending' });
    });
});

describe('el detector tiene un disparador', () => {
    it('el cron recorre los tenants activos y encola', async () => {
        const { service, prisma } = buildService();
        jest.spyOn(service, 'queueConflictsForReview').mockResolvedValue(2);
        const cron = new RegionalConflictCronService(
            prisma as any, service, { runExclusive: jest.fn() } as any,
        );
        jest.spyOn((cron as any).logger, 'log').mockImplementation(() => undefined);

        const result = await cron.sweep();

        expect(result).toEqual({ scanned: 1, queued: 2 });
        expect(prisma.tenant.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { isActive: true } }),
        );
    });

    it('un tenant que falla no para el barrido de los demás', async () => {
        const { service, prisma } = buildService();
        prisma.tenant.findMany.mockResolvedValue([{ id: 'a' }, { id: tenantId }]);
        jest.spyOn(service, 'queueConflictsForReview')
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce(1);
        const cron = new RegionalConflictCronService(
            prisma as any, service, { runExclusive: jest.fn() } as any,
        );
        jest.spyOn((cron as any).logger, 'log').mockImplementation(() => undefined);
        jest.spyOn((cron as any).logger, 'warn').mockImplementation(() => undefined);

        expect(await cron.sweep()).toEqual({ scanned: 2, queued: 1 });
    });
});
