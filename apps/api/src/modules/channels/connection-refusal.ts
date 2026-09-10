/**
 * Why a connection could not be resolved — as a code, not as prose.
 *
 * A resolver that cannot serve the connection it was asked for has exactly one
 * honest answer, and it is not "here is a different one". These are the reasons
 * it may give. They are stable strings because they cross into logs, incident
 * rules, dashboards and, eventually, something a business reads about its own
 * account; a message that changes wording breaks all of those quietly.
 *
 * The distinction between `connection_not_found` and `connection_absent` is the
 * one that matters operationally, and it is the same distinction the funding
 * contract draws between `not_ready` and `unknown`: "you named a connection this
 * tenant does not have" is a caller defect somebody has to fix, and "this tenant
 * has no connection of this type at all" is a tenant-configuration fact somebody
 * has to act on. Collapsing them sends the wrong person the wrong message.
 */
export type ConnectionRefusalCode =
    /** A connection was named and this tenant does not have it. Never substituted. */
    | 'connection_not_found'
    /** No connection was named and the tenant has more than one that could send. */
    | 'connection_ambiguous'
    /** The tenant has no connection of this type that could send at all. */
    | 'connection_absent'
    /** The connection exists but no usable credential is stored for it. */
    | 'credential_missing'
    /** A credential is stored and could not be decrypted — rotation, wrong key. */
    | 'credential_undecryptable';

export interface ConnectionRefusalDetail {
    readonly tenantId: string;
    readonly channelType: string;
    /** What the caller asked for, when it asked for something specific. */
    readonly requestedAccountId?: string | null;
    /** Extra context for a log line. Never a credential. */
    readonly detail?: string | null;
}

/**
 * A refusal to resolve a connection.
 *
 * An `Error` subclass on purpose: every one of the twenty-six call sites already
 * treats a failure here as a thrown error, either catching it or letting it
 * bubble, so refusing does not need any of them to change shape. What is new is
 * the `code`, so a caller that wants to distinguish "fix the call" from "the
 * tenant has nothing connected" can, without parsing English.
 */
export class ConnectionRefusedError extends Error {
    readonly code: ConnectionRefusalCode;
    readonly tenantId: string;
    readonly channelType: string;
    readonly requestedAccountId?: string | null;

    constructor(code: ConnectionRefusalCode, detail: ConnectionRefusalDetail) {
        super(describeRefusal(code, detail));
        this.name = 'ConnectionRefusedError';
        this.code = code;
        this.tenantId = detail.tenantId;
        this.channelType = detail.channelType;
        this.requestedAccountId = detail.requestedAccountId ?? null;
    }
}

/** The human half of a refusal. The machine half is the code. */
function describeRefusal(code: ConnectionRefusalCode, detail: ConnectionRefusalDetail): string {
    const named = detail.requestedAccountId ? ` (account ${detail.requestedAccountId})` : '';
    const suffix = detail.detail ? `: ${detail.detail}` : '';
    switch (code) {
        case 'connection_not_found':
            return `No ${detail.channelType} connection${named} for tenant ${detail.tenantId}${suffix}`;
        case 'connection_ambiguous':
            return `Tenant ${detail.tenantId} has more than one ${detail.channelType} connection and none was named`
                + `; the sending account has to be chosen by the caller${suffix}`;
        case 'connection_absent':
            return `No ${detail.channelType} connection for tenant ${detail.tenantId}${suffix}`;
        case 'credential_missing':
            return `No ${detail.channelType} credentials${named} for tenant ${detail.tenantId}${suffix}`;
        case 'credential_undecryptable':
            return `Failed to decrypt ${detail.channelType} credentials${named} for tenant ${detail.tenantId}${suffix}`;
        default:
            return `Could not resolve a ${detail.channelType} connection for tenant ${detail.tenantId}${suffix}`;
    }
}

/** Narrow an unknown caught value to a refusal, so a caller can read the code. */
export function isConnectionRefusal(error: unknown): error is ConnectionRefusedError {
    return error instanceof ConnectionRefusedError;
}
