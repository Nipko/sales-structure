/**
 * Is this URL one of the disposable evaluation databases, and nothing else?
 *
 * Every PostgreSQL suite refuses to run against a database it does not
 * recognise, on purpose: a misconfigured environment variable must not be able
 * to point a suite that truncates tables at a shared or production instance.
 * That guard was written eighteen times in three different shapes — exact
 * equality, a prefix, a suffix — and the prefix and equality forms stopped being
 * true the moment the runner started giving each Jest worker its own copy of the
 * database (`jest.global-setup.js`), because that copy is named
 * `parallly_w2_eval_isolation`, not `parallly_eval_isolation`.
 *
 * So the rule lives here once and knows about the worker copies: the name must
 * be exactly the base database, or the base with a `_wN_` worker infix. Nothing
 * else passes, and a production name cannot.
 */
export const DISPOSABLE_EVAL_DATABASE = 'parallly_eval_isolation';
export const DISPOSABLE_KNOWLEDGE_DATABASE = 'parallly_knowledge_eval_isolation';

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

export function isDisposableDatabaseUrl(url: URL, base: string = DISPOSABLE_EVAL_DATABASE): boolean {
    if (!LOOPBACK.includes(url.hostname)) return false;
    // The base names are constants of this repository and contain only `[a-z_]`,
    // so there is nothing to escape and nothing a caller could inject. A base
    // that does not look like one is refused rather than turned into a pattern.
    if (!/^[a-z_]+_eval_isolation$/.test(base)) return false;
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (name === base) return true;
    const prefix = base.replace(/_eval_isolation$/, '');
    return new RegExp(`^${prefix}_w\\d+_eval_isolation$`).test(name);
}

/** The same rule, for the callers that only hold the raw string. */
export function isDisposableDatabase(raw: string | undefined, base: string = DISPOSABLE_EVAL_DATABASE): boolean {
    if (!raw) return false;
    try { return isDisposableDatabaseUrl(new URL(raw), base); } catch { return false; }
}
