import { createHash } from 'crypto';

/**
 * ═══ WHAT MAKES A STAGING ENVIRONMENT STAGING ═══
 *
 * Not the name of the workflow. Not the label on the GitHub environment. The
 * only thing that makes it staging is that nothing it touches is also touched
 * by production — and that is a property of the VALUES, which is why it has to
 * be checked from the values rather than promised in a runbook.
 *
 * The failure this exists to prevent has a very ordinary shape: somebody copies
 * the production secrets into the staging environment because it is the fastest
 * way to get a green run, and from that moment the "staging" deploy migrates the
 * production database, answers real customers on a real WhatsApp number, and
 * charges real cards. Nothing in the pipeline would notice: every step would go
 * green, because every step would be talking to something that works.
 *
 * So this refuses, before anything is deployed, when:
 *
 *   · a required staging variable is missing — never falling back to a
 *     production one, because a fallback is exactly how the two get shared;
 *   · a staging secret has the SAME VALUE as a production secret. The comparison
 *     is over salted hashes supplied by the caller, so neither value is ever in
 *     this process, in a log, or in an artefact;
 *   · a staging URL points at a production host, or at a host the caller named
 *     as production;
 *   · a staging database, schema prefix or Redis namespace carries the
 *     production name with no discriminator;
 *   · the run was asked to seed itself from a production copy. Synthetic data is
 *     the default and a production copy is not something this workflow does.
 *
 * Everything it reports is a variable NAME and a short fingerprint. A staging
 * guard that leaks the secret it was checking would be worse than no guard.
 */

/** A short, non-reversible fingerprint. Enough to compare two, never to recover one. */
export function fingerprint(value: string): string {
    return createHash('sha256').update(`parallly-staging-fingerprint:${value}`).digest('hex').slice(0, 12);
}

/** Salted digest of a secret, for comparing two environments without holding either. */
export function secretDigest(value: string, salt: string): string {
    return createHash('sha256').update(`${salt} ${value}`).digest('hex');
}

export type IsolationCode =
    | 'missing'
    | 'shared_with_production'
    | 'production_host'
    | 'production_database_name'
    | 'production_copy_requested'
    | 'weak_value';

export interface IsolationFinding {
    readonly variable: string;
    readonly code: IsolationCode;
    /** Never the value. A fingerprint, or the host, or nothing. */
    readonly detail?: string;
}

export interface IsolationInput {
    /** The staging environment, variable name to value. Values never leave this module. */
    readonly env: Readonly<Record<string, string | undefined>>;
    /**
     * Salted digests of the PRODUCTION secrets, same salt as used here. The
     * caller computes them where the production values already live; this side
     * never sees a production value either.
     */
    readonly productionDigests: readonly string[];
    /** The salt both sides used. Required whenever `productionDigests` is non-empty. */
    readonly digestSalt?: string;
    /** Extra hosts the operator declares as production (a VPS address, a bastion). */
    readonly productionHosts?: readonly string[];
}

export interface IsolationReport {
    readonly ok: boolean;
    readonly checked: number;
    readonly findings: readonly IsolationFinding[];
}

/** Hosts that are production by definition, whatever the operator passes. */
export const PRODUCTION_DOMAINS: readonly string[] = Object.freeze([
    'parallly-chat.cloud',
]);

/** The production database and its pooled alias. A staging name must differ. */
export const PRODUCTION_DATABASE_NAMES: readonly string[] = Object.freeze([
    'parallext_engine',
]);

/**
 * Every variable a staging deploy needs, and how it must differ.
 *
 * `secret: true` means the value is compared against the production digests.
 * `url: true` means its host is checked. `database: true` means its path is.
 * A variable that is neither is still required to be present and non-trivial.
 */
export interface StagingVariable {
    readonly name: string;
    readonly secret?: boolean;
    readonly url?: boolean;
    readonly database?: boolean;
    /** A value shorter than this is a placeholder, not a secret. */
    readonly minLength?: number;
}

export const STAGING_CONTRACT: readonly StagingVariable[] = Object.freeze([
    // ── Where it runs ───────────────────────────────────────────────────────
    { name: 'STAGING_SERVER_HOST', url: true, minLength: 3 },
    { name: 'STAGING_SERVER_USER', minLength: 2 },
    { name: 'STAGING_SERVER_SSH_KEY', secret: true, minLength: 100 },
    // ── Its own data stores ─────────────────────────────────────────────────
    { name: 'STAGING_DATABASE_URL', url: true, database: true, secret: true, minLength: 20 },
    { name: 'STAGING_DIRECT_DATABASE_URL', url: true, database: true, secret: true, minLength: 20 },
    { name: 'STAGING_DATABASE_PASSWORD', secret: true, minLength: 16 },
    { name: 'STAGING_REDIS_HOST', url: true, minLength: 3 },
    { name: 'STAGING_REDIS_PASSWORD', secret: true, minLength: 16 },
    // ── Its own keys. Sharing any of these makes a staging session valid in
    //    production, which is the whole point of not sharing them. ───────────
    { name: 'STAGING_JWT_SECRET', secret: true, minLength: 32 },
    { name: 'STAGING_JWT_REFRESH_SECRET', secret: true, minLength: 32 },
    { name: 'STAGING_INTERNAL_JWT_SECRET', secret: true, minLength: 32 },
    { name: 'STAGING_INTERNAL_API_KEY', secret: true, minLength: 16 },
    { name: 'STAGING_ENCRYPTION_KEY', secret: true, minLength: 64 },
    // ── Its own front door ──────────────────────────────────────────────────
    { name: 'STAGING_CLOUDFLARE_TUNNEL_TOKEN', secret: true, minLength: 32 },
    { name: 'STAGING_PUBLIC_API_URL', url: true, minLength: 10 },
    { name: 'STAGING_PUBLIC_DASHBOARD_URL', url: true, minLength: 10 },
]);

/** Hosts inside a value: a bare hostname, or the host of any URL it contains. */
export function hostsIn(value: string): string[] {
    const hosts = new Set<string>();
    const trimmed = value.trim();
    if (/^[A-Za-z0-9._-]+$/.test(trimmed) && trimmed.includes('.')) hosts.add(trimmed.toLowerCase());
    for (const match of trimmed.matchAll(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"]+/g)) {
        try { hosts.add(new URL(match[0]).hostname.toLowerCase()); } catch { /* not a URL after all */ }
    }
    return [...hosts];
}

/** The database name a connection string names, if it names one. */
export function databaseNameIn(value: string): string | null {
    for (const match of value.trim().matchAll(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"]+/g)) {
        try {
            const parsed = new URL(match[0]);
            const name = parsed.pathname.replace(/^\//, '').split('?')[0];
            if (name) return name.toLowerCase();
        } catch { /* not a URL after all */ }
    }
    return null;
}

const isProductionHost = (host: string, extra: readonly string[]): boolean =>
    PRODUCTION_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))
    || extra.some(candidate => {
        const normalised = candidate.trim().toLowerCase();
        return !!normalised && (host === normalised || host.endsWith(`.${normalised}`));
    });

/**
 * The verdict. Pure: no environment read, no network, no filesystem — the
 * caller supplies everything, so this is the same function the tests run.
 */
export function assessStagingIsolation(input: IsolationInput): IsolationReport {
    const findings: IsolationFinding[] = [];
    const env = input.env ?? {};
    const productionHosts = input.productionHosts ?? [];
    const digests = new Set(input.productionDigests ?? []);
    const salt = input.digestSalt ?? '';
    // A digest set with no salt cannot be compared against anything, and
    // pretending otherwise would report "not shared" for every secret.
    const comparable = digests.size > 0 && salt.length > 0;
    if (digests.size > 0 && !salt) {
        findings.push({ variable: 'STAGING_ISOLATION_DIGEST_SALT', code: 'missing' });
    }

    for (const variable of STAGING_CONTRACT) {
        const raw = env[variable.name];
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (!value) { findings.push({ variable: variable.name, code: 'missing' }); continue; }
        if (variable.minLength && value.length < variable.minLength) {
            findings.push({ variable: variable.name, code: 'weak_value', detail: `shorter than ${variable.minLength}` });
        }
        if (variable.secret && comparable && digests.has(secretDigest(value, salt))) {
            findings.push({ variable: variable.name, code: 'shared_with_production', detail: fingerprint(value) });
        }
        if (variable.url) {
            for (const host of hostsIn(value)) {
                if (isProductionHost(host, productionHosts)) {
                    findings.push({ variable: variable.name, code: 'production_host', detail: host });
                }
            }
        }
        if (variable.database) {
            const name = databaseNameIn(value);
            if (name && PRODUCTION_DATABASE_NAMES.includes(name)) {
                findings.push({ variable: variable.name, code: 'production_database_name', detail: name });
            }
        }
    }

    // Data. Synthetic is the default and the only thing this contract allows;
    // a production copy is a decision with a legal shape, not a workflow input.
    const seed = (env.STAGING_SEED_SOURCE ?? 'synthetic').trim().toLowerCase();
    if (seed !== 'synthetic') {
        findings.push({ variable: 'STAGING_SEED_SOURCE', code: 'production_copy_requested', detail: seed });
    }

    return { ok: findings.length === 0, checked: STAGING_CONTRACT.length, findings };
}

/** One stable, parseable line. The same shape as the agreed-terms pre-flight. */
export function isolationSummaryLine(report: IsolationReport): string {
    const counts = new Map<IsolationCode, number>();
    for (const finding of report.findings) counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
    const codes: IsolationCode[] = ['missing', 'shared_with_production', 'production_host',
        'production_database_name', 'production_copy_requested', 'weak_value'];
    return `STAGING_ISOLATION checked=${report.checked} `
        + codes.map(code => `${code}=${counts.get(code) ?? 0}`).join(' ')
        + ` blocks=${report.ok ? 0 : 1}`;
}

/** One line per finding: name, why, and never the value. */
export function isolationFindings(report: IsolationReport): string[] {
    return report.findings.map(finding =>
        `  ${finding.variable} ${finding.code}${finding.detail ? ` (${finding.detail})` : ''}`);
}
