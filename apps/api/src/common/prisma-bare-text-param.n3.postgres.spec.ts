import { N3_LANE_URL, openLane } from './__fixtures__/n3-lane-harness';

/**
 * N3 - contract behind the "bare $n bound to a typed column" sweep.
 *
 * `executeInTenantSchema` hands JS strings to Prisma's `$queryRawUnsafe`, which binds
 * them as `text`. PostgreSQL does not assign `text` to these column types, so an INSERT /
 * UPDATE that writes `$n` WITHOUT a cast fails with 42804 on every call (D1b amount_cents,
 * D3 metadata, CRM-03-due due_at, ID-07 reviewed_by, AUT-11 due_at). Each case here states
 * which column types need the cast. If a case flips, the matching casts can be dropped;
 * until then every INSERT/UPDATE of a string into one of these types MUST cast.
 */
(N3_LANE_URL ? describe : describe.skip)('N3: bare text parameter vs typed column', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;

    beforeAll(async () => {
        lane = await openLane('n3bare', [
            `CREATE TABLE probe(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), u UUID, ts TIMESTAMP, tstz TIMESTAMPTZ,
                j JSONB, d DATE, t TIME, n NUMERIC(12,2), i INTEGER, b BIGINT, v VARCHAR(50), tx TEXT)`,
        ]);
    });
    afterAll(async () => { if (lane) await lane.close(); });

    const attempt = async (column: string, value: any, cast = '') => {
        try {
            await lane.sql(`INSERT INTO probe(${column}) VALUES ($1${cast})`, [value]);
            return 'ok';
        } catch (error: any) {
            return /42804|column .* is of type|text/i.test(String(error?.message)) ? '42804' : `other:${String(error?.message).slice(-120)}`;
        }
    };

    const SAMPLE: Record<string, any> = {
        u: '3f2c5a3e-7a52-4a9d-8d09-2b6f2c0a6a11', ts: '2026-10-07T10:00:00.000Z', tstz: '2026-10-07T10:00:00.000Z',
        j: '{"a":1}', d: '2026-10-07', t: '10:30:00',
    };

    it.each(['u', 'ts', 'tstz', 'j', 'd', 't'])('a bare string into %s is refused (42804)', async (column) => {
        // eslint-disable-next-line no-console
        const verdict = await attempt(column, SAMPLE[column]);
        // eslint-disable-next-line no-console
        console.log(`[N3-PROBE] bare text -> ${column}: ${verdict}`);
        expect(verdict).toBe('42804');
    });

    it.each([['u', '::uuid'], ['ts', '::timestamptz'], ['tstz', '::timestamptz'], ['j', '::jsonb'], ['d', '::date'], ['t', '::time']])(
        'the same string with a cast into %s is accepted', async (column, cast) => {
            expect(await attempt(column, SAMPLE[column], cast)).toBe('ok');
        });

    it('varchar/text columns take a bare string', async () => {
        expect(await attempt('v', 'hola')).toBe('ok');
        expect(await attempt('tx', 'hola')).toBe('ok');
    });

    it('numbers go to integer/bigint/numeric without a cast', async () => {
        // eslint-disable-next-line no-console
        console.log(`[N3-PROBE] number -> i/b/n: ${await attempt('i', 5)} ${await attempt('b', 5)} ${await attempt('n', 5.5)}`);
        expect(await attempt('i', 5)).toBe('ok');
        expect(await attempt('n', 5.5)).toBe('ok');
    });
});
