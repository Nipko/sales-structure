import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { EvalNamespaceReaperService } from './eval-namespace-reaper.service';

/**
 * Este barrido BORRA schemas, así que lo que hay que fijar no es sólo que
 * recoja: es que no toque lo que no le corresponde. Contra PostgreSQL real,
 * porque lo que se prueba es el catálogo (`pg_namespace`), el marcador de dueño
 * y el `DROP` — nada de eso sobrevive a un doble.
 */
const url = process.env.PARALLLY_ISOLATION_TEST_URL;
const suite = url ? describe : describe.skip;

suite('el recogedor de réplicas de prueba vencidas', () => {
    let db: PrismaClient;
    let service: EvalNamespaceReaperService;
    const created: string[] = [];

    /** Un schema con la forma exacta del namespace efímero. */
    const evalSchema = () =>
        `tenant_eval_${randomUUID().replace(/-/g, '').slice(0, 8)}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

    async function makeNamespace(
        schema: string,
        options: { marker: boolean; expiresInSeconds?: number },
    ): Promise<{ tenantId: string; token: string; sourceSchema: string }> {
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
        return { tenantId, token, sourceSchema };
    }

    const exists = async (schema: string): Promise<boolean> => {
        const rows = await db.$queryRawUnsafe(
            'SELECT 1 FROM pg_namespace WHERE nspname=$1', schema) as any[];
        return rows.length === 1;
    };

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['localhost', '127.0.0.1'].includes(parsed.hostname)
            || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        db = new PrismaClient({ datasources: { db: { url } } });
        await db.$connect();
        service = new EvalNamespaceReaperService(db as any, { runExclusive: jest.fn() } as any);
    });

    afterEach(async () => {
        for (const schema of created.splice(0)) {
            await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
        }
    });

    afterAll(async () => { await db.$disconnect(); });

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
});
