import { ComplianceService } from './compliance.service';

const contactId = '11111111-1111-4111-8111-111111111111';
const siblingId = '22222222-2222-4222-8222-222222222222';
const profileId = '33333333-3333-4333-8333-333333333333';

function build(failMemory = false) {
    const state = { tombstones: [] as string[], facts: ['active', 'superseded'], merged: [contactId, siblingId] };
    const query = jest.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes('SELECT DISTINCT customer_profile_id')) return [{ customer_profile_id: profileId }];
        if (sql.includes('SELECT DISTINCT contact_id')) return [{ contact_id: contactId }, { contact_id: siblingId }];
        if (sql.includes('INSERT INTO customer_memory_erasure')) state.tombstones = params[0];
        if (sql.includes('DELETE FROM customer_memory_facts')) {
            if (failMemory) throw new Error('memory deletion failed');
            const deleted = state.facts.map(id => ({ id }));
            state.facts = [];
            return deleted;
        }
        if (sql.includes('DELETE FROM customer_memories')) {
            const deleted = state.merged.map(contact_id => ({ contact_id }));
            state.merged = [];
            return deleted;
        }
        return [];
    });
    const prisma = {
        executeInTenantSchema: jest.fn((_schema: string, sql: string, params: any[]) => query(sql, params)),
        transactionInTenantSchema: jest.fn(async (_schema: string, callback: (q: typeof query) => Promise<unknown>) => {
            const before = JSON.parse(JSON.stringify(state));
            try { return await callback(query); } catch (e) { Object.assign(state, before); throw e; }
        }),
        auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    return { service: new ComplianceService(prisma as any), query, prisma, state };
}

describe('Contact erasure reaches memory derivatives', () => {
    it('removes active and historical facts and merged rows for the unified profile and linked contacts', async () => {
        const { service, query, state } = build();
        const result = await service.eraseContactData('tenant_memory', profileId, contactId, 'admin');
        expect(result.completed).toBe(true);
        expect(result.erasedTables).toEqual(expect.arrayContaining(['customer_memories', 'customer_memory_facts']));
        expect(state.facts).toEqual([]);
        expect(state.merged).toEqual([]);
        expect(state.tombstones).toEqual([contactId, siblingId]);
        const deletion = query.mock.calls.find(([sql]) => sql.includes('DELETE FROM customer_memory_facts'))!;
        expect(deletion[1]).toEqual([[profileId], [contactId, siblingId]]);
        expect(deletion[0]).not.toContain("status = 'active'");
        expect(deletion[0]).toContain('source_contact_id');
        expect(query.mock.calls.some(([sql, p]) => sql.includes('pg_advisory_xact_lock') &&
            p?.[0] === `customer-memory:tenant_memory:profile:${profileId}`)).toBe(true);
    });

    it('keeps the deletion request pending and reports incomplete if derived-memory deletion fails', async () => {
        const { service, query, state, prisma } = build(true);
        const result = await service.eraseContactData('tenant_memory', profileId, contactId, 'admin');
        expect(result.completed).toBe(false);
        expect(result.failedTables).toContain('customer_memory');
        expect(state.facts).toEqual(['active', 'superseded']);
        expect(state.tombstones).toEqual([]);
        expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE deletion_requests SET status = 'completed'"))).toBe(false);
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'gdpr.contact_erasure_incomplete' }),
        }));
    });

    it('resolves campaign phone matches before anonymizing the contact phone', async () => {
        const { service, query } = build();
        await service.eraseContactData('tenant_memory', profileId, contactId, 'admin');
        const sqls = query.mock.calls.map(([sql]) => sql);
        expect(sqls.findIndex(sql => sql.startsWith('UPDATE campaign_recipients')))
            .toBeLessThan(sqls.findIndex(sql => sql.startsWith('UPDATE contacts')));
    });
});
