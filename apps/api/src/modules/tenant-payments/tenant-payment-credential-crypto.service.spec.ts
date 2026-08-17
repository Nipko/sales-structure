import {
    TenantPaymentCredentialCryptoError,
    TenantPaymentCredentialCryptoService,
    type TenantPaymentCredentialContext,
} from './tenant-payment-credential-crypto.service';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const KEY_A = '11'.repeat(32);
const KEY_B = '22'.repeat(32);

const CONTEXT: TenantPaymentCredentialContext = {
    tenantId: TENANT_A,
    provider: 'wompi',
    environment: 'production',
    field: 'private_key',
};

describe('TenantPaymentCredentialCryptoService', () => {
    const original = {
        key: process.env.TENANT_PAYMENT_CREDENTIAL_KEY,
        keyId: process.env.TENANT_PAYMENT_CREDENTIAL_KEY_ID,
        previous: process.env.TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS,
        legacyKey: process.env.ENCRYPTION_KEY,
    };

    beforeEach(() => {
        process.env.TENANT_PAYMENT_CREDENTIAL_KEY = KEY_A;
        process.env.TENANT_PAYMENT_CREDENTIAL_KEY_ID = 'key-a';
        delete process.env.TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS;
        delete process.env.ENCRYPTION_KEY;
    });

    afterAll(() => {
        restore('TENANT_PAYMENT_CREDENTIAL_KEY', original.key);
        restore('TENANT_PAYMENT_CREDENTIAL_KEY_ID', original.keyId);
        restore('TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS', original.previous);
        restore('ENCRYPTION_KEY', original.legacyKey);
    });

    it('round-trips only inside the exact tenant/provider/environment/field AAD', () => {
        const service = new TenantPaymentCredentialCryptoService();
        const secret = 'prv_prod_super-secret-value';
        const envelope = service.encrypt(secret, CONTEXT);

        expect(envelope).toMatch(/^tpc:v2:key-a:/);
        expect(envelope).not.toContain(secret);
        expect(service.decrypt(envelope, CONTEXT)).toBe(secret);

        const wrongContexts: TenantPaymentCredentialContext[] = [
            { ...CONTEXT, tenantId: TENANT_B },
            { ...CONTEXT, environment: 'sandbox' },
            { ...CONTEXT, field: 'events_secret' },
            {
                ...CONTEXT,
                provider: 'mercadopago',
                field: 'access_token',
            },
        ];
        for (const context of wrongContexts) {
            expect(() => service.decrypt(envelope, context)).toThrow(
                'tenant_payment_credential_decryption_failed',
            );
        }
    });

    it('uses a fresh nonce for every envelope', () => {
        const service = new TenantPaymentCredentialCryptoService();
        const first = service.encrypt('same-secret', CONTEXT);
        const second = service.encrypt('same-secret', CONTEXT);
        expect(first).not.toBe(second);
        expect(service.decrypt(first, CONTEXT)).toBe('same-secret');
        expect(service.decrypt(second, CONTEXT)).toBe('same-secret');
    });

    it('rejects plaintext, base64, malformed envelopes and invalid contexts', () => {
        const service = new TenantPaymentCredentialCryptoService();
        for (const value of [
            'plaintext-secret',
            Buffer.from('secret').toString('base64'),
            'tpc:v1:key-a:abc:def:ghi',
            'tpc:v2:key-a:not+url:def:ghi',
            'tpc:v2:key-a:abc:def',
        ]) {
            expect(() => service.decrypt(value, CONTEXT)).toThrow(TenantPaymentCredentialCryptoError);
        }
        expect(() => service.encrypt('secret', {
            ...CONTEXT,
            tenantId: 'not-a-tenant',
        })).toThrow('tenant_payment_credential_context_invalid');
        expect(() => service.encrypt('secret', {
            ...CONTEXT,
            provider: 'mercadopago',
            field: 'private_key',
        })).toThrow('tenant_payment_credential_context_invalid');
    });

    it('supports explicit previous-key reads and marks them for rewrap', () => {
        const oldService = new TenantPaymentCredentialCryptoService();
        const oldEnvelope = oldService.encrypt('events-secret', {
            ...CONTEXT,
            field: 'events_secret',
        });

        process.env.TENANT_PAYMENT_CREDENTIAL_KEY = KEY_B;
        process.env.TENANT_PAYMENT_CREDENTIAL_KEY_ID = 'key-b';
        process.env.TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS = JSON.stringify({ 'key-a': KEY_A });
        const rotated = new TenantPaymentCredentialCryptoService();
        const read = rotated.read(oldEnvelope, { ...CONTEXT, field: 'events_secret' });

        expect(read).toMatchObject({
            plaintext: 'events-secret',
            keyId: 'key-a',
            format: 'v2',
            needsRewrap: true,
        });
        const rewrapped = rotated.encrypt(read.plaintext, { ...CONTEXT, field: 'events_secret' });
        expect(rewrapped).toMatch(/^tpc:v2:key-b:/);
        expect(rotated.read(rewrapped, { ...CONTEXT, field: 'events_secret' }).needsRewrap).toBe(false);
    });

    it('permits only an explicit strict legacy AES-GCM bridge', () => {
        const service = new TenantPaymentCredentialCryptoService();
        const legacy = `${'aa'.repeat(16)}:${'bb'.repeat(16)}:${'cc'.repeat(8)}`;
        const legacyDecrypt = jest.fn().mockReturnValue('legacy-secret');

        expect(service.readCompatible(legacy, CONTEXT, legacyDecrypt)).toEqual({
            plaintext: 'legacy-secret',
            format: 'legacy-v1',
            needsRewrap: true,
        });
        expect(legacyDecrypt).toHaveBeenCalledWith(legacy);
        expect(() => service.readCompatible(legacy, CONTEXT)).toThrow(
            'tenant_payment_legacy_credential_not_allowed',
        );
        expect(() => service.readCompatible('raw-secret', CONTEXT, legacyDecrypt)).toThrow(
            'tenant_payment_legacy_credential_not_allowed',
        );
    });

    it('requires strict key material and never logs or exposes the secret on failure', () => {
        process.env.TENANT_PAYMENT_CREDENTIAL_KEY = 'not-hex';
        const lazy = new TenantPaymentCredentialCryptoService();
        // Provider registration/DI is lazy; the first credential operation is
        // the fail-closed boundary.
        expect(() => lazy.encrypt('secret', CONTEXT)).toThrow(
            'tenant_payment_crypto_key_invalid',
        );

        process.env.TENANT_PAYMENT_CREDENTIAL_KEY = KEY_A;
        const service = new TenantPaymentCredentialCryptoService();
        const secret = 'must-never-appear-in-errors-or-logs';
        const envelope = service.encrypt(secret, CONTEXT);
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        let caught: unknown;
        try {
            service.decrypt(envelope, { ...CONTEXT, tenantId: TENANT_B });
        } catch (error) {
            caught = error;
        }
        expect(String(caught)).not.toContain(secret);
        expect(String(caught)).not.toContain(envelope);
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        errorSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('falls back to the existing encryption key only for the initial v2 rollout', () => {
        delete process.env.TENANT_PAYMENT_CREDENTIAL_KEY;
        process.env.ENCRYPTION_KEY = KEY_A;
        const service = new TenantPaymentCredentialCryptoService();
        const envelope = service.encrypt('migration-compatible', CONTEXT);
        expect(service.decrypt(envelope, CONTEXT)).toBe('migration-compatible');
    });
});

function restore(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
