/**
 * ═══ WHAT A TOKEN ACTUALLY IS, AS OPPOSED TO WHAT THE ROW IS CALLED ═══
 *
 * `whatsapp_credentials.credential_type` says `system_user_token`, and that is a
 * NAME. Under the Tech Provider model two different things can be stored under
 * it, and they are not interchangeable:
 *
 *   · a BUSINESS INTEGRATION SYSTEM USER token — minted for ONE client business
 *     through Embedded Signup, scoped to that client's assets, and the thing a
 *     Tech Provider is supposed to send with;
 *   · the PROVIDER'S OWN System User token, which Meta reserves for the
 *     provider's own use and for a Solution Partner's credit line.
 *
 * Signing a tenant's send with the second is not a smaller version of the first.
 * It attributes the message to the provider, bills whoever the provider's
 * portfolio bills, and — the part that does not undo — hands one customer's
 * traffic to another business's audit trail. `docs/research/2026-09-10/
 * whatsapp-account-billing-architecture.md` F4 states the rule; nothing in the
 * code could tell the two apart, because the only evidence was the column name.
 *
 * ── WHY "NOT CHECKED" IS A STATE AND NOT A DEFAULT ──────────────────────────
 *
 * This module reads RECORDED evidence — the app the token was minted for, the
 * business that owns it, the scopes it carries. It makes no provider call, so
 * for a credential nobody has verified the only honest answer is "we have not
 * established this", which is different from both answers and must not be
 * rendered as either.
 *
 * That distinction is the whole point. Reading unverified as BISU lets the
 * substitution through silently; reading it as the provider's token would
 * refuse every send for every tenant whose credential predates this record.
 * So an unverified credential is USABLE and SAID to be unverified, and only a
 * credential positively established as the provider's own is refused.
 */

export const CREDENTIAL_KINDS = [
    /** Minted for one client business. What a Tech Provider sends with. */
    'business_integration_system_user',
    /** The provider's own. Never valid for a tenant's outbound message. */
    'provider_system_user',
    /** Nobody has established which. Not a synonym for either. */
    'not_established',
] as const;

export type WhatsAppCredentialKind = (typeof CREDENTIAL_KINDS)[number];

export interface CredentialProvenance {
    readonly kind: WhatsAppCredentialKind;
    /** The Meta app the token was minted for, when recorded. */
    readonly appId: string | null;
    /** The business that owns the token, when recorded. */
    readonly ownerBusinessId: string | null;
    /** Scopes recorded at mint time, lower-cased and de-duplicated. */
    readonly scopes: readonly string[];
    /** When the provenance was last established. `null` while unverified. */
    readonly verifiedAt: Date | null;
    /** One sentence an operator can act on. */
    readonly detail: string;
}

/** Scopes a token must carry to send on a client's behalf. */
export const REQUIRED_SEND_SCOPES: readonly string[] = Object.freeze([
    'whatsapp_business_messaging',
]);

const text = (value: unknown): string =>
    (typeof value === 'string' ? value.trim() : '');

const scopeList = (value: unknown): readonly string[] => {
    const raw = Array.isArray(value) ? value
        : (typeof value === 'string' ? value.split(/[\s,]+/) : []);
    return Object.freeze([...new Set(raw.map(entry => text(entry).toLowerCase()).filter(Boolean))]);
};

/**
 * What the stored evidence says this credential is.
 *
 * `providerBusinessId` is OUR portfolio. A token whose owner is us is the
 * provider's own by definition, whatever the row is called — which is the one
 * inference this module is willing to make, because it is the dangerous
 * direction and it is decidable from a fact we hold.
 */
export function credentialProvenance(input: {
    readonly credentialKind?: string | null;
    readonly metaAppId?: string | null;
    readonly ownerBusinessId?: string | null;
    readonly grantedScopes?: unknown;
    readonly verifiedAt?: Date | string | null;
    readonly providerBusinessId?: string | null;
}): CredentialProvenance {
    const appId = text(input.metaAppId) || null;
    const owner = text(input.ownerBusinessId) || null;
    const scopes = scopeList(input.grantedScopes);
    const verifiedRaw = input.verifiedAt
        ? (input.verifiedAt instanceof Date ? input.verifiedAt : new Date(input.verifiedAt))
        : null;
    const verifiedAt = verifiedRaw && !Number.isNaN(verifiedRaw.getTime()) ? verifiedRaw : null;
    const declared = text(input.credentialKind).toLowerCase();
    const provider = text(input.providerBusinessId) || null;

    const base = { appId, ownerBusinessId: owner, scopes, verifiedAt };

    // Owned by US. Decidable from a fact we hold, and the dangerous direction,
    // so it outranks whatever the row declares itself to be.
    if (owner && provider && owner === provider) {
        return Object.freeze({
            ...base,
            kind: 'provider_system_user' as const,
            detail: `el token pertenece al portafolio del proveedor (${owner}), no al del cliente`,
        });
    }

    if ((CREDENTIAL_KINDS as readonly string[]).includes(declared) && declared !== 'not_established') {
        return Object.freeze({
            ...base,
            kind: declared as WhatsAppCredentialKind,
            detail: declared === 'provider_system_user'
                ? 'registrado como System User del proveedor'
                : `registrado como BISU del cliente${owner ? ` (${owner})` : ''}`,
        });
    }

    return Object.freeze({
        ...base,
        kind: 'not_established' as const,
        detail: 'nadie estableció de qué tipo es este token. No es lo mismo que saber que '
            + 'está mal: se sigue usando y se dice que no fue comprobado.',
    });
}

/** What a send may do with this credential. */
export type CredentialVerdict =
    | { readonly usable: true; readonly established: boolean; readonly detail: string }
    | { readonly usable: false; readonly code: string; readonly detail: string };

/**
 * May this credential sign an outbound message for this client?
 *
 * Refuses ONLY what is positively established as wrong. An unverified
 * credential goes out — every tenant connected before this record existed has
 * one — and the caller is told it is unverified so an operator can see the
 * backlog instead of discovering it when sending stops.
 */
export function maySignForClient(
    provenance: CredentialProvenance,
    client: { readonly businessId?: string | null },
): CredentialVerdict {
    if (provenance.kind === 'provider_system_user') {
        return {
            usable: false,
            code: 'credential_not_client_scoped',
            detail: `${provenance.detail}. Un mensaje firmado con él se atribuye al proveedor y se `
                + 'cobra a otro portafolio. Reconecta el número por Embedded Signup para obtener '
                + 'un token del cliente.',
        };
    }

    const owner = text(provenance.ownerBusinessId) || null;
    const business = text(client.businessId) || null;
    // A token established as belonging to a DIFFERENT client is the substitution
    // this module exists to stop, and it is not softened by being a BISU.
    if (provenance.kind === 'business_integration_system_user' && owner && business && owner !== business) {
        return {
            usable: false,
            code: 'credential_other_business',
            detail: `el token pertenece al negocio ${owner} y este envío es de ${business}`,
        };
    }

    if (provenance.kind === 'business_integration_system_user'
        && provenance.scopes.length
        && !REQUIRED_SEND_SCOPES.every(scope => provenance.scopes.includes(scope))) {
        return {
            usable: false,
            code: 'credential_scope_missing',
            detail: `al token le faltan permisos para enviar (${REQUIRED_SEND_SCOPES.join(', ')}); `
                + `tiene ${provenance.scopes.join(', ') || 'ninguno registrado'}`,
        };
    }

    return {
        usable: true,
        established: provenance.kind === 'business_integration_system_user',
        detail: provenance.detail,
    };
}
