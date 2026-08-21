import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * El "sí" del huésped autorizó una escritura imposible.
 *
 * El desafío de confirmación congela los argumentos tal como los mandó el modelo
 * y recién los ejecuta cuando el cliente confirma. Con un `propertyId` inventado
 * —bien formado pero inexistente— el desafío se creaba igual: se le preguntaba
 * "¿confirmás la reserva del 13 al 19?", el huésped decía que sí, y RECIÉN AHÍ
 * el sistema descubría que el alojamiento no existe (`Property not found`).
 * Confirmó dos veces algo que nunca pudo ocurrir, y nadie se lo dijo.
 *
 * Lo que estos tests fijan no es el mensaje de error: es que el desafío
 * **no llegue a crearse**.
 */

const schemaName = 'tenant_preconditions';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const PROPERTY_ID = 'a36c1e0c-c71b-4837-8f30-048e94bba421';

const BOOKING_ARGS = {
    propertyId: PROPERTY_ID,
    checkIn: '2026-11-13',
    checkOut: '2026-11-19',
    guestName: 'Nir Levin',
};

function createExecutor(getById: jest.Mock) {
    const control = {
        preflight: jest.fn().mockResolvedValue({ allowed: true }),
        complete: jest.fn(),
        fail: jest.fn(),
    };
    const paymentOperations = { preparePaymentLink: jest.fn(), confirmationRequiredResult: jest.fn() };
    const executor = new AIToolExecutorService(
        { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        control as any,
        paymentOperations as any,
        {} as any,
    );
    // Se inyecta por nombre y no por posición: el constructor toma 24
    // dependencias y contarlas en un test lo vuelve frágil sin ganar nada.
    (executor as any).propertiesService = { getById };
    jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
    return { executor, control };
}

describe('una reserva sobre un alojamiento inexistente no llega a la confirmación', () => {
    it('no crea el desafío cuando la propiedad no existe', async () => {
        const getById = jest.fn().mockResolvedValue(null);
        const { executor, control } = createExecutor(getById);

        const result = await executor.execute(
            schemaName, tenantId, contactId, 'create_property_booking', BOOKING_ARGS, conversationId,
            { authority: authorityFor('create_property_booking') },
        );

        expect(result).toMatchObject({ error: 'unknown_property' });
        // Lo que de verdad importa: nunca se le preguntó al cliente.
        expect(control.preflight).not.toHaveBeenCalled();
    });

    it('tampoco cuando el modelo manda el nombre en lugar del id', async () => {
        // getById valida el formato y tira; para este guard es el mismo caso.
        const getById = jest.fn().mockRejectedValue(new Error('propertyId must be a valid UUID'));
        const { executor, control } = createExecutor(getById);

        const result = await executor.execute(
            schemaName, tenantId, contactId, 'create_property_booking',
            { ...BOOKING_ARGS, propertyId: 'Amazon Minimalist' }, conversationId,
            { authority: authorityFor('create_property_booking') },
        );

        expect(result).toMatchObject({ error: 'unknown_property' });
        expect(control.preflight).not.toHaveBeenCalled();
    });

    it('el mensaje que ve el cliente no nombra identificadores ni tablas', async () => {
        const { executor } = createExecutor(jest.fn().mockResolvedValue(null));

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_property_booking', BOOKING_ARGS, conversationId,
            { authority: authorityFor('create_property_booking') },
        );

        expect(result.message).toEqual(expect.any(String));
        expect(result.message).not.toMatch(/uuid|propertyId|property_bookings|SELECT/i);
        expect(result.message).not.toContain(PROPERTY_ID);
    });

    it('con la propiedad existente sigue de largo hasta el control', async () => {
        const getById = jest.fn().mockResolvedValue({ id: PROPERTY_ID, is_active: true });
        const { executor, control } = createExecutor(getById);

        await executor.execute(
            schemaName, tenantId, contactId, 'create_property_booking', BOOKING_ARGS, conversationId,
            { authority: authorityFor('create_property_booking') },
        );

        expect(getById).toHaveBeenCalledWith(schemaName, PROPERTY_ID);
        expect(control.preflight).toHaveBeenCalled();
    });

    it('no se mete con herramientas que no son esta', async () => {
        const getById = jest.fn();
        const { executor, control } = createExecutor(getById);

        await executor.execute(schemaName, tenantId, contactId, 'list_properties', {}, conversationId, { authority: authorityFor('list_properties') });

        expect(getById).not.toHaveBeenCalled();
        expect(control.preflight).toHaveBeenCalled();
    });
});
