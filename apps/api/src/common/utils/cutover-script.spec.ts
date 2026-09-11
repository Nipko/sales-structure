import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * ═══ THE CUT-OVER IS A PROGRAM NOW, SO ITS ORDER CAN BE ASSERTED ═══
 *
 * The runbook described eleven steps in a table, and a reviewer reproduced what
 * a person following that table would actually have done:
 *
 *   · Step 1 ran `docker compose up`. The restore rehearsal and the write
 *     barrier were further down the page, so the services were replaced BEFORE
 *     a return point existed.
 *   · The rollback was not executable. The runbook said `pg_dumpall`, the deploy
 *     writes `pg_dump --format=custom`, and `infra/backup/restore.sh` reads a
 *     `.tar.gz` — three formats, no single command that restores what was taken.
 *   · Nothing was resumable, so a window that failed at step 7 and was retried
 *     from step 1 took the backup again over a half-migrated database.
 *
 * `october-cutover.sh` is the same eleven steps with the order enforced instead
 * of described. These tests read the script and assert that enforcement, because
 * "the order is documented" is the property that failed.
 *
 * Everything asserted here was also EXERCISED against a disposable PostgreSQL
 * 17: the rehearsal dumps, empties the target, restores and compares row counts
 * per table, and three mutations — a restore that omits the tenant schemas, a
 * dump in a format `pg_restore` cannot read, and the restore failure downgraded
 * to `WARN: usually safe` the way `infra/backup/restore.sh` does it — each
 * produced a red run.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT = readFileSync(resolve(ROOT, 'infra', 'scripts', 'october-cutover.sh'), 'utf8')
    .replace(/\r\n/g, '\n');

/** The body of one `name() { … }` function, by brace matching at column 0. */
const bodyOf = (name: string): string => {
    const start = SCRIPT.indexOf(`\n${name}() {\n`);
    if (start === -1) throw new Error(`no function ${name} in october-cutover.sh`);
    const end = SCRIPT.indexOf('\n}\n', start);
    return SCRIPT.slice(start, end);
};

/** Executable lines only: a `compose up` inside a comment is a warning, not a step. */
const executable = (text: string): string[] => text.split('\n')
    .filter(line => !/^\s*#/.test(line) && line.trim().length > 0);

const STEPS = ['inventory', 'rehearsal', 'barrier', 'drain', 'backup',
    'preflight', 'migrate', 'images', 'health', 'canary', 'reopen'];

describe('the order the cut-over is allowed to happen in', () => {
    it('declares the eleven steps, in the order the window needs them', () => {
        expect(SCRIPT).toContain(`STEPS=(${STEPS.join(' ')})`);
    });

    it('makes every step refuse until the ones before it are recorded', () => {
        // Not a paragraph. `require_prior_steps` walks the list and stops on the
        // first one that has no state file, which is what turns "step 1 first"
        // from advice into a property of the program.
        for (const step of STEPS) {
            expect({ step, guarded: bodyOf(`step_${step}`).includes(`require_prior_steps ${step}`) })
                .toEqual({ step, guarded: true });
        }
        expect(SCRIPT).toContain('fatal "\'${target}\' cannot run: \'${step}\' has not completed.');
    });

    it('records each step so a failed window resumes instead of starting over', () => {
        // A retry from the top would take the backup again over a database that
        // is already half migrated.
        for (const step of STEPS) {
            expect({ step, recorded: bodyOf(`step_${step}`).includes(`mark_done ${step}`) })
                .toEqual({ step, recorded: true });
        }
        // And the record names the starting state it ran against, so a window
        // resumed a day later against a changed host is visible.
        expect(SCRIPT).toContain('inventorySha256=%s');
    });

    it('never starts a container before the restore is proven and the window is open', () => {
        // The reproduced defect: `compose up` was step 1. `up` may appear only in
        // the two steps at or after `images`, and `images` is guarded by every
        // step before it.
        const allowed = new Set(['images', 'reopen']);
        for (const step of STEPS) {
            const ups = executable(bodyOf(`step_${step}`)).filter(line => /\bup\b\s+-d/.test(line));
            expect({ step, startsContainers: ups.length > 0, allowed: allowed.has(step) })
                .toEqual({ step, startsContainers: allowed.has(step), allowed: allowed.has(step) });
        }
        // `run --rm` is not `up`: it starts one throw-away container and removes
        // it, replacing nothing that is serving traffic.
        expect(executable(bodyOf('step_inventory')).join('\n')).toContain('run --rm');
        expect(executable(bodyOf('step_inventory')).join('\n')).not.toMatch(/\bup\b\s+-d/);
    });
});

describe('one dump format, and every restore failure fatal', () => {
    it('names one format and uses it for both dumps', () => {
        // The runbook said `pg_dumpall`, which nothing in this repository writes
        // and `pg_restore` cannot read. This is what `deploy.yml` takes for its
        // return point and what `infra/backup/backup.sh` writes nightly.
        expect(SCRIPT).toContain('DUMP_FORMAT=custom');
        const dumps = executable(SCRIPT).filter(line => line.includes('pg_dump '));
        expect(dumps.length).toBe(2);
        for (const line of dumps) {
            expect({ line: line.trim(), pinned: line.includes('--format="${DUMP_FORMAT}"') })
                .toEqual({ line: line.trim(), pinned: true });
        }
    });

    it('refuses to continue past a failed restore', () => {
        // `infra/backup/restore.sh` reports a failed `pg_restore` as
        // "WARN: some restore warnings (usually safe)" and carries on, so a
        // restore that restored nothing looks exactly like one that worked.
        const rehearsal = bodyOf('step_rehearsal');
        expect(rehearsal).toContain('--exit-on-error');
        expect(rehearsal).toContain('This is fatal on purpose');
        // Nothing anywhere in this file downgrades a failure to a warning.
        for (const line of executable(SCRIPT)) {
            expect({ line: line.trim(), downgraded: /\|\|\s*(log|echo)\s+"?WARN/i.test(line) })
                .toEqual({ line: line.trim(), downgraded: false });
        }
    });

    it('empties the rehearsal target and proves it empty before restoring', () => {
        // Reproduced while writing this: a restore that omitted every tenant
        // schema compared CLEAN, because the target still held the previous
        // run's rows. A restore that restores nothing is indistinguishable from
        // one that works when the destination already contains the answer.
        const rehearsal = bodyOf('step_rehearsal');
        const empty = rehearsal.indexOf('emptying');
        const restore = rehearsal.indexOf('pg_restore');
        expect(empty).toBeGreaterThan(-1);
        expect(restore).toBeGreaterThan(empty);
        expect(rehearsal).toContain('still holds ${before} table(s) after being emptied');
    });

    it('compares schemas and row counts, not exit codes', () => {
        const compare = bodyOf('compare_schemas_and_counts');
        expect(compare).toContain('query_to_xml');
        expect(compare).toContain("c.relkind = 'r'");
        expect(compare).toContain('diff -u');
        expect(bodyOf('step_rehearsal')).toContain('compare_schemas_and_counts "${REHEARSAL_URL}"');
    });

    it('refuses a rehearsal target that does not SAY it is disposable', () => {
        const rehearsal = bodyOf('step_rehearsal');
        expect(rehearsal).toContain('*_eval_isolation|*rehearsal*');
        expect(rehearsal).toContain('does not SAY it is disposable');
        expect(rehearsal).toContain('the rehearsal target is the operational database');
    });

    it('verifies the return point reads back, rather than that a file was written', () => {
        const backup = bodyOf('step_backup');
        expect(backup).toContain('pg_restore --list');
        expect(backup).toContain('not a readable ${DUMP_FORMAT}-format archive');
        expect(backup).toContain('sha256sum');
    });

    it('runs every PostgreSQL client inside the container, never on the host', () => {
        // The host has no `postgresql-client`; calling `pg_dump` there is how the
        // nightly backup once produced 0-byte dumps that looked complete.
        for (const line of executable(SCRIPT)) {
            if (!/\b(psql|pg_dump|pg_restore)\b/.test(line)) continue;
            if (/^(pg_in_container|psql_admin)\(\)/.test(line.trim())) continue;
            expect({ line: line.trim(), viaContainer: /pg_in_container|psql_admin|docker exec/.test(line) })
                .toEqual({ line: line.trim(), viaContainer: true });
        }
    });
});

describe('nothing is relative, guessed or floating', () => {
    it('fails fast rather than tolerating a relative path', () => {
        expect(SCRIPT).toContain('--evidence must be an ABSOLUTE path');
        expect(SCRIPT).toContain('--manifest must be an ABSOLUTE path');
    });

    it('pins the working directory to the repository this file lives in', () => {
        // A cut-over run from `~` picks up a different `.env`, a different
        // compose file and a different project name, and the three
        // disagreements do not announce themselves.
        expect(SCRIPT).toContain('REPO_ROOT="$(cd "${SCRIPT_PATH}/../.." && pwd)"');
        expect(SCRIPT).toContain('cd "${REPO_ROOT}"');
        expect(SCRIPT).toContain('COMPOSE_FILE="${REPO_ROOT}/infra/docker/docker-compose.prod.yml"');
    });

    it('states the compose project name instead of letting the directory decide it', () => {
        expect(SCRIPT).toContain('COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-docker}"');
        expect(SCRIPT).toContain('export COMPOSE_PROJECT_NAME');
        for (const line of executable(SCRIPT)) {
            if (!line.includes('docker compose')) continue;
            expect({ line: line.trim(), named: line.includes('--project-name') })
                .toEqual({ line: line.trim(), named: true });
        }
    });

    it('takes GIT_SHA and the five digests from the manifest, not from a tag', () => {
        expect(SCRIPT).toContain('export GIT_SHA');
        expect(SCRIPT).toContain('export IMAGE_TAG="candidate-${GIT_SHA}"');
        expect(SCRIPT).toContain('apply-candidate-manifest.cjs');
        expect(SCRIPT).toContain('the manifest cannot pin five digests; nothing below may run');
        // And the override is what every command that touches the new image uses.
        expect(SCRIPT).toContain('DC_PINNED=("${DC[@]}" -f "${EVIDENCE}/docker-compose.candidate.yml")');
        for (const step of ['preflight', 'migrate', 'images', 'reopen']) {
            expect({ step, pinned: bodyOf(`step_${step}`).includes('DC_PINNED') })
                .toEqual({ step, pinned: true });
        }
    });

    it('proves the containers are the approved bytes before calling the window healthy', () => {
        expect(bodyOf('step_health')).toContain('--verify');
        expect(bodyOf('step_health'))
            .toContain('what is answering requests is not the candidate that was approved');
    });

    it('never contains `latest`, and never an SSH step', () => {
        for (const forbidden of [':latest', 'appleboy/ssh-action', 'SERVER_SSH_KEY']) {
            expect({ forbidden, present: executable(SCRIPT).join('\n').includes(forbidden) })
                .toEqual({ forbidden, present: false });
        }
    });

    it('stops on the first error instead of running the rest of the window', () => {
        expect(SCRIPT.split('\n').find(line => line.startsWith('set '))).toBe('set -euo pipefail');
    });

    it('checks the host tools it needs before the window, not during it', () => {
        expect(SCRIPT).toContain('require_host_tools');
        expect(SCRIPT).toContain('Install them before the window opens.');
    });
});

describe('the barrier is global, and the canary names tenants', () => {
    it('stops every writer and makes the database itself refuse writes', () => {
        // Pausing the worker was never a barrier: the API, the WhatsApp service
        // and anything arriving through Cloudflare keep writing, and a row in the
        // old shape can be born between the preflight's photograph and the
        // migration.
        const barrier = bodyOf('step_barrier');
        for (const service of ['worker', 'api', 'whatsapp', 'dashboard', 'landing']) {
            expect({ service, stopped: barrier.includes(service) }).toEqual({ service, stopped: true });
        }
        expect(barrier).toContain('default_transaction_read_only = on');
        // New sessions inherit the setting; the ones already open do not.
        expect(barrier).toContain('pg_terminate_backend');
    });

    it('lifts the read-only flag only for the migration, and only then', () => {
        expect(bodyOf('step_migrate')).toContain('default_transaction_read_only = off');
        expect(bodyOf('step_reopen')).toContain('RESET default_transaction_read_only');
    });

    it('refuses an empty pilot list, because the service reads it as everyone', () => {
        expect(bodyOf('step_canary'))
            .toContain('an empty list is read as EVERY tenant');
    });

    it('refuses to migrate on a tenant summary nobody can read', () => {
        const migrate = bodyOf('step_migrate');
        expect(migrate).toContain('MIGRATE_TENANTS_SUMMARY');
        expect(migrate).toContain('emitted no verifiable summary');
        expect(migrate).toContain('the tenant migration is incomplete');
    });

    it('keeps the agreed-terms gate on the old schema, before the migrations', () => {
        expect(STEPS.indexOf('preflight')).toBeLessThan(STEPS.indexOf('migrate'));
        expect(bodyOf('step_preflight')).toContain('AGREED_TERMS_PREFLIGHT .*blocks=0');
    });
});
