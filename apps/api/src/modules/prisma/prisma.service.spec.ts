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
    });
});
