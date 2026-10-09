import { randomUUID } from 'crypto';
import { ToursService } from '../tours/tours.service';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · tours and real estate through the live tool path.
 *
 * Real: executor, central control, `ToursService`, `ListingsService`, canonical DDL.
 * Simulated: throttle and e-mail templates (never reached by these tools).
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 travel packages and real-estate listings', () => {
    jest.setTimeout(180_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, staffId: string, visitServiceId: string, date: string, today: string, past: string;

    beforeAll(async () => {
        const holder: { prisma?: any } = {};
        const proxy = new Proxy({}, { get: (_t, key) => holder.prisma[key as any] });
        h = await openLive({
            prefix: 'n3trip', workarounds: { commitmentDdl: true },
            executorDeps: { toursService: new ToursService(proxy as any, {} as any, {} as any) },
            tables: [...CRM_BASE_TABLES, 'tour_packages', 'tour_inventory', 'tour_bookings', 'staff_members', 'operational_locations',
                'operational_resources', 'staff_operational_bindings', 'staff_resource_assignments', 'services', 'service_staff',
                'calendar_integrations', 'appointments', 'availability_slots', 'blocked_dates', 'calendar_sync_outbox',
                'real_estate_listings', 'listing_zone_agents', 'tool_execution_ledger', 'tool_approval_tickets',
                'tool_approval_outbox', 'commitment_proposals', 'operational_notice_outbox'],
        });
        holder.prisma = h.prisma;
        scope = await h.seedAgent();
        staffId = await h.seedStaff('Asesor');
        visitServiceId = randomUUID();
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Visita al inmueble',true,30,3,0,'COP','none')`, [visitServiceId]);
        for (let dow = 0; dow <= 6; dow += 1) {
            await h.q(`INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time,is_active)
                VALUES($1::uuid,$2,'09:00','17:00',true)`, [staffId, dow]);
        }
        const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
        date = day(12); today = day(0); past = day(-5);
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => {
        await h.q('TRUNCATE tour_bookings,tour_inventory,tour_packages,appointments,real_estate_listings,listing_zone_agents,tool_execution_ledger,messages CASCADE');
    });

    const confirmed = async (C: { contactId: string; conversationId: string }, tool: string, args: any) => {
        await h.inbound(C.conversationId, 'quiero hacerlo');
        const first = await h.call(C.contactId, C.conversationId, tool, args, scope);
        if (first.error !== 'confirmation_required') return first;
        await h.inbound(C.conversationId, 'sí, confirmo');
        return h.call(C.contactId, C.conversationId, tool, args, scope);
    };

    // ── Tours ──────────────────────────────────────────────────────────────
    const pkg = async (name: string, extra: { price?: number; min?: number; active?: boolean; child?: number } = {}) => {
        const id = randomUUID();
        await h.q(`INSERT INTO tour_packages(id,name,destination,price,currency,min_party_size,is_active,child_discount_pct,duration_type,duration_value)
            VALUES($1::uuid,$2,'Cartagena',$3,'COP',$4,$5,$6,'days',3)`,
        [id, name, extra.price ?? 100000, extra.min ?? 1, extra.active ?? true, extra.child ?? 0]);
        return id;
    };
    const seats = async (packageId: string, on: string, available: number) => {
        const id = randomUUID();
        await h.q(`INSERT INTO tour_inventory(id,package_id,departure_date,available_seats,total_seats,is_active)
            VALUES($1::uuid,$2::uuid,$3::date,$4,$4,true)`, [id, packageId, on, available]);
        return id;
    };
    const seatsLeft = async (inventoryId: string) =>
        (await h.q<any[]>('SELECT available_seats FROM tour_inventory WHERE id=$1::uuid', [inventoryId]))[0].available_seats;

    it('VVIA-01: search_packages with date and travellers lists only packages with enough seats', async () => {
        const big = await pkg('Isla Grande'); await seats(big, date, 6);
        const small = await pkg('Isla Pequena'); await seats(small, date, 2);
        void small;
        const C = await seedCustomer(h.q, 'Viajero');
        const result = await h.call(C.contactId, C.conversationId, 'search_packages', { destination: 'Cartagena', date, partySize: 4 }, scope);
        expect(result.packages.map((p: any) => p.name)).toEqual(['Isla Grande']);
        expect(result.packages[0].seatsLeft).toBe(6);
    });

    it.each([
        ['zero travellers', 0],
        ['negative travellers', -2],
    ])('VVIA-05 TRIP-01: check_package_availability with %s never answers available', async (_label, partySize) => {
        const id = await pkg('Isla Grande'); await seats(id, date, 6);
        const C = await seedCustomer(h.q, 'Viajero');
        const result = await h.call(C.contactId, C.conversationId, 'check_package_availability', { packageId: id, date, partySize }, scope);
        expect(result.available).not.toBe(true);
    });

    it('VVIA-05: check_package_availability respects minimum party size and seats left', async () => {
        const id = await pkg('Isla Grupo', { min: 2 }); await seats(id, date, 3);
        const C = await seedCustomer(h.q, 'Viajero');
        const call = (partySize: number) => h.call(C.contactId, C.conversationId, 'check_package_availability', { packageId: id, date, partySize }, scope);
        expect(await call(1)).toMatchObject({ available: false, reason: 'party_size_too_small' });
        expect(await call(4)).toMatchObject({ available: false, reason: 'not_enough_seats', seatsLeft: 3 });
        expect(await call(3)).toMatchObject({ available: true, seatsLeft: 3 });
    });

    it('VVIA-07: create_tour_booking takes the seats once, stores the exact composition and price, and a replay does not take more', async () => {
        const id = await pkg('Isla Grande', { price: 100000, child: 50 }); const inv = await seats(id, date, 10);
        const C = await seedCustomer(h.q, 'Viajero');
        const args = { packageId: id, departureDate: date, partySize: 3, adults: 2, children: 1, guestName: 'Ana Viajera', guestEmail: 'ana@example.invalid' };
        const placed = await confirmed(C, 'create_tour_booking', args);
        expect(placed).toMatchObject({ success: true, booking: { partySize: 3, totalPrice: 250000 } });
        expect(await seatsLeft(inv)).toBe(7);
        await h.call(C.contactId, C.conversationId, 'create_tour_booking', args, scope);
        expect(await seatsLeft(inv)).toBe(7);
        expect(await h.q('SELECT id FROM tour_bookings')).toHaveLength(1);
        expect(await h.q('SELECT party_size,adults,children,total_price::float AS total FROM tour_bookings')).toEqual([
            { party_size: 3, adults: 2, children: 1, total: 250000 }]);
    });

    it('VVIA-07: create_tour_booking rejects more travellers than seats and leaves the seats untouched', async () => {
        const id = await pkg('Isla Grande'); const inv = await seats(id, date, 2);
        const C = await seedCustomer(h.q, 'Viajero');
        const result = await confirmed(C, 'create_tour_booking', { packageId: id, departureDate: date, partySize: 5, guestName: 'Ana' });
        expect(result.success).not.toBe(true);
        expect(await seatsLeft(inv)).toBe(2);
        expect(await h.q('SELECT id FROM tour_bookings')).toEqual([]);
    });

    it('VVIA-08: create_tour_booking refuses an inactive package', async () => {
        const id = await pkg('Isla Cerrada', { active: false }); const inv = await seats(id, date, 5);
        const C = await seedCustomer(h.q, 'Viajero');
        const result = await confirmed(C, 'create_tour_booking', { packageId: id, departureDate: date, partySize: 2, guestName: 'Ana' });
        expect(result.success).not.toBe(true);
        expect(await h.q('SELECT id FROM tour_bookings')).toEqual([]);
        expect(await seatsLeft(inv)).toBe(5);
    });

    it('VVIA-10: cancel_tour_booking cancels only own bookings and returns the seats exactly once', async () => {
        const id = await pkg('Isla Grande'); const inv = await seats(id, date, 10);
        const owner = await seedCustomer(h.q, 'Dueno'), intruder = await seedCustomer(h.q, 'Intruso');
        const placed = await confirmed(owner, 'create_tour_booking', { packageId: id, departureDate: date, partySize: 4, guestName: 'Dueno' });
        expect(placed.success).toBe(true);
        expect(await seatsLeft(inv)).toBe(6);
        const stolen = await confirmed(intruder, 'cancel_tour_booking', { bookingId: placed.booking.id });
        expect(stolen.success).not.toBe(true);
        expect(await seatsLeft(inv)).toBe(6);
        expect(await confirmed(owner, 'cancel_tour_booking', { bookingId: placed.booking.id })).toMatchObject({ success: true });
        expect(await seatsLeft(inv)).toBe(10);
        await confirmed(owner, 'cancel_tour_booking', { bookingId: placed.booking.id });
        expect(await seatsLeft(inv)).toBe(10);
    });

    it('VVIA-12: list_my_tour_bookings returns only own, non-cancelled bookings', async () => {
        // Both departures are scheduled: a package with inventory only sells its loaded dates.
        const id = await pkg('Isla Grande'); await seats(id, date, 20); await seats(id, today, 20);
        const a = await seedCustomer(h.q, 'A'), b = await seedCustomer(h.q, 'B');
        const keep = await confirmed(a, 'create_tour_booking', { packageId: id, departureDate: date, partySize: 1, guestName: 'A' });
        const gone = await confirmed(a, 'create_tour_booking', { packageId: id, departureDate: today, partySize: 2, guestName: 'A' });
        await confirmed(b, 'create_tour_booking', { packageId: id, departureDate: date, partySize: 1, guestName: 'B' });
        await confirmed(a, 'cancel_tour_booking', { bookingId: gone.booking.id });
        const list = await h.call(a.contactId, a.conversationId, 'list_my_tour_bookings', {}, scope);
        expect(list.bookings.map((x: any) => x.id)).toEqual([keep.booking.id]);
        expect(JSON.stringify(list.bookings[0].payableReference ?? '')).not.toMatch(/100000|price|amount/i);
    });

    // ── Real estate ────────────────────────────────────────────────────────
    const listing = async (name: string, extra: { status?: string; active?: boolean; agent?: string | null; hood?: string; price?: number; bedrooms?: number } = {}) => {
        const id = randomUUID();
        await h.q(`INSERT INTO real_estate_listings(id,name,transaction_type,price,currency,bedrooms,neighborhood,city,status,is_active,assigned_agent_id,images)
            VALUES($1::uuid,$2,'sale',$3,'COP',$4,$5,'Bogota',$6,$7,$8::uuid,$9::jsonb)`,
        [id, name, extra.price ?? 400_000_000, extra.bedrooms ?? 3, extra.hood ?? 'Chapinero', extra.status ?? 'available',
            extra.active ?? true, extra.agent ?? null, JSON.stringify(['https://cdn.example.test/foto1.jpg'])]);
        // (assigned_agent_id is bound as ::uuid below; Prisma sends untyped parameters as text.)
        return id;
    };

    it('VINM-01: search_listings never returns sold or inactive listings and honours the filters', async () => {
        await listing('Casa disponible', { price: 300_000_000, bedrooms: 3 });
        await listing('Casa vendida', { status: 'sold' });
        await listing('Casa inactiva', { active: false });
        await listing('Casa cara', { price: 900_000_000 });
        const C = await seedCustomer(h.q, 'Comprador');
        const result = await h.call(C.contactId, C.conversationId, 'search_listings', { maxPrice: 500_000_000, minBedrooms: 2 }, scope);
        expect(result.listings.map((l: any) => l.name)).toEqual(['Casa disponible']);
    });

    it('VINM-04: get_listing_details answers an available listing with the stored data', async () => {
        const id = await listing('Casa Aurora', { price: 410_000_000, bedrooms: 4 });
        const C = await seedCustomer(h.q, 'Comprador');
        expect(await h.call(C.contactId, C.conversationId, 'get_listing_details', { listingId: id }, scope))
            .toMatchObject({ id, name: 'Casa Aurora', price: 410_000_000, bedrooms: 4, status: 'available' });
    });

    it('VINM-06: send_listing_image delivers the stored photo of an available listing (positive control)', async () => {
        const id = await listing('Casa Aurora');
        const C = await seedCustomer(h.q, 'Comprador');
        await h.inbound(C.conversationId, 'me mandas fotos de la casa');
        const result = await h.call(C.contactId, C.conversationId, 'send_listing_image', { listingId: id }, scope);
        expect(result).toMatchObject({ success: true, count: 1, _mediaToSend: [{ url: 'https://cdn.example.test/foto1.jpg' }] });
    });

    const visit = (C:{ contactId: string; conversationId: string }, listingId: string, time = '10:00') =>
        confirmed(C, 'create_appointment', { serviceId: visitServiceId, date, time, listingId, customerName: 'Comprador N3', customerEmail: 'c@example.invalid' });

    it('VINM-08 EST-04: a visit to a listing with an assigned advisor is booked for that advisor', async () => {
        const id = await listing('Casa Aurora', { agent: staffId });
        const C = await seedCustomer(h.q, 'Comprador');
        const result = await visit(C, id);
        expect(result.success).toBe(true);
        const rows = await h.q<any[]>('SELECT assigned_to::text AS assigned_to, metadata FROM appointments');
        expect(rows).toHaveLength(1);
        expect(rows[0].assigned_to).toBe(staffId);
        expect(rows[0].metadata).toMatchObject({ listingId: id });
    });

    it('VINM-08 EST-04: a listing without advisor falls back to the zone advisor', async () => {
        const zoneAdvisor = await h.seedStaff('Zona');
        for (let dow = 0; dow <= 6; dow += 1) {
            await h.q(`INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time,is_active) VALUES($1::uuid,$2,'09:00','17:00',true)`, [zoneAdvisor, dow]);
        }
        await h.q(`INSERT INTO listing_zone_agents(neighborhood,city,agent_id) VALUES('Usaquen','Bogota',$1::uuid)`, [zoneAdvisor]);
        const id = await listing('Casa Usaquen', { hood: 'Usaquen', agent: null });
        const C = await seedCustomer(h.q, 'Comprador');
        expect((await visit(C, id, '11:00')).success).toBe(true);
        expect((await h.q<any[]>('SELECT assigned_to::text AS assigned_to FROM appointments'))[0].assigned_to).toBe(zoneAdvisor);
    });

    // ── Former defects (fixed): sold / inactive listings and unchecked departures ──
    it.each([['sold', 'sold', true], ['reserved', 'reserved', true], ['inactive flag', 'available', false], ['inactive status', 'inactive', true]])(
        'EST-03: get_listing_details does not expose a %s listing by id', async (_label, status, active) => {
            const id = await listing('Casa fuera de venta', { status, active });
            const C = await seedCustomer(h.q, 'Comprador');
            const result = await h.call(C.contactId, C.conversationId, 'get_listing_details', { listingId: id }, scope);
            expect(result).toMatchObject({ error: 'listing_unavailable' });
            expect(JSON.stringify(result)).not.toMatch(/Casa fuera de venta|400000000/);
            expect(result.name).toBeUndefined();
            expect(result.price).toBeUndefined();
        });

    it.each([['sold', 'sold', true], ['inactive flag', 'available', false]])(
        'EST-03: send_listing_image does not send photos of a %s listing', async (_label, status, active) => {
            const id = await listing('Casa fuera de venta', { status, active });
            const C = await seedCustomer(h.q, 'Comprador');
            await h.inbound(C.conversationId, 'me mandas fotos de la casa');
            const result = await h.call(C.contactId, C.conversationId, 'send_listing_image', { listingId: id }, scope);
            expect(result).toMatchObject({ error: 'listing_unavailable' });
            expect(result._mediaToSend).toBeUndefined();
            expect(result.success).not.toBe(true);
        });

    it.each([['sold', 'sold', true], ['inactive flag', 'available', false]])(
        'EST-03/04: no visit is booked to a %s listing', async (_label, status, active) => {
            const id = await listing('Casa fuera de venta', { status, active, agent: staffId });
            const C = await seedCustomer(h.q, 'Comprador');
            const result = await visit(C, id);
            expect(result.success).not.toBe(true);
            expect(result.error).toBe('listing_unavailable');
            expect(await h.q('SELECT id FROM appointments')).toEqual([]);
        });

    it('EST-03: an unknown listing id stays listing_not_found (distinct from unavailable)', async () => {
        const C = await seedCustomer(h.q, 'Comprador');
        expect(await h.call(C.contactId, C.conversationId, 'get_listing_details', { listingId: randomUUID() }, scope))
            .toMatchObject({ error: 'listing_not_found' });
    });

    it('TRIP-01b: a scheduled package is not offered, nor bookable, on a date with no departure', async () => {
        const scheduled = await pkg('Isla Programada'); await seats(scheduled, today, 9);
        const C = await seedCustomer(h.q, 'Viajero');
        const found = await h.call(C.contactId, C.conversationId, 'search_packages', { destination: 'Cartagena', date, partySize: 2 }, scope);
        const check = await h.call(C.contactId, C.conversationId, 'check_package_availability', { packageId: scheduled, date, partySize: 2 }, scope);
        const booked = await confirmed(C, 'create_tour_booking', { packageId: scheduled, departureDate: date, partySize: 2, guestName: 'Ana' });
        expect(found.packages.map((p: any) => p.name)).not.toContain('Isla Programada');
        expect(check).toMatchObject({ available: false, reason: 'no_departure_on_date' });
        expect(booked.success).not.toBe(true);
        expect(await h.q('SELECT id FROM tour_bookings')).toEqual([]);
    });

    it('TRIP-01b: a package with no departures at all stays unlimited on any future date', async () => {
        const custom = await pkg('Isla A Medida');
        const C = await seedCustomer(h.q, 'Viajero');
        expect(await h.call(C.contactId, C.conversationId, 'check_package_availability', { packageId: custom, date, partySize: 2 }, scope))
            .toMatchObject({ available: true, seatsLeft: 'unlimited' });
    });

    it('TRIP-01: search_packages with a date but no traveller count does not present a sold-out package as available', async () => {
        const soldOut = await pkg('Isla Agotada'); await seats(soldOut, date, 0);
        const open = await pkg('Isla Libre'); await seats(open, date, 8);
        const C = await seedCustomer(h.q, 'Viajero');
        const result = await h.call(C.contactId, C.conversationId, 'search_packages', { destination: 'Cartagena', date }, scope);
        expect(result.packages.map((p: any) => p.name)).toEqual(['Isla Libre']);
        expect(result.packages[0].seatsLeft).toBe(8);
    });

    it.each([['no traveller count', undefined], ['a non-numeric traveller count', 'varios']])(
        'TRIP-01: check_package_availability with %s never answers available', async (_label, partySize) => {
            const id = await pkg('Isla Grande'); await seats(id, date, 6);
            const C = await seedCustomer(h.q, 'Viajero');
            const result = await h.call(C.contactId, C.conversationId, 'check_package_availability', { packageId: id, date, partySize }, scope);
            expect(result.available).toBe(false);
            expect(result.reason).toBe('party_size_required');
        });

    it('TRIP-01b: deleting the last departure does not turn the package into an unlimited one', async () => {
        const id = await pkg('Isla Borrada'); const inv = await seats(id, today, 9);
        await h.q('UPDATE tour_inventory SET is_active=false WHERE id=$1::uuid', [inv]); // what deleteInventory does
        const C = await seedCustomer(h.q, 'Viajero');
        expect(await h.call(C.contactId, C.conversationId, 'check_package_availability', { packageId: id, date, partySize: 2 }, scope))
            .toMatchObject({ available: false, reason: 'no_departure_on_date' });
        expect((await h.call(C.contactId, C.conversationId, 'search_packages', { destination: 'Cartagena', date, partySize: 2 }, scope)).packages)
            .toEqual([]);
        const booked = await confirmed(C, 'create_tour_booking', { packageId: id, departureDate: date, partySize: 2, guestName: 'Ana' });
        expect(booked.success).not.toBe(true);
        expect(await h.q('SELECT id FROM tour_bookings')).toEqual([]);
    });

    it('TRIP-01: search_packages with a past date lists nothing', async () => {
        await pkg('Isla A Medida'); // unscheduled: would be "unlimited" on any date if the past were not refused
        const C = await seedCustomer(h.q, 'Viajero');
        expect((await h.call(C.contactId, C.conversationId, 'search_packages', { destination: 'Cartagena', date: past, partySize: 2 }, scope)).packages)
            .toEqual([]);
    });

    it('TRIP-01: search_packages without a traveller count filters by the package minimum', async () => {
        const few = await pkg('Isla Grupo Corto', { min: 4 }); await seats(few, date, 3);
        const enough = await pkg('Isla Grupo Lleno', { min: 4 }); await seats(enough, date, 5);
        const C = await seedCustomer(h.q, 'Viajero');
        const result = await h.call(C.contactId, C.conversationId, 'search_packages', { destination: 'Cartagena', date }, scope);
        expect(result.packages.map((p: any) => p.name)).toEqual(['Isla Grupo Lleno']);
    });

    it('EST-03/04: a visit already booked cannot be rescheduled once its listing is sold', async () => {
        const id = await listing('Casa Aurora', { agent: staffId });
        const C = await seedCustomer(h.q, 'Comprador');
        expect((await visit(C, id)).success).toBe(true);
        const apt = (await h.q<any[]>('SELECT id::text AS id FROM appointments'))[0].id;
        await h.q(`UPDATE real_estate_listings SET status='sold' WHERE id=$1::uuid`, [id]);
        const result = await confirmed(C, 'reschedule_appointment', { appointmentId: apt, newDate: date, newTime: '11:00' });
        expect(result.error).toBe('listing_unavailable');
        expect((await h.q<any[]>(`SELECT to_char(start_at,'HH24:MI') AS t FROM appointments`))[0].t).toBe('10:00');
    });

    it('TRIP-02: create_tour_booking refuses a departure date in the past', async () => {
        const id = await pkg('Isla Grande'); const inv = await seats(id, past, 5);
        const C = await seedCustomer(h.q, 'Viajero');
        const result = await confirmed(C, 'create_tour_booking', { packageId: id, departureDate: past, partySize: 2, guestName: 'Ana' });
        expect(result.success).not.toBe(true);
        expect(await h.q('SELECT id FROM tour_bookings')).toEqual([]);
        expect(await seatsLeft(inv)).toBe(5);
    });

    it('TRIP-02: create_tour_booking refuses a group below the package minimum', async () => {
        const id = await pkg('Isla Grupo', { min: 4 }); const inv = await seats(id, date, 9);
        const C = await seedCustomer(h.q, 'Viajero');
        const result = await confirmed(C, 'create_tour_booking', { packageId: id, departureDate: date, partySize: 1, guestName: 'Ana' });
        expect(result.success).not.toBe(true);
        expect(await h.q('SELECT id FROM tour_bookings')).toEqual([]);
        expect(await seatsLeft(inv)).toBe(9);
    });

    // ── Empty catalogue and accents (diagnosis 2026-10-09, F1 / F5) ───────────
    it('F1: search_listings over a catalogue with no available listing answers catalog_empty; with listings it is a plain no-match', async () => {
        const C = await seedCustomer(h.q, 'Comprador');
        const empty = await h.call(C.contactId, C.conversationId, 'search_listings', { transactionType: 'sale', neighborhood: 'Usaquén', minBedrooms: 3 }, scope);
        expect(empty.listings).toEqual([]);
        expect(empty.catalog_empty).toBe(true);
        await listing('Casa vendida', { status: 'sold' });
        expect((await h.call(C.contactId, C.conversationId, 'search_listings', {}, scope)).catalog_empty).toBe(true);
        await listing('Casa Aurora', { hood: 'Chapinero' });
        const noMatch = await h.call(C.contactId, C.conversationId, 'search_listings', { neighborhood: 'Medellín' }, scope);
        expect(noMatch.listings).toEqual([]);
        expect(noMatch.catalog_empty).toBeUndefined();
        expect(noMatch.message).toContain('No hay inmuebles con esos criterios');
    });

    it('F5: a neighborhood typed with or without the accent finds the listing the owner typed either way', async () => {
        await listing('Casa Aurora', { hood: 'Usaquen' });
        await listing('Casa Bruma', { hood: 'Chapinero' });
        const C = await seedCustomer(h.q, 'Comprador');
        const accented = await h.call(C.contactId, C.conversationId, 'search_listings', { neighborhood: 'Usaquén' }, scope);
        expect(accented.listings.map((l: any) => l.name)).toEqual(['Casa Aurora']);
        await h.q(`UPDATE real_estate_listings SET neighborhood='Usaquén' WHERE name='Casa Aurora'`);
        const plain = await h.call(C.contactId, C.conversationId, 'search_listings', { neighborhood: 'usaquen' }, scope);
        expect(plain.listings.map((l: any) => l.name)).toEqual(['Casa Aurora']);
    });

    it('F1/F4: search_packages over a catalogue with no package answers catalog_empty, but a past date is said first', async () => {
        const C = await seedCustomer(h.q, 'Viajero');
        const empty = await h.call(C.contactId, C.conversationId, 'search_packages', { destination: 'Cartagena' }, scope);
        expect(empty.packages).toEqual([]);
        expect(empty.catalog_empty).toBe(true);
        const stale = await h.call(C.contactId, C.conversationId, 'search_packages', { date: past }, scope);
        expect(stale.reason).toBe('departure_in_past');
        expect(stale.catalog_empty).toBeUndefined();
        await pkg('Isla Grande');
        const noMatch = await h.call(C.contactId, C.conversationId, 'search_packages', { destination: 'Tokio' }, scope);
        expect(noMatch.packages).toEqual([]);
        expect(noMatch.catalog_empty).toBeUndefined();
    });

    it('F5: a destination typed without the accent finds the package titled with it', async () => {
        const id = randomUUID();
        await h.q(`INSERT INTO tour_packages(id,name,destination,price,currency,min_party_size,is_active,child_discount_pct,duration_type,duration_value)
            VALUES($1::uuid,'Ruta del Café','Medellín',250000,'COP',1,true,0,'days',2)`, [id]);
        const C = await seedCustomer(h.q, 'Viajero');
        const found = await h.call(C.contactId, C.conversationId, 'search_packages', { destination: 'medellin' }, scope);
        expect(found.packages.map((p: any) => p.name)).toEqual(['Ruta del Café']);
        const withAccent = await h.call(C.contactId, C.conversationId, 'search_packages', { destination: 'Medellín' }, scope);
        expect(withAccent.packages).toHaveLength(1);
    });
});
