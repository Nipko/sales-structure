import { HttpException, HttpStatus } from '@nestjs/common';

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
    | 'credential_undecryptable'
    /**
     * The connection exists and is not in a state that may send: the tenant
     * disconnected it, Meta restricted it, or onboarding never finished.
     * Distinct from `connection_absent` on purpose — there IS something here,
     * and what it needs is reconnecting rather than creating.
     */
    | 'connection_disconnected'
    /**
     * A credential exists and may no longer be used: revoked on disconnect, or
     * mid-rotation, where the replacement may already be the live one at Meta.
     */
    | 'credential_revoked'
    /** A credential exists and its own expiry has passed. */
    | 'credential_expired';

export interface ConnectionRefusalDetail {
    readonly tenantId: string;
    readonly channelType: string;
    /** What the caller asked for, when it asked for something specific. */
    readonly requestedAccountId?: string | null;
    /** Extra context for a log line. Never a credential. */
    readonly detail?: string | null;
}

/**
 * The HTTP answer each refusal deserves.
 *
 * There is no global exception filter in this application, so an error that is
 * not an `HttpException` becomes a 500. That is how these refusals started
 * regressing real endpoints: asking for the business profile of a number that is
 * not connected used to answer `NotFoundException` — 404, which a dashboard can
 * render — and once the resolver refused with a plain `Error` it answered 500,
 * which reads as "the platform is broken" for a tenant whose only problem is
 * that they have not connected a number.
 *
 * The three statuses are three different jobs:
 *   404 — nothing there to serve. The tenant connects a number, or the caller
 *         stops naming one that does not exist.
 *   409 — there IS something to serve and more than one candidate. The request
 *         is answerable as soon as the caller names which account pays; nothing
 *         is broken and nothing is missing.
 *   424 — the connection exists and its credential does not work. Nobody
 *         upstream can fix this by changing the request; it is a rotation or a
 *         key problem, and a 4xx that blames the caller would send the wrong
 *         person looking.
 */
const REFUSAL_STATUS: Readonly<Record<ConnectionRefusalCode, HttpStatus>> = {
    connection_not_found: HttpStatus.NOT_FOUND,
    connection_absent: HttpStatus.NOT_FOUND,
    connection_ambiguous: HttpStatus.CONFLICT,
    credential_missing: HttpStatus.FAILED_DEPENDENCY,
    credential_undecryptable: HttpStatus.FAILED_DEPENDENCY,
    // 409, not 404: the connection is there and the request becomes
    // answerable again the moment somebody reconnects it. A 404 would send
    // an operator looking for a number that has not gone anywhere.
    connection_disconnected: HttpStatus.CONFLICT,
    // 424: the credential is what failed, and no change to the request fixes
    // it — the same reasoning as the two above it.
    credential_revoked: HttpStatus.FAILED_DEPENDENCY,
    credential_expired: HttpStatus.FAILED_DEPENDENCY,
};

/**
 * A refusal to resolve a connection.
 *
 * An `HttpException` subclass, which is still an `Error`: every one of the
 * twenty-six call sites already treats a failure here as a thrown error, either
 * catching it or letting it bubble, so refusing needs none of them to change
 * shape. What the base class adds is a status for the ones that bubble all the
 * way to a controller, and what the `code` adds is a caller's ability to
 * distinguish "fix the call" from "the tenant has nothing connected" without
 * parsing English.
 *
 * The code travels in the response body too. A dashboard that has to tell a
 * business "connect a number" apart from "say which number" cannot do it from
 * the status alone, and must never do it by matching on prose.
 */
export class ConnectionRefusedError extends HttpException {
    readonly code: ConnectionRefusalCode;
    readonly tenantId: string;
    readonly channelType: string;
    readonly requestedAccountId?: string | null;

    constructor(code: ConnectionRefusalCode, detail: ConnectionRefusalDetail) {
        const status = REFUSAL_STATUS[code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
        // `message` stays the prose: NestJS reads it back off this object, so
        // logs and `error.message` say what they always said.
        super({ statusCode: status, error: 'connection_refused', code, message: describeRefusal(code, detail) },
            status);
        this.name = 'ConnectionRefusedError';
        this.code = code;
        this.tenantId = detail.tenantId;
        this.channelType = detail.channelType;
        this.requestedAccountId = detail.requestedAccountId ?? null;
    }
}

/** The status a refusal answers with, for callers that need it without throwing. */
export function refusalStatus(code: ConnectionRefusalCode): HttpStatus {
    return REFUSAL_STATUS[code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
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
        case 'connection_disconnected':
            return `The ${detail.channelType} connection${named} of tenant ${detail.tenantId} is not connected`
                + `; reconnect it before sending${suffix}`;
        case 'credential_revoked':
            return `The ${detail.channelType} credential${named} of tenant ${detail.tenantId} is revoked`
                + ` or being rotated${suffix}`;
        case 'credential_expired':
            return `The ${detail.channelType} credential${named} of tenant ${detail.tenantId} has expired${suffix}`;
        default:
            return `Could not resolve a ${detail.channelType} connection for tenant ${detail.tenantId}${suffix}`;
    }
}

/** Narrow an unknown caught value to a refusal, so a caller can read the code. */
export function isConnectionRefusal(error: unknown): error is ConnectionRefusedError {
    return error instanceof ConnectionRefusedError;
}
