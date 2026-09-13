import { bindCanonicalEvalFixtures, prepareCanonicalEvalFixtures, resolveCanonicalEvalFixtures } from './eval-canonical-fixtures';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { agentTurnFixture } from '../conversations/__fixtures__/agent-turn.fixture';

const snapshot = (hours: unknown, capturedAt = '2026-09-07T04:30:00Z') => ({ capturedAt, config: { hours } } as AgentEvaluationSnapshot);
const schema = 'tenant_eval_12345678_123456781234567812345678';

describe('canonical eval fixtures', () => {
    it('uses captured tenant hours and timezone instead of a conflicting agent schedule', async () => {
        const input = snapshot({ timezone: 'America/Bogota', schedule: { monday: { start: '09:00', end: '10:00' } } });
        input.contextInputs = { businessHours: { timezone: 'Pacific/Auckland', schedule: {
            tuesday: { enabled: true, open: '13:15', close: '14:15', start: '08:00', end: '09:00' },
        } } } as any;
        const original = JSON.stringify(input);
        const query = jest.fn().mockResolvedValue([]);
        expect(await prepareCanonicalEvalFixtures(query, schema, input)).toMatchObject({ status: 'ready',
            timezone: 'Pacific/Auckland', date: '2026-09-15', time: '13:15', recoveryTime: '13:45', weekday: 2 });
        const configured = JSON.parse(query.mock.calls.find(([sql]) => sql.includes('.persona_config'))![1][1]);
        expect(configured.hours).toEqual({ timezone: 'Pacific/Auckland', schedule: { mar: { start: '13:15', end: '14:15' } } });
        expect(query.mock.calls.find(([sql]) => sql.includes('.availability_slots'))![1]).toEqual(expect.arrayContaining([2, '13:15', '14:15']));
        expect(JSON.stringify(input)).toBe(original);
    });
    it.each([{}, { schedule: {} }, { schedule: null }, { is247: true, schedule: { monday: { enabled: false } } }])('does not inherit a closed legacy schedule when tenant hours are unrestricted: %j', businessHours => {
        const input = snapshot({ schedule: { monday: { enabled: false } } });
        input.contextInputs = { businessHours } as any;
        expect(resolveCanonicalEvalFixtures(input)).toMatchObject({ status: 'ready', time: '09:00', windows: expect.any(Array) });
    });
    it('keeps tenant closures authoritative and rejects malformed tenant schedules before any fixture write', async () => {
        const input = snapshot({ schedule: {} }), query = jest.fn();
        input.contextInputs = { businessHours: { schedule: { monday: { enabled: false } } } } as any;
        expect(await prepareCanonicalEvalFixtures(query, schema, input)).toEqual({ status: 'blocked', reason: 'business_hours_closed' });
        input.contextInputs = { businessHours: { schedule: { lun: { start: '09:00', end: '10:00' } } } } as any;
        expect(await prepareCanonicalEvalFixtures(query, schema, input)).toEqual({ status: 'blocked', reason: 'invalid_business_hours' });
        expect(query).not.toHaveBeenCalled();
    });
    it('uses the captured regional timezone when neither tenant nor agent declares hours timezone', () => {
        const input = snapshot({ schedule: {} });
        input.contextInputs = { businessHours: null, regional: { timezone: { value: 'Pacific/Auckland' } } } as any;
        expect(resolveCanonicalEvalFixtures(input)).toMatchObject({ timezone: 'Pacific/Auckland', date: '2026-09-09' });
        input.config.hours = { timezone: 'America/Bogota', schedule: {} } as any;
        expect(resolveCanonicalEvalFixtures(input)).toMatchObject({ timezone: 'America/Bogota', date: '2026-09-08' });
    });
    it('skips nonexistent local times according to the captured tenant zone', () => {
        const input = snapshot({ timezone: 'America/Bogota', schedule: {} }, '2026-03-27T12:00:00Z');
        input.contextInputs = { businessHours: { timezone: 'Europe/Paris', schedule: {
            sunday: { enabled: true, open: '02:15', close: '03:15' },
        } } } as any;
        expect(resolveCanonicalEvalFixtures(input)).toMatchObject({ status: 'ready', timezone: 'Europe/Paris', date: '2026-04-05' });
    });
    it('agrees with the actual turn core about the captured timezone', async () => {
        const f = agentTurnFixture();
        f.prisma.tenant.findUnique.mockResolvedValue({ settings: { businessHours: { timezone: 'Pacific/Auckland', is247: true } } });
        const captured = await f.service.captureSnapshot('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        const fixture = resolveCanonicalEvalFixtures(captured);
        expect(fixture.status).toBe('ready');
        const response = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' }, { agentSnapshot: captured });
        expect(response.debug.turnContext.timezone).toBe(fixture.status === 'ready' ? fixture.timezone : 'unexpected_block');
    });
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
