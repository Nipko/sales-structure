/**
 * Renders a Procedure tool step's arguments from the answers it collected.
 *
 * The engine stored every answer in `state.collected` and then handed the tool
 * `step.config.args` verbatim. The compiler's own example asks the customer for
 * `numero_orden` and calls `get_order_status` with `"args": {}` — the number the
 * customer just typed could never reach the tool. Contact-scoped tools appeared
 * to work because `contactId` is a positional parameter; anything needing a
 * user-supplied value was broken by construction.
 *
 * Placeholders are `{{ field }}` with dot paths into `collected`. A whole-string
 * placeholder keeps the value's type (a number stays a number, an object stays
 * an object); a placeholder embedded in text interpolates as a string. Types are
 * coerced and validated when the step declares them, and an unresolved required
 * placeholder stops the step instead of calling the tool with `"{{ field }}"` as
 * a literal — which is how a booking gets created for a guest named
 * "{{ guest_name }}".
 */

export type ProcedureSlotType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'uuid';

export interface ProcedureSlotSpec {
    type?: ProcedureSlotType;
    required?: boolean;
}

export interface InterpolationResult {
    ok: boolean;
    args: Record<string, unknown>;
    /** Placeholders that pointed at nothing. */
    missing: string[];
    /** Values that resolved but failed their declared type. */
    invalid: Array<{ arg: string; expected: ProcedureSlotType; received: string }>;
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{\s*([\w.]+)\s*\}\}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolvePath(source: Record<string, any>, path: string): unknown {
    return path.split('.').reduce<any>(
        (acc, key) => (acc === null || acc === undefined ? undefined : acc[key]),
        source,
    );
}

function isMissing(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

/**
 * Coerce a collected answer to its declared type.
 *
 * Everything a customer types arrives as a string, so coercion is required, not
 * optional. It is deliberately strict: `"tres"` is not `3`, and letting it
 * through as `NaN` would reach the tool as a silently wrong argument.
 */
function coerce(value: unknown, type: ProcedureSlotType): { ok: boolean; value?: unknown } {
    switch (type) {
        case 'string':
            return { ok: true, value: String(value) };
        case 'number':
        case 'integer': {
            const raw = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
            if (!Number.isFinite(raw)) return { ok: false };
            if (type === 'integer' && !Number.isInteger(raw)) return { ok: false };
            return { ok: true, value: raw };
        }
        case 'boolean': {
            if (typeof value === 'boolean') return { ok: true, value };
            const text = String(value).trim().toLowerCase();
            if (['true', 'si', 'sí', 'yes', 'sim', 'oui', '1'].includes(text)) return { ok: true, value: true };
            if (['false', 'no', 'nao', 'não', 'non', '0'].includes(text)) return { ok: true, value: false };
            return { ok: false };
        }
        case 'date': {
            const text = String(value).trim();
            if (!DATE_ONLY.test(text)) return { ok: false };
            const parsed = new Date(`${text}T00:00:00.000Z`);
            if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
                return { ok: false };
            }
            return { ok: true, value: text };
        }
        case 'uuid': {
            const text = String(value).trim();
            return UUID.test(text) ? { ok: true, value: text } : { ok: false };
        }
        default:
            return { ok: true, value };
    }
}

/**
 * Build a tool step's arguments.
 *
 * `slots` declares the type of each argument. An argument with no declared type
 * still gets interpolated — a procedure authored before typing existed keeps
 * working — but a declared type is enforced.
 */
export function interpolateProcedureArgs(
    args: Record<string, unknown> | undefined,
    collected: Record<string, any>,
    slots?: Record<string, ProcedureSlotSpec>,
): InterpolationResult {
    const out: Record<string, unknown> = {};
    const missing: string[] = [];
    const invalid: InterpolationResult['invalid'] = [];

    for (const [key, raw] of Object.entries(args || {})) {
        const spec = slots?.[key];
        let value: unknown = raw;

        if (typeof raw === 'string') {
            const whole = WHOLE_PLACEHOLDER.exec(raw.trim());
            if (whole) {
                // Whole-string placeholder: preserve the resolved value's type.
                const resolved = resolvePath(collected, whole[1]);
                if (isMissing(resolved)) {
                    if (spec?.required !== false) missing.push(whole[1]);
                    continue;
                }
                value = resolved;
            } else if (PLACEHOLDER.test(raw)) {
                PLACEHOLDER.lastIndex = 0;
                let unresolved = false;
                value = raw.replace(PLACEHOLDER, (_match, path: string) => {
                    const resolved = resolvePath(collected, path);
                    if (isMissing(resolved)) {
                        unresolved = true;
                        missing.push(path);
                        return '';
                    }
                    return String(resolved);
                });
                PLACEHOLDER.lastIndex = 0;
                if (unresolved) continue;
            }
        }

        if (spec?.type) {
            const coerced = coerce(value, spec.type);
            if (!coerced.ok) {
                invalid.push({ arg: key, expected: spec.type, received: String(value) });
                continue;
            }
            value = coerced.value;
        }
        out[key] = value;
    }

    // A declared required slot with no argument at all is missing too: the
    // author said the tool needs it, and calling without it is the same defect.
    for (const [key, spec] of Object.entries(slots || {})) {
        if (spec?.required && !(key in out) && !missing.includes(key)) missing.push(key);
    }

    return { ok: missing.length === 0 && invalid.length === 0, args: out, missing, invalid };
}
