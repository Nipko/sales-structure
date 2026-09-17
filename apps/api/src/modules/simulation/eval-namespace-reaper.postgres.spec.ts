import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { EvalNamespaceReaperService } from './eval-namespace-reaper.service';
import { PrismaService } from '../prisma/prisma.service';
import { disposeOwnedEvalNamespace, isolatedEvalNamespaceForPrisma, type EvalNamespaceLease } from './isolated-eval-namespace';

/**
 * Este barrido BORRA schemas, así que lo que hay que fijar no es sólo que
 * recoja: es que no toque lo que no le corresponde. Contra PostgreSQL real,
 * porque lo que se prueba es el catálogo (`pg_namespace`), el marcador de dueño
 * y el `DROP` — nada de eso sobrevive a un doble.
 */
const url = process.env.PARALLLY_ISOLATION_TEST_URL;
const suite = url ? describe : describe.skip;

/** La función que la migración de arranque de evidencia nativa escribe en cada schema que recorre. */
const OWNERSHIP_GUARD = 'validate_native_evidence_opportunity';

let db: PrismaClient;
let prisma: PrismaService;
let priorDatabaseUrl: string | undefined;
const created: string[] = [];

/** Un schema con la forma exacta del namespace efímero. */
const evalSchema = () =>
    `tenant_eval_${randomUUID().replace(/-/g, '').slice(0, 8)}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

async function makeNamespace(
    schema: string,
    options: { marker: boolean; expiresInSeconds?: number },
): Promise<EvalNamespaceLease> {
    const tenantId = randomUUID();
    const token = randomUUID();
    const sourceSchema = `tenant_origen_${tenantId.replace(/-/g, '')}`;
    created.push(schema);
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    // Una tabla cualquiera: el borrado tiene que llevarse el contenido, no
    // sólo el schema vacío.
    await db.$executeRawUnsafe(`CREATE TABLE "${schema}".knowledge_documents (id uuid PRIMARY KEY)`);
    if (options.marker) {
        await db.$executeRawUnsafe(
            `CREATE TABLE "${schema}".__eval_namespace (tenant_id uuid NOT NULL, owner_token uuid NOT NULL,
             source_schema text NOT NULL, expires_at timestamptz NOT NULL)`);
        await db.$executeRawUnsafe(
            `INSERT INTO "${schema}".__eval_namespace VALUES ($1::uuid,$2::uuid,$3,
             clock_timestamp() + $4::integer * interval '1 second')`,
            tenantId, token, sourceSchema, options.expiresInSeconds ?? -60);
    }
    return { schemaName: schema, sourceSchema, tenantId, token, expiresAt: new Date().toISOString(), tables: [] };
}

/**
 * Las dos tablas de evidencia nativa que clona "Probar agente", con la guarda de
 * propiedad instalada por el MISMO código de producción que la escribió en la
 * réplica de Cotes: función propia del schema, FK y trigger sobre la tabla.
 */
async function installOwnershipGuard(schema: string): Promise<void> {
    await db.$executeRawUnsafe(`CREATE TABLE "${schema}".opportunities (id uuid PRIMARY KEY)`);
    await db.$executeRawUnsafe(
        `CREATE TABLE "${schema}".appointments (id uuid PRIMARY KEY, contact_id uuid, opportunity_id uuid)`);
    await prisma.ensureNativeEvidenceOpportunityOwnershipForTable(schema, 'appointments');
    // Precondición: si la guarda no quedó adentro, el resto de la prueba no
    // demuestra nada.
    expect(await routineExists(schema, OWNERSHIP_GUARD)).toBe(true);
    expect(await triggerCount(schema, 'appointments')).toBe(1);
}

const exists = async (schema: string): Promise<boolean> => {
    const rows = await db.$queryRawUnsafe(
        'SELECT 1 FROM pg_namespace WHERE nspname=$1', schema) as any[];
    return rows.length === 1;
};

const routineExists = async (schema: string, name: string): Promise<boolean> => {
    const rows = await db.$queryRawUnsafe(
        `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=$1 AND p.proname=$2`, schema, name) as any[];
    return rows.length > 0;
};

const triggerCount = async (schema: string, table: string): Promise<number> => {
    const [row] = await db.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
           JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=$1 AND c.relname=$2 AND NOT t.tgisinternal`, schema, table) as any[];
    return row.n;
};

const tableExists = async (schema: string, table: string): Promise<boolean> => {
    const [row] = await db.$queryRawUnsafe('SELECT to_regclass($1)::text AS name', `"${schema}"."${table}"`) as any[];
    return Boolean(row?.name);
};

if (url) {
    beforeAll(async () => {
        const parsed = new URL(url);
        if (!['localhost', '127.0.0.1'].includes(parsed.hostname)
            || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        db = new PrismaClient({ datasources: { db: { url } } });
        await db.$connect();
        // El servicio real, no un doble: lo que se prueba es qué escribe su
        // barrido de arranque y con qué forma.
        priorDatabaseUrl = process.env.DATABASE_URL;
        process.env.DATABASE_URL = url;
        prisma = new PrismaService();
        (prisma as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
        await prisma.$connect();
    });

    afterEach(async () => {
        for (const schema of created.splice(0)) {
            await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
        }
    });

    afterAll(async () => {
        try { await prisma?.$disconnect(); } catch { /* ya cerrada */ }
        if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = priorDatabaseUrl;
        await db?.$disconnect();
    });
}

suite('el recogedor de réplicas de prueba vencidas', () => {
    let service: EvalNamespaceReaperService;

    beforeAll(() => {
        service = new EvalNamespaceReaperService(db as any, { runExclusive: jest.fn() } as any);
    });

    it('recoge una réplica vencida y se lleva su contenido', async () => {
        const schema = evalSchema();
        await makeNamespace(schema, { marker: true, expiresInSeconds: -60 });

        const { reaped, unclaimable } = await service.reapExpiredNamespaces();

        expect(reaped).toBeGreaterThanOrEqual(1);
        expect(unclaimable).not.toContain(schema);
        expect(await exists(schema)).toBe(false);
    });

    it('no interrumpe una prueba en curso', async () => {
        const schema = evalSchema();
        await makeNamespace(schema, { marker: true, expiresInSeconds: 3600 });

        await service.reapExpiredNamespaces();

        // Un lease vivo es una corrida de alguien: borrarlo le rompe la prueba.
        expect(await exists(schema)).toBe(true);
    });

    it('no borra un schema cuyo dueño no puede probar, y lo reporta', async () => {
        const schema = evalSchema();
        await makeNamespace(schema, { marker: false });

        const { unclaimable } = await service.reapExpiredNamespaces();

        expect(unclaimable).toContain(schema);
        expect(await exists(schema)).toBe(true);
    });

    it('no mira nada que no tenga la forma del namespace efímero', async () => {
        // Un tenant de verdad cuyo slug empieza con "eval": el sufijo es de 32
        // hex, no de 24, así que no cae en el patrón. Si algún día cayera, este
        // barrido borraría un cliente.
        const real = `tenant_eval_cosas_${randomUUID().replace(/-/g, '')}`;
        created.push(real);
        await db.$executeRawUnsafe(`CREATE SCHEMA "${real}"`);

        const { unclaimable } = await service.reapExpiredNamespaces();

        expect(unclaimable).not.toContain(real);
        expect(await exists(real)).toBe(true);
    });

    it('es idempotente: una segunda pasada no encuentra nada que recoger', async () => {
        const schema = evalSchema();
        await makeNamespace(schema, { marker: true, expiresInSeconds: -60 });

        await service.reapExpiredNamespaces();
        const second = await service.reapExpiredNamespaces();

        expect(second.reaped).toBe(0);
    });

    it('recoge una réplica a la que el arranque le dejó la guarda de propiedad adentro', async () => {
        // Lo que pasó en producción: la migración de arranque escribió su
        // función en la réplica, el borrado quitaba las tablas pero no la
        // función, y `DROP SCHEMA ... RESTRICT` fallaba con 2BP01 en CADA pasada.
        // La réplica quedaba para siempre, ni este cron ni ningún otro podía con
        // ella.
        const schema = evalSchema();
        await makeNamespace(schema, { marker: true, expiresInSeconds: -60 });
        await installOwnershipGuard(schema);

        const { reaped } = await service.reapExpiredNamespaces();

        expect(reaped).toBeGreaterThanOrEqual(1);
        expect(await exists(schema)).toBe(false);
    });

    it('el borrado compartido recoge una réplica que sólo tiene la función, con un ejecutor como el de dropUnused', async () => {
        // La réplica de conocimiento no clona tablas de evidencia nativa, pero la
        // migración de arranque escribía la función igual: sin tablas, queda la
        // función sola. Se borra con un ejecutor COPIADO del de `dropUnused` en
        // `evaluation-knowledge-lifecycle` (sólo manda DROP/SET a execute).
        //
        // Ojo con lo que esto NO prueba: no recorre `reapKnowledgeReplicas` →
        // `reapInTransaction` → `dropUnused`, que es la pila del error de
        // producción. Prueba la función compartida que esa pila llama; si la
        // limpieza de conocimiento deja de llamarla, esta prueba sigue verde.
        const schema = evalSchema();
        const lease = await makeNamespace(schema, { marker: true, expiresInSeconds: -60 });
        await (prisma as any).transactionInTenantSchema(schema,
            (query: any) => (prisma as any).ensureNativeEvidenceOwnershipWithQuery(query, schema, []),
            { schemaLock: true, timeout: 60_000 });
        expect(await routineExists(schema, OWNERSHIP_GUARD)).toBe(true);

        await db.$transaction(async tx => {
            await disposeOwnedEvalNamespace(async (sql, params = []) => {
                if (/^\s*(?:DROP|SET)\b/i.test(sql)) { await tx.$executeRawUnsafe(sql, ...params); return []; }
                return tx.$queryRawUnsafe(sql, ...params) as Promise<any[]>;
            }, lease);
        }, { timeout: 30_000 });

        expect(await exists(schema)).toBe(false);
    });

    /**
     * La razón de `RESTRICT`: si algo FUERA de la réplica depende de algo de
     * adentro, borrarla rompería ese algo. Limpiar la función antes de soltar
     * el schema no puede convertirse en un CASCADE disfrazado, así que cada
     * forma de dependencia externa tiene que seguir frenando el borrado entero.
     */
    const externalDependents: Array<[string, (schema: string, outside: string) => string[]]> = [
        ['una vista de otro schema que lee una tabla de la réplica', (schema, outside) => [
            `CREATE VIEW "${outside}".lee_la_replica AS SELECT id FROM "${schema}".knowledge_documents`,
        ]],
        ['una función de otro schema que recibe el tipo de fila de una tabla de la réplica', (schema, outside) => [
            `CREATE FUNCTION "${outside}".usa_la_fila(fila "${schema}".knowledge_documents) RETURNS uuid
             LANGUAGE sql AS 'SELECT ($1).id'`,
        ]],
        ['un trigger de otro schema que ejecuta la guarda de la réplica', (schema, outside) => [
            `CREATE TABLE "${outside}".evidencia (id uuid, contact_id uuid, opportunity_id uuid)`,
            `CREATE TRIGGER usa_la_guarda BEFORE INSERT ON "${outside}".evidencia
             FOR EACH ROW EXECUTE FUNCTION "${schema}".${OWNERSHIP_GUARD}()`,
        ]],
        ['una vista de otro schema que llama a una función de la réplica', (schema, outside) => [
            `CREATE FUNCTION "${schema}".una_constante() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1'`,
            `CREATE VIEW "${outside}".llama_a_la_replica AS SELECT "${schema}".una_constante() AS n`,
        ]],
    ];

    it.each(externalDependents)('no borra la réplica cuando %s', async (_label, dependents) => {
        const schema = evalSchema();
        const lease = await makeNamespace(schema, { marker: true, expiresInSeconds: -60 });
        await installOwnershipGuard(schema);
        const outside = `eval_reaper_outside_${randomUUID().replace(/-/g, '')}`;
        created.push(outside);
        await db.$executeRawUnsafe(`CREATE SCHEMA "${outside}"`);
        for (const statement of dependents(schema, outside)) await db.$executeRawUnsafe(statement);

        await expect(isolatedEvalNamespaceForPrisma(db as any).dispose(lease))
            .rejects.toMatchObject({ meta: { code: '2BP01' } });
        // Y el cron, que traga el error para no frenar a las demás, tampoco.
        await service.reapExpiredNamespaces();

        // Todo o nada: ni el schema, ni su marcador, ni sus tablas, ni la guarda
        // pueden quedar a medio borrar.
        expect(await exists(schema)).toBe(true);
        expect(await tableExists(schema, '__eval_namespace')).toBe(true);
        expect(await tableExists(schema, 'knowledge_documents')).toBe(true);
        expect(await triggerCount(schema, 'appointments')).toBe(1);
        expect(await routineExists(schema, OWNERSHIP_GUARD)).toBe(true);
    });
});

suite('la migración de arranque de evidencia nativa y las réplicas de prueba', () => {
    it('instala la guarda en un tenant y no escribe nada en una réplica', async () => {
        // Los otros dos barridos de arranque ya excluían las réplicas; éste no, y
        // era el único que les dejaba algo que sobrevive a borrar sus tablas.
        const tenant = `tenant_barrido_${randomUUID().replace(/-/g, '')}`;
        const replica = evalSchema();
        for (const schema of [tenant, replica]) {
            created.push(schema);
            await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
            await db.$executeRawUnsafe(`CREATE TABLE "${schema}".opportunities (id uuid PRIMARY KEY)`);
            await db.$executeRawUnsafe(
                `CREATE TABLE "${schema}".appointments (id uuid PRIMARY KEY, contact_id uuid, opportunity_id uuid)`);
        }

        // El barrido junta los fallos de TODOS los schemas y lanza al final. En
        // una corrida completa la base del worker trae schemas a medias de otras
        // suites, así que su veredicto global no es el de esta prueba: lo que se
        // mira es qué quedó en cada uno de los dos schemas de acá.
        await (prisma as any).ensureNativeEvidenceOpportunityOwnership().catch(() => undefined);

        // Control positivo: el barrido corrió de verdad.
        expect(await routineExists(tenant, OWNERSHIP_GUARD)).toBe(true);
        expect(await triggerCount(tenant, 'appointments')).toBe(1);
        // La réplica quedó exactamente como estaba.
        expect(await routineExists(replica, OWNERSHIP_GUARD)).toBe(false);
        expect(await triggerCount(replica, 'appointments')).toBe(0);
    });
});
