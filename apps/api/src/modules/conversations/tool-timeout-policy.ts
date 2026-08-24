import type { ToolPolicy } from './tool-policy-registry';

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
