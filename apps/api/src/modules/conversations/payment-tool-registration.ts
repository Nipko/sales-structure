import type { ToolDefinition } from '@parallext/shared';
import type { PaymentRuntimeCapability } from './payment-operation.service';
import { PAYMENT_CREATE_TOOLS, PAYMENT_STATUS_TOOLS } from './tools/payment-tools';

export interface AgentPaymentToolsConfig {
    enabled?: boolean;
    canCreateLinks?: boolean;
}

/** Pure selection boundary so plan/readiness behavior is independently testable. */
export function paymentToolsForRuntime(
    config: AgentPaymentToolsConfig | undefined,
    capability: PaymentRuntimeCapability,
): ToolDefinition[] {
    if (config?.enabled !== true) return [];
    const tools: ToolDefinition[] = capability.statusAvailable ? [...PAYMENT_STATUS_TOOLS] : [];
    if (config.canCreateLinks === true && capability.planEnabled && capability.ready) {
        tools.push(...PAYMENT_CREATE_TOOLS);
    }
    return tools;
}
