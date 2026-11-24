import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { PrismaService } from './prisma.service';
import { TENANT_CONTEXT_SQL, tenantContextIdForSchema, tenantSearchPath } from './tenant-context';

describe('tenant context of the shared tables (ADR 0034)', () => {
    const tenantId = '5f7883f0-7f09-4906-9800-6a07dfe82dc7';
    const canonical = `tenant_spark_qa_dental_03_${tenantId.replace(/-/g, '')}`;

    it('reads the tenant id from the physical schema name', () => {
        expect(tenantContextIdForSchema(canonical)).toBe(tenantId);
        expect(tenantContextIdForSchema(`tenant_${tenantId.replace(/-/g, '')}`)).toBe(tenantId);
    });

    it('gives an evaluation namespace a synthetic id of its own, never the id of the tenant it copies', () => {
        const namespace = 'tenant_eval_5f7883f0_0123456789abcdef01234567';
        const synthetic = tenantContextIdForSchema(namespace);
        expect(synthetic).toBe('5f7883f0-0123-4567-89ab-cdef01234567');
        expect(synthetic).not.toBe(tenantId);
        expect(tenantContextIdForSchema('tenant_eval_5f7883f0_fedcba9876543210fedcba98')).not.toBe(synthetic);
    });

    it('carries no context for a name without a tenant id: shared tables then fail closed', () => {
        expect(tenantContextIdForSchema('tenant_acme')).toBe('');
        expect(tenantContextIdForSchema('tenant_acme_5f7883f07f09490698006a07dfe82dc')).toBe('');
        expect(tenantContextIdForSchema(`tenant_acme_${tenantId.replace(/-/g, '').toUpperCase()}`)).toBe('');
    });

    it('puts the tenant schema before shared, and shared before public', () => {
        expect(tenantSearchPath(canonical)).toBe(`"${canonical}", shared, public`);
    });

    it('both tenant helpers set search_path and tenant context in one statement, before the query', async () => {
        const service = Object.create(PrismaService.prototype) as PrismaService;
        const calls: Array<[string, ...unknown[]]> = [];
        const tx = {
            $executeRawUnsafe: jest.fn(async (...args: [string, ...unknown[]]) => { calls.push(args); return 0; }),
            $queryRawUnsafe: jest.fn(async (...args: [string, ...unknown[]]) => { calls.push(args); return []; }),
        };
        Object.defineProperty(service, '$transaction', {
            value: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx), configurable: true,
        });

        await service.executeInTenantSchema(canonical, 'SELECT 1');
        await service.transactionInTenantSchema(canonical, (query) => query('SELECT 2'));

        const context: [string, ...unknown[]] = [TENANT_CONTEXT_SQL, `"${canonical}", shared, public`, tenantId];
        expect(calls).toEqual([context, ['SELECT 1'], context, ['SELECT 2']]);
    });

    it('the WhatsApp service keeps an identical copy of the context functions', () => {
        const repo = resolve(__dirname, '..', '..', '..', '..', '..');
        const normalise = (text: string) => text.replace(/\r\n/g, '\n');
        const api = readFileSync(join(__dirname, 'tenant-context.ts'), 'utf8');
        const whatsapp = readFileSync(join(repo, 'apps', 'whatsapp', 'src', 'modules', 'prisma', 'tenant-context.ts'), 'utf8');
        expect(normalise(whatsapp)).toBe(normalise(api));
        const whatsappService = readFileSync(join(repo, 'apps', 'whatsapp', 'src', 'modules', 'prisma', 'prisma.service.ts'), 'utf8');
        expect(whatsappService).toContain('TENANT_CONTEXT_SQL, tenantSearchPath(schemaName), tenantContextIdForSchema(schemaName)');
        expect(whatsappService).not.toMatch(/SET LOCAL search_path/);
    });
});
