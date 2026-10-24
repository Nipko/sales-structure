import { ConflictException } from '@nestjs/common';
import { ToolExecutionControlService } from './tool-execution-control.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { attachWriterActiveObject, WRITER_ACTIVE_OBJECTS } from './writer-active-object';
import { COMMITMENT_FAMILIES } from './commitment-families';
import { commitmentAgreedTermsSql, notAgreedSql } from './commitment-proposal';
import { PREFLIGHT_FAMILIES } from '../tenant-payments/agreed-terms-preflight';

/**
 * F4300-31 — an order the agent placed by the book was born without its
 * agreement.
 *
 * Production, 24-oct, restaurant QA tenant, in Portuguese: proposal → «Sim,
 * confirma o pedido.» → `place_order` (first call `confirmation_required`, then
 * the order). The proposal was recorded as accepted (1350000 COP cents) but
 * `consumed_entity_id` stayed NULL, so the till could not charge the order and
 * the deploy pre-flight counted it as an orphan and blocked the release.
 *
 * Root cause: the ledger's completion linked the acceptance to "the id of the
 * row a writer produced", read from a fixed list of keys that did not include
 * `orderId` — the key `place_order` answers with — and returned in silence.
 *
 * These cases replay that flow through the real code: the ledger's own
 * acceptance step, the restaurant writer, and the ledger's completion. The
 * database is a small in-memory double that honours transactions (a throw
 * rolls back); the SQL predicate itself runs against PostgreSQL in
 * order-agreed-terms-link.f4300.postgres.spec.ts.
 */

const schemaName = 'tenant_restaurant_qa';
const contactId = '44444444-4444-4444-8444-444444444444';
const conversationId = '55555555-5555-4555-8555-555555555555';
const inboundId = '66666666-6666-4666-8666-666666666666';
const ledgerId = '77777777-7777-4777-8777-777777777777';
const menuItemId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = 'place_order:f4300-31';
const args = { items: [{ menuItemId, quantity: 1 }], orderType: 'pickup' };

interface Proposal {
    id: string; idempotency_key: string | null; family: string; amount_cents: string | null;
    currency: string | null; accepted_at: Date | null; consumed_entity_id: string | null; consumed_at: Date | null;
}
interface Db { proposals: Proposal[]; foodOrders: Array<{ id: string; status: string }>; nextOrder: number }

function database(seed: Partial<Db> = {}) {
    const db: Db = { proposals: [], foodOrders: [], nextOrder: 1, ...seed };
    const log: Array<{ tx: number; sql: string }> = [];
    let txCounter = 0;
    const run = (tx: number) => async (sql: string, params: any[] = []): Promise<any> => {
        log.push({ tx, sql });
        if (/to_regclass\('commitment_proposals'\)/.test(sql)) return [{ t: 'commitment_proposals' }];
        if (/to_regclass\(\$1\)/.test(sql)) return [{ t0: 'menu_items' }];
        if (/pg_advisory_xact_lock_shared/.test(sql)) return [];
        if (/FROM customer_memory_erasure/.test(sql)) return [];
        if (/FROM menu_items/.test(sql)) return [{ id: menuItemId, name: 'Pão de queijo', price: '13500', currency: 'COP' }];
        if (/INSERT INTO commitment_proposals/.test(sql)) {
            if (db.proposals.some(row => row.idempotency_key === params[6])) return [];
            db.proposals.push({
                id: `proposal-${db.proposals.length + 1}`, idempotency_key: params[6], family: params[1],
                amount_cents: params[8], currency: params[9], accepted_at: new Date(),
                consumed_entity_id: null, consumed_at: null,
            });
            return [];
        }
        if (/UPDATE commitment_proposals/.test(sql)) {
            const [key, entity, family] = params;
            const hit = db.proposals.filter(row => row.idempotency_key === key && row.family === family
                && row.accepted_at && (row.consumed_entity_id === null || row.consumed_entity_id === entity));
            for (const row of hit) { row.consumed_entity_id = entity; row.consumed_at ??= new Date(); }
            return hit.map(row => ({ id: row.id }));
        }
        if (/SELECT id FROM commitment_proposals/.test(sql)) {
            return db.proposals.filter(row => row.idempotency_key === params[0] && row.family === params[1]
                && row.accepted_at).map(row => ({ id: row.id }));
        }
        if (/SELECT id FROM contacts/.test(sql)) return [{ id: contactId }];
        if (/FROM opportunities o/.test(sql)) return [];
        if (/INSERT INTO food_orders/.test(sql)) {
            const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(db.nextOrder++).padStart(12, '0')}`;
            db.foodOrders.push({ id, status: 'received' });
            return [{ id, status: 'received', order_type: 'pickup', currency: params[13], total: params[12] }];
        }
        if (/INSERT INTO food_order_items/.test(sql)) return [];
        if (/SELECT \* FROM food_order_items/.test(sql)) return [{ name_snapshot: 'Pão de queijo' }];
        if (/SELECT \* FROM tool_execution_ledger WHERE id/.test(sql)) return [ledgerRow()];
        if (/UPDATE tool_execution_ledger/.test(sql)) return [{ id: ledgerId }];
        throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
    };
    const transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => {
        const snapshot = JSON.stringify(db);
        try { return await callback(run(++txCounter)); } catch (error) {
            Object.assign(db, JSON.parse(snapshot, (key, value) =>
                (['accepted_at', 'consumed_at'].includes(key) && value ? new Date(value) : value)));
            throw error;
        }
    });
    const prisma = {
        transactionInTenantSchema,
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: any[]) => run(0)(sql, params)),
        tenant: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) },
    };
    return { db, log, prisma };
}

let shownProposal: any = null;
function ledgerRow() {
    return {
        id: ledgerId, idempotency_key: idempotencyKey, tool_name: 'place_order', status: 'executing',
        contact_id: contactId, conversation_id: conversationId, request_source_message_id: inboundId,
        request_payload: { args, ...(shownProposal ? { commitmentProposal: shownProposal } : {}) },
    };
}

function services(prisma: any) {
    const control = new ToolExecutionControlService(
        prisma, { get: jest.fn().mockReturnValue('f4300-31-secret-at-least-32-bytes-long') } as any,
        { isVerified: jest.fn() } as any, { get: jest.fn() } as any);
    const restaurants = new RestaurantsService(prisma, { emit: jest.fn() } as any);
    return { control, restaurants };
}

const request = { schemaName, toolName: 'place_order', args, contactId, conversationId } as any;
const decision = { allowed: true, ledgerId, executionLeaseToken: '88888888-8888-4888-8888-888888888888', policy: {} } as any;

/**
 * The till's question, asked of the double: is there an accepted proposal with
 * an amount and a currency naming this row? (`commitmentAgreedTermsSql`.)
 */
const orphans = (db: Db) => db.foodOrders.filter(order => !['cancelled', 'refunded'].includes(order.status)
    && !db.proposals.some(row => row.consumed_entity_id === order.id && row.accepted_at
        && row.amount_cents != null && String(row.currency ?? '').trim() !== ''));

async function acceptProposal(control: ToolExecutionControlService) {
    // What the first `place_order` recorded with the confirmation challenge.
    shownProposal = await (control as any).buildCommitment(request, inboundId);
    // «Sim, confirma o pedido.»: the ledger's own acceptance step.
    const resolved = await (control as any).resolveCommitment(request, ledgerRow(), inboundId);
    expect(resolved.blocked).toBeUndefined();
}

async function placeOrder(restaurants: RestaurantsService, commitmentKey?: string) {
    return restaurants.createOrder(schemaName, {
        contactId, conversationId, orderType: 'pickup', currency: 'COP',
        items: [{ menuItemId, name: 'Pão de queijo', quantity: 1, unitPrice: 13500, currency: 'COP' }],
    }, { commitmentKey }, undefined);
}

afterEach(() => { shownProposal = null; });

describe('F4300-31 · an order created from an accepted proposal carries that agreement', () => {
    it('replays the production flow and leaves zero orphans for the pre-flight and the till', async () => {
        const { db, log, prisma } = database();
        const { control, restaurants } = services(prisma);

        await acceptProposal(control);
        // The state production showed at this point: accepted, not yet linked.
        expect(db.proposals).toEqual([expect.objectContaining({
            family: 'restaurant_orders', amount_cents: '1350000', currency: 'COP', consumed_entity_id: null,
        })]);

        const order = await placeOrder(restaurants, idempotencyKey);

        // The link is written by the order's own transaction, not by a later one.
        const insertTx = log.find(entry => /INSERT INTO food_orders/.test(entry.sql))!.tx;
        const linkTx = log.find(entry => /UPDATE commitment_proposals/.test(entry.sql))!.tx;
        expect(linkTx).toBe(insertTx);
        expect(db.proposals[0]).toMatchObject({ consumed_entity_id: order.id, consumed_at: expect.any(Date) });

        // The ledger completes with what the executor really passes it.
        const result = attachWriterActiveObject('place_order', { orderId: order.id, status: 'received' }) as any;
        await expect(control.complete(schemaName, decision, result)).resolves.toBeUndefined();
        expect(db.proposals[0].consumed_entity_id).toBe(order.id);
        expect(orphans(db)).toEqual([]);
    });

    it('links through the ledger backstop when a writer answers only `{ orderId }`', async () => {
        // Exactly the production shape: the writer did not link, and the result
        // carries `orderId` and nothing the old candidate list read.
        const { db, prisma } = database();
        const { control, restaurants } = services(prisma);
        await acceptProposal(control);
        const order = await placeOrder(restaurants);
        expect(db.proposals[0].consumed_entity_id).toBeNull();
        expect(orphans(db)).toHaveLength(1);

        await control.complete(schemaName, decision, { orderId: order.id, status: 'received' });

        expect(db.proposals[0].consumed_entity_id).toBe(order.id);
        expect(orphans(db)).toEqual([]);
    });

    it('fails the completion instead of dropping a payable acceptance it cannot attach', async () => {
        const { db, prisma } = database();
        const { control } = services(prisma);
        await acceptProposal(control);

        await expect(control.complete(schemaName, decision, { success: true }))
            .rejects.toThrow('commitment_link_failed');
        expect(db.proposals[0].consumed_entity_id).toBeNull();
    });

    it('rolls the order back when its acceptance already belongs to another order', async () => {
        const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const { db, prisma } = database();
        const { control, restaurants } = services(prisma);
        await acceptProposal(control);
        db.proposals[0].consumed_entity_id = other;

        await expect(placeOrder(restaurants, idempotencyKey)).rejects.toBeInstanceOf(ConflictException);
        expect(db.foodOrders).toEqual([]);
        expect(db.proposals[0].consumed_entity_id).toBe(other);
    });

    it('never invents an acceptance for an operation that has none', async () => {
        const { db, prisma } = database();
        const { control, restaurants } = services(prisma);
        const order = await placeOrder(restaurants, idempotencyKey);
        shownProposal = { version: 1 }; // a ledger whose proposal never hashed: nothing was accepted

        await control.complete(schemaName, decision, { orderId: order.id });

        expect(db.proposals).toEqual([]);
        expect(orphans(db)).toHaveLength(1);
    });

    it('place_order hands the guarded operation key to the order writer', async () => {
        const createOrder = jest.fn().mockResolvedValue({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', status: 'received', total: 13500, currency: 'COP', items: [{}] });
        const executor = Object.create(AIToolExecutorService.prototype) as any;
        executor.prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: menuItemId, name: 'Pão de queijo', price: '13500', currency: 'COP', prep_time_minutes: null }]) };
        executor.restaurantsService = { createOrder };

        const result = await executor.placeOrder(schemaName, contactId, conversationId, args, undefined, 'tenant-1', idempotencyKey);

        expect(result.orderId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-000000000001');
        expect(createOrder.mock.calls[0][2]).toMatchObject({ commitmentKey: idempotencyKey });
    });

    it.each(COMMITMENT_FAMILIES.flatMap(family => family.tools.map(tool => [family.family, tool] as const)))(
        '%s · %s: the completion finds the row id where the tool puts it', (_family, tool) => {
            const key = WRITER_ACTIVE_OBJECTS[tool]?.resultKeys?.[0];
            expect(key).toBeTruthy();
            const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
            const raw = key!.split('.').reduceRight<any>((value, part) => ({ [part]: value }), id);
            const { control } = services(database().prisma);
            expect((control as any).commitmentEntityId(tool, raw)).toBe(id);
            expect((control as any).commitmentEntityId(tool, attachWriterActiveObject(tool, raw))).toBe(id);
        });

    it('the families the pre-flight counts on this mechanism read exactly that link', () => {
        for (const family of ['property_bookings', 'tour_bookings', 'restaurant_orders'] as const) {
            expect(PREFLIGHT_FAMILIES[family].orphanPredicate('tenant_x'))
                .toBe(notAgreedSql(commitmentAgreedTermsSql('target', '"tenant_x".')));
        }
        expect(commitmentAgreedTermsSql()).toContain('p.consumed_entity_id = target.id');
        // Catalogue orders and appointments do not go through this link: their
        // agreement is written into the row by the writer's own INSERT.
        expect(PREFLIGHT_FAMILIES.catalog_orders.acceptance).toEqual({ kind: 'column', name: 'catalog_terms' });
        expect(COMMITMENT_FAMILIES.some(family => family.tools.includes('place_catalog_order'))).toBe(false);
        expect(COMMITMENT_FAMILIES.some(family => family.tools.includes('create_appointment'))).toBe(false);
    });
});
