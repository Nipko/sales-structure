import * as fs from 'fs';
import * as path from 'path';
import { throwError } from 'rxjs';
import { OnboardingErrorCode, isServerResumableFailure } from '../../common/enums/onboarding-error.enum';
import { MetaApiError, MetaGraphService } from '../meta-graph/meta-graph.service';
import { OnboardingService } from './onboarding.service';
import {
  CoverageChannelAccount,
  CoverageChannelRow,
  disconnectedCoveragePhoneIds,
  liveCoverageWabaIds,
} from './live-coverage-wabas';

type ChannelRow = { meta_waba_id: string | null; channel_status?: string | null; phone_number_id?: string | null };
type AccountRow = { tenantId: string; channelType: string; accountId: string; isActive: boolean };

/** Words a person connecting a number should never have to decode. */
const JARGON = /token|waba|embedded signup|credencial|scope/i;

/** The exact words for a number Meta did not let us reach: a new Meta window IS the way out. */
const TARGET_NOT_GRANTED_MESSAGE = 'Meta no nos dio acceso al número que quieres conectar. Abre otra vez la ventana de Meta, elige la cuenta de negocio donde está ese número y márcalo. Si se repite, escríbenos a soporte.';

/**
 * How a coverage probe fails, as Meta and the network really produce it.
 *
 * The first three are REFUSALS: Meta answered and said no. The rest are blips:
 * nobody answered, Meta broke, or Meta is throttling — none of them says
 * anything about what the token can read. `asset_mismatch` is a 200 that
 * returned another WABA.
 */
type ProbeFailure =
  | 'permission_denied'
  | 'unsupported_get'
  | 'oauth_invalid'
  | 'asset_mismatch'
  | 'timeout'
  | 'connection_reset'
  | 'http_500'
  | 'http_503'
  | 'http_429'
  | 'throttled_4'
  | 'throttled_80007';

const REFUSALS: ProbeFailure[] = ['permission_denied', 'unsupported_get', 'oauth_invalid', 'asset_mismatch'];

/** What axios throws for each failure: the raw input to the REAL error mapping. */
const RAW_META_FAILURES: Record<Exclude<ProbeFailure, 'asset_mismatch'>, Record<string, unknown>> = {
  permission_denied: {
    message: 'Request failed with status code 403',
    response: { status: 403, data: { error: { message: '(#200) Permissions error', type: 'OAuthException', code: 200 } } },
  },
  unsupported_get: {
    message: 'Request failed with status code 400',
    response: {
      status: 400,
      data: {
        error: {
          message: "Unsupported get request. Object with ID 'waba' does not exist, cannot be loaded due to missing permissions, or does not support this operation.",
          type: 'GraphMethodException',
          code: 100,
          error_subcode: 33,
        },
      },
    },
  },
  oauth_invalid: {
    message: 'Request failed with status code 401',
    response: { status: 401, data: { error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } } },
  },
  timeout: { message: 'timeout of 10000ms exceeded', code: 'ECONNABORTED' },
  connection_reset: { message: 'socket hang up', code: 'ECONNRESET' },
  http_500: {
    message: 'Request failed with status code 500',
    response: { status: 500, data: { error: { message: 'An unknown error occurred', type: 'OAuthException', code: 1, is_transient: true } } },
  },
  http_503: { message: 'Request failed with status code 503', response: { status: 503, data: 'Service Unavailable' } },
  http_429: { message: 'Request failed with status code 429', response: { status: 429, data: {} } },
  throttled_4: {
    message: 'Request failed with status code 400',
    response: { status: 400, data: { error: { message: '(#4) Application request limit reached', type: 'OAuthException', code: 4, is_transient: true } } },
  },
  // A 4xx Graph error of type OAuthException: exactly what a permission refusal
  // looks like, except for the throttling code.
  throttled_80007: {
    message: 'Request failed with status code 400',
    response: { status: 400, data: { error: { message: '(#80007) There have been too many calls to this WhatsApp Business account.', type: 'OAuthException', code: 80007 } } },
  },
};

/**
 * The error `getWabaDirectly` throws for `failure`, produced by the REAL
 * `MetaGraphService` (retries and error mapping included) over an HTTP double
 * that fails the way axios does. A double that invented its own error shape
 * would agree with whatever the classifier expects.
 */
async function metaGraphFailure(failure: Exclude<ProbeFailure, 'asset_mismatch'>): Promise<unknown> {
  const raw = RAW_META_FAILURES[failure];
  const httpService = { get: jest.fn(() => throwError(() => Object.assign(new Error(String(raw.message)), raw))) };
  const config = { get: jest.fn((key: string) => ({ 'meta.maxRetries': 3, 'meta.retryDelay': 1 } as Record<string, number>)[key]) };
  const graph = new MetaGraphService(httpService as any, config as any);
  return graph.getWabaDirectly('probed-waba', 'probe-credential').catch((error: unknown) => error);
}

function harness(options: {
  existingExpiresAt: Date | null;
  /**
   * `rotation_state` of the stored credential. Left out, the row has no such
   * field, which is how every test written before the column mattered reads.
   */
  rotationState?: string | null;
  /** WABA no token can read. */
  denied?: string;
  /** WABAs a SPECIFIC token cannot read, keyed by token. */
  deniedFor?: Record<string, string[]>;
  /** Any other way a probe fails, keyed by token and then WABA. */
  failFor?: Record<string, Record<string, ProbeFailure>>;
  rows?: ChannelRow[];
  accounts?: AccountRow[];
}) {
  const accounts = options.accounts ?? [];
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ schemaName: 'tenant_schema' })) },
    executeInTenantSchema: jest.fn(async () => options.rows ?? [{ meta_waba_id: 'waba-old' }]),
    whatsappCredential: {
      findFirst: jest.fn(async () => ({
        encryptedValue: 'encrypted-existing',
        expiresAt: options.existingExpiresAt,
        ...('rotationState' in options ? { rotationState: options.rotationState } : {}),
      })),
    },
    // Honest double of the public table: applies whatever equality / `in`
    // filter the service asks for AND projects its `select`, so the test bakes
    // in neither a query shape nor the columns the rule needs — a query that
    // filters by tenant, or forgets to select `tenantId`/`isActive`, answers
    // differently here exactly as it would in PostgreSQL.
    channelAccount: {
      findMany: jest.fn(async ({ where, select }: any) => accounts
        .filter(account => Object.entries(where || {})
          .every(([key, expected]: [string, any]) => (
            expected && typeof expected === 'object' && Array.isArray(expected.in)
              ? expected.in.includes((account as any)[key])
              : (account as any)[key] === expected
          )))
        .map(account => (select
          ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, (account as any)[key]]))
          : account))),
    },
  };
  const metaGraph = {
    getWabaDirectly: jest.fn(async (wabaId: string, token: string) => {
      const failure: ProbeFailure | undefined = wabaId === options.denied || options.deniedFor?.[token]?.includes(wabaId)
        ? 'permission_denied'
        : options.failFor?.[token]?.[wabaId];
      if (failure === 'asset_mismatch') return { id: 'another-waba', token };
      if (failure) throw await metaGraphFailure(failure);
      return { id: wabaId, token };
    }),
  };
  const service = new OnboardingService(prisma as any, metaGraph as any, {} as any, {} as any);
  const decrypt = jest.spyOn(service as any, 'decryptToken').mockReturnValue('permanent-existing');
  const logs = jest.spyOn((service as any).logger, 'log');
  const warnings = jest.spyOn((service as any).logger, 'warn');
  const probes = () => metaGraph.getWabaDirectly.mock.calls.map(([wabaId, token]: any[]) => [wabaId, token]);
  return { service, metaGraph, prisma, decrypt, logs, warnings, probes };
}

describe('Embedded Signup tenant-wide token coverage', () => {
  it('retains an existing permanent token when it covers the new WABA', async () => {
    const { service, metaGraph } = harness({ existingExpiresAt: null });
    const result = await (service as any).resolveCredentialForCoverage(
      'tenant-1', 'waba-new', 'temporary-candidate', 5_184_000,
    );

    // `minted: false` is the load-bearing half: this token came OUT OF THE
    // TABLE, so the flow knows nothing about whose portfolio it is and must
    // not stamp provenance on it.
    expect(result).toEqual({ accessToken: 'permanent-existing', expiresInSeconds: 0, minted: false });
    expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-old', 'permanent-existing');
    expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-new', 'permanent-existing');
  });

  it('fails closed instead of degrading a permanent token that lacks new-WABA coverage', async () => {
    const { service } = harness({ existingExpiresAt: null, denied: 'waba-new' });
    const error: any = await (service as any).resolveCredentialForCoverage(
      'tenant-1', 'waba-new', 'temporary-candidate', 5_184_000,
    ).catch((e: unknown) => e);

    expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'WHATSAPP_TOKEN_COVERAGE_REQUIRED' }));
    // A new Meta window cannot fix this (the response is not relaunchable), so
    // the message has to name the real situation and the two ways out.
    const message: string = error.getResponse().userMessage;
    expect(message).not.toMatch(JARGON);
    expect(message).toMatch(/otra cuenta de negocio/i);
    expect(message).toMatch(/desconecta/i);
    expect(message).toMatch(/soporte/i);
    expect(message).not.toMatch(/reintenta|intenta de nuevo/i);
  });

  it('validates a newly generated permanent token against old and new WABAs', async () => {
    const { service, metaGraph } = harness({ existingExpiresAt: new Date() });
    const result = await (service as any).resolveCredentialForCoverage(
      'tenant-1', 'waba-new', 'new-system-token', 0,
    );
    // Obtained by this flow, so provenance may be recorded against it.
    expect(result).toEqual({ accessToken: 'new-system-token', expiresInSeconds: 0, minted: true });
    expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-old', 'new-system-token');
    expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-new', 'new-system-token');
  });

  // ── A permanent CANDIDATE that fails coverage ─────────────────────────────
  //
  // Desde que `classifyEmbeddedSignupToken` reconoce el token que no vence, el
  // candidato permanente es lo común, no la excepción. Antes de la ronda 1 ese
  // intento caía en la rama de "conservar el permanente que ya cubre todo"; con
  // la rama del candidato permanente lanzando sin mirar el existente, un
  // tenant que ya enviaba bien quedaba con la conexión rechazada.
  describe('permanent candidate that does not cover every WABA', () => {
    it('keeps the existing permanent token when IT covers every required WABA', async () => {
      const { service, metaGraph } = harness({
        existingExpiresAt: null,
        deniedFor: { 'new-system-token': ['waba-old'] },
      });

      const result = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-system-token', 0);

      expect(result).toEqual({ accessToken: 'permanent-existing', expiresInSeconds: 0, minted: false });
      expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-old', 'permanent-existing');
      expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-new', 'permanent-existing');
    });

    it('rethrows the CANDIDATE conflict when the existing permanent token does not cover either', async () => {
      const { service } = harness({
        existingExpiresAt: null,
        deniedFor: { 'new-system-token': ['waba-new'], 'permanent-existing': ['waba-old'] },
      });

      const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-system-token', 0)
        .catch((e: unknown) => e);

      // `waba-new` is where the candidate failed; `waba-old` is where the
      // existing token failed. The person is told about the attempt they made
      // — and that attempt did not reach the number being connected.
      expect(error.getResponse()).toEqual(expect.objectContaining({
        code: 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED',
        wabaId: 'waba-new',
      }));
    });

    it('rethrows the candidate conflict without reading an existing token that expires', async () => {
      const { service, decrypt } = harness({
        existingExpiresAt: new Date(),
        deniedFor: { 'new-system-token': ['waba-old'] },
      });

      const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-system-token', 0)
        .catch((e: unknown) => e);

      expect(error.getResponse()).toEqual(expect.objectContaining({
        code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
        wabaId: 'waba-old',
      }));
      expect(decrypt).not.toHaveBeenCalled();
    });

    it('rethrows the candidate conflict when the existing permanent token cannot be decrypted', async () => {
      const { service, decrypt } = harness({
        existingExpiresAt: null,
        deniedFor: { 'new-system-token': ['waba-old'] },
      });
      decrypt.mockImplementation(() => { throw new Error('bad auth tag'); });

      const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-system-token', 0)
        .catch((e: unknown) => e);

      expect(error.getResponse()).toEqual(expect.objectContaining({
        code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
        wabaId: 'waba-old',
      }));
    });
  });

  it.each([
    ['an older connected number', 'waba-old', 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE', /otra cuenta de negocio/i],
    ['the number being connected', 'waba-new', 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED', /número que quieres conectar/i],
  ])('explains a missing permission on %s without jargon', async (_label, deniedWaba, code, expected) => {
    const { service } = harness({ existingExpiresAt: new Date(), denied: deniedWaba });

    const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000)
      .catch((e: unknown) => e);

    const body = error.getResponse();
    expect(body.code).toBe(code);
    expect(body.wabaId).toBe(deniedWaba);
    expect(body.userMessage).not.toMatch(JARGON);
    expect(body.userMessage).toMatch(expected);
    expect(body.userMessage).toMatch(/soporte/i);
  });

  // ── Which WABA a failing token is blamed on (P0 + P3) ─────────────────────
  //
  // `requiredWabas` lists the old numbers first and the target last, and the
  // probe walked it in that order. A token that could not read the number
  // being connected was therefore reported against whichever old WABA came
  // first — "pertenece a otra cuenta de negocio, desconecta el otro número" —
  // when the real problem was that the person did not tick THIS number in the
  // Meta window, which a new Meta window fixes. The target is probed first, and
  // its failure has its own code.
  describe('probe order and the target failure', () => {
    it.each([
      ['a temporary candidate', 5_184_000],
      ['a permanent candidate', 0],
    ])('blames the TARGET when %s cannot read it, even with an old live WABA it can read', async (_label, expiresIn) => {
      const { service, probes } = harness({
        existingExpiresAt: new Date(),
        deniedFor: { 'new-token': ['waba-new'] },
      });

      const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', expiresIn)
        .catch((e: unknown) => e);

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual({
        code: 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED',
        userMessage: TARGET_NOT_GRANTED_MESSAGE,
        wabaId: 'waba-new',
        targetWabaId: 'waba-new',
      });
      expect(error.getResponse().userMessage).not.toMatch(JARGON);
      // Target first; the old WABA it could read was never the one to blame.
      expect(probes()[0]).toEqual(['waba-new', 'new-token']);
      expect(probes()).not.toContainEqual(['waba-old', 'new-token']);
    });

    it('blames the OLD WABA only when the candidate reads the target and not the old one', async () => {
      const { service, probes } = harness({
        existingExpiresAt: new Date(),
        deniedFor: { 'new-token': ['waba-old'] },
      });

      const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000)
        .catch((e: unknown) => e);

      expect(error.getStatus()).toBe(409);
      const body = error.getResponse();
      expect(body).toEqual(expect.objectContaining({ code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE', wabaId: 'waba-old' }));
      expect(body.userMessage).toMatch(/otra cuenta de negocio/i);
      expect(body.userMessage).toMatch(/desconecta/i);
      expect(body.userMessage).not.toMatch(/ventana de Meta/i);
      expect(probes()).toEqual([['waba-new', 'new-token'], ['waba-old', 'new-token']]);
    });

    it('probes the remaining WABAs in row order after the target', async () => {
      const { service, probes } = harness({
        existingExpiresAt: new Date(),
        rows: [
          { meta_waba_id: 'waba-b', channel_status: 'connected', phone_number_id: 'p-b' },
          { meta_waba_id: 'waba-new', channel_status: 'connected', phone_number_id: 'p-new' },
          { meta_waba_id: 'waba-a', channel_status: 'connected', phone_number_id: 'p-a' },
        ],
      });

      await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(probes()).toEqual([['waba-new', 'new-token'], ['waba-b', 'new-token'], ['waba-a', 'new-token']]);
    });
  });

  // ── A stored credential the send path refuses (P1) ────────────────────────
  //
  // `assessCredential` (apps/api/src/modules/channels/connection-usability.ts)
  // refuses every rotation state but `active`, after trim + lower-case, and
  // reads a missing one as `active`. The retain rule here did not look at the
  // state at all: a REVOKED permanent token that still read every WABA was
  // "retained", and storing it back wrote `rotation_state='active'` on it —
  // reactivating a token someone revoked on purpose. And one that did not
  // cover blocked a perfectly good new authorization with COVERAGE_REQUIRED.
  describe('a stored credential the send path refuses', () => {
    const REFUSED_STATES = ['revoked', 'rotating', ' Revoked ', 'ROTATING', '', 'suspended'];

    it.each(REFUSED_STATES)('replaces a covering permanent credential in state %j with the candidate, without reading it', async (state) => {
      const { service, decrypt, probes } = harness({ existingExpiresAt: null, rotationState: state });

      const result = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(result).toEqual({ accessToken: 'new-token', expiresInSeconds: 5_184_000, minted: true });
      expect(decrypt).not.toHaveBeenCalled();
      expect(probes().filter(([, token]) => token === 'permanent-existing')).toEqual([]);
    });

    it.each(REFUSED_STATES)('never lets a NON-covering permanent credential in state %j block the candidate', async (state) => {
      const { service, decrypt } = harness({
        existingExpiresAt: null,
        rotationState: state,
        deniedFor: { 'permanent-existing': ['waba-new'] },
      });

      const result = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      // `waba-old` is live and required: this is exactly where a usable
      // permanent credential answers COVERAGE_REQUIRED.
      expect(result).toEqual({ accessToken: 'new-token', expiresInSeconds: 5_184_000, minted: true });
      expect(decrypt).not.toHaveBeenCalled();
    });

    it('does not retain a revoked permanent credential that covers when a permanent candidate fails', async () => {
      const { service, decrypt } = harness({
        existingExpiresAt: null,
        rotationState: 'revoked',
        deniedFor: { 'new-system-token': ['waba-old'] },
      });

      const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-system-token', 0)
        .catch((e: unknown) => e);

      expect(error.getResponse()).toEqual(expect.objectContaining({
        code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
        wabaId: 'waba-old',
      }));
      expect(decrypt).not.toHaveBeenCalled();
    });

    it('still asks the candidate to cover every live WABA', async () => {
      const { service } = harness({
        existingExpiresAt: null,
        rotationState: 'revoked',
        deniedFor: { 'new-token': ['waba-old'] },
      });

      const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000)
        .catch((e: unknown) => e);

      expect(error.getResponse()).toEqual(expect.objectContaining({
        code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
        wabaId: 'waba-old',
      }));
    });

    it.each([['active'], [' ACTIVE '], [null]])('keeps retaining a covering permanent credential in state %j', async (state) => {
      const { service } = harness({ existingExpiresAt: null, rotationState: state });

      const result = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(result).toEqual({ accessToken: 'permanent-existing', expiresInSeconds: 0, minted: false });
    });
  });

  // ── The no-downgrade rule when nothing else depends on the stored token (P2)
  //
  // The rule exists so re-onboarding never swaps a permanent token that keeps
  // OTHER live numbers sending for one that expires. When the only WABA left
  // to cover is the one being connected, and the stored token cannot read it,
  // the stored token serves nobody: refusing kept a tenant with dead rows
  // around (the cotes-asociados shape) locked out forever.
  describe('an active permanent credential that cannot read the only live WABA', () => {
    const deadRow: ChannelRow = { meta_waba_id: 'waba-test', channel_status: 'disconnected', phone_number_id: 'p-test' };
    const deadAccount: AccountRow = { tenantId: 'tenant-1', channelType: 'whatsapp', accountId: 'p-test', isActive: false };

    it.each<[string, ChannelRow[], AccountRow[]]>([
      ['only dead rows', [deadRow], [deadAccount]],
      ['no rows at all', [], []],
      ['only the row of the number being re-connected',
        [{ meta_waba_id: 'waba-new', channel_status: 'connected', phone_number_id: 'p-new' }], []],
    ])('is replaced by a temporary candidate that covers the target (%s)', async (_label, rows, accounts) => {
      const { service, logs } = harness({
        existingExpiresAt: null,
        rows,
        accounts,
        deniedFor: { 'permanent-existing': ['waba-new'] },
      });

      const result = await (service as any).resolveCredentialForCoverage(
        'tenant-1', 'waba-new', 'temporary-candidate-value', 5_184_000,
      );

      expect(result).toEqual({ accessToken: 'temporary-candidate-value', expiresInSeconds: 5_184_000, minted: true });
      const lines = logs.mock.calls.map(([line]) => String(line));
      expect(lines.filter(line => /replac/i.test(line) && line.includes('waba-new'))).toHaveLength(1);
      // Ids only: neither token value ever reaches the log.
      expect(lines.join('\n')).not.toMatch(/temporary-candidate-value|permanent-existing/);
    });

    it('answers TARGET_NOT_GRANTED when the candidate cannot read the target either', async () => {
      const { service } = harness({
        existingExpiresAt: null,
        rows: [deadRow],
        accounts: [deadAccount],
        deniedFor: { 'permanent-existing': ['waba-new'], 'temporary-candidate-value': ['waba-new'] },
      });

      const error: any = await (service as any).resolveCredentialForCoverage(
        'tenant-1', 'waba-new', 'temporary-candidate-value', 5_184_000,
      ).catch((e: unknown) => e);

      expect(error.getResponse()).toEqual(expect.objectContaining({
        code: 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED',
        wabaId: 'waba-new',
      }));
    });

    it('keeps COVERAGE_REQUIRED when another live WABA still depends on the stored token', async () => {
      const { service, probes } = harness({
        existingExpiresAt: null,
        rows: [deadRow, { meta_waba_id: 'waba-old', channel_status: 'connected', phone_number_id: 'p-old' }],
        accounts: [deadAccount],
        deniedFor: { 'permanent-existing': ['waba-new'] },
      });

      const error: any = await (service as any).resolveCredentialForCoverage(
        'tenant-1', 'waba-new', 'temporary-candidate-value', 5_184_000,
      ).catch((e: unknown) => e);

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual(expect.objectContaining({
        code: 'WHATSAPP_TOKEN_COVERAGE_REQUIRED',
        targetWabaId: 'waba-new',
      }));
      expect(probes().filter(([, token]) => token === 'temporary-candidate-value')).toEqual([]);
    });

    it('never downgrades a covering permanent credential when the same live number is re-onboarded', async () => {
      const { service, probes } = harness({
        existingExpiresAt: null,
        rows: [{ meta_waba_id: 'waba-new', channel_status: 'connected', phone_number_id: 'p-new' }],
        accounts: [{ tenantId: 'tenant-1', channelType: 'whatsapp', accountId: 'p-new', isActive: true }],
      });

      const result = await (service as any).resolveCredentialForCoverage(
        'tenant-1', 'waba-new', 'temporary-candidate-value', 5_184_000,
      );

      expect(result).toEqual({ accessToken: 'permanent-existing', expiresInSeconds: 0, minted: false });
      expect(probes().filter(([, token]) => token === 'temporary-candidate-value')).toEqual([]);
    });
  });

  // ── A Meta blip never decides coverage (rule T) ───────────────────────────
  //
  // After P2, "the stored permanent credential cannot read the only live WABA"
  // lets a temporary candidate replace it. The probe answered that question
  // for ANY failure: a timeout, a 503 or a throttle on the stored credential
  // read as "does not cover", and a permanent credential that DID cover was
  // swapped for one that expires in 60 days — a downgrade caused by Meta
  // having a bad minute. Before P2 the same blip refused without writing.
  //
  // Only a refusal (Meta answered 4xx with a Graph error, or a 200 for another
  // WABA) is evidence about access. Anything else stops the decision with a
  // retryable, server-resumable error, and nothing is minted or blamed.
  //
  // TWIN: apps/api whatsapp-connection.service carries the same cases.
  describe('a probe that Meta did not actually answer (rule T)', () => {
    const deadRow: ChannelRow = { meta_waba_id: 'waba-test', channel_status: 'disconnected', phone_number_id: 'p-test' };
    const deadAccount: AccountRow = { tenantId: 'tenant-1', channelType: 'whatsapp', accountId: 'p-test', isActive: false };
    const liveOld: ChannelRow = { meta_waba_id: 'waba-old', channel_status: 'connected', phone_number_id: 'p-old' };
    const TRANSIENTS: ProbeFailure[] = [
      'timeout', 'connection_reset', 'http_500', 'http_503', 'http_429', 'throttled_4', 'throttled_80007',
    ];
    const THROTTLES: ProbeFailure[] = ['http_429', 'throttled_4', 'throttled_80007'];
    const UNAVAILABLE_MESSAGE = 'No pudimos confirmar el acceso con Meta en este momento. Intenta de nuevo en unos minutos.';

    /** The error a blip must surface as: retryable, resumable, never a coverage verdict. */
    function expectCoverageCheckUnavailable(error: any, failure: ProbeFailure) {
      expect(error).toBeInstanceOf(MetaApiError);
      expect(error.code).toBe(THROTTLES.includes(failure)
        ? OnboardingErrorCode.RATE_LIMITED
        : OnboardingErrorCode.GRAPH_API_ERROR);
      expect(error.retryable).toBe(true);
      // `retryOnboarding` resumes these codes with the stored token, so the
      // failure keeps `exchange_payload`.
      expect(isServerResumableFailure(error.code)).toBe(true);
      if (!THROTTLES.includes(failure)) expect(error.userMessage).toBe(UNAVAILABLE_MESSAGE);
      expect(error.userMessage).not.toMatch(JARGON);
      const surfaced = `${error.message}\n${error.userMessage}`;
      expect(surfaced).not.toMatch(/permanent-existing|temporary-candidate-value|new-system-token/);
    }

    it.each(TRANSIENTS)(
      'never replaces a covering permanent credential when its probe of the only live WABA fails with %s',
      async (failure) => {
        const { service, probes, logs, warnings } = harness({
          existingExpiresAt: null,
          rotationState: 'active',
          rows: [deadRow],
          accounts: [deadAccount],
          failFor: { 'permanent-existing': { 'waba-new': failure } },
        });

        const error: any = await (service as any).resolveCredentialForCoverage(
          'tenant-1', 'waba-new', 'temporary-candidate-value', 5_184_000,
        ).catch((e: unknown) => e);

        expectCoverageCheckUnavailable(error, failure);
        // The candidate is never probed, so it can never be minted.
        expect(probes().filter(([, token]) => token === 'temporary-candidate-value')).toEqual([]);
        const lines = [...logs.mock.calls, ...warnings.mock.calls].map(([line]) => String(line));
        expect(lines.filter(line => /replac/i.test(line))).toEqual([]);
        expect(lines.join('\n')).not.toMatch(/temporary-candidate-value|permanent-existing/);
      },
    );

    it.each(TRANSIENTS)(
      'answers retryable instead of COVERAGE_REQUIRED when the stored probe of a dependent WABA fails with %s',
      async (failure) => {
        const { service, probes } = harness({
          existingExpiresAt: null,
          rows: [liveOld],
          failFor: { 'permanent-existing': { 'waba-old': failure } },
        });

        const error: any = await (service as any).resolveCredentialForCoverage(
          'tenant-1', 'waba-new', 'temporary-candidate-value', 5_184_000,
        ).catch((e: unknown) => e);

        expectCoverageCheckUnavailable(error, failure);
        expect(probes().filter(([, token]) => token === 'temporary-candidate-value')).toEqual([]);
      },
    );

    it.each(REFUSALS)('still falls through to the candidate when the stored probe is a definite refusal (%s)', async (refusal) => {
      const { service } = harness({
        existingExpiresAt: null,
        rows: [deadRow],
        accounts: [deadAccount],
        failFor: { 'permanent-existing': { 'waba-new': refusal } },
      });

      const result = await (service as any).resolveCredentialForCoverage(
        'tenant-1', 'waba-new', 'temporary-candidate-value', 5_184_000,
      );

      expect(result).toEqual({ accessToken: 'temporary-candidate-value', expiresInSeconds: 5_184_000, minted: true });
    });

    it.each(REFUSALS)('keeps COVERAGE_REQUIRED for a definite refusal (%s) on a dependent WABA', async (refusal) => {
      const { service } = harness({
        existingExpiresAt: null,
        rows: [liveOld],
        failFor: { 'permanent-existing': { 'waba-new': refusal } },
      });

      const error: any = await (service as any).resolveCredentialForCoverage(
        'tenant-1', 'waba-new', 'temporary-candidate-value', 5_184_000,
      ).catch((e: unknown) => e);

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'WHATSAPP_TOKEN_COVERAGE_REQUIRED' }));
    });

    it.each(TRANSIENTS)(
      'never reports TARGET_NOT_GRANTED when the candidate probe of the target fails with %s after a stored refusal',
      async (failure) => {
        const { service } = harness({
          existingExpiresAt: null,
          rows: [deadRow],
          accounts: [deadAccount],
          failFor: {
            'permanent-existing': { 'waba-new': 'permission_denied' },
            'temporary-candidate-value': { 'waba-new': failure },
          },
        });

        const error: any = await (service as any).resolveCredentialForCoverage(
          'tenant-1', 'waba-new', 'temporary-candidate-value', 5_184_000,
        ).catch((e: unknown) => e);

        expectCoverageCheckUnavailable(error, failure);
      },
    );

    it.each(TRANSIENTS)('never reports TARGET_NOT_GRANTED for a candidate blip (%s) with no stored permanent credential', async (failure) => {
      const { service } = harness({
        existingExpiresAt: new Date(),
        failFor: { 'new-token': { 'waba-new': failure } },
      });

      const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000)
        .catch((e: unknown) => e);

      expectCoverageCheckUnavailable(error, failure);
    });

    it.each(TRANSIENTS)('never reports MISSING_WABA_SCOPE for a candidate blip (%s) on another live WABA', async (failure) => {
      const { service } = harness({
        existingExpiresAt: new Date(),
        rows: [liveOld],
        failFor: { 'new-token': { 'waba-old': failure } },
      });

      const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000)
        .catch((e: unknown) => e);

      expectCoverageCheckUnavailable(error, failure);
    });

    it.each(REFUSALS)('keeps TARGET_NOT_GRANTED for a definite candidate refusal (%s) on the target', async (refusal) => {
      const { service } = harness({
        existingExpiresAt: null,
        rows: [deadRow],
        accounts: [deadAccount],
        failFor: {
          'permanent-existing': { 'waba-new': 'permission_denied' },
          'temporary-candidate-value': { 'waba-new': refusal },
        },
      });

      const error: any = await (service as any).resolveCredentialForCoverage(
        'tenant-1', 'waba-new', 'temporary-candidate-value', 5_184_000,
      ).catch((e: unknown) => e);

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual({
        code: 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED',
        userMessage: TARGET_NOT_GRANTED_MESSAGE,
        wabaId: 'waba-new',
        targetWabaId: 'waba-new',
      });
    });

    describe('with a permanent candidate', () => {
      it.each(TRANSIENTS)('answers retryable for a candidate blip (%s) when no stored permanent credential exists', async (failure) => {
        const { service } = harness({
          existingExpiresAt: new Date(),
          failFor: { 'new-system-token': { 'waba-new': failure } },
        });

        const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-system-token', 0)
          .catch((e: unknown) => e);

        expectCoverageCheckUnavailable(error, failure);
      });

      it.each(TRANSIENTS)('answers retryable, not the candidate conflict, when the stored probe fails with %s', async (failure) => {
        const { service } = harness({
          existingExpiresAt: null,
          failFor: {
            'new-system-token': { 'waba-new': 'permission_denied' },
            'permanent-existing': { 'waba-new': failure },
          },
        });

        const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-system-token', 0)
          .catch((e: unknown) => e);

        expectCoverageCheckUnavailable(error, failure);
      });

      it('answers retryable for a candidate blip even when the stored credential is refused too', async () => {
        const { service } = harness({
          existingExpiresAt: null,
          failFor: {
            'new-system-token': { 'waba-new': 'timeout' },
            'permanent-existing': { 'waba-new': 'permission_denied' },
          },
        });

        const error: any = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-system-token', 0)
          .catch((e: unknown) => e);

        expectCoverageCheckUnavailable(error, 'timeout');
      });

      it('still retains a stored permanent credential that proves it covers after a candidate blip', async () => {
        const { service } = harness({
          existingExpiresAt: null,
          failFor: { 'new-system-token': { 'waba-new': 'http_503' } },
        });

        const result = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-system-token', 0);

        expect(result).toEqual({ accessToken: 'permanent-existing', expiresInSeconds: 0, minted: false });
      });
    });
  });

  it('checks quota and coverage before publishing the channel row', () => {
    const source = fs.readFileSync(path.join(__dirname, 'onboarding.service.ts'), 'utf8');
    const quota = source.indexOf("assertChannelAccountQuotaViaApi(tenantId, 'whatsapp', primaryPhone.id)");
    const coverage = source.indexOf('resolveCredentialForCoverage(');
    const persist = source.indexOf('await this.persistWhatsAppChannel(', coverage);
    expect(quota).toBeGreaterThan(0);
    expect(coverage).toBeGreaterThan(quota);
    expect(persist).toBeGreaterThan(coverage);
  });

  // ── Only LIVE WABAs must be covered ────────────────────────────────────────
  //
  // Incidente cotes-asociados (16-sep-2026): un número de prueba de Meta se
  // conectó y se desconectó desde el panel. La fila de `whatsapp_channels`
  // quedó con su `meta_waba_id` y `channel_status='disconnected'`, y el
  // `channel_account` quedó inactivo. Los seis intentos siguientes, con un
  // número de OTRO portafolio, exigieron que el token nuevo leyera esa WABA
  // muerta — cosa que ningún token de ese portafolio puede hacer.
  //
  // Regla R-S3 (idéntica en la API): la fila está muerta cuando dice
  // `disconnected` Y su cuenta en `channel_accounts` existe y ya no es de este
  // tenant o está inactiva. `channel_accounts` es único por (tipo, número) y la
  // conexión más reciente se la lleva al tenant que conectó ese número, así que
  // se lee SIN filtrar por tenant.
  describe('which WABAs a credential must cover', () => {
    const deadRow: ChannelRow = { meta_waba_id: 'waba-test', channel_status: 'disconnected', phone_number_id: 'p-test' };
    const account = (accountId: string, isActive: boolean, tenantId = 'tenant-1'): AccountRow => (
      { tenantId, channelType: 'whatsapp', accountId, isActive }
    );

    it('skips a WABA whose channel is disconnected AND whose channel account is inactive', async () => {
      const { service, metaGraph } = harness({
        existingExpiresAt: new Date(),
        rows: [deadRow],
        accounts: [account('p-test', false)],
      });

      const result = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(result).toEqual({ accessToken: 'new-token', expiresInSeconds: 5_184_000, minted: true });
      expect(metaGraph.getWabaDirectly).not.toHaveBeenCalledWith('waba-test', expect.anything());
      expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-new', 'new-token');
    });

    it('treats the status case- and whitespace-insensitively', async () => {
      const { service, metaGraph } = harness({
        existingExpiresAt: new Date(),
        rows: [{ ...deadRow, channel_status: ' Disconnected ' }],
        accounts: [account('p-test', false)],
      });

      await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(metaGraph.getWabaDirectly).not.toHaveBeenCalledWith('waba-test', expect.anything());
    });

    it('still requires a disconnected WABA whose channel account is ACTIVE for this tenant', async () => {
      const { service, metaGraph } = harness({
        existingExpiresAt: new Date(),
        rows: [deadRow],
        accounts: [account('p-test', true)],
        denied: 'waba-test',
      });

      await expect((service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000))
        .rejects.toMatchObject({
          response: expect.objectContaining({ code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE', wabaId: 'waba-test' }),
        });
      expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-test', 'new-token');
    });

    it('still requires a disconnected WABA with NO channel account row (legacy)', async () => {
      const { service, metaGraph } = harness({
        existingExpiresAt: new Date(),
        rows: [deadRow],
        accounts: [],
      });

      await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-test', 'new-token');
    });

    it('skips a disconnected number whose account MOVED to another tenant and is active there', async () => {
      const { service, metaGraph } = harness({
        existingExpiresAt: new Date(),
        rows: [deadRow],
        accounts: [account('p-test', true, 'tenant-other')],
      });

      const result = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(result).toEqual({ accessToken: 'new-token', expiresInSeconds: 5_184_000, minted: true });
      expect(metaGraph.getWabaDirectly).not.toHaveBeenCalledWith('waba-test', expect.anything());
    });

    it('skips a disconnected number whose account moved to another tenant and is inactive', async () => {
      const { service, metaGraph } = harness({
        existingExpiresAt: new Date(),
        rows: [deadRow],
        accounts: [account('p-test', false, 'tenant-other')],
      });

      await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(metaGraph.getWabaDirectly).not.toHaveBeenCalledWith('waba-test', expect.anything());
    });

    it('requires a connected WABA even when its channel account is inactive', async () => {
      const { service, metaGraph } = harness({
        existingExpiresAt: new Date(),
        rows: [{ ...deadRow, channel_status: 'connected' }],
        accounts: [account('p-test', false)],
      });

      await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-test', 'new-token');
    });

    it('requires a WABA while ANY of its numbers is still live', async () => {
      const { service, metaGraph } = harness({
        existingExpiresAt: new Date(),
        rows: [deadRow, { meta_waba_id: 'waba-test', channel_status: 'connected', phone_number_id: 'p-live' }],
        accounts: [account('p-test', false), account('p-live', true)],
      });

      await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-test', 'new-token');
    });

    it('always requires the target WABA, even when a dead row points at it', async () => {
      const { service, metaGraph } = harness({
        existingExpiresAt: new Date(),
        rows: [{ ...deadRow, meta_waba_id: 'waba-new' }],
        accounts: [account('p-test', false)],
      });

      await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-new', 'new-token');
    });

    it('keeps the no-downgrade rule for a retained permanent token with a dead row around', async () => {
      const { service, metaGraph } = harness({
        existingExpiresAt: null,
        rows: [deadRow],
        accounts: [account('p-test', false)],
      });

      const result = await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'temporary', 5_184_000);

      expect(result).toEqual({ accessToken: 'permanent-existing', expiresInSeconds: 0, minted: false });
      expect(metaGraph.getWabaDirectly).not.toHaveBeenCalledWith('waba-test', expect.anything());
      expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-new', 'permanent-existing');
    });

    it('does not read channel_accounts when no row says disconnected', async () => {
      const { service, prisma } = harness({
        existingExpiresAt: new Date(),
        rows: [{ meta_waba_id: 'waba-old', channel_status: 'connected', phone_number_id: 'p-old' }],
      });

      await (service as any).resolveCredentialForCoverage('tenant-1', 'waba-new', 'new-token', 5_184_000);

      expect(prisma.channelAccount.findMany).not.toHaveBeenCalled();
    });
  });

  // The pure rule R-S3, pinned on its own. The API twin
  // (apps/api/src/modules/whatsapp/services/whatsapp-live-coverage.ts) carries
  // the same cases; a case added here goes there too.
  describe('liveCoverageWabaIds (R-S3)', () => {
    const TENANT = 'tenant-1';
    const row = (wabaId: string | null, phoneId: string | null, status: string | null): CoverageChannelRow => (
      { meta_waba_id: wabaId, phone_number_id: phoneId, channel_status: status }
    );
    const acc = (accountId: string, isActive: boolean, tenantId = TENANT): CoverageChannelAccount => (
      { tenantId, accountId, isActive }
    );

    it.each<[string, CoverageChannelRow[], CoverageChannelAccount[], string[]]>([
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
    ])('%s', (_label, rows, accounts, expected) => {
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
});
