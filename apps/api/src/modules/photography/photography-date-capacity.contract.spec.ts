import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    InvalidPhotoDateError,
    PhotoDateUnavailableError,
    lockAndAssertPhotoDateCapacity,
    normalizePhotoLocalDate,
    readPhotoDateCapacity,
} from './photography-date-capacity';

describe('photography date capacity contract', () => {
    it('rejects impossible tenant-local dates before touching the database', async () => {
        const query = jest.fn();
        expect(() => normalizePhotoLocalDate('2026-02-30')).toThrow(InvalidPhotoDateError);
        await expect(readPhotoDateCapacity(query, 'not-a-date')).rejects
            .toBeInstanceOf(InvalidPhotoDateError);
        expect(query).not.toHaveBeenCalled();
    });

    it('counts active quote holds, committed sessions and appointments in one predicate', async () => {
        const query = jest.fn().mockResolvedValue([{
            blocked: false,
            appointment_count: 1,
            session_count: 2,
        }]);

        await expect(readPhotoDateCapacity(
            query,
            '2026-09-10',
            '11111111-1111-4111-8111-111111111111',
        )).resolves.toEqual({
            date: '2026-09-10',
            blocked: false,
            appointmentCount: 1,
            sessionCount: 2,
            taken: 3,
            available: false,
        });
        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain("p.status = 'requested' AND p.hold_expires_at > NOW()");
        expect(sql).toContain("p.status IN ('scheduled', 'in_progress')");
        expect(sql).toContain("a.status IN ('pending', 'confirmed', 'pending_payment')");
        expect(sql).toContain('p.id <> $2::uuid');
        expect(params).toEqual([
            '2026-09-10',
            '11111111-1111-4111-8111-111111111111',
        ]);
    });

    it('locks the date before re-reading and refuses a competing commit', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{ lock_acquired: '' }])
            .mockResolvedValueOnce([{
                blocked: false,
                appointment_count: 0,
                session_count: 1,
            }]);

        await expect(lockAndAssertPhotoDateCapacity(query, {
            schemaName: 'tenant_photography',
            date: '2026-09-10',
        })).rejects.toMatchObject({
            code: 'photo_date_unavailable',
            date: '2026-09-10',
        });
        expect(query).toHaveBeenCalledTimes(2);
        expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
        expect(query.mock.calls[0][1]).toEqual([
            'photo-date:tenant_photography:2026-09-10',
        ]);
        expect(query.mock.calls[1][0]).toContain('AS session_count');
    });

    it('returns capacity only after the locked recheck is empty', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{ lock_acquired: '' }])
            .mockResolvedValueOnce([{
                blocked: false,
                appointment_count: 0,
                session_count: 0,
            }]);

        await expect(lockAndAssertPhotoDateCapacity(query, {
            schemaName: 'tenant_photography',
            date: '2026-09-10',
        })).resolves.toMatchObject({ available: true, taken: 0 });
    });

    it('provisions the hold clock for new and existing tenant schemas', () => {
        const sql = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const compatibilityAlter =
            'ALTER TABLE "{{SCHEMA_NAME}}"."photo_sessions"\n    ADD COLUMN IF NOT EXISTS "hold_expires_at" TIMESTAMPTZ;';
        const capacityIndex = 'CREATE INDEX IF NOT EXISTS "idx_photo_sessions_capacity"';
        const photoTable = sql.slice(
            sql.indexOf('CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."photo_sessions"'),
            sql.indexOf('-- ============================================================',
                sql.indexOf('CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."photo_sessions"')),
        );
        expect(photoTable).toContain('"hold_expires_at" TIMESTAMPTZ');
        expect(sql).toContain(compatibilityAlter);
        expect(sql).toContain(capacityIndex);
        expect(sql.indexOf(compatibilityAlter)).toBeLessThan(sql.indexOf(capacityIndex));
    });
});
