import type { ToolDefinition } from '@parallext/shared';
import type { PaymentRuntimeCapability } from './payment-operation.service';
import { PAYMENT_CREATE_TOOLS, PAYMENT_STATUS_TOOLS } from './tools/payment-tools';
import { APPLY_DISCOUNT_TOOL } from './tools/ecommerce-tools';

export interface AgentPaymentToolsConfig {
    enabled?: boolean;
    canCreateLinks?: boolean;
}

export interface AgentDiscountConfig {
    /** `tools.ecommerce.canApplyDiscount` — the agent-level toggle. */
    canApplyDiscount?: boolean;
    /** `upsell.maxDiscountPercent` — 0 or absent disables. */
    maxDiscountPercent?: number;
}

/**
 * Whether `apply_discount` may be shown this turn.
 *
 * Three independent conditions, all required: the tenant enabled it, the tenant
 * set a usable ceiling, and the bound provider can actually apply a discount.
 * The third is the one that was missing — the toggle alone published a tool
 * whose only possible outcome was an apology and a handoff.
 */
export function discountToolsForRuntime(
    config: AgentDiscountConfig | undefined,
    capability: PaymentRuntimeCapability,
): ToolDefinition[] {
    if (config?.canApplyDiscount !== true) return [];
    if (capability.discountsAvailable !== true) return [];
    const max = config.maxDiscountPercent;
    if (max !== undefined && !(Number.isFinite(max) && max > 0)) return [];
    return [APPLY_DISCOUNT_TOOL];
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
