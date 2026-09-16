import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ═══ REPARAR UN SCHEMA NO PUEDE MUDAR AL CLIENTE ═══
 *
 * `createTenantSchema` también se llama para "verificar/reparar" el schema de un
 * tenant que ya existe. Para uno anterior al sufijo uuid, el nombre canónico no
 * existe todavía, así que repuntaba `tenants.schema_name` al nuevo, creaba un
 * schema VACÍO y aplicaba la plantilla: el poblado quedaba huérfano y el negocio
 * perdía su historia sin un solo error.
 *
 * Pasó de verdad, en producción: un tenant activo con 172 mensajes y 13
 * conversaciones quedó partido en dos. Esta prueba fija que no vuelva a pasar, y
 * fija también lo que SÍ debe seguir funcionando — porque la forma fácil de
 * "arreglarlo" es romper el alta de un tenant nuevo.
 */
// Variable propia, NO `PARALLLY_ISOLATION_TEST_URL`: el `setupFiles` de jest
// reescribe esa a una base por worker cuya `public.tenants` es la sintética
// del fixture compartido —once columnas, sin `slug`—, y acá hace falta la
// tabla REAL, porque lo que se prueba es que `tenants.schema_name` no se
// mueva. Con la sintética, el `update` de Prisma ni siquiera puede volver.
const url = process.env.LEGACY_SCHEMA_TEST_URL;
const suite = url ? describe : describe.skip;

suite('reparar el schema de un tenant legacy', () => {
    // Cada caso aplica la plantilla ENTERA del schema de tenant, unas cien
    // sentencias DDL. Sobre un disco real eso pasa de los 5s por defecto de
    // jest; lo que se ve entonces no es el timeout sino su consecuencia —una
    // transacción huérfana—, que manda a buscar el problema donde no está.
    jest.setTimeout(120_000);
    let db: PrismaClient;
    let service: PrismaService;
    const schemas: string[] = [];
    const tenants: string[] = [];

    const uuidHex = (id: string) => id.replace(/-/g, '').toLowerCase();

    async function makeTenant(schemaName: string): Promise<string> {
        const id = randomUUID();
        tenants.push(id);
        await db.$executeRawUnsafe(
            `INSERT INTO public.tenants (id, name, slug, schema_name, industry)
             VALUES ($1::uuid, $2, $3, $4, 'otro')`,
            id, `T ${id.slice(0, 8)}`, `slug-${id.slice(0, 8)}`, schemaName);
        return id;
    }

    /**
     * Un schema poblado, como el de un negocio que lleva meses operando.
     *
     * La tabla testigo se llama aparte a propósito: reparar aplica la plantilla
     * ENCIMA, y un `messages` de mentira con una sola columna hace fallar sus
     * índices. Un schema legacy real ya tiene la plantilla entera, así que la
     * reparación es idempotente; lo que se quiere probar acá es que los datos
     * que ya estaban siguen estando.
     */
    async function makePopulatedSchema(schemaName: string): Promise<void> {
        schemas.push(schemaName);
        await db.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
        await db.$executeRawUnsafe(`CREATE TABLE "${schemaName}".historia_del_negocio (id uuid PRIMARY KEY)`);
        await db.$executeRawUnsafe(`INSERT INTO "${schemaName}".historia_del_negocio VALUES (gen_random_uuid())`);
    }

    const declaredSchema = async (id: string): Promise<string> => {
        const [row] = await db.$queryRawUnsafe(
            'SELECT schema_name FROM public.tenants WHERE id=$1::uuid', id) as any[];
        return row?.schema_name;
    };

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['localhost', '127.0.0.1'].includes(parsed.hostname)
            || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        db = new PrismaClient({ datasources: { db: { url } } });
        await db.$connect();
        service = Object.create(PrismaService.prototype);
        for (const method of ['$queryRawUnsafe', '$executeRawUnsafe', '$transaction'] as const) {
            (service as any)[method] = (db as any)[method].bind(db);
        }
        (service as any).tenant = db.tenant;
        (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    });

    afterEach(async () => {
        for (const schema of schemas.splice(0)) {
            await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
        }
        for (const id of tenants.splice(0)) {
            await db.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', id).catch(() => undefined);
        }
    });

    afterAll(async () => { await db.$disconnect(); });

    it('no repunta un tenant que ya vive en un schema con datos', async () => {
        const legacy = `tenant_legado_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
        const id = await makeTenant(legacy);
        await makePopulatedSchema(legacy);
        schemas.push(`${legacy}_${uuidHex(id)}`); // por si la guarda fallara

        const resolved = await service.createTenantSchema(legacy, { intent: 'repair' });

        // Se queda donde está: ni el puntero se mueve ni nace un schema vacío.
        expect(resolved).toBe(legacy);
        expect(await declaredSchema(id)).toBe(legacy);
        const [created] = await db.$queryRawUnsafe(
            'SELECT 1 FROM pg_namespace WHERE nspname=$1', `${legacy}_${uuidHex(id)}`) as any[];
        expect(created).toBeUndefined();
        // Y sus datos siguen ahí.
        const [{ count }] = await db.$queryRawUnsafe(
            `SELECT count(*)::int AS count FROM "${legacy}".historia_del_negocio`) as any[];
        expect(count).toBe(1);
    });

    it('un alta nueva sí recibe el nombre canónico con sufijo', async () => {
        // El sufijo existe para que un tenant nuevo no pueda apuntar al schema
        // de uno viejo; eso tiene que seguir pasando.
        const placeholder = `tenant_nuevo_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
        const id = await makeTenant(placeholder);
        const canonical = `${placeholder}_${uuidHex(id)}`;
        schemas.push(placeholder, canonical);

        const resolved = await service.createTenantSchema(placeholder);

        expect(resolved).toBe(canonical);
        expect(await declaredSchema(id)).toBe(canonical);
    });

    it('un cascarón vacío no bloquea la mudanza al nombre canónico', async () => {
        // Un alta que creó el schema y murió antes de la plantilla no es un
        // cliente: ahí repuntar es lo correcto.
        const shell = `tenant_cascara_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
        const id = await makeTenant(shell);
        schemas.push(shell, `${shell}_${uuidHex(id)}`);
        await db.$executeRawUnsafe(`CREATE SCHEMA "${shell}"`); // sin una sola tabla

        const resolved = await service.createTenantSchema(shell, { intent: 'repair' });

        expect(resolved).toBe(`${shell}_${uuidHex(id)}`);
    });

    it('provisionar un tenant nuevo nunca hereda el schema de un negocio borrado', async () => {
        // El otro invariante, el que protege el sufijo: el slug quedó libre al
        // borrarse el negocio anterior, pero su schema sigue ahí con datos. Un
        // alta nueva que se quedara con él estaría leyendo los datos de otro.
        const slug = `tenant_reciclado_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
        await makePopulatedSchema(slug);            // lo que dejó el negocio viejo
        const id = await makeTenant(slug);          // el nuevo toma el slug libre
        schemas.push(`${slug}_${uuidHex(id)}`);

        const resolved = await service.createTenantSchema(slug);

        expect(resolved).toBe(`${slug}_${uuidHex(id)}`);
        expect(await declaredSchema(id)).toBe(`${slug}_${uuidHex(id)}`);
    });

    it('lista los schemas que ningún tenant reclama, sin contar las réplicas de prueba', async () => {
        const orphan = `tenant_sindueno_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
        await makePopulatedSchema(orphan);
        const replica = `tenant_eval_${uuidHex(randomUUID()).slice(0, 8)}_${uuidHex(randomUUID()).slice(0, 24)}`;
        await makePopulatedSchema(replica);

        const found = await service.findOrphanTenantSchemas();

        expect(found.map(row => row.schemaName)).toContain(orphan);
        expect(found.find(row => row.schemaName === orphan)?.tables).toBeGreaterThan(0);
        // La réplica efímera es huérfana por diseño: la recoge su propio cron.
        expect(found.map(row => row.schemaName)).not.toContain(replica);
    });
});

/**
 * Fuera de la suite con base, así que corre SIEMPRE.
 *
 * La guarda de arriba protege la función, pero el defecto real vivía en el
 * llamador: el cierre de onboarding pedía "verificar/reparar" y recibía un
 * aprovisionamiento. Si alguien le saca la intención a esa línea, la función
 * sigue correcta y el negocio vuelve a perder su historia — así que la línea
 * también es parte del contrato.
 */
describe('el cierre de onboarding pide reparar, no aprovisionar', () => {
    it('pasa la intención explícita al verificar el schema de un tenant que ya existe', () => {
        const source = readFileSync(join(__dirname, '..', 'auth', 'auth.service.ts'), 'utf8');
        const calls = [...source.matchAll(/createTenantSchema\(([^)]*)\)/g)].map(match => match[1]);
        expect(calls.length).toBeGreaterThan(0);

        // El que recibe `tenant.schemaName` es el de reparación: ese tenant ya
        // existe. El de alta usa `result.tenant.schemaName` y no lleva intención.
        const repair = calls.filter(args => /^tenant\.schemaName/.test(args.trim()));
        expect(repair).toHaveLength(1);
        expect(repair[0]).toContain("intent: 'repair'");
    });
});
