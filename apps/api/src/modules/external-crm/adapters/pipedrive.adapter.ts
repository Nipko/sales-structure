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

const PIPEDRIVE_AUTHORIZE = 'https://oauth.pipedrive.com/oauth/authorize';
const PIPEDRIVE_TOKEN = 'https://oauth.pipedrive.com/oauth/token';

// Pipedrive uses scope bundles. "contacts:full" + "deals:full" cover what we
// need for persons/deals/notes. The "base" scope is implicit.
const PIPEDRIVE_SCOPES = ['contacts:full', 'deals:full'];

@Injectable()
export class PipedriveAdapter implements ICrmAdapter {
    readonly provider = 'pipedrive';
    private readonly logger = new Logger(PipedriveAdapter.name);

    constructor(private readonly config: ConfigService) {}

    private get clientId() { return this.config.get<string>('PIPEDRIVE_CLIENT_ID', ''); }
    private get clientSecret() { return this.config.get<string>('PIPEDRIVE_CLIENT_SECRET', ''); }

    buildAuthorizeUrl(state: string, redirectUri: string): string {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: redirectUri,
            state,
            scope: PIPEDRIVE_SCOPES.join(' '),
        });
        return `${PIPEDRIVE_AUTHORIZE}?${params.toString()}`;
    }

    async exchangeCode(code: string, redirectUri: string) {
        const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
        });
        const res = await fetch(PIPEDRIVE_TOKEN, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basic}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Pipedrive token exchange failed: ${res.status} ${text}`);
        }
        const data = await res.json();
        // Pipedrive returns api_domain (per-company subdomain) — we MUST persist
        // and use it for all subsequent API calls.
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: new Date(Date.now() + data.expires_in * 1000),
            scopes: (data.scope ?? '').split(' ').filter(Boolean),
            externalAccountId: data.api_domain,
            externalAccountName: data.api_domain?.replace(/^https?:\/\//, '') ?? data.api_domain,
        };
    }

    async refreshAccessToken(refreshToken: string) {
        const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
        const res = await fetch(PIPEDRIVE_TOKEN, {
            method: 'POST',
            headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Pipedrive refresh failed: ${res.status} ${text}`);
        }
        const data = await res.json();
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? refreshToken,
            expiresAt: new Date(Date.now() + data.expires_in * 1000),
        };
    }

    private apiBase(ctx: CrmAdapterContext): string {
        // externalAccountId = api_domain (e.g. https://yourcompany.pipedrive.com)
        const base = ctx.metadata?.externalAccountId;
        if (!base) throw new Error('Pipedrive api_domain not stored on connection');
        return base.replace(/\/$/, '');
    }

    private async req(ctx: CrmAdapterContext, path: string, init: RequestInit = {}) {
        const headers = {
            Authorization: `Bearer ${ctx.accessToken}`,
            'Content-Type': 'application/json',
            ...((init.headers as Record<string, string>) || {}),
        };
        const res = await fetch(`${this.apiBase(ctx)}${path}`, { ...init, headers });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Pipedrive ${init.method ?? 'GET'} ${path} failed: ${res.status} ${text}`);
        }
        return res.json();
    }

    // ─── Outbound: contact (person in Pipedrive) ────────────────────────────
    // No native upsert. Search by email, then update or create.
    async upsertContact(ctx: CrmAdapterContext, contact: CanonicalContact): Promise<UpsertResult> {
        let existingId: number | null = null;
        if (contact.email) {
            const r = await this.req(
                ctx,
                `/api/v1/persons/search?term=${encodeURIComponent(contact.email)}&fields=email&exact_match=true&limit=1`,
            );
            existingId = r?.data?.items?.[0]?.item?.id ?? null;
        }
        if (!existingId && contact.phoneE164) {
            const r = await this.req(
                ctx,
                `/api/v1/persons/search?term=${encodeURIComponent(contact.phoneE164)}&fields=phone&exact_match=true&limit=1`,
            );
            existingId = r?.data?.items?.[0]?.item?.id ?? null;
        }

        const name =
            [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
            contact.fullName ||
            contact.email ||
            contact.phoneE164 ||
            'Sin nombre';

        const payload: any = { name };
        if (contact.email) payload.email = [{ value: contact.email, primary: true }];
        if (contact.phoneE164) payload.phone = [{ value: contact.phoneE164, primary: true }];

        if (existingId) {
            const r = await this.req(ctx, `/api/v1/persons/${existingId}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            return {
                externalId: String(r.data.id),
                operation: 'update',
                externalUrl: `${this.apiBase(ctx)}/person/${r.data.id}`,
            };
        }
        const r = await this.req(ctx, `/api/v1/persons`, { method: 'POST', body: JSON.stringify(payload) });
        return {
            externalId: String(r.data.id),
            operation: 'create',
            externalUrl: `${this.apiBase(ctx)}/person/${r.data.id}`,
        };
    }

    // ─── Outbound: deal ──────────────────────────────────────────────────────
    async upsertDeal(ctx: CrmAdapterContext, deal: CanonicalDeal): Promise<UpsertResult> {
        const payload: any = {
            title: deal.title,
            person_id: Number(deal.contactId),
        };
        if (typeof deal.valueCents === 'number') {
            payload.value = deal.valueCents / 100;
        }
        if (deal.currency) payload.currency = deal.currency;
        if (deal.expectedCloseDate) {
            payload.expected_close_date = deal.expectedCloseDate.toISOString().slice(0, 10);
        }
        // If our canonical stage looks numeric (user mapped it), use as stage_id.
        // Otherwise let Pipedrive pick the default stage of the default pipeline.
        if (/^\d+$/.test(deal.stage)) payload.stage_id = Number(deal.stage);

        const r = await this.req(ctx, `/api/v1/deals`, { method: 'POST', body: JSON.stringify(payload) });
        return {
            externalId: String(r.data.id),
            operation: 'create',
            externalUrl: `${this.apiBase(ctx)}/deal/${r.data.id}`,
        };
    }

    // ─── Outbound: activity (note attached to person) ───────────────────────
    async pushActivity(ctx: CrmAdapterContext, activity: CanonicalActivity): Promise<UpsertResult> {
        const subject =
            activity.type === 'message'
                ? `[Parallly · ${activity.channel ?? 'chat'}] ${activity.direction ?? ''}`.trim()
                : `[Parallly · ${activity.type}]`;
        const content = `<p><strong>${subject}</strong></p><p>${this.escapeHtml(activity.body)}</p>`;
        const payload: any = {
            content,
            person_id: Number(activity.contactId),
            add_time: activity.occurredAt.toISOString().slice(0, 19).replace('T', ' '),
        };
        if (activity.dealId && /^\d+$/.test(activity.dealId)) payload.deal_id = Number(activity.dealId);
        const r = await this.req(ctx, `/api/v1/notes`, { method: 'POST', body: JSON.stringify(payload) });
        return { externalId: String(r.data.id), operation: 'create' };
    }

    async pullContacts(ctx: CrmAdapterContext, cursor?: string): Promise<PullPage<CanonicalContact>> {
        const start = cursor ? Number(cursor) : 0;
        const limit = 100;
        const r = await this.req(ctx, `/api/v1/persons?start=${start}&limit=${limit}`);
        const items: CanonicalContact[] = (r.data ?? []).map((p: any) => {
            const email = p.email?.find((e: any) => e.primary)?.value ?? p.email?.[0]?.value;
            const phone = p.phone?.find((e: any) => e.primary)?.value ?? p.phone?.[0]?.value;
            return {
                id: String(p.id),
                fullName: p.name,
                email,
                phoneE164: phone,
                company: p.org_name ?? undefined,
                createdAt: p.add_time ? new Date(p.add_time) : undefined,
                source: 'pipedrive',
            };
        });
        const more = r?.additional_data?.pagination?.more_items_in_collection;
        const nextStart = r?.additional_data?.pagination?.next_start;
        return {
            items,
            nextCursor: more && typeof nextStart === 'number' ? String(nextStart) : null,
        };
    }

    async testConnection(ctx: CrmAdapterContext) {
        try {
            const r = await this.req(ctx, `/api/v1/users/me`);
            return { ok: true, details: `${r.data.name} · ${r.data.company_name ?? ''}` };
        } catch (e: any) {
            return { ok: false, details: e.message };
        }
    }

    private escapeHtml(s: string) {
        return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    }
}
