import { spawnSync } from 'child_process';
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
const SCRIPT_PATH = resolve(ROOT, 'infra', 'scripts', 'october-cutover.sh');
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8').replace(/\r\n/g, '\n');

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

describe('the runbook and the script say the same thing', () => {
    const RUNBOOK = readFileSync(resolve(ROOT, 'docs', 'runbooks', 'october-cutover.md'), 'utf8')
        .replace(/\r\n/g, '\n');

    it('names no dump format that nothing in this repository produces', () => {
        // The runbook said "tomar el dump por el camino que usa el deploy
        // (`pg_dumpall`)". The deploy writes `pg_dump --format=custom`. Somebody
        // following that sentence during a window would have produced a file
        // `pg_restore` cannot read and called it a return point.
        //
        // It may still be NAMED — the runbook keeps the sentence as the defect
        // it was — but only on a line that carries the correction with it. A
        // line that names it without saying what the deploy actually writes is
        // an instruction again.
        const lines = RUNBOOK.split('\n').filter(line => line.includes('pg_dumpall'));
        for (const line of lines) {
            expect({ line: line.trim(), corrected: line.includes('pg_dump --format=custom') })
                .toEqual({ line: line.trim(), corrected: true });
        }
        expect(RUNBOOK).toContain('pg_dump --format=custom');
    });

    it('points at the executable procedure rather than describing eleven steps', () => {
        expect(RUNBOOK).toContain('infra/scripts/october-cutover.sh');
        for (const step of STEPS) {
            expect({ step, documented: RUNBOOK.includes(`\`${step}\``) })
                .toEqual({ step, documented: true });
        }
    });

    it('records the external gates the script refuses without', () => {
        // Each of these is a refusal the script makes at start-up. A runbook
        // that did not list them turns a fail-closed control into a surprise
        // with the window already booked.
        for (const gate of ['CANDIDATE_AUTHORIZED_ACTORS', 'candidate-images', 'Node en el host']) {
            expect({ gate, listed: RUNBOOK.includes(gate) }).toEqual({ gate, listed: true });
        }
    });

    it('says out loud that production is on a different PostgreSQL major', () => {
        // The candidate is proven on 17; `docker-compose.prod.yml` runs
        // `pgvector/pgvector:pg16`. Raising the production major is a data
        // migration with its own window, so it is not smuggled into this change
        // — but a divergence nobody wrote down is one nobody decides about.
        const compose = readFileSync(resolve(ROOT, 'infra', 'docker', 'docker-compose.prod.yml'), 'utf8');
        const productionMajor = /pgvector\/pgvector:pg(\d+)/.exec(compose)?.[1];
        expect(productionMajor).toBeDefined();
        if (productionMajor !== '17') {
            expect(RUNBOOK).toContain(`Producción corre PostgreSQL ${productionMajor}`);
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
        expect(barrier).toContain('set_write_barrier on');
        expect(bodyOf('set_write_barrier')).toContain('default_transaction_read_only = on');
        // New sessions inherit the setting; the ones already open do not.
        expect(barrier).toContain('pg_terminate_backend');
    });

    it('closes the ingress itself, not five containers behind it', () => {
        // Every `ports:` entry in `docker-compose.prod.yml` binds 127.0.0.1, so
        // nothing outside the host reaches this stack except through
        // `parallext-tunnel`. Stopping the app containers and leaving the tunnel
        // up closes nothing the moment a later step brings them back, which is
        // exactly what step 8 used to do.

        expect(bodyOf('step_barrier')).toContain('stop tunnel');

        // ── AND THE SHAPE THE DEFECT ACTUALLY HAD ─────────────────────
        //
        // The reproduced defect was a bare `up -d --force-recreate` with NO
        // service list, which brings the tunnel back with everything else. A
        // check that only looks for a step NAMING the tunnel cannot see it:
        // the offending line contains no `tunnel` token at all. So every
        // `up -d` in this script has to name what it is starting.
        const SERVICES = ['worker', 'api', 'whatsapp', 'dashboard', 'landing', 'tunnel'];
        for (const line of SCRIPT.split(String.fromCharCode(10))) {
            if (!line.includes('up -d') || line.trim().startsWith('#')) continue;
            const after = line.slice(line.indexOf('up -d') + 'up -d'.length);
            const named = SERVICES.some(service => after.includes(' ' + service));
            expect({ line: line.trim(), named }).toEqual({ line: line.trim(), named: true });
        }
    });

    it('re-arms the write barrier when the migration ends, pass or fail', () => {
        // It used to go off at the top of step 7 and never come back, so "the
        // read-only flag, for the migration only" described the first line of the
        // step and nothing after it.
        const migrate = bodyOf('step_migrate');
        expect(migrate).toContain('set_write_barrier off');
        // Once on the failed-prisma path and once after the tenant migrations,
        // BEFORE the three refusals that follow it.
        expect((migrate.match(/set_write_barrier on/g) ?? []).length).toBe(2);
        const rearmed = migrate.lastIndexOf('set_write_barrier on');
        for (const refusal of ['the tenant migration exited', 'emitted no verifiable summary',
            'the tenant migration is incomplete']) {
            expect({ refusal, afterRearm: migrate.indexOf(refusal) > rearmed })
                .toEqual({ refusal, afterRearm: true });
        }
    });

    it('reads the write barrier back instead of trusting the ALTER', () => {
        // `ALTER DATABASE … SET` exiting 0 says a statement was accepted, not
        // that the next session will refuse to write. Every `psql_admin` call
        // opens a NEW session, so `SHOW` in one reports what the database now
        // hands out — which is what the barrier is a claim about.
        const setter = bodyOf('set_write_barrier');
        expect(setter).toContain('SHOW default_transaction_read_only');
        expect(setter).toContain('the write barrier did not take');
        // RESET is its own case: it removes the per-database override rather
        // than writing `off` over it, and the two agree only when the server
        // default is off — which the read-back then proves instead of assuming.
        expect(setter).toContain('RESET default_transaction_read_only');
    });

    it('keeps the ingress shut until step 11, and names what it starts', () => {
        // `up -d --force-recreate` with NO service list brought the entire public
        // surface back at step 8 — three steps before the step called "reopen" —
        // and put `postgres` in the scope of `--force-recreate` in the middle of
        // its own migration.
        const images = bodyOf('step_images');
        expect(images).toContain('--no-deps');
        expect(images).toContain('up -d --no-deps --force-recreate worker api whatsapp dashboard landing');
        expect(images).not.toContain('tunnel');
        // And `reopen` is the ONLY step that opens the door.
        const openers = STEPS.filter(step => /up -d[^\n]*\btunnel\b/.test(bodyOf(`step_${step}`)));
        expect(openers).toEqual(['reopen']);
        // It goes last inside that step, after the services behind it are up: a
        // tunnel pointing at a container that is not there is a 502 for every
        // tenant at once.
        const reopen = bodyOf('step_reopen');
        expect(reopen.indexOf('tunnel')).toBeGreaterThan(reopen.indexOf('up -d --no-deps worker'));
    });

    it('requires a pilot list the program actually enforces', () => {
        // The refusal used to claim a semantic nothing implements — "an empty
        // list is read as EVERY tenant" — while `PILOT_TENANTS` was written to a
        // file and read by nobody. A restriction described but not enforced is
        // worse than an absent one: it is believed.
        const canary = bodyOf('step_canary');
        expect(canary).not.toContain('an empty list is read as EVERY tenant');
        expect(canary).toContain('--pilot-tenants is required');
        // Each id is a UUID, and each UUID names a tenant that exists.
        expect(canary).toContain('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
        expect(canary).toContain('FROM public.tenants WHERE id =');
        expect(canary).toContain('these pilot ids name no tenant');
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

/**
 * ═══ THE TWO CONTROLS THAT HAVE TO BE RUN TO BE BELIEVED ═══
 *
 * Everything above reads the script. That is the right instrument for "is the
 * order enforced" and the wrong one for these two, because both of them were
 * already fully present IN THE TEXT and did nothing:
 *
 *   · `mark_done` stamped every state file with `inventorySha256` and `gitSha`
 *     under the comment "so a resumed window cannot silently continue against a
 *     different starting state". Nothing compared them — the only coverage was
 *     an assertion that the script contained the printf FORMAT STRING, which
 *     would have passed just as well with both values hard-coded to 0.
 *   · `step_canary` logged "verify … then re-run with --only reopen" and called
 *     `mark_done` immediately, and `mark_done` is what the resume loop reads. So
 *     the loop did not stop: it went on to step 11 in the same breath and opened
 *     the window to every tenant while a person was still looking at the pilot.
 *
 * So these run the real script, with `docker` replaced by a stub that records
 * its arguments and answers the two queries the steps make. No VPS and no
 * PostgreSQL: what is under test is the program's own control flow, which is
 * where both defects lived.
 */
const CUTOVER_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

/** A manifest `apply-candidate-manifest.cjs` accepts, so GIT_SHA gets a value. */
const MANIFEST = JSON.stringify({
    version: 3,
    sha: CUTOVER_SHA,
    verification: {
        workflow: 'candidate', runId: '1234567890', runAttempt: '1',
        repository: 'Nipko/sales-structure', conclusion: 'success',
    },
    dashboardBuildInputs: {
        urls: {
            NEXT_PUBLIC_API_URL: 'https://api.parallly-chat.cloud',
            NEXT_PUBLIC_WA_SERVICE_URL: 'https://wa.parallly-chat.cloud',
        },
        digests: Object.fromEntries([
            'NEXT_PUBLIC_META_APP_ID', 'NEXT_PUBLIC_META_CONFIG_ID',
            'NEXT_PUBLIC_META_SOLUTION_ID', 'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
            'NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
            'NEXT_PUBLIC_INSTAGRAM_APP_ID', 'NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI',
        ].map((name, index) => [name, `${index}123456789abcdef`])),
    },
    images: Object.fromEntries(
        ['api', 'worker', 'dashboard', 'whatsapp', 'landing'].map((service, index) => [service, {
            tag: `ghcr.io/nipko/parallext-${service}:candidate-${CUTOVER_SHA}`,
            digest: `sha256:${index + 1}${'0'.repeat(63)}`,
        }])),
});

/**
 * Runs the cut-over script in a scratch evidence directory. `setup` runs first
 * with `$EV` set and a `record <step> <inventorySha> <gitSha>` helper available;
 * `args` is appended to `--evidence $EV`.
 */
const PILOT_ID = '4f0c1111-2222-4333-8444-555566667777';

/**
 * The `dispatch.normalOutbox` row the canary now cross-checks itself against.
 *
 * The step used to announce "the pilot window is OPEN for <ids>" while
 * writing nothing and reading nothing — the ids were validated, echoed into a
 * file and read by no other code, and the row that really opens the lane was
 * never consulted. So a fixture with no row at all is now a REFUSAL, which is
 * why this default exists.
 */
const ROLLOUT_ROW = `{"enabled":true,"tenantIds":["${PILOT_ID}"],"channels":["whatsapp"]}`;

const runCutover = (setup: string, args: string, tenantRows = '1',
    rolloutRow: string = ROLLOUT_ROW) => {
    const harness = [
        'set -u',
        'EV="$(mktemp -d)"',
        'trap \'rm -rf "$EV"\' EXIT',
        'mkdir -p "$EV/state" "$EV/bin"',
        'cat > "$EV/bin/docker" <<\'STUB\'',
        '#!/bin/bash',
        'printf \'%s\\n\' "$*" >> "$STUB_LOG"',
        'case " $* " in',
        '  *"SHOW default_transaction_read_only"*) printf \'off\\n\' ;;',
        '  *"FROM public.tenants"*)                printf \'%s\\n\' "$STUB_TENANT_ROWS" ;;',
        '  *"dispatch.normalOutbox"*)              printf \'%s\\n\' "$STUB_ROLLOUT" ;;',
        'esac',
        'exit 0',
        'STUB',
        'chmod +x "$EV/bin/docker"',
        'export STUB_LOG="$EV/calls.log"; : > "$STUB_LOG"',
        `export STUB_TENANT_ROWS='${tenantRows}'`,
        `export STUB_ROLLOUT='${rolloutRow}'`,
        'printf \'{"unknown_probes":[]}\' > "$EV/inventory.json"',
        'INV="$(sha256sum "$EV/inventory.json" | cut -d\' \' -f1)"',
        'cat > "$EV/m.json" <<\'MANIFEST\'',
        MANIFEST,
        'MANIFEST',
        'record() { printf \'step=%s\\ncompletedAt=2026-10-01T03:00:00Z\\ninventorySha256=%s\\ngitSha=%s\\n\' "$1" "$2" "$3" > "$EV/state/$1.done"; }',
        setup,
        `PATH="$EV/bin:$PATH" bash '${SCRIPT_PATH.replace(/\\/g, '/')}' --evidence "$EV" ${args}`,
        'rc=$?',
        'echo "---CALLS---"; cat "$STUB_LOG"',
        'echo "---ACCEPTED---"; cat "$EV/changed-start-accepted.txt" 2>/dev/null',
        'echo "---CANARY-DONE---"; cat "$EV/state/canary.done" 2>/dev/null',
        'echo "---REOPEN-DONE---"; cat "$EV/state/reopen.done" 2>/dev/null',
        'echo "---EXIT---$rc"',
        'exit 0',
    ].join('\n');
    const result = spawnSync('bash', ['-c', harness], { encoding: 'utf8', timeout: 120_000 });
    if (result.error) throw result.error;
    const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const between = (from: string, to: string) => out.split(from)[1]?.split(to)[0] ?? '';
    return {
        out,
        calls: between('---CALLS---', '---ACCEPTED---'),
        accepted: between('---ACCEPTED---', '---CANARY-DONE---'),
        canaryDone: between('---CANARY-DONE---', '---REOPEN-DONE---').trim(),
        reopenDone: between('---REOPEN-DONE---', '---EXIT---').trim(),
        // Matched rather than split on: `fatal` writes to stderr, which is
        // appended after stdout here, so everything "after" the marker includes
        // the diagnostic and trimming it yields NaN.
        exit: Number(/---EXIT---(\d+)/.exec(out)?.[1]),
    };
};

/** Records steps 1…`upTo` as done against the current inventory and `sha`. */
const recordThrough = (upTo: string, sha = CUTOVER_SHA) =>
    STEPS.slice(0, STEPS.indexOf(upTo) + 1)
        .map(step => `record ${step} "$INV" ${sha}`).join('\n');

describe('a resumed window checks WHERE it started, not only how far it got', () => {
    it('refuses when the host census moved under a recorded step', () => {
        const run = runCutover(
            `${recordThrough('inventory')}\nprintf '{"unknown_probes":[],"disk":"grew"}' > "$EV/inventory.json"`,
            '--only rehearsal');
        expect(run.out).toContain('this window did not start where it is being resumed');
        expect(run.out).toContain("'inventory' ran against inventory");
        expect(run.exit).toBe(1);
    });

    it('refuses when this run carries a different candidate commit', () => {
        // Recorded against one candidate, resumed with the manifest of another.
        const run = runCutover(recordThrough('health', OTHER_SHA),
            '--only reopen --manifest "$EV/m.json"');
        expect(run.out).toContain(`'inventory' ran against candidate ${OTHER_SHA}`);
        expect(run.out).toContain(`this run carries ${CUTOVER_SHA}`);
        expect(run.exit).toBe(1);
    });

    it('continues, on the record, when a person says why it is safe', () => {
        const run = runCutover(
            `${recordThrough('inventory')}\nprintf '{"unknown_probes":[],"disk":"grew"}' > "$EV/inventory.json"`,
            '--only rehearsal --accept-changed-start "se agregó disco el 2-oct; revisado por N."');
        // It got past the starting-state guard and stopped at the next real
        // refusal, which is how we know the override lifted that one and nothing
        // else.
        expect(run.out).toContain('--rehearsal-url is required');
        expect(run.accepted).toContain('se agregó disco el 2-oct');
        expect(run.accepted).toContain('ran against inventory');
    });

    it('does not treat a missing manifest as a changed candidate', () => {
        // `unset` is what a run given no --manifest records. Only two CONCRETE
        // commits that disagree mean a different candidate; refusing on a
        // missing one would make `--only rehearsal` impossible to resume.
        const run = runCutover(recordThrough('inventory', 'unset'), '--only rehearsal');
        expect(run.out).not.toContain('did not start where it is being resumed');
        expect(run.out).toContain('--rehearsal-url is required');
    });
});

describe('the canary is a gate the program stops at', () => {
    const PILOT = '4f0c1111-2222-4333-8444-555566667777';

    it('does not record itself, and the window does not reach step 11', () => {
        // The reproduced defect, run end to end: an unattended invocation with
        // steps 1-9 already recorded used to run the canary, mark it done, and
        // continue into `reopen` in the same loop — opening the ingress to every
        // tenant while the pilot was still being looked at.
        const run = runCutover(recordThrough('health'),
            `--manifest "$EV/m.json" --pilot-tenants ${PILOT}`);
        expect(run.out).toContain('the canary is not recorded until a person says they checked it');
        expect(run.canaryDone).toBe('');
        expect(run.reopenDone).toBe('');
        // And nothing was started: no `up -d` at all, and the tunnel untouched.
        expect(run.calls).not.toContain('up -d');
        expect(run.calls).not.toContain('tunnel');
        expect(run.exit).toBe(1);
    });

    it('records it when a person attests, and only then', () => {
        const run = runCutover(recordThrough('health'),
            `--manifest "$EV/m.json" --pilot-tenants ${PILOT} `
            + '--canary-verified "N.L. revisó 6 entregas, 0 duplicados, 0 errores de fondeo"');
        expect(run.canaryDone).toContain('step=canary');
        expect(run.out).toContain('canary: recorded — N.L. revisó 6 entregas');
    });

    /**
     * ═══ THE SCOPE HAS TO BE THE ONE THE PLATFORM IS USING ═══
     *
     * The step announced "the pilot window is OPEN for <ids>" and opened
     * nothing: `--pilot-tenants` was checked for shape, checked for
     * existence, written to a file and read by no other code. What actually
     * opens the durable lane is the `dispatch.normalOutbox` row, and this
     * script never looked at it.
     *
     * So the operator attested to a scope that lived only in their own
     * argument — on a programme whose whole subject is per-message money.
     * These three cases are the cross-check that makes the sentence true.
     */
    it('refuses when no pilot is configured at all', () => {
        const run = runCutover(recordThrough('health'),
            `--manifest "$EV/m.json" --pilot-tenants ${PILOT} --canary-verified "miré"`,
            '1', '');
        expect(run.out).toContain('dispatch.normalOutbox is not set');
        expect(run.canaryDone).not.toContain('step=canary');
        expect(run.exit).toBe(1);
    });

    it('refuses a row that names NOBODY, because that row reads as everybody', () => {
        // `DispatchPilotScope` says it in as many words: an empty tenant list
        // is the full rollout. A pilot that forgets to name its tenant is not
        // a pilot that does nothing.
        const run = runCutover(recordThrough('health'),
            `--manifest "$EV/m.json" --pilot-tenants ${PILOT} --canary-verified "miré"`,
            '1', '{"enabled":true,"tenantIds":[],"channels":["whatsapp"]}');
        expect(run.out).toContain('names NO tenants');
        expect(run.out).toContain('full rollout');
        expect(run.exit).toBe(1);
    });

    it('refuses a pilot id the lane is not actually open for', () => {
        const run = runCutover(recordThrough('health'),
            `--manifest "$EV/m.json" --pilot-tenants ${PILOT} --canary-verified "miré"`,
            '1', '{"enabled":true,"tenantIds":["99999999-9999-4999-8999-999999999999"],'
            + '"channels":["whatsapp"]}');
        expect(run.out).toContain('not in dispatch.normalOutbox');
        expect(run.exit).toBe(1);
    });

    it('says plainly that outbound is live for everyone during the canary', () => {
        // The sentence an operator reads while attesting. Step 8 restarts the
        // five services with no queue pause anywhere in this script, so from
        // there until step 11 outbound processing is platform-wide; the pilot
        // list scopes the durable LANE, not the platform. Saying otherwise is
        // what makes "6 entregas, 0 duplicados" an attestation about a
        // surface the attester was not told they were looking at.
        const run = runCutover(recordThrough('health'),
            `--manifest "$EV/m.json" --pilot-tenants ${PILOT}`);
        expect(run.out).toContain('outbound processing itself is live for every tenant');
        expect(run.out).not.toContain('the pilot window is OPEN');
    });

    it('refuses an attestation with nothing in it', () => {
        const run = runCutover(recordThrough('health'),
            `--manifest "$EV/m.json" --pilot-tenants ${PILOT} --canary-verified ""`);
        expect(run.out).toContain('--canary-verified needs a note saying who checked what');
        expect(run.exit).toBe(1);
    });

    it('refuses a pilot id that names no tenant', () => {
        // A typo'd id produced a canary that verified nothing and a file that
        // said it had.
        const run = runCutover(recordThrough('health'),
            `--manifest "$EV/m.json" --pilot-tenants ${PILOT} --canary-verified "miré"`, '0');
        expect(run.out).toContain(`these pilot ids name no tenant: ${PILOT}`);
        expect(run.canaryDone).toBe('');
        expect(run.exit).toBe(1);
    });
});
