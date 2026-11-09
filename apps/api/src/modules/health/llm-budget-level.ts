/**
 * Nivel de presupuesto LLM de un tenant (ADR-0026).
 *
 * Dos topes por plan (o por `settings.quotaOverrides`), en centavos de USD:
 * - `llmCostBudgetUsdCents` (blando): al cruzarlo el router baja a los modelos
 *   baratos. Solo dejaba un logger.warn.
 * - `llmHardBudgetUsdCents` (duro): al cruzarlo el guardian de gasto corta y
 *   el agente deja de responder.
 * El 9-nov los 7 tenants QA estaban por encima del blando y cerca del duro sin
 * que nadie lo supiera.
 */
export type BudgetLevel = 'ok' | 'soft_warn' | 'soft_reached' | 'hard_near' | 'hard_reached';

export const BUDGET_LEVELS_BY_SEVERITY: readonly BudgetLevel[] = ['hard_reached', 'hard_near', 'soft_reached', 'soft_warn'];

export interface BudgetInput {
    /** Gasto del mes, centavos de USD. */
    spentCents: number;
    /** Tope blando; Infinity = ilimitado; 0 o negativo = sin configurar. */
    softCents: number;
    /** Tope duro; Infinity = ilimitado; 0 o negativo = sin configurar. */
    hardCents: number;
    softWarnPct?: number;
    hardNearPct?: number;
}

const usable = (n: number) => Number.isFinite(n) && n > 0;

export function budgetLevel(i: BudgetInput): BudgetLevel {
    const softWarn = (i.softWarnPct ?? 80) / 100;
    const hardNear = (i.hardNearPct ?? 90) / 100;
    if (usable(i.hardCents)) {
        if (i.spentCents >= i.hardCents) return 'hard_reached';
        if (i.spentCents >= i.hardCents * hardNear) return 'hard_near';
    }
    if (usable(i.softCents)) {
        if (i.spentCents >= i.softCents) return 'soft_reached';
        if (i.spentCents >= i.softCents * softWarn) return 'soft_warn';
    }
    return 'ok';
}

export function budgetSeverity(level: BudgetLevel): 'critical' | 'warning' | 'info' {
    if (level === 'hard_reached' || level === 'hard_near') return 'critical';
    if (level === 'soft_reached' || level === 'soft_warn') return 'warning';
    return 'info';
}

export function budgetIncidentKey(tenantId: string, level: BudgetLevel): string {
    return `llm:budget:${tenantId}:${level}`;
}

export const BUDGET_LEVEL_LABEL_ES: Record<BudgetLevel, string> = {
    ok: 'dentro del presupuesto',
    soft_warn: 'cerca del tope blando',
    soft_reached: 'tope blando superado (modelos baratos)',
    hard_near: 'cerca del tope duro',
    hard_reached: 'tope duro alcanzado (el agente no responde)',
};

/** Resumen de un tenant para el superadmin. */
export interface TenantBudgetStatus {
    tenantId: string;
    tenantName: string;
    spentCents: number;
    softCents: number | null;
    hardCents: number | null;
    softPct: number | null;
    hardPct: number | null;
    level: BudgetLevel;
}
