import { randomUUID } from 'crypto';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · LEGACY TENANT. `commitment_proposals` is deliberately absent from `tables`.
 * Dropping ensureCommitmentProposals from ensureControlTables must kill this suite.
 *
 * (Original contract) The customer's "yes" to a commitment-family write must not die in the
 * preflight transaction. `commitment_proposals` is a canonical table, so
 * recording the acceptance is an INSERT: any runtime DDL there trips the
 * schema-lock rule (`runtime_schema_lock_required_at_transaction_start`) and the
 * tool answers `tool_failed`. No workaround is applied: the schema is the
 * production one.
 *
 * The writers are doubles on purpose. What is under test is the control layer
 * (confirmation -> acceptance recorded -> writer reached), not the writers.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3: commitment families record the acceptance without runtime DDL', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any;
    const createOrder = jest.fn(async (_schema: string, input: any) => ({
        id: randomUUID(), status: 'pending', payment_status: 'pending', total: 25_000, currency: 'COP', items: input.items }));
    
    beforeAll(async () => {
        h = await openLive({
            prefix: 'n3leg',
            tables: [...CRM_BASE_TABLES, 'menu_items', 'tool_execution_ledger',
                'tool_approval_tickets', 'tool_approval_outbox', 'operational_notice_outbox'],
            executorDeps: { restaurantsService: { createOrder } },
        });
        scope = await h.seedAgent();
    });
    afterAll(async () => { if (h) await h.close(); });

    const accepted = async (contactId: string, family: string) =>
        h.q<any[]>(`SELECT family, accepted_at, amount_cents, currency FROM commitment_proposals
                     WHERE contact_id=$1::uuid AND family=$2 AND accepted_at IS NOT NULL`, [contactId, family]);

    it('place_order: confirming the quoted order creates it and records the accepted proposal', async () => {
        const menuItemId = randomUUID();
        await h.q(`INSERT INTO menu_items(id,name,price,currency,is_active,is_available) VALUES($1::uuid,'Bandeja',25000,'COP',true,true)`, [menuItemId]);
        const C = await seedCustomer(h.q, 'Cliente');
        const args = { orderType: 'pickup', customerName: 'Cliente', customerPhone: '+573001112233', items: [{ menuItemId, quantity: 1 }] };
        await h.inbound(C.conversationId, 'quiero una bandeja');
        expect(await h.call(C.contactId, C.conversationId, 'place_order', args, scope)).toMatchObject({ error: 'confirmation_required' });
        await h.inbound(C.conversationId, 'sí, confirmo');
        const result = await h.call(C.contactId, C.conversationId, 'place_order', args, scope);
        expect(result.error).toBeUndefined();
        expect(createOrder).toHaveBeenCalledTimes(1);
        const rows = await accepted(C.contactId, 'restaurant_orders');
        expect(rows).toHaveLength(1);
        expect(String(rows[0].amount_cents)).toBe('2500000');
    });
});
