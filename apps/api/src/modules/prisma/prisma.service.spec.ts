import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from './prisma.service';

describe('PrismaService tenant schema lifecycle', () => {
    const tenantIdA = '11111111-1111-4111-8111-111111111111';
    const tenantIdB = '22222222-2222-4222-8222-222222222222';

    function makeService(tenantId: string, requestedSchemaName = 'tenant_same_slug') {
        const service = Object.create(PrismaService.prototype) as PrismaService;
        const tenant = {
            findUnique: jest.fn().mockResolvedValue({ id: tenantId, schemaName: requestedSchemaName }),
            update: jest.fn().mockResolvedValue({}),
        };
        const queryRaw = jest.fn().mockResolvedValue([]);
        const executeRaw = jest.fn().mockResolvedValue(0);

        Object.defineProperty(service, 'tenant', { value: tenant, configurable: true });
        Object.defineProperty(service, '$queryRawUnsafe', { value: queryRaw, configurable: true });
        Object.defineProperty(service, '$executeRawUnsafe', { value: executeRaw, configurable: true });
        jest.spyOn(service as any, 'loadTenantSchemaTemplate').mockResolvedValue(
            'CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."sentinel" (id UUID);',
        );

        return { service, tenant, queryRaw, executeRaw };
    }

    it('never reuses a stale slug-based schema when provisioning a new tenant', async () => {
        const { service, tenant, queryRaw, executeRaw } = makeService(tenantIdA);
        const staleSchemaName = 'tenant_same_slug';
        const expectedSchemaName = `tenant_same_slug_${tenantIdA.replace(/-/g, '')}`;

        // The old slug-based schema still exists and contains the previous
        // tenant's data. The allocator must not query, clean or bind to it.
        queryRaw.mockImplementation(async (_sql: string, schemaName: string) => (
            schemaName === staleSchemaName ? [{ exists: 1 }] : []
        ));

        const actualSchemaName = await service.createTenantSchema(staleSchemaName);

        expect(actualSchemaName).toBe(expectedSchemaName);
        expect(tenant.update).toHaveBeenCalledWith({
            where: { id: tenantIdA },
            data: { schemaName: expectedSchemaName },
        });
        expect(queryRaw).not.toHaveBeenCalledWith(expect.any(String), staleSchemaName);
        expect(executeRaw).toHaveBeenCalledWith(`CREATE SCHEMA "${expectedSchemaName}";`);
        expect(executeRaw.mock.calls.map(([sql]) => String(sql)).join('\n'))
            .not.toContain(`"${staleSchemaName}"."sentinel"`);
    });

    it('allocates different physical schemas when the same slug is used again', async () => {
        const first = makeService(tenantIdA);
        const second = makeService(tenantIdB);

        const firstSchema = await first.service.createTenantSchema('tenant_same_slug');
        const secondSchema = await second.service.createTenantSchema('tenant_same_slug');

        expect(firstSchema).not.toBe(secondSchema);
        expect(firstSchema.endsWith(tenantIdA.replace(/-/g, ''))).toBe(true);
        expect(secondSchema.endsWith(tenantIdB.replace(/-/g, ''))).toBe(true);
    });

    it('never reports a partially initialized schema as ready', async () => {
        const { service, executeRaw } = makeService(tenantIdA);
        executeRaw.mockImplementation(async (sql: string) => {
            if (sql.includes('"sentinel"')) {
                const error: any = new Error('injected template failure');
                error.meta = { code: 'XX000' };
                throw error;
            }
            return 0;
        });

        await expect(service.createTenantSchema('tenant_same_slug')).rejects.toThrow(
            'Tenant schema "tenant_same_slug_11111111111141118111111111111111" is incomplete',
        );
    });

    it('verifies that a dropped schema is actually absent', async () => {
        const { service, queryRaw, executeRaw } = makeService(tenantIdA);
        queryRaw.mockResolvedValue([]);

        await expect(service.dropTenantSchema('tenant_acme')).resolves.toBeUndefined();

        expect(executeRaw).toHaveBeenCalledWith('DROP SCHEMA IF EXISTS "tenant_acme" CASCADE;');
        expect(queryRaw).toHaveBeenCalledWith(
            expect.stringContaining('information_schema.schemata'),
            'tenant_acme',
        );
    });

    it('fails the drop when PostgreSQL still reports the schema', async () => {
        const { service, queryRaw } = makeService(tenantIdA);
        queryRaw.mockResolvedValue([{ exists: 1 }]);

        await expect(service.dropTenantSchema('tenant_acme'))
            .rejects.toThrow('still exists after DROP SCHEMA');
    });

    describe('atomic public purge', () => {
        function makePublicPurgeService(tables: string[]) {
            const service = Object.create(PrismaService.prototype) as PrismaService;
            const tenantDelete = jest.fn().mockResolvedValue({ id: tenantIdA });
            const executeRaw = jest.fn().mockResolvedValue(1);
            const queryRaw = jest.fn().mockImplementation(async (sql: string) => {
                if (sql.includes('information_schema.columns')) {
                    return tables.map((table_name) => ({ table_name }));
                }
                if (sql.includes('to_regclass')) {
                    return [{ subscribers: null, requests: null }];
                }
                return [];
            });
            const tx = {
                tenant: { delete: tenantDelete },
                $queryRawUnsafe: queryRaw,
                $executeRawUnsafe: executeRaw,
            };
            const transaction = jest.fn().mockImplementation(async (callback: (client: any) => any) => callback(tx));
            Object.defineProperty(service, '$transaction', { value: transaction, configurable: true });
            return { service, tx, tenantDelete, executeRaw, queryRaw, transaction };
        }

        it('keeps the tenant identity when any classified public delete fails, then allows retry', async () => {
            const h = makePublicPurgeService(['fiscal_invoices', 'billing_payments', 'audit_logs', 'users']);
            h.executeRaw.mockImplementation(async (sql: string) => {
                if (sql.includes('DELETE FROM public."billing_payments"')) {
                    throw new Error('injected public delete failure');
                }
                return 1;
            });

            await expect(h.service.purgeTenantPublicDataAtomic(
                tenantIdA,
                { name: 'Acme', schemaName: 'tenant_acme' },
            )).rejects.toThrow('injected public delete failure');
            expect(h.tenantDelete).not.toHaveBeenCalled();

            h.executeRaw.mockResolvedValue(1);
            await expect(h.service.purgeTenantPublicDataAtomic(
                tenantIdA,
                { name: 'Acme', schemaName: 'tenant_acme' },
            )).resolves.toMatchObject({ tenants: 1, fiscal_invoices_retained: 1 });
            expect(h.tenantDelete).toHaveBeenCalledTimes(1);
        });

        it('blocks deletion when a new tenant-owned public table is not classified', async () => {
            const h = makePublicPurgeService(['users', 'future_tenant_secrets']);

            await expect(h.service.purgeTenantPublicDataAtomic(
                tenantIdA,
                { name: 'Acme', schemaName: 'tenant_acme' },
            )).rejects.toMatchObject({
                response: {
                    error: 'tenant_purge_unclassified_public_data',
                    tables: ['future_tenant_secrets'],
                },
            });
            expect(h.executeRaw).not.toHaveBeenCalled();
            expect(h.tenantDelete).not.toHaveBeenCalled();
        });

        it('takes the tenant row lock before the retention scan and fiscal stamp', async () => {
            const h = makePublicPurgeService(['fiscal_invoices', 'users']);

            await h.service.purgeTenantPublicDataAtomic(
                tenantIdA,
                { name: 'Acme', schemaName: 'tenant_acme' },
            );

            expect(String(h.queryRaw.mock.calls[0][0])).toContain('FOR UPDATE');
            expect(String(h.queryRaw.mock.calls[1][0])).toContain('information_schema.columns');
        });
    });

    describe('read-only public purge preflight', () => {
        function makePreflightService(
            tables: string[],
            featureState: { subscribers: string | null; requests: string | null } = {
                subscribers: null,
                requests: null,
            },
        ) {
            const service = Object.create(PrismaService.prototype) as PrismaService;
            const queryRaw = jest.fn().mockImplementation(async (sql: string) => {
                if (sql.includes('information_schema.columns')) {
                    return tables.map((table_name) => ({ table_name }));
                }
                return [featureState];
            });
            Object.defineProperty(service, '$queryRawUnsafe', { value: queryRaw, configurable: true });
            return { service, queryRaw };
        }

        it('rejects an unknown tenant-owned table before the destructive saga starts', async () => {
            const h = makePreflightService(['users', 'future_tenant_secrets']);

            await expect(h.service.preflightTenantPublicPurge()).rejects.toMatchObject({
                response: {
                    error: 'tenant_purge_unclassified_public_data',
                    tables: ['future_tenant_secrets'],
                },
            });
            expect(h.queryRaw).toHaveBeenCalledTimes(1);
        });

        it('rejects an asymmetric feature-request schema before DROP', async () => {
            const h = makePreflightService(
                ['users'],
                { subscribers: 'feature_request_subscribers', requests: null },
            );

            await expect(h.service.preflightTenantPublicPurge()).rejects.toMatchObject({
                response: { error: 'tenant_purge_incomplete_feature_request_schema' },
            });
        });

        /**
         * Drift guard. The two tests above prove the gate reacts to an unknown
         * table; neither compares the classification against the schema we
         * actually ship. A new global table therefore used to reach production
         * unclassified — and because this gate runs before anything destructive,
         * it then blocks the purge of EVERY tenant, not just the one using the
         * table. That is how billing_charge_attempts / billing_credit_ledger /
         * billing_payment_sources broke tenant deletion in Aug 2026.
         *
         * The migration tier is no safety net here: the PR gate never applies
         * migrations, so only a static check catches this before production.
         *
         * A global table can be born three ways, and all three are scanned —
         * covering one of them would leave the same hole open.
         */
        const publicTenantTables = (): string[] => {
            const apiRoot = join(__dirname, '..', '..', '..');
            const hasTenantIdColumn = (columns: string) => /(?:^|[\s,(])"?tenant_id"?\s+\w/i.test(columns);
            const tables: string[] = [];

            // 1. Declared Prisma models.
            const schema = readFileSync(join(apiRoot, 'prisma', 'schema.prisma'), 'utf8');
            const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
                .filter(([, , body]) => /@map\("tenant_id"\)/.test(body) || /^\s*tenant_id\s/m.test(body))
                .map(([, name, body]) => body.match(/@@map\("([^"]+)"\)/)?.[1] ?? name);

            // 2. Hand-written SQL migrations. The column guard matters: without
            //    it, feature_requests.author_tenant_id reads as a false hit.
            const migrationsDir = join(apiRoot, 'prisma', 'migrations');
            const migrated: string[] = [];
            for (const dir of readdirSync(migrationsDir)) {
                const file = join(migrationsDir, dir, 'migration.sql');
                if (!existsSync(file)) continue;
                for (const [, table, columns] of readFileSync(file, 'utf8')
                    .matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?\s*\(([\s\S]*?)\n\)/g)) {
                    if (hasTenantIdColumn(columns)) migrated.push(table);
                }
            }

            // 3. Created lazily at runtime by service code. These have no Prisma
            //    model at all; the explicit `public.` prefix is what separates
            //    them from the tenant-schema tables built the same way.
            const lazy: string[] = [];
            const walk = (dir: string): void => {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    const full = join(dir, entry.name);
                    if (entry.isDirectory()) { walk(full); continue; }
                    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
                    for (const [, table, columns] of readFileSync(full, 'utf8')
                        .matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)\s*\(([\s\S]*?)\n\s*\)/g)) {
                        if (hasTenantIdColumn(columns)) lazy.push(table);
                    }
                }
            };
            walk(join(apiRoot, 'src'));

            // Per-source floors. A regex that silently stops matching would
            // otherwise turn this whole guard green forever.
            expect(models.length).toBeGreaterThanOrEqual(20);
            expect(migrated.length).toBeGreaterThanOrEqual(5);
            expect(lazy.length).toBeGreaterThanOrEqual(5);

            tables.push(...models, ...migrated, ...lazy);
            return [...new Set(tables)];
        };

        it('classifies every public table that carries a tenant_id, however it was created', async () => {
            const h = makePreflightService(publicTenantTables());

            await expect(h.service.preflightTenantPublicPurge()).resolves.toBeUndefined();
        });
    });
});
