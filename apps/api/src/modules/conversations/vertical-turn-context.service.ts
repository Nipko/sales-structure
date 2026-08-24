import { Injectable } from '@nestjs/common';
import {
    buildDomainContractDraft,
    localizedTerm,
    resolveSubtypeExperienceProfile,
    subtypeTerminologyFor,
    type LocalizedTerm,
    type VerticalContext,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { VerticalsService } from '../verticals/verticals.service';

/**
 * Reconcile the stable domain plan with the immutable capability snapshot for
 * this turn. The authored plan remains visible for audit; runtimeToolPlan is
 * the only subset the model may attempt. This keeps prompt guidance from
 * advertising a writer removed by plan, provider health or a STOP boundary.
 */
export function projectVerticalIntentAvailability(
    context: VerticalContext | undefined,
    publishedTools: readonly string[],
): VerticalContext | undefined {
    if (!context?.domainContract) return context;
    const published = new Set(publishedTools);
    return {
        ...context,
        domainContract: {
            ...context.domainContract,
            intents: context.domainContract.intents.map((intent) => {
                const runtimeToolPlan = intent.toolPlan.filter(tool => published.has(tool));
                const missingTools = intent.toolPlan.filter(tool => !published.has(tool));
                const runtimeStatus = missingTools.length === 0
                    ? 'available' as const
                    : runtimeToolPlan.length > 0
                        ? 'partial' as const
                        : 'unavailable' as const;
                return { ...intent, runtimeToolPlan, runtimeStatus, missingTools };
            }),
        },
    };
}

/**
 * One builder for the vertical block used by live turns and Agent Test.
 *
 * Previously production assembled this from six registries while Agent Test
 * assembled none of it. Keeping the database lookup and the pure projection in
 * one service makes prompt parity testable without coupling Agent Test to the
 * full ConversationsService orchestrator.
 */
@Injectable()
export class VerticalTurnContextService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly verticals: VerticalsService,
    ) {}

    async resolve(input: {
        tenantId: string;
        language: string;
        toolsConfig?: unknown;
    }): Promise<VerticalContext | undefined> {
        const config = await this.verticals.getVerticalConfig(input.tenantId);
        if (!config?.industry) return undefined;

        const language = this.languageCode(input.language);
        const context: VerticalContext = {
            industry: config.industry,
            subType: config.subType || undefined,
        };

        const configuredTerms: any = config.terminology;
        const missingLocalizedTerms: string[] = [];
        const configuredTerm = (key: string, term: any): string | undefined => {
            const localized = term?.[language];
            if (typeof localized === 'string' && localized.trim()) return localized;
            if (language === 'es') return typeof term?.es === 'string' ? term.es : undefined;
            if (typeof term?.es === 'string' && term.es.trim()) {
                missingLocalizedTerms.push(`terminology.${key}.${language}`);
            }
            return undefined;
        };
        if (configuredTerms) {
            context.customerNoun = configuredTerm('customerNoun', configuredTerms.customerNoun);
            context.customerNounPlural = configuredTerm('customerNounPlural', configuredTerms.customerNounPlural);
            context.transactionNoun = configuredTerm('transactionNoun', configuredTerms.transactionNoun);
            context.serviceNoun = configuredTerm('serviceNoun', configuredTerms.serviceNoun);
        }

        const terms = subtypeTerminologyFor(config.industry, config.subType);
        const pick = (term?: LocalizedTerm) => localizedTerm(term, language) || undefined;
        if (terms) {
            context.customerNoun = pick(terms.customerNoun) || context.customerNoun;
            context.customerNounPlural = pick(terms.customerNounPlural) || context.customerNounPlural;
            context.transactionNoun = pick(terms.transactionNoun) || context.transactionNoun;
            context.primaryObjectNoun = pick(terms.primaryObject);
            context.primaryObjectNounPlural = pick(terms.primaryObjectPlural);
            // Avoid lists are source-authored in Spanish today. Injecting them
            // into EN/PT/FR is not localization; it is prompt contamination.
            if (language === 'es' && terms.avoid?.length) {
                context.avoidTerms = [...terms.avoid];
            }
        }

        const profile = resolveSubtypeExperienceProfile(config.industry, config.subType ?? null);
        // Same rule as avoid terms: retain the boundary structurally through
        // domain intents/capability, but do not present Spanish prose as if it
        // were an English, Portuguese or French instruction.
        if (language === 'es' && profile.exclusions?.length) {
            context.notOffered = [...profile.exclusions];
        }

        const domain = buildDomainContractDraft(config.industry, config.subType ?? null);
        context.domainContract = {
            contractVersion: domain.contractVersion,
            profileId: domain.profileId,
            status: domain.status,
            scope: domain.prompt.scope,
            claims: language === 'es' ? [...domain.prompt.claims] : [],
            intents: domain.intents.map(intent => ({
                key: intent.key,
                commits: intent.commits,
                toolPlan: [...intent.toolPlan],
            })),
            unresolved: [...domain.unresolved],
        };

        const review = new Set<string>([...domain.unresolved, ...missingLocalizedTerms]);
        if (!domain.prompt.terminology.customerNoun) review.add('terminology.customerNoun');
        if (!domain.prompt.terminology.transactionNoun) review.add('terminology.transactionNoun');
        if (language !== 'es' && profile.exclusions.length) {
            review.add(`prompt.notOffered.${language}`);
        }
        if (language !== 'es' && domain.prompt.claims.length) {
            review.add(`prompt.claims.${language}`);
        }
        if (language !== 'es' && (terms?.avoid?.length || 0) > 0) {
            review.add(`terminology.avoid.${language}`);
        }

        const guidance = this.flowGuidance(config.industry, input.toolsConfig, language);
        if (guidance) context.industryGuidance = guidance;
        if (language !== 'es' && this.hasFlowGuidance(config.industry, input.toolsConfig)) {
            review.add(`flowGuidance.${language}`);
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: input.tenantId },
            select: { settings: true },
        });
        const settings = (tenant?.settings as any) || {};
        const clean = (values: unknown): string[] => (Array.isArray(values) ? values : [])
            .filter((value): value is string => typeof value === 'string' && !!value.trim())
            .map(value => value.startsWith('other:') ? value.slice(6).trim() : value.trim())
            .filter(Boolean)
            .slice(0, 8);
        const goals = clean(settings.chatReasons);
        const audiences = clean(settings.customerTypes);
        if (goals.length) context.businessGoals = goals;
        if (audiences.length) context.targetAudiences = audiences;
        if (review.size) context.domainReviewRequired = [...review].sort();

        return context;
    }

    private languageCode(language: unknown): 'es' | 'en' | 'pt' | 'fr' {
        const code = String(language || 'es').slice(0, 2).toLowerCase();
        return code === 'en' || code === 'pt' || code === 'fr' ? code : 'es';
    }

    private hasFlowGuidance(industry: string, tools: any): boolean {
        return FLOW_GUIDANCE.some(entry => (
            entry.industry === industry && tools?.[entry.requires]?.enabled === true
        ));
    }

    private flowGuidance(industry: string, tools: any, language: string): string | undefined {
        // The existing guidance is expert-authored only in Spanish. Until each
        // translation is reviewed, omitting it and exposing a review flag is
        // safer than silently feeding Spanish instructions to another locale.
        if (language !== 'es') return undefined;
        const lines = FLOW_GUIDANCE
            .filter(entry => entry.industry === industry && tools?.[entry.requires]?.enabled === true)
            .map(entry => entry.es);
        return lines.length ? lines.join(' ') : undefined;
    }
}

const FLOW_GUIDANCE: ReadonlyArray<{ industry: string; requires: string; es: string }> = Object.freeze([
    { industry: 'turismo', requires: 'properties', es: 'Para una estadía: list_properties → check_property_availability para las fechas exactas → resuma precio total y fechas → pida confirmación → create_property_booking. Nunca ofrezca una propiedad sin verificar esas fechas.' },
    { industry: 'turismo', requires: 'tours', es: 'Para un paquete: search_packages → check_package_availability para la fecha de salida → resuma precio y cupos → pida confirmación → create_tour_booking.' },
    { industry: 'restaurantes', requires: 'restaurants', es: 'Para un pedido: get_menu → arme el pedido con el cliente → repita los ítems, el total y la dirección → pida confirmación → place_order. Para una mesa use el flujo de reservas de agenda.' },
    { industry: 'gimnasios', requires: 'gyms', es: 'Para una clase: get_class_schedule → verifique la membresía con get_my_membership → pida confirmación → book_class. Si no es socio, ofrezca get_membership_plans antes de reservar.' },
    { industry: 'education', requires: 'education', es: 'Para una inscripción: get_courses → get_course_schedule del curso elegido → resuma curso, horario y precio → pida confirmación → enroll_student.' },
    { industry: 'seguros', requires: 'insurance', es: 'Para cotizar: get_insurance_plans → pida solo los datos faltantes → calculate_quote. Para un reclamo, file_claim requiere verificar identidad con request_identity_code y verify_identity_code.' },
    { industry: 'servicios_hogar', requires: 'homeServices', es: 'Para una solicitud: entienda el problema y la dirección → resuma lo que registrará → create_service_request. Después del registro la conversación pasa a una persona del equipo.' },
    { industry: 'fotografia', requires: 'photography', es: 'Para una sesión: list_photo_packages → send_portfolio si el cliente quiere ver trabajo previo → check_date_availability → request_photo_quote.' },
    { industry: 'inmobiliaria', requires: 'realEstate', es: 'Para una visita: search_listings → get_listing_details → send_listing_image si ayuda → agende la visita registrando siempre el inmueble.' },
    { industry: 'automotriz', requires: 'vehicles', es: 'Para una prueba de manejo: search_vehicles → get_vehicle_details → send_vehicle_image si ayuda → acuerde día y hora → schedule_test_drive. Nunca afirme que quedó agendada sin éxito de la herramienta.' },
    { industry: 'veterinaria', requires: 'pets', es: 'Registre la mascota con register_pet antes de agendar; use list_pets_for_contact primero para no duplicarla. Ante señales de urgencia use triage_pet_emergency.' },
    { industry: 'salud', requires: 'catalog', es: 'Para una venta de mostrador: search_products → check_stock → confirme producto y cantidad → place_catalog_order. Los productos bajo fórmula médica se derivan a una persona; nunca sugiera medicamento, dosis ni reemplazo.' },
    { industry: 'retail', requires: 'catalog', es: 'Para una venta: search_products → get_product → check_stock → send_product_image si ayuda → confirme producto y cantidad → place_catalog_order. Los precios salen del catálogo.' },
    { industry: 'otro', requires: 'catalog', es: 'Para una venta: search_products → get_product → check_stock → confirme producto y cantidad → place_catalog_order. Nunca afirme que el pedido quedó registrado sin éxito de la herramienta.' },
]);
