import { of, throwError } from 'rxjs';
import { OnboardingErrorCode } from '../../common/enums/onboarding-error.enum';
import { MetaApiError, MetaGraphService, classifyMetaReadFailure } from './meta-graph.service';

describe('MetaGraphService', () => {
  it('retains the parent Business Portfolio ID while flattening WABAs', async () => {
    const httpService = {
      get: jest.fn().mockReturnValue(of({
        data: {
          data: [
            {
              id: 'business-1',
              name: 'Portfolio One',
              owned_whatsapp_business_accounts: {
                data: [
                  {
                    id: 'waba-1',
                    name: 'WABA One',
                    currency: 'COP',
                    timezone_id: '5',
                    message_template_namespace: 'namespace-1',
                  },
                ],
              },
            },
          ],
        },
      })),
    };
    const config = {
      get: jest.fn((key: string) => ({
        'meta.graphVersion': 'v25.0',
        'meta.graphBaseUrl': 'https://graph.facebook.com',
        'meta.discoveryTimeout': 10000,
      })[key]),
    };
    const service = new MetaGraphService(httpService as any, config as any);

    await expect(service.getBusinessAccountsForToken('token')).resolves.toEqual([
      expect.objectContaining({
        id: 'waba-1',
        name: 'WABA One',
        businessId: 'business-1',
        businessName: 'Portfolio One',
      }),
    ]);
    expect(httpService.get).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/me/businesses',
      expect.objectContaining({
        params: expect.objectContaining({
          access_token: 'token',
          fields: expect.stringContaining('owned_whatsapp_business_accounts'),
        }),
      }),
    );
  });

  // ── A spent OAuth code ─────────────────────────────────────────────────────
  //
  // El SDK de Facebook guarda el último `authResponse.code` y se lo entrega a
  // un `FB.login` posterior cuando la ventana se cierra sin terminar. Ese código
  // ya se canjeó: Meta responde "This authorization code has been used." y el
  // servicio lo reportaba como un fallo genérico del intercambio, invitando a
  // reintentar algo que nunca va a funcionar. Es de un solo uso — no se reenvía.
  describe('exchangeOnboardingCode with a spent code', () => {
    function exchangeHarness(metaError: Record<string, unknown>, status = 400) {
      const axiosError = Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status, data: { error: metaError } },
      });
      const httpService = { get: jest.fn().mockReturnValue(throwError(() => axiosError)) };
      const config = {
        get: jest.fn((key: string) => ({
          'meta.graphVersion': 'v25.0',
          'meta.graphBaseUrl': 'https://graph.facebook.com',
          'meta.appId': 'app-1',
          'meta.appSecret': 'secret-1',
          'meta.exchangeTimeout': 1000,
          'meta.maxRetries': 3,
          'meta.retryDelay': 1,
        })[key]),
      };
      const service = new MetaGraphService(httpService as any, config as any);
      const exchange = () => service.exchangeOnboardingCode('used-code', 'config-1').catch((e: unknown) => e);
      return { httpService, exchange };
    }

    it('maps "authorization code has been used" to WA_ES_CODE_EXPIRED and never re-sends it', async () => {
      const { httpService, exchange } = exchangeHarness({
        code: 100,
        error_subcode: 36009,
        message: 'This authorization code has been used.',
      });

      const error: any = await exchange();

      expect(error).toBeInstanceOf(MetaApiError);
      expect(error.code).toBe(OnboardingErrorCode.CODE_EXPIRED);
      expect(error.retryable).toBe(false);
      expect(error.userMessage).toBe(
        'El código de autorización de Meta ya se usó o venció. Abre de nuevo la ventana de Meta y complétala sin cerrarla.',
      );
      expect(error.message).toContain('authorization code has been used');
      expect(httpService.get).toHaveBeenCalledTimes(1);
    });

    it.each([
      [{ code: 100, error_subcode: 36007, message: 'Invalid verification code format.' }],
      [{ code: 100, message: 'Code has expired.' }],
      [{ code: 190, message: 'This authorization code has expired.' }],
    ])('also recognises %j as a spent code', async (metaError) => {
      const { httpService, exchange } = exchangeHarness(metaError);

      const error: any = await exchange();

      expect(error.code).toBe(OnboardingErrorCode.CODE_EXPIRED);
      expect(error.retryable).toBe(false);
      expect(httpService.get).toHaveBeenCalledTimes(1);
    });

    it('keeps any other 400 as EXCHANGE_FAILED', async () => {
      const { httpService, exchange } = exchangeHarness({
        code: 100,
        message: 'Invalid client_id',
      });

      const error: any = await exchange();

      expect(error).toBeInstanceOf(MetaApiError);
      expect(error.code).toBe(OnboardingErrorCode.EXCHANGE_FAILED);
      expect(httpService.get).toHaveBeenCalledTimes(1);
    });

    // Un 200 sin `access_token` no es un fallo pasajero: Meta ya recibió el
    // código, y el código es de un solo uso. Marcarlo reintentable hacía que
    // `withRetry` lo reenviara hasta tres veces, y la segunda respuesta ya sólo
    // podía ser "este código ya se usó".
    it('never re-sends the code when Meta answers 200 without an access_token', async () => {
      const httpService = {
        get: jest.fn().mockReturnValue(of({ data: { token_type: 'bearer', hint: 'value-that-must-not-be-echoed' } })),
      };
      const config = {
        get: jest.fn((key: string) => ({
          'meta.graphVersion': 'v25.0',
          'meta.graphBaseUrl': 'https://graph.facebook.com',
          'meta.maxRetries': 3,
          'meta.retryDelay': 1,
        })[key]),
      };
      const service = new MetaGraphService(httpService as any, config as any);

      const error: any = await service.exchangeOnboardingCode('fresh-code', 'config-1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MetaApiError);
      expect(error.code).toBe(OnboardingErrorCode.EXCHANGE_FAILED);
      expect(error.retryable).toBe(false);
      expect(httpService.get).toHaveBeenCalledTimes(1);
      // The technical message names what came back, not its values.
      expect(error.message).not.toContain('value-that-must-not-be-echoed');
      // The person reads this one: no "token de acceso", and the next step is
      // the only one that can work — a new Meta window, since the code is spent.
      expect(error.userMessage).not.toMatch(/token|waba|embedded signup|credencial|scope/i);
      expect(error.userMessage).toMatch(/ventana de Meta/i);
      expect(error.userMessage).toMatch(/soporte/i);
    });

    it('only reclassifies the code exchange, not other calls that mention expiry', async () => {
      const axiosError = Object.assign(new Error('Request failed with status code 400'), {
        response: { status: 400, data: { error: { code: 190, message: 'Session has expired' } } },
      });
      const httpService = { get: jest.fn().mockReturnValue(throwError(() => axiosError)) };
      const config = { get: jest.fn((key: string) => (key === 'meta.retryDelay' ? 1 : undefined)) };
      const service = new MetaGraphService(httpService as any, config as any);

      const error: any = await service.getWabaDirectly('waba-1', 'token').catch((e: unknown) => e);

      expect(error.code).toBe(OnboardingErrorCode.WABA_NOT_FOUND);
    });
  });

  // ── What a failed read says about access (rule T) ─────────────────────────
  //
  // The onboarding coverage check decides whether a stored permanent credential
  // "does not cover" a WABA from a failed `getWabaDirectly`. Only a REFUSAL —
  // Meta answered 4xx with a Graph error that is not throttling — is evidence
  // about access. A timeout, a 5xx or a throttle is Meta having a bad minute,
  // and read as "does not cover" it swapped a working permanent credential for
  // one that expires. Every case goes through the real retry + error mapping.
  describe('classifyMetaReadFailure', () => {
    const graphError = (status: number, error: Record<string, unknown>) => ({
      message: `Request failed with status code ${status}`,
      response: { status, data: { error } },
    });

    async function failedRead(raw: Record<string, unknown>) {
      const httpService = { get: jest.fn(() => throwError(() => Object.assign(new Error(String(raw.message)), raw))) };
      const config = { get: jest.fn((key: string) => ({ 'meta.maxRetries': 3, 'meta.retryDelay': 1 } as Record<string, number>)[key]) };
      const service = new MetaGraphService(httpService as any, config as any);
      const error = await service.getWabaDirectly('waba-1', 'token').catch((e: unknown) => e);
      return { error, httpService };
    }

    it.each<[string, Record<string, unknown>, 'denied' | 'transient', boolean]>([
      ['403 permission error', graphError(403, { code: 200, type: 'OAuthException', message: '(#200) Permissions error' }), 'denied', false],
      ['400 unsupported get request', graphError(400, { code: 100, error_subcode: 33, type: 'GraphMethodException', message: 'Unsupported get request.' }), 'denied', false],
      ['401 invalid OAuth token', graphError(401, { code: 190, type: 'OAuthException', message: 'Error validating access token' }), 'denied', false],
      ['404 with a Graph error', graphError(404, { code: 803, type: 'OAuthException', message: 'Some of the aliases you requested do not exist' }), 'denied', false],
      ['a timeout (no response)', { message: 'timeout of 10000ms exceeded', code: 'ECONNABORTED' }, 'transient', false],
      ['a DNS failure (no response)', { message: 'getaddrinfo ENOTFOUND graph.facebook.com', code: 'ENOTFOUND' }, 'transient', false],
      ['a connection reset (no response)', { message: 'socket hang up', code: 'ECONNRESET' }, 'transient', false],
      ['500 with a Graph error', graphError(500, { code: 1, type: 'OAuthException', message: 'An unknown error occurred' }), 'transient', false],
      ['503 without a Graph body', { message: 'Request failed with status code 503', response: { status: 503, data: 'Service Unavailable' } }, 'transient', false],
      ['429', { message: 'Request failed with status code 429', response: { status: 429, data: {} } }, 'transient', true],
      ['400 code 4 (app throttling)', graphError(400, { code: 4, message: '(#4) Application request limit reached' }), 'transient', true],
      ['400 code 17 (user throttling)', graphError(400, { code: 17, message: '(#17) User request limit reached' }), 'transient', true],
      ['400 code 32 (page throttling)', graphError(400, { code: 32, message: '(#32) Page request limit reached' }), 'transient', true],
      ['400 code 613 (custom throttling)', graphError(400, { code: 613, message: 'Calls to this api have exceeded the rate limit.' }), 'transient', true],
      ['400 code 80007 (WhatsApp business use case throttling)', graphError(400, { code: 80007, type: 'OAuthException', message: 'Too many calls' }), 'transient', true],
      ['400 Graph error Meta flags as transient', graphError(400, { code: 190, type: 'OAuthException', message: 'Temporary', is_transient: true }), 'transient', false],
      ['400 code 2 (service temporarily unavailable)', graphError(400, { code: 2, message: 'Service temporarily unavailable' }), 'transient', false],
      ['408 without a Graph body', { message: 'Request failed with status code 408', response: { status: 408, data: '' } }, 'transient', false],
    ])('%s -> %s', async (_label, raw, kind, rateLimited) => {
      const { error } = await failedRead(raw);

      expect(error).toBeInstanceOf(MetaApiError);
      expect(classifyMetaReadFailure(error)).toEqual(expect.objectContaining({ kind, rateLimited }));
    });

    it('reads an error that never reached Meta as transient', () => {
      expect(classifyMetaReadFailure(new Error('boom'))).toEqual(expect.objectContaining({ kind: 'transient', rateLimited: false }));
      expect(classifyMetaReadFailure(undefined)).toEqual(expect.objectContaining({ kind: 'transient', rateLimited: false }));
    });

    it.each([17, 613, 80007])('maps Graph throttling code %i to RATE_LIMITED and retries it', async (code) => {
      const { error, httpService } = await failedRead(graphError(400, { code, message: 'throttled' }));

      expect((error as MetaApiError).code).toBe(OnboardingErrorCode.RATE_LIMITED);
      expect((error as MetaApiError).retryable).toBe(true);
      expect(httpService.get).toHaveBeenCalledTimes(3);
    });

    it('never retries a refusal', async () => {
      const { error, httpService } = await failedRead(graphError(403, { code: 200, type: 'OAuthException', message: '(#200) Permissions error' }));

      expect((error as MetaApiError).retryable).toBe(false);
      expect(httpService.get).toHaveBeenCalledTimes(1);
    });
  });
});
