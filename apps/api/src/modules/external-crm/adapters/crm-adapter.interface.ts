import type { CrmRetractionOutcome } from '../crm-note-receipts';
import type {
    CanonicalActivity,
    CanonicalContact,
    CanonicalDeal,
    CrmAdapterContext,
    PullPage,
    UpsertResult,
} from '../types/crm.types';

/** What a provider said when asked to take one pushed note back. */
export interface CrmRetraction {
    readonly outcome: CrmRetractionOutcome;
    /** What the provider said, for the row and for whoever reads it later. */
    readonly detail?: string;
}

/**
 * Common contract every CRM adapter must implement.
 *
 * Outbound only for the MVP — ExternalCrmService listens to internal events
 * (lead.created, lead.stage_changed, message.received, etc.) and calls the
 * adapter to push to the remote CRM. Inbound (CRM → Parallly) is opt-in via
 * provider webhooks and arrives in handleInboundWebhook().
 */
export interface ICrmAdapter {
    readonly provider: string;

    // ─── OAuth ───────────────────────────────────────────────────────────────
    buildAuthorizeUrl(state: string, redirectUri: string): string;
    exchangeCode(code: string, redirectUri: string): Promise<{
        accessToken: string;
        refreshToken?: string;
        expiresAt?: Date;
        scopes: string[];
        externalAccountId?: string;
        externalAccountName?: string;
    }>;
    refreshAccessToken(refreshToken: string): Promise<{
        accessToken: string;
        refreshToken?: string;
        expiresAt?: Date;
    }>;

    // ─── Outbound ────────────────────────────────────────────────────────────
    upsertContact(ctx: CrmAdapterContext, contact: CanonicalContact): Promise<UpsertResult>;
    upsertDeal(ctx: CrmAdapterContext, deal: CanonicalDeal): Promise<UpsertResult>;
    pushActivity(ctx: CrmAdapterContext, activity: CanonicalActivity): Promise<UpsertResult>;

    /**
     * Takes one pushed note back out of the tenant's CRM.
     *
     * Optional, and its absence is an answer rather than a crash: a provider
     * that cannot do this settles the receipt as `unknown` with that stated as
     * the reason, which is visible, instead of an erasure quietly reporting
     * success on a note still sitting in somebody's CRM.
     *
     * The three outcomes are strict and the adapter owns the mapping, because
     * only it knows what its own status codes mean. The rule they all follow:
     * a note that is already gone is `accepted` — a 404 on a DELETE is the end
     * state we wanted — a refusal is `rejected`, and anything that leaves the
     * question open (a timeout, a 429, a 5xx) is `unknown` and stays visible.
     */
    retractActivity?(ctx: CrmAdapterContext, externalId: string): Promise<CrmRetraction>;

    // ─── Initial import (Phase 2 polish, optional in MVP) ────────────────────
    pullContacts?(ctx: CrmAdapterContext, cursor?: string): Promise<PullPage<CanonicalContact>>;

    // ─── Inbound webhooks (Phase 2) ──────────────────────────────────────────
    verifyWebhookSignature?(rawBody: string, headers: Record<string, string>): boolean;
    handleInboundWebhook?(ctx: CrmAdapterContext, payload: unknown): Promise<void>;

    // ─── Health probe used by the Test button in dashboard ───────────────────
    testConnection(ctx: CrmAdapterContext): Promise<{ ok: boolean; details?: string }>;
}
