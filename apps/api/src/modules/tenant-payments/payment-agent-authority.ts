import { sameServedAgentAuthority, ServedAgentAuthorityError, type ServedAgentAuthority } from '../persona/served-agent-authority';

/** Private call metadata, passed separately from DTOs, tool arguments and money terms. */
export interface PaymentAgentExecution { readonly operationalScope: ServedAgentAuthority; }

/** A reserved intent cannot be adopted by another revision or by an unscoped caller. */
export function assertPaymentAuthorityBinding(stored: unknown, scope?: ServedAgentAuthority): void {
    if (stored == null && scope == null) return;
    if (!sameServedAgentAuthority(stored, scope)) throw new ServedAgentAuthorityError();
}
