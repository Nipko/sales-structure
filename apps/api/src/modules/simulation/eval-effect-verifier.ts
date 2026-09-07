import type { ExpectedAction } from './eval.service';

export interface EffectVerifier { table: string; contactColumn: string; }
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Query = (sql: string, params: unknown[]) => Promise<unknown>;
type Check = { ok: boolean; description: string; detail: string };

/** Verify committed, contact-owned rows. Malformed assertions can never pass by omission. */
export async function verifyExpectedEffects(input: {
    expected: readonly ExpectedAction[]; contactId: string; verifiers: Readonly<Record<string, EffectVerifier>>;
    observedToolCalls?: ReadonlyArray<{ name: string; result: unknown }>; query: Query;
}): Promise<{ passed: boolean; checks: Check[] }> {
    const checks: Check[] = [];
    if (!UUID.test(input.contactId) || !Array.isArray(input.expected) || input.expected.length > 100) {
        return { passed: false, checks: [{ ok: false, description: 'assertions', detail: 'invalid_verification_scope' }] };
    }
    for (const assertion of input.expected) {
        const fail = (detail: string) => checks.push({ ok: false, description: assertion?.description || 'assertion', detail });
        if (!assertion || typeof assertion !== 'object') { fail('invalid_assertion'); continue; }
        if (assertion.kind === 'tool_call') {
            if (!['called', 'not_called'].includes(assertion.type) || typeof assertion.tool !== 'string' || !assertion.tool.trim()) {
                fail('invalid_tool_assertion'); continue;
            }
            const count = (input.observedToolCalls || []).filter(call => call.name === assertion.tool).length;
            checks.push({ ok: assertion.type === 'called' ? count > 0 : count === 0,
                description: assertion.description || `${assertion.type} ${assertion.tool}`, detail: `calls=${count}` });
            continue;
        }
        if ((assertion.kind && assertion.kind !== 'db_effect') || !['row_exists', 'row_count', 'no_row'].includes(assertion.type) ||
            (assertion.type === 'row_count' && assertion.count !== undefined && (!Number.isSafeInteger(assertion.count) || assertion.count < 0))) {
            fail('invalid_effect_assertion'); continue;
        }
        const verifier = assertion.family ? input.verifiers[assertion.family]
            : Object.values(input.verifiers).find(item => item.table === assertion.table);
        if (!verifier || verifier.table !== assertion.table || !IDENTIFIER.test(verifier.table) || !IDENTIFIER.test(verifier.contactColumn)) {
            fail('effect_verifier_unavailable'); continue;
        }
        if (assertion.where !== undefined && (!assertion.where || typeof assertion.where !== 'object' || Array.isArray(assertion.where))) {
            fail('invalid_effect_filter'); continue;
        }
        const conditions = [`${verifier.contactColumn} = $1::uuid`];
        const parameters: unknown[] = [input.contactId];
        let invalid = false;
        for (const [column, raw] of Object.entries(assertion.where || {})) {
            if (!IDENTIFIER.test(column)) { invalid = true; break; }
            const filter: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw)
                ? raw as Record<string, unknown> : { op: 'eq', value: raw };
            if (Object.keys(filter).some(key => !['op', 'value'].includes(key)) ||
                typeof filter.op !== 'string' || !['eq', 'ilike', 'date_eq', 'time_eq'].includes(filter.op) || !Object.hasOwn(filter, 'value') ||
                !(filter.value === null || typeof filter.value === 'string' || typeof filter.value === 'boolean' ||
                    (typeof filter.value === 'number' && Number.isFinite(filter.value))) ||
                (filter.op !== 'eq' && typeof filter.value !== 'string')) { invalid = true; break; }
            const index = parameters.length + 1;
            const quoted = `"${column}"`;
            if (filter.value === null) { conditions.push(`${quoted} IS NULL`); continue; }
            if (filter.op === 'ilike') conditions.push(`${quoted} ILIKE $${index}`);
            else if (filter.op === 'date_eq') conditions.push(`DATE(${quoted}) = $${index}::date`);
            else if (filter.op === 'time_eq') conditions.push(`to_char(${quoted}, 'HH24:MI') = $${index}`);
            else conditions.push(`${quoted} = $${index}`);
            parameters.push(filter.value);
        }
        if (invalid) { fail('invalid_effect_filter'); continue; }
        try {
            const rows = await input.query(`SELECT COUNT(*)::int AS cnt FROM ${verifier.table} WHERE ${conditions.join(' AND ')}`, parameters);
            const rawCount = Array.isArray(rows) && rows.length === 1 ? rows[0]?.cnt : undefined;
            if (!(typeof rawCount === 'number' || (typeof rawCount === 'string' && /^\d+$/.test(rawCount))) ||
                !Number.isSafeInteger(Number(rawCount)) || Number(rawCount) < 0) { fail('invalid_verification_result'); continue; }
            const count = Number(rawCount);
            const ok = assertion.type === 'no_row' ? count === 0 : assertion.type === 'row_count' ? count === (assertion.count ?? 1) : count > 0;
            checks.push({ ok, description: assertion.description || `${assertion.type} ${assertion.table}`, detail: `cnt=${count}` });
        } catch { fail('verification_query_failed'); }
    }
    return { passed: checks.every(check => check.ok), checks };
}
