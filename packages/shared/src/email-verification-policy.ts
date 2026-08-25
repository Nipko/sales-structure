/**
 * Progressive email-verification policy shared by API, dashboard and audit
 * surfaces.  The account can keep recovering/configuring itself while an
 * unverified address cannot authorize an operation that affects customers,
 * money, secrets or tenant data.
 */
export type EmailVerificationState =
    | 'unverified'
    | 'pending_change'
    | 'verified'
    | 'restricted';

export type VerifiedEmailCapability =
    | 'activate_channel'
    | 'activate_agent'
    | 'activate_integration'
    | 'send_outbound'
    | 'invite_user'
    | 'manage_secrets'
    | 'manage_billing'
    | 'export_tenant_data'
    | 'sensitive_admin';

export const VERIFIED_EMAIL_CAPABILITY_KEY = 'verified_email_capability';

export interface EmailVerificationCapabilityPolicy {
    capability: VerifiedEmailCapability;
    risk: 'customer_impact' | 'access' | 'secret' | 'financial' | 'data';
    requiresVerified: true;
}

export const EMAIL_VERIFICATION_CAPABILITIES: Readonly<
    Record<VerifiedEmailCapability, EmailVerificationCapabilityPolicy>
> = Object.freeze({
    activate_channel: Object.freeze({ capability: 'activate_channel', risk: 'customer_impact', requiresVerified: true }),
    activate_agent: Object.freeze({ capability: 'activate_agent', risk: 'customer_impact', requiresVerified: true }),
    activate_integration: Object.freeze({ capability: 'activate_integration', risk: 'secret', requiresVerified: true }),
    send_outbound: Object.freeze({ capability: 'send_outbound', risk: 'customer_impact', requiresVerified: true }),
    invite_user: Object.freeze({ capability: 'invite_user', risk: 'access', requiresVerified: true }),
    manage_secrets: Object.freeze({ capability: 'manage_secrets', risk: 'secret', requiresVerified: true }),
    manage_billing: Object.freeze({ capability: 'manage_billing', risk: 'financial', requiresVerified: true }),
    export_tenant_data: Object.freeze({ capability: 'export_tenant_data', risk: 'data', requiresVerified: true }),
    sensitive_admin: Object.freeze({ capability: 'sensitive_admin', risk: 'access', requiresVerified: true }),
});

export function resolveEmailVerificationState(user: {
    emailVerified?: boolean;
    isActive?: boolean;
    emailVerificationState?: EmailVerificationState;
} | null | undefined): EmailVerificationState {
    if (!user || user.isActive === false || user.emailVerificationState === 'restricted') return 'restricted';
    if (user.emailVerificationState === 'pending_change') return 'pending_change';
    return user.emailVerified === true ? 'verified' : 'unverified';
}
