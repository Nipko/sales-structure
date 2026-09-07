import { GymsService } from './gyms.service';

function harness(spots = 1) {
    let state: any = {
        klass: { id: 'class', available_spots: spots, is_cancelled: false, scheduled_at: '2099-01-01', credits_required: 1 },
        members: { a: { id: 'a', contact_id: 'contact-a', status: 'active', class_credits_remaining: 3 }, b: { id: 'b', contact_id: 'contact-b', status: 'active', class_credits_remaining: 2 } },
        bookings: [],
    };
    let failure = '';
    const query = jest.fn(async (sql: string, p: any[] = []) => {
        if (failure && sql.includes(failure)) throw new Error('write_failed');
        if (sql.startsWith('SELECT * FROM fitness_classes')) return [{ ...state.klass }];
        if (sql.startsWith('SELECT * FROM members')) return state.members[p[0]] ? [{ ...state.members[p[0]] }] : [];
        if (sql.startsWith('SELECT class_id')) return state.bookings.filter((b: any) => b.id === p[0]);
        if (sql.startsWith('SELECT * FROM class_bookings WHERE id')) return state.bookings.filter((b: any) => b.id === p[0]).map((b: any) => ({ ...b }));
        if (sql.startsWith('SELECT * FROM class_bookings WHERE class_id')) return state.bookings.filter((b: any) => b.member_id === p[1] && ['confirmed', 'waitlist', 'attended'].includes(b.status));
        if (sql.startsWith('SELECT COUNT')) return [{ n: state.bookings.filter((b: any) => b.status === 'waitlist').length }];
        if (sql.includes('SELECT b.*, m.class_credits_remaining')) {
            const next = state.bookings.find((b: any) => b.status === 'waitlist' && state.members[b.member_id].status === 'active' && state.members[b.member_id].class_credits_remaining >= b.credits_used);
            return next ? [{ ...next, class_credits_remaining: state.members[next.member_id].class_credits_remaining }] : [];
        }
        if (sql.startsWith('UPDATE fitness_classes')) {
            state.klass.available_spots += sql.includes('available_spots + 1') ? 1 : -1; return [];
        }
        if (sql.startsWith('UPDATE members')) {
            const member = state.members[p[1]];
            if (member.class_credits_remaining == null) return [];
            member.class_credits_remaining += sql.includes('class_credits_remaining + $1') ? p[0] : -p[0]; return [{ id: member.id }];
        }
        if (sql.startsWith('INSERT INTO class_bookings')) {
            const b = { id: 'booking-' + (state.bookings.length + 1), class_id: p[0], member_id: p[1], contact_id: p[2], credits_used: p[3], status: p[4] };
            state.bookings.push(b); return [{ ...b }];
        }
        if (sql.startsWith('UPDATE class_bookings')) {
            state.bookings.find((b: any) => b.id === p[0]).status = sql.includes("status = 'cancelled'") ? 'cancelled' : 'confirmed'; return [];
        }
        throw new Error('Unexpected query: ' + sql);
    });
    let tail = Promise.resolve();
    const prisma = { transactionInTenantSchema: (_schema: string, cb: any) => {
        const run = tail.then(async () => { const before = JSON.parse(JSON.stringify(state)); try { return await cb(query); } catch (e) { state = before; throw e; } });
        tail = run.catch(() => undefined); return run;
    } };
    return { service: new GymsService(prisma as any), state: () => state, fail: (pattern: string) => { failure = pattern; } };
}
describe('gym booking domain transactions', () => {
    it('creates a recoverable waitlist entry for a full class without spending credits', async () => {
        const h = harness(0);
        const result = await h.service.bookClass('tenant_test', 'class', 'a');
        expect(result).toMatchObject({ status: 'waitlist', waitlisted: true, waitlistPosition: 1 });
        expect(h.state().members.a.class_credits_remaining).toBe(3);
        expect(h.state().klass.available_spots).toBe(0);
        expect(await h.service.bookClass('tenant_test', 'class', 'a')).toMatchObject({ id: result.id, idempotentReplay: true, waitlisted: true });
        expect(h.state().bookings).toHaveLength(1);
    });
    it('rolls back the claimed spot when a later credit write fails, then retries once', async () => {
        const h = harness(); h.fail('UPDATE members');
        await expect(h.service.bookClass('tenant_test', 'class', 'a')).rejects.toThrow('write_failed');
        expect(h.state().klass.available_spots).toBe(1);
        expect(h.state().bookings).toHaveLength(0);
        h.fail(''); await h.service.bookClass('tenant_test', 'class', 'a');
        expect(h.state().klass.available_spots).toBe(0);
        expect(h.state().members.a.class_credits_remaining).toBe(2);
    });
    it('allocates the last spot once and places the next member in waiting state', async () => {
        const h = harness();
        const results = await Promise.all([h.service.bookClass('tenant_test', 'class', 'a'), h.service.bookClass('tenant_test', 'class', 'b')]);
        expect(results.map(r => r.status)).toEqual(['confirmed', 'waitlist']);
        expect(h.state().members.b.class_credits_remaining).toBe(2);
        expect(h.state().klass.available_spots).toBe(0);
    });
    it('cancels waiting entries without inventing a spot or refunding credits', async () => {
        const h = harness(0); const booking = await h.service.bookClass('tenant_test', 'class', 'a');
        expect(await h.service.cancelBooking('tenant_test', booking.id, 'contact-a')).toMatchObject({ previousStatus: 'waitlist', creditsRestored: 0 });
        expect(h.state().klass.available_spots).toBe(0);
        expect(h.state().members.a.class_credits_remaining).toBe(3);
    });
    it('promotes the eligible waiter with the cancellation and restores credits only once', async () => {
        const h = harness(); const a = await h.service.bookClass('tenant_test', 'class', 'a'); const b = await h.service.bookClass('tenant_test', 'class', 'b');
        await h.service.cancelBooking('tenant_test', a.id, 'contact-a');
        expect(h.state().bookings.find((entry: any) => entry.id === b.id).status).toBe('confirmed');
        expect(h.state().members).toMatchObject({ a: { class_credits_remaining: 3 }, b: { class_credits_remaining: 1 } });
        expect(h.state().klass.available_spots).toBe(0);
        expect(await h.service.cancelBooking('tenant_test', a.id, 'contact-a')).toMatchObject({ alreadyCancelled: true, creditsRestored: 0 });
        expect(h.state().members.a.class_credits_remaining).toBe(3);
    });
    it('rolls back cancellation and capacity restoration when promotion fails', async () => {
        const h = harness(); const a = await h.service.bookClass('tenant_test', 'class', 'a'); await h.service.bookClass('tenant_test', 'class', 'b');
        h.fail("UPDATE class_bookings SET status = 'confirmed'");
        await expect(h.service.cancelBooking('tenant_test', a.id, 'contact-a')).rejects.toThrow('write_failed');
        expect(h.state().bookings.map((b: any) => b.status)).toEqual(['confirmed', 'waitlist']);
        expect(h.state().klass.available_spots).toBe(0);
        expect(h.state().members.a.class_credits_remaining).toBe(2);
    });
    it('rejects foreign ownership even for a previously cancelled booking', async () => {
        const h = harness(); const a = await h.service.bookClass('tenant_test', 'class', 'a');
        await h.service.cancelBooking('tenant_test', a.id, 'contact-a');
        await expect(h.service.cancelBooking('tenant_test', a.id, 'contact-b')).rejects.toThrow('own bookings');
    });
});
