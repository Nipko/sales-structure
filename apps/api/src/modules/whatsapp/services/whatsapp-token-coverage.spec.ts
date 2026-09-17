import { WhatsappConnectionService } from './whatsapp-connection.service';
import {
  classifyCoverageProbe, disconnectedCoveragePhoneIds, liveCoverageWabaIds,
  type CoverageAccountRow, type CoverageProbeAnswer, type CoverageProbeResult,
} from './whatsapp-live-coverage';

interface ChannelRow { meta_waba_id: string | null; phone_number_id: string | null; channel_status: string | null }
interface AccountRow { tenantId: string; channelType?: string; accountId: string; isActive: boolean }

/**
 * One scripted answer to one WABA read: either no HTTP answer at all (fetch
 * rejects with an error of that `name`), or a status with a body — `unreadable`
 * when the body is not JSON (an edge's HTML page, a cut stream).
 */
type ProbeAnswer =
  | { readonly noResponse: string; readonly message: string; readonly cause?: string }
  | { readonly status: number; readonly body?: unknown; readonly unreadable?: true };

/** What Meta answers when a token cannot see a WABA at all. */
const GRAPH_UNSUPPORTED_GET: ProbeAnswer = {
  status: 400,
  body: { error: { message: 'Unsupported get request.', type: 'GraphMethodException', code: 100, error_subcode: 33 } },
};

/**
 * The harness models BOTH authorities the send path consults — the tenant's
 * `whatsapp_channels` rows and the global `channel_accounts` rows — and a Meta
 * that answers per token, so "this token cannot read that WABA" is a property
 * of the token and not of the test.
 */
function setup(options: {
  rows?: ChannelRow[];
  accounts?: AccountRow[];
  credential?: Record<string, unknown> | null;
  /** WABA ids each token can read ('*' reads any). A token not listed reads nothing. */
  readable?: Record<string, string[] | '*'>;
  /** Scripted answers by token, then WABA id. They win over `readable`. */
  answers?: Record<string, Record<string, ProbeAnswer>>;
} = {}) {
  const sqlCalls: string[] = [];
  const rows = options.rows ?? [{ meta_waba_id: 'waba-old', phone_number_id: 'phone-old', channel_status: 'connected' }];
  const accounts = (options.accounts ?? []).map(account => ({ channelType: 'whatsapp', ...account }));
  const readable = options.readable ?? {
    'permanent-old-token': ['waba-old', 'waba-new'],
    'temporary-new': ['waba-old', 'waba-new'],
  };
  const prisma = {
    tenant: {
      findUnique: jest.fn(async () => ({ id: 'tenant-1', schemaName: 'tenant_schema' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    channelAccount: {
      count: jest.fn(async () => 1),
      findFirst: jest.fn(async () => null),
      // Honours the filter AND the projection it is given: a query that adds a
      // tenant filter would stop seeing the number another tenant took over,
      // and one that forgets to select `tenantId` would hand the rule rows that
      // look foreign to everybody.
      findMany: jest.fn(async ({ where, select }: any) => accounts.filter(account =>
        (where?.tenantId === undefined || account.tenantId === where.tenantId)
        && (where?.channelType === undefined || account.channelType === where.channelType)
        && (where?.isActive === undefined || account.isActive === where.isActive)
        && (where?.accountId?.in === undefined || where.accountId.in.includes(account.accountId)))
        .map(account => Object.fromEntries(Object.entries(account)
          .filter(([key]) => select === undefined || select[key] === true)))),
      create: jest.fn(async () => ({ id: 'account-new' })),
    },
    whatsappCredential: {
      findFirst: jest.fn(async () => (options.credential === undefined
        ? { id: 'credential-1', encryptedValue: 'encrypted-old', expiresAt: null }
        : options.credential)),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({})),
    },
    executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
      sqlCalls.push(sql);
      if (/^\s*SELECT[\s\S]*FROM whatsapp_channels/.test(sql)) return rows;
      if (sql.includes('INSERT INTO whatsapp_channels')) return [{ id: 'channel-new' }];
      return [];
    }),
  };
  const crypto = {
    decryptToken: jest.fn(() => 'permanent-old-token'),
    encryptToken: jest.fn((token: string) => `encrypted:${token}`),
  };
  const throttle = { enforceChannelAccountLimit: jest.fn(async () => undefined) };
  const service = new WhatsappConnectionService(prisma as any, crypto as any, {} as any, throttle as any);
  const originalFetch = global.fetch;
  const probes: { token: string; wabaId: string }[] = [];
  const signals: unknown[] = [];
  const answer = (scripted: ProbeAnswer) => {
    if ('noResponse' in scripted) {
      throw Object.assign(new Error(scripted.message), {
        name: scripted.noResponse,
        ...(scripted.cause ? { cause: Object.assign(new Error(scripted.cause), { code: scripted.cause }) } : {}),
      });
    }
    return {
      ok: scripted.status >= 200 && scripted.status < 300,
      status: scripted.status,
      json: async () => {
        if (scripted.unreadable) throw new SyntaxError('Unexpected token < in JSON at position 0');
        return scripted.body;
      },
    } as any;
  };
  global.fetch = jest.fn(async (url: string, init?: any) => {
    const wabaId = decodeURIComponent(String(url).split('/').pop()!.split('?')[0]);
    const token = String(init?.headers?.Authorization ?? '').replace(/^Bearer /, '');
    probes.push({ token, wabaId });
    signals.push(init?.signal);
    const scripted = options.answers?.[token]?.[wabaId];
    if (scripted) return answer(scripted);
    const reads = readable[token] ?? [];
    if (reads !== '*' && !reads.includes(wabaId)) return answer(GRAPH_UNSUPPORTED_GET);
    return answer({ status: 200, body: { id: wabaId } });
  }) as any;
  return { service, prisma, crypto, sqlCalls, probes, signals, restore: () => { global.fetch = originalFetch; } };
}

const NEW_CONNECTION = { phoneNumberId: 'phone-new', wabaId: 'waba-new', accessToken: 'temporary-new' };

describe('manual WhatsApp connection credential coverage', () => {
  it('keeps a permanent credential when it covers all existing and new WABAs', async () => {
    const h = setup();
    try {
      await h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION });
    } finally { h.restore(); }

    expect(h.prisma.whatsappCredential.update).not.toHaveBeenCalled();
    expect(h.crypto.encryptToken).toHaveBeenCalledWith('permanent-old-token');
    expect(h.prisma.channelAccount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ wabaId: 'waba-new' }) }),
    }));
  });

  it('fails before channel mutation when replacing the permanent token would reduce coverage', async () => {
    const h = setup({ readable: { 'permanent-old-token': ['waba-old'], 'temporary-new': ['waba-old'] } });
    try {
      await expect(h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION }))
        .rejects.toMatchObject({
          response: expect.objectContaining({ error: 'whatsapp_token_coverage_required' }),
        });
    } finally { h.restore(); }

    expect(h.sqlCalls.some(sql => sql.includes('DELETE FROM whatsapp_channels'))).toBe(false);
    expect(h.prisma.channelAccount.create).not.toHaveBeenCalled();
  });
});

/**
 * ═══ THE RULE, AS ONE TABLE ═══
 *
 * The SAME cases, label for label, as the twin's table in
 * `apps/whatsapp/src/modules/onboarding/onboarding-token-coverage.spec.ts`
 * (`liveCoverageWabaIds (R-S3)`). Change one, change the other.
 *
 * A row is dead only when it says `disconnected`, has a phone number id, and
 * the `channel_accounts` row for that number exists and is either inactive or
 * held by ANOTHER tenant. The table runs twice: against the pure rule, and end
 * to end through `saveConnection`, where what is asserted is which WABAs Meta
 * was actually asked about — so the query, the projection and the rule all
 * have to agree for a case to pass.
 */
const TENANT = 'tenant-1';

const row = (wabaId: string | null, phoneId: string | null, status: string | null): ChannelRow => (
  { meta_waba_id: wabaId, phone_number_id: phoneId, channel_status: status }
);
const acc = (accountId: string, isActive: boolean, tenantId = TENANT): CoverageAccountRow => (
  { tenantId, accountId, isActive }
);

const LIVE_COVERAGE_CASES: [string, ChannelRow[], CoverageAccountRow[], string[]][] = [
  ['disconnected + own inactive account -> dead',
    [row('w1', 'p1', 'disconnected')], [acc('p1', false)], ['t']],
  ['disconnected + own active account -> required',
    [row('w1', 'p1', 'disconnected')], [acc('p1', true)], ['w1', 't']],
  ['disconnected + no account row (legacy) -> required',
    [row('w1', 'p1', 'disconnected')], [], ['w1', 't']],
  ['disconnected + account for a different number only -> required',
    [row('w1', 'p1', 'disconnected')], [acc('p9', false)], ['w1', 't']],
  ['disconnected + account moved to another tenant, active there -> dead',
    [row('w1', 'p1', 'disconnected')], [acc('p1', true, 'tenant-2')], ['t']],
  ['disconnected + account moved to another tenant, inactive -> dead',
    [row('w1', 'p1', 'disconnected')], [acc('p1', false, 'tenant-2')], ['t']],
  ['connected + own inactive account -> required',
    [row('w1', 'p1', 'connected')], [acc('p1', false)], ['w1', 't']],
  ['connected + account moved to another tenant -> required',
    [row('w1', 'p1', 'connected')], [acc('p1', true, 'tenant-2')], ['w1', 't']],
  ['pending + own inactive account -> required',
    [row('w1', 'p1', 'pending')], [acc('p1', false)], ['w1', 't']],
  ['restricted + own inactive account -> required',
    [row('w1', 'p1', 'restricted')], [acc('p1', false)], ['w1', 't']],
  ['null status + own inactive account -> required',
    [row('w1', 'p1', null)], [acc('p1', false)], ['w1', 't']],
  ['status is trimmed and case-insensitive',
    [row('w1', 'p1', ' DisConnected ')], [acc('p1', false)], ['t']],
  ['disconnected with null phone id -> required',
    [row('w1', null, 'disconnected')], [acc('', false)], ['w1', 't']],
  ['disconnected with blank phone id -> required',
    [row('w1', '   ', 'disconnected')], [acc('', false), acc('   ', false)], ['w1', 't']],
  ['phone id is trimmed before matching its account',
    [row('w1', ' p1 ', 'disconnected')], [acc('p1', false)], ['t']],
  ['null, empty and whitespace WABA ids are skipped',
    [row(null, 'p1', 'connected'), row('', 'p2', 'connected'), row('   ', 'p3', 'connected')], [], ['t']],
  ['one dead and one live number in the same WABA -> required',
    [row('w1', 'p1', 'disconnected'), row('w1', 'p2', 'connected')], [acc('p1', false), acc('p2', true)], ['w1', 't']],
  ['dead row on the target WABA -> target still required',
    [row('t', 'p1', 'disconnected')], [acc('p1', false)], ['t']],
  ['de-duplicated, row WABAs in row order, target last',
    [row('w2', 'p1', 'connected'), row('w1', 'p2', 'connected'), row('w2', 'p3', 'connected')], [], ['w2', 'w1', 't']],
  ['no rows -> only the target',
    [], [], ['t']],
];

describe('liveCoverageWabaIds (R-S3)', () => {
  // Every account row is handed in — not only the ones the service's query
  // would return — so the rule cannot lean on the query having narrowed it.
  it.each(LIVE_COVERAGE_CASES)('%s', (_label, rows, accounts, expected) => {
    expect(liveCoverageWabaIds({ tenantId: TENANT, rows, accounts, targetWabaId: 't' })).toEqual(expected);
  });

  it('asks channel_accounts only about the rows whose status already says disconnected', () => {
    expect(disconnectedCoveragePhoneIds([
      row('w1', 'p1', 'connected'),
      row('w2', 'p2', ' disconnected'),
      row('w3', null, 'disconnected'),
      row('w4', '   ', 'disconnected'),
      row('w5', 'p2', 'Disconnected'),
      row('w6', ' p3 ', 'disconnected'),
    ])).toEqual(['p2', 'p3']);
  });
});

describe('manual connection: the R-S3 table, end to end through saveConnection', () => {
  it.each(LIVE_COVERAGE_CASES)('%s', async (_label, rows, accounts, expected) => {
    const h = setup({ rows, accounts, credential: null, readable: { 'temporary-new': '*' } });
    try {
      await expect(h.service.saveConnection('tenant_schema', TENANT, {
        phoneNumberId: 'phone-target', wabaId: 't', accessToken: 'temporary-new',
      })).resolves.toEqual({ success: true, channelId: 'channel-new' });
    } finally { h.restore(); }

    // The rule answers WHICH WABAs (target last); Meta is asked about the
    // target FIRST and then the rest in that same order — see "probe order"
    // below for why the order is part of the contract.
    const probeOrder = ['t', ...expected.filter(wabaId => wabaId !== 't')];
    expect(h.probes).toEqual(probeOrder.map(wabaId => ({ token: 'temporary-new', wabaId })));
  });
});

/**
 * ═══ A NUMBER NOBODY CAN SEND FROM DOES NOT HOLD THE NEXT ONE HOSTAGE ═══
 *
 * cotes-asociados, 16-sep-2026: a Meta test number was disconnected, and its
 * `whatsapp_channels` row stayed behind (on purpose — history and templates
 * hang off it) with its WABA id. Every later attempt to connect a number from a
 * DIFFERENT business portfolio demanded that the new token read that old WABA,
 * which it never can, and failed six times.
 */
describe('manual connection: coverage is demanded only for WABAs that are still alive', () => {
  // The incident's shape: the stored credential is not permanent (it was saved
  // with an expiry), so the candidate token itself must cover every WABA.
  const expiringCredential = {
    id: 'credential-1', encryptedValue: 'encrypted-old',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), rotationState: 'revoked',
  };
  const deadRow: ChannelRow = { meta_waba_id: 'waba-old', phone_number_id: 'phone-old', channel_status: 'disconnected' };
  const inactiveAccount: AccountRow = { tenantId: 'tenant-1', accountId: 'phone-old', isActive: false };
  const onlyReadsNew = { 'temporary-new': ['waba-new'], 'permanent-old-token': ['waba-old'] };

  it('connects a number from another portfolio when the old row is disconnected AND its account is inactive', async () => {
    const h = setup({ rows: [deadRow], accounts: [inactiveAccount], credential: expiringCredential, readable: onlyReadsNew });
    let result: any;
    try {
      result = await h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION });
    } finally { h.restore(); }

    expect(result).toEqual({ success: true, channelId: 'channel-new' });
    // Nobody asked Meta about the dead WABA at all.
    expect(h.probes.map(probe => probe.wabaId)).toEqual(['waba-new']);
    expect(h.prisma.whatsappCredential.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ encryptedValue: 'encrypted:temporary-new' }),
    }));
  });

  it('reads channel_accounts by channel type and number only — never narrowed to this tenant or to inactive rows', async () => {
    // `channel_accounts` is unique on (channel_type, account_id): the row MOVES
    // to whichever tenant connected the number last. Narrowing to this tenant
    // is exactly how a number another tenant took over looked like "no account
    // row" — legacy, still required — and kept blocking this one.
    const h = setup({ rows: [deadRow, { ...deadRow, phone_number_id: ' phone-older ' }], accounts: [inactiveAccount] });
    try {
      await h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION });
    } finally { h.restore(); }

    expect(h.prisma.channelAccount.findMany).toHaveBeenCalledTimes(1);
    expect(h.prisma.channelAccount.findMany).toHaveBeenCalledWith({
      where: { channelType: 'whatsapp', accountId: { in: ['phone-old', 'phone-older'] } },
      select: { tenantId: true, accountId: true, isActive: true },
    });
  });

  it('does not read channel_accounts at all when no row says disconnected', async () => {
    const h = setup();
    try {
      await h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION });
    } finally { h.restore(); }
    expect(h.prisma.channelAccount.findMany).not.toHaveBeenCalled();
  });

  it('an inactive account of another channel type with the same id proves nothing', async () => {
    const h = setup({
      rows: [deadRow], accounts: [{ ...inactiveAccount, channelType: 'instagram' }],
      credential: expiringCredential, readable: onlyReadsNew,
    });
    try {
      await expect(h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION }))
        .rejects.toMatchObject({
          response: expect.objectContaining({ error: 'whatsapp_token_missing_waba_scope', wabaId: 'waba-old' }),
        });
    } finally { h.restore(); }
    expect(h.sqlCalls.some(sql => sql.includes('DELETE FROM whatsapp_channels'))).toBe(false);
    expect(h.prisma.channelAccount.create).not.toHaveBeenCalled();
  });

  it('replaces a permanent credential with a permanent candidate that covers every LIVE WABA', async () => {
    // A permanent token from another portfolio replacing the old permanent one:
    // the dead WABA is not a reason to refuse it.
    const h = setup({
      rows: [deadRow], accounts: [inactiveAccount],
      credential: { id: 'credential-1', encryptedValue: 'encrypted-old', expiresAt: null },
      readable: onlyReadsNew,
    });
    try {
      await expect(h.service.saveConnection('tenant_schema', 'tenant-1', {
        ...NEW_CONNECTION, tokenType: 'system_user',
      })).resolves.toEqual({ success: true, channelId: 'channel-new' });
    } finally { h.restore(); }
    expect(h.prisma.whatsappCredential.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ encryptedValue: 'encrypted:temporary-new', expiresAt: null }),
    }));
  });

  it('never downgrades a permanent credential that still covers the live WABA, dead WABAs or not', async () => {
    const h = setup({
      rows: [deadRow], accounts: [inactiveAccount],
      credential: { id: 'credential-1', encryptedValue: 'encrypted-old', expiresAt: null },
      readable: { 'temporary-new': ['waba-new'], 'permanent-old-token': ['waba-old', 'waba-new'] },
    });
    try {
      await expect(h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION }))
        .resolves.toEqual({ success: true, channelId: 'channel-new' });
    } finally { h.restore(); }
    expect(h.prisma.whatsappCredential.update).not.toHaveBeenCalled();
    expect(h.crypto.encryptToken).toHaveBeenCalledWith('permanent-old-token');
  });

  it('replaces a permanent credential that only reads the dead WABA — no live number depends on it (P2)', async () => {
    // This was the incident with a permanent credential in the table: the
    // stored token belonged to the test portfolio, could read nothing that is
    // still alive, and "never downgrade" kept it anyway and refused the number.
    const h = setup({
      rows: [deadRow], accounts: [inactiveAccount],
      credential: { id: 'credential-1', encryptedValue: 'encrypted-old', expiresAt: null },
      readable: onlyReadsNew,
    });
    try {
      await expect(h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION }))
        .resolves.toEqual({ success: true, channelId: 'channel-new' });
    } finally { h.restore(); }
    expect(h.prisma.whatsappCredential.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ encryptedValue: 'encrypted:temporary-new', rotationState: 'active' }),
    }));
  });
});

/**
 * ═══ P0-P3: WHICH ERROR, WHICH STORED CREDENTIAL, WHEN TO LET GO ═══
 *
 * The same policy as the Embedded Signup twin
 * (`OnboardingService.resolveCredentialForCoverage`, apps/whatsapp), driven
 * through `saveConnection`:
 *
 *  P0  Meta is asked about the TARGET WABA first. A token that cannot read the
 *      number being connected is refused for THAT, never for an old number the
 *      loop happened to reach first — the two have opposite ways out.
 *  P1  A stored credential the send path refuses (`assessCredential`: any
 *      rotation state other than `active`) is not a credential: it is never
 *      retained and never blocks the candidate.
 *  P2  "Never downgrade" protects the numbers a permanent credential SERVES.
 *      When it cannot cover and nothing but the target is live, it serves
 *      nobody, and the candidate that reads the target replaces it.
 *  P3  The target failure has its own code; the other two are only ever about
 *      another, already-connected number.
 */
const JARGON = /token|waba|embedded signup|credencial|scope/i;

describe('manual connection: probe order (P0) and the target failure (P3)', () => {
  it('asks Meta about the target WABA first, then the other live WABAs in row order', async () => {
    const h = setup({
      rows: [
        { meta_waba_id: 'waba-b', phone_number_id: 'phone-b', channel_status: 'connected' },
        { meta_waba_id: 'waba-a', phone_number_id: 'phone-a', channel_status: 'connected' },
      ],
      credential: null,
      readable: { 'temporary-new': '*' },
    });
    try {
      await h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION });
    } finally { h.restore(); }
    expect(h.probes.map(probe => probe.wabaId)).toEqual(['waba-new', 'waba-b', 'waba-a']);
  });

  it('refuses a candidate that cannot read the target with the target error, not an old-number error', async () => {
    // Before P0 the old WABA was probed first, so a token that could read
    // NEITHER was reported as "another number is in the way" — sending the
    // person to disconnect a number that had nothing to do with it.
    const h = setup({ credential: null, readable: { 'temporary-new': [] } });
    let error: any;
    try {
      error = await h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION })
        .catch((e: unknown) => e);
    } finally { h.restore(); }

    const body = error.getResponse();
    expect(body).toEqual(expect.objectContaining({
      error: 'whatsapp_token_target_not_granted',
      code: 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED',
      wabaId: 'waba-new',
      targetWabaId: 'waba-new',
    }));
    expect(body.message).toBe('Meta no nos dio acceso al número que quieres conectar. Abre otra vez la ventana de Meta, '
      + 'elige la cuenta de negocio donde está ese número y márcalo. Si se repite, escríbenos a soporte.');
    expect(h.probes.map(probe => probe.wabaId)).toEqual(['waba-new']);
    expect(h.sqlCalls.some(sql => sql.includes('DELETE FROM whatsapp_channels'))).toBe(false);
    expect(h.prisma.channelAccount.create).not.toHaveBeenCalled();
  });

  it('refuses a candidate that reads the target but not another live WABA with the other-number error', async () => {
    const h = setup({ credential: null, readable: { 'temporary-new': ['waba-new'] } });
    let error: any;
    try {
      error = await h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION })
        .catch((e: unknown) => e);
    } finally { h.restore(); }

    const body = error.getResponse();
    expect(body).toEqual(expect.objectContaining({
      error: 'whatsapp_token_missing_waba_scope',
      code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
      wabaId: 'waba-old',
      targetWabaId: 'waba-new',
    }));
    expect(body.message).not.toMatch(JARGON);
    expect(body.message).toMatch(/otra cuenta de negocio/i);
    expect(body.message).toMatch(/desconecta/i);
    expect(body.message).toMatch(/soporte/i);
    expect(h.probes.map(probe => probe.wabaId)).toEqual(['waba-new', 'waba-old']);
  });
});

describe('manual connection: a stored credential the send path refuses is not a credential (P1)', () => {
  const permanentIn = (rotationState: string) => (
    { id: 'credential-1', encryptedValue: 'encrypted-old', expiresAt: null, rotationState }
  );

  it.each(['revoked', 'rotating', ' Revoked ', 'suspended'])(
    'rotation_state=%j: never retained, even when it covers every live WABA', async (state) => {
      const h = setup({ credential: permanentIn(state) });
      try {
        await expect(h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION }))
          .resolves.toEqual({ success: true, channelId: 'channel-new' });
      } finally { h.restore(); }

      // Retaining it would keep a credential every send refuses — a number
      // that connects and then cannot say a word.
      expect(h.crypto.encryptToken).not.toHaveBeenCalledWith('permanent-old-token');
      expect(h.probes.some(probe => probe.token === 'permanent-old-token')).toBe(false);
      expect(h.prisma.whatsappCredential.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ encryptedValue: 'encrypted:temporary-new', rotationState: 'active' }),
      }));
    });

  it.each(['revoked', 'rotating'])(
    'rotation_state=%j: never blocks a temporary candidate that covers every live WABA', async (state) => {
      const h = setup({
        credential: permanentIn(state),
        readable: { 'permanent-old-token': [], 'temporary-new': ['waba-old', 'waba-new'] },
      });
      try {
        await expect(h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION }))
          .resolves.toEqual({ success: true, channelId: 'channel-new' });
      } finally { h.restore(); }
      expect(h.prisma.whatsappCredential.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ encryptedValue: 'encrypted:temporary-new', rotationState: 'active' }),
      }));
    });

  it('the candidate replacing it still has to cover every live WABA', async () => {
    const h = setup({
      credential: permanentIn('revoked'),
      readable: { 'permanent-old-token': ['waba-old', 'waba-new'], 'temporary-new': ['waba-new'] },
    });
    try {
      await expect(h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION }))
        .rejects.toMatchObject({
          response: expect.objectContaining({ error: 'whatsapp_token_missing_waba_scope', wabaId: 'waba-old' }),
        });
    } finally { h.restore(); }
    expect(h.prisma.whatsappCredential.update).not.toHaveBeenCalled();
    expect(h.sqlCalls.some(sql => sql.includes('DELETE FROM whatsapp_channels'))).toBe(false);
  });

  it.each([undefined, null, 'active', ' Active '])(
    'rotation_state=%j reads as active (the column default), so a covering permanent credential is retained', async (state) => {
      const h = setup({ credential: { id: 'credential-1', encryptedValue: 'encrypted-old', expiresAt: null, rotationState: state } });
      try {
        await h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION });
      } finally { h.restore(); }
      expect(h.prisma.whatsappCredential.update).not.toHaveBeenCalled();
      expect(h.crypto.encryptToken).toHaveBeenCalledWith('permanent-old-token');
    });
});

describe('manual connection: no-downgrade protects live numbers, not a credential (P2)', () => {
  const permanent = { id: 'credential-1', encryptedValue: 'encrypted-old', expiresAt: null, rotationState: 'active' };
  const onlyTarget: ChannelRow[] = [];

  it.each([
    ['temporary', {}],
    ['permanent', { tokenType: 'system_user' }],
  ])('a %s candidate that reads the target replaces a permanent credential that cannot, when nothing else is live',
    async (_kind, extra) => {
      const h = setup({
        rows: onlyTarget, credential: permanent,
        readable: { 'permanent-old-token': [], 'temporary-new': ['waba-new'] },
      });
      const log = jest.spyOn((h.service as any).logger, 'log').mockImplementation(() => undefined);
      try {
        await expect(h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION, ...extra }))
          .resolves.toEqual({ success: true, channelId: 'channel-new' });
      } finally { h.restore(); }

      expect(h.prisma.whatsappCredential.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ encryptedValue: 'encrypted:temporary-new', rotationState: 'active' }),
      }));
      // One line, naming why — ids only, never a secret.
      const lines = log.mock.calls.map(call => String(call[0]));
      const reason = lines.filter(line => /\[Credential\]/.test(line) && /replac/i.test(line));
      expect(reason).toHaveLength(1);
      expect(reason[0]).toContain('tenant-1');
      expect(reason[0]).toContain('waba-new');
      for (const line of lines) {
        expect(line).not.toMatch(/temporary-new|permanent-old-token|encrypted/);
      }
    });

  it('a candidate that cannot read the target either is refused with the target error', async () => {
    const h = setup({
      rows: onlyTarget, credential: permanent,
      readable: { 'permanent-old-token': [], 'temporary-new': [] },
    });
    try {
      await expect(h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION }))
        .rejects.toMatchObject({
          response: expect.objectContaining({ code: 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED', wabaId: 'waba-new' }),
        });
    } finally { h.restore(); }
    expect(h.prisma.whatsappCredential.update).not.toHaveBeenCalled();
    expect(h.sqlCalls.some(sql => sql.includes('DELETE FROM whatsapp_channels'))).toBe(false);
  });

  it('keeps the refusal while another live number depends on the stored permanent credential', async () => {
    const h = setup({
      credential: permanent,
      readable: { 'permanent-old-token': ['waba-old'], 'temporary-new': ['waba-new'] },
    });
    let error: any;
    try {
      error = await h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION })
        .catch((e: unknown) => e);
    } finally { h.restore(); }

    const body = error.getResponse();
    expect(body).toEqual(expect.objectContaining({
      error: 'whatsapp_token_coverage_required',
      code: 'WHATSAPP_TOKEN_COVERAGE_REQUIRED',
    }));
    expect(body.message).not.toMatch(JARGON);
    expect(body.message).toMatch(/otra cuenta de negocio/i);
    expect(body.message).toMatch(/desconecta/i);
    expect(body.message).toMatch(/soporte/i);
    expect(h.prisma.whatsappCredential.update).not.toHaveBeenCalled();
    expect(h.sqlCalls.some(sql => sql.includes('DELETE FROM whatsapp_channels'))).toBe(false);
  });

  it('re-onboarding a live number with a temporary candidate still retains the covering permanent credential', async () => {
    const h = setup({
      rows: [{ meta_waba_id: 'waba-new', phone_number_id: 'phone-new', channel_status: 'connected' }],
      credential: permanent,
      readable: { 'permanent-old-token': ['waba-new'], 'temporary-new': ['waba-new'] },
    });
    try {
      await expect(h.service.saveConnection('tenant_schema', 'tenant-1', { ...NEW_CONNECTION }))
        .resolves.toEqual({ success: true, channelId: 'channel-new' });
    } finally { h.restore(); }
    expect(h.prisma.whatsappCredential.update).not.toHaveBeenCalled();
    expect(h.crypto.encryptToken).toHaveBeenCalledWith('permanent-old-token');
  });
});

/**
 * ═══ RULE T: A META BLIP IS NOT A DENIAL ═══
 *
 * After P2, a stored permanent credential that failed its probe for ANY reason
 * read as "does not cover": with only the target live, a timeout, a 5xx or a
 * rate limit on that one read fell through and replaced a permanent credential
 * that actually covered with a temporary candidate — a downgrade caused by
 * Meta having a bad minute. Before P2 the same blip refused and wrote nothing.
 *
 * A probe now proves one of three things:
 *   covers     Meta answered 2xx about the WABA that was asked for.
 *   denied     Meta answered and refused: a 4xx other than 429 carrying a Graph
 *              error that is not a throttle, or a 2xx about another object.
 *   transient  anything else — no answer, a 5xx, a 429, a Graph throttling
 *              code, a body nobody can read, a 4xx that is not Meta's.
 *
 * Only `denied` may decide anything. `transient`, on the stored credential or
 * on the candidate, refuses with a 503 that says "try again" and writes
 * nothing — never P2's replacement, never a coverage refusal that sends the
 * person to Meta's window or to disconnect a number for a blip.
 *
 * The same table as the Embedded Signup twin
 * (`apps/whatsapp/src/modules/onboarding/onboarding-token-coverage.spec.ts`).
 */
const COVERAGE_CHECK_UNAVAILABLE_MESSAGE = 'No pudimos confirmar el acceso con Meta en este momento. '
  + 'Intenta de nuevo en unos minutos.';

const graphError = (status: number, code: number, extra: Record<string, unknown> = {}): ProbeAnswer => (
  { status, body: { error: { message: `Graph error ${code}`, type: 'OAuthException', code, ...extra } } }
);

const TRANSIENT_ANSWERS: [string, ProbeAnswer][] = [
  ['no response: timeout', { noResponse: 'TimeoutError', message: 'The operation was aborted due to timeout' }],
  ['no response: aborted', { noResponse: 'AbortError', message: 'This operation was aborted' }],
  ['no response: DNS failure', { noResponse: 'TypeError', message: 'fetch failed', cause: 'ENOTFOUND' }],
  ['no response: connection reset', { noResponse: 'TypeError', message: 'fetch failed', cause: 'ECONNRESET' }],
  ['HTTP 500 carrying a Graph error', graphError(500, 1)],
  ['HTTP 502 from an edge, not JSON', { status: 502, unreadable: true }],
  ['HTTP 503', { status: 503, body: { error: { code: 2, message: 'Service temporarily unavailable' } } }],
  ['HTTP 429', graphError(429, 80007)],
  ['HTTP 429 with no readable body', { status: 429, unreadable: true }],
  ['HTTP 400, Graph code 4 (application request limit)', graphError(400, 4)],
  ['HTTP 400, Graph code 17 (user request limit)', graphError(400, 17)],
  ['HTTP 403, Graph code 32 (page request limit)', graphError(403, 32)],
  ['HTTP 400, Graph code 613 (rate limit)', graphError(400, 613)],
  ['HTTP 400, Graph code 80007 (rate limit)', graphError(400, 80007)],
  ['HTTP 400, Graph code 80008 (WhatsApp Business Management rate limit)', graphError(400, 80008)],
  ['HTTP 400, Graph error flagged is_transient', graphError(400, 1, { is_transient: true })],
  ['HTTP 200 whose body cannot be read', { status: 200, unreadable: true }],
  ['HTTP 403 that is not Meta (no Graph error)', { status: 403, unreadable: true }],
];

const DENIED_ANSWERS: [string, ProbeAnswer][] = [
  ['HTTP 400, unsupported get request (100/33)', GRAPH_UNSUPPORTED_GET],
  ['HTTP 403, permission denied (code 200)', graphError(403, 200)],
  ['HTTP 400, permission denied (code 10)', graphError(400, 10)],
  ['HTTP 400, OAuthException (code 190)', graphError(400, 190, { error_subcode: 463 })],
  ['HTTP 404, not found (code 803)', graphError(404, 803)],
  ['HTTP 200 about another object', { status: 200, body: { id: 'waba-someone-else' } }],
];

const graph = (code: number | string, extra: Record<string, unknown> = {}) => ({ error: { message: 'm', code, ...extra } });

const PROBE_CASES: [string, CoverageProbeAnswer, CoverageProbeResult][] = [
  ['no answer at all', { status: null }, 'transient'],
  ['200 about the WABA asked for', { status: 200, body: { id: 'w' } }, 'covers'],
  ['200 about another object', { status: 200, body: { id: 'x' } }, 'denied'],
  ['200 with no id', { status: 200, body: {} }, 'denied'],
  ['200 whose body cannot be read', { status: 200, body: undefined }, 'transient'],
  ['200 carrying a throttle', { status: 200, body: graph(4) }, 'transient'],
  ['200 carrying a refusal', { status: 200, body: graph(100) }, 'denied'],
  ['400 unsupported get request (100/33)', { status: 400, body: graph(100, { error_subcode: 33 }) }, 'denied'],
  ['401 OAuthException (190)', { status: 401, body: graph(190, { type: 'OAuthException' }) }, 'denied'],
  ['403 permission denied (10)', { status: 403, body: graph(10) }, 'denied'],
  ['403 permission denied (200)', { status: 403, body: graph(200) }, 'denied'],
  ['404 not found (803)', { status: 404, body: graph(803) }, 'denied'],
  ['400 application request limit (4)', { status: 400, body: graph(4) }, 'transient'],
  ['400 user request limit (17)', { status: 400, body: graph(17) }, 'transient'],
  ['403 page request limit (32)', { status: 403, body: graph(32) }, 'transient'],
  ['400 rate limit (613)', { status: 400, body: graph(613) }, 'transient'],
  ['400 rate limit (80007) as a string code', { status: 400, body: graph('80007') }, 'transient'],
  ['400 throughput reached (130429)', { status: 400, body: graph(130429) }, 'transient'],
  // GET /{waba-id} is a WhatsApp Business Management read: Meta's rate-limit
  // table gives that API's Business Use Case throttle as 80008, answered as a
  // plain 400 OAuthException with no `is_transient`. The whole 80000-80014
  // Business Use Case range is a throttle, exactly as the apps/whatsapp twin
  // (`isMetaRateLimit`) reads it — two copies disagreeing on a blip is how one
  // connect path downgrades what the other refuses to touch.
  ['400 WhatsApp Business Management throttle (80008), no is_transient', { status: 400, body: graph(80008, { type: 'OAuthException' }) }, 'transient'],
  ['400 Business Use Case throttle, lower bound (80000)', { status: 400, body: graph(80000) }, 'transient'],
  ['400 Business Use Case throttle (80004)', { status: 400, body: graph(80004) }, 'transient'],
  ['400 Business Use Case throttle, upper bound (80014)', { status: 400, body: graph(80014) }, 'transient'],
  ['400 code just outside the Business Use Case range (80015)', { status: 400, body: graph(80015) }, 'denied'],
  ['400 temporary downtime, unknown (1), no is_transient', { status: 400, body: graph(1) }, 'transient'],
  ['400 temporary downtime (2)', { status: 400, body: graph(2) }, 'transient'],
  ['400 flagged is_transient', { status: 400, body: graph(1, { is_transient: true }) }, 'transient'],
  ['400 with a JSON body but no Graph error', { status: 400, body: { id: 'w' } }, 'transient'],
  ['400 whose body cannot be read', { status: 400, body: undefined }, 'transient'],
  ['429 whatever the body says', { status: 429, body: graph(100) }, 'transient'],
  ['500 whatever the body says', { status: 500, body: graph(100) }, 'transient'],
  ['503 with no body', { status: 503, body: undefined }, 'transient'],
  ['302 carrying a Graph error', { status: 302, body: graph(100) }, 'transient'],
];

describe('classifyCoverageProbe (rule T)', () => {
  it.each(PROBE_CASES)('%s -> %s', (_label, answer, expected) => {
    expect(classifyCoverageProbe(answer, 'w')).toBe(expected);
  });

  // The end-to-end tables below script Meta through the service; this keeps
  // them honest about which side of the rule each answer is on.
  it.each([
    ...TRANSIENT_ANSWERS.map(([label, answer]) => [label, answer, 'transient'] as const),
    ...DENIED_ANSWERS.map(([label, answer]) => [label, answer, 'denied'] as const),
  ])('end-to-end answer "%s" really is %s', (_label, answer, expected) => {
    const read: CoverageProbeAnswer = 'noResponse' in answer
      ? { status: null }
      : { status: answer.status, body: answer.unreadable ? undefined : answer.body };
    expect(classifyCoverageProbe(read, 'waba-new')).toBe(expected);
  });
});

describe('manual connection: a Meta blip is never a denial (rule T)', () => {
  const permanent = { id: 'credential-1', encryptedValue: 'encrypted-old', expiresAt: null, rotationState: 'active' };

  const outcomeOf = async (h: ReturnType<typeof setup>, data: Record<string, unknown> = NEW_CONNECTION) => {
    try {
      return await h.service.saveConnection('tenant_schema', 'tenant-1', { ...data }).catch((e: unknown) => e);
    } finally { h.restore(); }
  };
  const statusOf = (outcome: any) => (typeof outcome?.getStatus === 'function' ? outcome.getStatus() : outcome);

  const expectRetryable = (outcome: any) => {
    expect(statusOf(outcome)).toBe(503);
    expect(outcome.getResponse()).toEqual(expect.objectContaining({
      error: 'whatsapp_coverage_check_unavailable',
      code: 'WHATSAPP_COVERAGE_CHECK_UNAVAILABLE',
      message: COVERAGE_CHECK_UNAVAILABLE_MESSAGE,
      targetWabaId: 'waba-new',
    }));
  };

  // Nothing about the tenant moved: no credential written or re-encrypted, no
  // channel row replaced, no routing account touched.
  const expectNothingWritten = (h: ReturnType<typeof setup>) => {
    expect(h.prisma.whatsappCredential.update).not.toHaveBeenCalled();
    expect(h.prisma.whatsappCredential.create).not.toHaveBeenCalled();
    expect(h.crypto.encryptToken).not.toHaveBeenCalled();
    expect(h.sqlCalls.some(sql => /DELETE FROM whatsapp_channels|INSERT INTO whatsapp_channels/.test(sql))).toBe(false);
    expect(h.prisma.channelAccount.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.channelAccount.create).not.toHaveBeenCalled();
    expect(h.prisma.tenant.updateMany).not.toHaveBeenCalled();
  };

  describe('the stored permanent credential', () => {
    it.each(TRANSIENT_ANSWERS)(
      'covers the only live WABA, its probe meets %s -> 503, nothing written, the candidate never asked',
      async (_label, answer) => {
        const h = setup({
          rows: [], credential: permanent,
          readable: { 'permanent-old-token': ['waba-new'], 'temporary-new': ['waba-new'] },
          answers: { 'permanent-old-token': { 'waba-new': answer } },
        });
        const outcome = await outcomeOf(h);

        expectRetryable(outcome);
        expect(h.probes).toEqual([{ token: 'permanent-old-token', wabaId: 'waba-new' }]);
        expectNothingWritten(h);
      });

    it.each(TRANSIENT_ANSWERS)(
      'reads the target, another live WABA meets %s -> 503, not a coverage refusal, nothing written',
      async (_label, answer) => {
        const h = setup({
          credential: permanent,
          readable: { 'permanent-old-token': ['waba-old', 'waba-new'], 'temporary-new': ['waba-new'] },
          answers: { 'permanent-old-token': { 'waba-old': answer } },
        });
        const outcome = await outcomeOf(h);

        expectRetryable(outcome);
        expect(h.probes).toEqual([
          { token: 'permanent-old-token', wabaId: 'waba-new' },
          { token: 'permanent-old-token', wabaId: 'waba-old' },
        ]);
        expectNothingWritten(h);
      });

    it.each(DENIED_ANSWERS)(
      'cannot read the only live WABA (%s) -> P2 still replaces it with the candidate',
      async (_label, answer) => {
        const h = setup({
          rows: [], credential: permanent,
          readable: { 'permanent-old-token': ['waba-new'], 'temporary-new': ['waba-new'] },
          answers: { 'permanent-old-token': { 'waba-new': answer } },
        });
        const outcome = await outcomeOf(h);

        expect(outcome).toEqual({ success: true, channelId: 'channel-new' });
        expect(h.probes).toEqual([
          { token: 'permanent-old-token', wabaId: 'waba-new' },
          { token: 'temporary-new', wabaId: 'waba-new' },
        ]);
        expect(h.prisma.whatsappCredential.update).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ encryptedValue: 'encrypted:temporary-new', rotationState: 'active' }),
        }));
      });

    it.each(DENIED_ANSWERS)(
      'cannot read another live WABA (%s) -> the coverage refusal is unchanged',
      async (_label, answer) => {
        const h = setup({
          credential: permanent,
          readable: { 'permanent-old-token': ['waba-old', 'waba-new'], 'temporary-new': ['waba-new'] },
          answers: { 'permanent-old-token': { 'waba-old': answer } },
        });
        const outcome: any = await outcomeOf(h);

        expect(statusOf(outcome)).toBe(400);
        expect(outcome.getResponse()).toEqual(expect.objectContaining({ code: 'WHATSAPP_TOKEN_COVERAGE_REQUIRED' }));
        expect(h.prisma.whatsappCredential.update).not.toHaveBeenCalled();
      });
  });

  describe('the candidate', () => {
    it.each(TRANSIENT_ANSWERS)(
      'its probe of the target meets %s -> 503, never TARGET_NOT_GRANTED, nothing written',
      async (_label, answer) => {
        const h = setup({
          credential: null,
          readable: { 'temporary-new': ['waba-old', 'waba-new'] },
          answers: { 'temporary-new': { 'waba-new': answer } },
        });
        const outcome = await outcomeOf(h);

        expectRetryable(outcome);
        expect(h.probes).toEqual([{ token: 'temporary-new', wabaId: 'waba-new' }]);
        expectNothingWritten(h);
      });

    it.each(TRANSIENT_ANSWERS)(
      'replacing a stored credential under P2, its probe of the target meets %s -> 503, nothing written',
      async (_label, answer) => {
        const h = setup({
          rows: [], credential: permanent,
          readable: { 'permanent-old-token': [], 'temporary-new': ['waba-new'] },
          answers: { 'temporary-new': { 'waba-new': answer } },
        });
        const outcome = await outcomeOf(h);

        expectRetryable(outcome);
        expect(h.probes).toEqual([
          { token: 'permanent-old-token', wabaId: 'waba-new' },
          { token: 'temporary-new', wabaId: 'waba-new' },
        ]);
        expectNothingWritten(h);
      });

    it.each(TRANSIENT_ANSWERS)(
      'reads the target, another live WABA meets %s -> 503, never MISSING_WABA_SCOPE, nothing written',
      async (_label, answer) => {
        const h = setup({
          credential: null,
          readable: { 'temporary-new': ['waba-old', 'waba-new'] },
          answers: { 'temporary-new': { 'waba-old': answer } },
        });
        const outcome = await outcomeOf(h);

        expectRetryable(outcome);
        expect(h.probes).toEqual([
          { token: 'temporary-new', wabaId: 'waba-new' },
          { token: 'temporary-new', wabaId: 'waba-old' },
        ]);
        expectNothingWritten(h);
      });

    it.each(DENIED_ANSWERS)(
      'Meta refuses the target (%s) -> TARGET_NOT_GRANTED, unchanged',
      async (_label, answer) => {
        const h = setup({
          credential: null,
          readable: { 'temporary-new': ['waba-old', 'waba-new'] },
          answers: { 'temporary-new': { 'waba-new': answer } },
        });
        const outcome: any = await outcomeOf(h);

        expect(statusOf(outcome)).toBe(400);
        expect(outcome.getResponse()).toEqual(expect.objectContaining({
          error: 'whatsapp_token_target_not_granted',
          code: 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED',
          wabaId: 'waba-new',
          targetWabaId: 'waba-new',
        }));
        expect(h.probes).toEqual([{ token: 'temporary-new', wabaId: 'waba-new' }]);
      });

    it.each(DENIED_ANSWERS)(
      'Meta refuses another live WABA (%s) -> MISSING_WABA_SCOPE, unchanged',
      async (_label, answer) => {
        const h = setup({
          credential: null,
          readable: { 'temporary-new': ['waba-old', 'waba-new'] },
          answers: { 'temporary-new': { 'waba-old': answer } },
        });
        const outcome: any = await outcomeOf(h);

        expect(statusOf(outcome)).toBe(400);
        expect(outcome.getResponse()).toEqual(expect.objectContaining({
          code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE', wabaId: 'waba-old',
        }));
      });
  });

  it('says "try again" without jargon, bounds every read with a timeout, and never logs a secret', async () => {
    const h = setup({
      rows: [], credential: permanent,
      readable: { 'permanent-old-token': ['waba-new'], 'temporary-new': ['waba-new'] },
      answers: { 'permanent-old-token': { 'waba-new': graphError(429, 80007) } },
    });
    const logger = (h.service as any).logger;
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error']) {
      jest.spyOn(logger, level).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
    }
    const outcome: any = await outcomeOf(h);

    expect(statusOf(outcome)).toBe(503);
    expect(outcome.getResponse().message).not.toMatch(JARGON);
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0]).toBeInstanceOf(AbortSignal);
    // One line an operator can act on: which WABA, and what Meta did.
    expect(lines.some(line => line.includes('waba-new') && line.includes('429'))).toBe(true);
    for (const line of lines) {
      expect(line).not.toMatch(/temporary-new|permanent-old-token|encrypted/);
    }
  });
});
