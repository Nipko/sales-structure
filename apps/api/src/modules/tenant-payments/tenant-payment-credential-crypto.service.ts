import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { TenantPaymentProvider } from './tenant-payment-reference';

const ENVELOPE_PREFIX = 'tpc';
const ENVELOPE_VERSION = 'v2';
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const MAX_SECRET_BYTES = 16 * 1024;
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantPaymentCredentialEnvironment = 'sandbox' | 'production';

export type TenantPaymentCredentialField =
    | 'access_token'
    | 'webhook_secret'
    | 'private_key'
    | 'events_secret'
    | 'callback_token';

export interface TenantPaymentCredentialContext {
    tenantId: string;
    provider: TenantPaymentProvider;
    environment: TenantPaymentCredentialEnvironment;
    field: TenantPaymentCredentialField;
}

export interface TenantPaymentCredentialReadResult {
    plaintext: string;
    keyId?: string;
    format: 'v2' | 'legacy-v1';
    /** True when the caller must persist a fresh v2 envelope after this read. */
    needsRewrap: boolean;
}

/**
 * Stable, deliberately non-sensitive failures for credential callers and logs.
 * Never attach the plaintext, ciphertext, provider response or crypto cause.
 */
export class TenantPaymentCredentialCryptoError extends Error {
    constructor(public readonly code: string) {
        super(code);
        this.name = 'TenantPaymentCredentialCryptoError';
    }
}

/**
 * Payment credentials use a dedicated, context-bound envelope instead of the
 * legacy channel-token helper. AES-GCM authenticates both the ciphertext and
 * tenant/provider/environment/field AAD, so copying a valid value to another
 * tenant or secret slot cannot silently redirect money.
 *
 * Keyring environment variables:
 * - TENANT_PAYMENT_CREDENTIAL_KEY: current 32-byte key as exactly 64 hex chars
 *   (falls back to ENCRYPTION_KEY during the initial rollout).
 * - TENANT_PAYMENT_CREDENTIAL_KEY_ID: non-secret current key id (default primary).
 * - TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS: JSON object of keyId -> 64-hex key.
 *
 * Legacy reads are intentionally opt-in through readCompatible(). That method
 * accepts only the former iv:tag:ciphertext AES-GCM shape and tells the caller
 * to rewrap immediately; it never accepts plaintext/base64 fallbacks.
 */
@Injectable()
export class TenantPaymentCredentialCryptoService {
    private keyring?: {
        currentKeyId: string;
        keys: ReadonlyMap<string, Buffer>;
    };

    /**
     * Key material is loaded lazily. Registering this provider must not make a
     * development/test application fail at boot when it never uses tenant
     * payments; the first credential read/write still fails closed.
     */
    private getKeyring(): { currentKeyId: string; keys: ReadonlyMap<string, Buffer> } {
        if (this.keyring) return this.keyring;
        const currentKeyId = this.readKeyId(
            process.env.TENANT_PAYMENT_CREDENTIAL_KEY_ID || 'primary',
        );
        const currentKey = this.readKey(
            process.env.TENANT_PAYMENT_CREDENTIAL_KEY || process.env.ENCRYPTION_KEY,
            'tenant_payment_crypto_key_invalid',
        );
        const keys = new Map<string, Buffer>([[currentKeyId, currentKey]]);
        const previous = this.readPreviousKeys(process.env.TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS);
        for (const [keyId, key] of previous) {
            const existing = keys.get(keyId);
            if (existing && !existing.equals(key)) {
                throw new TenantPaymentCredentialCryptoError('tenant_payment_crypto_key_id_conflict');
            }
            keys.set(keyId, key);
        }
        this.keyring = { currentKeyId, keys };
        return this.keyring;
    }

    encrypt(plaintext: string, context: TenantPaymentCredentialContext): string {
        this.assertPlaintext(plaintext);
        const normalized = this.normalizeContext(context);
        const { currentKeyId, keys } = this.getKeyring();
        const key = keys.get(currentKeyId)!;
        const iv = randomBytes(AES_GCM_IV_BYTES);
        const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AES_GCM_TAG_BYTES });
        cipher.setAAD(this.aad(normalized, currentKeyId));
        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        return [
            ENVELOPE_PREFIX,
            ENVELOPE_VERSION,
            currentKeyId,
            iv.toString('base64url'),
            tag.toString('base64url'),
            encrypted.toString('base64url'),
        ].join(':');
    }

    decrypt(envelope: string, context: TenantPaymentCredentialContext): string {
        return this.read(envelope, context).plaintext;
    }

    read(
        envelope: string,
        context: TenantPaymentCredentialContext,
    ): TenantPaymentCredentialReadResult {
        const normalized = this.normalizeContext(context);
        const parsed = this.parseV2Envelope(envelope);
        const { currentKeyId, keys } = this.getKeyring();
        const key = keys.get(parsed.keyId);
        if (!key) {
            throw new TenantPaymentCredentialCryptoError('tenant_payment_crypto_unknown_key_id');
        }
        try {
            const decipher = createDecipheriv('aes-256-gcm', key, parsed.iv, {
                authTagLength: AES_GCM_TAG_BYTES,
            });
            decipher.setAAD(this.aad(normalized, parsed.keyId));
            decipher.setAuthTag(parsed.tag);
            const plaintext = Buffer.concat([
                decipher.update(parsed.ciphertext),
                decipher.final(),
            ]).toString('utf8');
            this.assertPlaintext(plaintext);
            return {
                plaintext,
                keyId: parsed.keyId,
                format: 'v2',
                needsRewrap: parsed.keyId !== currentKeyId,
            };
        } catch (error) {
            if (error instanceof TenantPaymentCredentialCryptoError) throw error;
            throw new TenantPaymentCredentialCryptoError('tenant_payment_credential_decryption_failed');
        }
    }

    /**
     * Explicit migration bridge for existing production AES-GCM values.
     * Callers must immediately persist encrypt(result.plaintext, context) when
     * needsRewrap is true. The callback should exist only during migration.
     */
    readCompatible(
        value: string,
        context: TenantPaymentCredentialContext,
        legacyDecrypt?: (legacyCiphertext: string) => string,
    ): TenantPaymentCredentialReadResult {
        // Require a usable current key before invoking a context-free legacy
        // decryptor; otherwise the caller could read but not immediately rewrap.
        this.getKeyring();
        this.normalizeContext(context);
        if (typeof value === 'string' && value.startsWith(`${ENVELOPE_PREFIX}:`)) {
            return this.read(value, context);
        }
        if (!legacyDecrypt || !this.isStrictLegacyEnvelope(value)) {
            throw new TenantPaymentCredentialCryptoError('tenant_payment_legacy_credential_not_allowed');
        }
        try {
            const plaintext = legacyDecrypt(value);
            this.assertPlaintext(plaintext);
            return {
                plaintext,
                format: 'legacy-v1',
                needsRewrap: true,
            };
        } catch (error) {
            if (error instanceof TenantPaymentCredentialCryptoError) throw error;
            throw new TenantPaymentCredentialCryptoError('tenant_payment_credential_decryption_failed');
        }
    }

    private parseV2Envelope(value: string): {
        keyId: string;
        iv: Buffer;
        tag: Buffer;
        ciphertext: Buffer;
    } {
        if (typeof value !== 'string' || value.length > MAX_SECRET_BYTES * 2) {
            throw new TenantPaymentCredentialCryptoError('tenant_payment_credential_envelope_invalid');
        }
        const parts = value.split(':');
        if (parts.length !== 6
            || parts[0] !== ENVELOPE_PREFIX
            || parts[1] !== ENVELOPE_VERSION
            || !KEY_ID_RE.test(parts[2])) {
            throw new TenantPaymentCredentialCryptoError('tenant_payment_credential_envelope_invalid');
        }
        const iv = this.decodeBase64Url(parts[3]);
        const tag = this.decodeBase64Url(parts[4]);
        const ciphertext = this.decodeBase64Url(parts[5]);
        if (iv.length !== AES_GCM_IV_BYTES
            || tag.length !== AES_GCM_TAG_BYTES
            || ciphertext.length < 1
            || ciphertext.length > MAX_SECRET_BYTES) {
            throw new TenantPaymentCredentialCryptoError('tenant_payment_credential_envelope_invalid');
        }
        return { keyId: parts[2], iv, tag, ciphertext };
    }

    private decodeBase64Url(value: string): Buffer {
        if (!/^[A-Za-z0-9_-]+$/.test(value)) {
            throw new TenantPaymentCredentialCryptoError('tenant_payment_credential_envelope_invalid');
        }
        const decoded = Buffer.from(value, 'base64url');
        if (decoded.toString('base64url') !== value) {
            throw new TenantPaymentCredentialCryptoError('tenant_payment_credential_envelope_invalid');
        }
        return decoded;
    }

    private normalizeContext(context: TenantPaymentCredentialContext): TenantPaymentCredentialContext {
        const tenantId = String(context?.tenantId || '').trim().toLowerCase();
        const provider = context?.provider;
        const environment = context?.environment;
        const field = context?.field;
        const allowedField = provider === 'mercadopago'
            ? ['access_token', 'webhook_secret'].includes(field)
            : provider === 'wompi'
                ? ['private_key', 'events_secret', 'callback_token'].includes(field)
                : false;
        if (!UUID_RE.test(tenantId)
            || !['mercadopago', 'wompi'].includes(provider)
            || !['sandbox', 'production'].includes(environment)
            || !allowedField) {
            throw new TenantPaymentCredentialCryptoError('tenant_payment_credential_context_invalid');
        }
        return { tenantId, provider, environment, field };
    }

    private aad(context: TenantPaymentCredentialContext, keyId: string): Buffer {
        return Buffer.from(JSON.stringify([
            ENVELOPE_PREFIX,
            ENVELOPE_VERSION,
            keyId,
            context.tenantId,
            context.provider,
            context.environment,
            context.field,
        ]), 'utf8');
    }

    private assertPlaintext(value: string): void {
        const size = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
        if (size < 1 || size > MAX_SECRET_BYTES) {
            throw new TenantPaymentCredentialCryptoError('tenant_payment_credential_plaintext_invalid');
        }
    }

    private readKeyId(value: string): string {
        if (!KEY_ID_RE.test(value)) {
            throw new TenantPaymentCredentialCryptoError('tenant_payment_crypto_key_id_invalid');
        }
        return value;
    }

    private readKey(value: string | undefined, code: string): Buffer {
        if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
            throw new TenantPaymentCredentialCryptoError(code);
        }
        return Buffer.from(value, 'hex');
    }

    private readPreviousKeys(raw: string | undefined): Map<string, Buffer> {
        if (!raw) return new Map();
        try {
            const parsed: unknown = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
            const entries = Object.entries(parsed as Record<string, unknown>);
            if (entries.length > 8) throw new Error('too_many_keys');
            return new Map(entries.map(([keyId, value]) => [
                this.readKeyId(keyId),
                this.readKey(typeof value === 'string' ? value : undefined, 'tenant_payment_crypto_previous_key_invalid'),
            ]));
        } catch (error) {
            if (error instanceof TenantPaymentCredentialCryptoError) throw error;
            throw new TenantPaymentCredentialCryptoError('tenant_payment_crypto_previous_keys_invalid');
        }
    }

    private isStrictLegacyEnvelope(value: string): boolean {
        return typeof value === 'string'
            && /^[a-f0-9]{32}:[a-f0-9]{32}:(?:[a-f0-9]{2})+$/i.test(value)
            && value.length <= MAX_SECRET_BYTES * 2;
    }
}
