import { Injectable, Logger } from '@nestjs/common';
import {
    OUTBOUND_CONTRACT_VERSION,
    type ChannelType,
    type OutboundCredentialRef,
    type OutboundRecipient,
    type OutboundSendContext,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { ConnectionRefusedError } from './connection-refusal';
import { assertUsable, assessConnection, assessCredential, sendableChannelSql } from './connection-usability';

export interface ChannelCredentials {
    accessToken: string;
    phoneNumberId: string;
    wabaId: string;
    channelId: string;
}

export interface GenericChannelCredentials {
    accessToken: string;
    accountId: string;
    channelType: string;
}

/** A connection that may send, together with the credential it presents. */
export interface ResolvedConnection {
    readonly context: OutboundSendContext;
    readonly accessToken: string;
}

export interface SendContextRequest {
    readonly tenantId: string;
    readonly channelType: ChannelType;
    /** The exact connection. Omitted only where the tenant has exactly one. */
    readonly channelAccountId?: string | null;
    readonly recipient: OutboundRecipient;
}

/** The cached shape for WhatsApp. A superset of what callers get back. */
interface CachedWhatsAppConnection extends ChannelCredentials {
    businessId: string | null;
    displayPhoneNumber: string | null;
    credentialId: string;
    credentialSource: OutboundCredentialRef['source'];
}

/** The cached shape for every other channel. */
interface CachedGenericConnection extends GenericChannelCredentials {
    credentialId: string;
    credentialSource: OutboundCredentialRef['source'];
}

/**
 * Resolves the connection an outbound effect was authorised against, per tenant.
 *
 * Lives in ChannelsModule to break the circular dependency between
 * ConversationsModule and WhatsappModule.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 *
 * A connection that was named resolves to itself or to a refusal. There is no
 * third outcome, and in particular there is no "another connection of this
 * tenant". This used to be a fallback: look the number up, find nothing, run a
 * second query with no number in it and return whatever came back. While a
 * WhatsApp reply was free that read as resilience — the message still went out.
 *
 * From 1 October 2026 Meta bills the business's own WhatsApp Business Account
 * per delivered service message, so substituting a connection charges a WABA
 * nobody chose and puts the message in front of a customer as coming from a
 * number they never wrote to. Neither is recoverable after the fact.
 *
 * A connection that was NOT named resolves only when the tenant has exactly one
 * that can send — which is all "the tenant's number" ever honestly meant. On a
 * tenant with two it is `connection_ambiguous`, because there is no defensible
 * way to pick which account pays. That is the one deliberate behaviour change
 * here, and it is only reachable on multi-connection tenants.
 *
 * ── AND WHAT THAT MEANS FOR THE CACHE ───────────────────────────────────────
 *
 * The five-minute Redis entry used to be trusted whole: nothing compared the
 * account inside the cached value with the account the caller named. Every
 * entry is now keyed by the account it belongs to, carries that account inside
 * the value, and is checked against the request before it is served. A value
 * that disagrees with its own key is deleted, logged and re-resolved rather
 * than returned.
 *
 * The tenant-wide keys are gone entirely. `{channel}_token:{tenant}` named no
 * account, so it answered every unnamed request with whichever account was
 * resolved first — including after that account had been disconnected. An
 * unnamed request now consults the database, which is also the only way to
 * learn whether the tenant still has exactly one.
 */
@Injectable()
export class ChannelTokenService {
    private readonly logger = new Logger(ChannelTokenService.name);
    private readonly CACHE_TTL = 300; // 5 min

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private cryptoService: WhatsappCryptoService,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // WhatsApp
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Credentials for one of a tenant's WhatsApp numbers.
     *
     * `phoneNumberId` names the connection. Omitting it is a request for "the
     * tenant's number" and is honoured only while that phrase has one referent.
     *
     * The system_user_token is tenant-wide under the Tech Provider model, so the
     * per-number resolution is about WHICH WABA and WHICH sender — which is
     * exactly what Meta bills against — even when the token itself is shared.
     */
    async getWhatsAppToken(tenantId: string, phoneNumberId?: string): Promise<ChannelCredentials> {
        const resolved = await this.resolveWhatsApp(tenantId, phoneNumberId);
        return {
            accessToken: resolved.accessToken,
            phoneNumberId: resolved.phoneNumberId,
            wabaId: resolved.wabaId,
            channelId: resolved.channelId,
        };
    }

    private async resolveWhatsApp(
        tenantId: string, phoneNumberId?: string | null,
    ): Promise<CachedWhatsAppConnection> {
        const requested = normalizeAccountId(phoneNumberId);
        if (requested) {
            const cached = await this.readWhatsAppCache(tenantId, requested);
            if (cached) return cached;
        }

        const channel = await this.findWhatsAppChannel(tenantId, requested);
        // An unnamed request only got here because the tenant has exactly one
        // number; its cache entry still belongs to that number, not to "the
        // tenant", so it is read under the resolved account's own key.
        if (!requested) {
            const cached = await this.readWhatsAppCache(tenantId, channel.phone_number_id);
            if (cached) return cached;
        }

        const resolved = await this.credentialForWhatsApp(tenantId, channel);
        await this.writeCache(`wa_token:${tenantId}:${resolved.phoneNumberId}`,
            'whatsapp', tenantId, resolved.phoneNumberId, resolved);
        return resolved;
    }

    /** The channel row, or a refusal. Never another number of the same tenant. */
    private async findWhatsAppChannel(tenantId: string, phoneNumberId: string | null): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const columns = `id, phone_number_id, meta_waba_id, meta_business_id,
            display_phone_number, access_token_ref, channel_status`;

        if (phoneNumberId) {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT ${columns} FROM whatsapp_channels WHERE phone_number_id = $1 LIMIT 1`,
                [phoneNumberId],
            );
            if (!rows?.length) {
                // The whole point of this file. The row is not there, and the
                // tenant's other numbers are not an answer to this question.
                throw new ConnectionRefusedError('connection_not_found',
                    { tenantId, channelType: 'whatsapp', requestedAccountId: phoneNumberId });
            }
            // A named row that exists but cannot send is refused HERE rather
            // than filtered out of the query: the caller asked for THIS number
            // and deserves to be told it is disconnected, not that it is
            // missing. Filtering would also turn it into `connection_absent`,
            // which sends an operator looking for something to create.
            assertUsable(await this.connectionUsable(tenantId, rows[0]),
                { tenantId, channelType: 'whatsapp', requestedAccountId: phoneNumberId });
            return rows[0];
        }

        // Nothing named. Two rows are enough to know the question has no answer,
        // so `LIMIT 2` — a count over every number of a large tenant buys nothing.
        // Rows without a phone_number_id cannot send at all (onboarding leaves
        // them while the number is still pending), so they neither answer this
        // request nor make it ambiguous.
        // Only rows that may send are candidates. A disconnected sibling is
        // not one, so a tenant with one live number and one disconnected one
        // resolves instead of being refused as ambiguous — and a tenant whose
        // only number is disconnected is told exactly that below.
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT ${columns} FROM whatsapp_channels
              WHERE phone_number_id IS NOT NULL AND phone_number_id <> ''
                AND ${sendableChannelSql()}
              ORDER BY connected_at ASC NULLS LAST LIMIT 2`,
        );
        if (!rows?.length) {
            // Tell the two cases apart: nothing was ever connected, versus
            // something is there and is not connected right now.
            const [any] = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT channel_status FROM whatsapp_channels
                  WHERE phone_number_id IS NOT NULL AND phone_number_id <> '' LIMIT 1`,
            );
            if (any) {
                throw new ConnectionRefusedError('connection_disconnected', {
                    tenantId, channelType: 'whatsapp',
                    detail: `channel_status=${any.channel_status ?? 'unset'}`,
                });
            }
            throw new ConnectionRefusedError('connection_absent', { tenantId, channelType: 'whatsapp' });
        }
        if (rows.length > 1) {
            this.logger.warn(`WhatsApp connection not named for tenant ${tenantId}, which has more than one; `
                + 'refusing rather than choosing which account pays');
            throw new ConnectionRefusedError('connection_ambiguous', { tenantId, channelType: 'whatsapp' });
        }
        // The sole survivor still has to clear the GLOBAL account row, which
        // the disconnect endpoint deactivates and the tenant schema does not
        // know about.
        assertUsable(await this.connectionUsable(tenantId, rows[0]),
            { tenantId, channelType: 'whatsapp', requestedAccountId: String(rows[0].phone_number_id) });
        return rows[0];
    }

    /**
     * The three authorities, asked together.
     *
     * The tenant's channel row says whether the connection is live; the
     * global `channel_accounts` row says whether the tenant switched it off.
     * Disconnect writes the second and used to leave the first untouched, so
     * asking only one of them was how a disconnected number kept sending.
     */
    private async connectionUsable(tenantId: string, channel: any) {
        const phoneNumberId = String(channel?.phone_number_id ?? '');
        let accountActive: boolean | undefined;
        try {
            const account = await this.prisma.channelAccount.findFirst({
                where: { tenantId, channelType: 'whatsapp', accountId: phoneNumberId },
                select: { isActive: true },
            });
            // No global row is not the same as an inactive one: a tenant
            // provisioned before that table was populated has none, and
            // reading absence as `false` would disconnect them all at once.
            accountActive = account ? account.isActive !== false : undefined;
        } catch (error: any) {
            this.logger.warn(`channel_accounts unreadable for ${tenantId}/${phoneNumberId}: ${error?.message}`);
        }
        return assessConnection({ channelStatus: channel?.channel_status, accountActive });
    }

    private async credentialForWhatsApp(tenantId: string, channel: any): Promise<CachedWhatsAppConnection> {
        const base = {
            phoneNumberId: String(channel.phone_number_id),
            wabaId: channel.meta_waba_id,
            businessId: channel.meta_business_id ?? null,
            displayPhoneNumber: channel.display_phone_number ?? null,
            channelId: channel.id,
        };

        const cred = await this.prisma.whatsappCredential.findFirst({
            where: { tenantId, credentialType: 'system_user_token' },
            orderBy: { createdAt: 'desc' },
        });

        if (cred?.encryptedValue) {
            // Revoked on disconnect, mid-rotation, or past its own expiry.
            // None of those may sign a request, and falling through to the
            // channel row would present a DIFFERENT secret than the one the
            // tenant last authorised — the substitution this file exists to
            // refuse, wearing a different hat.
            assertUsable(assessCredential(cred), {
                tenantId, channelType: 'whatsapp', requestedAccountId: base.phoneNumberId,
            });
            let accessToken: string;
            try {
                accessToken = this.cryptoService.decryptToken(cred.encryptedValue);
            } catch (e: any) {
                throw new ConnectionRefusedError('credential_undecryptable', {
                    tenantId, channelType: 'whatsapp',
                    requestedAccountId: base.phoneNumberId, detail: e?.message,
                });
            }
            return { ...base, accessToken, credentialId: cred.id, credentialSource: 'system_user' };
        }

        if (channel.access_token_ref && channel.access_token_ref !== 'credential_ref') {
            // A token stored on the channel row itself: the credential's identity
            // is that row, so a swap between numbers is visible in the record.
            return {
                ...base, accessToken: String(channel.access_token_ref),
                credentialId: String(channel.id), credentialSource: 'channel_account',
            };
        }

        throw new ConnectionRefusedError('credential_missing',
            { tenantId, channelType: 'whatsapp', requestedAccountId: base.phoneNumberId });
    }

    private async readWhatsAppCache(
        tenantId: string, phoneNumberId: string,
    ): Promise<CachedWhatsAppConnection | null> {
        const key = `wa_token:${tenantId}:${phoneNumberId}`;
        const cached = await this.redis.getJson<CachedWhatsAppConnection>(key);
        if (!cached) return null;
        // An entry written before the account travelled inside the value cannot
        // be checked, so it is not used.
        if (!cached.credentialId || !cached.accessToken) { await this.redis.del(key); return null; }
        if (cached.phoneNumberId !== phoneNumberId) {
            this.logger.error(`Cached WhatsApp credentials under ${key} belong to `
                + `${cached.phoneNumberId}; discarding rather than answering with another number`);
            await this.redis.del(key);
            return null;
        }
        return cached;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Every other channel
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Credentials for one of a tenant's connections of any type.
     *
     * `accountId` names the connection. Resolution PREFERS the per-account token
     * on the `channel_accounts` row (the connect flow writes the real encrypted
     * token there); legacy rows hold an `encrypted_ref` placeholder and fall back
     * to the shared per-tenant credential — a fallback about WHICH SECRET to
     * present for this account, never about which account to use.
     */
    async getChannelToken(
        tenantId: string, channelType: string, accountId?: string,
    ): Promise<GenericChannelCredentials> {
        const resolved = await this.resolveGeneric(tenantId, channelType, accountId);
        return { accessToken: resolved.accessToken, accountId: resolved.accountId, channelType };
    }

    private async resolveGeneric(
        tenantId: string, channelType: string, accountId?: string | null,
    ): Promise<CachedGenericConnection> {
        if (channelType === 'web_widget') {
            return {
                accessToken: '', accountId: normalizeAccountId(accountId) || 'widget', channelType,
                credentialId: 'widget', credentialSource: 'tenant_credential',
            };
        }
        if (channelType === 'whatsapp') {
            const wa = await this.resolveWhatsApp(tenantId, accountId);
            return {
                accessToken: wa.accessToken, accountId: wa.phoneNumberId, channelType,
                credentialId: wa.credentialId, credentialSource: wa.credentialSource,
            };
        }

        const requested = normalizeAccountId(accountId);
        if (requested) {
            const cached = await this.readGenericCache(tenantId, channelType, requested);
            if (cached) return cached;
        }

        const account = await this.findChannelAccount(tenantId, channelType, requested);
        if (!requested) {
            const cached = await this.readGenericCache(tenantId, channelType, account.accountId);
            if (cached) return cached;
        }

        const resolved = await this.credentialForAccount(tenantId, channelType, account);
        await this.writeCache(`${channelType}_token:${tenantId}:${resolved.accountId}`,
            channelType, tenantId, resolved.accountId, resolved);
        return resolved;
    }

    private async findChannelAccount(
        tenantId: string, channelType: string, accountId: string | null,
    ): Promise<{ id: string; accountId: string; accessToken: string }> {
        const select = { id: true, accountId: true, accessToken: true };
        if (accountId) {
            const account = await this.prisma.channelAccount.findFirst({
                where: { tenantId, channelType, accountId, isActive: true }, select,
            });
            if (!account) {
                throw new ConnectionRefusedError('connection_not_found',
                    { tenantId, channelType, requestedAccountId: accountId });
            }
            return account;
        }

        // Oldest first, and two of them is already the answer. Without an
        // `orderBy` PostgreSQL returns physical order, which changes every time a
        // row is rewritten — so "the first active account" alternated between
        // calls on a two-account tenant. That non-determinism is now moot: two
        // accounts is a refusal either way.
        const accounts = await this.prisma.channelAccount.findMany({
            where: { tenantId, channelType, isActive: true }, select,
            orderBy: { createdAt: 'asc' }, take: 2,
        });
        if (!accounts.length) {
            throw new ConnectionRefusedError('connection_absent', { tenantId, channelType });
        }
        if (accounts.length > 1) {
            this.logger.warn(`${channelType} connection not named for tenant ${tenantId}, which has more `
                + 'than one; refusing rather than choosing which account sends');
            throw new ConnectionRefusedError('connection_ambiguous', { tenantId, channelType });
        }
        return accounts[0];
    }

    private async credentialForAccount(
        tenantId: string, channelType: string,
        account: { id: string; accountId: string; accessToken: string },
    ): Promise<CachedGenericConnection> {
        const placeholder = !account.accessToken
            || account.accessToken === 'encrypted_ref' || account.accessToken === 'credential_ref';

        if (!placeholder) {
            try {
                return {
                    accessToken: this.cryptoService.decryptToken(account.accessToken),
                    accountId: account.accountId, channelType,
                    credentialId: account.id, credentialSource: 'channel_account',
                };
            } catch (e: any) {
                this.logger.error(`Failed to decrypt per-account ${channelType} token for tenant ${tenantId}`);
                throw new ConnectionRefusedError('credential_undecryptable', {
                    tenantId, channelType, requestedAccountId: account.accountId, detail: e?.message,
                });
            }
        }

        // The shared per-tenant credential is one row with no account on it, so
        // it can only be attributed to an account while the tenant has one. With
        // two, the daily Instagram refresh writes whichever account ran last into
        // that row, and handing it to the other one presents a credential that is
        // not its own — the same substitution as picking the wrong connection,
        // one layer down and invisible in the returned account id.
        //
        // WhatsApp is the deliberate exception and takes a different path: its
        // system_user_token really is tenant-wide under the Tech Provider model,
        // and it is recorded as `system_user` so the sharing is visible.
        const siblings = await this.prisma.channelAccount.count({
            where: { tenantId, channelType, isActive: true },
        });
        if (siblings > 1) {
            throw new ConnectionRefusedError('credential_missing', {
                tenantId, channelType, requestedAccountId: account.accountId,
                detail: 'this connection has no credential of its own and the tenant\'s shared one '
                    + 'cannot be attributed to any single account; reconnect this account',
            });
        }

        const credType = `${channelType}_token`; // instagram_token, messenger_token, ...
        const cred = await this.prisma.whatsappCredential.findFirst({
            where: { tenantId, credentialType: credType },
            orderBy: { createdAt: 'desc' },
        });
        if (!cred?.encryptedValue) {
            throw new ConnectionRefusedError('credential_missing',
                { tenantId, channelType, requestedAccountId: account.accountId });
        }
        try {
            return {
                accessToken: this.cryptoService.decryptToken(cred.encryptedValue),
                accountId: account.accountId, channelType,
                credentialId: cred.id, credentialSource: 'tenant_credential',
            };
        } catch (e: any) {
            this.logger.error(`Failed to decrypt ${channelType} token for tenant ${tenantId}`);
            throw new ConnectionRefusedError('credential_undecryptable', {
                tenantId, channelType, requestedAccountId: account.accountId, detail: e?.message,
            });
        }
    }

    private async readGenericCache(
        tenantId: string, channelType: string, accountId: string,
    ): Promise<CachedGenericConnection | null> {
        const key = `${channelType}_token:${tenantId}:${accountId}`;
        const cached = await this.redis.getJson<CachedGenericConnection>(key);
        if (!cached) return null;
        if (!cached.credentialId) { await this.redis.del(key); return null; }
        if (cached.accountId !== accountId) {
            this.logger.error(`Cached ${channelType} credentials under ${key} belong to `
                + `${cached.accountId}; discarding rather than answering with another account`);
            await this.redis.del(key);
            return null;
        }
        return cached;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The context that travels with the effect
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * The connection, the account that will be billed and the credential, as one
     * immutable record — the thing a retry compares itself against.
     *
     * Handing a bare token to a transport loses the only facts that make an
     * outbound effect legitimate after 1 October: which number it goes out from
     * and whose WhatsApp Business Account pays for it. `sameSendContext` can then
     * say, field by field, that a retry stayed on the same connection.
     *
     * `payer.kind` is `unknown` here even when the WABA id is known, and that is
     * not caution for its own sake: knowing WHICH account Meta bills is a
     * different fact from knowing HOW it is funded. `business_direct` is a claim
     * about somebody's card, and nothing in this resolver has asked Meta. The
     * funding probe answers that separately, and until it does, `unknown` keeps
     * the exposure where the contract says it belongs.
     */
    async resolveSendContext(request: SendContextRequest): Promise<ResolvedConnection> {
        const { tenantId, channelType, recipient } = request;
        if (channelType === 'whatsapp') {
            const wa = await this.resolveWhatsApp(tenantId, request.channelAccountId);
            return {
                accessToken: wa.accessToken,
                context: {
                    version: OUTBOUND_CONTRACT_VERSION,
                    tenantId, channelType,
                    channelAccountId: wa.phoneNumberId,
                    channelAddress: wa.displayPhoneNumber,
                    payer: { kind: 'unknown', wabaId: wa.wabaId ?? null, businessId: wa.businessId },
                    credential: { id: wa.credentialId, source: wa.credentialSource },
                    recipient,
                },
            };
        }

        const resolved = await this.resolveGeneric(tenantId, channelType, request.channelAccountId);
        return {
            accessToken: resolved.accessToken,
            context: {
                version: OUTBOUND_CONTRACT_VERSION,
                tenantId, channelType,
                channelAccountId: resolved.accountId,
                channelAddress: null,
                // No provider bills these per message today, so there is no payer
                // to name. `unknown` says that; it does not claim the send is free.
                payer: { kind: 'unknown', wabaId: null, businessId: null },
                credential: { id: resolved.credentialId, source: resolved.credentialSource },
                recipient,
            },
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cache maintenance
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Every cache write also records that the account has one, so that clearing
     * a channel without naming an account can clear them all.
     *
     * The index is a small per-tenant set rather than a `SCAN` of the keyspace:
     * a disconnect is rare and a scan is O(keyspace), which on the shared Redis
     * this platform runs is a cost paid by everything else at once.
     */
    private async writeCache(
        key: string, channelType: string, tenantId: string, accountId: string, value: unknown,
    ): Promise<void> {
        await this.redis.setJson(key, value, this.CACHE_TTL);
        const index = cacheIndexKey(channelType, tenantId);
        const client = this.redis.getClient();
        await client.sadd(index, accountId);
        await client.expire(index, this.CACHE_TTL);
    }

    /**
     * Drop cached credentials for a channel of a tenant.
     *
     * Naming the account clears that account. NOT naming it clears every account
     * of that channel — which is what a disconnect means, and what it did not do
     * before: it cleared a tenant-wide key that no longer exists and left each
     * account's own entry answering, by name, with a revoked token for the rest
     * of its five minutes.
     */
    async invalidateCache(channelType: string, tenantId: string, accountId?: string): Promise<void> {
        const prefixes = channelType === 'whatsapp' ? ['wa_token', `${channelType}_token`] : [`${channelType}_token`];
        const named = normalizeAccountId(accountId);
        const client = this.redis.getClient();

        // Written by the version of this service that keyed by tenant alone.
        // Nothing reads them any more; they are removed so nothing ever can.
        for (const prefix of prefixes) await this.redis.del(`${prefix}:${tenantId}`);

        const accounts = named
            ? [named]
            : await client.smembers(cacheIndexKey(channelType, tenantId)).catch(() => [] as string[]);
        for (const account of accounts) {
            for (const prefix of prefixes) await this.redis.del(`${prefix}:${tenantId}:${account}`);
        }
        if (!named) await this.redis.del(cacheIndexKey(channelType, tenantId));
        else await client.srem(cacheIndexKey(channelType, tenantId), named).catch(() => 0);
    }
}

/** The index of which accounts of a tenant currently have a cached credential. */
function cacheIndexKey(channelType: string, tenantId: string): string {
    return `${channelType}_token_accounts:${tenantId}`;
}

/**
 * An account id, or nothing.
 *
 * `''` reaches this resolver from producers that build an outbound message with
 * no connection bound — the field is typed as a required `string`, so `tsc`
 * never saw it. An empty string is not a connection, and it is not a request for
 * a particular one either, so it is treated exactly like an omission: resolved
 * on a single-connection tenant, refused as ambiguous on any other. Refusing it
 * outright would break single-connection tenants where those producers are, in
 * fact, correct today.
 */
function normalizeAccountId(accountId?: string | null): string | null {
    const trimmed = typeof accountId === 'string' ? accountId.trim() : '';
    return trimmed.length ? trimmed : null;
}
