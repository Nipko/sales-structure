import { BadRequestException, ConflictException } from '@nestjs/common';
import { PersonaService } from './persona.service';
import { PersonaController } from './persona.controller';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
function harness(failFinalWrite = false, agentReviewMode: 'immediate' | 'reviewed' = 'immediate') {
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
    const prisma = { channelAccount: { findMany: jest.fn().mockResolvedValue([]) }, tenant: { findUnique: jest.fn().mockResolvedValue({ settings: { agentReviewMode } }) }, transactionInTenantSchema: jest.fn(async (_schema, work) => {
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
            h.service.updateAgent(TENANT, AGENT, { expectedVersion: 8, isActive: false }),
            h.service.updateAgent(TENANT, AGENT, { expectedVersion: 8, isActive: false }),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
        expect(h.current().version).toBe(9);
        expect(h.sql.filter(sql => sql.startsWith('UPDATE'))).toHaveLength(1);
        expect(h.sql[0]).toContain('public.tenants');
        expect(h.sql[1]).toContain('FOR UPDATE');
    });
    it('rejects a stale deactivation before changing any agent', async () => {
        const h = harness();
        await expect(h.service.updateAgent(TENANT, AGENT, { expectedVersion: 7, isActive: false })).rejects.toBeInstanceOf(ConflictException);
        expect(h.other()).toMatchObject({ is_default: true, channels: ['whatsapp'], channel_bindings: ['telegram:1'], version: 3 });
        expect(h.sql.some(sql => sql.startsWith('UPDATE'))).toBe(false);
        expect(h.events.emit).not.toHaveBeenCalled();
    });
    it('rolls back deactivation when the final agent write fails', async () => {
        const h = harness(true);
        await expect(h.service.updateAgent(TENANT, AGENT, { expectedVersion: 8, isActive: false })).rejects.toThrow('write failed');
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
    it.each([{ configJson: { persona: { name: 'Changed' } } }, { isDefault: true }, { channels: ['whatsapp'] }, { partialDraft: true }])(
        'cannot bypass the configuration contract with the legacy update payload %j', async payload => {
            const h = harness();
            await expect(h.service.updateAgent(TENANT, AGENT, { ...payload, expectedVersion: 8 })).rejects.toMatchObject({ response: { error: 'agent_draft_contract_required' } });
            expect(h.sql).toEqual([]); expect(h.current().version).toBe(8);
        });
    // Switching ON puts a configuration in front of customers. A bare
    // `is_active=true` here skipped the revision, the audit row and the check
    // that no other agent serves the same connection, so it is not this
    // method's job in either mode: immediate mode commits it
    // (AgentDraftService.activate), reviewed mode publishes it.
    it.each(['immediate', 'reviewed'] as const)('never switches an agent on by itself (%s changes)', async mode => {
        const h = harness(false, mode);
        await expect(h.service.updateAgent(TENANT, AGENT, { expectedVersion: 8, isActive: true })).rejects.toMatchObject({ response: { error: 'agent_draft_contract_required' } });
        expect(h.sql).toEqual([]); expect(h.current().version).toBe(8);
        expect(h.events.emit).not.toHaveBeenCalled();
    });
});

/**
 * Owner decision D1/D15 (sep-2026): changes apply at once by default, so the
 * switch that turned the agent off must turn it back on. The PUT used to refuse
 * `isActive: true` outright: a tenant_admin who switched her only agent off and
 * on got an error, the agent stayed inactive and every channel went silent.
 */
describe('the editor switch at the HTTP boundary', () => {
    const req = { user: { sub: '33333333-3333-4333-8333-333333333333', role: 'tenant_admin' } };
    function controller() {
        const personaService = { updateAgent: jest.fn(async () => ({ id: AGENT, is_active: false, version: 9 })) };
        const drafts = { activate: jest.fn(async () => ({ id: AGENT, is_active: true, version: 9 })) };
        return { personaService, drafts, controller: new PersonaController(personaService as any, {} as any, {} as any, undefined, drafts as any) };
    }
    it('switches the agent on through the committed path of a save, as the signed-in admin', async () => {
        const h = controller();
        await expect(h.controller.updateAgent(TENANT, AGENT, { isActive: true, expectedVersion: 8 }, req))
            .resolves.toEqual({ success: true, data: { id: AGENT, is_active: true, version: 9 } });
        expect(h.drafts.activate).toHaveBeenCalledWith(TENANT, AGENT, 8, { id: req.user.sub, role: 'tenant_admin' });
        expect(h.personaService.updateAgent).not.toHaveBeenCalled();
    });
    it('keeps switching off as the immediate safety action it was', async () => {
        const h = controller();
        await h.controller.updateAgent(TENANT, AGENT, { isActive: false, expectedVersion: 8 }, req);
        expect(h.personaService.updateAgent).toHaveBeenCalledWith(TENANT, AGENT, { isActive: false, expectedVersion: 8 });
        expect(h.drafts.activate).not.toHaveBeenCalled();
    });
    it.each([{ isActive: 'yes', expectedVersion: 8 }, { isActive: true, expectedVersion: 8, channels: ['whatsapp'] }])(
        'still accepts nothing but the switch %j', async payload => {
            const h = controller();
            await expect(h.controller.updateAgent(TENANT, AGENT, payload, req)).rejects.toMatchObject({ response: { error: 'agent_draft_contract_required' } });
            expect(h.drafts.activate).not.toHaveBeenCalled(); expect(h.personaService.updateAgent).not.toHaveBeenCalled();
        });
    it('refuses to switch on rather than bypass the commit when the commit is not wired', async () => {
        const updateAgent = jest.fn();
        const bare = new PersonaController({ updateAgent } as any, {} as any, {} as any);
        await expect(bare.updateAgent(TENANT, AGENT, { isActive: true, expectedVersion: 8 }, req)).rejects.toMatchObject({ response: { error: 'agent_draft_contract_required' } });
        expect(updateAgent).not.toHaveBeenCalled();
    });
});
