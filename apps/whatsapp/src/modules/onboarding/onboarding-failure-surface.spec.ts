import {
  BadRequestException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OnboardingMode, OnboardingStatus } from '../../common/enums/onboarding-status.enum';
import {
  OnboardingErrorCode,
  isRelaunchableFailure,
  isServerResumableFailure,
} from '../../common/enums/onboarding-error.enum';
import { throwError } from 'rxjs';
import { MetaApiError, MetaGraphService } from '../meta-graph/meta-graph.service';
import { OnboardingService } from './onboarding.service';

/**
 * Lo que la persona ve cuando una conexión de WhatsApp falla.
 *
 * Incidente cotes-asociados (16-sep-2026): seis intentos de coexistencia
 * fallaron por una WABA vieja que el token nuevo no podía leer. El servicio
 * sabía exactamente por qué (`WHATSAPP_TOKEN_MISSING_WABA_SCOPE`, con un mensaje
 * escrito para leerse), y el panel mostró seis veces la tarjeta genérica:
 *
 *  - el fallo se registraba DOS veces — el catch de `continueOnboardingFromDiscovery`
 *    y el catch externo de `startOnboarding`, que envolvía la misma llamada —;
 *  - sólo `MetaApiError` conservaba su código, así que la Conflict se volvía
 *    `WA_ES_GRAPH_API_ERROR` con el mensaje técnico "Conflict Exception";
 *  - la segunda pasada pisaba la fila con "Bad Request Exception", auditaba de
 *    nuevo y respondía 400 `retryable: true` para algo que reintentar no arregla.
 */
describe('Onboarding failure surface', () => {
  const tenantId = '090baca7-46da-4061-b5ea-7f72350178e6';
  const onboardingId = '22222222-2222-4222-8222-222222222222';
  const wabaId = 'waba-new';
  const phone = {
    id: 'phone-new',
    displayPhoneNumber: '+573001112233',
    verifiedName: 'Cotes',
    qualityRating: 'GREEN',
  };
  const user = { sub: 'user-1', role: 'tenant_admin', tenantId };
  const GENERIC = 'No pudimos completar la conexión con WhatsApp. Intenta de nuevo en unos minutos y, si se repite, escríbenos a soporte.';

  function createHarness(options?: { storedOnboarding?: Record<string, any> }) {
    // One in-memory onboarding row: `create`/`update` write it and `findUnique`
    // reads it back, so what a failure leaves in `exchange_payload` is what a
    // later read (a retry, a support query) would actually find.
    let row: Record<string, any> | null = options?.storedOnboarding ? { ...options.storedOnboarding } : null;
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ id: tenantId, schemaName: 'tenant_test', isActive: true }),
      },
      whatsappOnboarding: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          row = { id: onboardingId, exchangePayload: null, ...data };
          return { ...row };
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockImplementation(async () => (row ? { ...row } : null)),
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          row = { ...(row ?? { id: onboardingId }), ...data };
          return { ...row };
        }),
      },
      executeInTenantSchema: jest.fn().mockResolvedValue([]),
      // Only read when a test restores the real coverage check: no stored
      // credential and no other number, so the target is the only WABA to cover.
      whatsappCredential: { findFirst: jest.fn().mockResolvedValue(null) },
      channelAccount: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const metaGraph = {
      exchangeOnboardingCode: jest.fn().mockResolvedValue({ accessToken: 'short-token', tokenType: 'bearer' }),
      exchangeForLongLivedToken: jest.fn().mockResolvedValue({ accessToken: 'long-token', expiresIn: 5184000 }),
      debugToken: jest.fn().mockResolvedValue({ isValid: true, type: 'USER', scopes: [] }),
      getWabaDirectly: jest.fn().mockResolvedValue({ id: wabaId, name: 'WABA', businessId: 'business-1' }),
      getBusinessAccountsForToken: jest.fn().mockResolvedValue([]),
      getPhoneNumbersForWaba: jest.fn().mockResolvedValue([phone]),
      registerPhoneNumber: jest.fn().mockResolvedValue(true),
      generateSystemUserToken: jest.fn().mockResolvedValue(null),
      subscribeAppToWaba: jest.fn().mockResolvedValue(true),
      getBusinessVerificationStatus: jest.fn().mockResolvedValue('verified'),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const service = new OnboardingService(prisma as any, metaGraph as any, config as any, audit as any);

    const quota = jest.spyOn(service as any, 'assertChannelAccountQuotaViaApi').mockResolvedValue(undefined);
    const coverage = jest.spyOn(service as any, 'resolveCredentialForCoverage').mockImplementation(
      async (_t: string, _w: string, accessToken: string, expiresInSeconds: number) => (
        { accessToken, expiresInSeconds, minted: true }
      ),
    );
    jest.spyOn(service as any, 'storeEncryptedCredential').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'persistWhatsAppChannel').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'registerChannelAccount').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'syncTemplatesInBackground').mockImplementation(() => undefined);
    jest.spyOn(service as any, 'notifyAgentQualityChannelUpdated').mockResolvedValue(undefined);

    const dto = {
      tenantId,
      configId: 'config-1',
      code: 'oauth-code',
      mode: OnboardingMode.COEXISTENCE,
      coexistenceAcknowledged: true,
      wabaId,
    };

    const start = () => service.startOnboarding(dto as any, user).catch((error: unknown) => error);

    const failedWrites = () => prisma.whatsappOnboarding.update.mock.calls
      .map(([args]: any[]) => args.data)
      .filter((data: any) => data.status === OnboardingStatus.FAILED);
    const failureAudits = () => audit.log.mock.calls
      .map(([entry]: any[]) => entry)
      .filter((entry: any) => entry.action === 'onboarding_failed');

    const currentRow = () => row;

    return { service, prisma, metaGraph, audit, config, quota, coverage, start, failedWrites, failureAudits, currentRow };
  }

  it('records a coverage conflict ONCE and answers 409 with the code and message the service wrote', async () => {
    const harness = createHarness();
    harness.coverage.mockRejectedValue(new ConflictException({
      code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
      userMessage: 'x',
    }));

    const error: any = await harness.start();

    expect(harness.failedWrites()).toHaveLength(1);
    expect(harness.failedWrites()[0]).toEqual(expect.objectContaining({
      errorCode: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
      errorMessage: 'x',
    }));
    expect(harness.failureAudits()).toHaveLength(1);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    // `retryable: false` — abrir otra ventana de Meta con el mismo portafolio
    // produce exactamente el mismo token sin permiso sobre la WABA vieja.
    expect(error.getResponse()).toEqual({
      code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
      userMessage: 'x',
      retryable: false,
      onboardingId,
    });
  });

  it('keeps PLAN_LIMIT_REACHED as a 400 that a new Meta window cannot fix', async () => {
    const harness = createHarness();
    harness.quota.mockRejectedValue(new BadRequestException({
      code: 'PLAN_LIMIT_REACHED',
      userMessage: 'Tu plan no permite otro número.',
    }));

    const error: any = await harness.start();

    expect(harness.failedWrites()).toHaveLength(1);
    expect(harness.failedWrites()[0]).toEqual(expect.objectContaining({
      errorCode: 'PLAN_LIMIT_REACHED',
      errorMessage: 'Tu plan no permite otro número.',
    }));
    expect(harness.failureAudits()).toHaveLength(1);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      code: 'PLAN_LIMIT_REACHED',
      userMessage: 'Tu plan no permite otro número.',
      retryable: false,
      onboardingId,
    });
  });

  // Meta's window lets the person pick which numbers to share, and a number
  // left unticked comes back as a token that cannot read it. That is the one
  // coverage failure a NEW Meta window does fix — and the stored token is
  // useless for a server-side resume, so it must not stay in the table.
  it('answers 409 TARGET_NOT_GRANTED as relaunchable and scrubs the stored tokens in the same write', async () => {
    const harness = createHarness();
    harness.coverage.mockRestore();
    // Discovery reads the WABA once; every coverage probe after that is denied.
    // A real Graph refusal, the way `getWabaDirectly` surfaces it: a bare
    // Error with no HTTP answer is a blip, not evidence about access.
    harness.metaGraph.getWabaDirectly
      .mockResolvedValueOnce({ id: wabaId, name: 'WABA', businessId: 'business-1' })
      .mockRejectedValue(new MetaApiError(
        OnboardingErrorCode.WABA_NOT_FOUND,
        'No se pudo obtener la información del WABA',
        '(#200) Permissions error',
        false,
        { response: { status: 403, data: { error: { message: '(#200) Permissions error', type: 'OAuthException', code: 200 } } } },
      ));

    const error: any = await harness.start();

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      code: 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED',
      userMessage: 'Meta no nos dio acceso al número que quieres conectar. Abre otra vez la ventana de Meta, elige la cuenta de negocio donde está ese número y márcalo. Si se repite, escríbenos a soporte.',
      retryable: true,
      onboardingId,
      wabaId,
      targetWabaId: wabaId,
    });

    expect(harness.failedWrites()).toHaveLength(1);
    const failed = harness.failedWrites()[0];
    expect(failed.errorCode).toBe('WHATSAPP_TOKEN_TARGET_NOT_GRANTED');
    expect(failed.exchangePayload).toEqual({
      exchangedAt: expect.any(String),
      tokensScrubbedAt: expect.any(String),
      scrubReason: 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED',
    });
    const persisted = JSON.stringify(harness.currentRow());
    expect(persisted).not.toContain('short-token');
    expect(persisted).not.toContain('long-token');
    expect(harness.failureAudits()).toHaveLength(1);
    expect(harness.failureAudits()[0].metadata).toEqual(expect.objectContaining({
      errorCode: 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED',
      httpStatus: 409,
      retryable: true,
    }));
  });

  // ── A coverage probe Meta did not answer (rule T) ─────────────────────────
  //
  // The tenant already signs with a permanent credential that covers the
  // number, the number is the only live one, and the probe of that credential
  // times out / gets a 503 / is throttled. Treated as "does not cover", P2 let
  // the 60-day candidate replace it. It must stop instead: record a failure
  // `retryOnboarding` can resume, write no credential, publish no channel, and
  // keep the tokens the resume runs on.
  describe('a coverage probe that Meta did not answer', () => {
    const storedPermanent = { encryptedValue: 'encrypted-existing', expiresAt: null, rotationState: 'active' };

    /** The error the REAL `getWabaDirectly` throws for a blip, retries included. */
    async function realProbeBlip(failure: 'timeout' | 'http_503' | 'http_429'): Promise<unknown> {
      const raw: Record<string, unknown> = {
        timeout: { message: 'timeout of 10000ms exceeded', code: 'ECONNABORTED' },
        http_503: { message: 'Request failed with status code 503', response: { status: 503, data: 'Service Unavailable' } },
        http_429: { message: 'Request failed with status code 429', response: { status: 429, data: {} } },
      }[failure] as Record<string, unknown>;
      const httpService = { get: jest.fn(() => throwError(() => Object.assign(new Error(String(raw.message)), raw))) };
      const config = { get: jest.fn((key: string) => ({ 'meta.maxRetries': 3, 'meta.retryDelay': 1 } as Record<string, number>)[key]) };
      return new MetaGraphService(httpService as any, config as any)
        .getWabaDirectly('probed-waba', 'probe-credential')
        .catch((error: unknown) => error);
    }

    async function blipOnStoredProbe(failure: 'timeout' | 'http_503' | 'http_429') {
      const harness = createHarness();
      harness.coverage.mockRestore();
      harness.prisma.whatsappCredential.findFirst.mockResolvedValue(storedPermanent);
      jest.spyOn(harness.service as any, 'decryptToken').mockReturnValue('permanent-existing');
      const blip = await realProbeBlip(failure);
      harness.metaGraph.getWabaDirectly.mockImplementation(async (id: string, token: string) => {
        if (token === 'permanent-existing') throw blip;
        return { id, name: 'WABA', businessId: 'business-1' };
      });
      return harness;
    }

    it.each([
      ['timeout', OnboardingErrorCode.GRAPH_API_ERROR],
      ['http_503', OnboardingErrorCode.GRAPH_API_ERROR],
      ['http_429', OnboardingErrorCode.RATE_LIMITED],
    ] as const)('records a resumable %s without storing, minting or publishing anything', async (failure, code) => {
      const harness = await blipOnStoredProbe(failure);
      const service = harness.service as any;

      const error: any = await harness.start();

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getResponse()).toEqual({
        code,
        userMessage: expect.any(String),
        retryable: true,
        onboardingId,
      });
      expect(isServerResumableFailure(code)).toBe(true);
      expect(service.storeEncryptedCredential).not.toHaveBeenCalled();
      expect(service.persistWhatsAppChannel).not.toHaveBeenCalled();
      expect(service.registerChannelAccount).not.toHaveBeenCalled();
      // The candidate was read once, by discovery — never as a coverage probe.
      const candidateReads = harness.metaGraph.getWabaDirectly.mock.calls.filter(([, token]: any[]) => token === 'long-token');
      expect(candidateReads).toHaveLength(1);

      expect(harness.failedWrites()).toHaveLength(1);
      expect(harness.failedWrites()[0].errorCode).toBe(code);
      expect(harness.failedWrites()[0]).not.toHaveProperty('exchangePayload');
      expect(harness.currentRow()?.exchangePayload).toEqual(expect.objectContaining({
        shortLivedToken: 'short-token',
        longLivedToken: 'long-token',
      }));
      expect(JSON.stringify(harness.failureAudits())).not.toMatch(/permanent-existing|long-token|short-token/);
    });

    it('resumes on the server once Meta answers, and keeps the permanent credential', async () => {
      const harness = await blipOnStoredProbe('timeout');
      await harness.start();
      harness.metaGraph.getWabaDirectly.mockImplementation(async (id: string) => ({ id, name: 'WABA', businessId: 'business-1' }));

      await (harness.service as any).retryOnboarding(onboardingId, user);

      expect((harness.service as any).storeEncryptedCredential).toHaveBeenCalledTimes(1);
      expect((harness.service as any).storeEncryptedCredential).toHaveBeenCalledWith(
        tenantId, 'permanent-existing', 0, null, { minted: false },
      );
    });
  });

  it('answers 503 retryable when the entitlement boundary is unavailable', async () => {
    const harness = createHarness();
    harness.quota.mockRejectedValue(new ServiceUnavailableException({
      code: 'CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE',
      userMessage: 'No fue posible validar temporalmente el acceso para conectar el canal.',
    }));

    const error: any = await harness.start();

    expect(harness.failedWrites()).toHaveLength(1);
    expect(harness.failureAudits()).toHaveLength(1);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual(expect.objectContaining({
      code: 'CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE',
      retryable: true,
      onboardingId,
    }));
  });

  it('keeps the MetaApiError code and user message', async () => {
    const harness = createHarness();
    harness.metaGraph.getPhoneNumbersForWaba.mockResolvedValue([]);

    const error: any = await harness.start();

    expect(harness.failedWrites()).toHaveLength(1);
    expect(harness.failedWrites()[0].errorCode).toBe(OnboardingErrorCode.PHONE_NOT_FOUND);
    expect(harness.failureAudits()).toHaveLength(1);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      code: OnboardingErrorCode.PHONE_NOT_FOUND,
      userMessage: 'No se encontró ningún número de teléfono en la cuenta de WhatsApp Business',
      retryable: false,
      onboardingId,
    });
  });

  it('records a failure inside the code exchange once, and a spent code opens a new Meta window', async () => {
    const harness = createHarness();
    harness.metaGraph.exchangeOnboardingCode.mockRejectedValue(new MetaApiError(
      OnboardingErrorCode.CODE_EXPIRED,
      'El código de autorización de Meta ya se usó o venció.',
      'This authorization code has been used.',
      false,
    ));

    const error: any = await harness.start();

    expect(harness.failedWrites()).toHaveLength(1);
    expect(harness.failureAudits()).toHaveLength(1);
    expect(harness.coverage).not.toHaveBeenCalled();
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual(expect.objectContaining({
      code: OnboardingErrorCode.CODE_EXPIRED,
      retryable: true,
    }));
  });

  it('never shows the technical message of an unknown error to the person', async () => {
    const harness = createHarness();
    harness.coverage.mockRejectedValue(new Error('boom'));

    const error: any = await harness.start();

    expect(harness.failedWrites()).toHaveLength(1);
    expect(harness.failedWrites()[0]).toEqual(expect.objectContaining({
      errorCode: OnboardingErrorCode.GRAPH_API_ERROR,
      errorMessage: GENERIC,
    }));
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      code: OnboardingErrorCode.GRAPH_API_ERROR,
      userMessage: GENERIC,
      retryable: true,
      onboardingId,
    });
    expect(JSON.stringify(error.getResponse())).not.toContain('boom');

    const audits = harness.failureAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toEqual(expect.objectContaining({
      errorCode: OnboardingErrorCode.GRAPH_API_ERROR,
      errorMessage: GENERIC,
      technicalMessage: 'boom',
    }));
  });

  it('treats an HttpException without a code as unknown, not as its framework message', async () => {
    const harness = createHarness();
    harness.coverage.mockRejectedValue(new BadRequestException('Tenant raro'));

    const error: any = await harness.start();

    expect(harness.failedWrites()).toHaveLength(1);
    expect(harness.failedWrites()[0].errorMessage).toBe(GENERIC);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual(expect.objectContaining({
      code: OnboardingErrorCode.GRAPH_API_ERROR,
      userMessage: GENERIC,
    }));
  });

  it('passes through safe identifiers from the exception body without letting them rename the failure', async () => {
    const harness = createHarness();
    harness.coverage.mockRejectedValue(new ConflictException({
      code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
      userMessage: 'x',
      wabaId: 'waba-old',
      onboardingId: 'someone-else',
      retryable: true,
    }));

    const error: any = await harness.start();

    expect(error.getResponse()).toEqual({
      code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
      userMessage: 'x',
      retryable: false,
      onboardingId,
      wabaId: 'waba-old',
    });
  });

  it('a second pass over an already-recorded failure rethrows it without writing or auditing again', async () => {
    const harness = createHarness();
    harness.coverage.mockRejectedValue(new ConflictException({
      code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
      userMessage: 'x',
    }));
    const recorded: any = await harness.start();
    harness.prisma.whatsappOnboarding.update.mockClear();
    harness.audit.log.mockClear();

    const again = await (harness.service as any)
      .handleOnboardingFailure(recorded, onboardingId, tenantId, user.sub)
      .catch((error: unknown) => error);

    expect(again).toBe(recorded);
    expect(harness.prisma.whatsappOnboarding.update).not.toHaveBeenCalled();
    expect(harness.audit.log).not.toHaveBeenCalled();
  });

  // ── Plaintext tokens after a failure nobody can resume ────────────────────
  //
  // `exchange_payload` guarda en claro el token corto y el de larga duración
  // para que `retryOnboarding` retome sin pedir otra autorización. Cuando el
  // código del fallo no es reanudable en el servidor, `retryOnboarding` lo
  // rechaza antes de leer el token: esos tokens ya no sirven para nada y sólo
  // quedaban expuestos en la base. El caso que lo hizo urgente es el rechazo del
  // token del PROVEEDOR — el token que no debía guardarse quedaba guardado igual.
  describe('token scrub on a failure that cannot be resumed', () => {
    const TOKEN_FIELDS = ['shortLivedToken', 'longLivedToken'];

    function providerTokenHarness() {
      const harness = createHarness();
      harness.config.get.mockImplementation((key: string) => (key === 'meta.systemUserId' ? 'provider-system-user' : undefined));
      harness.metaGraph.debugToken.mockResolvedValue({
        isValid: true, type: 'SYSTEM_USER', expiresAt: 0, userId: 'provider-system-user', scopes: [],
      });
      return harness;
    }

    it('drops both tokens in the same write that records the provider-token refusal', async () => {
      const harness = providerTokenHarness();

      const error: any = await harness.start();

      expect(error.getResponse()).toEqual(expect.objectContaining({ code: OnboardingErrorCode.PERMISSIONS_INSUFFICIENT }));
      expect(harness.failedWrites()).toHaveLength(1);
      const failed = harness.failedWrites()[0];
      expect(failed.errorCode).toBe(OnboardingErrorCode.PERMISSIONS_INSUFFICIENT);
      expect(failed.exchangePayload).toEqual({
        exchangedAt: expect.any(String),
        tokensScrubbedAt: expect.any(String),
        scrubReason: OnboardingErrorCode.PERMISSIONS_INSUFFICIENT,
      });
      for (const field of TOKEN_FIELDS) {
        expect(failed.exchangePayload).not.toHaveProperty(field);
      }
      const persisted = JSON.stringify(harness.currentRow());
      expect(persisted).not.toContain('short-token');
      expect(persisted).not.toContain('long-token');
      // The audit trail never carried the values either.
      expect(JSON.stringify(harness.failureAudits())).not.toContain('long-token');
    });

    it('scrubs after any non-resumable code that happens once the tokens exist', async () => {
      const harness = createHarness();
      harness.metaGraph.getPhoneNumbersForWaba.mockResolvedValue([]);

      await harness.start();

      expect(harness.failedWrites()[0].errorCode).toBe(OnboardingErrorCode.PHONE_NOT_FOUND);
      expect(harness.failedWrites()[0].exchangePayload).toEqual(expect.objectContaining({
        scrubReason: OnboardingErrorCode.PHONE_NOT_FOUND,
      }));
      expect(JSON.stringify(harness.currentRow())).not.toContain('long-token');
    });

    it('keeps the stored tokens after a failure retryOnboarding can resume', async () => {
      const harness = createHarness();
      harness.coverage.mockRejectedValue(new ConflictException({
        code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
        userMessage: 'x',
      }));

      await harness.start();

      expect(harness.failedWrites()).toHaveLength(1);
      expect(harness.failedWrites()[0]).not.toHaveProperty('exchangePayload');
      expect(harness.currentRow()?.exchangePayload).toEqual(expect.objectContaining({
        shortLivedToken: 'short-token',
        longLivedToken: 'long-token',
      }));
    });

    it('does not invent a payload when the failure happened before the exchange stored one', async () => {
      const harness = createHarness();
      harness.metaGraph.exchangeOnboardingCode.mockRejectedValue(new MetaApiError(
        OnboardingErrorCode.CODE_EXPIRED,
        'El código de autorización de Meta ya se usó o venció.',
        'This authorization code has been used.',
        false,
      ));

      await harness.start();

      expect(harness.failedWrites()).toHaveLength(1);
      expect(harness.failedWrites()[0]).not.toHaveProperty('exchangePayload');
      expect(harness.currentRow()?.exchangePayload).toBeNull();
    });

    it('still records the failure, without tokens, when the payload cannot be read back', async () => {
      const harness = providerTokenHarness();
      harness.prisma.whatsappOnboarding.findUnique.mockRejectedValue(new Error('read replica down'));

      const error: any = await harness.start();

      expect(error.getResponse()).toEqual(expect.objectContaining({ code: OnboardingErrorCode.PERMISSIONS_INSUFFICIENT }));
      expect(harness.failedWrites()).toHaveLength(1);
      expect(harness.failureAudits()).toHaveLength(1);
      expect(harness.failedWrites()[0].exchangePayload).toEqual({
        tokensScrubbedAt: expect.any(String),
        scrubReason: OnboardingErrorCode.PERMISSIONS_INSUFFICIENT,
      });
      expect(JSON.stringify(harness.currentRow())).not.toContain('long-token');
    });
  });

  // `retryable` in the response means "show the button that opens a NEW Meta
  // window"; `retryOnboarding` is the server-side resume with the stored token.
  // Two different questions, pinned as one table so they cannot drift apart
  // silently.
  it.each([
    ['WHATSAPP_TOKEN_COVERAGE_REQUIRED', false, true],
    ['WHATSAPP_TOKEN_MISSING_WABA_SCOPE', false, true],
    // A new Meta authorization is the fix; the stored token can never read the number.
    ['WHATSAPP_TOKEN_TARGET_NOT_GRANTED', true, false],
    ['PLAN_LIMIT_REACHED', false, true],
    ['CHANNEL_ACCESS_DENIED', false, true],
    ['CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE', true, true],
    [OnboardingErrorCode.CODE_EXPIRED, true, false],
    [OnboardingErrorCode.GRAPH_API_ERROR, true, true],
    // What a coverage probe Meta did not answer surfaces as (rule T).
    [OnboardingErrorCode.RATE_LIMITED, true, true],
    [OnboardingErrorCode.EXCHANGE_FAILED, true, true],
    [OnboardingErrorCode.PHONE_NOT_FOUND, false, false],
    [OnboardingErrorCode.PERMISSIONS_INSUFFICIENT, false, false],
  ])('%s: relaunch=%s, server resume=%s', (code, relaunch, resume) => {
    expect(isRelaunchableFailure(code)).toBe(relaunch);
    expect(isServerResumableFailure(code)).toBe(resume);
  });

  describe('retryOnboarding', () => {
    const storedOnboarding = {
      id: onboardingId,
      tenantId,
      status: OnboardingStatus.FAILED,
      errorCode: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
      mode: OnboardingMode.COEXISTENCE,
      metaBusinessId: 'business-1',
      wabaId,
      phoneNumberId: phone.id,
      exchangePayload: { longLivedToken: 'stored-long-token', longLivedExpiresIn: 5184000 },
    };

    it('resumes a coverage failure with the stored token once an operator fixed the access', async () => {
      const harness = createHarness({ storedOnboarding });

      await (harness.service as any).retryOnboarding(onboardingId, user);

      expect(harness.coverage).toHaveBeenCalledWith(tenantId, wabaId, 'stored-long-token', 5184000);
      expect(harness.failedWrites()).toHaveLength(0);
    });

    it.each([
      'WHATSAPP_TOKEN_COVERAGE_REQUIRED',
      'PLAN_LIMIT_REACHED',
      'CHANNEL_ACCESS_DENIED',
      'CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE',
      OnboardingErrorCode.GRAPH_API_ERROR,
      OnboardingErrorCode.RATE_LIMITED,
    ])('accepts a FAILED onboarding with %s as resumable', async (errorCode) => {
      const harness = createHarness({ storedOnboarding: { ...storedOnboarding, errorCode } });

      await (harness.service as any).retryOnboarding(onboardingId, user);

      expect(harness.coverage).toHaveBeenCalledTimes(1);
    });

    it.each([
      OnboardingErrorCode.PHONE_NOT_FOUND,
      // The stored token is the one Meta did not grant the number to.
      'WHATSAPP_TOKEN_TARGET_NOT_GRANTED',
    ])('still refuses %s, which no server-side resume can fix', async (errorCode) => {
      const harness = createHarness({
        storedOnboarding: { ...storedOnboarding, errorCode },
      });

      await expect((harness.service as any).retryOnboarding(onboardingId, user)).rejects.toMatchObject({
        response: expect.objectContaining({ code: errorCode, retryable: false }),
      });
      expect(harness.coverage).not.toHaveBeenCalled();
    });

    it('records a failure of the resumed attempt exactly once', async () => {
      const harness = createHarness({ storedOnboarding });
      harness.coverage.mockRejectedValue(new ConflictException({
        code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
        userMessage: 'sigue sin permiso',
      }));

      const error: any = await (harness.service as any).retryOnboarding(onboardingId, user)
        .catch((e: unknown) => e);

      expect(harness.failedWrites()).toHaveLength(1);
      expect(harness.failureAudits()).toHaveLength(1);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual(expect.objectContaining({
        code: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
        userMessage: 'sigue sin permiso',
        retryable: false,
      }));
    });
  });
});
