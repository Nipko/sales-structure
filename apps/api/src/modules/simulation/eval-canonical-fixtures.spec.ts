import { bindCanonicalEvalFixtures, prepareCanonicalEvalFixtures, resolveCanonicalEvalFixtures } from './eval-canonical-fixtures';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';

const snapshot = (hours: unknown, capturedAt = '2026-09-07T04:30:00Z') => ({ capturedAt, config: { hours } } as AgentEvaluationSnapshot);
const schema = 'tenant_eval_12345678_123456781234567812345678';

describe('canonical eval fixtures', () => {
    it.each(['America/Bogota', 'Pacific/Auckland', 'America/Los_Angeles', 'Europe/Paris'])('uses future civil weekdays and enough configured duration in %s', timezone => {
        const fixtures = resolveCanonicalEvalFixtures(snapshot({ timezone, schedule: { monday: { start: '13:15', end: '14:15' } } }));
        expect(fixtures).toMatchObject({ status: 'ready', date: '2026-09-14', time: '13:15', recoveryTime: '13:45', recoveryEndTime: '14:15', weekday: 1, timezone });
    });
    it('starts from the tenant civil date, not UTC or the machine date', () => {
        const input = snapshot({ timezone: 'America/Bogota', schedule: {} }); // Sunday night locally; Monday UTC.
        expect(resolveCanonicalEvalFixtures(input)).toMatchObject({ date: '2026-09-08', time: '09:00' });
        expect(resolveCanonicalEvalFixtures(snapshot({ timezone: 'Pacific/Auckland', schedule: {} }))).toMatchObject({ date: '2026-09-09' });
    });
    it.each([
        [{ timezone: 'Etc/Broken', schedule: {} }, 'invalid_timezone'],
        [{ timezone: 'America/Bogota', schedule: { monday: { enabled: false } } }, 'business_hours_closed'],
        [{ schedule: { lun: { start: '10:00', end: '10:45' } } }, 'business_hours_too_short'],
        [{ schedule: { lun: { start: '25:00', end: '28:00' } } }, 'invalid_business_hours'],
        [{ schedule: { monday: '09:00-18:00' } }, 'invalid_business_hours'],
        [{ schedule: { mon: { start: '09:00', end: '18:00' } } }, 'invalid_business_hours'],
        [{ schedule: { lun: { start: '09:00', end: '18:00' }, monday: { enabled: false } } }, 'invalid_business_hours'],
    ])('blocks invalid/closed settings instead of inventing operational hours', (hours, reason) => {
        expect(resolveCanonicalEvalFixtures(snapshot(hours))).toEqual({ status: 'blocked', reason });
    });
    it('rejects an invalid capture time and skips nonexistent DST clocks', () => {
        expect(resolveCanonicalEvalFixtures(snapshot({}, 'broken'))).toEqual({ status: 'blocked', reason: 'invalid_snapshot_time' });
        const fixture = resolveCanonicalEvalFixtures(snapshot({ timezone: 'Europe/Paris', schedule: { sunday: { start: '02:15', end: '03:15' } } }, '2026-03-27T12:00:00Z'));
        expect(fixture).toMatchObject({ status: 'ready', date: '2026-04-05' });
    });
    it('binds dates, catalog references and structured effect filters together without mutating the seed', () => {
        const fixtures = resolveCanonicalEvalFixtures(snapshot({ schedule: {} }));
        const seed = { messages: ['{{fixture.service}} {{fixture.date}} {{fixture.time}}'], expectedActions: [{ where: { service_id: '{{fixture.serviceId}}', start_at: '{{fixture.date}}T{{fixture.time}}:00' } }] };
        const bound = bindCanonicalEvalFixtures(seed, fixtures);
        expect(bound.messages).toEqual(['[EVAL] Sandbox Service 2026-09-08 09:00']);
        expect(bound.expectedActions[0].where).toEqual({ service_id: '00000000-0000-4000-8000-00000000b001', start_at: '2026-09-08T09:00:00' });
        expect(seed.messages[0]).toContain('{{fixture.date}}');
        expect(() => bindCanonicalEvalFixtures('{{fixture.unknown}}', fixtures)).toThrow('eval_fixture_binding_unknown');
    });
    it('seeds only the owned namespace, canonical rows and matching configuration, never business effects or public data', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const input = snapshot({ timezone: 'America/Bogota', schedule: { mie: { start: '09:00', end: '10:00' } } });
        const result = await prepareCanonicalEvalFixtures(query, schema, input);
        expect(result).toMatchObject({ status: 'ready', date: '2026-09-09' });
        const statements = query.mock.calls.map(([sql]) => sql as string);
        expect(statements.every(sql => sql.startsWith(`INSERT INTO "${schema}".`))).toBe(true);
        expect(statements.some(sql => /public\.|2099|INSERT INTO .*\.(appointments|class_bookings|enrollments)\b/.test(sql))).toBe(false);
        expect(query.mock.calls.find(([sql]) => sql.includes('.persona_config'))?.[1][1]).toBe(JSON.stringify(input.config));
        expect(query.mock.calls.filter(([sql]) => sql.includes('.availability_slots'))).toHaveLength(1);
        expect(query.mock.calls.find(([sql]) => sql.includes('.tour_inventory'))?.[1]).toEqual(expect.arrayContaining(['2026-09-09', '09:00']));
    });
    it('writes nothing on a blocked schedule, foreign schema, or unsafe identifier', async () => {
        const query = jest.fn();
        expect(await prepareCanonicalEvalFixtures(query, schema, snapshot({ schedule: { monday: { enabled: false } } }))).toMatchObject({ status: 'blocked' });
        await expect(prepareCanonicalEvalFixtures(query, 'tenant_live', snapshot({ schedule: {} }))).rejects.toThrow('eval_fixture_namespace_required');
        await expect(prepareCanonicalEvalFixtures(query, `${schema}";DROP`, snapshot({ schedule: {} }))).rejects.toThrow('eval_fixture_namespace_required');
        expect(query).not.toHaveBeenCalled();
    });
    it('surfaces seed database failures instead of yielding a successful fixture', async () => {
        const query = jest.fn().mockRejectedValue(new Error('fixture_database_unavailable'));
        await expect(prepareCanonicalEvalFixtures(query, schema, snapshot({ schedule: {} }))).rejects.toThrow('fixture_database_unavailable');
    });
});
