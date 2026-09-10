/**
 * ═══ THE GUARD IN FRONT OF ANYTHING THAT WRITES ═══
 *
 * The October cut-over happens on the VPS that already serves tenants. That
 * changes what this guard is for.
 *
 * It used to protect a staging environment from being pointed at production.
 * There is no staging: the owner decided to migrate the existing host, and
 * seeding or resetting synthetic data into a database with real tenants is not
 * something any script here may do. So the guard's job now is narrower and
 * sharper: **a rehearsal must be able to prove that its destination is
 * disposable**, and no script that resets or seeds may run anywhere else.
 *
 * A backup/restore rehearsal, an upgrade rehearsal, a migration dry run — each
 * of those is destructive by design and each needs a destination it is allowed
 * to destroy. This says which destinations those are, and it says it from the
 * connection string rather than from an intention.
 *
 * Three independent statements, because any one of them can be wrong alone:
 *
 *   · the environment must say it is a rehearsal — a `.env` copied between
 *     hosts satisfies nothing else;
 *   · the database name must SAY it is disposable, not merely fail to say it is
 *     production — a name nobody can read as disposable is a name somebody will
 *     one day read as something else;
 *   · neither may name a production host or the production database.
 */

/** Production by definition, whatever any variable claims. */
export const PRODUCTION_DOMAINS: readonly string[] = Object.freeze(['parallly-chat.cloud']);
export const PRODUCTION_DATABASE_NAMES: readonly string[] = Object.freeze(['parallext_engine']);

/**
 * A disposable database SAYS so. The two suffixes this repository already uses
 * for throwaway instances, and nothing else — every PostgreSQL suite here
 * already refuses a database whose name does not end in `_eval_isolation`, on
 * purpose, so a mistyped variable cannot reach a shared instance.
 */
const DISPOSABLE_DATABASE = /(^|[_-])(eval_isolation|rehearsal)$/i;

export type TargetRefusal =
    | 'environment_not_rehearsal'
    | 'connection_string_missing'
    | 'database_name_missing'
    | 'production_database_name'
    | 'database_name_not_disposable'
    | 'production_host';

export class DisposableTargetRefused extends Error {
    constructor(readonly reason: TargetRefusal, readonly detail?: string) {
        super(`disposable_target_refused:${reason}${detail ? `:${detail}` : ''}`);
    }
}

export interface DisposableTarget {
    readonly databaseUrl: string;
    readonly databaseName: string;
}

/** Hosts named inside a value: a bare hostname, or the host of any URL in it. */
export function hostsIn(value: string): string[] {
    const hosts = new Set<string>();
    const trimmed = String(value ?? '').trim();
    if (/^[A-Za-z0-9._-]+$/.test(trimmed) && trimmed.includes('.')) hosts.add(trimmed.toLowerCase());
    for (const match of trimmed.matchAll(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"]+/g)) {
        try { hosts.add(new URL(match[0]).hostname.toLowerCase()); } catch { /* not a URL after all */ }
    }
    return [...hosts];
}

/** The database name a connection string names, if it names one. */
export function databaseNameIn(value: string): string | null {
    for (const match of String(value ?? '').trim().matchAll(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"]+/g)) {
        try {
            const name = new URL(match[0]).pathname.replace(/^\//, '').split('?')[0];
            if (name) return name.toLowerCase();
        } catch { /* not a URL after all */ }
    }
    return null;
}

/**
 * The one gate. Pure except for what it is given, so the tests run the same
 * function the scripts do.
 *
 * `environment` is `PARALLLY_REHEARSAL`, written by the rehearsal runner and set
 * nowhere else — production never sets it, so an unset value is a refusal and
 * never a default. That asymmetry is the point: the safe reading of "I do not
 * know where I am" is "not here".
 */
export function assertDisposableTarget(input: {
    environment?: string | null; databaseUrl?: string | null;
}): DisposableTarget {
    if (String(input?.environment ?? '').trim().toLowerCase() !== 'rehearsal') {
        throw new DisposableTargetRefused('environment_not_rehearsal', String(input?.environment ?? '(unset)'));
    }
    const databaseUrl = String(input?.databaseUrl ?? '').trim();
    if (!databaseUrl) throw new DisposableTargetRefused('connection_string_missing');
    for (const host of hostsIn(databaseUrl)) {
        if (PRODUCTION_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))) {
            throw new DisposableTargetRefused('production_host', host);
        }
    }
    const databaseName = databaseNameIn(databaseUrl);
    if (!databaseName) throw new DisposableTargetRefused('database_name_missing');
    if (PRODUCTION_DATABASE_NAMES.includes(databaseName)) {
        throw new DisposableTargetRefused('production_database_name', databaseName);
    }
    if (!DISPOSABLE_DATABASE.test(databaseName)) {
        throw new DisposableTargetRefused('database_name_not_disposable', databaseName);
    }
    return Object.freeze({ databaseUrl, databaseName });
}

/**
 * The opposite question, for the read-only tools that run ON the operational
 * host: is this the live database?
 *
 * An inventory has to run against production to be worth anything, so it must
 * NOT use the guard above. What it must do instead is refuse to write. This
 * exists so the distinction is a named thing rather than an omission.
 */
export function isOperationalTarget(databaseUrl: string | null | undefined): boolean {
    const name = databaseNameIn(String(databaseUrl ?? ''));
    return !!name && PRODUCTION_DATABASE_NAMES.includes(name);
}
