import { IcalSyncService } from './ical-sync.service';

/**
 * Los parámetros tienen que seguir a la consulta ELEGIDA.
 *
 * La capa B eligió el SQL con un ternario y dejó los parámetros fijos en
 * `[propertyId]`. El SQL con exclusión pide `$2`, así que Postgres rechazó cada
 * pedido con "incorrect number of parameters" y Airbnb no pudo conectar el
 * calendario: 500 en cada intento.
 *
 * Ni `tsc` ni el linter lo ven —es un template string— y los tests de la capa B
 * comparaban el texto del SQL sin ejecutarlo, así que pasaban con el error
 * puesto. Esto lo ejecuta.
 */

function build() {
    const calls: Array<{ sql: string; params: any[] }> = [];
    const prisma: any = {
        executeInTenantSchema: jest.fn(async (_s: string, sql: string, params: any[] = []) => {
            calls.push({ sql, params });
            if (sql.includes('FROM properties')) return [{ name: 'Amazon Minimalist' }];
            return [];
        }),
    };
    const service = new IcalSyncService(prisma, {} as any);
    return { service, calls };
}

const PROP = 'a36c1e0c-c71b-4837-8f30-048e94bba421';
const FEED = '9a3032da-fdf8-42c1-a44d-3154b98517fb';

describe('el feed de bloqueos', () => {
    it('manda dos parámetros cuando excluye a una OTA', async () => {
        const { service, calls } = build();

        await service.generateFeed('tenant_x', PROP, FEED);

        const q = calls.find(c => c.sql.includes('FROM ical_blocks'));
        expect(q).toBeDefined();
        expect(q!.sql).toContain('$2::uuid');
        expect(q!.params).toEqual([PROP, FEED]);
    });

    it('manda uno solo cuando no excluye a nadie', async () => {
        const { service, calls } = build();

        await service.generateFeed('tenant_x', PROP);

        const q = calls.find(c => c.sql.includes('FROM ical_blocks'));
        expect(q!.sql).not.toContain('$2');
        expect(q!.params).toEqual([PROP]);
    });

    it('cada consulta lleva tantos parámetros como marcadores tiene', async () => {
        // El invariante general, que es el que fallaba: contar `$N` en el SQL y
        // compararlo con el largo del array. Es lo único que atrapa este error
        // sin una base de datos.
        const { service, calls } = build();

        await service.generateFeed('tenant_x', PROP, FEED);

        for (const { sql, params } of calls) {
            const marcadores = new Set(sql.match(/\$\d+/g) || []);
            expect(params.length).toBe(marcadores.size);
        }
    });
});
