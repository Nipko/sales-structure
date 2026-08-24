import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('signup attribution backfill contract', () => {
    it('never classifies a legacy NULL tenant source as self-service', () => {
        const sql = readFileSync(resolve(
            __dirname,
            '../../../prisma/migrations/20260823120000_add_signup_attribution/migration.sql',
        ), 'utf8');

        expect(sql).toContain('t."signup_source" IS NOT NULL');
        expect(sql).not.toContain("COALESCE(t.\"signup_source\", '') <> 'super_admin'");
    });
});
