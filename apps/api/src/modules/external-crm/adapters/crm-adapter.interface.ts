import type {
    CanonicalActivity,
    CanonicalContact,
    CanonicalDeal,
    CrmAdapterContext,
    PullPage,
    UpsertResult,
} from '../types/crm.types';

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

    // ─── Initial import (Phase 2 polish, optional in MVP) ────────────────────
    pullContacts?(ctx: CrmAdapterContext, cursor?: string): Promise<PullPage<CanonicalContact>>;

    // ─── Inbound webhooks (Phase 2) ──────────────────────────────────────────
    verifyWebhookSignature?(rawBody: string, headers: Record<string, string>): boolean;
    handleInboundWebhook?(ctx: CrmAdapterContext, payload: unknown): Promise<void>;

    // ─── Health probe used by the Test button in dashboard ───────────────────
    testConnection(ctx: CrmAdapterContext): Promise<{ ok: boolean; details?: string }>;
}
