import { spawnSync } from 'child_process';
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
const SCRIPT_PATH = resolve(__dirname, '../../../../../infra/backup/restore.sh');
const script = readFileSync(SCRIPT_PATH, 'utf8').split('\r\n').join('\n');

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
        // And it is named for what it IS. Calling it `public.dump` is what made
        // the restore below apply `--schema=public` to a whole-database archive.
        expect(code).toMatch(/cp "\$\{ARCHIVE\}" "\$\{WORK_DIR\}\/full_backup\.dump"/);
        expect(code).not.toMatch(/cp "\$\{ARCHIVE\}" "\$\{WORK_DIR\}\/public\.dump"/);
    });

    it('still handles a nightly tarball', () => {
        expect(code).toContain('tar -xzf "${ARCHIVE}"');
    });
});

/**
 * ═══ AND THE ONE THAT IS EXERCISED, NOT READ ═══
 *
 * The block above reads the script as text, for the reason it explains. But the
 * defect this block exists for could not be caught by reading: the script said
 * `pg_restore … --exit-on-error`, checked the exit code, counted failures and
 * printed OK only after the count — every text assertion above passed — and it
 * still restored `public` alone out of a whole-database archive and called that
 * "all schemas restored". The wrong thing was WHICH FLAGS reached `pg_restore`
 * for WHICH archive, and which loop did not run.
 *
 * So this block runs the real script with `docker` replaced by a stub that
 * records its arguments, answers `pg_restore --list` with a table of contents,
 * and answers `psql` with the schemas the database is pretending to have. No
 * PostgreSQL and no Docker are needed, because what is under test is the
 * script's own branching — which is exactly where the defect lived.
 */
const bash = (harness: string): { stdout: string; calls: string; exit: number } => {
    const result = spawnSync('bash', ['-c', harness], { encoding: 'utf8', timeout: 60_000 });
    if (result.error) throw result.error;
    const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const calls = out.split('---DOCKER-CALLS---')[1]?.split('---EXIT---')[0] ?? '';
    // Matched rather than split on: anything the script wrote to stderr is
    // appended after stdout here, so everything "after" the marker can carry a
    // diagnostic with it and trimming that yields NaN.
    const exit = Number(/---EXIT---(\d+)/.exec(out)?.[1]);
    return { stdout: out, calls, exit };
};

/**
 * `setup` runs inside a scratch directory with `$WORK` set, and must leave the
 * archive to restore at `$WORK/$ARCHIVE`. `live` is what the stubbed `psql`
 * reports as the schemas that exist after the restore — the whole point of the
 * experiment, because the archive always claims `public` and `tenant_acme`.
 */
const runRestore = (setup: string, live: string) => bash([
    'set -u',
    'WORK="$(mktemp -d)"',
    'trap \'rm -rf "$WORK"\' EXIT',
    'mkdir -p "$WORK/bin"',
    'cat > "$WORK/bin/docker" <<\'STUB\'',
    '#!/bin/bash',
    'printf \'%s\\n\' "$*" >> "$STUB_LOG"',
    'case " $* " in',
    '  *"pg_restore --list"*) cat > /dev/null; printf \'%s\\n\' "$STUB_TOC"; exit 0 ;;',
    '  *" psql "*)            cat > /dev/null; printf \'%s\\n\' "$STUB_LIVE"; exit 0 ;;',
    '  *)                     cat > /dev/null; exit 0 ;;',
    'esac',
    'STUB',
    'chmod +x "$WORK/bin/docker"',
    'export STUB_LOG="$WORK/calls.log"; : > "$STUB_LOG"',
    // ── A TOC IN THE SHAPE POSTGRESQL REALLY PRINTS ─────────────────────
    //
    // The first stub carried only one-word descriptions — `SCHEMA`, `TABLE` —
    // which is the single shape a fixed-field parser survives, so it agreed
    // with the parser under test and proved nothing. Real archives are full of
    // `TABLE DATA`, `SEQUENCE SET` and `FK CONSTRAINT`, and reading a fixed
    // column on those extracted `DATA`, `SET` and `CONSTRAINT` as schema names
    // — turning a correct restore into a reported failure, which blocks the
    // rollback this script exists for.
    //
    // These lines are the ones that must not be misread.
    'export STUB_TOC=\'5; 2615 16389 SCHEMA - tenant_acme parallext',
    '215; 1259 16390 TABLE tenant_acme messages parallext',
    '3421; 0 16390 TABLE DATA tenant_acme messages parallext',
    '3422; 0 0 SEQUENCE SET public tenants_id_seq parallext',
    '3500; 2606 16500 FK CONSTRAINT public tenants tenants_owner_fkey parallext',
    '3600; 1259 16600 MATERIALIZED VIEW DATA public mv_usage parallext',
    '216; 1259 16400 TABLE public tenants parallext\'',
    `export STUB_LIVE='${live}'`,
    'cd "$WORK"',
    setup,
    `PATH="$WORK/bin:$PATH" ENV_FILE="$WORK/absent.env" bash '${SCRIPT_PATH.replace(/\\/g, '/')}' "$WORK/$ARCHIVE" --db-only`,
    'rc=$?',
    'echo "---DOCKER-CALLS---"',
    'cat "$STUB_LOG"',
    'echo "---EXIT---$rc"',
    'exit 0',
].join('\n'));

/** The `pg_restore` command lines the script actually issued. */
const restoreCalls = (calls: string): string[] =>
    calls.split('\n').filter(line => / pg_restore -U /.test(line));

const BARE_DUMP = 'printf pgdmp > "$WORK/return-point.dump"; ARCHIVE=return-point.dump';
const NIGHTLY = (files: string) => [
    'mkdir -p "$WORK/20260911_020000"',
    `for f in ${files}; do printf pgdmp > "$WORK/20260911_020000/$f"; done`,
    'tar -czf "$WORK/nightly.tar.gz" -C "$WORK" 20260911_020000',
    'ARCHIVE=nightly.tar.gz',
].join('\n');

describe('the return point is restored WHOLE, or not called restored', () => {
    it('applies no --schema filter to a whole-database archive', () => {
        // The reproduced defect. `deploy.yml` and `october-cutover.sh` both take
        // their return point as `pg_dump --format=custom` with NO `--schema`, so
        // the archive holds every schema. This script copied it to `public.dump`
        // and restored it with `--schema=public`, which threw away every
        // `tenant_*` object in it: conversations, messages, spend rows, outbox.
        const run = runRestore(BARE_DUMP, 'public\ntenant_acme');
        const calls = restoreCalls(run.calls);
        expect(calls.length).toBe(1);
        expect(calls[0]).not.toContain('--schema');
        expect(calls[0]).toContain('--exit-on-error');
        expect(run.exit).toBe(0);
        expect(run.stdout).toContain('Restore complete!');
    });

    it('refuses when a schema the archive contains is missing afterwards', () => {
        // The half no exit code could see. A filter that excludes everything
        // exits 0 having done nothing, so the only check that catches it is a
        // positive one: the archive's own table of contents against the schemas
        // that exist now.
        const run = runRestore(BARE_DUMP, 'public');
        expect(run.stdout).toContain('NOT in the database after the restore: tenant_acme');
        expect(run.stdout).not.toContain('OK — all schemas restored');
        expect(run.stdout).not.toContain('Restore complete!');
        expect(run.exit).toBe(1);
    });

    it('still restores a nightly tarball one schema at a time', () => {
        // The other archive shape is unchanged: `backup.sh` takes `public.dump`
        // with `--schema=public` and one dump per tenant, so there the filter
        // matches what the file holds.
        const run = runRestore(
            NIGHTLY('public.dump tenant_acme.dump full_backup.dump'), 'public\ntenant_acme');
        const calls = restoreCalls(run.calls);
        expect(calls.length).toBe(2);
        expect(calls.filter(line => line.includes('--schema=public')).length).toBe(1);
        expect(calls.filter(line => line.includes('--schema=tenant_acme')).length).toBe(1);
        expect(run.exit).toBe(0);
    });

    it('refuses a nightly tarball whose tenant dump never made it in', () => {
        // `backup.sh` only WARNs when a tenant dump fails, so a tarball can
        // legitimately arrive holding `public.dump` and nothing else. Restoring
        // it used to print "all schemas restored" — the glob matched nothing, so
        // there was nothing to fail. `full_backup.dump` is that night's own
        // statement of what was captured, and it is the authority.
        const run = runRestore(NIGHTLY('public.dump full_backup.dump'), 'public');
        expect(run.stdout).toContain('NOT in the database after the restore: tenant_acme');
        expect(run.exit).toBe(1);
        // And it names the remedy, because the most likely cause is one
        // `docs/backup-restore-runbook.md` already documents: a tenant that was
        // `is_active = false` when the backup ran has no per-schema dump at all,
        // so its data exists only inside `full_backup.dump`.
        expect(run.stdout).toContain('its data lives ONLY inside full_backup.dump');
        expect(run.stdout).toMatch(/restore\.sh <extracted-dir>\/full_backup\.dump --db-only/);
    });
});
