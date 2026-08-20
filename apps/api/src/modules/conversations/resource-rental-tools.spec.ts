import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { PET_BOARDING_TOOLS, VEHICLE_RENTAL_TOOLS } from './tools/resource-rental-tools';
import { TOOL_POLICY_REGISTRY, isRegisteredStaticTool } from './tool-policy-registry';
import { VERTICAL_TOOL_CAPABILITY } from '../../common/contracts/vertical-capability-tools';
import { resolveVerticalCapabilityManifest } from '@parallext/shared';

/**
 * El motor existía y el agente no lo conocía.
 *
 * `ResourceRentalsService` ya validaba locks, solapamiento y capacidad por
 * noche para `vehicle_rental` y `pet_boarding`, y la web mostraba el objeto en
 * `/admin/resource-rentals`. Lo que no existía era una tool: el manifiesto
 * prometía la capacidad, el menú mostraba el registro y la conversación
 * terminaba en handoff. Peor todavía en guardería, donde la única lectura que
 * sí existía contaba la ocupación en `appointments` mientras la reserva se
 * escribe en `resource_rentals` — dos contadores sobre el mismo cupo, así que
 * el cliente podía escuchar "sí hay lugar" y ser rechazado en el mismo turno.
 */

const schemaName = 'tenant_rentals';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const otherContactId = '99999999-9999-4999-8999-999999999999';
const conversationId = '33333333-3333-4333-8333-333333333333';
const VEHICLE_ID = 'a36c1e0c-c71b-4837-8f30-048e94bba421';
const PET_ID = 'b36c1e0c-c71b-4837-8f30-048e94bba422';
const SERVICE_ID = 'c36c1e0c-c71b-4837-8f30-048e94bba423';
const RENTAL_ID = 'd36c1e0c-c71b-4837-8f30-048e94bba424';

function createExecutor(resourceRentals: any, queryRawUnsafe = jest.fn().mockResolvedValue([])) {
    const control = {
        preflight: jest.fn().mockResolvedValue({ allowed: true }),
        complete: jest.fn(),
        fail: jest.fn(),
    };
    const stub = () => ({}) as any;
    const executor = new AIToolExecutorService(
        { $queryRawUnsafe: queryRawUnsafe, executeInTenantSchema: jest.fn().mockResolvedValue([]) } as any,
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        control as any,
        { preparePaymentLink: jest.fn(), confirmationRequiredResult: jest.fn() } as any,
        stub(),
    );
    (executor as any).resourceRentals = resourceRentals;
    jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
    return { executor, control };
}

const RESERVED_VEHICLE_ROW = {
    id: RENTAL_ID,
    rental_type: 'vehicle_rental',
    status: 'reserved',
    start_date: '2026-09-01',
    end_date: '2026-09-05',
    resource_id: VEHICLE_ID,
    resource_name: 'Renault Duster 2024',
    contact_id: contactId,
};

const RESERVED_BOARDING_ROW = {
    id: RENTAL_ID,
    rental_type: 'pet_boarding',
    status: 'reserved',
    start_date: '2026-09-01',
    end_date: '2026-09-05',
    resource_id: PET_ID,
    pet_name: 'Uma',
    service_name: 'Hotel canino',
    contact_id: contactId,
};

describe('el contrato publica las tools de alquiler', () => {
    const allNames = [...VEHICLE_RENTAL_TOOLS, ...PET_BOARDING_TOOLS].map(t => t.name);

    it('cada tool nueva tiene política central', () => {
        for (const name of allNames) {
            expect(isRegisteredStaticTool(name)).toBe(true);
            expect(TOOL_POLICY_REGISTRY[name]).toBeDefined();
        }
    });

    it('los writers exigen confirmación e idempotencia', () => {
        const writers = [
            'create_vehicle_rental', 'cancel_vehicle_rental',
            'create_pet_boarding', 'cancel_pet_boarding',
        ];
        for (const name of writers) {
            const policy = TOOL_POLICY_REGISTRY[name];
            expect(policy.effect).toBe('write');
            expect(policy.confirmation).toBe('runtime_enforced');
            expect(policy.idempotency).not.toBe('missing');
            // Un writer sin controles completos lo bloquea el guard central; no
            // sirve publicarlo.
            expect(policy.assuranceEnforcement).not.toBe('missing');
        }
    });

    it('ningún writer de alquiler es ejecutable desde Agent Test', () => {
        for (const name of ['create_vehicle_rental', 'create_pet_boarding', 'cancel_vehicle_rental', 'cancel_pet_boarding']) {
            expect(TOOL_POLICY_REGISTRY[name].agentTestAllowed).toBe(false);
        }
    });

    it('los subtipos que prometen el objeto ahora reciben el grupo de tools', () => {
        const alquiler = resolveVerticalCapabilityManifest('automotriz', 'alquiler');
        expect(alquiler.capabilities).toContain('vehicle_rentals');
        expect(alquiler.toolGroups).toContain('vehicleRentals');
        expect(alquiler.routes).toContain('/admin/resource-rentals');

        for (const subtype of ['guarderia', 'hotel']) {
            const resolved = resolveVerticalCapabilityManifest('pet_services', subtype);
            expect(resolved.capabilities).toContain('pet_boarding');
            expect(resolved.toolGroups).toContain('petBoarding');
            expect(resolved.routes).toContain('/admin/resource-rentals');
        }
    });

    it('los subtipos que NO alojan no reciben el writer de estadías', () => {
        for (const subtype of ['peluqueria', 'paseos', 'adiestramiento']) {
            const resolved = resolveVerticalCapabilityManifest('pet_services', subtype);
            expect(resolved.toolGroups).not.toContain('petBoarding');
        }
        for (const subtype of ['concesionario', 'taller', 'repuestos']) {
            const resolved = resolveVerticalCapabilityManifest('automotriz', subtype);
            expect(resolved.toolGroups).not.toContain('vehicleRentals');
        }
    });

    it('cada grupo nuevo resuelve a una capability del manifiesto', () => {
        expect(VERTICAL_TOOL_CAPABILITY.vehicleRentals).toBe('vehicle_rentals');
        expect(VERTICAL_TOOL_CAPABILITY.petBoarding).toBe('pet_boarding');
    });
});

describe('alquiler de vehículo: consultar, reservar, ver y cancelar', () => {
    it('la disponibilidad libre se reporta con la fuente', async () => {
        const rentals = {
            checkAvailability: jest.fn().mockResolvedValue({
                available: true, type: 'vehicle_rental', startDate: '2026-09-01', endDate: '2026-09-05', nights: 4,
            }),
        };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'check_vehicle_rental_availability',
            { vehicleId: VEHICLE_ID, startDate: '2026-09-01', endDate: '2026-09-05' }, conversationId,
        );

        expect(result.available).toBe(true);
        expect(result.status).toBe('ok');
        expect(result.source).toBe('tenant_db');
    });

    it('un vehículo tomado devuelve las fechas del conflicto, no un error', async () => {
        const rentals = {
            checkAvailability: jest.fn().mockResolvedValue({
                available: false, type: 'vehicle_rental', startDate: '2026-09-01', endDate: '2026-09-05',
                nights: 4, reason: 'already_rented', conflictStart: '2026-09-03', conflictEnd: '2026-09-07',
            }),
        };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'check_vehicle_rental_availability',
            { vehicleId: VEHICLE_ID, startDate: '2026-09-01', endDate: '2026-09-05' }, conversationId,
        );

        expect(result.available).toBe(false);
        expect(result).toMatchObject({ conflictStart: '2026-09-03', conflictEnd: '2026-09-07' });
        expect(result.error).toBeUndefined();
    });

    it('un fallo de la consulta no se presenta como "no disponible"', async () => {
        const rentals = { checkAvailability: jest.fn().mockRejectedValue(new Error('connection reset')) };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'check_vehicle_rental_availability',
            { vehicleId: VEHICLE_ID, startDate: '2026-09-01', endDate: '2026-09-05' }, conversationId,
        );

        expect(result.status).toBe('error');
        expect(result.error).toBe('read_failed');
        expect(result.available).toBeUndefined();
    });

    it('la reserva persiste y devuelve objeto activo y ruta humana', async () => {
        const rentals = { create: jest.fn().mockResolvedValue(RESERVED_VEHICLE_ROW) };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_vehicle_rental',
            {
                vehicleId: VEHICLE_ID, startDate: '2026-09-01', endDate: '2026-09-05',
                driverName: 'Nir Levin', driverPhone: '+573001112233',
            },
            conversationId,
        );

        expect(rentals.create).toHaveBeenCalledWith(schemaName, expect.objectContaining({
            type: 'vehicle_rental', resourceId: VEHICLE_ID, contactId, customerName: 'Nir Levin',
        }));
        expect(result.success).toBe(true);
        expect(result.rental).toMatchObject({ id: RENTAL_ID, status: 'reserved', startDate: '2026-09-01' });
        expect(result.humanRoute).toContain('/admin/resource-rentals');
    });

    it('sin conductor no llega al writer', async () => {
        const rentals = { create: jest.fn() };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_vehicle_rental',
            { vehicleId: VEHICLE_ID, startDate: '2026-09-01', endDate: '2026-09-05' }, conversationId,
        );

        expect(result.error).toBe('driver_required');
        expect(rentals.create).not.toHaveBeenCalled();
    });

    it('un conflicto al escribir se explica como fechas ocupadas, no como falla', async () => {
        const conflict = new ConflictException({
            message: 'Vehicle is already rented for part of this date range',
            conflictStart: '2026-09-03', conflictEnd: '2026-09-07',
        });
        const rentals = { create: jest.fn().mockRejectedValue(conflict) };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_vehicle_rental',
            { vehicleId: VEHICLE_ID, startDate: '2026-09-01', endDate: '2026-09-05', driverName: 'Nir' },
            conversationId,
        );

        expect(result).toMatchObject({
            error: 'rental_conflict', conflictStart: '2026-09-03', conflictEnd: '2026-09-07',
        });
        expect(result.success).toBeUndefined();
    });

    it('solo lista los alquileres de este cliente, y filtra en la consulta', async () => {
        const rentals = { list: jest.fn().mockResolvedValue([RESERVED_VEHICLE_ROW]) };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'list_my_vehicle_rentals', {}, conversationId,
        );

        expect(rentals.list).toHaveBeenCalledWith(schemaName, expect.objectContaining({
            type: 'vehicle_rental', contactId, activeOnly: true,
        }));
        expect(result.rentals).toHaveLength(1);
        expect(result.status).toBe('ok');
    });

    it('sin cliente identificado no devuelve reservas', async () => {
        const rentals = { list: jest.fn() };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, 'anonimo', 'list_my_vehicle_rentals', {}, conversationId,
        );

        expect(result.status).toBe('unauthorized');
        expect(rentals.list).not.toHaveBeenCalled();
    });

    it('no muestra la reserva de otro cliente', async () => {
        const rentals = {
            getById: jest.fn().mockResolvedValue({ ...RESERVED_VEHICLE_ROW, contact_id: otherContactId }),
        };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'get_vehicle_rental', { rentalId: RENTAL_ID }, conversationId,
        );

        expect(result.status).toBe('empty');
        expect(result.rental).toBeNull();
    });

    it('la cancelación del cliente pasa por el camino con verificación de dueño', async () => {
        const rentals = {
            getById: jest.fn().mockResolvedValue(RESERVED_VEHICLE_ROW),
            cancelForContact: jest.fn().mockResolvedValue({ ...RESERVED_VEHICLE_ROW, status: 'cancelled' }),
            transition: jest.fn(),
        };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'cancel_vehicle_rental',
            { rentalId: RENTAL_ID, reason: 'cambio de planes' }, conversationId,
        );

        expect(rentals.cancelForContact).toHaveBeenCalledWith(schemaName, RENTAL_ID, contactId, 'cambio de planes');
        // `transition` es el camino del panel y exige rol de staff: la
        // cancelación del cliente nunca debe pasar por ahí.
        expect(rentals.transition).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
        expect(result.rental.status).toBe('cancelled');
    });

    it('cancelar una reserva ajena se rechaza', async () => {
        const rentals = {
            getById: jest.fn().mockResolvedValue(RESERVED_VEHICLE_ROW),
            cancelForContact: jest.fn().mockRejectedValue(new ForbiddenException('This reservation belongs to another customer')),
        };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'cancel_vehicle_rental', { rentalId: RENTAL_ID }, conversationId,
        );

        expect(result.error).toBe('not_your_rental');
        expect(result.success).toBeUndefined();
    });

    it('cancelar una estadía de mascota con la tool de vehículos no cruza dominios', async () => {
        const rentals = {
            getById: jest.fn().mockResolvedValue(RESERVED_BOARDING_ROW),
            cancelForContact: jest.fn(),
        };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'cancel_vehicle_rental', { rentalId: RENTAL_ID }, conversationId,
        );

        expect(result.error).toBe('rental_not_found');
        expect(rentals.cancelForContact).not.toHaveBeenCalled();
    });
});

describe('guardería/hotel: el cupo que se consulta es el que se reserva', () => {
    it('la disponibilidad sale de resource_rentals, no de appointments', async () => {
        const checkAvailability = jest.fn().mockResolvedValue({
            available: true, type: 'pet_boarding', startDate: '2026-09-01', endDate: '2026-09-05',
            nights: 4, capacity: 8,
        });
        const executeInTenantSchema = jest.fn().mockResolvedValue([{ id: SERVICE_ID }]);
        const { executor } = createExecutor({ checkAvailability });
        (executor as any).prisma.executeInTenantSchema = executeInTenantSchema;

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'check_daycare_availability',
            { checkIn: '2026-09-01', checkOut: '2026-09-05' }, conversationId,
        );

        expect(checkAvailability).toHaveBeenCalledWith(schemaName, {
            type: 'pet_boarding', serviceId: SERVICE_ID, startDate: '2026-09-01', endDate: '2026-09-05',
        });
        // Lo único que consulta directamente es cuál es el servicio de
        // alojamiento; la ocupación ya no se cuenta acá.
        const sqls = executeInTenantSchema.mock.calls.map(c => String(c[1]));
        expect(sqls.some(sql => /FROM\s+appointments/i.test(sql))).toBe(false);
        expect(result.available).toBe(true);
        expect(result.capacity).toBe(8);
    });

    it('una estadía de un solo día ocupa una noche, no cero', async () => {
        const checkAvailability = jest.fn().mockResolvedValue({
            available: true, type: 'pet_boarding', startDate: '2026-09-01', endDate: '2026-09-02', nights: 1, capacity: 8,
        });
        const { executor } = createExecutor({ checkAvailability });
        (executor as any).prisma.executeInTenantSchema = jest.fn().mockResolvedValue([{ id: SERVICE_ID }]);

        await executor.execute(
            schemaName, tenantId, contactId, 'check_daycare_availability',
            { checkIn: '2026-09-01' }, conversationId,
        );

        expect(checkAvailability).toHaveBeenCalledWith(schemaName, expect.objectContaining({
            startDate: '2026-09-01', endDate: '2026-09-02',
        }));
    });

    it('sin servicio de alojamiento configurado dice vacío, no disponible', async () => {
        const { executor } = createExecutor({ checkAvailability: jest.fn() });
        (executor as any).prisma.executeInTenantSchema = jest.fn().mockResolvedValue([]);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'check_daycare_availability',
            { checkIn: '2026-09-01', checkOut: '2026-09-05' }, conversationId,
        );

        expect(result.status).toBe('empty');
        expect(result.available).toBe(false);
    });

    it('un fallo al resolver el servicio no se convierte en "no hay cupo"', async () => {
        const { executor } = createExecutor({ checkAvailability: jest.fn() });
        (executor as any).prisma.executeInTenantSchema = jest.fn().mockRejectedValue(new Error('boom'));

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'check_daycare_availability',
            { checkIn: '2026-09-01', checkOut: '2026-09-05' }, conversationId,
        );

        expect(result.status).toBe('error');
        expect(result.available).toBeUndefined();
    });

    it('la reserva de estadía persiste y devuelve ruta humana', async () => {
        const rentals = { create: jest.fn().mockResolvedValue(RESERVED_BOARDING_ROW) };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_pet_boarding',
            { petId: PET_ID, serviceId: SERVICE_ID, startDate: '2026-09-01', endDate: '2026-09-05', notes: 'medicación 8am' },
            conversationId,
        );

        expect(rentals.create).toHaveBeenCalledWith(schemaName, expect.objectContaining({
            type: 'pet_boarding', resourceId: PET_ID, serviceId: SERVICE_ID, contactId,
        }));
        expect(result.success).toBe(true);
        expect(result.boarding).toMatchObject({ id: RENTAL_ID, resourceName: 'Uma' });
        expect(result.humanRoute).toContain('/admin/resource-rentals');
    });

    it('sin cupo en una noche del rango no se confirma la estadía', async () => {
        const conflict = new ConflictException({
            message: 'Boarding service has no capacity for every requested night',
            fullNight: '2026-09-03', capacity: 8,
        });
        const rentals = { create: jest.fn().mockRejectedValue(conflict) };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_pet_boarding',
            { petId: PET_ID, serviceId: SERVICE_ID, startDate: '2026-09-01', endDate: '2026-09-05' },
            conversationId,
        );

        expect(result).toMatchObject({ error: 'rental_conflict', fullNight: '2026-09-03', capacity: 8 });
        expect(result.success).toBeUndefined();
    });

    it('una mascota inexistente no produce una confirmación', async () => {
        const rentals = { create: jest.fn().mockRejectedValue(new NotFoundException('Pet not found')) };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_pet_boarding',
            { petId: PET_ID, serviceId: SERVICE_ID, startDate: '2026-09-01', endDate: '2026-09-05' },
            conversationId,
        );

        expect(result.error).toBe('rental_resource_not_found');
        expect(result.success).toBeUndefined();
    });

    it('lista las estadías del tutor bajo su propia clave', async () => {
        const rentals = { list: jest.fn().mockResolvedValue([RESERVED_BOARDING_ROW]) };
        const { executor } = createExecutor(rentals);

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'list_my_pet_boardings', {}, conversationId,
        );

        expect(rentals.list).toHaveBeenCalledWith(schemaName, expect.objectContaining({
            type: 'pet_boarding', contactId, activeOnly: true,
        }));
        expect(result.boardings).toHaveLength(1);
    });
});
