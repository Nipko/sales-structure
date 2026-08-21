import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENVELOPE_PREFIX = 'tsc';
const ENVELOPE_VERSION = 'v1';
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const MAX_SECRET_BYTES = 16 * 1024;
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME_RE = /^[a-z0-9_]{1,40}$/;

/**
 * De qué integración es el secreto. Es parte del AAD, así que una credencial
 * no se puede mover de scope sin que la autenticación falle.
 */
export type TenantSecretScope = 'channel_manager' | 'vertical_integration';

export interface TenantSecretContext {
    tenantId: string;
    scope: TenantSecretScope;
    /** `hostaway`, `toast`, `cliniko`… */
    provider: string;
    /** `api_key`, `api_secret`, `client_secret`, `password`… */
    field: string;
}

export interface TenantSecretReadResult {
    plaintext: string;
    keyId?: string;
    format: 'v1' | 'plaintext';
    /** True cuando el llamador debe volver a guardar el valor ya cifrado. */
    needsRewrap: boolean;
}

/** Falla estable y deliberadamente muda: nunca el valor, el cifrado ni la causa. */
export class TenantSecretCryptoError extends Error {
    constructor(public readonly code: string) {
        super(code);
        this.name = 'TenantSecretCryptoError';
    }
}

/**
 * Sobre cifrado para credenciales de integración guardadas en `tenant.settings`.
 *
 * Las claves de Channel Manager (Hostaway, Guesty) y de las integraciones
 * verticales (Toast, Mindbody, Cliniko) vivían **en claro** en un JSONB, y el
 * endpoint genérico del tenant las devolvía tal cual: cualquier lectura de
 * `GET /tenants/:id`, cualquier backup y cualquier volcado de la base las
 * entregaba enteras. La UI las enmascaraba con `***` en su propio endpoint, que
 * es exactamente la clase de protección que se ve pero no existe.
 *
 * Es hermano del sobre de pagos (`TenantPaymentCredentialCryptoService`) y no
 * el mismo a propósito: comparte la mecánica —AES-256-GCM, keyring con
 * rotación, AAD que ata el valor a su contexto— y NO comparte el espacio de
 * nombres, para que una credencial de un dominio no pueda descifrarse en el
 * otro aunque alguien copie la fila.
 *
 * Variables de entorno:
 * - `TENANT_SECRET_KEY`: clave actual, 64 hex (cae a `ENCRYPTION_KEY` durante
 *   el despliegue inicial).
 * - `TENANT_SECRET_KEY_ID`: id no secreto de la clave actual (default `primary`).
 * - `TENANT_SECRET_PREVIOUS_KEYS`: JSON `{keyId: 64-hex}` para rotar.
 */
@Injectable()
export class TenantSecretCryptoService {
    private keyring?: { currentKeyId: string; keys: ReadonlyMap<string, Buffer> };

    /**
     * El material de clave se carga tarde: registrar el proveedor no puede
     * tumbar el arranque de una instancia que nunca cifra nada. La primera
     * lectura o escritura real sí falla cerrado.
     */
    private getKeyring(): { currentKeyId: string; keys: ReadonlyMap<string, Buffer> } {
        if (this.keyring) return this.keyring;
        const currentKeyId = this.readKeyId(process.env.TENANT_SECRET_KEY_ID || 'primary');
        const currentKey = this.readKey(
            process.env.TENANT_SECRET_KEY || process.env.ENCRYPTION_KEY,
            'tenant_secret_key_invalid',
        );
        const keys = new Map<string, Buffer>([[currentKeyId, currentKey]]);
        for (const [keyId, key] of this.readPreviousKeys(process.env.TENANT_SECRET_PREVIOUS_KEYS)) {
            const existing = keys.get(keyId);
            if (existing && !existing.equals(key)) {
                throw new TenantSecretCryptoError('tenant_secret_key_id_conflict');
            }
            keys.set(keyId, key);
        }
        this.keyring = { currentKeyId, keys };
        return this.keyring;
    }

    encrypt(plaintext: string, context: TenantSecretContext): string {
        this.assertPlaintext(plaintext);
        const normalized = this.normalizeContext(context);
        const { currentKeyId, keys } = this.getKeyring();
        const iv = randomBytes(AES_GCM_IV_BYTES);
        const cipher = createCipheriv('aes-256-gcm', keys.get(currentKeyId)!, iv, {
            authTagLength: AES_GCM_TAG_BYTES,
        });
        cipher.setAAD(this.aad(normalized, currentKeyId));
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        return [
            ENVELOPE_PREFIX,
            ENVELOPE_VERSION,
            currentKeyId,
            iv.toString('base64url'),
            cipher.getAuthTag().toString('base64url'),
            encrypted.toString('base64url'),
        ].join(':');
    }

    decrypt(envelope: string, context: TenantSecretContext): string {
        return this.read(envelope, context).plaintext;
    }

    read(envelope: string, context: TenantSecretContext): TenantSecretReadResult {
        const normalized = this.normalizeContext(context);
        const parsed = this.parseEnvelope(envelope);
        const { currentKeyId, keys } = this.getKeyring();
        const key = keys.get(parsed.keyId);
        if (!key) throw new TenantSecretCryptoError('tenant_secret_unknown_key_id');
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
                format: 'v1',
                needsRewrap: parsed.keyId !== currentKeyId,
            };
        } catch (error) {
            if (error instanceof TenantSecretCryptoError) throw error;
            throw new TenantSecretCryptoError('tenant_secret_decryption_failed');
        }
    }

    /**
     * Puente de migración para lo que HOY está en claro en la base.
     *
     * A diferencia del sobre de pagos —que rechaza cualquier valor que no sea
     * un sobre—, acá hay que poder leer texto plano: es lo que está guardado.
     * Se acepta sólo por esta puerta, se devuelve marcado como tal y con
     * `needsRewrap`, para que el llamador lo vuelva a guardar cifrado en el
     * mismo camino. Cuando no quede nada en claro, esta función se borra.
     */
    readCompatible(value: unknown, context: TenantSecretContext): TenantSecretReadResult {
        this.normalizeContext(context);
        if (typeof value === 'string' && value.startsWith(`${ENVELOPE_PREFIX}:`)) {
            return this.read(value, context);
        }
        if (typeof value !== 'string') {
            throw new TenantSecretCryptoError('tenant_secret_plaintext_invalid');
        }
        this.assertPlaintext(value);
        // Leer texto plano NO exige clave, a propósito: no hay nada que
        // descifrar. Exigirla acá habría roto todas las integraciones ya
        // conectadas de una instancia con la variable mal puesta, sin ganar
        // nada —el valor ya era legible sin clave, que es justamente el
        // problema que este sobre viene a cerrar—. Lo que sí necesita clave es
        // volver a guardarlo cifrado, y eso lo intenta el llamador aparte.
        return { plaintext: value, format: 'plaintext', needsRewrap: true };
    }

    /** True cuando el valor ya está cifrado con este sobre. */
    isEnvelope(value: unknown): boolean {
        return typeof value === 'string' && value.startsWith(`${ENVELOPE_PREFIX}:${ENVELOPE_VERSION}:`);
    }

    private parseEnvelope(value: string): {
        keyId: string; iv: Buffer; tag: Buffer; ciphertext: Buffer;
    } {
        if (typeof value !== 'string' || value.length > MAX_SECRET_BYTES * 2) {
            throw new TenantSecretCryptoError('tenant_secret_envelope_invalid');
        }
        const parts = value.split(':');
        if (parts.length !== 6
            || parts[0] !== ENVELOPE_PREFIX
            || parts[1] !== ENVELOPE_VERSION
            || !KEY_ID_RE.test(parts[2])) {
            throw new TenantSecretCryptoError('tenant_secret_envelope_invalid');
        }
        const iv = this.decodeBase64Url(parts[3]);
        const tag = this.decodeBase64Url(parts[4]);
        const ciphertext = this.decodeBase64Url(parts[5]);
        if (iv.length !== AES_GCM_IV_BYTES
            || tag.length !== AES_GCM_TAG_BYTES
            || ciphertext.length < 1
            || ciphertext.length > MAX_SECRET_BYTES) {
            throw new TenantSecretCryptoError('tenant_secret_envelope_invalid');
        }
        return { keyId: parts[2], iv, tag, ciphertext };
    }

    private decodeBase64Url(value: string): Buffer {
        if (!/^[A-Za-z0-9_-]+$/.test(value)) {
            throw new TenantSecretCryptoError('tenant_secret_envelope_invalid');
        }
        const decoded = Buffer.from(value, 'base64url');
        if (decoded.toString('base64url') !== value) {
            throw new TenantSecretCryptoError('tenant_secret_envelope_invalid');
        }
        return decoded;
    }

    private normalizeContext(context: TenantSecretContext): TenantSecretContext {
        const tenantId = String(context?.tenantId || '').trim().toLowerCase();
        const provider = String(context?.provider || '').trim().toLowerCase();
        const field = String(context?.field || '').trim().toLowerCase();
        if (!UUID_RE.test(tenantId)
            || !['channel_manager', 'vertical_integration'].includes(context?.scope)
            || !NAME_RE.test(provider)
            || !NAME_RE.test(field)) {
            throw new TenantSecretCryptoError('tenant_secret_context_invalid');
        }
        return { tenantId, scope: context.scope, provider, field };
    }

    private aad(context: TenantSecretContext, keyId: string): Buffer {
        return Buffer.from(JSON.stringify([
            ENVELOPE_PREFIX,
            ENVELOPE_VERSION,
            keyId,
            context.tenantId,
            context.scope,
            context.provider,
            context.field,
        ]), 'utf8');
    }

    private assertPlaintext(value: string): void {
        const size = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
        if (size < 1 || size > MAX_SECRET_BYTES) {
            throw new TenantSecretCryptoError('tenant_secret_plaintext_invalid');
        }
    }

    private readKeyId(value: string): string {
        if (!KEY_ID_RE.test(value)) throw new TenantSecretCryptoError('tenant_secret_key_id_invalid');
        return value;
    }

    private readKey(value: string | undefined, code: string): Buffer {
        if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new TenantSecretCryptoError(code);
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
                this.readKey(
                    typeof value === 'string' ? value : undefined,
                    'tenant_secret_previous_key_invalid',
                ),
            ]));
        } catch (error) {
            if (error instanceof TenantSecretCryptoError) throw error;
            throw new TenantSecretCryptoError('tenant_secret_previous_keys_invalid');
        }
    }
}
