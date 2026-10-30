/**
 * Lo que EffectiveCapabilityService lee de la preparación del negocio (R4, ADR 0010): la última evaluación del motor.
 *
 * Es un token y no la clase ReadinessService a propósito: el contrato de capacidades lo cargan también los scripts de
 * auditoría (docs/audits, native-backlog.ts) sin el paquete @parallext/business-spec compilado, y la clase lo arrastra
 * en tiempo de ejecución. ConversationsModule lo enlaza a ReadinessService (`useExisting`).
 */
import type { ReadinessResult } from '@parallext/business-spec';

export const BUSINESS_READINESS = 'BUSINESS_READINESS';

export interface BusinessReadinessPort {
    getCurrent(tenantId: string): Promise<{ result: Pick<ReadinessResult, 'config' | 'blockingGaps'> }>;
}
