import { OnboardingMode, OnboardingStatus } from '../../common/enums/onboarding-status.enum';
import { OnboardingErrorCode } from '../../common/enums/onboarding-error.enum';
import { MetaApiError } from '../meta-graph/meta-graph.service';
import { OnboardingService, classifyPhoneRegistration, metaGraphErrorFacts } from './onboarding.service';

/**
 * ═══ STEP 8: A NUMBER META DID NOT REGISTER IS NOT "CONECTADO" ═══
 *
 * Step 8 swallowed every registration error as "may already be registered".
 * A number Meta refused cannot send a single message, and the owner was told
 * it was connected: the signup finished COMPLETED, with no warning, so the
 * panel had nothing to say.
 *
 * Meta documents no "already registered" error, so the error cannot be what
 * tells the two cases apart; Meta's own reading of the number can — only a
 * number whose status is CONNECTED sends. Pinned here, through the real flow:
 * refused + not CONNECTED (or unreadable) ends in `phone_registration_deferred`
 * on the persisted row and on the answer the panel polls; refused + CONNECTED
 * is the harmless "already registered" and adds nothing.
 */

const tenantId = '090baca7-46da-4061-b5ea-7f72350178e6';
const onboardingId = '11111111-1111-4111-8111-111111111111';
const wabaId = 'waba-selected';

function metaRefusal(code: number, message: string, httpStatus = 400) {
  // What `MetaGraphService.registerPhoneNumber` throws: the Axios error rides
  // along as `originalError`, Meta's body inside it.
  return new MetaApiError(
    OnboardingErrorCode.PHONE_REGISTRATION_FAILED,
    'No se pudo registrar el número de teléfono en WhatsApp',
    message,
    httpStatus >= 500,
    { response: { status: httpStatus, data: { error: { code, message, type: 'OAuthException' } } } },
  );
}

function harness(options: {
  register: () => Promise<unknown>;
  /** The phone as step 7 read it. */
  stepSevenStatus?: string;
  /** What a second read of the WABA's phones answers; an Error rejects. */
  reread?: Array<Record<string, unknown>> | Error;
}) {
  let persisted: Record<string, any> = {};
  const prisma = {
    whatsappOnboarding: {
      update: jest.fn(async ({ data }: any) => {
        persisted = { ...persisted, ...data };
        return { id: onboardingId, tenantId, ...persisted };
      }),
      findUnique: jest.fn(async () => ({ id: onboardingId, tenantId, ...persisted })),
    },
    tenant: { findUnique: jest.fn(async () => ({ schemaName: 'tenant_test' })) },
    executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => (
      sql.includes('SELECT id FROM whatsapp_channels') ? [{ id: 'channel-1' }] : []
    )),
  };
  const phone = {
    id: 'phone-1', displayPhoneNumber: '+573001112233', verifiedName: 'Tienda', qualityRating: 'GREEN',
    ...(options.stepSevenStatus ? { status: options.stepSevenStatus } : {}),
  };
  let phoneReads = 0;
  const metaGraph = {
    debugToken: jest.fn(async () => ({ isValid: true, type: 'USER', scopes: [] })),
    getWabaDirectly: jest.fn(async () => ({ id: wabaId, name: 'WABA', businessId: 'business-1' })),
    getBusinessAccountsForToken: jest.fn(async () => []),
    getPhoneNumbersForWaba: jest.fn(async () => {
      phoneReads += 1;
      if (phoneReads === 1 || options.reread === undefined) return [phone];
      if (options.reread instanceof Error) throw options.reread;
      return options.reread;
    }),
    registerPhoneNumber: jest.fn(options.register),
    generateSystemUserToken: jest.fn(async () => null),
    subscribeAppToWaba: jest.fn(async () => true),
    getBusinessVerificationStatus: jest.fn(async () => 'verified'),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const service = new OnboardingService(prisma as any, metaGraph as any, { get: jest.fn() } as any, audit as any);
  jest.spyOn(service as any, 'registerChannelAccount').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'storeEncryptedCredential').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'resolveCredentialForCoverage').mockImplementation(
    async (_t: string, _w: string, accessToken: string, expiresInSeconds: number) => ({ accessToken, expiresInSeconds, minted: true }),
  );
  jest.spyOn(service as any, 'syncTemplatesInBackground').mockImplementation(() => undefined);
  jest.spyOn(service as any, 'assertChannelAccountQuotaViaApi').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'notifyAgentQualityChannelUpdated').mockResolvedValue(undefined);
  const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

  const run = async () => (service as any).continueOnboardingFromDiscovery(
    onboardingId, tenantId, 'user-1', 'long-lived-token', 5184000,
    { businessId: 'business-1', phoneNumberId: phone.id, wabaId, mode: OnboardingMode.NEW },
  );
  const completion = () => prisma.whatsappOnboarding.update.mock.calls
    .map(([args]: any[]) => args.data)
    .find((data: any) => data.completedAt);
  const auditOf = () => (audit.log.mock.calls as any[])
    .map(([entry]) => entry)
    .find((entry: any) => entry.action === 'onboarding_completed');
  return { service, metaGraph, run, completion, auditOf, warn };
}

describe('Embedded Signup step 8: phone registration', () => {
  it('a refused registration over a number Meta does not read as CONNECTED ends with phone_registration_deferred', async () => {
    const h = harness({
      register: async () => { throw metaRefusal(133005, 'Two step verification PIN Mismatch'); },
      reread: [{ id: 'phone-1', status: 'PENDING' }],
    });

    const answer = await h.run();

    // Persisted, where the panel's later reads (and the API's status) find it…
    expect(h.completion()).toEqual(expect.objectContaining({
      status: OnboardingStatus.COMPLETED_WITH_WARNINGS,
      exchangePayload: expect.objectContaining({ warnings: ['phone_registration_deferred'] }),
    }));
    // …and on the answer the dashboard reads right now.
    expect(answer.status).toBe(OnboardingStatus.COMPLETED_WITH_WARNINGS);
    expect(answer.warnings).toEqual(['phone_registration_deferred']);
    // Meta's code kept as evidence for support, never the token.
    expect(h.auditOf().metadata.phoneRegistration).toEqual({
      outcome: 'not_registered', phoneStatus: 'PENDING', graphCode: 133005, graphSubcode: null,
    });
    expect(h.warn).toHaveBeenCalledWith(expect.stringMatching(/NOT registered[\s\S]*133005[\s\S]*status=PENDING/));
  });

  it('a refused registration over a number Meta reads as CONNECTED is "already registered": no warning', async () => {
    const h = harness({
      register: async () => { throw metaRefusal(133005, 'Two step verification PIN Mismatch'); },
      reread: [{ id: 'phone-1', status: 'CONNECTED' }],
    });

    const answer = await h.run();

    expect(answer.status).toBe(OnboardingStatus.COMPLETED);
    expect(answer.warnings).toEqual([]);
    expect(h.auditOf().metadata.phoneRegistration.outcome).toBe('already_registered');
  });

  it('Meta answering without success is not a registration either', async () => {
    const h = harness({ register: async () => false, reread: [{ id: 'phone-1', status: 'PENDING' }] });

    const answer = await h.run();

    expect(answer.warnings).toEqual(['phone_registration_deferred']);
  });

  it('when the number cannot be read again, the reading from step 7 decides — and no reading is not CONNECTED', async () => {
    const reread = new Error('socket hang up');
    const connected = harness({
      register: async () => { throw metaRefusal(133005, 'PIN mismatch'); }, stepSevenStatus: 'CONNECTED', reread,
    });
    expect((await connected.run()).warnings).toEqual([]);

    const unknown = harness({ register: async () => { throw metaRefusal(133005, 'PIN mismatch'); }, reread });
    const answer = await unknown.run();
    expect(answer.warnings).toEqual(['phone_registration_deferred']);
    expect(unknown.auditOf().metadata.phoneRegistration.phoneStatus).toBeNull();
  });

  it('a registration that succeeds asks Meta nothing more and warns nothing', async () => {
    const h = harness({ register: async () => true });

    const answer = await h.run();

    expect(answer.status).toBe(OnboardingStatus.COMPLETED);
    expect(answer.warnings).toEqual([]);
    expect(h.metaGraph.getPhoneNumbersForWaba).toHaveBeenCalledTimes(1);
    expect(h.auditOf().metadata.phoneRegistration.outcome).toBe('registered');
  });

  it('lists the registration first, beside the other warnings it can come with', async () => {
    const h = harness({
      register: async () => { throw metaRefusal(133016, 'Registration rate limit'); },
      reread: [{ id: 'phone-1', status: 'PENDING' }],
    });
    h.metaGraph.subscribeAppToWaba.mockResolvedValue(false);

    const answer = await h.run();

    expect(answer.warnings).toEqual(['phone_registration_deferred', 'webhook_subscription_failed']);
  });
});

describe('classifyPhoneRegistration', () => {
  it('reads Meta\'s code from the error the Graph client throws, and from a raw Axios error', () => {
    expect(metaGraphErrorFacts(metaRefusal(133016, 'Too many attempts'))).toEqual({
      httpStatus: 400, code: 133016, subcode: null, message: 'Too many attempts',
    });
    expect(metaGraphErrorFacts({ response: { status: 503, data: { error: { code: 133004, error_subcode: 7 } } } }))
      .toEqual({ httpStatus: 503, code: 133004, subcode: 7, message: null });
    expect(metaGraphErrorFacts(undefined)).toBeNull();
  });

  it.each([
    [133004, true], [133015, true], [133016, true], [4, true],
    [133005, false], [133006, false], [133000, false], [100, false],
  ])('Meta code %p asks to retry later: %p (the number is unregistered either way)', (code, retryLater) => {
    expect(classifyPhoneRegistration({ registered: false, error: metaRefusal(code, 'x'), phoneStatus: 'PENDING' }))
      .toEqual(expect.objectContaining({ kind: 'not_registered', retryLater }));
  });

  it('never reads an unknown or non-connected status as registered', () => {
    for (const phoneStatus of [undefined, null, '', 'PENDING', 'DISCONNECTED', 'UNVERIFIED', 'BANNED', 'UNKNOWN', 42]) {
      expect(classifyPhoneRegistration({ registered: false, phoneStatus }).kind).toBe('not_registered');
    }
    // A quality or throughput state exists only for a registered number: not a registration problem.
    for (const phoneStatus of [' connected ', 'FLAGGED', 'RESTRICTED', 'RATE_LIMITED']) {
      expect(classifyPhoneRegistration({ registered: false, phoneStatus }).kind).toBe('already_registered');
    }
    expect(classifyPhoneRegistration({ registered: true, phoneStatus: 'PENDING' })).toEqual({ kind: 'registered' });
  });
});
