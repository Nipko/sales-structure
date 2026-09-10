import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ═══ THE STAGING WORKFLOW, HELD TO WHAT IT CLAIMS ═══
 *
 * This workflow has never run: the host and the secrets do not exist yet. That
 * makes it exactly the kind of file that rots without anybody noticing — a
 * script renamed, a step reordered, a guard dropped, and the first time anyone
 * finds out is the first time it is used, which is the moment it was supposed
 * to be trustworthy.
 *
 * So the properties that make it safe are asserted from its own text:
 *
 *   · it cannot be triggered by a push;
 *   · nothing reaches a host before the isolation guard has run;
 *   · every script it invokes is a file that ships;
 *   · the pre-flight sits where production's sits — after the backup, before
 *     both migrations;
 *   · the outbox pilot is turned OFF in a step that runs even when the steps
 *     before it failed;
 *   · a missing host is an error, never a skip that reports success.
 */

const ROOT = resolve(__dirname, '../../../../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/staging.yml');
const workflow = existsSync(WORKFLOW) ? readFileSync(WORKFLOW, 'utf8') : null;
const contract = workflow ? describe : describe.skip;

/** Where a marker sits, so order can be compared rather than assumed. */
const at = (needle: string): number => {
    const index = workflow!.indexOf(needle);
    expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
    return index;
};

contract('the staging workflow keeps its own promises', () => {
    it('runs only when a person asks for it', () => {
        // A staging deploy that fires on a push is one mis-merged branch away
        // from being an unreviewed deploy.
        const triggers = workflow!.slice(at('on:'), at('concurrency:'));
        expect(triggers).toContain('workflow_dispatch:');
        expect(triggers).not.toMatch(/^\s{2}push:/m);
        expect(triggers).not.toMatch(/^\s{2}schedule:/m);
        expect(triggers).not.toMatch(/^\s{2}pull_request:/m);
    });

    it('serialises runs against the one staging host', () => {
        expect(workflow).toContain('group: parallext-staging-host');
        expect(workflow).toContain('cancel-in-progress: false');
    });

    it('demands a typed confirmation and a pinned image', () => {
        expect(workflow).toMatch(/if \[ "\$CONFIRM" != "staging" \]/);
        // `latest` moves; a run pinned to it cannot say what produced its
        // evidence and its rollback has no target.
        expect(workflow).toMatch(/\^\[0-9a-f\]\{7,40\}\$/);
    });

    it('lets nothing reach a host before the isolation guard has passed', () => {
        for (const job of ['deploy:', 'verify:', 'rollback:']) {
            const index = at(`  ${job}`);
            const section = workflow!.slice(index, index + 900);
            expect({ job, gated: /needs:\s*(guard|\[[^\]]*guard[^\]]*\]|deploy|\[[^\]]*deploy)/.test(section) })
                .toEqual({ job, gated: true });
        }
        // And the guard is a real invocation, not a comment about one.
        expect(workflow).toContain('node apps/api/scripts/assert-staging-isolation.cjs');
        expect(at('assert-staging-isolation.cjs')).toBeLessThan(at('  deploy:'));
    });

    it('ships every script it invokes', () => {
        // A workflow that calls a script nobody shipped fails on the host, at
        // the worst possible moment, with a message about a missing file.
        const invoked = [...workflow!.matchAll(/(?:node\s+(?:apps\/api\/)?)(scripts\/[a-z0-9-]+\.cjs)/g)]
            .map(match => match[1]);
        expect(invoked.length).toBeGreaterThan(4);
        for (const script of [...new Set(invoked)]) {
            expect({ script, shipped: existsSync(resolve(ROOT, 'apps/api', script)) })
                .toEqual({ script, shipped: true });
        }
    });

    it('runs the agreed-terms pre-flight where production runs it', () => {
        const backup = at('===> [staging] Pre-migration backup (rollback point)...');
        const preflight = at('node scripts/preflight-agreed-terms.cjs');
        const publicMigration = at('===> [staging] Running Prisma public schema migrations...');
        const tenantMigration = at('===> [staging] Running tenant schema migration (idempotent)...');
        const recreate = at('===> [staging] Recreating containers...');
        expect(backup).toBeLessThan(preflight);
        expect(preflight).toBeLessThan(publicMigration);
        expect(preflight).toBeLessThan(tenantMigration);
        expect(preflight).toBeLessThan(recreate);

        // The COMMANDS, not only the announcements. Pinning the order of the
        // `echo` lines leaves the obvious hole open: add a second
        // `prisma migrate deploy` above the pre-flight with a different label
        // and every marker is still in order while the schema has already
        // moved. Mutation found exactly that, so the assertion is over every
        // migrating command in the file.
        const migrations = [...workflow!.matchAll(/prisma migrate deploy|migrate-tenants\.js/g)]
            .map(match => match.index!);
        expect(migrations.length).toBeGreaterThan(1);
        for (const index of migrations) expect(preflight).toBeLessThan(index);

        // And it aborts rather than logging the finding and carrying on.
        const section = workflow!.slice(preflight, publicMigration);
        expect(section).toMatch(/if \[ "\$PREFLIGHT_RC" -ne 0 \]; then[\s\S]*?exit 1/);
        expect(section).toContain('blocks=0');
    });

    it('keeps the backup fail-closed, so the pre-flight is never the only guard', () => {
        const section = workflow!.slice(at('===> [staging] Pre-migration backup (rollback point)...'),
            at('===> [staging] Pre-flight: rows this release would stop being able to charge...'));
        expect(section).toContain('Pre-migration backup FAILED');
        expect(section).toMatch(/exit 1/);
    });

    it('seeds synthetic data from scratch and never from a copy', () => {
        expect(workflow).toContain('seed-staging-synthetic.cjs --reset');
        expect(workflow).toContain('STAGING_SEED_SOURCE');
        expect(workflow).not.toMatch(/pg_restore|production.*dump|dump.*production/i);
    });

    it('turns the outbox pilot off in a step that runs even after a failure', () => {
        const enable = at('staging-dispatch-pilot.cjs --enable');
        const disableStep = at('- name: Turn the outbox pilot off again');
        expect(enable).toBeLessThan(disableStep);
        // Bounded by the NEXT step, not by a character count. A fixed window
        // reaches into the step after it, and that one also says `if: always()`
        // — so removing the guard here left the assertion passing. Mutation
        // found it; the window is now exactly this step.
        const section = workflow!.slice(disableStep, at('- name: Collect the evidence'));
        expect(section).toContain('if: always()');
        expect(section).toContain('staging-dispatch-pilot.cjs --disable');
    });

    it('treats a missing host as an error rather than a skipped success', () => {
        const section = workflow!.slice(at('Staging host is configured'), at('- name: Deploy'));
        expect(section).toContain('::error::STAGING_SERVER_HOST is not set');
        expect(section).toMatch(/exit 1/);
        expect(section).not.toContain('::warning::');
    });

    it('rolls back on failure, and proves the rollback took', () => {
        const index = at('  rollback:');
        const section = workflow!.slice(index);
        expect(section).toContain("needs.deploy.result == 'failure'");
        expect(section).toContain("needs.verify.result == 'failure'");
        // The success criterion is the running image, not the exit code of a
        // restart command.
        expect(section).toContain("docker inspect --format '{{index .Config.Image}}' parallext-api");
        expect(section).toContain('::error::Rollback did not take');
        // And a rollback with no target stops instead of restarting onto a guess.
        expect(section).toContain('::error::No image to roll back to');
    });

    it('scrubs the logs it uploads', () => {
        const section = workflow!.slice(at('Capturing metrics and logs'), at('- name: Turn the outbox pilot off again'));
        expect(section).toMatch(/<email>/);
        expect(section).toMatch(/<phone>/);
    });
});
