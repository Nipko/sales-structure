import { EducationService } from './education.service';

function harness() {
    let state = { enrollment: { id: 'enrollment', contact_id: 'contact', status: 'enrolled', cohort_id: 'cohort' }, seats: 0, cohortStatus: 'full' };
    let failCapacity = false;
    const query = jest.fn(async (sql: string) => {
        if(sql.includes('pg_advisory_xact_lock')||sql.includes('to_regclass')||sql.startsWith('CREATE ')||sql.includes('FROM courses'))return [];
        if(sql.includes('SELECT * FROM course_cohorts'))return [{id:'cohort',available_seats:state.seats,status:state.cohortStatus,starts_at:'2099-01-01'}];
        if (sql.includes('SELECT')) return [{ ...state.enrollment }];
        if (sql.includes('UPDATE enrollments')) { state.enrollment.status = 'dropped'; return []; }
        if (sql.includes('UPDATE course_cohorts')) {
            if (failCapacity) throw new Error('capacity_write_failed');
            state.seats++; state.cohortStatus = 'open'; return [{ id: 'cohort' }];
        }
        throw new Error('Unexpected SQL');
    });
    let tail = Promise.resolve();
    const transaction = jest.fn((_schema: string, callback: any) => {
        const next = tail.then(async () => {
            const snapshot = JSON.parse(JSON.stringify(state));
            try { return await callback(query); } catch (error) { state = snapshot; throw error; }
        });
        tail = next.catch(() => undefined); return next;
    });
    return { service: new EducationService({ transactionInTenantSchema: transaction } as any), state: () => state, fail: (value: boolean) => { failCapacity = value; }, query };
}
describe('enrollment cancellation transaction', () => {
    it('rolls back status when seat restoration fails and succeeds on retry', async () => {
        const h = harness(); h.fail(true);
        await expect(h.service.cancelEnrollment('tenant_test', 'enrollment', { contactId: 'contact' })).rejects.toThrow('capacity_write_failed');
        expect(h.state()).toMatchObject({ enrollment: { status: 'enrolled' }, seats: 0 });
        h.fail(false);
        expect(await h.service.cancelEnrollment('tenant_test', 'enrollment', { contactId: 'contact' })).toMatchObject({ success: true, status: 'dropped', seatReleased: true });
        expect(h.state()).toMatchObject({ enrollment: { status: 'dropped' }, seats: 1, cohortStatus: 'open' });
    });
    it('returns capacity only once when callers race or retry', async () => {
        const h = harness();
        const results = await Promise.all([h.service.cancelEnrollment('tenant_test', 'enrollment'), h.service.cancelEnrollment('tenant_test', 'enrollment')]);
        expect(results.filter(r => r.alreadyCancelled)).toHaveLength(1);
        expect(h.state().seats).toBe(1);
    });
    it('checks contact ownership before replay or mutation', async () => {
        const h = harness();
        await expect(h.service.cancelEnrollment('tenant_test', 'enrollment', { contactId: 'other' })).rejects.toThrow('own enrollments');
        expect(h.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
        expect(h.state().enrollment.status).toBe('enrolled');
    });
});
