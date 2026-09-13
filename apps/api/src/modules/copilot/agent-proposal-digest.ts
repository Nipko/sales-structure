import { createHash } from 'crypto';

/**
 * The one hashing implementation behind every Assist proposal.
 *
 * Both proposal ledgers — configuration changes and content creations — hand
 * the reviewer a digest and then refuse to apply anything whose digest no
 * longer matches. That only means something if "the same content" is decided
 * the same way in both places: two copies of this function would drift the
 * moment one of them learned about a new value shape, and the divergence would
 * show up as an apply that succeeds against content nobody reviewed.
 */

/**
 * A stable string for a value, independent of key order. `undefined` serialises
 * to `'null'` rather than disappearing, so a field that is present-but-undefined
 * and a field that is absent do not collide into the same digest.
 */
export function canonical(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort()
            .map(key => JSON.stringify(key) + ':' + canonical((value as any)[key]))
            .join(',') + '}';
    }
    return JSON.stringify(value) ?? 'null';
}

export const proposalHash = (value: unknown): string =>
    createHash('sha256').update(canonical(value)).digest('hex');

/** A reviewed proposal is only good for as long as a person stays on the page. */
export const PROPOSAL_TTL_MINUTES = 30;
