import {
  OnboardingService,
  billingCurrencyEvidenceFromMeta,
  decideBillingZone,
  metaTimezoneIdOf,
  usableBillingZone,
} from './onboarding.service';

/**
 * An Embedded Signup number must be born able to answer.
 *
 * The API's spend admission refuses every WhatsApp send with `timezone_missing`
 * while `channel_accounts.waba_timezone` is NULL — under `observe` as much as
 * under `enforce` — and Embedded Signup wrote neither the zone nor the evidence
 * a person's confirmation could later be carried from. Meta returns
 * `timezone_id`, a NUMERIC Facebook id, never a zone; the platform ships no
 * table from memory. So what is pinned here is: the evidence is always kept,
 * a zone is written only when the tenant's own numbers on the same WABA
 * already confirmed that same id, and otherwise the column stays NULL — never
 * a default, and never the numeric id.
 *
 * The column carries CHECK `channel_accounts_waba_timezone_iana` (migration
 * 20260910120000_add_whatsapp_spend_ledger): NULL, 'UTC', or an IANA-shaped
 * name. The double below does not enforce it, so every write is asserted
 * against the same pattern instead — a value that failed it in PostgreSQL
 * would abort the routing write and leave the number unroutable.
 */
const CHECK = /^(UTC|[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+_.-]+)+)$/;

const tenantId = '090baca7-46da-4061-b5ea-7f72350178e6';
const wabaId = 'waba-1';
const phone = { id: 'phone-new', displayPhoneNumber: '+573001112233', verifiedName: 'Tienda', qualityRating: 'GREEN' };

type Row = {
  id: string;
  tenantId: string;
  channelType: string;
  accountId: string;
  isActive: boolean;
  wabaTimezone: string | null;
  metadata: Record<string, unknown>;
};

function harness(options: { rows?: Row[]; findManyThrows?: boolean } = {}) {
  const rows: Row[] = options.rows ?? [];
  const matches = (row: any, where: Record<string, any>) => Object.entries(where || {}).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && 'not' in expected) return row[key] !== expected.not;
    return row[key] === expected;
  });
  const project = (row: any, select?: Record<string, boolean>) => (select
    ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]]))
    : { ...row });
  const prisma = {
    channelAccount: {
      findFirst: jest.fn(async ({ where }: any) => rows.find(row => matches(row, where)) ?? null),
      findMany: jest.fn(async ({ where, select }: any) => {
        if (options.findManyThrows) throw new Error('pgbouncer unavailable');
        return rows.filter(row => matches(row, where)).map(row => project(row, select));
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 'created', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'updated', ...data })),
    },
  };
  const service = new OnboardingService(prisma as any, {} as any, { get: jest.fn() } as any, {} as any);
  const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
  const written = () => {
    const call = prisma.channelAccount.create.mock.calls[0] ?? prisma.channelAccount.update.mock.calls[0];
    return call?.[0]?.data;
  };
  return { service, prisma, warn, written };
}

function sibling(overrides: Partial<Row> = {}): Row {
  return {
    id: 'row-old', tenantId, channelType: 'whatsapp', accountId: 'phone-old', isActive: true,
    wabaTimezone: 'America/Bogota',
    metadata: { wabaId, metaTimezoneId: '12', phoneNumberId: 'phone-old' },
    ...overrides,
  };
}

async function register(h: ReturnType<typeof harness>, waba: Record<string, unknown> | null) {
  await (h.service as any).registerChannelAccount(tenantId, phone, wabaId, 'business-1', waba);
  const data = h.written();
  // Whatever happened, the column never receives something its CHECK refuses.
  // NULL is allowed: it is how a zone that no longer applies is cleared.
  if (data && 'wabaTimezone' in data && data.wabaTimezone !== null) expect(data.wabaTimezone).toMatch(CHECK);
  return data;
}

describe('Embedded Signup billing time zone and currency on channel_accounts', () => {
  it('keeps Meta\'s numeric id as evidence and leaves the zone NULL when nobody confirmed it', async () => {
    const h = harness();

    const data = await register(h, { timezoneId: '12', currency: 'cop' });

    expect(data).not.toHaveProperty('wabaTimezone');
    expect(data.metadata).toEqual(expect.objectContaining({
      metaTimezoneId: '12',
      source: 'embedded_signup',
      billingCurrencyEvidence: {
        currency: 'COP', source: 'meta_waba', observedAt: expect.any(String), wabaId,
      },
    }));
    expect(Date.parse(data.metadata.billingCurrencyEvidence.observedAt)).not.toBeNaN();
    // Said loudly, with its consequence, because this is the state in which
    // the number is refused every reply.
    expect(h.warn).toHaveBeenCalledWith(expect.stringMatching(/timezone_id=12[\s\S]*timezone_missing/));
  });

  it('carries the zone from another number of the same WABA reporting the same id', async () => {
    const h = harness({ rows: [sibling()] });

    const data = await register(h, { timezoneId: '12', currency: 'COP' });

    expect(data.wabaTimezone).toBe('America/Bogota');
    expect(data.metadata.wabaTimezoneEvidence).toEqual({
      source: 'same_waba_same_id', at: expect.any(String), timezoneId: 12, wabaId, from: 'phone-old',
    });
    expect(h.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['another WABA', sibling({ metadata: { wabaId: 'waba-other', metaTimezoneId: '12' } })],
    ['another Meta id', sibling({ metadata: { wabaId, metaTimezoneId: '47' } })],
    ['another tenant', sibling({ tenantId: 'another-tenant' })],
    ['a sibling with no zone', sibling({ wabaTimezone: null })],
  ])('does not carry a zone from %s', async (_label, row) => {
    const h = harness({ rows: [row] });

    const data = await register(h, { timezoneId: '12' });

    expect(data).not.toHaveProperty('wabaTimezone');
    expect(data.metadata).not.toHaveProperty('wabaTimezoneEvidence');
  });

  it('inherits nothing when the numbers of one WABA disagree', async () => {
    const h = harness({ rows: [
      sibling({ id: 'a', accountId: 'phone-a' }),
      sibling({ id: 'b', accountId: 'phone-b', wabaTimezone: 'America/Lima' }),
    ] });

    const data = await register(h, { timezoneId: '12' });

    expect(data).not.toHaveProperty('wabaTimezone');
    expect(h.warn).toHaveBeenCalledWith(expect.stringMatching(/America\/Bogota, America\/Lima/));
  });

  it('leaves the zone NULL and says so when Meta reported no timezone_id', async () => {
    const h = harness({ rows: [sibling()] });

    const data = await register(h, { currency: 'USD' });

    expect(data).not.toHaveProperty('wabaTimezone');
    expect(data.metadata).not.toHaveProperty('metaTimezoneId');
    // Nothing to match a sibling on, so nothing is even read.
    expect(h.prisma.channelAccount.findMany).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledWith(expect.stringMatching(/no timezone_id[\s\S]*timezone_missing/));
  });

  it('writes nothing billing-related when no WABA details were available', async () => {
    const h = harness();

    const data = await register(h, null);

    expect(data).not.toHaveProperty('wabaTimezone');
    expect(data.metadata).not.toHaveProperty('metaTimezoneId');
    expect(data.metadata).not.toHaveProperty('billingCurrencyEvidence');
  });

  it('never overwrites a zone already on the row, and keeps its evidence', async () => {
    const existing = sibling({
      id: 'row-self', accountId: phone.id, wabaTimezone: 'America/Mexico_City',
      metadata: {
        wabaId, metaTimezoneId: '12',
        wabaTimezoneEvidence: { source: 'human_confirmed', at: '2026-09-01T00:00:00Z' },
      },
    });
    const h = harness({ rows: [existing, sibling()] });

    const data = await register(h, { timezoneId: '12' });

    expect(h.prisma.channelAccount.update).toHaveBeenCalled();
    expect(data).not.toHaveProperty('wabaTimezone');
    expect(data.metadata.wabaTimezoneEvidence).toEqual({ source: 'human_confirmed', at: '2026-09-01T00:00:00Z' });
  });

  /**
   * A reconnect rewrites `wabaId` and `metaTimezoneId` to the new account. A
   * zone kept beside them would read as confirmed FOR that account — and the
   * next number on it would inherit it as `same_waba_same_id`, a zone nobody
   * confirmed. So a zone confirmed against another WABA or another Meta id
   * does not survive the reconnect: it is cleared, and the new account gets
   * only what can be established for it.
   */
  it('clears a zone confirmed against another Meta timezone id', async () => {
    const existing = sibling({
      id: 'row-self', accountId: phone.id,
      metadata: { wabaId, metaTimezoneId: '12', wabaTimezoneEvidence: { source: 'human_confirmed', at: '2026-09-01T00:00:00Z', timezoneId: 12, wabaId } },
    });
    const h = harness({ rows: [existing] });

    const data = await register(h, { timezoneId: '47' });

    expect(data.wabaTimezone).toBeNull();
    expect(data.metadata.metaTimezoneId).toBe('47');
    expect(data.metadata.wabaTimezoneEvidence).toBeNull();
    // Said twice, loudly: what was dropped and why, then what it costs.
    expect(h.warn).toHaveBeenCalledWith(expect.stringMatching(/no longer keeps America\/Bogota[\s\S]*timezone_id=12[\s\S]*timezone_id=47/));
    expect(h.warn).toHaveBeenCalledWith(expect.stringMatching(/timezone_id=47[\s\S]*timezone_missing/));
  });

  it('clears a zone confirmed for another WABA, even when Meta reports the same id', async () => {
    const existing = sibling({
      id: 'row-self', accountId: phone.id,
      metadata: { wabaId: 'waba-old', metaTimezoneId: '12', wabaTimezoneEvidence: { source: 'human_confirmed', at: '2026-09-01T00:00:00Z', timezoneId: 12, wabaId: 'waba-old' } },
    });
    const h = harness({ rows: [existing] });

    const data = await register(h, { timezoneId: '12' });

    expect(data.wabaTimezone).toBeNull();
    expect(data.metadata.wabaId).toBe(wabaId);
    expect(data.metadata.wabaTimezoneEvidence).toBeNull();
  });

  it('gives a number moved to another WABA the zone that WABA already confirmed, and says where it came from', async () => {
    const existing = sibling({
      id: 'row-self', accountId: phone.id, wabaTimezone: 'Europe/Madrid',
      metadata: { wabaId: 'waba-old', metaTimezoneId: '12' },
    });
    const h = harness({ rows: [existing, sibling()] });

    const data = await register(h, { timezoneId: '12' });

    expect(data.wabaTimezone).toBe('America/Bogota');
    expect(data.metadata.wabaTimezoneEvidence).toEqual({
      source: 'same_waba_same_id', at: expect.any(String), timezoneId: 12, wabaId, from: 'phone-old',
    });
  });

  it('drops the old Meta id when the number moved to a WABA that reported none', async () => {
    const existing = sibling({
      id: 'row-self', accountId: phone.id, wabaTimezone: null,
      metadata: { wabaId: 'waba-old', metaTimezoneId: '12' },
    });
    const h = harness({ rows: [existing] });

    const data = await register(h, { currency: 'COP' });

    // `waba-1` never reported `12`; keeping it would say it did.
    expect(data.metadata.metaTimezoneId).toBeNull();
    expect(data).not.toHaveProperty('wabaTimezone');
  });

  it('keeps a confirmed zone when Meta simply did not report an id this time', async () => {
    const existing = sibling({ id: 'row-self', accountId: phone.id, metadata: { wabaId, metaTimezoneId: '12' } });
    const h = harness({ rows: [existing] });

    const data = await register(h, { currency: 'COP' });

    expect(data).not.toHaveProperty('wabaTimezone');
    expect(data.metadata.metaTimezoneId).toBe('12');
  });

  it('fills a zone missing on a reconnected row from its siblings', async () => {
    const existing = sibling({ id: 'row-self', accountId: phone.id, wabaTimezone: null, metadata: { wabaId } });
    const h = harness({ rows: [existing, sibling()] });

    const data = await register(h, { timezoneId: '12' });

    expect(h.prisma.channelAccount.update).toHaveBeenCalled();
    expect(data.wabaTimezone).toBe('America/Bogota');
  });

  it('still writes the routing row when the sibling read fails', async () => {
    const h = harness({ findManyThrows: true });

    const data = await register(h, { timezoneId: '12', currency: 'COP' });

    expect(h.prisma.channelAccount.create).toHaveBeenCalledTimes(1);
    expect(data).not.toHaveProperty('wabaTimezone');
    expect(data.metadata.metaTimezoneId).toBe('12');
  });
});

describe('billing facts helpers', () => {
  it.each([
    ['America/Bogota', 'America/Bogota'],
    ['UTC', 'UTC'],
    ['America/Argentina/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
    ['12', null],
    ['America/Nowhere', null],
    ['', null],
    [null, null],
  ])('usableBillingZone(%p) is %p', (input, expected) => {
    expect(usableBillingZone(input)).toBe(expected);
  });

  it('keeps Meta\'s timezone id as the string it reported, never as a zone', () => {
    expect(metaTimezoneIdOf({ timezoneId: '12' })).toBe('12');
    expect(metaTimezoneIdOf({ timezoneId: ' ' })).toBeNull();
    expect(metaTimezoneIdOf({})).toBeNull();
    expect(metaTimezoneIdOf(null)).toBeNull();
  });

  it('records a currency only as a three-letter code with its source and date', () => {
    const at = new Date('2026-09-17T12:00:00Z');
    expect(billingCurrencyEvidenceFromMeta(' cop ', wabaId, at)).toEqual({
      currency: 'COP', source: 'meta_waba', observedAt: '2026-09-17T12:00:00.000Z', wabaId,
    });
    expect(billingCurrencyEvidenceFromMeta('pesos', wabaId, at)).toBeNull();
    expect(billingCurrencyEvidenceFromMeta(undefined, wabaId, at)).toBeNull();
  });

  it('never lets the target inherit from itself', () => {
    expect(decideBillingZone(
      { accountId: 'phone-old', wabaId, timezoneId: '12' },
      [{ accountId: 'phone-old', wabaTimezone: 'America/Bogota', metadata: { wabaId, metaTimezoneId: '12' } }],
    )).toEqual({ kind: 'unconfirmed_timezone_id' });
  });

  it.each([
    ['names another WABA', { source: 'human_confirmed', at: '2026-09-01T00:00:00Z', wabaId: 'waba-old', timezoneId: 12 }],
    ['names another Meta id', { source: 'human_confirmed', at: '2026-09-01T00:00:00Z', wabaId, timezoneId: 47 }],
  ])('never inherits from a sibling whose zone evidence %s (a zone kept across a reconnect)', (_label, evidence) => {
    expect(decideBillingZone(
      { accountId: 'phone-new', wabaId, timezoneId: '12' },
      [{ accountId: 'phone-old', wabaTimezone: 'America/Bogota', metadata: { wabaId, metaTimezoneId: '12', wabaTimezoneEvidence: evidence } }],
    )).toEqual({ kind: 'unconfirmed_timezone_id' });
  });

  it('inherits from a sibling whose evidence was confirmed for the account it is on', () => {
    expect(decideBillingZone(
      { accountId: 'phone-new', wabaId, timezoneId: '12' },
      [{ accountId: 'phone-old', wabaTimezone: 'America/Bogota', metadata: {
        wabaId, metaTimezoneId: '12', wabaTimezoneEvidence: { source: 'human_confirmed', at: '2026-09-01T00:00:00Z', wabaId, timezoneId: 12 },
      } }],
    )).toEqual({ kind: 'inherited', zone: 'America/Bogota', from: 'phone-old' });
  });

  it('ignores a sibling whose stored zone the column would refuse', () => {
    expect(decideBillingZone(
      { accountId: 'phone-new', wabaId, timezoneId: '12' },
      [{ accountId: 'phone-old', wabaTimezone: '12', metadata: { wabaId, metaTimezoneId: '12' } }],
    )).toEqual({ kind: 'unconfirmed_timezone_id' });
  });
});
