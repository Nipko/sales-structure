import * as fs from 'fs';
import * as path from 'path';
import {
    HomeServiceSlotUnavailableError,
    inspectHomeServiceCapacity,
    lockAndAssertHomeServiceCapacity,
    normalizeHomeServiceLocalTimestamp,
} from './home-service-capacity';

describe('home-service capacity contract', () => {
    const serviceId = '11111111-1111-4111-8111-111111111111';
    const input = {
        schemaName: 'tenant_home',
        serviceId,
        startAt: '2030-08-10T09:00:00',
    };

    it('derives the end from the authoritative catalogue duration and uses one overlap predicate', async () => {
        const query = jest.fn(async (sql: string, _params: unknown[] = []) => {
            if (sql.includes('FROM services')) {
                return [{
                    id: serviceId,
                    name: 'Visita de plomería',
                    category: 'plomeria',
                    duration_minutes: 90,
                    max_concurrent: 2,
                }];
            }
            if (sql.includes('COUNT(*)')) return [{ occupied: 1 }];
            throw new Error(`Unexpected SQL: ${sql}`);
        });

        await expect(inspectHomeServiceCapacity(query as any, input)).resolves.toEqual({
            service: {
                id: serviceId,
                name: 'Visita de plomería',
                category: 'plomeria',
                durationMinutes: 90,
                maxConcurrent: 2,
            },
            startAt: '2030-08-10T09:00:00',
            endAt: '2030-08-10T10:30:00',
            occupied: 1,
            available: true,
        });

        const [occupancySql, params] = query.mock.calls[1];
        expect(occupancySql).toContain("status IN ('scheduled', 'dispatched', 'in_progress')");
        expect(occupancySql).toContain('sr.service_id = $3::uuid');
        expect(occupancySql).toContain('sr.service_id IS NULL AND sr.service_type = $4');
        expect(occupancySql).toContain('sr.scheduled_at < $1::timestamp');
        expect(occupancySql).toContain('make_interval');
        expect(params).toEqual([
            '2030-08-10T10:30:00',
            '2030-08-10T09:00:00',
            serviceId,
            'plomeria',
            90,
        ]);
    });

    it('locks the service/date before re-reading capacity and rejects a full window', async () => {
        const calls: string[] = [];
        const query = jest.fn(async (sql: string) => {
            calls.push(sql);
            if (sql.includes('pg_advisory_xact_lock')) return [{ lock_acquired: '1' }];
            if (sql.includes('FROM services')) {
                return [{
                    id: serviceId,
                    name: 'Visita',
                    category: 'plomeria',
                    duration_minutes: 60,
                    max_concurrent: 1,
                }];
            }
            if (sql.includes('COUNT(*)')) return [{ occupied: 1 }];
            throw new Error(`Unexpected SQL: ${sql}`);
        });

        await expect(lockAndAssertHomeServiceCapacity(query as any, input))
            .rejects.toBeInstanceOf(HomeServiceSlotUnavailableError);
        expect(calls[0]).toContain('pg_advisory_xact_lock');
        expect(calls[1]).toContain('FROM services');
        expect(calls[2]).toContain('COUNT(*)');
    });

    it.each([
        'not-a-date',
        '2030-02-30T10:00:00',
        '2030-08-10',
    ])('rejects invalid local timestamps: %s', (value) => {
        expect(() => normalizeHomeServiceLocalTimestamp(value))
            .toThrow(HomeServiceSlotUnavailableError);
    });

    it('provisions the service link and capacity index for new and legacy tenant schemas', () => {
        const schema = fs.readFileSync(
            path.resolve(__dirname, '../../../prisma/tenant-schema.sql'),
            'utf8',
        );
        expect(schema).toContain('ADD CONSTRAINT "service_requests_service_id_fk"');
        expect(schema).toContain('FOREIGN KEY ("service_id")');
        expect(schema).toContain('REFERENCES "{{SCHEMA_NAME}}"."services"("id")');
        expect(schema).toContain('VALIDATE CONSTRAINT "service_requests_service_id_fk"');
        expect(schema).toContain('ADD COLUMN IF NOT EXISTS "service_id" UUID');
        expect(schema).toContain('idx_service_requests_capacity');
        expect(schema).toContain("WHERE \"status\" IN ('scheduled', 'dispatched', 'in_progress')");
    });
});
