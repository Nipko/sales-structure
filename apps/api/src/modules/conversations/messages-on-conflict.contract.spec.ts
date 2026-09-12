import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * `uidx_messages_external_id` is a PARTIAL unique index, and Postgres only
 * matches a partial index when the ON CONFLICT clause repeats its predicate.
 *
 * An outbound insert that said `ON CONFLICT (external_id) DO NOTHING` compiled,
 * type-checked and passed 2.110 unit tests — and then raised 42P10 on the first
 * real message in production, failing the whole turn. Every customer of every
 * tenant stopped receiving replies. Nothing in a mock could see it, because the
 * mock is not Postgres.
 *
 * This reads the two files and refuses to let them drift again.
 */

const SERVICE = resolve(__dirname, 'conversations.service.ts');
const SCHEMA = resolve(__dirname, '../../../prisma/tenant-schema.sql');

describe('messages ON CONFLICT matches the real index', () => {
    const schemaSql = readFileSync(SCHEMA, 'utf8');
    const serviceSrc = readFileSync(SERVICE, 'utf8');

    it('the index on messages.external_id is still partial', () => {
        // If this ever stops being partial, the assertion below can be relaxed —
        // but it must be a deliberate change, not a surprise.
        const line = schemaSql
            .split('\n')
            .find(l => l.includes('uidx_messages_external_id'));

        expect(line).toBeDefined();
        expect(line).toContain('"external_id" IS NOT NULL');
    });

    it('every ON CONFLICT on external_id repeats the index predicate', () => {
        const offenders: string[] = [];
        const lines = serviceSrc.split('\n');

        lines.forEach((line, i) => {
            if (!/ON CONFLICT\s*\(\s*"?external_id"?\s*\)/i.test(line)) return;
            // The predicate may sit on the same line as the ON CONFLICT clause.
            const window = [line, lines[i + 1] || ''].join(' ');
            if (!/WHERE\s+"?external_id"?\s+IS\s+NOT\s+NULL/i.test(window)) {
                offenders.push(`conversations.service.ts:${i + 1} → ${line.trim()}`);
            }
        });

        expect(offenders).toEqual([]);
    });

    it('fails closed when a tenant schema cannot prove inbound uniqueness', () => {
        // A plain fallback insert accepts duplicate provider deliveries and can
        // execute tools and bill an answer twice. The queue must retry only after
        // the missing schema authority is repaired.
        expect(serviceSrc).toContain('42P10');
        expect(serviceSrc).toContain('inbound_dedupe_authority_unavailable');
        expect(serviceSrc).not.toContain('inserting without dedupe');
    });

    it('requires a readable receipt before resuming a duplicate turn', () => {
        expect(serviceSrc).toContain('inbound_dedupe_receipt_unavailable');
        expect(serviceSrc).toContain('inbound_dedupe_conversation_mismatch');
    });
});
