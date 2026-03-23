/**
 * Estados del proceso de onboarding WhatsApp Embedded Signup v4
 * Flujo: CREATED → CODE_RECEIVED → EXCHANGE_COMPLETED → ASSETS_DISCOVERED → WEBHOOK_VALIDATED → COMPLETED
 */
export enum OnboardingStatus {
  CREATED = 'CREATED',
  CODE_RECEIVED = 'CODE_RECEIVED',
  EXCHANGE_IN_PROGRESS = 'EXCHANGE_IN_PROGRESS',
  EXCHANGE_COMPLETED = 'EXCHANGE_COMPLETED',
  ASSET_DISCOVERY_IN_PROGRESS = 'ASSET_DISCOVERY_IN_PROGRESS',
  ASSETS_DISCOVERED = 'ASSETS_DISCOVERED',
  WEBHOOK_VALIDATION_IN_PROGRESS = 'WEBHOOK_VALIDATION_IN_PROGRESS',
  WEBHOOK_VALIDATED = 'WEBHOOK_VALIDATED',
  TEST_MESSAGE_IN_PROGRESS = 'TEST_MESSAGE_IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  COMPLETED_WITH_WARNINGS = 'COMPLETED_WITH_WARNINGS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * Modo del onboarding según el tipo de cuenta del cliente
 */
export enum OnboardingMode {
  NEW = 'new',               // Cliente nuevo, sin WABA ni número previo
  EXISTING = 'existing',     // Cliente con WABA existente
  COEXISTENCE = 'coexistence', // Cliente con WhatsApp Business App, quiere coexistir con la plataforma
}

/**
 * Estados terminales del onboarding
 */
export const TERMINAL_STATUSES = [
  OnboardingStatus.COMPLETED,
  OnboardingStatus.COMPLETED_WITH_WARNINGS,
  OnboardingStatus.FAILED,
  OnboardingStatus.CANCELLED,
];

/**
 * Estados que se consideran "en progreso" (bloquean un nuevo onboarding)
 */
export const IN_PROGRESS_STATUSES = [
  OnboardingStatus.CREATED,
  OnboardingStatus.CODE_RECEIVED,
  OnboardingStatus.EXCHANGE_IN_PROGRESS,
  OnboardingStatus.EXCHANGE_COMPLETED,
  OnboardingStatus.ASSET_DISCOVERY_IN_PROGRESS,
  OnboardingStatus.ASSETS_DISCOVERED,
  OnboardingStatus.WEBHOOK_VALIDATION_IN_PROGRESS,
  OnboardingStatus.WEBHOOK_VALIDATED,
  OnboardingStatus.TEST_MESSAGE_IN_PROGRESS,
];
