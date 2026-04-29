import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICrmAdapter } from './crm-adapter.interface';
import type {
    CanonicalActivity,
    CanonicalContact,
    CanonicalDeal,
    CrmAdapterContext,
    PullPage,
    UpsertResult,
} from '../types/crm.types';

const HUBSPOT_API = 'https://api.hubapi.com';
const HUBSPOT_AUTHORIZE = 'https://app.hubspot.com/oauth/authorize';

// Minimum scopes for outbound contact + deal sync + timeline.
const HUBSPOT_SCOPES = [
    'crm.objects.contacts.read',
    'crm.objects.contacts.write',
    'crm.objects.deals.read',
    'crm.objects.deals.write',
    'oauth',
];

@Injectable()
export class HubSpotAdapter implements ICrmAdapter {
    readonly provider = 'hubspot';
    private readonly logger = new Logger(HubSpotAdapter.name);

    constructor(private readonly config: ConfigService) {}

    private get clientId() {
        return this.config.get<string>('HUBSPOT_CLIENT_ID', '');
    }
    private get clientSecret() {
        return this.config.get<string>('HUBSPOT_CLIENT_SECRET', '');
    }

    buildAuthorizeUrl(state: string, redirectUri: string): string {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: redirectUri,
            scope: HUBSPOT_SCOPES.join(' '),
            state,
        });
        return `${HUBSPOT_AUTHORIZE}?${params.toString()}`;
    }

    async exchangeCode(code: string, redirectUri: string) {
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: redirectUri,
            code,
        });
        const res = await fetch(`${HUBSPOT_API}/oauth/v1/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HubSpot token exchange failed: ${res.status} ${text}`);
        }
        const data = await res.json();
        // Lookup hub info to store an account label users recognize.
        const account = await this.fetchAccountInfo(data.access_token);
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: new Date(Date.now() + data.expires_in * 1000),
            scopes: HUBSPOT_SCOPES,
            externalAccountId: account?.portalId?.toString(),
            externalAccountName: account?.uiDomain ?? account?.portalId?.toString(),
        };
    }

    async refreshAccessToken(refreshToken: string) {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: refreshToken,
        });
        const res = await fetch(`${HUBSPOT_API}/oauth/v1/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HubSpot refresh failed: ${res.status} ${text}`);
        }
        const data = await res.json();
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? refreshToken,
            expiresAt: new Date(Date.now() + data.expires_in * 1000),
        };
    }

    private async fetchAccountInfo(token: string): Promise<any | null> {
        try {
            const res = await fetch(`${HUBSPOT_API}/account-info/v3/details`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return res.ok ? res.json() : null;
        } catch {
            return null;
        }
    }

    private async req(ctx: CrmAdapterContext, path: string, init: RequestInit = {}) {
        const headers = {
            Authorization: `Bearer ${ctx.accessToken}`,
            'Content-Type': 'application/json',
            ...((init.headers as Record<string, string>) || {}),
        };
        const res = await fetch(`${HUBSPOT_API}${path}`, { ...init, headers });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HubSpot ${init.method ?? 'GET'} ${path} failed: ${res.status} ${text}`);
        }
        return res.json();
    }

    // ─── Outbound: contact ────────────────────────────────────────────────────
    // HubSpot dedupes on email (primary) — if no email, we fall back to phone
    // search-then-create. Returns the stable internal vid as externalId.
    async upsertContact(ctx: CrmAdapterContext, contact: CanonicalContact): Promise<UpsertResult> {
        const properties: Record<string, any> = {};
        if (contact.email) properties.email = contact.email;
        if (contact.phoneE164) properties.phone = contact.phoneE164;
        if (contact.firstName) properties.firstname = contact.firstName;
        if (contact.lastName) properties.lastname = contact.lastName;
        if (contact.company) properties.company = contact.company;
        if (contact.jobTitle) properties.jobtitle = contact.jobTitle;
        if (contact.source) properties.hs_lead_status = 'NEW';
        // Stamp Parallly origin in a custom property if it exists.
        properties.parallly_source = contact.source ?? 'parallly';

        const idProperty = contact.email ? 'email' : 'phone';
        const idValue = contact.email ?? contact.phoneE164;

        if (!idValue) {
            throw new Error('HubSpot upsertContact: contact requires email or phoneE164');
        }

        // HubSpot v3 supports upsert via batch endpoint with idProperty.
        const body = {
            inputs: [{ idProperty, id: idValue, properties }],
        };
        const data = await this.req(ctx, `/crm/v3/objects/contacts/batch/upsert`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
        const result = data.results?.[0];
        if (!result?.id) throw new Error('HubSpot returned no contact id');
        return {
            externalId: result.id,
            operation: result.new === true ? 'create' : 'update',
            externalUrl: this.contactUrl(ctx, result.id),
        };
    }

    private contactUrl(ctx: CrmAdapterContext, id: string): string {
        const portal = ctx.metadata?.externalAccountId;
        return portal ? `https://app.hubspot.com/contacts/${portal}/contact/${id}` : '';
    }

    // ─── Outbound: deal ──────────────────────────────────────────────────────
    async upsertDeal(ctx: CrmAdapterContext, deal: CanonicalDeal): Promise<UpsertResult> {
        const properties: Record<string, any> = {
            dealname: deal.title,
            dealstage: deal.stage,                              // user must map our stage keys to HS internal stage IDs
        };
        if (deal.pipeline) properties.pipeline = deal.pipeline;
        if (typeof deal.valueCents === 'number') properties.amount = (deal.valueCents / 100).toFixed(2);
        if (deal.expectedCloseDate) properties.closedate = deal.expectedCloseDate.toISOString().slice(0, 10);
        if (deal.probability) properties.hs_priority = deal.probability >= 75 ? 'high' : 'medium';

        // We don't have a stable upsert idProperty for deals — create new and
        // let the caller persist external_id in crm_external_links.
        const data = await this.req(ctx, `/crm/v3/objects/deals`, {
            method: 'POST',
            body: JSON.stringify({
                properties,
                associations: [
                    {
                        to: { id: deal.contactId },
                        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }], // deal→contact
                    },
                ],
            }),
        });
        return {
            externalId: data.id,
            operation: 'create',
            externalUrl: this.dealUrl(ctx, data.id),
        };
    }

    private dealUrl(ctx: CrmAdapterContext, id: string): string {
        const portal = ctx.metadata?.externalAccountId;
        return portal ? `https://app.hubspot.com/contacts/${portal}/deal/${id}` : '';
    }

    // ─── Outbound: activity (timeline note) ──────────────────────────────────
    async pushActivity(ctx: CrmAdapterContext, activity: CanonicalActivity): Promise<UpsertResult> {
        // Engagement type "NOTE" is universally available without extra setup.
        // For richer message timelines we'd switch to Conversations API later.
        const subject =
            activity.type === 'message'
                ? `[Parallly · ${activity.channel ?? 'chat'}] ${activity.direction ?? ''}`.trim()
                : `[Parallly · ${activity.type}]`;
        const body = `${subject}\n\n${activity.body}`;
        const data = await this.req(ctx, `/crm/v3/objects/notes`, {
            method: 'POST',
            body: JSON.stringify({
                properties: {
                    hs_note_body: body,
                    hs_timestamp: activity.occurredAt.getTime(),
                },
                associations: [
                    {
                        to: { id: activity.contactId },
                        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }], // note→contact
                    },
                ],
            }),
        });
        return { externalId: data.id, operation: 'create' };
    }

    async pullContacts(ctx: CrmAdapterContext, cursor?: string): Promise<PullPage<CanonicalContact>> {
        const params = new URLSearchParams({
            limit: '100',
            properties: 'email,phone,firstname,lastname,company,jobtitle,createdate',
        });
        if (cursor) params.set('after', cursor);
        const data = await this.req(ctx, `/crm/v3/objects/contacts?${params.toString()}`);
        const items: CanonicalContact[] = (data.results ?? []).map((r: any) => ({
            id: r.id,
            email: r.properties?.email,
            phoneE164: r.properties?.phone,
            firstName: r.properties?.firstname,
            lastName: r.properties?.lastname,
            company: r.properties?.company,
            jobTitle: r.properties?.jobtitle,
            createdAt: r.properties?.createdate ? new Date(r.properties.createdate) : undefined,
            source: 'hubspot',
        }));
        return {
            items,
            nextCursor: data.paging?.next?.after ?? null,
        };
    }

    async testConnection(ctx: CrmAdapterContext) {
        try {
            const data = await this.req(ctx, `/account-info/v3/details`);
            return { ok: true, details: `Portal ${data.portalId} (${data.uiDomain ?? '—'})` };
        } catch (e: any) {
            return { ok: false, details: e.message };
        }
    }
}
