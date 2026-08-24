import { IntegrationOutboxWorker } from './integration-outbox.worker';
import { IntegrationOutboxService } from './integration-outbox.service';
import { deriveIdempotencyKey, type IntegrationWriteAdapter } from '@parallext/shared';

/**
 * ═══ EL ANDAMIAJE NO TENÍA QUIÉN LO CORRIERA ═══
 *
 * El outbox tenía cola, arrendamiento, reintentos con espera, muerte por
 * agotamiento, dedupe de webhooks y reconciliación — y **cero llamadores**.
 * Ningún módulo lo importaba, ningún proceso drenaba la cola. Una escritura
 * encolada se quedaba encolada para siempre.
 *
 * Y la promesa escrita en el propio servicio —"el día que el proveedor se
 * certifique, sale"— no la cumplía nadie: las entradas nacían `suppressed` y
 * `claim` sólo mira `pending`/`retrying`, así que encender el interruptor no
 * liberaba nada de lo acumulado.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_outbox';

function buildWorker(options: {
    entries?: any[];
    adapter?: IntegrationWriteAdapter;
    certified?: string;
    staleTransitions?: boolean;
} = {}) {
    process.env.INTEGRATION_WRITE_PROVIDERS = options.certified ?? '';
    const sql: Array<{ sql: string; params: any[] }> = [];
    const prisma: any = {
        ensureCanonicalTables: jest.fn().mockResolvedValue(undefined),
        executeInTenantSchema: jest.fn(async (_s: string, statement: string, params: any[] = []) => {
            sql.push({ sql: statement, params });
            if (/UPDATE integration_outbox\s+SET status = 'in_flight'/.test(statement)) {
                return options.entries ?? [];
            }
            if (/AND claim_token = \$\d+::uuid/.test(statement) && /RETURNING/.test(statement)) {
                return options.staleTransitions ? [] : [{ id: entry().id, status: 'updated' }];
            }
            return [];
        }),
        transactionInTenantSchema: jest.fn(async (_s: string, callback: any) => callback(
            async (statement: string, params: any[] = []) => {
                sql.push({ sql: statement, params });
                if (/INSERT INTO integration_outbox/.test(statement)) {
                    return [{ id: entry().id, status: 'suppressed' }];
                }
                if (/INSERT INTO public\.integration_work_tenants/.test(statement)) {
                    return [{ tenant_id: tenantId }];
                }
                return [];
            },
        )),
        $queryRawUnsafe: jest.fn().mockResolvedValue([
            { id: tenantId, schemaName, name: 'Tenant' },
        ]),
    };
    const outbox = new IntegrationOutboxService(prisma);
    for (const level of ['log', 'warn', 'debug'] as const) {
        jest.spyOn((outbox as any).logger, level).mockImplementation(() => undefined);
    }
    const worker = new IntegrationOutboxWorker(outbox, { runExclusive: jest.fn() } as any);
    for (const level of ['log', 'warn', 'debug'] as const) {
        jest.spyOn((worker as any).logger, level).mockImplementation(() => undefined);
    }
    if (options.adapter) worker.register(options.adapter);
    return { worker, outbox, prisma, sql };
}

const entry = (over: Record<string, any> = {}) => ({
    id: '33333333-3333-4333-8333-333333333333',
    provider: 'hostaway',
    operation: 'create_reservation',
    idempotency_key: 'k',
    payload: {},
    status: 'in_flight',
    attempts: 0,
    claim_token: '55555555-5555-4555-8555-555555555555',
    claim_generation: 1,
    lease_expires_at: new Date(Date.now() + 300_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
});

describe('el registro de adapters', () => {
    afterEach(() => { delete process.env.INTEGRATION_WRITE_PROVIDERS; });

    it('empieza vacío: hoy no hay ninguna integración externa certificada', () => {
        const { worker } = buildWorker();
        expect(worker.registeredProviders()).toEqual([]);
    });

    it('rechaza dos adapters para el mismo proveedor en vez de pisar uno', () => {
        // Cuál gana dependería del orden de carga de los módulos: un defecto
        // que se ve distinto en cada despliegue.
        const adapter: IntegrationWriteAdapter = {
            provider: 'hostaway', operations: ['create_reservation'],
            write: jest.fn(),
        };
        const { worker } = buildWorker({ adapter });
        expect(() => worker.register({ ...adapter })).toThrow(/hostaway/);
    });

    it('un adapter sin proveedor no se registra', () => {
        const { worker } = buildWorker();
        expect(() => worker.register({
            provider: '  ', operations: [], write: jest.fn(),
        })).toThrow();
    });
});

describe('el barrido visita sólo tenants con trabajo registrado', () => {
    afterEach(() => { delete process.env.INTEGRATION_WRITE_PROVIDERS; });

    it('consulta el registro público indexado y no la tabla completa de tenants', async () => {
        const { worker, prisma } = buildWorker();

        await worker.drainAll();

        expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        const statement = String(prisma.$queryRawUnsafe.mock.calls[0][0]);
        expect(statement).toContain('public.integration_work_tenants');
        expect(statement).toContain('outbox_seen_at');
        expect(prisma.tenant).toBeUndefined();
    });
});

describe('sin adapter, la activación incompleta conserva intención suprimida', () => {
    afterEach(() => { delete process.env.INTEGRATION_WRITE_PROVIDERS; });

    it('allowlist sin adapter no libera ni mata la entrada', async () => {
        const { worker, sql } = buildWorker({
            certified: 'hostaway',
            entries: [entry()],
        });

        const result = await worker.drainTenant(tenantId, schemaName);

        expect(result.failed).toBe(0);
        expect(sql.find(c => /SET status = 'pending'/.test(c.sql))).toBeUndefined();
        expect(sql.find(c => /SET status = 'in_flight'/.test(c.sql))).toBeUndefined();
        const kill = sql.find(c => /status = 'dead'/.test(c.sql));
        expect(kill).toBeUndefined();
    });

    it('una operación que el adapter no declara tampoco', async () => {
        // Sin esta comprobación la operación desconocida llega hasta adentro y
        // explota con `undefined is not a function`, que no dice nada.
        const write = jest.fn();
        const { worker, sql } = buildWorker({
            certified: 'hostaway',
            entries: [entry({ operation: 'cancel_reservation' })],
            adapter: { provider: 'hostaway', operations: ['create_reservation'], write },
        });

        await worker.drainTenant(tenantId, schemaName);

        expect(write).not.toHaveBeenCalled();
        const kill = sql.find(c => /status = 'dead'/.test(c.sql));
        expect(kill!.params.some((p: any) => String(p).includes('operation_not_supported'))).toBe(true);
    });
});

describe('con adapter, entrega de verdad', () => {
    afterEach(() => { delete process.env.INTEGRATION_WRITE_PROVIDERS; });

    it('el id externo del proveedor queda guardado para poder reconciliar', async () => {
        const { worker, sql } = buildWorker({
            certified: 'hostaway',
            entries: [entry()],
            adapter: {
                provider: 'hostaway', operations: ['create_reservation'],
                write: jest.fn().mockResolvedValue({ ok: true, externalId: 'HA-9001' }),
            },
        });

        const result = await worker.drainTenant(tenantId, schemaName);

        expect(result.delivered).toBe(1);
        const delivered = sql.find(c => /status = 'delivered'/.test(c.sql));
        expect(delivered!.params).toContain('HA-9001');
    });

    it('un worker cuyo token fue reemplazado no confirma sobre la nueva generación', async () => {
        const { worker, sql } = buildWorker({
            certified: 'hostaway',
            entries: [entry()],
            staleTransitions: true,
            adapter: {
                provider: 'hostaway', operations: ['create_reservation'],
                write: jest.fn().mockResolvedValue({ ok: true, externalId: 'late-result' }),
            },
        });

        await expect(worker.drainTenant(tenantId, schemaName)).resolves.toMatchObject({
            delivered: 0,
            failed: 1,
        });
        const attemptedCas = sql.find(c => /status = 'delivered'/.test(c.sql));
        expect(attemptedCas?.sql).toContain('claim_generation = $4');
        expect(attemptedCas?.sql).toContain('lease_expires_at > NOW()');
        expect(attemptedCas?.params).toEqual(expect.arrayContaining([
            '55555555-5555-4555-8555-555555555555',
            1,
        ]));
    });

    it('un fallo recuperable reintenta con espera', async () => {
        const { worker, sql } = buildWorker({
            certified: 'hostaway',
            entries: [entry()],
            adapter: {
                provider: 'hostaway', operations: ['create_reservation'],
                write: jest.fn().mockResolvedValue({ ok: false, error: 'provider_timeout' }),
            },
        });

        await worker.drainTenant(tenantId, schemaName);

        const failed = sql.find(c => /SET status = \$2, attempts/.test(c.sql));
        expect(failed!.params[1]).toBe('retrying');
    });

    it('un fallo NO recuperable muere en el acto', async () => {
        // Un payload que el proveedor rechaza por inválido no mejora
        // esperando: ocho reintentos son ocho llamadas inútiles y ocho veces
        // más tarde que alguien lo mire.
        const { worker, sql } = buildWorker({
            certified: 'hostaway',
            entries: [entry()],
            adapter: {
                provider: 'hostaway', operations: ['create_reservation'],
                write: jest.fn().mockResolvedValue({
                    ok: false, error: 'invalid_payload', retryable: false,
                }),
            },
        });

        await worker.drainTenant(tenantId, schemaName);

        expect(sql.find(c => /status = 'dead'/.test(c.sql))!.params).toContain('invalid_payload');
    });

    it('una excepción del adapter no tumba el tick', async () => {
        const { worker } = buildWorker({
            certified: 'hostaway',
            entries: [entry()],
            adapter: {
                provider: 'hostaway', operations: ['create_reservation'],
                write: jest.fn().mockRejectedValue(new Error('socket hang up')),
            },
        });

        await expect(worker.drainTenant(tenantId, schemaName)).resolves.toMatchObject({ failed: 1 });
    });
});

describe('lo suprimido se libera cuando el proveedor se certifica', () => {
    afterEach(() => { delete process.env.INTEGRATION_WRITE_PROVIDERS; });

    it('con el interruptor apagado no libera nada', async () => {
        const { outbox, sql } = buildWorker();
        await outbox.releaseSuppressed(schemaName, 'hostaway', false);
        expect(sql.find(c => /status = 'pending'/.test(c.sql))).toBeUndefined();
    });

    it('con el interruptor encendido, sí', async () => {
        const { outbox, sql } = buildWorker({ certified: 'hostaway' });
        await outbox.releaseSuppressed(schemaName, 'hostaway', true);
        const release = sql.find(c => /SET status = 'pending'/.test(c.sql));
        expect(release).toBeDefined();
        expect(release!.params).toEqual(['hostaway']);
    });

    it('vence ANTES de liberar', async () => {
        // Liberar una entrada de hace tres meses la mandaría al proveedor como
        // si fuera de hoy: una reserva que nadie pidió, para una fecha que ya
        // pasó, en el calendario de alguien que no la espera.
        const { outbox, sql } = buildWorker({ certified: 'hostaway' });
        await outbox.releaseSuppressed(schemaName, 'hostaway', true);

        const expireAt = sql.findIndex(c => /status = 'expired'/.test(c.sql));
        const releaseAt = sql.findIndex(c => /SET status = 'pending'/.test(c.sql));
        expect(expireAt).toBeGreaterThanOrEqual(0);
        expect(expireAt).toBeLessThan(releaseAt);
    });

    it('el vencimiento sólo toca estados no terminales', async () => {
        const { outbox, sql } = buildWorker();
        await outbox.expireStale(schemaName);
        const expire = sql.find(c => /status = 'expired'/.test(c.sql));
        // Vencer una entregada la desharía en el registro; vencer una muerta
        // borraría el motivo por el que murió.
        expect(expire!.params[0]).toEqual(['pending', 'retrying', 'suppressed']);
    });
});

describe('la identidad es por conexión, no sólo por proveedor', () => {
    it('dos cuentas del mismo proveedor derivan claves distintas', () => {
        // Con la clave anterior el mismo hecho de negocio mandado a dos cuentas
        // de Hostaway chocaba contra la misma fila y la segunda escritura
        // desaparecía: el `ON CONFLICT` la convertía en un toque de
        // `updated_at`.
        const base = {
            tenantId, provider: 'hostaway',
            operation: 'create_reservation', subjectId: 'booking-1',
        };
        const a = deriveIdempotencyKey({ ...base, connectionId: 'cuenta-a' });
        const b = deriveIdempotencyKey({ ...base, connectionId: 'cuenta-b' });
        expect(a).not.toBe(b);
    });

    it('sin conexión la clave no cambia de forma', () => {
        // Cambiar la forma de todas convertiría cada pendiente en una entrada
        // nueva, y el proveedor recibiría la operación dos veces.
        const base = {
            tenantId, provider: 'hostaway',
            operation: 'create_reservation', subjectId: 'booking-1',
        };
        expect(deriveIdempotencyKey(base))
            .toBe(`${tenantId}:hostaway:create_reservation:booking-1`);
        expect(deriveIdempotencyKey({ ...base, connectionId: '' })).toBe(deriveIdempotencyKey(base));
    });

    it('el mismo hecho en la misma conexión sigue siendo un reintento', () => {
        const input = {
            tenantId, provider: 'hostaway', operation: 'create_reservation',
            subjectId: 'booking-1', connectionId: 'cuenta-a',
        };
        expect(deriveIdempotencyKey(input)).toBe(deriveIdempotencyKey({ ...input }));
    });
});

describe('encolar repara el schema de un tenant viejo', () => {
    afterEach(() => { delete process.env.INTEGRATION_WRITE_PROVIDERS; });

    it('pide las tablas canónicas antes de insertar', async () => {
        // Los schemas creados antes de que existiera el andamiaje no tienen sus
        // tablas. Insertar contra una tabla ausente tiraba `42P01` y el
        // llamador —que suele estar en un `.catch()`— perdía la intención en
        // silencio: exactamente lo que un outbox existe para impedir.
        const { outbox, prisma } = buildWorker();
        await outbox.enqueue(schemaName, {
            tenantId, provider: 'hostaway',
            operation: 'create_reservation', subjectId: 'booking-1',
        });
        expect(prisma.ensureCanonicalTables).toHaveBeenCalledWith(
            schemaName,
            expect.arrayContaining(['integration_outbox', 'integration_webhook_inbox']),
        );
    });

    it('la conexión viaja a la fila', async () => {
        const { outbox, sql } = buildWorker();
        await outbox.enqueue(schemaName, {
            tenantId, provider: 'hostaway', operation: 'create_reservation',
            subjectId: 'booking-1', connectionId: 'cuenta-a',
        });
        const insert = sql.find(c => /INSERT INTO integration_outbox/.test(c.sql));
        expect(insert!.params[1]).toBe('cuenta-a');
    });

    it('sin conexión se guarda NULL, no la cadena vacía', async () => {
        // Una cadena vacía es un valor; NULL es "no aplica". Con la cadena, un
        // índice futuro por conexión agruparía a todas las filas bajo una
        // conexión llamada "".
        const { outbox, sql } = buildWorker();
        await outbox.enqueue(schemaName, {
            tenantId, provider: 'hostaway',
            operation: 'create_reservation', subjectId: 'booking-1',
        });
        const insert = sql.find(c => /INSERT INTO integration_outbox/.test(c.sql));
        expect(insert!.params[1]).toBeNull();
    });
});
