/**
 * The super_admin screen's contract with `GET/PUT /platform/demo-allowance`.
 *
 * Kept out of `page.tsx` because an App Router page may only export the page:
 * these are read by the screen and by its spec.
 */

export interface DemoAllowanceValues {
    enabled: boolean;
    messagesPerTenant: number;
    dailyCapPerPage: number;
}

export interface DemoAllowanceBounds { min: number; max: number }

/**
 * Where `allowance` came from (F0). `fallback` means the platform could not
 * read what is stored and the numbers are the defaults standing in: the screen
 * says so and does not offer to save them.
 */
export type DemoAllowanceSource = "stored" | "default" | "fallback";

const SOURCES: readonly DemoAllowanceSource[] = ["stored", "default", "fallback"];

export interface DemoAllowanceSnapshot {
    allowance: DemoAllowanceValues;
    source: DemoAllowanceSource;
    defaults: DemoAllowanceValues;
    limits: { messagesPerTenant: DemoAllowanceBounds; dailyCapPerPage: DemoAllowanceBounds };
}

export const DEMO_ALLOWANCE_ENDPOINT = "/platform/demo-allowance";

export type DemoAllowanceField = "messagesPerTenant" | "dailyCapPerPage";
export type DemoAllowanceFieldProblem = "integer" | "min" | "max";

function isValues(value: unknown): value is DemoAllowanceValues {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return typeof v.enabled === "boolean"
        && Number.isInteger(v.messagesPerTenant)
        && Number.isInteger(v.dailyCapPerPage);
}

function isDemoAllowanceBounds(value: unknown): value is DemoAllowanceBounds {
    return Boolean(value) && typeof value === "object"
        && Number.isInteger((value as DemoAllowanceBounds).min) && Number.isInteger((value as DemoAllowanceBounds).max);
}

/** The API envelope, validated; `null` when it cannot be trusted. */
export function readDemoAllowanceSnapshot(response: unknown): DemoAllowanceSnapshot | null {
    if (!response || typeof response !== "object" || (response as { success?: unknown }).success !== true) return null;
    const data = (response as { data?: unknown }).data as Record<string, unknown> | undefined;
    if (!data || !isValues(data.allowance) || !isValues(data.defaults)) return null;
    // Without it the screen cannot tell the stored numbers from stand-in
    // defaults, which is the one thing it must not guess.
    if (!SOURCES.includes(data.source as DemoAllowanceSource)) return null;
    const limits = data.limits as Record<string, unknown> | undefined;
    if (!limits || !isDemoAllowanceBounds(limits.messagesPerTenant) || !isDemoAllowanceBounds(limits.dailyCapPerPage)) return null;
    return {
        allowance: data.allowance,
        source: data.source as DemoAllowanceSource,
        defaults: data.defaults,
        limits: { messagesPerTenant: limits.messagesPerTenant, dailyCapPerPage: limits.dailyCapPerPage },
    };
}

/** Saving is offered only over values that are known to be the ones stored or in force. */
export function canSaveDemoAllowance(snapshot: Pick<DemoAllowanceSnapshot, "source">): boolean {
    return snapshot.source !== "fallback";
}

/** What is wrong with a typed number, by the same rule the API applies. */
export function demoAllowanceFieldProblem(raw: string, bounds: DemoAllowanceBounds): DemoAllowanceFieldProblem | null {
    if (!/^\d+$/.test(raw.trim())) return "integer";
    const value = Number(raw.trim());
    if (value < bounds.min) return "min";
    if (value > bounds.max) return "max";
    return null;
}
