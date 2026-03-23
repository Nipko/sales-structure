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
   * Suscribe la app de Meta al WABA para recibir webhooks
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
        return response.data.success === true;
      } catch (error: any) {
        if (error instanceof MetaApiError) throw error;
        this.handleMetaApiError(error, OnboardingErrorCode.WEBHOOK_INVALID, 'No se pudo suscribir el webhook al WABA');
      }
    });
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
}
