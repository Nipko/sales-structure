/**
 * Códigos de error internos del servicio WhatsApp Onboarding
 * Prefijo: WA_ES_ (WhatsApp Embedded Signup)
 */
export enum OnboardingErrorCode {
  USER_CANCELLED = 'WA_ES_USER_CANCELLED',
  CODE_MISSING = 'WA_ES_CODE_MISSING',
  CODE_EXPIRED = 'WA_ES_CODE_EXPIRED',
  EXCHANGE_FAILED = 'WA_ES_EXCHANGE_FAILED',
  CONFIG_INVALID = 'WA_ES_CONFIG_INVALID',
  PERMISSIONS_INSUFFICIENT = 'WA_ES_PERMISSIONS_INSUFFICIENT',
  WABA_NOT_FOUND = 'WA_ES_WABA_NOT_FOUND',
  PHONE_NOT_FOUND = 'WA_ES_PHONE_NOT_FOUND',
  WEBHOOK_INVALID = 'WA_ES_WEBHOOK_INVALID',
  DUPLICATE_CUSTOMER_BINDING = 'WA_ES_DUPLICATE_CUSTOMER_BINDING',
  COEXISTENCE_NOT_ACKNOWLEDGED = 'WA_ES_COEXISTENCE_NOT_ACKNOWLEDGED',
  RATE_LIMITED = 'WA_ES_RATE_LIMITED',
  GRAPH_API_ERROR = 'WA_ES_GRAPH_API_ERROR',
  TENANT_NOT_FOUND = 'WA_ES_TENANT_NOT_FOUND',
  ONBOARDING_NOT_FOUND = 'WA_ES_ONBOARDING_NOT_FOUND',
  INVALID_STATE_TRANSITION = 'WA_ES_INVALID_STATE_TRANSITION',
  TOKEN_EXCHANGE_FAILED = 'WA_ES_TOKEN_EXCHANGE_FAILED',
  PHONE_REGISTRATION_FAILED = 'WA_ES_PHONE_REGISTRATION_FAILED',
  BUSINESS_NOT_VERIFIED = 'WA_ES_BUSINESS_NOT_VERIFIED',
  TOKEN_EXPIRED = 'WA_ES_TOKEN_EXPIRED',
}

/**
 * Estructura de error estandarizada del servicio
 */
export interface OnboardingError {
  code: OnboardingErrorCode;
  userMessage: string;       // Mensaje amigable para mostrar al usuario/admin
  technicalMessage: string;  // Detalle técnico para logs
  retryable: boolean;        // Si es seguro reintentar automáticamente
}

/**
 * Mapa de errores conocidos con información de retry
 */
export const RETRYABLE_ERRORS = new Set([
  OnboardingErrorCode.EXCHANGE_FAILED,
  OnboardingErrorCode.RATE_LIMITED,
  OnboardingErrorCode.GRAPH_API_ERROR,
  OnboardingErrorCode.WEBHOOK_INVALID,
  OnboardingErrorCode.TOKEN_EXCHANGE_FAILED,
]);
