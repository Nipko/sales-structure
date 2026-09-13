import {
    credentialProvenance, maySignForClient, CREDENTIAL_KINDS, REQUIRED_SEND_SCOPES,
} from './whatsapp-credential-kind';

/**
 * ═══ A COLUMN NAME IS NOT EVIDENCE ═══
 *
 * `whatsapp_credentials.credential_type` says `system_user_token`, and two
 * different things live under that name: a Business Integration System User
 * token minted for ONE client through Embedded Signup, and the PROVIDER'S OWN
 * System User token, which Meta reserves for the provider's own use.
 *
 * Signing a tenant's message with the second attributes it to the provider,
 * bills another portfolio, and puts one customer's traffic into another
 * business's audit trail. Nothing could tell them apart, because the only
 * evidence was the column name — which is exactly what the handoff forbids
 * relying on.
 */
describe('what a stored WhatsApp credential actually is', () => {
    it('reads a token recorded as the client’s own', () => {
        const provenance = credentialProvenance({
            credentialKind: 'business_integration_system_user',
            metaAppId: 'app-1', ownerBusinessId: 'biz-client', verifiedAt: '2026-10-01T00:00:00Z',
            grantedScopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
        });
        expect(provenance.kind).toBe('business_integration_system_user');
        expect(provenance.ownerBusinessId).toBe('biz-client');
        expect(provenance.verifiedAt).toBeInstanceOf(Date);
    });

    it('calls a token owned by OUR portfolio the provider’s, whatever the row says', () => {
        // The one inference this module makes, because it is decidable from a
        // fact we hold and it is the dangerous direction. A row that declares
        // itself a client token while being owned by the provider is either a
        // mistake or the substitution itself; either way it must not send.
        const provenance = credentialProvenance({
            credentialKind: 'business_integration_system_user',
            ownerBusinessId: 'biz-provider', providerBusinessId: 'biz-provider',
        });
        expect(provenance.kind).toBe('provider_system_user');
    });

    it('answers "not established" when nobody has checked', () => {
        // NOT a synonym for either. Reading it as the client's lets the
        // substitution through; reading it as the provider's would refuse every
        // send for every tenant connected before this record existed.
        const provenance = credentialProvenance({});
        expect(provenance.kind).toBe('not_established');
        expect(provenance.verifiedAt).toBeNull();
        expect(provenance.detail).toContain('no fue comprobado');
    });

    it('ignores a declared kind nobody defined', () => {
        expect(credentialProvenance({ credentialKind: 'whatever' }).kind).toBe('not_established');
        expect(CREDENTIAL_KINDS).toContain('not_established');
    });

    it('reads an unparseable verification date as unverified', () => {
        expect(credentialProvenance({ verifiedAt: 'not a date' }).verifiedAt).toBeNull();
    });

    it('normalises scopes however they were recorded', () => {
        expect(credentialProvenance({ grantedScopes: 'A, b  b,a' }).scopes).toEqual(['a', 'b']);
        expect(credentialProvenance({ grantedScopes: ['X', 'x', ' y '] }).scopes).toEqual(['x', 'y']);
    });
});

describe('whether it may sign this client’s message', () => {
    const client = { businessId: 'biz-client' };

    it('refuses a token established as the provider’s own', () => {
        const verdict = maySignForClient(
            credentialProvenance({
                ownerBusinessId: 'biz-provider', providerBusinessId: 'biz-provider',
            }), client);
        expect(verdict.usable).toBe(false);
        expect((verdict as any).code).toBe('credential_not_client_scoped');
        // The remedy, because a refusal nobody can act on is an outage.
        expect((verdict as any).detail).toContain('Embedded Signup');
    });

    it('refuses a client token that belongs to a DIFFERENT business', () => {
        const verdict = maySignForClient(
            credentialProvenance({
                credentialKind: 'business_integration_system_user',
                ownerBusinessId: 'biz-someone-else',
            }), client);
        expect((verdict as any).code).toBe('credential_other_business');
    });

    it('refuses a client token whose recorded scopes cannot send', () => {
        const verdict = maySignForClient(
            credentialProvenance({
                credentialKind: 'business_integration_system_user',
                ownerBusinessId: 'biz-client', grantedScopes: ['whatsapp_business_management'],
            }), client);
        expect((verdict as any).code).toBe('credential_scope_missing');
        expect((verdict as any).detail).toContain(REQUIRED_SEND_SCOPES[0]);
    });

    it('lets an UNVERIFIED credential send, and says it is unverified', () => {
        // THE CASE THAT DECIDES WHETHER THIS SHIPS. Every tenant connected
        // before this record exists has one. Refusing them would be an outage
        // caused by bookkeeping; sending while claiming it was checked would be
        // the lie. It sends, and the caller is told.
        const verdict = maySignForClient(credentialProvenance({}), client);
        expect(verdict.usable).toBe(true);
        expect((verdict as any).established).toBe(false);
    });

    it('lets a verified client token send, and says so', () => {
        const verdict = maySignForClient(
            credentialProvenance({
                credentialKind: 'business_integration_system_user',
                ownerBusinessId: 'biz-client',
                grantedScopes: REQUIRED_SEND_SCOPES,
                verifiedAt: '2026-10-01T00:00:00Z',
            }), client);
        expect(verdict.usable).toBe(true);
        expect((verdict as any).established).toBe(true);
    });

    it('does not refuse on scopes it has no record of', () => {
        // An empty scope list is "nobody wrote them down", not "it has none".
        // Refusing there would turn a missing record into a stopped number.
        const verdict = maySignForClient(
            credentialProvenance({
                credentialKind: 'business_integration_system_user',
                ownerBusinessId: 'biz-client', grantedScopes: [],
            }), client);
        expect(verdict.usable).toBe(true);
    });

    it('does not refuse when the caller cannot say which business it is for', () => {
        // The send path does not always know the client's business id. A guard
        // that refused on that would stop working sends to protect against a
        // comparison it cannot make.
        const verdict = maySignForClient(
            credentialProvenance({
                credentialKind: 'business_integration_system_user',
                ownerBusinessId: 'biz-someone-else',
            }), {});
        expect(verdict.usable).toBe(true);
    });
});
