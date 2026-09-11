import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assessPilotScope, PILOT_OFF, pilotScopeMatches } from '@parallext/shared';
import { assertDisposableTarget, DisposableTargetRefused, isOperationalTarget } from './disposable-target';
import { evidenceFrom, isEvidenceWorthy, redactForEvidence } from './operational-evidence';

const ROOT = resolve(__dirname, '../../../../..');

const refusal = (input: Parameters<typeof assertDisposableTarget>[0]): string | null => {
    try { assertDisposableTarget(input); return null; }
    catch (error) { return error instanceof DisposableTargetRefused ? error.reason : `unexpected:${error}`; }
};

/**
 * ═══ THE THREE THINGS THAT SURVIVED STAGING, AND WHY ═══
 *
 * The staging workflow is gone. The owner decided the October release migrates
 * the VPS that already serves tenants, so a second environment stopped being a
 * destination and became a thing to maintain for its own sake. Its seven
 * reproduced defects are closed by removal rather than by repair — with three
 * exceptions, because three of its ideas were about the operational host all
 * along and only looked like staging concerns:
 *
 *   1. **A destructive script must prove its destination is disposable.** More
 *      important now, not less: the destination it must never reach has real
 *      tenants in it.
 *   2. **A pilot must name a tenant and a channel the transport can serve.** An
 *      empty tenant list means every tenant, and a channel with no strict
 *      transport is silently dropped — so a rehearsal can go green while
 *      switching nothing on. Reproduced against the real service.
 *   3. **Evidence gathered from a live host must not carry people in it.**
 *
 * And one thing the staging workflow never had, which the cut-over cannot do
 * without: a way to build the candidate images without merging to `main`.
 */
describe('what replaced staging', () => {
    describe('the guard in front of anything that writes', () => {
        const rehearsal = {
            environment: 'rehearsal',
            databaseUrl: 'postgresql://postgres:pw@127.0.0.1:55437/parallly_cutover_eval_isolation',
        };

        it('accepts a destination that says it is disposable, in a rehearsal', () => {
            expect(assertDisposableTarget(rehearsal))
                .toEqual({ databaseUrl: rehearsal.databaseUrl, databaseName: 'parallly_cutover_eval_isolation' });
        });

        it('refuses when nothing says this is a rehearsal — including silence', () => {
            // Production never sets the variable, so unset must be a refusal.
            // The safe reading of "I do not know where I am" is "not here".
            expect(refusal({ ...rehearsal, environment: undefined })).toBe('environment_not_rehearsal');
            expect(refusal({ ...rehearsal, environment: '' })).toBe('environment_not_rehearsal');
            expect(refusal({ ...rehearsal, environment: 'production' })).toBe('environment_not_rehearsal');
            expect(refusal({ ...rehearsal, environment: ' REHEARSAL ' })).toBeNull();
        });

        it('refuses the operational database even when the environment claims a rehearsal', () => {
            // A `.env` copied onto the wrong host satisfies the first statement
            // and nothing else. This is the second.
            expect(refusal({ environment: 'rehearsal', databaseUrl: 'postgresql://u:p@postgres:5432/parallext_engine' }))
                .toBe('production_database_name');
        });

        it('refuses a destination whose name does not SAY it is disposable', () => {
            // Not "not production" — say it. A neutral name is one somebody will
            // eventually read as something else.
            expect(refusal({ environment: 'rehearsal', databaseUrl: 'postgresql://u:p@h:5432/parallext_copy' }))
                .toBe('database_name_not_disposable');
            for (const name of ['parallly_x_eval_isolation', 'oct_cutover_rehearsal']) {
                expect(refusal({ environment: 'rehearsal', databaseUrl: `postgresql://u:p@h:5432/${name}` })).toBeNull();
            }
        });

        it('refuses a production host whatever the database is called', () => {
            expect(refusal({
                environment: 'rehearsal',
                databaseUrl: 'postgresql://u:p@db.parallly-chat.cloud:5432/parallly_x_eval_isolation',
            })).toBe('production_host');
            // And is not fooled by a name that merely ends with the same letters.
            expect(refusal({
                environment: 'rehearsal',
                databaseUrl: 'postgresql://u:p@notparallly-chat.cloud:5432/parallly_x_eval_isolation',
            })).toBeNull();
        });

        it('names the reason, so a refusal at three in the morning is actionable', () => {
            try { assertDisposableTarget({ environment: 'rehearsal', databaseUrl: 'postgresql://u:p@h:5432/parallext_engine' }); }
            catch (error: any) { expect(error.message).toBe('disposable_target_refused:production_database_name:parallext_engine'); }
            expect.assertions(1);
        });

        it('has a separate, opposite question for the read-only tools', () => {
            // An inventory of the live host has to run against the live host to
            // be worth anything. It must not borrow the guard above; what it
            // must do is refuse to write. Naming the distinction stops it being
            // an omission.
            expect(isOperationalTarget('postgresql://u:p@postgres:5432/parallext_engine')).toBe(true);
            expect(isOperationalTarget('postgresql://u:p@h:5432/parallly_x_eval_isolation')).toBe(false);
            expect(isOperationalTarget(null)).toBe(false);
        });
    });

    describe('what a pilot is allowed to mean', () => {
        const authorised = { declaredTenantIds: ['tenant-a', 'tenant-b'], transportChannels: ['whatsapp', 'telegram'] };

        it('accepts a pilot that names a declared tenant and a servable channel', () => {
            expect(assessPilotScope({ enabled: true, tenantIds: ['tenant-a'], channels: ['whatsapp'] }, authorised))
                .toEqual({ ok: true, refusals: [], effectiveChannels: ['whatsapp'] });
        });

        it('refuses an empty tenant list, because the service reads it as everyone', () => {
            // The failure that looks exactly like success: forget to name the
            // tenant and you have not switched on nothing, you have switched on
            // the full rollout.
            const verdict = assessPilotScope({ enabled: true, tenantIds: [], channels: ['whatsapp'] }, authorised);
            expect(verdict.ok).toBe(false);
            expect(verdict.refusals).toContain('pilot_would_include_every_tenant');
        });

        it('refuses a tenant nobody agreed to include', () => {
            const verdict = assessPilotScope({ enabled: true, tenantIds: ['tenant-z'], channels: ['whatsapp'] }, authorised);
            expect(verdict.refusals).toContain('pilot_tenant_not_declared');
        });

        it('refuses a channel the transport cannot carry, instead of going green on a no-op', () => {
            // Reproduced against the real service: a pilot configured for
            // `web_widget` yields `effectiveChannels: []` and `enabledFor` false.
            // The rehearsal that only re-read its own row could not tell.
            const verdict = assessPilotScope({ enabled: true, tenantIds: ['tenant-a'], channels: ['web_widget'] }, authorised);
            expect(verdict.ok).toBe(false);
            expect(verdict.refusals).toContain('pilot_channel_has_no_transport');
            expect(verdict.effectiveChannels).toEqual([]);
        });

        it('reports every problem at once rather than the first', () => {
            const verdict = assessPilotScope({ enabled: true, tenantIds: [], channels: [] }, authorised);
            expect([...verdict.refusals].sort())
                .toEqual(['pilot_names_no_channel', 'pilot_would_include_every_tenant']);
        });

        it('turns off by naming nothing, and can tell whether the write landed', () => {
            // `{enabled:false}` with the tenant list still there is one flipped
            // boolean from live, and the boolean is what gets edited by hand.
            expect(PILOT_OFF).toEqual({ enabled: false, tenantIds: [], channels: [] });
            expect(assessPilotScope(PILOT_OFF, authorised).ok).toBe(true);
            const written = { enabled: true, tenantIds: ['tenant-a'], channels: ['whatsapp'] };
            expect(pilotScopeMatches(written, { enabled: true, tenantIds: ['tenant-a'], channels: ['whatsapp'] })).toBe(true);
            expect(pilotScopeMatches(written, { enabled: true, tenantIds: [], channels: ['whatsapp'] })).toBe(false);
            expect(pilotScopeMatches(written, null)).toBe(false);
        });
    });

    describe('what may leave the operational host', () => {
        it('takes the person out of a line and leaves the diagnosis in', () => {
            const line = 'WARN [Outbound] retry for ana.perez@example.com / +57 300 111 2233 '
                + 'auth Bearer abcdefghijklmnopqrstuvwx failed after 3 attempts';
            const redacted = redactForEvidence(line);
            for (const secret of ['ana.perez@example.com', '300 111 2233', 'abcdefghijklmnopqrstuvwx']) {
                expect(redacted).not.toContain(secret);
            }
            expect(redacted).toContain('WARN [Outbound] retry');
            expect(redacted).toContain('failed after 3 attempts');
        });

        it('removes a provider token, which is worse than a phone number', () => {
            expect(redactForEvidence(`token EA${'a'.repeat(40)} expired`)).toBe('token <meta_token> expired');
            expect(redactForEvidence('key sk_live_abcdefgh1234')).toBe('key <provider_key>');
            const jwt = `${'a'.repeat(30)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
            expect(redactForEvidence(`session ${jwt} expired`)).toBe('session <jwt> expired');
        });

        it('leaves counters readable', () => {
            expect(redactForEvidence('processed 42 jobs in 1200 ms')).toBe('processed 42 jobs in 1200 ms');
        });

        it('keeps only the lines an operator reads, so what is published can be checked', () => {
            expect(isEvidenceWorthy('ERROR something broke')).toBe(true);
            expect(isEvidenceWorthy('MIGRATE_TENANTS_SUMMARY ok=3 skipped=0 warnings=0')).toBe(true);
            expect(isEvidenceWorthy('AGREED_TERMS_PREFLIGHT tenants=4 orphans=0 blocks=0')).toBe(true);
            expect(isEvidenceWorthy('LOG a customer said hello')).toBe(false);
            // Together: filtered, then redacted, then bounded.
            const raw = ['LOG hi from ana@example.com', 'ERROR failed for ana@example.com', 'LOG bye'].join('\n');
            expect(evidenceFrom(raw)).toBe('ERROR failed for <email>');
        });
    });

    describe('the candidate build that replaces the staging workflow', () => {
        const workflow = existsSync(resolve(ROOT, '.github/workflows/candidate.yml'))
            ? readFileSync(resolve(ROOT, '.github/workflows/candidate.yml'), 'utf8') : null;

        it('exists, and the staging workflow does not', () => {
            // Retired rather than repaired: the product stopped needing it, and
            // keeping it alive only to keep its diagnosis passing is work with
            // no destination.
            expect(workflow).not.toBeNull();
            expect(existsSync(resolve(ROOT, '.github/workflows/staging.yml'))).toBe(false);
            for (const script of ['seed-staging-synthetic.cjs', 'staging-smoke.cjs', 'staging-dispatch-pilot.cjs',
                'staging-publication-walk.cjs', 'assert-staging-isolation.cjs']) {
                expect({ script, present: existsSync(resolve(ROOT, 'apps/api/scripts', script)) })
                    .toEqual({ script, present: false });
            }
        });

        it('builds a full commit, checked out as that commit', () => {
            // A 7-character prefix is ambiguous and a branch is a moving target.
            // Without the explicit `ref`, this would build whatever main is and
            // label it with the candidate's SHA — worse than not building.
            //
            // The SHA is resolved once, in ONE JOB, because there are now two
            // triggers: a dispatch names it, a labelled pull request supplies
            // its own head. Resolving it twice is how a workflow builds one
            // commit and labels it with another. It moved from a step output to
            // a job output when authorisation, verification and publication
            // became three jobs with three different amounts of power.
            expect(workflow).toMatch(/\^\[0-9a-f\]\{40\}\$/);
            expect(workflow).toContain('ref: ${{ needs.authorize.outputs.sha }}');
            expect(workflow).toContain('checkout resolved to');
        });

        it('can be started from the branch it exists to validate', () => {
            // `workflow_dispatch` is only offered for workflows that exist on
            // the DEFAULT branch, so a candidate workflow written on a branch
            // was unreachable from exactly the branch it was written for.
            expect(workflow).toContain('pull_request:');
            // And the label that starts it NAMES A COMMIT. A bare
            // `build-candidate` outlived the commit it was applied to, and with
            // `synchronize` in the trigger list one approval kept authorising
            // every later push — with secrets and `packages: write`.
            expect(workflow).toContain("startsWith(github.event.label.name, 'build-candidate-')");
            expect(workflow).not.toContain("contains(github.event.pull_request.labels.*.name, 'build-candidate')");
        });

        it('never tags latest, which is what the production compose falls back to', () => {
            expect(workflow).not.toMatch(/:latest/);
            expect(workflow).toContain('candidate-${{ needs.authorize.outputs.sha }}');
        });

        it('publishes a digest per image, and refuses to publish a manifest without one', () => {
            // A tag shaped like a SHA is still mutable. Only the digest says that
            // what ran and what was approved are the same bytes.
            for (const service of ['api', 'worker', 'dashboard', 'whatsapp', 'landing']) {
                expect(workflow).toContain(`steps.${service}.outputs.digest`);
            }
            expect(workflow).toContain('the manifest would name a tag it cannot pin');
        });

        it('cannot deploy: it has no host step at all', () => {
            // Steps, not prose. The comments explain why `latest` would be
            // dangerous on the host, and a check that cannot tell a warning from
            // an instruction teaches people to delete the warning.
            const steps = workflow!.split(/\r?\n/).filter(line => !/^\s*#/.test(line)).join('\n');
            for (const forbidden of ['ssh-action', 'SERVER_HOST', 'docker compose', 'environment: production']) {
                expect({ forbidden, present: steps.includes(forbidden) })
                    .toEqual({ forbidden, present: false });
            }
        });

        it('runs only when a person asks, and says so out loud', () => {
            expect(workflow).toContain('workflow_dispatch:');
            expect(workflow).not.toMatch(/^\s{2}push:/m);
            expect(workflow).toMatch(/if \[ "\$CONFIRM" != "candidate" \]/);
        });
    });

    describe('generated artefacts are checked by CI, not by memory', () => {
        // Each of these files is checked in AND produced by a script, and the
        // only thing that kept the two equal was somebody remembering to run
        // the generator. That already failed: every closure artefact described
        // a revision one or two commits behind the one it claimed. The rate
        // table is the same failure with money attached — it would price a
        // delivery Meta bills at a number nobody authorised.
        //
        // `verify-artifacts.cjs` was written for exactly this and was never
        // wired into a workflow, so it only ran when someone typed it.
        const CHECKS = [
            'node apps/api/scripts/generate-whatsapp-rates.cjs --check',
            'node docs/audits/2026-09-09/verify-artifacts.cjs',
            // The inventory of everything that can put a message on a customer's
            // phone. It is derived by sweeping call sites, so a producer added
            // in any later commit makes it wrong — and a list of what spends
            // money is only worth having while it is complete.
            'node apps/api/scripts/outbound-producer-inventory.cjs --check',
        ];

        // Commands, not comments. A check that cannot tell a `run:` line from
        // the paragraph explaining it goes green on a workflow that does
        // nothing, and teaches the next person to delete the paragraph.
        const commandsOf = (file: string) => readFileSync(resolve(ROOT, file), 'utf8')
            .split(/\r?\n/).filter(line => !/^\s*#/.test(line));

        it.each([
            ['.github/workflows/candidate.yml'],
            ['.github/workflows/vertical-quality.yml'],
        ])('%s runs every generator in --check mode', file => {
            const commands = commandsOf(file);
            for (const check of CHECKS) {
                expect({ file, check, run: commands.some(line => line.includes(check)) })
                    .toEqual({ file, check, run: true });
            }
        });

        it('checks only, so CI can never rewrite the artefact it is judging', () => {
            // Without `--check` these two scripts WRITE. A workflow that
            // regenerates and then compares is comparing a file with itself, and
            // every drift it exists to catch passes.
            const WRITERS = ['generate-whatsapp-rates.cjs', 'outbound-producer-inventory.cjs'];
            for (const file of ['.github/workflows/candidate.yml', '.github/workflows/vertical-quality.yml']) {
                for (const line of commandsOf(file)) {
                    if (!WRITERS.some(writer => line.includes(writer))) continue;
                    expect({ file, line: line.trim() })
                        .toEqual({ file, line: expect.stringContaining('--check') });
                }
            }
        });
    });
});
