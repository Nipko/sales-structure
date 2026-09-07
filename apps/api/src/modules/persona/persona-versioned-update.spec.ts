import { BadRequestException, ConflictException } from '@nestjs/common';
import { PersonaService } from './persona.service';
import { PersonaController } from './persona.controller';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
function harness(failFinalWrite = false) {
    let current: any = { id: AGENT, version: 8, config_json: { persona: { name: 'Luna', greeting: 'Actual' } }, channel_bindings: [] };
    let other: any = { id: 'other', version: 3, is_default: true, channels: ['whatsapp'], channel_bindings: ['telegram:1'] };
    const sql: string[] = [];
    let queue = Promise.resolve();
    const query = async (statement: string, params: any[] = []) => {
        sql.push(statement);
        if (statement.startsWith('SELECT id FROM public.tenants')) return [{ id: TENANT }];
        if (statement.startsWith('SELECT channel_bindings')) return [JSON.parse(JSON.stringify(current))];
        if (statement.includes('SET is_default = false')) { other.is_default = false; other.version++; return [{ id: other.id }]; }
        if (statement.includes('SET channels = array_remove')) { other.channels = []; other.version++; return [{ id: other.id }]; }
        if (statement.includes('SET channel_bindings = array_remove')) { other.channel_bindings = []; other.version++; return [{ id: other.id }]; }
        if (statement.startsWith('UPDATE') && statement.includes('RETURNING *')) {
            if (failFinalWrite) throw new Error('write failed');
            if (params.at(-1) !== current.version) return [];
            current.version++; return [JSON.parse(JSON.stringify(current))];
        }
        throw new Error('Unexpected query: ' + statement);
    };
    const prisma = { channelAccount: { findMany: jest.fn().mockResolvedValue([]) }, transactionInTenantSchema: jest.fn(async (_schema, work) => {
        let release!: () => void;
        const before = queue; queue = new Promise(resolve => { release = resolve; }); await before;
        const snapshot = JSON.stringify({ current, other });
        try { return await work(query); } catch (error) { ({ current, other } = JSON.parse(snapshot)); throw error; } finally { release(); }
    }) };
    const events = { emit: jest.fn() };
    const redis = { del: jest.fn() };
    const service = new PersonaService(prisma as any, redis as any, { getSchemaName: async () => 'tenant_test' } as any, {} as any, events as any);
    (service as any).initializedTenants.add(TENANT);
    return { service, prisma, events, redis, sql, current: () => current, other: () => other };
}

describe('agent editor optimistic concurrency', () => {
    it('allows only one of two editors that loaded the same version to save', async () => {
        const h = harness();
        const results = await Promise.allSettled([
            h.service.updateAgent(TENANT, AGENT, { expectedVersion: 8, isActive: true }),
            h.service.updateAgent(TENANT, AGENT, { expectedVersion: 8, isActive: false }),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
        expect(h.current().version).toBe(9);
        expect(h.sql.filter(sql => sql.startsWith('UPDATE'))).toHaveLength(1);
        expect(h.sql[0]).toContain('public.tenants');
        expect(h.sql[1]).toContain('FOR UPDATE');
    });
    it('rejects a stale editor before changing another agent assignment or default', async () => {
        const h = harness();
        await expect(h.service.updateAgent(TENANT, AGENT, { expectedVersion: 7, isDefault: true, channels: ['whatsapp'], channelBindings: ['telegram:1'] })).rejects.toBeInstanceOf(ConflictException);
        expect(h.other()).toMatchObject({ is_default: true, channels: ['whatsapp'], channel_bindings: ['telegram:1'], version: 3 });
        expect(h.sql.some(sql => sql.startsWith('UPDATE'))).toBe(false);
        expect(h.events.emit).not.toHaveBeenCalled();
    });
    it('rolls back transferred assignments and defaults when the final agent write fails', async () => {
        const h = harness(true);
        await expect(h.service.updateAgent(TENANT, AGENT, { expectedVersion: 8, isDefault: true, channels: ['whatsapp'], channelBindings: ['telegram:1'] })).rejects.toThrow('write failed');
        expect(h.other()).toMatchObject({ is_default: true, channels: ['whatsapp'], channel_bindings: ['telegram:1'], version: 3 });
        expect(h.current().version).toBe(8);
        expect(h.events.emit).not.toHaveBeenCalled();
        expect(h.redis.del).not.toHaveBeenCalled();
    });
    it('requires a client version at the HTTP boundary for every editor mutation', async () => {
        const updateAgent = jest.fn();
        const controller = new PersonaController({ updateAgent } as any, {} as any, {} as any);
        await expect(controller.updateAgent(TENANT, AGENT, { isActive: true })).rejects.toBeInstanceOf(BadRequestException);
        expect(updateAgent).not.toHaveBeenCalled();
    });
});
