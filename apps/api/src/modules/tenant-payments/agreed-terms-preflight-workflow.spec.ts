import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The gate is only a gate while the pipeline still calls it, and calls it in the
 * right place.
 *
 * A control that runs AFTER the change it protects is not a control. This one
 * has to sit between the backup — the rollback point, which must exist before
 * anything is spent — and the migrations, because the behaviour it guards
 * arrives with them. A refactor that moved the invocation two lines down, or
 * dropped it while keeping the comment, would leave a workflow that reads
 * exactly as safe as before and is not.
 *
 * So the order is asserted from the workflow's own text, and so is the failure
 * behaviour: a non-zero exit must abort. A step that logged the finding and
 * carried on would be the same defect wearing the same words.
 */

const WORKFLOW = resolve(__dirname, '../../../../../.github/workflows/deploy.yml');
const SCRIPT = resolve(__dirname, '../../../scripts/preflight-agreed-terms.cjs');

const workflow = existsSync(WORKFLOW) ? readFileSync(WORKFLOW, 'utf8') : null;
const contract = workflow ? describe : describe.skip;

/** Where a marker sits in the deploy script, so the order can be compared. */
const at = (needle: string): number => {
    const index = workflow!.indexOf(needle);
    expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
    return index;
};

contract('the deploy still runs the agreed-terms gate, and runs it in time', () => {
    it('ships the command the workflow invokes', () => {
        // A workflow that calls a script nobody shipped fails at 3am on the VPS,
        // not here.
        expect(existsSync(SCRIPT)).toBe(true);
        expect(workflow).toContain('scripts/preflight-agreed-terms.cjs');
    });

    it('runs it after the rollback point and before either migration', () => {
        const backup = at('===> Pre-migration backup (rollback point)...');
        const preflight = at('node scripts/preflight-agreed-terms.cjs');
        const publicMigration = at('===> Running Prisma public schema migrations...');
        const tenantMigration = at('===> Running tenant schema migration (idempotent)...');

        expect(backup).toBeLessThan(preflight);
        expect(preflight).toBeLessThan(publicMigration);
        expect(preflight).toBeLessThan(tenantMigration);
    });

    it('runs it before any container is recreated', () => {
        // The old containers are what a failed deploy falls back to. Recreating
        // them first would mean the new runtime is already serving the charges
        // this gate exists to check.
        const preflight = at('node scripts/preflight-agreed-terms.cjs');
        for (const marker of ['up -d --remove-orphans', 'up -d --no-deps --force-recreate']) {
            const index = workflow!.indexOf(marker);
            if (index >= 0) expect(preflight).toBeLessThan(index);
        }
    });

    it('aborts on a non-zero exit instead of logging and continuing', () => {
        const section = workflow!.slice(
            at('===> Pre-flight: rows this release would stop being able to charge...'),
            at('===> Running Prisma public schema migrations...'));
        expect(section).toContain('PREFLIGHT_RC');
        expect(section).toMatch(/if \[ "\$PREFLIGHT_RC" -ne 0 \]; then[\s\S]*?exit 1/);
        // And it does not accept silence: a run that printed nothing readable is
        // not a run that passed.
        expect(section).toContain('blocks=0');
    });

    it('runs it in the candidate image, not against the host', () => {
        const section = workflow!.slice(
            at('===> Pre-flight: rows this release would stop being able to charge...'),
            at('===> Running Prisma public schema migrations...'));
        // `$DC run --rm api` resolves through IMAGE_TAG=${GIT_SHA}, which is the
        // image being deployed — the same one the migration runs in.
        expect(section).toMatch(/\$DC run --rm api node scripts\/preflight-agreed-terms\.cjs/);
        expect(workflow).toContain('echo "IMAGE_TAG=${GIT_SHA}" >> .env');
    });

    it('keeps the backup fail-closed, so the gate never becomes the only guard', () => {
        const section = workflow!.slice(
            at('===> Pre-migration backup (rollback point)...'),
            at('===> Checking retired Mercado Pago platform mandates...'));
        expect(section).toContain('Pre-migration backup FAILED');
        expect(section).toMatch(/exit 1/);
    });
});
