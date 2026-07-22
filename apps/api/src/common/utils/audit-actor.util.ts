/**
 * Resolve the audit fields for an action performed by an authenticated request.
 *
 * During impersonation `req.user` IS the impersonated tenant user, so recording
 * its id alone attributes the action to the customer's own admin — an auditor
 * would conclude the customer did it to themselves. The real operator travels
 * alongside in the delegation claims (see JwtPayload.impersonatedBy), so the
 * rule is: never replace the effective identity, record both.
 *
 * Spread `delegation` into the audit row's `details`; it is undefined for
 * ordinary sessions, which makes the spread a no-op.
 */
export function auditActor(user: any): {
    userId?: string;
    delegation?: Record<string, unknown>;
} {
    // `sub` is the raw JWT claim; some controllers read req.user straight from
    // the token shape rather than the validated user.
    const userId = user?.id ?? user?.sub;

    if (!user?.isImpersonation) return { userId };

    return {
        userId,
        delegation: {
            viaImpersonation: true,
            performedBy: user.impersonatedBy ?? null,
            impersonationSid: user.impersonationSid ?? null,
        },
    };
}
