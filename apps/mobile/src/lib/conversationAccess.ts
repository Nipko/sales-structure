/** Only an explicit HTTP denial/removal invalidates a previously loaded thread. */
export function isConversationAccessLost(error: unknown): boolean {
    const status = (error as { httpStatus?: number } | null)?.httpStatus;
    return status === 403 || status === 404;
}
