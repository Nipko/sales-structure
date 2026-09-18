import { readFileSync } from 'fs';
import { resolve } from 'path';
import { load } from 'js-yaml';

/**
 * ═══ THE CANDIDATE WORKFLOW, PARSED — NOT GREPPED ═══
 *
 * Everything this file asserts was a reproduced defect or is the fix for one,
 * and every assertion reads the PARSED workflow rather than its text. The
 * difference is not stylistic: `expect(text).toContain('permissions')` passes on
 * a comment, and the safety of this workflow is made entirely of properties
 * somebody could remove in one line while adding a feature.
 *
 * What was wrong, in the order the audit found it:
 *
 *   1. **The approval was sticky.** `build-candidate` stayed on the pull request
 *      and the trigger listened for `synchronize`, so one reviewer's approval of
 *      commit A kept authorising commits B…F — each of them running the branch's
 *      own code with secrets and `packages: write`.
 *   2. **Everything had every permission.** One job, one top-level
 *      `permissions: {contents: read, packages: write}`, so the step that ran
 *      the pull request's test suite could push images.
 *   3. **A red run published a consumable artefact.** `upload-artifact` carried
 *      `if: always()`, and the cut-over's first instruction is to download that
 *      artefact and turn it into what a production host starts.
 *   4. **The suite proved nothing.** Every PostgreSQL-, PgBouncer- and
 *      Valkey-backed suite skips itself when its variable is unset, and the job
 *      ran `npx jest --ci` with no database at all.
 *   5. **`workflow_dispatch` had never worked once.** The step that resolved the
 *      SHA read `steps.subject.outputs.sha` — its OWN output, before writing it —
 *      so a dispatch resolved the empty string and died at the next step.
 *
 * The fifth is the one that gets a GENERAL check rather than a specific one: a
 * step reading an output nothing has written is a mistake a person cannot see by
 * reading, so the last describe here walks every expression in the file.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const FILE = resolve(ROOT, '.github', 'workflows', 'candidate.yml');
const TEXT = readFileSync(FILE, 'utf8');
const WORKFLOW = load(TEXT) as any;

/** The YAML of one job, rendered back out, so a whole-job text check is honest. */
const jobText = (name: string): string => JSON.stringify(WORKFLOW.jobs[name]);

const steps = (job: string): any[] => (WORKFLOW.jobs[job].steps || []);
const runLines = (job: string): string[] => steps(job)
    .filter(step => typeof step.run === 'string')
    .flatMap(step => String(step.run).split(/\r?\n/));

describe('who may ask for a candidate, and for which commit', () => {
    it('listens for a label being applied, and for nothing else on a pull request', () => {
        // `synchronize` and `reopened` are what turned one human approval into a
        // standing authorisation for every later push.
        expect(WORKFLOW.on.pull_request.types).toEqual(['labeled']);
        expect(WORKFLOW.on.pull_request.types).not.toContain('synchronize');
        expect(WORKFLOW.on.pull_request.types).not.toContain('reopened');
    });

    it('only starts for a label that names a commit', () => {
        // `build-candidate` outlives the commit it was applied to.
        // `build-candidate-<sha12>` cannot: the workflow compares it with the
        // head it is looking at and refuses a mismatch.
        expect(WORKFLOW.jobs.authorize.if).toContain("startsWith(github.event.label.name, 'build-candidate-')");
        expect(runLines('authorize').join('\n'))
            .toContain('EXPECTED="build-candidate-$(printf \'%s\' "$SHA" | cut -c1-12)"');
        expect(runLines('authorize').some(line => line.includes('if [ "$LABEL" != "$EXPECTED" ]'))).toBe(true);
    });

    it('checks the repository, the head repository and the actor', () => {
        const text = jobText('authorize');
        // Ours; not a fork's branch (which must never reach a job with secrets);
        // and a person on a list that FAILS CLOSED when it is empty.
        expect(text).toContain('github.repository');
        expect(text).toContain('github.event.pull_request.head.repo.full_name');
        expect(text).toContain('vars.CANDIDATE_AUTHORIZED_ACTORS');
        expect(runLines('authorize').some(line => line.includes('if [ -z "${AUTHORISED:-}" ]'))).toBe(true);
    });

    it('has no permissions at all while it decides who asked', () => {
        expect(WORKFLOW.jobs.authorize.permissions).toEqual({});
    });
});

describe('how much power each job is given', () => {
    it('starts from nothing at the top of the file', () => {
        // A top-level grant is inherited by every job that does not override it,
        // including one somebody adds later.
        expect(WORKFLOW.permissions).toEqual({});
    });

    it('makes every job declare its own', () => {
        for (const [name, job] of Object.entries<any>(WORKFLOW.jobs)) {
            expect({ job: name, declares: job.permissions !== undefined })
                .toEqual({ job: name, declares: true });
        }
    });

    it('gives packages:write to exactly one job, and it is the one that pushes', () => {
        const writers = Object.entries<any>(WORKFLOW.jobs)
            .filter(([, job]) => job.permissions && job.permissions.packages === 'write')
            .map(([name]) => name);
        expect(writers).toEqual(['publish']);

        const pushers = Object.entries<any>(WORKFLOW.jobs)
            .filter(([, job]) => (job.steps || []).some((step: any) =>
                typeof step.uses === 'string' && step.uses.startsWith('docker/build-push-action')))
            .map(([name]) => name);
        expect(pushers).toEqual(['publish']);
    });

    it('puts the job that pushes behind a protected environment', () => {
        // The reviewers, the branch restriction and the scoped secrets live in
        // repository settings, so the approval to write to the registry is
        // recorded outside this file and cannot be granted by editing it.
        expect(typeof WORKFLOW.jobs.publish.environment).toBe('string');
        expect(WORKFLOW.jobs.publish.environment).not.toBe('production');
        expect(WORKFLOW.jobs.verify.environment).toBeUndefined();
        expect(WORKFLOW.jobs.authorize.environment).toBeUndefined();
    });

    it('never hands a secret to the job that runs the pull request s own code', () => {
        // `verify` checks out the candidate branch and executes it. It reads no
        // secret, so there is nothing there to exfiltrate; the credential lives
        // one job further down, behind the environment gate.
        expect(jobText('verify')).not.toContain('secrets.');
        expect(jobText('authorize')).not.toContain('secrets.');
    });

    it('still cannot deploy: no host, no key, no SSH step', () => {
        const executable = TEXT.split(/\r?\n/).filter(line => !/^\s*#/.test(line)).join('\n');
        for (const forbidden of ['SERVER_HOST', 'SERVER_SSH_KEY', 'appleboy/ssh-action', 'environment: production']) {
            expect({ forbidden, present: executable.includes(forbidden) })
                .toEqual({ forbidden, present: false });
        }
    });
});

describe('what the candidate has to survive before its images exist', () => {
    const verifyRun = runLines('verify').join('\n');

    it('builds the shared runtime before a source-backed artefact checker loads it', () => {
        const verifySteps = steps('verify');
        const sharedBuild = verifySteps.findIndex(step => step.name === 'Build shared runtime dependency');
        const artefacts = verifySteps.findIndex(step => step.name === 'Generated artefacts match their sources');
        expect(sharedBuild).toBeGreaterThan(-1);
        expect(String(verifySteps[sharedBuild].run))
            .toContain('npm run build --workspace=@parallext/shared');
        expect(artefacts).toBeGreaterThan(sharedBuild);
    });

    it('brings up PostgreSQL 17, and asserts it is 17', () => {
        expect(WORKFLOW.jobs.verify.services.postgres.image).toBe('pgvector/pgvector:pg17');
        // Configured is not proven. A service that silently came up as 16 would
        // run every migration test against a different planner.
        expect(verifyRun).toContain("SHOW server_version");
        expect(verifyRun).toContain('must be proven on PostgreSQL 17');
    });

    it('brings up PgBouncer in transaction mode, pinned by digest, and asserts the mode', () => {
        const pgbouncer = WORKFLOW.jobs.verify.services.pgbouncer;
        expect(pgbouncer.env.POOL_MODE).toBe('transaction');
        // The only image here that is not ours, so it is the one pinned hardest:
        // a candidate proven against "whatever `latest` was that morning" is
        // proven against something nobody can name afterwards.
        expect(pgbouncer.image).toMatch(/^edoburu\/pgbouncer@sha256:[0-9a-f]{64}$/);
        expect(verifyRun).toContain('PgBouncer is not in transaction mode');
        // And the suite that exercises the pool really points at it.
        expect(jobText('verify')).toContain('PARALLLY_PGBOUNCER_TEST_URL');
        expect(jobText('verify')).toContain('PARALLLY_PGBOUNCER_DIRECT_URL');
    });

    it('brings up Valkey and refuses any eviction policy but noeviction', () => {
        expect(WORKFLOW.jobs.verify.services.valkey.image).toMatch(/^valkey\/valkey:8/);
        expect(verifyRun).toContain('CONFIG GET maxmemory-policy');
        expect(verifyRun).toContain('BullMQ jobs would disappear silently');
    });

    it('runs the API suite against every one of those, with nothing allowed to skip', () => {
        // Each variable below is one suite that gates itself off when it is
        // unset. The previous version of this workflow set none of them.
        const text = jobText('verify');
        for (const variable of [
            'PARALLLY_ISOLATION_TEST_URL', 'AGENT_RELEASE_TEST_DATABASE_URL',
            'AGENT_REVISION_TEST_DATABASE_URL', 'CATALOG_ORDERS_TEST_DATABASE_URL',
            'REPAIR_ORDERS_TEST_DATABASE_URL', 'OPERATIONAL_NOTICE_REVIEW_TEST_DATABASE_URL',
            'PARALLLY_MIGRATION_TEST_URL', 'KNOWLEDGE_MEMORY_TEST_DATABASE_URL',
            'KNOWLEDGE_TEST_DATABASE_URL', 'KNOWLEDGE_CONFLICT_TEST_DATABASE_URL',
            'LEARNING_EVIDENCE_TEST_DATABASE_URL', 'DISPATCH_QUEUE_TEST_REDIS_URL',
            'PARALLLY_SAMPLING_REDIS_URL', 'RUN_PIPELINE_OWNERSHIP_PG_TESTS',
        ]) {
            expect({ variable, set: text.includes(variable) }).toEqual({ variable, set: true });
        }
        // Jest's exit code is not the check. The report is.
        expect(verifyRun).toContain('--json --outputFile');
        expect(verifyRun).toContain('assert-no-skipped-tests.cjs');
    });

    it('judges EVERY Jest report it writes, not just the last one', () => {
        // Both Jest runs use `|| true`, because the exit code is not the check.
        // A report written and never read is therefore worse than no report:
        // the step goes green whatever happened. Counting is not enough either —
        // the file that was written has to be the file that was judged.
        const written = [...verifyRun.matchAll(/--outputFile "([^"]+)"/g)].map(match => match[1]);
        const judged = [...verifyRun.matchAll(/--report "([^"]+)"/g)].map(match => match[1]);
        expect(written.length).toBeGreaterThan(1);
        expect([...written].sort()).toEqual([...judged].sort());
        // And nothing runs Jest without writing a report at all.
        // Shell continuations first: the command and its `--outputFile` are on
        // different physical lines, and a check that read them separately would
        // report the command as unreported.
        const logical = verifyRun.split('\n')
            .filter(line => !line.trim().startsWith('#'))
            .reduce<string[]>((lines, line) => {
                const previous = lines[lines.length - 1];
                if (previous !== undefined && previous.trimEnd().endsWith('\\')) {
                    lines[lines.length - 1] = `${previous.trimEnd().slice(0, -1)} ${line.trim()}`;
                } else {
                    lines.push(line);
                }
                return lines;
            }, []);
        // `test:e2e` is Playwright, which reports through its own junit reporter
        // and its own `forbidOnly`/`failOnFlakyTests`; it writes no Jest report
        // for this checker to read.
        const jestRuns = logical.filter(line => /\bjest\b|npm run test\b/.test(line)
            && !line.includes('assert-no-skipped-tests')
            && !line.includes('test:e2e'));
        for (const line of jestRuns) {
            expect({ line: line.trim(), reported: line.includes('--outputFile') })
                .toEqual({ line: line.trim(), reported: true });
        }
    });

    it('every disposable database it creates says it is disposable', () => {
        // The specs refuse a database whose name does not end in
        // `_eval_isolation`, so a mistyped variable cannot reach a shared or
        // production instance. The workflow must not be the place that gets it
        // wrong either.
        const DATABASE_URL = /postgres(?:ql)?:\/\/[^\s"'\\]*127\.0\.0\.1:\d+\\?\/([a-z0-9_]+)/g;
        const named = new Set<string>();
        for (const source of [verifyRun, jobText('verify')]) {
            for (const match of source.matchAll(DATABASE_URL)) named.add(match[1]);
        }
        // `postgres` is the maintenance database every `CREATE DATABASE` has to
        // connect through, and `pgbouncer` is PgBouncer's own admin console.
        // Neither holds data; everything else must say it is disposable.
        for (const name of [...named].filter(value => !['postgres', 'pgbouncer'].includes(value))) {
            expect({ database: name, disposable: name.endsWith('_eval_isolation') })
                .toEqual({ database: name, disposable: true });
        }
        expect([...named].some(name => name.endsWith('_eval_isolation'))).toBe(true);
    });

    it('checks the dependency graph Nest builds at boot, which tsc cannot see', () => {
        expect(verifyRun.includes('test:bootstrap') || jobText('verify').includes('test:bootstrap')).toBe(true);
    });

    it('runs the dashboard suite and the browser journeys, not only the API', () => {
        expect(jobText('verify')).toContain('--workspace=@parallext/dashboard');
        expect(jobText('verify')).toContain('playwright install');
        expect(jobText('verify')).toContain('npm run test:e2e');
    });

    it('typechecks five projects and builds five', () => {
        for (const project of ['packages/shared', 'apps/api', 'apps/dashboard', 'apps/whatsapp', 'apps/landing']) {
            expect({ project, typechecked: verifyRun.includes(`tsc -p ${project}/tsconfig.json --noEmit`) })
                .toEqual({ project, typechecked: true });
        }
        for (const workspace of ['@parallext/shared', '@parallext/api', '@parallext/whatsapp',
            '@parallext/dashboard', 'landing']) {
            expect({ workspace, built: verifyRun.includes(`npm run build --workspace=${workspace}`) })
                .toEqual({ workspace, built: true });
        }
    });

    it('runs every generator in --check mode, so CI cannot rewrite what it is judging', () => {
        for (const check of [
            'node apps/api/scripts/generate-whatsapp-rates.cjs --check',
            'node docs/audits/2026-09-09/verify-artifacts.cjs',
            'node apps/api/scripts/outbound-producer-inventory.cjs --check',
        ]) {
            expect({ check, run: verifyRun.includes(check) }).toEqual({ check, run: true });
        }
    });
});

describe('what may leave the run, and when', () => {
    const uploads = steps('publish').filter(step =>
        typeof step.uses === 'string' && step.uses.startsWith('actions/upload-artifact'));

    it('publishes the consumable artefact only out of a successful run', () => {
        // `if: always()` published a manifest for a candidate whose suite had
        // failed — and the cut-over's first instruction is to download it.
        expect(uploads).toHaveLength(1);
        expect(uploads[0].if).toBe('success()');
        expect(String(uploads[0].with.path)).toContain('candidate-manifest.json');
    });

    it('does not even start the publishing job unless verification was green', () => {
        expect(WORKFLOW.jobs.publish.needs).toEqual(['authorize', 'verify']);
        expect(WORKFLOW.jobs.publish.if).toContain("needs.verify.result == 'success'");
    });

    it('binds the manifest to the commit, the run, the bundle inputs and five digests', () => {
        const manifestStep = steps('publish').find(step => String(step.name).includes('digest manifest'));
        const body = String(manifestStep.run);
        expect(body).toContain('"version": 3');
        expect(body).toContain('"sha": "${SHA}"');
        expect(body).toContain('"conclusion": "${VERIFY_RESULT}"');
        expect(body).toContain('"dashboardBuildInputs"');
        for (const service of ['api', 'worker', 'dashboard', 'whatsapp', 'landing']) {
            expect({ service, pinned: body.includes(`"${service}"`) }).toEqual({ service, pinned: true });
        }
        // And it refuses to write itself if the verification says anything else,
        // rather than trusting `needs` alone.
        expect(body).toContain('refusing to write a manifest a cut-over would read as approval');
    });

    it('consumes the manifest it just wrote, before anything leaves the job', () => {
        const names = steps('publish').map(step => String(step.name || step.uses));
        const consumed = names.findIndex(name => name.includes('compose override that pins'));
        const uploaded = names.findIndex(name => name.startsWith('actions/upload-artifact'));
        expect(consumed).toBeGreaterThan(-1);
        expect(uploaded).toBeGreaterThan(consumed);
    });

    it('tags the five images by the commit and never `latest`', () => {
        const executable = TEXT.split(/\r?\n/).filter(line => !/^\s*#/.test(line)).join('\n');
        expect(executable).not.toMatch(/:latest\b/);
        for (const step of steps('publish')) {
            if (typeof step.uses !== 'string' || !step.uses.startsWith('docker/build-push-action')) continue;
            expect(String(step.with.tags)).toMatch(/:candidate-\$\{\{ needs\.authorize\.outputs\.sha \}\}$/);
        }
    });
});

describe('no step reads an output nothing has written', () => {
    /**
     * The general form of a defect this workflow actually shipped: the step that
     * resolved the SHA read `steps.subject.outputs.sha` — its own id, before the
     * step had written anything — so `workflow_dispatch` resolved the empty
     * string and the run died two steps later complaining the SHA was not 40
     * characters. The trigger had never worked once, and nothing could see it by
     * reading, because the expression is spelled exactly like a correct one.
     */
    const OUTPUT_REF = /steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g;
    const NEEDS_REF = /needs\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g;

    /** Expressions only — a `steps.x.outputs.y` inside a comment proves nothing. */
    const withoutComments = (value: string) => value.split(/\r?\n/)
        .filter(line => !/^\s*#/.test(line)).join('\n');

    it('resolves every steps.*.outputs.* to a step that writes it, earlier, in the same job', () => {
        for (const [jobName, job] of Object.entries<any>(WORKFLOW.jobs)) {
            const jobSteps: any[] = job.steps || [];
            jobSteps.forEach((step, index) => {
                const scope = withoutComments(JSON.stringify(step));
                for (const [, id, name] of scope.matchAll(OUTPUT_REF)) {
                    const producerIndex = jobSteps.findIndex(other => other.id === id);
                    expect({ jobName, step: step.name, id, name, found: producerIndex !== -1 })
                        .toEqual({ jobName, step: step.name, id, name, found: true });
                    // Strictly earlier. A step reading its own id is the defect.
                    expect({ jobName, step: step.name, id, name, ordered: producerIndex < index })
                        .toEqual({ jobName, step: step.name, id, name, ordered: true });
                    const producer = jobSteps[producerIndex];
                    if (typeof producer.run !== 'string') continue; // an action's own outputs
                    expect({ jobName, id, name, written: producer.run.includes(`${name}=`)
                        || producer.run.includes(`echo "${name}<<`) })
                        .toEqual({ jobName, id, name, written: true });
                }
            });
        }
    });

    it('resolves every needs.*.outputs.* to an output that job actually declares', () => {
        for (const [jobName, job] of Object.entries<any>(WORKFLOW.jobs)) {
            const scope = withoutComments(JSON.stringify(job));
            for (const [, needed, name] of scope.matchAll(NEEDS_REF)) {
                const declared = WORKFLOW.jobs[needed] && WORKFLOW.jobs[needed].outputs;
                expect({ jobName, needed, name, declared: Boolean(declared && name in declared) })
                    .toEqual({ jobName, needed, name, declared: true });
                const needs = Array.isArray(job.needs) ? job.needs : [job.needs].filter(Boolean);
                expect({ jobName, needed, waits: needs.includes(needed) })
                    .toEqual({ jobName, needed, waits: true });
            }
        }
    });

    it('resolves the SHA once, in one place, and every later job reads that', () => {
        // A workflow that resolved it twice would eventually build one commit
        // and label it with another.
        expect(WORKFLOW.jobs.authorize.outputs.sha).toBe('${{ steps.subject.outputs.sha }}');
        for (const job of ['verify', 'publish']) {
            const checkout = steps(job).find(step => String(step.uses || '').startsWith('actions/checkout'));
            expect({ job, ref: checkout.with.ref }).toEqual({ job, ref: '${{ needs.authorize.outputs.sha }}' });
            expect(runLines(job).some(line => line.includes('checkout resolved to'))).toBe(true);
        }
    });

    it('reads inputs.sha on the dispatch path, not an output of its own step', () => {
        const subject = steps('authorize').find(step => step.id === 'subject');
        expect(subject.env.DISPATCH_SHA).toBe('${{ inputs.sha }}');
        expect(JSON.stringify(subject.env)).not.toContain('steps.subject.outputs');
    });
});
