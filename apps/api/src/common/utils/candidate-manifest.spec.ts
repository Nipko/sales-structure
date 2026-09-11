import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * ═══ "PINNED BY DIGEST" HAS TO BE SOMETHING A HOST CONSUMES ═══
 *
 * The candidate workflow publishes a manifest naming five images by immutable
 * digest. On its own that changes nothing: the host starts containers from
 * `docker-compose.prod.yml`, which resolves images by `IMAGE_TAG` — a tag,
 * which can be moved, and which falls back to `latest`.
 *
 * These tests are about the half that closes the gap, and they are written
 * around the ways it could look fine and mean nothing: a tag where a digest
 * belongs, a truncated digest, a service missing from the file, a container
 * running an image nobody can trace to a build.
 */

const SCRIPT = resolve(__dirname, '..', '..', '..', '..', '..',
    'infra', 'scripts', 'apply-candidate-manifest.cjs');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const consumer = require(SCRIPT);

const SHA = 'a'.repeat(40);
const digest = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

const manifest = (over: Record<string, unknown> = {}) => ({
    version: 2,
    sha: SHA,
    images: {
        api: { tag: 'ghcr.io/nipko/parallext-api:candidate-' + SHA, digest: digest('1') },
        worker: { tag: 'ghcr.io/nipko/parallext-worker:candidate-' + SHA, digest: digest('2') },
        dashboard: { tag: 'ghcr.io/nipko/parallext-dashboard:candidate-' + SHA, digest: digest('3') },
        whatsapp: { tag: 'ghcr.io/nipko/parallext-whatsapp:candidate-' + SHA, digest: digest('4') },
        landing: { tag: 'ghcr.io/nipko/parallext-landing:candidate-' + SHA, digest: digest('5') },
    },
    ...over,
});

const withFile = <T>(content: unknown, use: (file: string) => T): T => {
    const dir = mkdtempSync(join(tmpdir(), 'candidate-manifest-'));
    try {
        const file = join(dir, 'manifest.json');
        writeFileSync(file, JSON.stringify(content), 'utf8');
        return use(file);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
};

describe('reading the manifest', () => {
    it('resolves every image to a repository and a digest', () => {
        const parsed = withFile(manifest(), file => consumer.readManifest(file));
        expect(parsed.images.api.reference)
            .toBe(`ghcr.io/nipko/parallext-api@${digest('1')}`);
        // The tag is thrown away on purpose: it is the mutable half, and the
        // whole point of the manifest is to stop depending on it.
        expect(parsed.images.api.reference).not.toContain('candidate-');
    });

    it('refuses a manifest that names a tag where a digest belongs', () => {
        const broken = manifest();
        (broken.images as any).api.digest = 'candidate-' + SHA;
        expect(() => withFile(broken, file => consumer.readManifest(file)))
            .toThrow(/no sha256 digest/);
    });

    it('refuses a truncated digest', () => {
        // Long enough to look right in a review, short enough to name nothing.
        const broken = manifest();
        (broken.images as any).worker.digest = 'sha256:abc123';
        expect(() => withFile(broken, file => consumer.readManifest(file)))
            .toThrow(/no sha256 digest/);
    });

    it('refuses a manifest that is missing a service entirely', () => {
        const broken = manifest();
        delete (broken.images as any).landing;
        expect(() => withFile(broken, file => consumer.readManifest(file)))
            .toThrow(/names no image for "landing"/);
    });

    it('refuses a manifest with no commit behind it', () => {
        expect(() => withFile(manifest({ sha: 'main' }), file => consumer.readManifest(file)))
            .toThrow(/no full commit sha/);
    });
});

describe('the compose override it writes', () => {
    it('names every service by digest and nothing by tag', () => {
        const parsed = withFile(manifest(), file => consumer.readManifest(file));
        const yaml = consumer.renderOverride(parsed) as string;
        for (const service of Object.values(consumer.SERVICES) as string[]) {
            expect(yaml).toContain(`  ${service}:`);
        }
        for (const line of yaml.split('\n').filter(line => line.trim().startsWith('image:'))) {
            expect(line).toMatch(/image: [^:@\s]+(?::[0-9]+)?\/[^@\s]+@sha256:[0-9a-f]{64}$/);
        }
        // `latest` is what the production compose falls back to. It must not be
        // reachable from a file whose purpose is to pin.
        expect(yaml).not.toContain('latest');
    });

    it('says it is generated, so nobody edits it by hand', () => {
        const parsed = withFile(manifest(), file => consumer.readManifest(file));
        expect(consumer.renderOverride(parsed)).toContain('GENERATED');
    });
});

describe('verifying what is actually running', () => {
    const parsed = () => withFile(manifest(), file => consumer.readManifest(file));

    const running = (over: Record<string, unknown> = {}) => ({
        api: { configImage: 'x', repoDigests: [`ghcr.io/nipko/parallext-api@${digest('1')}`] },
        worker: { configImage: 'x', repoDigests: [`ghcr.io/nipko/parallext-worker@${digest('2')}`] },
        dashboard: { configImage: 'x', repoDigests: [`ghcr.io/nipko/parallext-dashboard@${digest('3')}`] },
        whatsapp: { configImage: 'x', repoDigests: [`ghcr.io/nipko/parallext-whatsapp@${digest('4')}`] },
        landing: { configImage: 'x', repoDigests: [`ghcr.io/nipko/parallext-landing@${digest('5')}`] },
        ...over,
    });

    it('is silent when every container is the approved build', () => {
        expect(consumer.verify(parsed(), running())).toEqual([]);
    });

    it('names the service running something else', () => {
        const problems = consumer.verify(parsed(), running({
            dashboard: { configImage: 'x',
                repoDigests: [`ghcr.io/nipko/parallext-dashboard@${digest('9')}`] },
        }));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('dashboard');
        expect(problems[0]).toContain(digest('3'));
    });

    it('treats a locally built image as a mismatch, not as unknown', () => {
        // No registry digest means it was built on the host or loaded from a
        // tarball: nothing ties it to the bytes anybody reviewed, and calling
        // that "cannot tell" would let it pass.
        const problems = consumer.verify(parsed(), running({
            api: { configImage: 'parallext-api:local', repoDigests: [] },
        }));
        expect(problems[0]).toContain('no registry digest');
    });

    it('notices a service that is not running at all', () => {
        const state = running();
        delete (state as any).worker;
        expect(consumer.verify(parsed(), state)).toEqual(['worker: not running']);
    });

    it('is not fooled by the right digest on the wrong repository', () => {
        // A digest is only unique within a repository. Comparing the hash alone
        // would accept an image pushed to a different repository entirely.
        const problems = consumer.verify(parsed(), running({
            landing: { configImage: 'x', repoDigests: [`ghcr.io/someone-else/landing@${digest('5')}`] },
        }));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('landing');
    });
});

describe('the candidate workflow that produces it', () => {
    const workflow = () => readFileSync(
        resolve(__dirname, '..', '..', '..', '..', '..', '.github', 'workflows', 'candidate.yml'), 'utf8');

    it('can be started before the merge', () => {
        // `workflow_dispatch` only appears for workflows on the DEFAULT branch,
        // so a candidate workflow written on a branch is unreachable from
        // exactly the branch it exists to validate.
        expect(workflow()).toContain('pull_request:');
    });

    it('still cannot deploy', () => {
        // The safety of this file is a property somebody could remove in one
        // line while adding a feature.
        const text = workflow();
        for (const forbidden of ['SERVER_HOST', 'SERVER_SSH_KEY', 'appleboy/ssh-action', 'ssh ']) {
            expect({ forbidden, present: text.includes(forbidden) })
                .toEqual({ forbidden, present: false });
        }
    });

    it('never tags an image `latest`', () => {
        // `docker-compose.prod.yml` falls back to `latest`, so a candidate
        // tagged that way becomes what a manual `up` on the VPS starts.
        expect(workflow()).not.toMatch(/:latest\b/);
    });

    it('bakes every public build input the dashboard reads', () => {
        // A missing `NEXT_PUBLIC_*` does not fail a Next.js build: it bakes an
        // empty string, and the candidate ships with Embedded Signup that
        // cannot open and a Google button that cannot sign in — a product
        // nobody is shipping, validated as if it were.
        const text = workflow();
        for (const name of [
            'NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_WA_SERVICE_URL', 'NEXT_PUBLIC_META_APP_ID',
            'NEXT_PUBLIC_META_CONFIG_ID', 'NEXT_PUBLIC_META_SOLUTION_ID',
            'NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID',
            'NEXT_PUBLIC_INSTAGRAM_APP_ID', 'NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI',
            'NEXT_PUBLIC_APP_VERSION', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
        ]) {
            expect({ name, baked: text.includes(`${name}=`) }).toEqual({ name, baked: true });
        }
    });

    it('consumes its own manifest before publishing it', () => {
        // "Pinned by digest" stays a claim until something reads the file and
        // turns it into what a host runs.
        expect(workflow()).toContain('apply-candidate-manifest.cjs');
    });
});
