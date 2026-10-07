import { randomUUID } from 'crypto';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · pedidos — through the live executor and the central control, on the
 * canonical catalogue DDL.
 *
 *   CORE-CAT-06  a catalogue order needs a signed confirmation, is created once,
 *                and takes the stock once; a price that moves between the
 *                question and the yes forces a new confirmation.
 *   CORE-CAT-07  a customer sees and cancels only their own orders.
 *
 * Oracles: orders / order_items / products.stock / stock_movements rows.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 catalogue orders: signed confirmation, single effect, ownership', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, productId: string;
    const TABLES = [...CRM_BASE_TABLES, 'products', 'stock_movements', 'orders', 'order_items',
        'tool_execution_ledger', 'tool_approval_tickets', 'tool_approval_outbox', 'commitment_proposals',
        'operational_notice_outbox'];

    beforeAll(async () => {
        h = await openLive({ prefix: 'n3cat', tables: TABLES });
        scope = await h.seedAgent();
        productId = randomUUID();
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => {
        await h.q('TRUNCATE order_items,orders,stock_movements,products,tool_execution_ledger,messages CASCADE');
        await h.q(`INSERT INTO products(id,name,price,currency,stock,is_available)
            VALUES($1::uuid,'Camiseta N3',10,'COP',5,true)`, [productId]);
    });

    const items = (quantity = 2) => ({ items: [{ productId, quantity }], notes: 'pedido N3' });
    const stock = async () => (await h.q<any[]>('SELECT stock FROM products WHERE id=$1::uuid', [productId]))[0].stock as number;
    const orderRows = () => h.q<any[]>('SELECT id,status,contact_id FROM orders');
    const movements = async () => (await h.q<any[]>('SELECT COUNT(*)::int AS n FROM stock_movements'))[0].n as number;
    const place = (C: any, args = items()) => h.call(C.contactId, C.conversationId, 'place_catalog_order', args, scope);

    it('CORE-CAT-06: no order before the yes; one order and one stock deduction after it; the replay is the same order', async () => {
        const C = await seedCustomer(h.q, 'Compradora');

        // (a) intent only → a challenge that carries the exact terms the customer will agree to.
        await h.inbound(C.conversationId, 'quiero comprar dos camisetas');
        const challenge = await place(C);
        expect(challenge).toMatchObject({ error: 'confirmation_required', catalogTerms: { totalAmountCents: '2000' } });
        expect(await orderRows()).toEqual([]);
        expect(await stock()).toBe(5);
        expect(await movements()).toBe(0);
        expect((await h.q('SELECT status FROM tool_execution_ledger'))).toEqual([{ status: 'awaiting_confirmation' }]);

        // A question is not a yes.
        await h.inbound(C.conversationId, '¿y cuánto cuesta el envío?');
        expect(await place(C)).toMatchObject({ error: 'confirmation_required' });
        expect(await orderRows()).toEqual([]);

        // (b) the yes.
        await h.inbound(C.conversationId, 'sí, confirmo');
        const placed = await place(C);
        expect(placed).toMatchObject({ success: true, order: { status: 'pending', total: 20 } });
        expect(await orderRows()).toHaveLength(1);
        expect(await stock()).toBe(3);
        expect(await movements()).toBe(1);
        const lines = await h.q<any[]>('SELECT quantity,unit_price::float AS unit_price FROM order_items');
        expect(lines).toEqual([{ quantity: 2, unit_price: 10 }]);

        // (c) the identical call again: same order, stock does not move again.
        const replay = await place(C);
        expect(replay).toMatchObject({ success: true, order: { id: placed.order.id } });
        expect(await orderRows()).toHaveLength(1);
        expect(await stock()).toBe(3);
        expect(await movements()).toBe(1);
    });

    it('CORE-CAT-06: a price change between the question and the yes forces a fresh confirmation', async () => {
        const C = await seedCustomer(h.q, 'Compradora');
        await h.inbound(C.conversationId, 'quiero comprar dos camisetas');
        expect(await place(C)).toMatchObject({ error: 'confirmation_required', catalogTerms: { totalAmountCents: '2000' } });
        await h.q('UPDATE products SET price=12 WHERE id=$1::uuid', [productId]);

        await h.inbound(C.conversationId, 'sí, confirmo');
        const reviewed = await place(C);
        expect(reviewed).toMatchObject({ error: 'confirmation_required', catalogTerms: { totalAmountCents: '2400' } });
        expect(await orderRows()).toEqual([]);
        expect(await stock()).toBe(5);

        // The customer says yes to the NEW terms: now it is written, at the new price.
        await h.inbound(C.conversationId, 'sí, confirmo');
        const placed = await place(C);
        expect(placed).toMatchObject({ success: true, order: { total: 24 } });
        expect(await orderRows()).toHaveLength(1);
        expect(await stock()).toBe(3);
    });

    it('CORE-CAT-06: a "no" writes nothing; stock beyond what exists is never sold', async () => {
        const C = await seedCustomer(h.q, 'Compradora');
        await h.inbound(C.conversationId, 'quiero comprar dos camisetas');
        expect(await place(C)).toMatchObject({ error: 'confirmation_required' });
        await h.inbound(C.conversationId, 'no');
        expect(await place(C)).toMatchObject({ error: 'action_rejected' });
        expect(await orderRows()).toEqual([]);
        expect(await stock()).toBe(5);

        const D = await seedCustomer(h.q, 'Acaparador');
        await h.inbound(D.conversationId, 'quiero 9 camisetas');
        const args = items(9);
        const first = await place(D, args);
        // Either refused up front, or challenged and refused at the writer — never sold.
        if (first.error === 'confirmation_required') {
            await h.inbound(D.conversationId, 'sí, confirmo');
            const second = await place(D, args);
            expect(second.success).not.toBe(true);
        } else {
            expect(first.success).not.toBe(true);
        }
        expect(await orderRows()).toEqual([]);
        expect(await stock()).toBe(5);
        expect(await movements()).toBe(0);
    });

    it('CORE-CAT-07: customer B neither sees nor cancels customer A\'s order', async () => {
        const A = await seedCustomer(h.q, 'Alicia');
        const B = await seedCustomer(h.q, 'Intruso');
        await h.inbound(A.conversationId, 'quiero dos camisetas');
        await place(A);
        await h.inbound(A.conversationId, 'sí, confirmo');
        const placed = await place(A);
        const orderId = placed.order.id as string;
        const stockAfterA = await stock();
        const before = (await h.q<any[]>('SELECT status,version,total_amount::text AS total FROM orders WHERE id=$1::uuid', [orderId]))[0];

        // Reads: nothing of A's order is reachable by B.
        await h.inbound(B.conversationId, 'dime de ese pedido');
        const get = await h.call(B.contactId, B.conversationId, 'get_catalog_order', { orderId }, scope);
        expect(get).toMatchObject({ error: 'catalog_order_not_found' });
        expect(JSON.stringify(get)).not.toMatch(/Camiseta|pedido N3|totalAmount/);
        expect(await h.call(B.contactId, B.conversationId, 'get_order_status', { orderId }, scope)).toMatchObject({ found: false });
        const mine = await h.call(B.contactId, B.conversationId, 'list_my_catalog_orders', {}, scope);
        expect(mine.orders).toEqual([]);
        const legacy = await h.call(B.contactId, B.conversationId, 'list_customer_orders', {}, scope);
        expect(JSON.stringify(legacy)).not.toContain(orderId);

        // Cancel: refused as "not found" whether or not B confirms; A's order and stock do not move.
        await h.inbound(B.conversationId, 'cancela ese pedido');
        const cancelArgs = { orderId, reason: 'no lo quiero' };
        const first = await h.call(B.contactId, B.conversationId, 'cancel_catalog_order', cancelArgs, scope);
        expect(first.error).toBe('catalog_order_not_found');
        await h.inbound(B.conversationId, 'sí, confirmo');
        const second = await h.call(B.contactId, B.conversationId, 'cancel_catalog_order', cancelArgs, scope);
        expect(second.error).toBe('catalog_order_not_found');

        const after = (await h.q<any[]>('SELECT status,version,total_amount::text AS total FROM orders WHERE id=$1::uuid', [orderId]))[0];
        expect(after).toEqual(before);
        expect(await stock()).toBe(stockAfterA);
        expect(await movements()).toBe(1);

        // Control: the owner does see it, lists it, and CAN cancel it (stock comes back once).
        expect(await h.call(A.contactId, A.conversationId, 'get_catalog_order', { orderId }, scope))
            .toMatchObject({ success: true, order: { id: orderId } });
        expect((await h.call(A.contactId, A.conversationId, 'list_my_catalog_orders', {}, scope)).orders.map((o: any) => o.id)).toEqual([orderId]);
        expect(await h.call(A.contactId, A.conversationId, 'get_order_status', { orderId }, scope)).toMatchObject({ found: true });
        await h.inbound(A.conversationId, 'quiero cancelar mi pedido');
        expect(await h.call(A.contactId, A.conversationId, 'cancel_catalog_order', cancelArgs, scope)).toMatchObject({ error: 'confirmation_required' });
        await h.inbound(A.conversationId, 'sí, confirmo');
        expect(await h.call(A.contactId, A.conversationId, 'cancel_catalog_order', cancelArgs, scope)).toMatchObject({ success: true, order: { status: 'cancelled' } });
        expect(await stock()).toBe(5);
        expect(await movements()).toBe(2);
    });
});
