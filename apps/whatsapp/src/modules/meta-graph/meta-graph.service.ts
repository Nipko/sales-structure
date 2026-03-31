import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { OnboardingErrorCode } from '../../common/enums/onboarding-error.enum';

export class MetaApiError extends Error {
  constructor(
    public readonly code: OnboardingErrorCode,
    public readonly userMessage: string,
    message: string,
    public readonly retryable = false,
    public readonly originalError?: any,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

export interface ExchangeCodeResult {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
}

export interface WabaInfo {
  id: string;
  name: string;
  currency?: string;
  timezoneId?: string;
  messageTemplateNamespace?: string;
}

export interface PhoneNumberInfo {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating?: string;
  status?: string;
  codeVerificationStatus?: string;
  isOfficialBusinessAccount?: boolean;
}

export interface TemplateInfo {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: any[];
}

export interface TokenDebugInfo {
  appId: string;
  type: string;
  isValid: boolean;
  expiresAt: number;
  scopes: string[];
  userId?: string;
  granularScopes?: Array<{ scope: string; target_ids?: string[] }>;
}

@Injectable()
export class MetaGraphService {
  private readonly logger = new Logger(MetaGraphService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    const version = this.config.get<string>('meta.graphVersion');
    return `${this.config.get<string>('meta.graphBaseUrl')}/${version}`;
  }

  /**
   * Intercambia el code de Embedded Signup por un access token
   * Paso 1 del flujo completo de onboarding
   */
  async exchangeOnboardingCode(code: string, configId: string): Promise<ExchangeCodeResult> {
    const appId = this.config.get<string>('meta.appId');
    const appSecret = this.config.get<string>('meta.appSecret');
    const timeout = this.config.get<number>('meta.exchangeTimeout');

    this.logger.log(`Exchanging onboarding code for configId: ${configId}`);

    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.get(`${this.baseUrl}/oauth/access_token`, {
            params: {
              client_id: appId,
              client_secret: appSecret,
              code,
            },
            timeout,
          }),
        );

        if (!response.data.access_token) {
          throw new MetaApiError(
            OnboardingErrorCode.EXCHANGE_FAILED,
            'No se pudo obtener el token de acceso de Meta',
            `Exchange returned no access_token: ${JSON.stringify(response.data)}`,
            true,
          );
        }

        this.logger.log('Code exchange successful');
        return {
          accessToken: response.data.access_token,
          tokenType: response.data.token_type || 'bearer',
          expiresIn: response.data.expires_in,
        };
      } catch (error: any) {
        if (error instanceof MetaApiError) throw error;
        this.handleMetaApiError(error, OnboardingErrorCode.EXCHANGE_FAILED, 'Fallo en el intercambio del código de Meta');
      }
    });
  }

  /**
   * Obtiene las WABAs vinculadas al token del usuario
   */
  async getBusinessAccountsForToken(accessToken: string): Promise<WabaInfo[]> {
    this.logger.log('Fetching WABA list for token');

    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.get(`${this.baseUrl}/me/businesses`, {
            params: {
              fields: 'name,owned_whatsapp_business_accounts{id,name,currency,timezone_id,message_template_namespace}',
              access_token: accessToken,
            },
            timeout: this.config.get<number>('meta.discoveryTimeout'),
          }),
        );

        const businesses = response.data.data || [];
        const wabas: WabaInfo[] = [];

        for (const business of businesses) {
          const ownedWabas = business.owned_whatsapp_business_accounts?.data || [];
          for (const waba of ownedWabas) {
            wabas.push({
              id: waba.id,
              name: waba.name,
              currency: waba.currency,
              timezoneId: waba.timezone_id,
              messageTemplateNamespace: waba.message_template_namespace,
            });
          }
        }

        return wabas;
      } catch (error: any) {
        if (error instanceof MetaApiError) throw error;
        this.handleMetaApiError(error, OnboardingErrorCode.WABA_NOT_FOUND, 'No se pudo obtener la WABA del cliente');
      }
    });
  }

  /**
   * Obtiene los números de teléfono de una WABA
   */
  async getPhoneNumbersForWaba(wabaId: string, accessToken: string): Promise<PhoneNumberInfo[]> {
    this.logger.log(`Fetching phone numbers for WABA: ${wabaId}`);

    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.get(`${this.baseUrl}/${wabaId}/phone_numbers`, {
            params: {
              fields: 'id,display_phone_number,verified_name,quality_rating,status,code_verification_status,is_official_business_account',
              access_token: accessToken,
            },
            timeout: this.config.get<number>('meta.discoveryTimeout'),
          }),
        );

        return (response.data.data || []).map((p: any) => ({
          id: p.id,
          displayPhoneNumber: p.display_phone_number,
          verifiedName: p.verified_name,
          qualityRating: p.quality_rating,
          status: p.status,
          codeVerificationStatus: p.code_verification_status,
          isOfficialBusinessAccount: p.is_official_business_account,
        }));
      } catch (error: any) {
        if (error instanceof MetaApiError) throw error;
        this.handleMetaApiError(error, OnboardingErrorCode.PHONE_NOT_FOUND, 'No se pudo obtener los números del WABA');
      }
    });
  }

  /**
   * Obtiene los templates de una WABA
   */
  async getTemplatesForWaba(wabaId: string, accessToken: string): Promise<TemplateInfo[]> {
    this.logger.log(`Fetching templates for WABA: ${wabaId}`);

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/${wabaId}/message_templates`, {
          params: {
            fields: 'id,name,language,category,status,components',
            access_token: accessToken,
            limit: 100,
          },
          timeout: this.config.get<number>('meta.discoveryTimeout'),
        }),
      );

      return (response.data.data || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components || [],
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to fetch templates for WABA ${wabaId}: ${error.message}`);
      return []; // No es crítico, devolvemos vacío
    }
  }

  /**
   * Suscribe la app de Meta al WABA para recibir webhooks.
   * NOTE: The accessToken must have the `whatsapp_business_management` permission
   * for this call to succeed. For Tech Partners using Embedded Signup, this
   * permission is granted during the Facebook Login flow.
   */
  async subscribeAppToWaba(wabaId: string, accessToken: string): Promise<boolean> {
    this.logger.log(`Subscribing app to WABA: ${wabaId}`);

    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `${this.baseUrl}/${wabaId}/subscribed_apps`,
            {},
            {
              params: { access_token: accessToken },
              timeout: this.config.get<number>('meta.webhookTimeout'),
            },
          ),
        );

        this.logger.log(`subscribeAppToWaba response for WABA ${wabaId}: ${JSON.stringify(response.data)}`);
        return response.data.success === true;
      } catch (error: any) {
        if (error instanceof MetaApiError) throw error;
        this.handleMetaApiError(error, OnboardingErrorCode.WEBHOOK_INVALID, 'No se pudo suscribir el webhook al WABA');
      }
    });
  }

  /**
   * Exchanges a short-lived user token (~1h) for a long-lived token (~60 days).
   * Required after Embedded Signup to persist access beyond the initial session.
   */
  async exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    const appId = this.config.get<string>('meta.appId');
    const appSecret = this.config.get<string>('meta.appSecret');
    const timeout = this.config.get<number>('meta.exchangeTimeout');

    this.logger.log('Exchanging short-lived token for long-lived token');

    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.get(`${this.baseUrl}/oauth/access_token`, {
            params: {
              grant_type: 'fb_exchange_token',
              client_id: appId,
              client_secret: appSecret,
              fb_exchange_token: shortLivedToken,
            },
            timeout,
          }),
        );

        this.logger.log(`Long-lived token exchange response: token_type=${response.data.token_type}, expires_in=${response.data.expires_in}`);

        if (!response.data.access_token) {
          throw new MetaApiError(
            OnboardingErrorCode.TOKEN_EXCHANGE_FAILED,
            'No se pudo obtener el token de larga duración de Meta',
            `Token exchange returned no access_token: ${JSON.stringify(response.data)}`,
            true,
          );
        }

        return {
          accessToken: response.data.access_token,
          expiresIn: response.data.expires_in,
        };
      } catch (error: any) {
        if (error instanceof MetaApiError) throw error;
        this.handleMetaApiError(error, OnboardingErrorCode.TOKEN_EXCHANGE_FAILED, 'Fallo en el intercambio de token de larga duración');
      }
    });
  }

  /**
   * Verifies a token and retrieves its metadata using the Debug Token API.
   * Uses app_id|app_secret as the access_token (app token format).
   */
  async debugToken(token: string): Promise<TokenDebugInfo> {
    const appId = this.config.get<string>('meta.appId');
    const appSecret = this.config.get<string>('meta.appSecret');
    const timeout = this.config.get<number>('meta.discoveryTimeout');

    this.logger.log('Debugging token via Meta API');

    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.get(`${this.baseUrl}/debug_token`, {
            params: {
              input_token: token,
              access_token: `${appId}|${appSecret}`,
            },
            timeout,
          }),
        );

        const data = response.data?.data;
        this.logger.log(`debugToken response: is_valid=${data?.is_valid}, type=${data?.type}, expires_at=${data?.expires_at}`);

        if (!data) {
          throw new MetaApiError(
            OnboardingErrorCode.TOKEN_EXPIRED,
            'No se pudo verificar el token de Meta',
            `debug_token returned no data: ${JSON.stringify(response.data)}`,
            false,
          );
        }

        return {
          appId: data.app_id,
          type: data.type,
          isValid: data.is_valid,
          expiresAt: data.expires_at,
          scopes: data.scopes || [],
          userId: data.user_id,
          granularScopes: data.granular_scopes,
        };
      } catch (error: any) {
        if (error instanceof MetaApiError) throw error;
        this.handleMetaApiError(error, OnboardingErrorCode.TOKEN_EXPIRED, 'No se pudo verificar el token de Meta');
      }
    });
  }

  /**
   * Registers a phone number for WhatsApp Cloud API usage.
   * Required for newly added numbers before they can send/receive messages.
   * If no PIN is provided, a random 6-digit PIN is generated for two-step verification.
   */
  async registerPhoneNumber(phoneNumberId: string, accessToken: string, pin?: string): Promise<boolean> {
    const resolvedPin = pin || this.generateRandomPin();
    const timeout = this.config.get<number>('meta.webhookTimeout');

    this.logger.log(`Registering phone number: ${phoneNumberId} (pin ${pin ? 'provided' : 'auto-generated'})`);

    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `${this.baseUrl}/${phoneNumberId}/register`,
            {
              messaging_product: 'whatsapp',
              pin: resolvedPin,
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              timeout,
            },
          ),
        );

        this.logger.log(`registerPhoneNumber response for ${phoneNumberId}: ${JSON.stringify(response.data)}`);
        return response.data.success === true;
      } catch (error: any) {
        if (error instanceof MetaApiError) throw error;
        this.handleMetaApiError(error, OnboardingErrorCode.PHONE_REGISTRATION_FAILED, 'No se pudo registrar el número de teléfono en WhatsApp');
      }
    });
  }

  /**
   * Checks whether the client's Meta Business is verified.
   * Returns the verification_status: 'verified', 'not_verified', or 'pending'.
   */
  async getBusinessVerificationStatus(businessId: string, accessToken: string): Promise<string> {
    const timeout = this.config.get<number>('meta.discoveryTimeout');

    this.logger.log(`Checking business verification status for: ${businessId}`);

    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.get(`${this.baseUrl}/${businessId}`, {
            params: {
              fields: 'verification_status',
              access_token: accessToken,
            },
            timeout,
          }),
        );

        const status = response.data.verification_status || 'not_verified';
        this.logger.log(`Business ${businessId} verification_status: ${status}`);
        return status;
      } catch (error: any) {
        if (error instanceof MetaApiError) throw error;
        this.handleMetaApiError(error, OnboardingErrorCode.BUSINESS_NOT_VERIFIED, 'No se pudo obtener el estado de verificación del negocio');
      }
    });
  }

  /**
   * Retrieves WABA info directly by its ID, without going through /me/businesses discovery.
   * Useful when the WABA ID is already known (e.g., from Embedded Signup callback).
   */
  async getWabaDirectly(wabaId: string, accessToken: string): Promise<WabaInfo> {
    const timeout = this.config.get<number>('meta.discoveryTimeout');

    this.logger.log(`Fetching WABA directly by ID: ${wabaId}`);

    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.get(`${this.baseUrl}/${wabaId}`, {
            params: {
              fields: 'id,name,currency,timezone_id,message_template_namespace',
              access_token: accessToken,
            },
            timeout,
          }),
        );

        this.logger.log(`getWabaDirectly response for ${wabaId}: id=${response.data.id}, name=${response.data.name}`);

        return {
          id: response.data.id,
          name: response.data.name,
          currency: response.data.currency,
          timezoneId: response.data.timezone_id,
          messageTemplateNamespace: response.data.message_template_namespace,
        };
      } catch (error: any) {
        if (error instanceof MetaApiError) throw error;
        this.handleMetaApiError(error, OnboardingErrorCode.WABA_NOT_FOUND, 'No se pudo obtener la información del WABA');
      }
    });
  }

  /**
   * Generate a permanent System User Token for a WABA (Tech Partner flow).
   *
   * As a Tech Partner, after getting the client's long-lived token, you should:
   * 1. Create a System User in YOUR Business Manager (done once in Meta Business Settings)
   * 2. Assign the client's WABA to your System User
   * 3. Generate a permanent token for that System User scoped to the WABA
   *
   * This method handles step 2+3. The System User ID must be pre-configured
   * in the environment as SYSTEM_USER_ID.
   *
   * Docs: https://developers.facebook.com/docs/marketing-api/system-users
   */
  async generateSystemUserToken(
    wabaId: string,
    clientToken: string,
  ): Promise<{ accessToken: string; tokenType: string } | null> {
    const systemUserId = this.config.get<string>('meta.systemUserId');
    const appId = this.config.get<string>('meta.appId');
    const appSecret = this.config.get<string>('meta.appSecret');
    const timeout = this.config.get<number>('meta.exchangeTimeout');

    if (!systemUserId) {
      this.logger.warn(
        'SYSTEM_USER_ID not configured — skipping permanent token generation. ' +
        'Using long-lived token instead (expires in ~60 days). ' +
        'To get permanent tokens, create a System User in Meta Business Settings ' +
        'and set SYSTEM_USER_ID in your environment.',
      );
      return null;
    }

    this.logger.log(`Generating System User Token for WABA ${wabaId}, System User ${systemUserId}`);

    try {
      // Step 1: Assign the WABA to the System User with full_control
      this.logger.log(`Assigning WABA ${wabaId} to System User ${systemUserId}`);
      await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/${wabaId}/assigned_users`,
          { user: systemUserId, tasks: ['MANAGE'] },
          {
            params: { access_token: clientToken },
            timeout,
          },
        ),
      ).catch((err: any) => {
        // 368 = already assigned — that's fine
        if (err?.response?.data?.error?.code !== 368) {
          this.logger.warn(`WABA assignment warning: ${err?.response?.data?.error?.message || err.message}`);
        }
      });

      // Step 2: Generate a token for the System User scoped to the app
      this.logger.log(`Generating token for System User ${systemUserId}`);
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/${systemUserId}/access_tokens`,
          {
            business_app: appId,
            scope: 'whatsapp_business_management,whatsapp_business_messaging',
            appsecret_proof: this.generateAppSecretProof(appSecret, clientToken),
          },
          {
            params: { access_token: clientToken },
            timeout,
          },
        ),
      );

      if (response.data?.access_token) {
        this.logger.log('System User Token generated successfully (permanent)');
        return {
          accessToken: response.data.access_token,
          tokenType: 'system_user',
        };
      }

      this.logger.warn('System User Token generation returned no token — falling back to long-lived');
      return null;
    } catch (error: any) {
      this.logger.warn(`System User Token generation failed (will use long-lived token): ${error.message}`);
      return null;
    }
  }

  /**
   * Generate appsecret_proof for secure Graph API calls.
   * Required by some endpoints when app-level security is enabled.
   */
  private generateAppSecretProof(appSecret: string, accessToken: string): string {
    const crypto = require('crypto');
    return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
  }

  /**
   * Envía un mensaje de prueba para verificar que el canal está operativo
   */
  async sendTestMessage(phoneNumberId: string, accessToken: string, toPhone: string): Promise<string | null> {
    this.logger.log(`Sending test message from phoneNumberId: ${phoneNumberId} to: ${toPhone}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: toPhone,
            type: 'text',
            text: { body: '✅ Tu cuenta de WhatsApp Business fue conectada exitosamente a Parallext.' },
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          },
        ),
      );

      return response.data?.messages?.[0]?.id || null;
    } catch (error: any) {
      this.logger.warn(`Test message failed (non-critical): ${error.message}`);
      return null; // No lanzamos error — el test message es opcional
    }
  }

  /**
   * Retry con exponential backoff
   */
  private async withRetry<T>(fn: () => Promise<T>, remainingAttempts?: number): Promise<T> {
    const maxRetries = this.config.get<number>('meta.maxRetries') || 3;
    const baseDelay = this.config.get<number>('meta.retryDelay') || 1000;
    const attempts = remainingAttempts ?? maxRetries;

    try {
      return await fn();
    } catch (error: any) {
      const isRetryable = error instanceof MetaApiError ? error.retryable :
        (error?.response?.status === 429 || error?.response?.status >= 500);

      if (isRetryable && attempts > 1) {
        const delay = baseDelay * (maxRetries - attempts + 1);
        this.logger.warn(`Meta API error, retrying in ${delay}ms (${attempts - 1} attempts left)...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.withRetry(fn, attempts - 1);
      }

      throw error;
    }
  }

  /**
   * Convierte errores de Axios/Meta en MetaApiError con contexto
   */
  private handleMetaApiError(error: any, defaultCode: OnboardingErrorCode, userMessage: string): never {
    const metaError = error?.response?.data?.error;
    const statusCode = error?.response?.status;
    const isRateLimit = statusCode === 429 || metaError?.code === 4 || metaError?.code === 32;

    if (isRateLimit) {
      throw new MetaApiError(
        OnboardingErrorCode.RATE_LIMITED,
        'Meta está limitando las solicitudes. Por favor intenta en unos momentos.',
        `Meta rate limit: ${JSON.stringify(metaError)}`,
        true,
        error,
      );
    }

    const code = statusCode >= 500 ? defaultCode : (metaError?.code ? defaultCode : defaultCode);
    const retryable = statusCode >= 500 || isRateLimit;

    this.logger.error(`Meta API Error [${code}]: ${JSON.stringify(metaError)} | Status: ${statusCode}`);

    throw new MetaApiError(
      code,
      userMessage,
      metaError?.message || error?.message || 'Unknown Meta API error',
      retryable,
      error,
    );
  }

  /**
   * Generates a random 6-digit PIN for two-step verification during phone registration.
   */
  private generateRandomPin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
