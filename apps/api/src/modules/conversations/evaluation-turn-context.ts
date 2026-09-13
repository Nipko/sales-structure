import type { BusinessIdentity, TenantRegionalProfileV1, TurnContext, VerticalContext } from '@parallext/shared';
import type { ActiveObjectPolicyContext } from './active-object-policy';

export const EVALUATION_CONTEXT_LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;
export type EvaluationContextLanguage = typeof EVALUATION_CONTEXT_LANGUAGES[number];

/** Private factual inputs, captured by the server and sealed in its manifest.
 * These values reproduce a prompt; they grant no live operational permission. */
export interface EvaluationTurnContextInputs {
    version: 1;
    tenantId: string;
    businessHours: Record<string, unknown> | null;
    regional: TenantRegionalProfileV1;
    business: NonNullable<TurnContext['business']> | null;
    activeObjectPolicy: ActiveObjectPolicyContext;
    vertical: Record<EvaluationContextLanguage, VerticalContext | null>;
}

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

export function resolveEvaluationTurnContext(input: EvaluationTurnContextInputs | undefined, tenantId: string): EvaluationTurnContextInputs {
    if (!record(input) || input.version !== 1 || input.tenantId !== tenantId
        || !Object.hasOwn(input, 'businessHours') || !(input.businessHours === null || record(input.businessHours))
        || !Object.hasOwn(input, 'business') || !(input.business === null || record(input.business))
        || !record(input.activeObjectPolicy)
        || !record(input.regional) || input.regional.tenantId !== tenantId || input.regional.version !== 1
        || !record(input.vertical) || EVALUATION_CONTEXT_LANGUAGES.some(language => !Object.hasOwn(input.vertical, language)
            || !(input.vertical[language] === null || record(input.vertical[language]))))
        throw new Error('agent_snapshot_context_inputs_required');
    return structuredClone(input);
}

export function evaluationContextLanguage(language: string): EvaluationContextLanguage {
    const code = String(language || 'es').slice(0, 2).toLowerCase();
    return code === 'en' || code === 'pt' || code === 'fr' ? code : 'es';
}

export function projectBusinessTurnContext(identity: BusinessIdentity | null): EvaluationTurnContextInputs['business'] {
    return identity ? { companyName: identity.companyName, industry: identity.industry, about: identity.about,
        phone: identity.phone, email: identity.email, website: identity.website, address: identity.address,
        city: identity.city, country: identity.country, socialLinks: identity.socialLinks } : null;
}
