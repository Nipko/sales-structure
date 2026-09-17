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

/**
 * Códigos que lanzan las fronteras propias del flujo (cobertura del token,
 * plan, verificación de acceso). No llevan el prefijo WA_ES_ porque el panel y
 * la API los comparten tal cual; se nombran acá para que el servicio no los
 * repita como cadenas sueltas.
 */
export const ONBOARDING_GATE_CODES = {
  /**
   * La credencial permanente guardada no lee la WABA del número nuevo y otro
   * número vivo depende de ella: no se cambia por una que vence.
   */
  TOKEN_COVERAGE_REQUIRED: 'WHATSAPP_TOKEN_COVERAGE_REQUIRED',
  /** El token nuevo lee el número que se conecta, pero no el de OTRO número ya conectado. */
  TOKEN_MISSING_WABA_SCOPE: 'WHATSAPP_TOKEN_MISSING_WABA_SCOPE',
  /**
   * El token nuevo no lee la WABA del número que se está conectando. Pasa
   * cuando en la ventana de Meta no se marcó ese número (o se eligió otra
   * cuenta de negocio). Antes salía como MISSING_WABA_SCOPE culpando a un
   * número viejo, con un mensaje de "desconecta el otro número" que no lo
   * arreglaba.
   */
  TOKEN_TARGET_NOT_GRANTED: 'WHATSAPP_TOKEN_TARGET_NOT_GRANTED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  CHANNEL_ACCESS_DENIED: 'CHANNEL_ACCESS_DENIED',
  ENTITLEMENT_CHECK_UNAVAILABLE: 'CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE',
} as const;

/**
 * Fallos que ninguna ventana nueva de Meta arregla: el mismo portafolio
 * devuelve el mismo token sin permiso sobre la WABA de OTRO número ya
 * conectado, y el plan no cambia por volver a autorizar. Mostrar "Reintentar"
 * ahí es mandar a la persona a repetir seis veces lo mismo.
 */
const NOT_RELAUNCHABLE_FAILURES = new Set<string>([
  ONBOARDING_GATE_CODES.TOKEN_COVERAGE_REQUIRED,
  ONBOARDING_GATE_CODES.TOKEN_MISSING_WABA_SCOPE,
  ONBOARDING_GATE_CODES.PLAN_LIMIT_REACHED,
  ONBOARDING_GATE_CODES.CHANNEL_ACCESS_DENIED,
]);

/**
 * Fallos donde abrir la ventana de Meta otra vez SÍ es el siguiente paso: la
 * verificación de acceso estaba caída un momento, el código OAuth ya se gastó
 * y hace falta uno nuevo (que sólo sale de una ventana nueva), o Meta no nos
 * dio el número que se quiere conectar — elegirlo en esa ventana es justamente
 * lo que falta.
 */
const RELAUNCHABLE_FAILURES = new Set<string>([
  ONBOARDING_GATE_CODES.ENTITLEMENT_CHECK_UNAVAILABLE,
  ONBOARDING_GATE_CODES.TOKEN_TARGET_NOT_GRANTED,
  OnboardingErrorCode.CODE_EXPIRED,
]);

/**
 * El `retryable` que viaja al panel: "muestra el botón que abre una ventana
 * NUEVA de Meta". No es lo mismo que `MetaApiError.retryable`, que decide si
 * `withRetry` reenvía la misma petición.
 */
export function isRelaunchableFailure(code: string): boolean {
  if (NOT_RELAUNCHABLE_FAILURES.has(code)) return false;
  if (RELAUNCHABLE_FAILURES.has(code)) return true;
  return RETRYABLE_ERRORS.has(code as OnboardingErrorCode);
}

/**
 * Fallos que `retryOnboarding` puede retomar en el servidor con el token ya
 * guardado. Además de los transitorios, los que arregla un operador o un
 * cambio de plan sin que el cliente vuelva a autorizar: dar acceso a la WABA,
 * desconectar el número muerto, subir el plan o esperar a que vuelva la
 * verificación de acceso.
 *
 * TOKEN_TARGET_NOT_GRANTED NO está acá, a propósito: el token guardado es
 * justamente el que Meta emitió sin el número, y ningún operador le agrega ese
 * permiso. Sólo una autorización nueva lo trae, así que el fallo tampoco
 * conserva los tokens en `exchange_payload` (el borrado sigue a este conjunto).
 */
const OPERATOR_RESUMABLE_FAILURES = new Set<string>([
  ONBOARDING_GATE_CODES.TOKEN_COVERAGE_REQUIRED,
  ONBOARDING_GATE_CODES.TOKEN_MISSING_WABA_SCOPE,
  ONBOARDING_GATE_CODES.PLAN_LIMIT_REACHED,
  ONBOARDING_GATE_CODES.CHANNEL_ACCESS_DENIED,
  ONBOARDING_GATE_CODES.ENTITLEMENT_CHECK_UNAVAILABLE,
]);

export function isServerResumableFailure(code: string): boolean {
  return RETRYABLE_ERRORS.has(code as OnboardingErrorCode) || OPERATOR_RESUMABLE_FAILURES.has(code);
}
