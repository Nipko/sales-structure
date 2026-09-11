import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * ═══ FOUR PLACES HAVE TO AGREE ABOUT ONE LIST ═══
 *
 * `NEXT_PUBLIC_*` is read at BUILD time and written into the JavaScript the
 * browser downloads. A missing one does not fail anything: Next bakes an empty
 * string, the image builds, the page loads, and one feature is quietly dead in
 * the shipped bundle. The only evidence is a browser console nobody reads.
 *
 * Four surfaces have to carry the same list, and they are edited by different
 * people at different times:
 *
 *   1. the dashboard source, which READS them;
 *   2. `Dockerfile.dashboard`, which must both RECEIVE (ARG) and EXPOSE (ENV)
 *      each one — two statements, and an ARG without its ENV is a value
 *      accepted and discarded;
 *   3. `deploy.yml`, which supplies them in production;
 *   4. `candidate.yml`, which supplies them to a candidate image and refuses to
 *      build without them.
 *
 * They did not agree. Both workflows passed eleven; the Dockerfile promoted
 * six. `META_SOLUTION_ID` had an ARG and no ENV; Instagram's app id and redirect
 * URI, the Messenger login config and the VAPID key were absent altogether. So
 * production has been shipping a dashboard where the Instagram connect button
 * opens an authorisation for no app, Messenger login has no configuration, and
 * push cannot subscribe — while the workflow that supplies those values looks
 * completely correct.
 *
 * This test is the agreement, computed from the files rather than from a list
 * written here: a twelfth value added to one of the four fails on the other
 * three, which is the only way this stays true.
 */
const ROOT = resolve(__dirname, '..', '..', '..', '..');
const DOCKERFILE = join(ROOT, 'infra', 'docker', 'Dockerfile.dashboard');
const DEPLOY = join(ROOT, '.github', 'workflows', 'deploy.yml');
const CANDIDATE = join(ROOT, '.github', 'workflows', 'candidate.yml');
const DASHBOARD_SRC = resolve(__dirname, '..');

const read = (path: string) => readFileSync(path, 'utf8');
const names = (text: string, pattern: RegExp) =>
    new Set([...text.matchAll(pattern)].map(match => match[1]));

/** Every `NEXT_PUBLIC_*` the dashboard source actually reads. */
function readByTheDashboard(): Set<string> {
    const found = new Set<string>();
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) { walk(full); continue; }
            if (!/\.(ts|tsx)$/.test(entry) || entry.includes('.spec.')) continue;
            for (const match of read(full).matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) {
                found.add(match[1]);
            }
        }
    };
    walk(DASHBOARD_SRC);
    return found;
}

describe('the values baked into the dashboard bundle', () => {
    const dockerfile = read(DOCKERFILE);
    const args = names(dockerfile, /^ARG (NEXT_PUBLIC_[A-Z0-9_]+)/gm);
    const envs = names(dockerfile, /^ENV (NEXT_PUBLIC_[A-Z0-9_]+)=/gm);
    const deploy = names(read(DEPLOY), /^\s+(NEXT_PUBLIC_[A-Z0-9_]+)=/gm);
    const candidate = names(read(CANDIDATE), /^\s+(NEXT_PUBLIC_[A-Z0-9_]+)=/gm);
    const used = readByTheDashboard();

    const sorted = (set: Set<string>) => [...set].sort();

    it('receives every value it exposes, and exposes every value it receives', () => {
        // The defect that made `META_SOLUTION_ID` empty in every image ever
        // built: an ARG with no ENV. The value arrives from the builder and
        // never reaches `next build`.
        expect(sorted(args)).toEqual(sorted(envs));
    });

    it('exposes every value the dashboard source reads', () => {
        // The direction that matters most. A page that reads a variable the
        // image never sets renders a feature that cannot work.
        const missing = sorted(used).filter(name => !envs.has(name));
        expect(missing).toEqual([]);
    });

    it('is given every one of them by the production build', () => {
        const missing = sorted(envs).filter(name => !deploy.has(name));
        expect(missing).toEqual([]);
    });

    it('is given every one of them by the candidate build', () => {
        // A candidate validated with a smaller bundle than production ships is
        // a candidate validated as a different product.
        const missing = sorted(envs).filter(name => !candidate.has(name));
        expect(missing).toEqual([]);
    });

    it('is the same list in both workflows, exactly', () => {
        // Not "candidate is a subset". A value production bakes and the
        // candidate does not is a candidate validated as a different product,
        // and a value the candidate bakes and production does not is a feature
        // that works only in the thing nobody ships.
        expect(sorted(deploy)).toEqual(sorted(candidate));
        expect(sorted(deploy)).toHaveLength(11);
    });

    it('refuses to build a candidate that is missing any of them', () => {
        // Presence is checked BEFORE the image is built, so a candidate cannot
        // be published with a dead feature and then validated by hand.
        const text = read(CANDIDATE);
        const checked = names(text, /\s(NEXT_PUBLIC_[A-Z0-9_]+)(?= |;| \\)/g);
        for (const name of sorted(envs)) {
            // `APP_VERSION` is derived from the SHA inside the workflow rather
            // than supplied, so it cannot be missing and is not checked.
            if (name === 'NEXT_PUBLIC_APP_VERSION') continue;
            expect({ name, checked: checked.has(name) }).toEqual({ name, checked: true });
        }
    });

    it('builds the commit it was asked for, on a manual dispatch', () => {
        // `DISPATCH_SHA` read `steps.subject.outputs.sha` — its OWN output, not
        // yet written — so a manual dispatch resolved the empty string and died
        // at the next step claiming the SHA was not 40 characters. The trigger
        // had never once worked.
        expect(read(CANDIDATE)).toContain('DISPATCH_SHA: ${{ inputs.sha }}');
    });
});
