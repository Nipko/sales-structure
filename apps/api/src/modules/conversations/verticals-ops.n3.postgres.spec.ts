import { randomUUID } from 'crypto';
import { GymsService } from '../gyms/gyms.service';
import { InsuranceService } from '../insurance/insurance.service';
import { RepairOrdersService } from '../repair-orders/repair-orders.service';
import { RestaurantsService, normalizeMenuLabel } from '../restaurants/restaurants.service';
import { menuLabelSql } from '../restaurants/menu-label.util';
import { MENU_LABEL_CASES } from '../restaurants/menu-label.cases';
import { PropertiesService } from '../vacation-rental/properties.service';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · restaurant, gym, insurance quote and workshop intake through the live tool path.
 *
 * Real: executor, central control, the four domain services, canonical DDL.
 * Simulated: the confirmation e-mail sender (left undefined in each service).
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 restaurant, gym, insurance quote and workshop', () => {
    jest.setTimeout(180_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, repairs: RepairOrdersService;

    beforeAll(async () => {
        const holder: { prisma?: any } = {};
        const proxy = new Proxy({}, { get: (_t, key) => holder.prisma[key as any] });
        h = await openLive({
            prefix: 'n3ops', workarounds: { commitmentDdl: true },
            executorDeps: {
                restaurantsService: new RestaurantsService(proxy as any, { emit: jest.fn() } as any),
                gymsService: new GymsService(proxy as any),
                insuranceService: new InsuranceService(proxy as any),
                repairOrders: (repairs = new RepairOrdersService(proxy as any)),
                propertiesService: new PropertiesService(proxy as any, {} as any, {} as any),
            },
            tables: [...CRM_BASE_TABLES, 'menu_categories', 'menu_items', 'food_orders', 'food_order_items', 'menu_promotions',
                'membership_plans', 'members', 'fitness_classes', 'class_bookings', 'insurance_plans', 'insurance_quotes',
                'staff_members', 'appointments', 'customer_vehicles', 'repair_orders', 'repair_order_events',
                'properties', 'property_bookings',
                'tool_execution_ledger', 'tool_approval_tickets', 'tool_approval_outbox', 'commitment_proposals', 'operational_notice_outbox'],
        });
        holder.prisma = h.prisma;
        scope = await h.seedAgent();
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => {
        await h.q('TRUNCATE food_order_items,food_orders,menu_items,menu_categories,class_bookings,members,fitness_classes,membership_plans,insurance_quotes,insurance_plans,repair_order_events,repair_orders,customer_vehicles,property_bookings,properties,tool_execution_ledger,messages CASCADE');
    });

    const confirmed = async (C: { contactId: string; conversationId: string }, tool: string, args: any) => {
        await h.inbound(C.conversationId, 'quiero hacerlo');
        const first = await h.call(C.contactId, C.conversationId, tool, args, scope);
        if (first.error !== 'confirmation_required') return first;
        await h.inbound(C.conversationId, 'sí, confirmo');
        return h.call(C.contactId, C.conversationId, tool, args, scope);
    };

    // ── Restaurant ─────────────────────────────────────────────────────────
    const dish = async (name: string, price: number, extra: { available?: boolean; active?: boolean; allergens?: string[] } = {}) => {
        const id = randomUUID();
        await h.q(`INSERT INTO menu_items(id,name,description,price,currency,is_available,is_active,allergens,tags)
            VALUES($1::uuid,$2,$3,$4,'COP',$5,$6,$7::jsonb,'[]'::jsonb)`,
        [id, name, `${name} casero`, price, extra.available ?? true, extra.active ?? true, JSON.stringify(extra.allergens ?? [])]);
        return id;
    };

    it('REST-MENU: get_menu lists only active and available dishes within the budget', async () => {
        await dish('Bandeja paisa', 32000);
        await dish('Ajiaco', 28000);
        await dish('Lechona agotada', 15000, { available: false });
        await dish('Plato retirado', 15000, { active: false });
        const C = await seedCustomer(h.q, 'Cliente');
        const all = await h.call(C.contactId, C.conversationId, 'get_menu', {}, scope);
        expect(all.items.map((i: any) => i.name).sort()).toEqual(['Ajiaco', 'Bandeja paisa']);
        const cheap = await h.call(C.contactId, C.conversationId, 'get_menu', { maxPrice: 30000 }, scope);
        expect(cheap.items.map((i: any) => i.name)).toEqual(['Ajiaco']);
    });

    it('REST-ALLERGEN: get_menu excludes dishes that carry the allergen the customer named', async () => {
        await dish('Ceviche', 30000, { allergens: ['mariscos'] });
        await dish('Pollo asado', 25000, { allergens: [] });
        const C = await seedCustomer(h.q, 'Cliente');
        const result = await h.call(C.contactId, C.conversationId, 'get_menu', { excludeAllergens: ['mariscos'] }, scope);
        expect(result.items.map((i: any) => i.name)).toEqual(['Pollo asado']);
    });

    it.each([['Mariscos'], ['MARISCOS'], ['  mariscos '], ['marisco'], ['Mariscós']])(
        'REST-ALLERGEN: get_menu still excludes the dish when the allergen is typed as %p', async spelled => {
            await dish('Ceviche', 30000, { allergens: ['mariscos'] });
            await dish('Pollo asado', 25000, { allergens: [] });
            const C = await seedCustomer(h.q, 'Cliente');
            const result = await h.call(C.contactId, C.conversationId, 'get_menu', { excludeAllergens: [spelled] }, scope);
            expect(result.items.map((i: any) => i.name)).toEqual(['Pollo asado']);
            expect(String(result.allergenNotice)).toMatch(/kitchen must confirm/);
        });

    it('REST-ALLERGEN: the stored allergen is normalised too (accents, capitals, spaces, several allergens)', async () => {
        await dish('Pan', 5000, { allergens: [' GLÚTEN '] });
        await dish('Helado', 9000, { allergens: ['Lactosa'] });
        await dish('Ensalada', 12000, { allergens: [] });
        const C = await seedCustomer(h.q, 'Cliente');
        const result = await h.call(C.contactId, C.conversationId, 'get_menu', { excludeAllergens: ['gluten', 'LACTOSA'] }, scope);
        expect(result.items.map((i: any) => i.name)).toEqual(['Ensalada']);
    });

    it('REST-ALLERGEN: dishes with an empty or NULL allergen list are kept but marked as undeclared, never as safe', async () => {
        await dish('Plato sin ficha', 20000, { allergens: [] });
        await h.q(`UPDATE menu_items SET allergens = NULL WHERE name = 'Plato sin ficha'`);
        await dish('Arroz', 8000, { allergens: [] });
        await dish('Sopa de mani', 9000, { allergens: ['maní'] });
        await dish('Pan', 4000, { allergens: ['gluten'] });
        const C = await seedCustomer(h.q, 'Cliente');
        const filtered = await h.call(C.contactId, C.conversationId, 'get_menu', { excludeAllergens: ['mani'] }, scope);
        const byName = Object.fromEntries(filtered.items.map((i: any) => [i.name, i.allergensDeclared]));
        expect(byName).toEqual({ Arroz: false, 'Plato sin ficha': false, Pan: true });
        expect(filtered.allergenNotice).toMatch(/allergensDeclared=false/);
        expect(filtered.allergenNotice).toMatch(/kitchen/);
        const plain = await h.call(C.contactId, C.conversationId, 'get_menu', {}, scope);
        expect(plain.items.map((i: any) => i.name).sort()).toEqual(['Arroz', 'Pan', 'Plato sin ficha', 'Sopa de mani']);
        expect(plain.allergenNotice).toBeUndefined();
        expect(plain.items[0].allergensDeclared).toBeUndefined();
    });

    it('REST-ALLERGEN: a malformed allergen value (a bare JSON string) still counts as a recorded allergen', async () => {
        await dish('Plato raro', 20000, { allergens: [] });
        await h.q(`UPDATE menu_items SET allergens = '"Mariscos"'::jsonb WHERE name = 'Plato raro'`);
        const C = await seedCustomer(h.q, 'Cliente');
        const result = await h.call(C.contactId, C.conversationId, 'get_menu', { excludeAllergens: ['mariscos'] }, scope);
        expect(result.items ?? []).toEqual([]);
    });

    it.each([['nueces', ['Pasta']], ['Frutos secos', ['Pasta']], ['trigo', ['Ensalada', 'Postre']], ['LÁCTEOS', ['Ensalada', 'Postre']]])(
        'REST-ALLERGEN: %p is matched through plurals and the minimum synonyms', async (typed, expected) => {
            await dish('Postre', 9000, { allergens: ['Nuez'] });
            await dish('Pasta', 9000, { allergens: ['Gluten', 'Lactosa'] });
            await dish('Ensalada', 9000, { allergens: ['frutos secos'] });
            const C = await seedCustomer(h.q, 'Cliente');
            const result = await h.call(C.contactId, C.conversationId, 'get_menu', { excludeAllergens: [typed] }, scope);
            expect(result.items.map((i: any) => i.name).sort()).toEqual([...expected].sort());
        });

    it('REST-ALLERGEN: one string instead of a list excludes the dish too', async () => {
        await dish('Ceviche', 30000, { allergens: ['mariscos'] });
        await dish('Pollo asado', 25000, { allergens: ['soja'] });
        const C = await seedCustomer(h.q, 'Cliente');
        const result = await h.call(C.contactId, C.conversationId, 'get_menu', { excludeAllergens: 'Mariscos' } as any, scope);
        expect(result.items.map((i: any) => i.name)).toEqual(['Pollo asado']);
    });

    it('REST-ALLERGEN: the SQL normaliser gives the same label as the JavaScript one for every case of the shared table', async () => {
        for (const [raw, expected] of MENU_LABEL_CASES) {
            const [row] = await h.q<any[]>(`SELECT ${menuLabelSql('$1::text')} AS v`, [raw]);
            expect([raw, row.v]).toEqual([raw, expected]);
            expect(normalizeMenuLabel(raw)).toBe(expected);
        }
    });

    it('REST-ORDER: place_order prices every line from the menu, ignoring the price the customer or model sent', async () => {
        const id = await dish('Bandeja paisa', 32000);
        const C = await seedCustomer(h.q, 'Cliente');
        const result = await confirmed(C, 'place_order', {
            orderType: 'pickup', customerName: 'Ana', customerPhone: '3001234567',
            items: [{ menuItemId: id, name: 'Bandeja paisa', quantity: 2, unitPrice: 1 }],
        });
        expect(result).toMatchObject({ total: 64000, itemsCount: 1 });
        expect(await h.q('SELECT total::float AS total FROM food_orders')).toEqual([{ total: 64000 }]);
        expect(await h.q('SELECT unit_price::float AS unit_price,quantity FROM food_order_items')).toEqual([{ unit_price: 32000, quantity: 2 }]);
    });

    it.each([['sold-out', { available: false }], ['retired', { active: false }]])(
        'REST-ORDER: place_order refuses a %s dish and writes no order', async (_label, extra) => {
            const id = await dish('Plato fuera de carta', 20000, extra);
            const C = await seedCustomer(h.q, 'Cliente');
            const result = await confirmed(C, 'place_order', { orderType: 'pickup', customerName: 'Ana', items: [{ menuItemId: id, quantity: 1 }] });
            expect(result.error).toBeDefined();
            expect(await h.q('SELECT id FROM food_orders')).toEqual([]);
        });

    it('REST-ORDER: cancel_order cancels only the customer\'s own order', async () => {
        const id = await dish('Bandeja paisa', 32000);
        const owner = await seedCustomer(h.q, 'Dueno'), intruder = await seedCustomer(h.q, 'Intruso');
        const placed = await confirmed(owner, 'place_order', { orderType: 'pickup', customerName: 'Ana', items: [{ menuItemId: id, quantity: 1 }] });
        expect(placed.orderId).toBeDefined();
        const stolen = await confirmed(intruder, 'cancel_order', { orderId: placed.orderId });
        expect(stolen.error).toBeDefined();
        expect((await h.q<any[]>('SELECT status FROM food_orders'))[0].status).not.toBe('cancelled');
        await confirmed(owner, 'cancel_order', { orderId: placed.orderId });
        expect((await h.q<any[]>('SELECT status FROM food_orders'))[0].status).toBe('cancelled');
    });

    // ── Gym ────────────────────────────────────────────────────────────────
    const plan = async () => {
        const id = randomUUID();
        await h.q(`INSERT INTO membership_plans(id,name,duration_days,price,currency) VALUES($1::uuid,'Mensual',30,90000,'COP')`, [id]);
        return id;
    };
    const member = async (C: { contactId: string }, credits: number | null, status = 'active') => {
        const id = randomUUID();
        await h.q(`INSERT INTO members(id,contact_id,plan_id,status,class_credits_remaining) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5)`,
            [id, C.contactId, await plan(), status, credits]);
        return id;
    };
    const klass = async (spots: number, when = new Date(Date.now() + 2 * 86_400_000), extra: { cancelled?: boolean } = {}) => {
        const id = randomUUID();
        await h.q(`INSERT INTO fitness_classes(id,name,class_type,scheduled_at,max_capacity,available_spots,is_cancelled)
            VALUES($1::uuid,'Yoga',$2,$3::timestamp,2,$4,$5)`,
        [id, 'yoga', when.toISOString().slice(0, 19).replace('T', ' '), spots, extra.cancelled ?? false]);
        return id;
    };
    const spotsOf = async (id: string) => (await h.q<any[]>('SELECT available_spots FROM fitness_classes WHERE id=$1::uuid', [id]))[0].available_spots;
    const creditsOf = async (id: string) => (await h.q<any[]>('SELECT class_credits_remaining FROM members WHERE id=$1::uuid', [id]))[0].class_credits_remaining;

    it('GYM-01: book_class takes one spot and one credit, and a replay takes nothing more', async () => {
        const C = await seedCustomer(h.q, 'Socia'); const m = await member(C, 5); const c = await klass(2);
        const first = await confirmed(C, 'book_class', { classId: c });
        expect(first).toMatchObject({ status: 'confirmed', creditsUsed: 1 });
        expect(await spotsOf(c)).toBe(1);
        expect(await creditsOf(m)).toBe(4);
        await h.call(C.contactId, C.conversationId, 'book_class', { classId: c }, scope);
        expect(await spotsOf(c)).toBe(1);
        expect(await creditsOf(m)).toBe(4);
        expect(await h.q('SELECT id FROM class_bookings')).toHaveLength(1);
    });

    it('GYM-02: a full class puts the member on the waitlist with no spot and no credit spent', async () => {
        const C = await seedCustomer(h.q, 'Socia'); const m = await member(C, 5); const c = await klass(0);
        const result = await confirmed(C, 'book_class', { classId: c });
        expect(result).toMatchObject({ status: 'waitlist', waitlistPosition: 1, creditsUsed: 0 });
        expect(await spotsOf(c)).toBe(0);
        expect(await creditsOf(m)).toBe(5);
    });

    it.each([
        ['already started', async () => klass(3, new Date(Date.now() - 3_600_000))],
        ['cancelled', async () => klass(3, undefined, { cancelled: true })],
    ])('GYM-03: book_class refuses a class that is %s', async (_label, build) => {
        const C = await seedCustomer(h.q, 'Socia'); const m = await member(C, 5); const c = await build();
        const result = await confirmed(C, 'book_class', { classId: c });
        expect(result.status).not.toBe('confirmed');
        expect(await h.q('SELECT id FROM class_bookings')).toEqual([]);
        expect(await creditsOf(m)).toBe(5);
        expect(await spotsOf(c)).toBe(3);
    });

    it('GYM-04: book_class with no credits left books nothing', async () => {
        const C = await seedCustomer(h.q, 'Socia'); await member(C, 0); const c = await klass(3);
        const result = await confirmed(C, 'book_class', { classId: c });
        expect(result.status).not.toBe('confirmed');
        expect(await spotsOf(c)).toBe(3);
        expect(await h.q('SELECT id FROM class_bookings')).toEqual([]);
    });

    it('GYM-05: cancel_class_booking returns the spot and the credit once, and promotes the first in the waitlist', async () => {
        const holder = await seedCustomer(h.q, 'Titular'); const holderMember = await member(holder, 5);
        const waiter = await seedCustomer(h.q, 'Espera'); const waiterMember = await member(waiter, 5);
        const c = await klass(1);
        const booked = await confirmed(holder, 'book_class', { classId: c });
        const queued = await confirmed(waiter, 'book_class', { classId: c });
        expect(booked.status).toBe('confirmed'); expect(queued.status).toBe('waitlist');
        await confirmed(holder, 'cancel_class_booking', { bookingId: booked.bookingId });
        expect(await creditsOf(holderMember)).toBe(5);
        expect(await creditsOf(waiterMember)).toBe(4);
        expect(await spotsOf(c)).toBe(0);
        expect((await h.q<any[]>('SELECT status FROM class_bookings WHERE id=$1::uuid', [queued.bookingId]))[0].status).toBe('confirmed');
        await confirmed(holder, 'cancel_class_booking', { bookingId: booked.bookingId });
        expect(await creditsOf(holderMember)).toBe(5);
        expect(await spotsOf(c)).toBe(0);
    });

    // ── Insurance quote ────────────────────────────────────────────────────
    const insurancePlan = async (extra: { min?: number; max?: number; minAge?: number; maxAge?: number; active?: boolean } = {}) => {
        const id = randomUUID();
        await h.q(`INSERT INTO insurance_plans(id,name,insurance_type,monthly_premium_min,monthly_premium_max,currency,min_age,max_age,is_active)
            VALUES($1::uuid,'Vida Plus','vida',$2,$3,'COP',$4,$5,$6)`,
        [id, extra.min ?? 50000, extra.max ?? 150000, extra.minAge ?? 18, extra.maxAge ?? 60, extra.active ?? true]);
        return id;
    };
    const quote = (C: { contactId: string; conversationId: string }, planId: string, applicantAge?: number) =>
        confirmed(C, 'calculate_quote', { planId, applicantName: 'Pedro Prueba', applicantAge, applicantEmail: 'p@example.invalid' });

    it('INS-QUOTE-01: the premium stays within the plan range, grows with age and annual is twelve months', async () => {
        const planId = await insurancePlan();
        const C = await seedCustomer(h.q, 'Cotizante');
        const young = await quote(C, planId, 18), mid = await quote(C, planId, 39), old = await quote(C, planId, 60);
        expect(young.monthlyPremium).toBe(50000);
        expect(old.monthlyPremium).toBe(150000);
        expect(mid.monthlyPremium).toBeGreaterThan(young.monthlyPremium);
        expect(mid.monthlyPremium).toBeLessThan(old.monthlyPremium);
        for (const q of [young, mid, old]) expect(q.annualPremium).toBe(q.monthlyPremium * 12);
        expect(await h.q('SELECT status FROM insurance_quotes')).toHaveLength(3);
    });

    it('INS-QUOTE-02: an inactive plan is not quoted and nothing is stored', async () => {
        const planId = await insurancePlan({ active: false });
        const C = await seedCustomer(h.q, 'Cotizante');
        const result = await quote(C, planId, 30);
        expect(result.quoteId).toBeUndefined();
        expect(await h.q('SELECT id FROM insurance_quotes')).toEqual([]);
    });

    it.each([[82], [61], [17]])('INS-QUOTE-03: an applicant of %p, outside the plan range 18-60, is refused and nothing is stored', async age => {
        const planId = await insurancePlan();
        const C = await seedCustomer(h.q, 'Cotizante');
        const result = await quote(C, planId, age);
        expect(result.quoteId).toBeUndefined();
        expect(result.error).toBeDefined();
        expect(String(result.message)).toMatch(/18 y 60/);
        expect(await h.q('SELECT id FROM insurance_quotes')).toEqual([]);
    });

    it.each([[18], [60]])('INS-QUOTE-03: the plan limits are inclusive (age %p is quoted)', async age => {
        const planId = await insurancePlan();
        const C = await seedCustomer(h.q, 'Cotizante');
        expect((await quote(C, planId, age)).quoteId).toBeDefined();
    });

    it('INS-QUOTE-04: a quote without the applicant\'s age asks for the age and is not stored', async () => {
        const planId = await insurancePlan();
        const C = await seedCustomer(h.q, 'Cotizante');
        const result = await quote(C, planId, undefined);
        expect(result.quoteId).toBeUndefined();
        expect(result.monthlyPremium).toBeUndefined();
        expect(String(result.message)).toMatch(/edad/i);
        expect(await h.q('SELECT id FROM insurance_quotes')).toEqual([]);
    });

    // ── Vacation rental check-in (regression of a fixed defect) ────────────
    describe('CHECKIN: address and access code only for a paid, current stay of the asking guest', () => {
        const ADDRESS = 'Calle 10 # 5-20 apto 301', ACCESS = 'Codigo de la caja: 4821';
        const stay = async (contactId: string, status: string, fromDays: number, toDays: number) => {
            const propertyId = randomUUID();
            await h.q(`INSERT INTO properties(id,name,address,check_in_time,check_out_time,check_in_instructions,house_rules)
                VALUES($1::uuid,'Casa N3',$2,'15:00','11:00',$3,'Sin fiestas')`, [propertyId, ADDRESS, ACCESS]);
            await h.q(`INSERT INTO property_bookings(property_id,contact_id,check_in,check_out,nights,status)
                VALUES($1::uuid,$2::uuid,CURRENT_DATE + $3::int,CURRENT_DATE + $4::int,3,$5)`, [propertyId, contactId, fromDays, toDays, status]);
            return propertyId;
        };
        const ask = async (C: { contactId: string; conversationId: string }, propertyId: string) => {
            await h.inbound(C.conversationId, 'como llego y como entro?');
            return JSON.stringify(await h.call(C.contactId, C.conversationId, 'get_check_in_instructions', { propertyId }, scope));
        };

        it('positive control: a confirmed stay that includes today releases the instructions', async () => {
            const C = await seedCustomer(h.q, 'Huesped');
            const text = await ask(C, await stay(C.contactId, 'confirmed', -1, 2));
            expect(text).toContain(ADDRESS);
            expect(text).toContain(ACCESS);
        });

        it.each([['pending_payment'], ['expired'], ['cancelled'], ['rejected']])('a %s stay releases nothing', async status => {
            const C = await seedCustomer(h.q, 'Huesped');
            const text = await ask(C, await stay(C.contactId, status, -1, 2));
            expect(text).not.toContain(ADDRESS);
            expect(text).not.toContain(ACCESS);
        });

        it.each([['not started', 3, 6], ['already ended', -6, -2]])('a confirmed stay that is %s releases nothing', async (_label, from, to) => {
            const C = await seedCustomer(h.q, 'Huesped');
            const text = await ask(C, await stay(C.contactId, 'confirmed', from, to));
            expect(text).not.toContain(ADDRESS);
        });

        it('another guest\'s confirmed stay releases nothing to this customer', async () => {
            const owner = await seedCustomer(h.q, 'Dueno'), other = await seedCustomer(h.q, 'Otro');
            const propertyId = await stay(owner.contactId, 'confirmed', -1, 2);
            const text = await ask(other, propertyId);
            expect(text).not.toContain(ADDRESS);
            expect(text).not.toContain(ACCESS);
        });
    });

    // ── Workshop ───────────────────────────────────────────────────────────
    it('WORK-01: create_repair_order is idempotent for the same report and records a reported concern, not a diagnosis', async () => {
        const C = await seedCustomer(h.q, 'Conductor');
        const args = { make: 'Mazda', model: '3', licensePlate: 'EVAL123', customerConcern: 'Vibra al frenar' };
        const first = await confirmed(C, 'create_repair_order', args);
        expect(first).toMatchObject({ success: true, status: 'intake' });
        const again = await h.call(C.contactId, C.conversationId, 'create_repair_order', args, scope);
        expect(again).toMatchObject({ success: true, repairOrderId: first.repairOrderId });
        expect(await h.q('SELECT id FROM repair_orders')).toHaveLength(1);
        expect(await h.q('SELECT id FROM customer_vehicles')).toHaveLength(1);
        expect((await h.q<any[]>('SELECT diagnosis_summary FROM repair_orders'))[0].diagnosis_summary).toBeNull();
    });

    it('WORK-01b: the intake writer itself replays a repeated request key instead of opening a second order, and refuses a key reused for a different report', async () => {
        const C = await seedCustomer(h.q, 'Conductor');
        const intake = (concern: string) => ({
            contactId: C.contactId, conversationId: C.conversationId, vehicle: { make: 'Mazda', model: '3', licensePlate: 'EVAL123' },
            customerConcern: concern, idempotencyKey: 'request-key-1',
        });
        const first = await repairs.create(h.schema, intake('Vibra al frenar'), { type: 'agent' });
        const again = await repairs.create(h.schema, intake('Vibra al frenar'), { type: 'agent' });
        expect(again).toMatchObject({ id: first.id, idempotentReplay: true });
        expect(await h.q('SELECT id FROM repair_orders')).toHaveLength(1);
        await expect(repairs.create(h.schema, intake('Otro problema distinto'), { type: 'agent' })).rejects.toThrow(/idempotency conflict/i);
        expect(await h.q('SELECT id FROM repair_orders')).toHaveLength(1);
    });

    it('WORK-02: create_repair_order without a concern writes nothing', async () => {
        const C = await seedCustomer(h.q, 'Conductor');
        const result = await confirmed(C, 'create_repair_order', { make: 'Mazda', model: '3', licensePlate: 'EVAL123' });
        expect(result.success).not.toBe(true);
        expect(await h.q('SELECT id FROM repair_orders')).toEqual([]);
    });

    it('WORK-03: a customer cannot read another customer\'s repair order', async () => {
        const owner = await seedCustomer(h.q, 'Dueno'), intruder = await seedCustomer(h.q, 'Intruso');
        const created = await confirmed(owner, 'create_repair_order', { make: 'Kia', model: 'Rio', licensePlate: 'ABC123', customerConcern: 'Ruido en el motor' });
        const peek = await h.call(intruder.contactId, intruder.conversationId, 'get_repair_order', { repairOrderId: created.repairOrderId }, scope);
        expect(JSON.stringify(peek)).not.toMatch(/Ruido en el motor|ABC123/);
        expect((await h.call(intruder.contactId, intruder.conversationId, 'list_my_repair_orders', {}, scope)).repairOrders).toEqual([]);
    });
});
