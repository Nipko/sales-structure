import { resolve } from 'path';

/**
 * ═══ "GREEN" AND "DID NOT RUN" MUST NOT LOOK THE SAME ═══
 *
 * Every PostgreSQL-, PgBouncer- and Valkey-backed suite in this repository
 * gates itself off when the variable naming its database is unset:
 *
 *     (url ? describe : describe.skip)('the additive migrations, under load', …)
 *
 * That is right on a laptop and wrong in the run that decides whether a commit
 * becomes the images a cut-over pins. Jest exits 0 either way. The candidate
 * workflow used to run `npx jest --ci` with no database at all, so the money
 * engine, the durable outbox, the migrations and the pooling semantics were all
 * skipped — and the run was green, and the runbook said the suite had run.
 *
 * So the exit code is not the check; this is. Each case below is a report that
 * Jest would have exited 0 on, or one whose failure the wrapper must not lose.
 */

const SCRIPT = resolve(__dirname, '..', '..', '..', '..', '..',
    'infra', 'scripts', 'assert-no-skipped-tests.cjs');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const checker = require(SCRIPT);

const report = (over: Record<string, unknown> = {}) => ({
    success: true,
    numTotalTests: 594,
    numPassedTests: 594,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    testResults: [],
    ...over,
});

describe('a run that did not run everything', () => {
    it('accepts the report of a complete, passing run', () => {
        expect(checker.problemsWith(report())).toEqual([]);
    });

    it('refuses a run with a single skipped test, which Jest exits 0 on', () => {
        expect(checker.problemsWith(report({ numPendingTests: 1, numPassedTests: 593 })))
            .toEqual(['1 test(s) were skipped']);
    });

    it('refuses a todo, which is a test that exists only as a name', () => {
        expect(checker.problemsWith(report({ numTodoTests: 2 })))
            .toEqual(['2 test(s) are todo']);
    });

    it('refuses an empty run, because nothing is not clean', () => {
        // The failure mode of a mistyped `--runTestsByPath`: zero tests, exit 0.
        expect(checker.problemsWith(report({ numTotalTests: 0, numPassedTests: 0 })))
            .toEqual(['the run contained no tests at all']);
    });

    it('still reports failures, so a wrapper cannot swallow the exit code', () => {
        // The workflow runs jest with `|| true` on purpose — the report is the
        // check — which makes losing a failure here a real possibility.
        expect(checker.problemsWith(report({ success: false, numFailedTests: 3, numFailedTestSuites: 1 })))
            .toEqual(['3 test(s) failed', '1 suite(s) failed to run']);
    });

    it('reports every problem at once rather than the first', () => {
        expect(checker.problemsWith(report({ numFailedTests: 1, numPendingTests: 4, numTodoTests: 1 })))
            .toEqual(['1 test(s) failed', '4 test(s) were skipped', '1 test(s) are todo']);
    });

    it('refuses a report that says unsuccessful without naming anything', () => {
        expect(checker.problemsWith(report({ success: false })))
            .toEqual(['Jest reported the run as unsuccessful without naming a failure']);
    });

    it('names the files that skipped, because a count sends people hunting', () => {
        const named = checker.skippedSuites({
            testResults: [
                { name: '/repo/apps/api/src/a.postgres.spec.ts',
                    assertionResults: [{ status: 'pending' }, { status: 'passed' }] },
                { name: '/repo/apps/api/src/b.spec.ts',
                    assertionResults: [{ status: 'passed' }] },
            ],
        });
        expect(named).toHaveLength(1);
        expect(named[0]).toContain('a.postgres.spec.ts');
        expect(named[0]).toContain('1 of 2 did not run');
    });
});
