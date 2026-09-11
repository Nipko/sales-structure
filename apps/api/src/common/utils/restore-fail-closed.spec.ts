import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * ═══ THE RESTORE SCRIPT MAY NOT SAY "OK" WHEN NOTHING WAS RESTORED ═══
 *
 * `infra/backup/restore.sh` is run at exactly two moments: a disaster and a
 * drill. Both of its `pg_restore` calls used to end in
 *
 *     || echo "  WARN: Some public schema restore warnings (usually safe)"
 *
 * and the script then printed "OK — all schemas restored" unconditionally and
 * exited 0. So a restore that restored NOTHING — wrong container, wrong
 * credentials, a truncated dump, a schema that does not exist — reported
 * success.
 *
 * In the disaster that says the data is back when it is not. In the drill it
 * certifies a restore path that does not work, which is how the drill becomes
 * the thing that hides the problem. This programme has already recorded one
 * incident where a backup mechanism failed silently for weeks.
 *
 * ── WHY THIS IS READ AS TEXT ────────────────────────────────────────────────
 *
 * The script talks to Docker and to a PostgreSQL container on a VPS. Executing
 * it here would need both, and a test that mocks both proves only that the
 * mocks agree with each other. What can be checked honestly, and is what
 * actually broke, is the SHAPE: no swallowed failure, `--exit-on-error`
 * present, and a success message that cannot be reached when a restore failed.
 *
 * Reading the file this way means a future edit that reintroduces the swallow
 * fails here, which is the whole job.
 */
const script = readFileSync(
    resolve(__dirname, '../../../../../infra/backup/restore.sh'), 'utf8')
    .split('\r\n').join('\n');

/** The command lines, with comments and blank lines removed. */
const code = script.split('\n')
    .filter(line => !/^\s*#/.test(line) && line.trim())
    .join('\n');

describe('a restore that did not restore may not report success', () => {
    it('never swallows a pg_restore failure into a warning', () => {
        // The exact shape that shipped, and every relative of it.
        expect(code).not.toMatch(/pg_restore[\s\S]{0,400}?\|\|\s*echo/);
        expect(code).not.toContain('usually safe');
    });

    it('asks pg_restore to stop at the first failed statement', () => {
        // Without `--exit-on-error`, `pg_restore` continues past a failed
        // statement and exits 0 — so even a checked exit code would have said
        // yes to a restore that dropped a schema and failed to recreate it.
        // Counted rather than matched across continuation lines: a regex that
        // spans them is greedy enough to swallow both calls into one match and
        // then pass on the first flag it happens to find.
        const invocations = (code.match(/pg_restore -U/g) ?? []).length;
        const guarded = (code.match(/--exit-on-error/g) ?? []).length;
        expect(invocations).toBeGreaterThanOrEqual(2);
        expect(guarded).toBe(invocations);
    });

    it('counts failures and exits non-zero when there were any', () => {
        expect(code).toContain('RESTORE_FAILURES=0');
        expect(code).toMatch(/RESTORE_FAILURES=\$\(\(RESTORE_FAILURES \+ 1\)\)/);
        expect(code).toMatch(/if \[ "\$\{RESTORE_FAILURES\}" -gt 0 \][\s\S]{0,600}?exit 1/);
    });

    it('reaches its success message only after the failure check', () => {
        // Order is the invariant: "OK — all schemas restored" printed before
        // the count is inspected is the original defect wearing a counter.
        const check = code.indexOf('RESTORE_FAILURES}" -gt 0');
        const ok = code.indexOf('OK — all schemas restored');
        expect(check).toBeGreaterThan(-1);
        expect(ok).toBeGreaterThan(check);
    });

    it('warns that a partial restore must not be started against', () => {
        // `--clean` drops before it recreates, so a failure leaves the database
        // in a state that looks like an empty tenant rather than a broken one.
        expect(script).toMatch(/PARTIAL state/);
        expect(script).toMatch(/[Dd]o not start the application/);
    });

    it('accepts the bare dump the pre-deploy safety net actually writes', () => {
        // The pre-deploy backup writes ONE custom-format dump, not a nightly
        // tarball. This script only accepted `.tar.gz`, so the backup taken
        // specifically to be restored after a bad migration could not be
        // restored by the restore script — refusing at the one moment somebody
        // reaches for it.
        expect(code).toMatch(/case "\$\{ARCHIVE\}" in/);
        expect(code).toMatch(/\*\.dump\)/);
        expect(code).toMatch(/cp "\$\{ARCHIVE\}" "\$\{WORK_DIR\}\/public\.dump"/);
    });

    it('still handles a nightly tarball', () => {
        expect(code).toContain('tar -xzf "${ARCHIVE}"');
    });
});
