import { randomUUID } from 'crypto';
import { EcommerceService } from '../ecommerce/ecommerce.service';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · shop catalogue — stock, cancellation, unsellable products, recommendations.
 *
 * Real: executor, central control (ledger + signed confirmation), `OrdersService`
 * catalogue commands, canonical `products`/`orders`/`stock_movements` DDL.
 * Simulated: nothing external is reachable from these tools.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 shop: catalogue stock, cancellation and budget', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any;

    beforeAll(async () => {
        const holder: { prisma?: any } = {};
        const proxy = new Proxy({}, { get: (_t, key) => holder.prisma[key as any] });
        const ecommerce = new EcommerceService(proxy as any, {} as any, {} as any, {} as any);
        h = await openLive({
            prefix: 'n3shop', workarounds: { commitmentDdl: true },
            executorDeps: { ecommerceService: ecommerce },
            tables: [...CRM_BASE_TABLES, 'products', 'stock_movements', 'orders', 'order_items', 'commercial_offers',
                'tool_execution_ledger', 'tool_approval_tickets', 'tool_approval_outbox', 'commitment_proposals', 'operational_notice_outbox'],
        });
        holder.prisma = h.prisma;
        scope = await h.seedAgent();
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => {
        await h.q('TRUNCATE order_items,orders,stock_movements,products,commercial_offers,tool_execution_ledger,messages CASCADE');
    });

    const product = async (name: string, price: number, stock: number | null, available = true, category = 'Audio') => {
        const id = randomUUID();
        await h.q(`INSERT INTO products(id,name,description,category,price,currency,stock,is_available)
            VALUES($1::uuid,$2,$3,$4,$5,'COP',$6,$7)`, [id, name, `${name} de prueba`, category, price, stock, available]);
        return id;
    };
    const stockOf = async (id: string) => (await h.q<any[]>('SELECT stock FROM products WHERE id=$1::uuid', [id]))[0].stock;
    const confirmed = async (C: { contactId: string; conversationId: string }, tool: string, args: any) => {
        await h.inbound(C.conversationId, 'quiero hacerlo');
        const first = await h.call(C.contactId, C.conversationId, tool, args, scope);
        if (first.error !== 'confirmation_required') return first;
        await h.inbound(C.conversationId, 'sí, confirmo');
        return h.call(C.contactId, C.conversationId, tool, args, scope);
    };

    it('SHOP-STOCK: an order deducts tracked stock once, records the movement, and a replay does not deduct again', async () => {
        const id = await product('Audifono Aurora', 50000, 5);
        const C = await seedCustomer(h.q, 'Comprador');
        const args = { items: [{ productId: id, quantity: 2 }] };
        const placed = await confirmed(C, 'place_catalog_order', args);
        expect(placed).toMatchObject({ success: true, order: { total: 100000 } });
        expect(await stockOf(id)).toBe(3);
        const replay = await h.call(C.contactId, C.conversationId, 'place_catalog_order', args, scope);
        expect(replay).toMatchObject({ success: true, order: { id: placed.order.id } });
        expect(await stockOf(id)).toBe(3);
        expect(await h.q('SELECT quantity,previous_stock,new_stock FROM stock_movements')).toEqual([
            expect.objectContaining({ quantity: 2, previous_stock: 5, new_stock: 3 })]);
    });

    it.each([
        ['stock below the quantity', 1, true],
        ['zero stock', 0, true],
    ])('SHOP-OOS: an order for a product with %s writes nothing and keeps the stock', async (_label, stock, available) => {
        const id = await product('Parlante Brisa', 90000, stock, available);
        const C = await seedCustomer(h.q, 'Comprador');
        const result = await confirmed(C, 'place_catalog_order', { items: [{ productId: id, quantity: 2 }] });
        // eslint-disable-next-line no-console
        console.log(`[SHOP-OOS ${_label}] result=${JSON.stringify(result).slice(0, 200)}`);
        expect(result.success).not.toBe(true);
        expect(await h.q('SELECT id FROM orders')).toEqual([]);
        expect(await stockOf(id)).toBe(stock);
    });

    it('SHOP-INACTIVE: an order for an inactive (is_available=false) product is refused and writes nothing', async () => {
        const id = await product('Cargador Viejo', 30000, 10, false);
        const C = await seedCustomer(h.q, 'Comprador');
        const result = await confirmed(C, 'place_catalog_order', { items: [{ productId: id, quantity: 1 }] });
        // eslint-disable-next-line no-console
        console.log(`[SHOP-INACTIVE] result=${JSON.stringify(result).slice(0, 200)} orders=${JSON.stringify(await h.q('SELECT id,status FROM orders'))} stock=${await stockOf(id)}`);
        expect(result.success).not.toBe(true);
        expect(await h.q('SELECT id FROM orders')).toEqual([]);
        expect(await stockOf(id)).toBe(10);
    });

    it('SHOP-CANCEL: cancelling an order through the tool returns the units exactly once, even when asked twice', async () => {
        const id = await product('Audifono Aurora', 50000, 5);
        const C = await seedCustomer(h.q, 'Comprador');
        const placed = await confirmed(C, 'place_catalog_order', { items: [{ productId: id, quantity: 3 }] });
        expect(placed.success).toBe(true);
        expect(await stockOf(id)).toBe(2);
        const cancelled = await confirmed(C, 'cancel_catalog_order', { orderId: placed.order.id });
        expect(cancelled).toMatchObject({ success: true, order: { status: 'cancelled' }, refundPerformed: false });
        expect(await stockOf(id)).toBe(5);
        const again = await h.call(C.contactId, C.conversationId, 'cancel_catalog_order', { orderId: placed.order.id }, scope);
        expect(again.success).toBe(true);
        expect(await stockOf(id)).toBe(5);
        expect(await h.q('SELECT type,quantity FROM stock_movements ORDER BY created_at')).toEqual([
            expect.objectContaining({ quantity: 3 }), expect.objectContaining({ quantity: 3 })]);
    });

    it('CAT-AVAIL: search_products and check_stock never offer an inactive product, and check_stock matches the stored stock and price', async () => {
        await product('Audifono Activo', 50000, 4);
        await product('Audifono Retirado', 50000, 4, false);
        const C = await seedCustomer(h.q, 'X');
        const found = await h.call(C.contactId, C.conversationId, 'search_products', { query: 'audifono' }, scope);
        expect(found.products.map((p: any) => p.name)).toEqual(['Audifono Activo']);
        expect(await h.call(C.contactId, C.conversationId, 'check_stock', { productId: 'Audífono Activo' }, scope))
            .toMatchObject({ name: 'Audifono Activo', price: 50000, currency: 'COP', stock: 4, inStock: true });
    });

    it('SHOP-INACTIVE-READ: check_stock does not report an inactive product as in stock, with units left', async () => {
        const id = await product('Cargador Viejo', 30000, 10, false);
        const unlimited = await product('Servicio retirado', 30000, null, false);
        const C = await seedCustomer(h.q, 'X');
        for (const target of [id, unlimited]) {
            const result = await h.call(C.contactId, C.conversationId, 'check_stock', { productId: target }, scope);
            expect(result.inStock).toBe(false);
            expect(result.isAvailable).toBe(false);
        }
    });

    it('SHOP-05: recommend_products honours the budget for the internal catalogue (no connected store)', async () => {
        await product('Aurora basico', 39990, 3);
        await product('Aurora premium', 79990, 3);
        const C = await seedCustomer(h.q, 'Cliente');
        await h.inbound(C.conversationId, 'busco audifonos hasta 50 mil');
        const result = await h.call(C.contactId, C.conversationId, 'recommend_products', { search: 'Aurora', maxPrice: 50000 }, scope);
        expect((result.products || []).map((p: any) => p.name)).toEqual(['Aurora basico']);
        const noBudget = await h.call(C.contactId, C.conversationId, 'recommend_products', { search: 'Aurora' }, scope);
        expect((noBudget.products || []).map((p: any) => p.name)).toEqual(['Aurora basico', 'Aurora premium']);
    });

    it.each([['50000'], [' 50000 '], [50000]])('SHOP-05: the budget %p holds whether it arrives as a number or as text', async budget => {
        await product('Aurora basico', 39990, 3);
        await product('Aurora premium', 79990, 3);
        const C = await seedCustomer(h.q, 'Cliente');
        const result = await h.call(C.contactId, C.conversationId, 'recommend_products', { search: 'Aurora', maxPrice: budget }, scope);
        expect((result.products || []).map((p: any) => p.name)).toEqual(['Aurora basico']);
    });

    it.each([['cheap'], [true], [-5]])('SHOP-05: an invalid budget %p is reported, not silently dropped', async budget => {
        await product('Aurora premium', 79990, 3);
        const C = await seedCustomer(h.q, 'Cliente');
        const result = await h.call(C.contactId, C.conversationId, 'recommend_products', { search: 'Aurora', maxPrice: budget }, scope);
        expect(result.products).toBeUndefined();
        expect(result.error).toBeDefined();
    });

    it('SHOP-05: with a budget, a product without a price (0) is not offered as if it fitted', async () => {
        await product('Aurora sin precio', 0, 3);
        await product('Aurora basico', 39990, 3);
        const C = await seedCustomer(h.q, 'Cliente');
        const result = await h.call(C.contactId, C.conversationId, 'recommend_products', { search: 'Aurora', maxPrice: 50000 }, scope);
        expect((result.products || []).map((p: any) => p.name)).toEqual(['Aurora basico']);
    });

    it('SHOP-03 (offers listing): list_active_offers returns only active, in-window offers with their stored condition', async () => {
        const C = await seedCustomer(h.q, 'X');
        const offer = (title: string, active: boolean, fromDays: number, toDays: number) => h.q(
            `INSERT INTO commercial_offers(id,offer_type,title,conditions_json,valid_from,valid_to,active)
             VALUES($1::uuid,'discount',$2,'{"discountPercent":10}'::jsonb,NOW()+($3||' days')::interval,NOW()+($4||' days')::interval,$5)`,
            [randomUUID(), title, String(fromDays), String(toDays), active]);
        await offer('10 por ciento vigente', true, -1, 1);
        await offer('10 por ciento vencido', true, -3, -1);
        await offer('10 por ciento futuro', true, 1, 3);
        await offer('10 por ciento apagado', false, -1, 1);
        await h.inbound(C.conversationId, 'tienen promociones?');
        const result = await h.call(C.contactId, C.conversationId, 'list_active_offers', {}, scope);
        expect(result.offers.map((o: any) => o.title)).toEqual(['10 por ciento vigente']);
        expect(result.offers[0].conditions).toEqual({ discountPercent: 10 });
        // The offer is information only: no order-writing code reads commercial_offers (see the SHOP-03 note in the report).
    });

    it('SHOP-05b: recommend_products honours the budget on the connected-store catalogue', async () => {
        const C = await seedCustomer(h.q, 'Cliente');
        // The first call provisions ecommerce_products on a tenant that never had a store.
        await h.inbound(C.conversationId, 'que lamparas tienen');
        await h.call(C.contactId, C.conversationId, 'recommend_products', { search: 'zzz' }, scope);
        await h.inbound(C.conversationId, 'una lampara de maximo 50');
        for (const [title, cents] of [['Lampara barata', 2_000], ['Lampara cara', 900_000]] as const) {
            await h.q(`INSERT INTO ecommerce_products(external_id,provider,title,price_cents,currency,status,inventory_quantity)
                VALUES($1,'shopify',$2,$3,'COP','active',4)`, [randomUUID(), title, cents]);
        }
        const result = await h.call(C.contactId, C.conversationId, 'recommend_products', { search: 'Lampara', maxPrice: 50 }, scope);
        expect(result.source).toBe('store');
        expect(result.products.map((p: any) => p.title)).toEqual(['Lampara barata']);
    });
});
