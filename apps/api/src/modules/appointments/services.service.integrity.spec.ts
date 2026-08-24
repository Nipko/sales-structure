import { ConflictException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ServicesService } from './services.service';

describe('ServicesService operational-history integrity', () => {
    const schemaPath = path.resolve(__dirname, '../../../prisma/tenant-schema.sql');

    function subject(executeInTenantSchema: jest.Mock) {
        const redis = { del: jest.fn().mockResolvedValue(undefined) };
        const events = { emit: jest.fn() };
        return {
            service: new ServicesService(
                { executeInTenantSchema } as any,
                redis as any,
                events as any,
            ),
            redis,
            events,
        };
    }

    it('provisions and validates an ON DELETE RESTRICT FK after preserving legacy orphan evidence', () => {
        const sql = fs.readFileSync(schemaPath, 'utf8');

        expect(sql).toContain('"service_id" UUID CONSTRAINT "service_requests_service_id_fk"');
        expect(sql).toContain('ADD CONSTRAINT "service_requests_service_id_fk"');
        expect(sql).toContain('FOREIGN KEY ("service_id")');
        expect(sql).toContain('REFERENCES "{{SCHEMA_NAME}}"."services"("id")');
        expect(sql).toContain('ON DELETE RESTRICT');
        expect(sql).toContain('VALIDATE CONSTRAINT "service_requests_service_id_fk"');
        expect(sql).toContain("jsonb_build_object('legacyDeletedServiceId', sr.\"service_id\"::text)");
        expect(sql).toContain('"service_id" = NULL');
    });

    it('reports a typed conflict when a concurrent request wins the FK race', async () => {
        let releaseDelete!: () => void;
        let deleteStarted!: () => void;
        const started = new Promise<void>((resolve) => { deleteStarted = resolve; });
        const requestCommitted = new Promise<void>((resolve) => { releaseDelete = resolve; });
        const fkViolation = Object.assign(new Error('foreign key violation'), {
            meta: { code: '23503', constraint: 'service_requests_service_id_fk' },
        });
        const execute = jest.fn(async () => {
            deleteStarted();
            await requestCommitted;
            throw fkViolation;
        });
        const { service, redis, events } = subject(execute);

        const deletion = service.delete(
            'tenant_home',
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
        );
        await started;
        releaseDelete(); // the concurrent service_request now references it

        let failure: unknown;
        try {
            await deletion;
        } catch (error) {
            failure = error;
        }
        expect(failure).toBeInstanceOf(ConflictException);
        expect((failure as ConflictException).getResponse()).toEqual({
            error: 'service_has_operational_history',
            message: 'No se puede eliminar un servicio con reservas o solicitudes asociadas. Desactívalo para conservar su historial.',
        });
        expect(redis.del).not.toHaveBeenCalled();
        expect(events.emit).not.toHaveBeenCalled();
    });

    it('also recognizes the direct PostgreSQL error shape and never hides unrelated failures', async () => {
        const directFk = subject(jest.fn().mockRejectedValue({ code: '23503' }));
        await expect(directFk.service.delete('tenant_home', '11111111-1111-4111-8111-111111111111'))
            .rejects.toBeInstanceOf(ConflictException);

        const unrelated = new Error('database unavailable');
        const databaseFailure = subject(jest.fn().mockRejectedValue(unrelated));
        await expect(databaseFailure.service.delete('tenant_home', '11111111-1111-4111-8111-111111111111'))
            .rejects.toBe(unrelated);
    });

    it('invalidates caches and quality evidence only after a successful delete', async () => {
        const execute = jest.fn().mockResolvedValue([]);
        const { service, redis, events } = subject(execute);

        await service.delete(
            'tenant_home',
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
        );

        expect(execute).toHaveBeenCalledWith(
            'tenant_home',
            'DELETE FROM services WHERE id = $1::uuid',
            ['11111111-1111-4111-8111-111111111111'],
        );
        expect(redis.del).toHaveBeenCalledWith(
            'booking:services:22222222-2222-4222-8222-222222222222',
        );
        expect(events.emit).toHaveBeenCalledWith(
            'agent-quality.dependencies.updated',
            expect.objectContaining({ source: 'services' }),
        );
    });
});
