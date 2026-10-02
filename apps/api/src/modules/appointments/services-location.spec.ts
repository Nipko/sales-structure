import { BadRequestException } from '@nestjs/common';
import { ServicesService } from './services.service';

const SCHEMA = 'tenant_service_location';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SERVICE_ID = '22222222-2222-4222-8222-222222222222';
const BASE_ROW = {
    id: SERVICE_ID, name: 'Visita virtual', duration_minutes: 20, duration_type: 'fixed',
    price: 0, price_status: 'confirmed', currency: 'COP', payment_policy: 'none',
    is_active: true, location_type: 'online', location_address: null,
    meeting_link: 'https://meet.example.test/RoomA?token=ABC',
};

/** Store the parameterized writes as DB columns so the result must survive
 * create/update -> SELECT -> mapRow, rather than echoing the input form. */
function fixture(initial: Record<string, unknown> | null = BASE_ROW) {
    let row = initial ? { ...initial } : null;
    const execute = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        if (sql.startsWith('INSERT INTO services')) {
            const columns = sql.match(/INSERT INTO services \(([^)]+)\)/)![1].split(',').map(column => column.trim());
            row = { ...BASE_ROW };
            columns.slice(0, params.length).forEach((column, index) => { row![column] = params[index]; });
            return [];
        }
        if (sql.startsWith('UPDATE services')) {
            for (const match of sql.matchAll(/([a-z_]+) = \$(\d+)/g)) {
                if (match[1] !== 'id') row![match[1]] = params[Number(match[2]) - 1];
            }
            return [{ id: row!.id }];
        }
        if (sql.startsWith('SELECT * FROM services')) return row ? [{ ...row }] : [];
        throw new Error(`Unexpected query: ${sql}`);
    });
    const redis = { del: jest.fn().mockResolvedValue(undefined) };
    const service = new ServicesService({ executeInTenantSchema: execute } as any, redis as any);
    return { service, execute, redis };
}

describe('service location survives the API round trip', () => {
    it('creates a 20-minute online service without requiring a static meeting link', async () => {
        const { service } = fixture(null);
        const created = await service.create(SCHEMA, {
            name: 'Visita virtual', durationMinutes: 20, free: true, locationType: 'online',
            locationAddress: '', meetingLink: '',
        }, TENANT_ID);
        expect(created).toMatchObject({ durationMinutes: 20, locationType: 'online', locationAddress: null, meetingLink: null });
        expect(await service.getById(SCHEMA, created.id)).toMatchObject({ locationType: 'online', durationMinutes: 20 });
    });

    it('creates a hybrid service and returns its trimmed address and unchanged meeting token', async () => {
        const { service } = fixture(null);
        const created = await service.create(SCHEMA, {
            name: 'Asesoría', locationType: 'hybrid', locationAddress: '  Carrera 10, oficina 2  ',
            meetingLink: '  https://meet.example.test/RoomA?token=ABC  ',
        }, TENANT_ID);
        expect(created).toMatchObject({ locationType: 'hybrid', locationAddress: 'Carrera 10, oficina 2', meetingLink: BASE_ROW.meeting_link });
    });

    it('updates modality, address and link and preserves all three on an unrelated edit', async () => {
        const { service, redis } = fixture({ ...BASE_ROW, location_type: 'in_person', meeting_link: null });
        const updated = await service.update(SCHEMA, SERVICE_ID, {
            locationType: 'online', locationAddress: 'Oficina de coordinación', meetingLink: BASE_ROW.meeting_link,
        }, TENANT_ID);
        const expected = { locationType: 'online', locationAddress: 'Oficina de coordinación', meetingLink: BASE_ROW.meeting_link };
        expect(updated).toMatchObject(expected);
        expect(await service.update(SCHEMA, SERVICE_ID, { name: 'Otro nombre' }, TENANT_ID)).toMatchObject(expected);
        expect((await service.list(SCHEMA))[0]).toMatchObject(expected);
        expect(redis.del).toHaveBeenCalledWith(`booking:services:${TENANT_ID}`);
    });

    it('can clear a stored address and link without changing the current modality', async () => {
        const { service } = fixture({ ...BASE_ROW, location_address: 'Sede anterior' });
        expect(await service.update(SCHEMA, SERVICE_ID, { locationAddress: '', meetingLink: null }))
            .toMatchObject({ locationType: 'online', locationAddress: null, meetingLink: null });
    });

    it('defaults only an omitted or legacy empty modality to in_person', async () => {
        const existing = fixture({ ...BASE_ROW, location_type: null, location_address: null, meeting_link: null });
        expect(await existing.service.getById(SCHEMA, SERVICE_ID)).toMatchObject({ locationType: 'in_person' });
        const fresh = fixture(null);
        expect(await fresh.service.create(SCHEMA, { name: 'Consulta' })).toMatchObject({
            locationType: 'in_person', locationAddress: null, meetingLink: null,
        });
    });

    it.each([
        { locationType: 'remote' }, { locationType: null }, { locationType: {} },
        { locationAddress: 12 }, { locationAddress: ['address'] }, { meetingLink: true },
        { meetingLink: 'javascript:alert(1)' }, { meetingLink: 'meet.example.test/RoomA' },
        { meetingLink: 'https://owner:secret@meet.example.test/RoomA' },
        { meetingLink: 'https://meet.example.test/Room\nA' },
    ])('rejects invalid location data before any write: %j', async (data) => {
        const { service, execute, redis } = fixture();
        await expect(service.create(SCHEMA, { name: 'Consulta', ...data }, TENANT_ID)).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.update(SCHEMA, SERVICE_ID, data, TENANT_ID)).rejects.toBeInstanceOf(BadRequestException);
        expect(execute).not.toHaveBeenCalled();
        expect(redis.del).not.toHaveBeenCalled();
    });
});
