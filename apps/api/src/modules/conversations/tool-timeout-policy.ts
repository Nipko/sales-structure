import { getToolPolicy, type ToolPolicy } from './tool-policy-registry';
import { persistenceDisabled, type ServiceExecutionContext } from '../../common/types/execution-context';
import { FAQ_SELECTOR_TIMEOUT_MS } from '../faqs/faq-semantic-selector';

/** Deadline of an automatic read that only touches the database (customer context, bookings, menu, packages…). */
export const AUTOMATIC_READ_TIMEOUT_MS = 3_000;
/**
 * E2ag–E2aj (2026-11-10): the automatic FAQ lookup also runs the corrective selection (F4300-53) on a lexical miss: one model call
 * of up to FAQ_SELECTOR_TIMEOUT_MS after two reads. Under the database read deadline alone, a slow selector made the whole lookup
 * time out (2→10 per measurement) and, in a session, failed the turn. Its deadline is the selector's plus the read deadline.
 */
export const AUTOMATIC_FAQ_TIMEOUT_MS = FAQ_SELECTOR_TIMEOUT_MS + AUTOMATIC_READ_TIMEOUT_MS;

/** search_faqs normally records views. Its automatic-context handler explicitly
 * disables persistence, so that audited mode can safely use a read deadline. */
export function awaitAutomaticFaqLookup<T>(operation: Promise<T>, timeoutMs: number, context: ServiceExecutionContext): Promise<T> {
    const policy = getToolPolicy('search_faqs');
    const readPolicy = policy?.agentTestAllowed && persistenceDisabled(context)
        ? { ...policy, effect: 'read' as const, idempotency: 'not_applicable' as const }
        : policy;
    return awaitToolWithSafeTimeout(operation, timeoutMs, 'automatic_search_faqs', readPolicy);
}

/**
 * A Promise timeout does not cancel the underlying operation. It is therefore
 * safe only for an explicitly read-only tool: otherwise the caller could
 * report failure and continue while a detached writer commits afterwards.
 * Unknown/dynamic tools are awaited to completion by default.
 */
export function canDetachToolAfterTimeout(policy: ToolPolicy | undefined): boolean {
    return policy?.effect === 'read'
        && policy.commitsBusiness === false
        && policy.externalEffect !== 'provider_write'
        && policy.externalEffect !== 'channel_write';
}

export function awaitToolWithSafeTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    label: string,
    policy: ToolPolicy | undefined,
): Promise<T> {
    if (!canDetachToolAfterTimeout(policy)) return operation;

    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Tool ${label} timed out after ${timeoutMs}ms`)),
            timeoutMs,
        );
        operation.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}
