import { LeadsRepository } from '../crm/repositories/leads.repository';
import { OpportunitiesRepository } from '../crm/repositories/opportunities.repository';
import { TasksService } from '../crm/services/tasks/tasks.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const leadId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';
const opportunityId = '55555555-5555-4555-8555-555555555555';
const taskId = '66666666-6666-4666-8666-666666666666';

/**
 * Mimics PostgreSQL's transaction-scoped advisory mutex closely enough for a
 * race test: callbacks run concurrently until their lock query, then the lock
 * is held until that callback commits. Without the lock before the lookup,
 * both callbacks observe an empty state and both INSERT handlers run.
 */
function advisoryTransactionHarness(
    handleQuery: (sql: string, params: any[]) => Promise<any>,
) {
    let lockTail = Promise.resolve();
    const transactions: string[][] = [];
    const transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => {
        const calls: string[] = [];
        transactions.push(calls);
        let release: (() => void) | undefined;
        let acquired = false;
        const query = async (sql: string, params: any[] = []) => {
            calls.push(sql);
            if (sql.includes('pg_advisory_xact_lock')) {
                const previous = lockTail;
                const held = new Promise<void>((resolve) => { release = resolve; });
                lockTail = previous.then(() => held);
                await previous;
                acquired = true;
                return [];
            }
            return handleQuery(sql, params);
        };
        try {
            return await callback(query);
        } finally {
            if (acquired) release?.();
        }
    });
    return { transactionInTenantSchema, transactions };
}

describe('CRM conversational writers serialize their dedupe decision', () => {
    it('creates one active lead when two turns ensure the same contact concurrently', async () => {
        let storedLead: any = null;
        let inserts = 0;
        const tx = advisoryTransactionHarness(async (sql) => {
            if (sql.includes('SELECT * FROM leads')) return storedLead ? [storedLead] : [];
            if (sql.includes('INSERT INTO leads')) {
                inserts += 1;
                storedLead = { id: leadId, contact_id: contactId };
                return [storedLead];
            }
            return [];
        });
        const prisma: any = { transactionInTenantSchema: tx.transactionInTenantSchema };
        const redis: any = { get: jest.fn().mockResolvedValue('tenant_crm') };
        const pipeline: any = {
            resolveTenantStage: jest.fn().mockResolvedValue({ slug: 'nuevo' }),
        };
        const regional: any = { phoneRegionFor: jest.fn().mockResolvedValue('CO') };
        const repository = new LeadsRepository(prisma, redis, pipeline, regional);

        const results = await Promise.all([
            repository.ensureActiveLeadForContact(tenantId, contactId, { phone: '+573001234567' } as any),
            repository.ensureActiveLeadForContact(tenantId, contactId, { phone: '+573001234567' } as any),
        ]);

        expect(inserts).toBe(1);
        expect(results.map((result) => result.created).sort()).toEqual([false, true]);
        expect(results.map((result) => result.lead?.id)).toEqual([leadId, leadId]);
        expect(tx.transactions).toHaveLength(2);
        expect(tx.transactions.every((calls) => calls[0]?.includes('pg_advisory_xact_lock'))).toBe(true);
    });

    it('creates one open opportunity for the same conversation and title concurrently', async () => {
        let storedOpportunity: any = null;
        let inserts = 0;
        const tx = advisoryTransactionHarness(async (sql) => {
            if (sql.includes('SELECT * FROM opportunities')) {
                return storedOpportunity ? [storedOpportunity] : [];
            }
            if (sql.includes('INSERT INTO opportunities')) {
                inserts += 1;
                storedOpportunity = {
                    id: opportunityId,
                    lead_id: leadId,
                    conversation_id: conversationId,
                    stage: 'nuevo',
                };
                return [storedOpportunity];
            }
            return [];
        });
        const prisma: any = { transactionInTenantSchema: tx.transactionInTenantSchema };
        const redis: any = { get: jest.fn().mockResolvedValue('tenant_crm') };
        const pipeline: any = {
            resolveTenantStage: jest.fn().mockResolvedValue({
                id: '77777777-7777-4777-8777-777777777777',
                slug: 'nuevo',
                terminal_outcome: null,
            }),
            syncExactOpportunityDealTx: jest.fn().mockResolvedValue(undefined),
        };
        const repository = new OpportunitiesRepository(prisma, redis, pipeline);
        const request = {
            lead_id: leadId,
            conversation_id: conversationId,
            title: 'Plan anual',
            metadata: { title: 'Plan anual', source: 'conversational_agent' },
        } as any;

        const results = await Promise.all([
            repository.createOpportunityIdempotently(tenantId, request),
            repository.createOpportunityIdempotently(tenantId, request),
        ]);

        expect(inserts).toBe(1);
        expect(results.map((result) => result.created).sort()).toEqual([false, true]);
        expect(results.map((result) => result.opportunity?.id)).toEqual([opportunityId, opportunityId]);
        expect(pipeline.syncExactOpportunityDealTx).toHaveBeenCalledTimes(1);
        expect(tx.transactions.every((calls) => calls[0]?.includes('pg_advisory_xact_lock'))).toBe(true);
    });

    it('creates one follow-up inside the 60-second window concurrently', async () => {
        let storedTask: any = null;
        let inserts = 0;
        const tx = advisoryTransactionHarness(async (sql) => {
            if (sql.includes('SELECT * FROM tasks')) return storedTask ? [storedTask] : [];
            if (sql.includes('INSERT INTO tasks')) {
                inserts += 1;
                storedTask = { id: taskId, lead_id: leadId, status: 'pending' };
                return [storedTask];
            }
            return [];
        });
        const prisma: any = { transactionInTenantSchema: tx.transactionInTenantSchema };
        const redis: any = { get: jest.fn().mockResolvedValue('tenant_crm') };
        const service = new TasksService(prisma, redis);
        const request = {
            leadId,
            opportunityId,
            title: 'Llamar para confirmar',
            dueAt: '2026-08-24T15:00:00.000Z',
            createdBy: 'conversational_agent',
        };

        const results = await Promise.all([
            service.createTaskIdempotently(tenantId, request),
            service.createTaskIdempotently(tenantId, request),
        ]);

        expect(inserts).toBe(1);
        expect(results.map((result) => result.created).sort()).toEqual([false, true]);
        expect(results.map((result) => result.task?.id)).toEqual([taskId, taskId]);
        expect(tx.transactions.every((calls) => calls[0]?.includes('pg_advisory_xact_lock'))).toBe(true);
    });
});
