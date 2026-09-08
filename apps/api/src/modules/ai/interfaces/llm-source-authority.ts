import type { LLMResponse } from './illm-provider.interface';

/** Server-owned scope around EACH provider attempt, including router failover.
 * Never supplied by tenant JSON or forwarded as part of a provider request.
 */
export type LLMSourceAuthority = (invoke: () => Promise<LLMResponse>) => Promise<LLMResponse>;

/** A revoked data source is not a provider outage and must not trigger failover.
 * Preserve billed usage when a response is discarded, without retaining its text.
 */
export class LLMSourceAuthorityUnavailable extends Error {
    constructor(readonly usage?: LLMResponse['usage']) {
        super('llm_source_authority_unavailable');
    }
}
