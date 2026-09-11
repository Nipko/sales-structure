#!/usr/bin/env node
/**
 * ═══ TURNING A MANIFEST INTO WHAT A HOST ACTUALLY RUNS ═══
 *
 * The candidate workflow publishes a manifest naming five images by immutable
 * digest. That is the right thing to publish and, on its own, it changes
 * nothing: the host starts containers from `docker-compose.prod.yml`, which
 * resolves images by `IMAGE_TAG` — a tag, which can be moved, and which falls
 * back to `latest`. Saying "pinned by digest" while the host consumes a tag is
 * a claim about a file nobody reads.
 *
 * This script is the missing half, and it does exactly two things:
 *
 *   · `--out <file>`    writes a compose override in which every service names
 *                       `repository@sha256:…`, so `docker compose up` can only
 *                       start those exact bytes;
 *   · `--verify`        reads what is RUNNING and compares each container's
 *                       repo digest against the manifest, naming every
 *                       disagreement.
 *
 * The second is what makes the first honest. An override that was generated is
 * evidence that a file was written; a verification is evidence that the thing
 * answering requests is the thing that was approved.
 *
 * ── WHY IT WRITES AN OVERRIDE INSTEAD OF EDITING THE COMPOSE FILE ───────────
 *
 * Because the deploy does `git reset --hard origin/main`, and an edited tracked
 * file is silently reverted on the next deploy — the drift incident this
 * repository already has a memory of. An override is passed explicitly with
 * `-f`, so it either applies or it visibly does not.
 *
 * Usage:
 *   node infra/scripts/apply-candidate-manifest.cjs --manifest m.json --out compose.candidate.yml
 *   node infra/scripts/apply-candidate-manifest.cjs --manifest m.json --verify
 *   node infra/scripts/apply-candidate-manifest.cjs --manifest m.json --verify --running running.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** Manifest key → the service name in `docker-compose.prod.yml`. */
const SERVICES = Object.freeze({
    api: 'api',
    worker: 'worker',
    dashboard: 'dashboard',
    whatsapp: 'whatsapp',
    landing: 'landing',
});

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * ═══ THE MANIFEST IS UNTRUSTED INPUT ═══
 *
 * It arrives as a downloaded artefact and decides what a production host
 * starts. Everything below treats it that way, because the interesting attacks
 * are not exotic — they are a file that looks right:
 *
 *   · a repository that is not ours. `ghcr.io/someone-else/parallext-api` pins
 *     a perfectly valid digest of somebody else's image, and every check that
 *     only looked at the digest would pass it;
 *   · a tag that is not `candidate-<sha>`. The tag is thrown away when the
 *     override is written, which is right — but a manifest whose tag disagrees
 *     with its own commit was produced by something other than the workflow,
 *     and that is worth stopping on rather than ignoring;
 *   · a `#`, a space or a newline inside a value. The override is YAML written
 *     by hand: a newline ends the line and starts a new key, so a crafted
 *     repository could add a `command:` or a `volumes:` entry to a service.
 *     Refusing is the only safe answer, and the strings this accepts have no
 *     legitimate reason to contain any of them;
 *   · a version this script does not understand. Version 1 named tags; version
 *     2 names digests. Reading a version-1 file with version-2 rules would pin
 *     nothing and say it had.
 */
const MANIFEST_VERSION = 2;

/** The only repositories a manifest may name. Ours, and exactly ours. */
const ALLOWED_REPOSITORIES = Object.freeze([
    'ghcr.io/nipko/parallext-api',
    'ghcr.io/nipko/parallext-worker',
    'ghcr.io/nipko/parallext-dashboard',
    'ghcr.io/nipko/parallext-whatsapp',
    'ghcr.io/nipko/parallext-landing',
]);

/**
 * Anything that could end a YAML scalar, start a comment, or carry a scheme.
 *
 * Checked on the value that is about to be written, not on a sanitised copy:
 * sanitising would silently change what the host runs, and a manifest that
 * needed sanitising is a manifest nobody should be applying.
 */
function refuseUnsafeScalar(what, value) {
    if (/[\s#'"\\]/.test(value) || value.includes('\n') || value.includes('\r')) {
        throw new ManifestError(`${what} contains a character that cannot appear in a `
            + `compose value ("${value}")`);
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        throw new ManifestError(`${what} looks like a URL, not an image reference ("${value}")`);
    }
}

class ManifestError extends Error {}

/**
 * Read a manifest and refuse anything that cannot pin.
 *
 * Every check here is a way the file could look fine and mean nothing: a tag
 * where a digest belongs, a truncated digest, a service missing entirely. A
 * generator that accepted any of them would emit an override that starts
 * whatever the registry currently calls that tag, which is the exact failure
 * the digest exists to prevent.
 */
function readManifest(file) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new ManifestError(`manifest unreadable at ${file}: ${error.message}`);
    }
    if (!parsed || typeof parsed !== 'object') throw new ManifestError('manifest is not an object');
    // The version FIRST. Everything below is written for version 2's shape, and
    // reading a version-1 file with version-2 rules would pin nothing while
    // reporting success.
    // Identity, not coercion. `Number('2')` is 2, and a manifest carrying a
    // STRING where the workflow writes a number was produced by something
    // else — which is the whole question this check is asking.
    if (parsed.version !== MANIFEST_VERSION) {
        throw new ManifestError(`manifest version ${JSON.stringify(parsed.version)} is not `
            + `${MANIFEST_VERSION}; this script cannot pin it`);
    }
    const sha = String(parsed.sha || '');
    if (!/^[0-9a-f]{40}$/.test(sha)) {
        throw new ManifestError('manifest has no full commit sha');
    }
    const images = parsed.images;
    if (!images || typeof images !== 'object') throw new ManifestError('manifest names no images');

    const resolved = {};
    for (const key of Object.keys(SERVICES)) {
        const entry = images[key];
        if (!entry) throw new ManifestError(`manifest names no image for "${key}"`);
        const digest = String(entry.digest || '');
        if (!DIGEST.test(digest)) {
            throw new ManifestError(`"${key}" has no sha256 digest (got "${digest || 'nothing'}")`);
        }
        const tag = String(entry.tag || '');
        refuseUnsafeScalar(`the tag of "${key}"`, tag);
        // The repository is the part before the tag. Everything after the last
        // colon that follows the last slash is the tag, which is thrown away on
        // purpose: it is the mutable half.
        const lastSlash = tag.lastIndexOf('/');
        const colon = tag.indexOf(':', lastSlash + 1);
        const repository = colon === -1 ? tag : tag.slice(0, colon);
        if (!repository) throw new ManifestError(`"${key}" has no repository in its tag`);
        if (!ALLOWED_REPOSITORIES.includes(repository)) {
            // A valid digest of somebody else's image is still somebody else's
            // image. This is the check a digest cannot make for itself.
            throw new ManifestError(`"${key}" names "${repository}", which is not one of `
                + `this project's repositories`);
        }
        // The tag is discarded, and it still has to be the right one: a
        // manifest whose tag disagrees with its own commit was produced by
        // something that is not the candidate workflow.
        const expectedTag = `${repository}:candidate-${sha}`;
        if (tag !== expectedTag) {
            throw new ManifestError(`"${key}" is tagged "${tag}", not "${expectedTag}"`);
        }
        const reference = `${repository}@${digest}`;
        refuseUnsafeScalar(`the image reference of "${key}"`, reference);
        resolved[key] = { repository, digest, reference };
    }
    return { sha, version: MANIFEST_VERSION, images: resolved };
}

/**
 * The override, written by hand rather than through a YAML library.
 *
 * The file has five entries of one field each; a dependency to produce sixty
 * bytes of text would be a dependency to keep. What matters is that every value
 * is a digest reference, and that is asserted above rather than hoped for here.
 */
function renderOverride(manifest) {
    const lines = [
        '# GENERATED — do not edit by hand.',
        `# Produced by infra/scripts/apply-candidate-manifest.cjs from the candidate`,
        `# manifest for commit ${manifest.sha}.`,
        '#',
        '# Every image is named by its immutable digest, so `docker compose up` can',
        '# start these bytes and no others. Pass it explicitly:',
        '#',
        '#   docker compose -f docker-compose.prod.yml -f docker-compose.candidate.yml up -d',
        '#',
        '# It is an override rather than an edit because the deploy does',
        '# `git reset --hard`, which silently reverts a tracked file.',
        'services:',
    ];
    for (const [key, service] of Object.entries(SERVICES)) {
        lines.push(`  ${service}:`);
        lines.push(`    image: ${manifest.images[key].reference}`);
    }
    return `${lines.join('\n')}\n`;
}

/**
 * What is running, as `{service: [repoDigest, …]}`.
 *
 * Shelling out to `docker` is the only way to learn this, and it is isolated
 * here so the comparison itself can be tested without a daemon: `--running`
 * accepts the same JSON from a file.
 */
function inspectRunning(project) {
    const names = execFileSync('docker', [
        'ps', '--filter', `label=com.docker.compose.project=${project}`,
        '--format', '{{.Names}}',
    ], { encoding: 'utf8' }).split('\n').map(line => line.trim()).filter(Boolean);

    const running = {};
    for (const name of names) {
        const raw = execFileSync('docker', ['inspect', name, '--format',
            '{{index .Config.Labels "com.docker.compose.service"}}\t{{json .Image}}\t{{json .Config.Image}}'],
        { encoding: 'utf8' }).trim();
        const [service, imageId, configImage] = raw.split('\t');
        const digests = execFileSync('docker', ['inspect', JSON.parse(imageId || '""'),
            '--format', '{{json .RepoDigests}}'], { encoding: 'utf8' }).trim();
        running[service] = {
            configImage: JSON.parse(configImage || '""'),
            repoDigests: JSON.parse(digests || '[]'),
        };
    }
    return running;
}

/**
 * Compare what is running with what was approved.
 *
 * A container whose image carries NO repo digest at all is a mismatch, not an
 * unknown: it was built locally or loaded from a tarball, so nothing ties it to
 * the bytes anybody reviewed.
 */
function verify(manifest, running) {
    const problems = [];
    for (const [key, service] of Object.entries(SERVICES)) {
        const expected = manifest.images[key];
        const actual = running[service];
        if (!actual) {
            problems.push(`${service}: not running`);
            continue;
        }
        const digests = Array.isArray(actual.repoDigests) ? actual.repoDigests : [];
        if (!digests.length) {
            problems.push(`${service}: running an image with no registry digest `
                + `(${actual.configImage || 'unknown'}) — nothing ties it to a reviewed build`);
            continue;
        }
        const matches = digests.some(reference => {
            const at = reference.lastIndexOf('@');
            return at !== -1
                && reference.slice(0, at) === expected.repository
                && reference.slice(at + 1) === expected.digest;
        });
        if (!matches) {
            problems.push(`${service}: expected ${expected.reference}, running ${digests.join(', ')}`);
        }
    }
    return problems;
}

function main(argv) {
    const args = argv.slice(2);
    const value = flag => {
        const index = args.indexOf(flag);
        return index === -1 ? null : args[index + 1];
    };
    const manifestPath = value('--manifest');
    if (!manifestPath) {
        process.stderr.write('usage: --manifest <file> [--out <file>] [--verify [--running <file>]]\n');
        return 2;
    }

    let manifest;
    try {
        manifest = readManifest(path.resolve(manifestPath));
    } catch (error) {
        process.stderr.write(`apply-candidate-manifest: ${error.message}\n`);
        return 1;
    }

    const out = value('--out');
    if (out) {
        fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
        fs.writeFileSync(path.resolve(out), renderOverride(manifest), 'utf8');
        process.stdout.write(`apply-candidate-manifest: ${Object.keys(SERVICES).length} services pinned `
            + `by digest for ${manifest.sha.slice(0, 12)} → ${out}\n`);
    }

    if (args.includes('--verify')) {
        const runningFile = value('--running');
        let running;
        try {
            running = runningFile
                ? JSON.parse(fs.readFileSync(path.resolve(runningFile), 'utf8'))
                : inspectRunning(value('--project') || 'docker');
        } catch (error) {
            process.stderr.write(`apply-candidate-manifest: cannot read what is running: ${error.message}\n`);
            return 1;
        }
        const problems = verify(manifest, running);
        if (problems.length) {
            for (const problem of problems) {
                process.stderr.write(`apply-candidate-manifest: ${problem}\n`);
            }
            process.stderr.write('\nThe containers answering requests are not the candidate that was '
                + 'approved. Do not treat evidence gathered from them as evidence about it.\n');
            return 1;
        }
        process.stdout.write(`apply-candidate-manifest: every running service matches the candidate `
            + `for ${manifest.sha.slice(0, 12)}\n`);
    }

    if (!out && !args.includes('--verify')) {
        process.stderr.write('apply-candidate-manifest: nothing to do — pass --out and/or --verify\n');
        return 2;
    }
    return 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { readManifest, renderOverride, verify, SERVICES, ManifestError };
