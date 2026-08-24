import {
    EXTERNAL_WRITES_DISABLED,
    OUTBOX_MAX_ATTEMPTS,
    checkAdapterContract,
    deriveIdempotencyKey,
    externalWriteGateFor,
    outboxBackoffSeconds,
    reconcile,
    webhookDedupeKey,
} from '@parallext/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IntegrationOutboxService } from './integration-outbox.service';

/**
 * Cada integración resolvía los mismos cuatro problemas de nuevo y distinto:
 * cómo no perder una escritura con el proveedor caído, cómo no procesar dos
 * veces el mismo webhook, cómo saber si los dos lados siguen diciendo lo mismo,
 * y cómo probar el adapter sin credenciales.
 *
 * Cuatro problemas × N proveedores = N formas distintas de fallar.
 *
 * Y los escritores externos **están apagados**: la intención se registra y se
 * reintenta, pero la llamada real no sale hasta que la plataforma certifique
 * ese proveedor contra un sandbox. Un andamiaje que se enciende solo cuando
 * alguien conecta credenciales es cómo se manda la primera escritura a
 * producción sin que nadie la haya probado.
 */

const schemaName = 'tenant_integrations';
const tenantId = '11111111-1111-4111-8111-111111111111';
const claimedOutbox = (attempts = 0) => ({
    id: '22222222-2222-4222-8222-222222222222',
    provider: 'hostaway',
    operation: 'create_reservation',
    idempotencyKey: 'idem-1',
    payload: {},
    status: 'in_flight' as const,
    attempts,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    claim: {
        token: '55555555-5555-4555-8555-555555555555',
        generation: 4,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
});
const claimedWebhook = () => ({
    id: '33333333-3333-4333-8333-333333333333',
    provider: 'hostaway',
    externalEventId: 'evt-1',
    eventType: 'reservation.updated',
    payload: {},
    status: 'processing' as const,
    attempts: 0,
    receivedAt: new Date().toISOString(),
    claim: {
        token: '66666666-6666-4666-8666-666666666666',
        generation: 2,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
});

function buildService(rows: any[][] = [], registryMatch = true) {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        queries.push({ sql, params });
        return rows.shift() ?? [];
    });
    // `enqueue` repara el schema antes de insertar: los schemas creados antes
    // de que existiera el andamiaje no tienen sus tablas, y un `42P01` ahí
    // hacía perder la intención en silencio.
    const ensureCanonicalTables = jest.fn().mockResolvedValue(undefined);
    const transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => callback(
        async (sql: string, params: any[] = []) => {
            queries.push({ sql, params });
            if (/INSERT INTO public\.integration_work_tenants/.test(sql)) {
                return registryMatch ? [{ tenant_id: tenantId }] : [];
            }
            return rows.shift() ?? [];
        },
    ));
    const $queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const service = new IntegrationOutboxService(
        {
            executeInTenantSchema,
            transactionInTenantSchema,
            ensureCanonicalTables,
            $queryRawUnsafe,
        } as any,
    );
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'debug').mockImplementation(() => undefined);
    return { service, queries, transactionInTenantSchema, $queryRawUnsafe };
}

describe('las escrituras externas están apagadas', () => {
    const original = process.env.INTEGRATION_WRITE_PROVIDERS;
    afterEach(() => { process.env.INTEGRATION_WRITE_PROVIDERS = original; });

    it('sin allowlist, ningún proveedor escribe', () => {
        delete process.env.INTEGRATION_WRITE_PROVIDERS;
        expect(externalWriteGateFor('hostaway', undefined)).toEqual(EXTERNAL_WRITES_DISABLED);
        expect(externalWriteGateFor('toast', '')).toEqual(EXTERNAL_WRITES_DISABLED);
    });

    it('la allowlist es POR proveedor: certificar uno no certifica el otro', () => {
        // Un `INTEGRATIONS_WRITE=true` global habría encendido los dos.
        expect(externalWriteGateFor('hostaway', 'hostaway').enabled).toBe(true);
        expect(externalWriteGateFor('toast', 'hostaway').enabled).toBe(false);
    });

    it('la intención se encola igual con el interruptor apagado', async () => {
        // Descartarla sería perder la operación silenciosamente. Queda como
        // `suppressed`, y el día que el proveedor se certifique, sale.
        delete process.env.INTEGRATION_WRITE_PROVIDERS;
        const { service, queries } = buildService([[{ id: 'o1', status: 'suppressed' }]]);

        const result = await service.enqueue(schemaName, {
            tenantId, provider: 'hostaway', operation: 'create_reservation', subjectId: 'b1',
        });

        expect(result.suppressed).toBe(true);
        expect(queries[0].params).toContain('suppressed');
    });

    it('registra el tenant en la misma transacción que la intención durable', async () => {
        const { service, queries, transactionInTenantSchema } = buildService([
            [{ id: 'o1', status: 'suppressed' }],
        ]);

        await service.enqueue(schemaName, {
            tenantId, provider: 'hostaway', operation: 'create_reservation', subjectId: 'b1',
        });

        expect(transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(queries.map(query => query.sql)).toEqual(expect.arrayContaining([
            expect.stringContaining('INSERT INTO integration_outbox'),
            expect.stringContaining('INSERT INTO public.integration_work_tenants'),
        ]));
        expect(queries.find(query => /integration_work_tenants/.test(query.sql))?.params)
            .toEqual([tenantId, schemaName]);
        expect(queries.find(query => /integration_work_tenants/.test(query.sql))?.sql)
            .toContain('AND schema_name = $2');
    });

    it('revierte la intención si tenant y schema no pertenecen al mismo registro', async () => {
        const { service } = buildService([[{ id: 'o1', status: 'suppressed' }]], false);

        await expect(service.enqueue(schemaName, {
            tenantId, provider: 'hostaway', operation: 'create_reservation', subjectId: 'b1',
        })).rejects.toThrow('tenant/schema mismatch');
    });

    it('no se toma nada para correr mientras esté apagado', async () => {
        delete process.env.INTEGRATION_WRITE_PROVIDERS;
        const { service, queries } = buildService();

        expect(await service.claim(schemaName, 'hostaway')).toEqual([]);
        expect(queries).toEqual([]);
    });

    it('el motivo se puede mostrar en el panel', () => {
        delete process.env.INTEGRATION_WRITE_PROVIDERS;
        const { service } = buildService();
        expect(service.disabledReason('hostaway')).toBe('external_writer_not_certified');
    });
});

describe('la clave de idempotencia sale del hecho, no de un contador', () => {
    it('dos llamadores del mismo hecho derivan la misma clave', () => {
        // Un UUID por intento habría creado una reserva nueva en cada reintento
        // — el modo de falla exacto que un outbox existe para evitar.
        const input = { tenantId, provider: 'hostaway', operation: 'create', subjectId: 'b1' };
        expect(deriveIdempotencyKey(input)).toBe(deriveIdempotencyKey(input));
    });

    it('hechos distintos derivan claves distintas', () => {
        const base = { tenantId, provider: 'hostaway', operation: 'create' };
        expect(deriveIdempotencyKey({ ...base, subjectId: 'b1' }))
            .not.toBe(deriveIdempotencyKey({ ...base, subjectId: 'b2' }));
    });

    it('una clave incompleta falla en vez de colisionar', () => {
        // Una clave con un hueco colisiona con cualquier otra que tenga el
        // mismo hueco, y eso deduplica dos escrituras que no son la misma.
        expect(() => deriveIdempotencyKey({
            tenantId, provider: 'hostaway', operation: '', subjectId: 'b1',
        })).toThrow();
    });

    it('el outbox deduplica por (proveedor, clave)', async () => {
        const { service, queries } = buildService([[{ id: 'o1', status: 'pending' }]]);
        process.env.INTEGRATION_WRITE_PROVIDERS = 'hostaway';

        await service.enqueue(schemaName, {
            tenantId, provider: 'hostaway', operation: 'create', subjectId: 'b1',
        });

        expect(queries[0].sql).toContain('ON CONFLICT (provider, idempotency_key)');
    });
});

describe('un worker muerto no congela una escritura', () => {
    it('el arrendamiento vencido se vuelve a tomar', async () => {
        // Sin esto, un reinicio en el momento equivocado deja una reserva en
        // `in_flight` hasta que alguien la mira a mano.
        process.env.INTEGRATION_WRITE_PROVIDERS = 'hostaway';
        const { service, queries } = buildService([[]]);

        await service.claim(schemaName, 'hostaway');

        expect(queries[0].sql).toContain('lease_expires_at < NOW()');
        expect(queries[0].sql).toContain('FOR UPDATE SKIP LOCKED');
        expect(queries[0].sql).toContain('claim_token = gen_random_uuid()');
        expect(queries[0].sql).toContain('claim_generation = claim_generation + 1');
    });

    it('la espera crece pero tiene techo', () => {
        // Sin techo, el octavo intento cae a horas y una caída de diez minutos
        // del proveedor deja escrituras esperando media tarde.
        expect(outboxBackoffSeconds(1)).toBeLessThan(outboxBackoffSeconds(4));
        expect(outboxBackoffSeconds(OUTBOX_MAX_ATTEMPTS)).toBeLessThanOrEqual(900);
        expect(outboxBackoffSeconds(99)).toBeLessThanOrEqual(900);
    });

    it('morir es una decisión, no un accidente', async () => {
        // Una escritura que reintenta para siempre es una que nadie mira nunca.
        const entry = claimedOutbox(OUTBOX_MAX_ATTEMPTS - 1);
        const { service, queries } = buildService([[{ status: 'dead' }]]);

        expect(await service.markFailed(schemaName, entry, 'timeout')).toBe('dead');
        expect(queries[0].params).toContain('dead');
        expect(queries[0].params).toEqual(expect.arrayContaining([
            entry.claim.token,
            entry.claim.generation,
        ]));
    });

    it('antes del límite, reintenta', async () => {
        const { service } = buildService([[{ status: 'retrying' }]]);
        expect(await service.markFailed(schemaName, claimedOutbox(1), 'timeout')).toBe('retrying');
    });

    it('un resultado de una generación vencida no puede pisar la nueva', async () => {
        const entry = claimedOutbox();
        const { service, queries } = buildService([[]]);

        await expect(service.markDelivered(schemaName, entry, 'remote-1')).resolves.toBe(false);

        expect(queries[0].sql).toContain('claim_token = $3::uuid');
        expect(queries[0].sql).toContain('claim_generation = $4');
        expect(queries[0].sql).toContain('lease_expires_at > NOW()');
        expect(queries[0].params).toEqual([
            entry.id,
            'remote-1',
            entry.claim.token,
            entry.claim.generation,
        ]);
    });
});

describe('un webhook no se procesa dos veces', () => {
    it('el dedupe va por proveedor Y evento', () => {
        // Dos proveedores pueden usar el mismo contador y no hay nada que lo
        // impida.
        expect(webhookDedupeKey('hostaway', '1')).not.toBe(webhookDedupeKey('toast', '1'));
    });

    it('un reenvío se reconoce como duplicado', async () => {
        const { service } = buildService([[], [{ id: 'w1' }]]);

        const result = await service.receiveWebhook(schemaName, {
            tenantId, provider: 'hostaway', externalEventId: 'evt-1', eventType: 'reservation.created',
        });

        expect(result.duplicate).toBe(true);
    });

    it('el primero no es duplicado', async () => {
        const { service } = buildService([[{ id: 'w1' }]]);

        const result = await service.receiveWebhook(schemaName, {
            tenantId, provider: 'hostaway', externalEventId: 'evt-1', eventType: 'reservation.created',
        });

        expect(result).toEqual({ id: 'w1', duplicate: false });
    });

    it('registra el tenant en la misma transacción que el webhook', async () => {
        const { service, queries, transactionInTenantSchema } = buildService([[{ id: 'w1' }]]);

        await service.receiveWebhook(schemaName, {
            tenantId, provider: 'hostaway', externalEventId: 'evt-1', eventType: 'reservation.created',
        });

        expect(transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(queries[0].sql).toContain('INSERT INTO integration_webhook_inbox');
        expect(queries[1].sql).toContain('INSERT INTO public.integration_work_tenants');
        expect(queries[1].sql).toContain('webhook_seen_at');
    });

    it('un worker webhook vencido tampoco puede confirmar sobre el reclaim', async () => {
        const entry = claimedWebhook();
        const { service, queries } = buildService([[]]);

        await expect(service.markWebhookProcessed(schemaName, entry)).resolves.toBe(false);

        expect(queries[0].sql).toContain('claim_token = $4::uuid');
        expect(queries[0].sql).toContain('claim_generation = $5');
        expect(queries[0].sql).toContain('lease_expires_at > NOW()');
        expect(queries[0].params).toEqual(expect.arrayContaining([
            entry.claim.token,
            entry.claim.generation,
        ]));
    });
});

describe('el registro global de trabajo de integraciones', () => {
    it('se crea indexado, con borrado en cascada y backfill único', () => {
        const migration = fs.readFileSync(path.resolve(
            __dirname,
            '../../../prisma/migrations/20260824100000_add_integration_work_registry/migration.sql',
        ), 'utf8');

        expect(migration).toContain('CREATE TABLE IF NOT EXISTS "public"."integration_work_tenants"');
        expect(migration).toContain('ON DELETE CASCADE');
        expect(migration).toContain('idx_integration_work_tenants_outbox');
        expect(migration).toContain('idx_integration_work_tenants_webhook');
        expect(migration).toContain('integration_outbox LIMIT 1');
        expect(migration).toContain('integration_webhook_inbox LIMIT 1');
    });

    it.each([
        ['outbox', 'outbox_seen_at'],
        ['webhook', 'webhook_seen_at'],
    ] as const)('consulta %s por su columna fija, nunca todos los tenants', async (kind, column) => {
        const { service, $queryRawUnsafe } = buildService();

        await service.trackedTenants(kind);

        const statement = String($queryRawUnsafe.mock.calls[0][0]);
        expect(statement).toContain('public.integration_work_tenants');
        expect(statement).toContain(column);
        expect(statement).not.toMatch(/FROM public\.tenants\s+WHERE/i);
    });
});

describe('la reconciliación reporta, no corrige', () => {
    const compare = (a: any, b: any) => (a.status !== b.status
        ? [{ field: 'status', localValue: a.status, remoteValue: b.status }]
        : []);

    it('encuentra lo que falta de cada lado y lo que no coincide', () => {
        const report = reconcile(
            'hostaway',
            [{ id: 'a', status: 'confirmed' }, { id: 'b', status: 'confirmed' }],
            [{ id: 'a', status: 'cancelled' }, { id: 'c', status: 'confirmed' }],
            compare,
            '2026-08-21T00:00:00.000Z',
        );

        expect(report.drift).toEqual(expect.arrayContaining([
            { kind: 'value_mismatch', subjectId: 'a', field: 'status', localValue: 'confirmed', remoteValue: 'cancelled' },
            { kind: 'missing_remote', subjectId: 'b' },
            { kind: 'missing_local', subjectId: 'c' },
        ]));
    });

    it('no devuelve nada que se parezca a una corrección', () => {
        // Corregir automáticamente es cómo una lectura desactualizada del
        // proveedor borra una reserva local que sí existe.
        const report = reconcile('hostaway', [{ id: 'a', status: 'x' }], [], compare, 'now');
        expect(Object.keys(report)).not.toContain('applied');
        expect(Object.keys(report)).not.toContain('fixed');
    });

    it('guarda el reporte con su marca de incompleto', async () => {
        const { service, queries } = buildService([[]]);

        await service.recordReconciliation(schemaName, {
            provider: 'hostaway', checkedAt: 'now', localCount: 1, remoteCount: 0,
            drift: [], incomplete: true,
        });

        // "Sin drift" e "incompleta" son cosas distintas, y confundirlas es
        // declarar sanas dos integraciones que nunca se compararon.
        expect(queries[0].params).toContain(true);
    });
});

describe('un adapter se verifica sin credenciales', () => {
    it('un adapter correcto pasa todo lo verificable', async () => {
        const findings = await checkAdapterContract({
            provider: 'demo',
            list: async () => [{ id: 'r1' }],
        });
        expect(findings.every(f => f.passed)).toBe(true);
    });

    it('un item sin id no se puede reconciliar ni deduplicar', async () => {
        const findings = await checkAdapterContract({
            provider: 'demo',
            list: async () => [{ id: '' } as any],
        });
        expect(findings.find(f => f.check === 'list_items_have_id')!.passed).toBe(false);
    });

    it('un `list` que tira se reporta, no rompe el kit', async () => {
        const findings = await checkAdapterContract({
            provider: 'demo',
            list: async () => { throw new Error('no creds'); },
        });
        const listCheck = findings.find(f => f.check === 'list_returns_array')!;
        expect(listCheck.passed).toBe(false);
        expect(listCheck.detail).toContain('no creds');
    });

    it('un adapter sin proveedor no es un adapter', async () => {
        const findings = await checkAdapterContract({
            provider: '  ',
            list: async () => [],
        });
        expect(findings.find(f => f.check === 'provider_named')!.passed).toBe(false);
    });

    it('un adapter de sólo lectura es válido', async () => {
        // Es el estado de TODOS hoy. Declarar `write` y tirar sería peor: el
        // outbox lo trataría como entregable y lo reintentaría ocho veces.
        const findings = await checkAdapterContract({ provider: 'demo', list: async () => [] });
        expect(findings.find(f => f.check === 'write_declared_only_if_implemented')!.passed).toBe(true);
    });
});
