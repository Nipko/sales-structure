import { CustomerMemoryService } from './customer-memory.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const profileId = '44444444-4444-4444-8444-444444444444';
const correction = { key: 'contact.preference.channel', text: 'Prefiere correo, no llamadas', kind: 'preference', evidence: 'Ahora prefiero correo, no llamadas', validUntil: null };

function build() {
    const state = {
        facts: [{ id: 'old', owner_kind: 'profile', owner_id: profileId, fact_key: correction.key,
            fact_text: 'Prefiere teléfono', fact_kind: 'preference', evidence_text: 'Prefiero teléfono',
            valid_until: null, source_contact_id: contactId, source_conversation_id: conversationId, status: 'active' }] as any[],
        erased: false, failInsert: false, merged: ['Prefiere teléfono'],
    };
    const active = () => state.facts.filter(f => f.status === 'active' && (!f.valid_until || Date.parse(f.valid_until) > Date.now()));
    const query = jest.fn(async (sql: string, p: any[] = []) => {
        if (sql.includes('SELECT contact_id FROM customer_memory_erasure')) return state.erased ? [{ contact_id: contactId }] : [];
        if (sql.includes('SELECT customer_profile_id')) return [{ customer_profile_id: profileId }];
        if (sql.includes('FROM messages')) return [{ direction: 'inbound', content_text: correction.evidence }];
        if (sql.includes('SELECT id, fact_key')) return active().map(f => ({ ...f }));
        if (sql.includes('SELECT fact_text')) return active().map(f => ({ fact_text: f.fact_text }));
        if (sql.includes("SET status = 'superseded'")) state.facts.forEach(f => { if (f.status === 'active') f.status = 'superseded'; });
        if (sql.includes('INSERT INTO customer_memory_facts')) {
            if (state.failInsert) throw new Error('write failed');
            state.facts.push({ id: 'new', owner_kind: p[0], owner_id: p[1], fact_key: p[2], fact_text: p[3],
                fact_kind: p[4], evidence_text: p[6], source_contact_id: p[7], source_conversation_id: p[8], valid_until: p[9], status: 'active' });
        }
        if (sql.includes('INSERT INTO customer_memories')) state.merged = JSON.parse(p[1]);
        return [];
    });
    const prisma = {
        executeInTenantSchema: jest.fn((_schema: string, sql: string, p: any[]) => query(sql, p)),
        transactionInTenantSchema: jest.fn(async (_schema: string, callback: (q: typeof query) => Promise<unknown>) => {
            const before = JSON.parse(JSON.stringify(state));
            try { return await callback(query); } catch (error) { Object.assign(state, before); throw error; }
        }),
    };
    const router = { execute: jest.fn().mockResolvedValue({ content: JSON.stringify({ facts: [correction] }) }) };
    const knowledge = { generateEmbedding: jest.fn().mockRejectedValue(new Error('not configured')) };
    const service = new CustomerMemoryService(prisma as any, router as any, knowledge as any);
    jest.spyOn(service as any, 'ensureTable').mockResolvedValue(undefined);
    return { service, state, query, prisma, router, knowledge };
}

describe('Customer memory publication and correction', () => {
    it('supersedes the old preference and retrieves only the correction without embeddings', async () => {
        const { service, state } = build();
        await service.extractFromConversation(tenantId, 'tenant_memory', conversationId, contactId);
        const memory = await service.getMemory('tenant_memory', contactId, 'Cómo contactar', tenantId);
        expect(memory?.facts).toEqual([correction.text]);
        expect(state.facts[0].status).toBe('superseded');
        expect(state.facts[1]).toMatchObject({ fact_key: correction.key, evidence_text: correction.evidence,
            source_contact_id: contactId, source_conversation_id: conversationId });
        expect(state.merged).toEqual([correction.text]);
    });

    it('does not partially publish a correction if semantic storage fails', async () => {
        const { service, state } = build();
        state.failInsert = true;
        await service.extractFromConversation(tenantId, 'tenant_memory', conversationId, contactId);
        expect((await service.getMemory('tenant_memory', contactId))?.facts).toEqual(['Prefiere teléfono']);
        expect(state.facts).toHaveLength(1);
        expect(state.facts[0].status).toBe('active');
        expect(state.merged).toEqual(['Prefiere teléfono']);
    });

    it('does not resurrect a stale merged row when all current facts are retracted', async () => {
        const { service, state, router } = build();
        router.execute.mockResolvedValue({ content: JSON.stringify({ facts: [] }) });
        await service.extractFromConversation(tenantId, 'tenant_memory', conversationId, contactId);
        state.merged = ['Prefiere teléfono']; // another historical contact snapshot
        expect(await service.getMemory('tenant_memory', contactId)).toBeNull();
        expect(state.facts[0].status).toBe('superseded');
    });

    it('rejects extracted facts without a literal customer source', async () => {
        const { service, state, router, prisma } = build();
        router.execute.mockResolvedValue({ content: JSON.stringify({ facts: [{ ...correction, evidence: 'Agente: debe pagar 1000' }] }) });
        await service.extractFromConversation(tenantId, 'tenant_memory', conversationId, contactId);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        expect(state.facts[0].status).toBe('active');
    });

    it('does not allow a delayed extractor to restore erased memory', async () => {
        const { service, state, router } = build();
        router.execute.mockImplementation(async () => {
            state.erased = true;
            state.facts = [];
            return { content: JSON.stringify({ facts: [correction] }) };
        });
        await service.extractFromConversation(tenantId, 'tenant_memory', conversationId, contactId);
        expect(state.facts).toEqual([]);
        expect(await service.getMemory('tenant_memory', contactId)).toBeNull();
    });

    it('does not overwrite a newer channel correction using an older extraction snapshot', async () => {
        const { service, state, router } = build();
        router.execute.mockImplementation(async () => {
            state.facts[0] = { ...state.facts[0], id: 'concurrent', fact_text: 'No quiere contacto comercial' };
            return { content: JSON.stringify({ facts: [correction] }) };
        });
        await service.extractFromConversation(tenantId, 'tenant_memory', conversationId, contactId);
        expect((await service.getMemory('tenant_memory', contactId))?.facts).toEqual(['No quiere contacto comercial']);
    });

    it('filters expired facts from embedding and offline retrieval', async () => {
        const { service, state, query, knowledge } = build();
        state.facts[0].valid_until = '2020-01-01T00:00:00Z';
        expect(await service.getMemory('tenant_memory', contactId, 'contacto', tenantId)).toBeNull();
        knowledge.generateEmbedding.mockResolvedValue([0.1] as never);
        expect(await service.getMemory('tenant_memory', contactId, 'contacto', tenantId)).toBeNull();
        for (const [sql] of query.mock.calls.filter(([sql]) => sql.includes('SELECT fact_text'))) {
            expect(sql).toContain("status = 'active'");
            expect(sql).toContain('valid_until > NOW()');
        }
    });
});
