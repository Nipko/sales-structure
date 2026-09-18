import { WhatsappConnectionService } from './whatsapp-connection.service';

/**
 * ═══ THE MANUAL RECONNECT DOES NOT CARRY A ZONE TO AN ACCOUNT NOBODY CONFIRMED ═══
 *
 * `saveConnection` rewrites `metadata.wabaId` and `metadata.metaTimezoneId` to
 * the account being connected, and used to leave `waba_timezone` untouched: a
 * number moved to another WhatsApp Business Account kept the zone confirmed for
 * the old one, beside the new account's ids — dated its charges in it, and
 * offered it to the new account's next number as `same_waba_same_id`. The
 * Embedded Signup path was fixed for this; this is its twin, end to end through
 * the service, plus the propagation of a confirmation, which now checks its
 * donor's evidence like any other donor.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_schema';

function setup(options: {
  existing?: Record<string, any> | null;
  siblings?: Array<Record<string, any>>;
  siblingReadFails?: boolean;
} = {}) {
  const prisma = {
    tenant: {
      findUnique: jest.fn(async () => ({ id: TENANT, schemaName: SCHEMA })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    channelAccount: {
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => options.existing ?? null),
      findMany: jest.fn(async ({ where }: any) => {
        if (options.siblingReadFails) throw new Error('pgbouncer unavailable');
        return (options.siblings ?? []).filter(row => (
          (where?.tenantId === undefined || row.tenantId === where.tenantId)
          && (where?.wabaTimezone?.not !== null || row.wabaTimezone !== null)
          && (where?.wabaTimezone !== null || row.wabaTimezone === null)
        ));
      }),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({ id: 'account-new' })),
    },
    whatsappCredential: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
    executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => (
      sql.includes('INSERT INTO whatsapp_channels') ? [{ id: 'channel-1' }] : []
    )),
  };
  const crypto = { encryptToken: jest.fn((token: string) => `encrypted:${token}`), decryptToken: jest.fn() };
  const throttle = { enforceChannelAccountLimit: jest.fn(async () => undefined) };
  const service = new WhatsappConnectionService(prisma as any, crypto as any, {} as any, throttle as any);
  jest.spyOn(service as any, 'assertTokenCoversWabas').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'markFirstChannelConnected').mockResolvedValue(undefined);
  const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
  const written = () => (prisma.channelAccount.update.mock.calls[0] as any)?.[0]?.data
    ?? (prisma.channelAccount.create.mock.calls[0] as any)?.[0]?.data;
  return { service, prisma, warn, written };
}

const connect = (h: ReturnType<typeof setup>, over: Record<string, unknown> = {}) => h.service.saveConnection(SCHEMA, TENANT, {
  phoneNumberId: 'phone-1', wabaId: 'waba-new', accessToken: 'token-new', ...over,
});

const row = (over: Record<string, any> = {}) => ({
  id: 'row-1', tenantId: TENANT, channelType: 'whatsapp', accountId: 'phone-1', isActive: true,
  wabaTimezone: 'America/Bogota',
  metadata: {
    wabaId: 'waba-old', metaTimezoneId: '42', phoneNumberId: 'phone-1', source: 'manual_connect',
    wabaTimezoneEvidence: { source: 'human_confirmed', at: '2026-09-01T00:00:00.000Z', timezoneId: 42, wabaId: 'waba-old' },
  },
  ...over,
});

describe('saveConnection: the billing zone of a reconnected number', () => {
  it('clears a zone confirmed for the old WABA when the number is reconnected to another one', async () => {
    const h = setup({ existing: row() });

    await connect(h, { timezoneId: 42 });

    const data = h.written();
    expect(data.wabaTimezone).toBeNull();
    expect(data.metadata).toEqual(expect.objectContaining({
      wabaId: 'waba-new', metaTimezoneId: '42', wabaTimezoneEvidence: null,
    }));
    expect(h.warn).toHaveBeenCalledWith(expect.stringMatching(/no longer keeps America\/Bogota[\s\S]*waba-old[\s\S]*waba-new/));
    expect(h.warn).toHaveBeenCalledWith(expect.stringMatching(/timezone_missing/));
  });

  it('keeps the zone when it is the same account, and says nothing about it', async () => {
    const h = setup({ existing: row({ metadata: { ...row().metadata, wabaId: 'waba-new',
      wabaTimezoneEvidence: { source: 'human_confirmed', at: '2026-09-01T00:00:00.000Z', timezoneId: 42, wabaId: 'waba-new' } } }) });

    await connect(h, { timezoneId: '42' });

    const data = h.written();
    expect(data).not.toHaveProperty('wabaTimezone');
    expect(data.metadata.wabaTimezoneEvidence).toEqual(expect.objectContaining({ source: 'human_confirmed', wabaId: 'waba-new' }));
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('drops the old Meta id when the new WABA reported none, instead of pairing it with the new account', async () => {
    const h = setup({ existing: row({ wabaTimezone: null, metadata: { wabaId: 'waba-old', metaTimezoneId: '42' } }) });

    await connect(h);

    expect(h.written().metadata.metaTimezoneId).toBeNull();
    expect(h.written().metadata.wabaId).toBe('waba-new');
  });

  it('gives the reconnected number the zone its new WABA already confirmed, with the evidence', async () => {
    const donor = {
      tenantId: TENANT, accountId: 'phone-2', wabaTimezone: 'America/Lima',
      metadata: { wabaId: 'waba-new', metaTimezoneId: '42', wabaTimezoneEvidence:
        { source: 'human_confirmed', at: '2026-09-01T00:00:00.000Z', timezoneId: 42, wabaId: 'waba-new' } },
    };
    const h = setup({ existing: row(), siblings: [donor] });

    await connect(h, { timezoneId: 42 });

    const data = h.written();
    expect(data.wabaTimezone).toBe('America/Lima');
    expect(data.metadata.wabaTimezoneEvidence).toEqual(expect.objectContaining({
      source: 'same_waba_same_id', wabaId: 'waba-new', timezoneId: 42, from: 'phone-2',
    }));
  });

  it('a brand-new number inherits the same way, and never from another tenant', async () => {
    const donor = (tenantId: string) => ({
      tenantId, accountId: 'phone-2', wabaTimezone: 'America/Lima',
      metadata: { wabaId: 'waba-new', metaTimezoneId: '42' },
    });
    const mine = setup({ siblings: [donor(TENANT)] });
    await connect(mine, { timezoneId: 42 });
    expect(mine.prisma.channelAccount.create).toHaveBeenCalled();
    expect(mine.written().wabaTimezone).toBe('America/Lima');

    const foreign = setup({ siblings: [donor('22222222-2222-4222-8222-222222222222')] });
    await connect(foreign, { timezoneId: 42 });
    expect(foreign.written()).not.toHaveProperty('wabaTimezone');
  });

  it('still writes the routing row when the other numbers cannot be read', async () => {
    const h = setup({ existing: row(), siblingReadFails: true });

    await expect(connect(h, { timezoneId: 42 })).resolves.toEqual({ success: true, channelId: 'channel-1' });

    expect(h.prisma.channelAccount.update).toHaveBeenCalledTimes(1);
    expect(h.written().wabaTimezone).toBeNull();
  });
});

describe('propagating a confirmed zone checks its donor', () => {
  const sibling = { id: 'row-2', accountId: 'phone-2', tenantId: TENANT, wabaTimezone: null,
    metadata: { wabaId: 'waba-1', metaTimezoneId: '42' } };

  it('does not carry a zone whose evidence names another account', async () => {
    const h = setup({ siblings: [sibling] });
    const applied = await (h.service as any).propagateZone(TENANT, {
      id: 'row-1',
      metadata: { wabaId: 'waba-1', metaTimezoneId: '42', phoneNumberId: 'phone-1',
        wabaTimezoneEvidence: { source: 'human_confirmed', at: '2026-09-01T00:00:00.000Z', timezoneId: 42, wabaId: 'waba-old' } },
    }, 'America/Bogota');

    expect(applied).toEqual([]);
    expect(h.prisma.channelAccount.update).not.toHaveBeenCalled();
  });

  it('carries one confirmed for the account it is on, matching "42" and 42 as one id', async () => {
    const h = setup({ siblings: [sibling] });
    const applied = await (h.service as any).propagateZone(TENANT, {
      id: 'row-1',
      metadata: { wabaId: 'waba-1', metaTimezoneId: 42, phoneNumberId: 'phone-1',
        wabaTimezoneEvidence: { source: 'human_confirmed', at: '2026-09-18T00:00:00.000Z', timezoneId: 42, wabaId: 'waba-1' } },
    }, 'America/Bogota');

    expect(applied).toEqual(['phone-2']);
  });

  it('setBillingTimeZone hands the propagation the evidence it just wrote', async () => {
    const h = setup({
      existing: { id: 'row-1', metadata: { wabaId: 'waba-1', metaTimezoneId: '42', phoneNumberId: 'phone-1' } },
      siblings: [sibling],
    });

    const result = await h.service.setBillingTimeZone(TENANT, 'phone-1', 'America/Bogota');

    expect(result.alsoApplied).toEqual(['phone-2']);
  });
});
