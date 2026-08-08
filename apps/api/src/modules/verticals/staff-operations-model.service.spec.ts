import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { StaffOperationsModelService } from './staff-operations-model.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const CALENDAR_ID = '55555555-5555-4555-8555-555555555555';
const RESOURCE_ID = '66666666-6666-4666-8666-666666666666';

describe('StaffOperationsModelService', () => {
    const prisma: any = {};
    const service = new StaffOperationsModelService(prisma);

    it('rejects a syntactically plausible but unknown IANA timezone', async () => {
        await expect(service.createLocation('tenant_demo', {
            name: 'Sede falsa',
            timezone: 'Foo/Bar',
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.executeInTenantSchema).toBeUndefined();
    });

    it('persists only explicit links and validates every referenced owner', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: STAFF_ID }])
            .mockResolvedValueOnce([{ id: USER_ID }])
            .mockResolvedValueOnce([{ id: LOCATION_ID }])
            .mockResolvedValueOnce([{ id: CALENDAR_ID }])
            .mockResolvedValueOnce([{ id: RESOURCE_ID, location_id: LOCATION_ID }])
            .mockResolvedValue([]);
        prisma.transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => callback(query));

        await expect(service.upsertBinding(TENANT_ID, 'tenant_demo', STAFF_ID, {
            userId: USER_ID,
            locationId: LOCATION_ID,
            calendarIntegrationId: CALENDAR_ID,
            resourceIds: [RESOURCE_ID, RESOURCE_ID],
        })).resolves.toEqual({
            staffProfileId: STAFF_ID,
            userId: USER_ID,
            locationId: LOCATION_ID,
            calendarIntegrationId: CALENDAR_ID,
            resourceIds: [RESOURCE_ID],
        });

        const userOwnershipCall = query.mock.calls.find(([sql]: [string]) => sql.includes('FROM public.users'));
        expect(userOwnershipCall[1]).toEqual([USER_ID, TENANT_ID]);
        expect(query.mock.calls.some(([sql]: [string]) => sql.includes('staff_resource_assignments'))).toBe(true);
    });

    it('never assumes staffProfileId is also a platform user ID', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: STAFF_ID }])
            .mockResolvedValue([]);
        prisma.transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => callback(query));

        await service.upsertBinding(TENANT_ID, 'tenant_demo', STAFF_ID, {});

        expect(query.mock.calls.some(([sql]: [string]) => sql.includes('FROM public.users'))).toBe(false);
        const bindingCall = query.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO staff_operational_bindings'));
        expect(bindingCall[1]).toEqual([STAFF_ID, null, null, null]);
    });

    it('fails closed when a linked user belongs to another tenant', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: STAFF_ID }])
            .mockResolvedValueOnce([]);
        prisma.transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => callback(query));

        await expect(service.upsertBinding(TENANT_ID, 'tenant_demo', STAFF_ID, {
            userId: USER_ID,
        })).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects resources outside the selected location', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: STAFF_ID }])
            .mockResolvedValueOnce([{ id: LOCATION_ID }])
            .mockResolvedValueOnce([{
                id: RESOURCE_ID,
                location_id: '77777777-7777-4777-8777-777777777777',
            }]);
        prisma.transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => callback(query));

        await expect(service.upsertBinding(TENANT_ID, 'tenant_demo', STAFF_ID, {
            locationId: LOCATION_ID,
            resourceIds: [RESOURCE_ID],
        })).rejects.toBeInstanceOf(ConflictException);
    });

    it('requires the staff profile to exist independently', async () => {
        const query = jest.fn().mockResolvedValueOnce([]);
        prisma.transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => callback(query));
        await expect(service.upsertBinding(TENANT_ID, 'tenant_demo', STAFF_ID, {}))
            .rejects.toBeInstanceOf(NotFoundException);
    });
});
