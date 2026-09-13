import type { ServiceExecutionContext } from '../../common/types/execution-context';
import { Injectable } from '@nestjs/common';
import {
    buildDomainContractDraft,
    localizedTerm,
    resolveSubtypeExperienceProfile,
    resolveIntentWorkflow,
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
                const inheritedBlock = intent.workflowReadiness && intent.workflowReadiness !== 'ready'
                    ? intent.workflowReadiness
                    : null;
                const workflowReadiness = inheritedBlock || (missingTools.length ? 'blocked_missing_tools' as const : 'ready' as const);
                return {
                    ...intent,
                    runtimeToolPlan,
                    runtimeStatus,
                    missingTools,
                    workflowReadiness,
                    workflowBlockedReason: workflowReadiness === 'ready' ? null : workflowReadiness,
                    defaultDeny: workflowReadiness !== 'ready' || intent.workflowClass !== 'informational',
                };
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
        executionContext?: ServiceExecutionContext;
    }): Promise<VerticalContext | undefined> {
        const config = await this.verticals.getVerticalConfig(input.tenantId, 0, input.executionContext);
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
                ...(() => {
                    const workflow = resolveIntentWorkflow({ profileId: domain.profileId, intent });
                    return {
                        workflowClass: workflow.class,
                        workflowId: workflow.workflowId,
                        workflowStates: workflow.states,
                        workflowInitialState: workflow.initialState,
                        workflowTerminalStates: workflow.terminalStates,
                        workflowReadiness: workflow.readiness,
                        workflowBlockedReason: workflow.blockedReason,
                        requiredSlots: workflow.requiredSlots,
                        nextStateAuthority: workflow.nextStateAuthority,
                        defaultDeny: workflow.defaultDeny,
                    };
                })(),
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

    private flowGuidance(
        industry: string,
        tools: any,
        language: 'es' | 'en' | 'pt' | 'fr',
    ): string | undefined {
        const lines = FLOW_GUIDANCE
            .filter(entry => entry.industry === industry && tools?.[entry.requires]?.enabled === true)
            .map(entry => entry.guidance[language]);
        return lines.length ? lines.join(' ') : undefined;
    }
}

type FlowLanguage = 'es' | 'en' | 'pt' | 'fr';
type FlowGuidance = Readonly<{
    industry: string;
    requires: string;
    guidance: Readonly<Record<FlowLanguage, string>>;
}>;

const FLOW_GUIDANCE: readonly FlowGuidance[] = Object.freeze([
    { industry: 'turismo', requires: 'properties', guidance: {
        es: 'Para una estadía: list_properties → check_property_availability para las fechas exactas → resuma precio total y fechas → pida confirmación → create_property_booking. Nunca ofrezca una propiedad sin verificar esas fechas.',
        en: 'For a stay: list_properties → check_property_availability for the exact dates → summarize the total price and dates → ask for confirmation → create_property_booking. Never offer a property without checking those dates.',
        pt: 'Para uma estadia: list_properties → check_property_availability para as datas exatas → resuma o preço total e as datas → peça confirmação → create_property_booking. Nunca ofereça uma propriedade sem verificar essas datas.',
        fr: 'Pour un séjour : list_properties → check_property_availability pour les dates exactes → résumez le prix total et les dates → demandez confirmation → create_property_booking. Ne proposez jamais un logement sans vérifier ces dates.',
    } },
    { industry: 'turismo', requires: 'tours', guidance: {
        es: 'Para un paquete: search_packages → check_package_availability para la fecha de salida → resuma precio y cupos → pida confirmación → create_tour_booking.',
        en: 'For a package: search_packages → check_package_availability for the departure date → summarize price and available places → ask for confirmation → create_tour_booking.',
        pt: 'Para um pacote: search_packages → check_package_availability para a data de saída → resuma o preço e as vagas → peça confirmação → create_tour_booking.',
        fr: 'Pour un forfait : search_packages → check_package_availability pour la date de départ → résumez le prix et les places disponibles → demandez confirmation → create_tour_booking.',
    } },
    { industry: 'restaurantes', requires: 'restaurants', guidance: {
        es: 'Para un pedido: get_menu → arme el pedido con el cliente → repita los ítems, el total y la dirección → pida confirmación → place_order. Para una mesa use el flujo de reservas de agenda.',
        en: 'For an order: get_menu → build the order with the customer → repeat the items, total and address → ask for confirmation → place_order. For a table, use the appointment booking flow.',
        pt: 'Para um pedido: get_menu → monte o pedido com o cliente → repita os itens, o total e o endereço → peça confirmação → place_order. Para uma mesa, use o fluxo de reservas da agenda.',
        fr: 'Pour une commande : get_menu → composez la commande avec le client → répétez les articles, le total et l’adresse → demandez confirmation → place_order. Pour une table, utilisez le parcours de réservation de l’agenda.',
    } },
    { industry: 'gimnasios', requires: 'gyms', guidance: {
        es: 'Para una clase: get_class_schedule → verifique la membresía con get_my_membership → pida confirmación → book_class. Si no es socio, ofrezca get_membership_plans antes de reservar.',
        en: 'For a class: get_class_schedule → verify membership with get_my_membership → ask for confirmation → book_class. If the customer is not a member, offer get_membership_plans before booking.',
        pt: 'Para uma aula: get_class_schedule → verifique a matrícula com get_my_membership → peça confirmação → book_class. Se a pessoa não for membro, ofereça get_membership_plans antes de reservar.',
        fr: 'Pour un cours : get_class_schedule → vérifiez l’abonnement avec get_my_membership → demandez confirmation → book_class. Si la personne n’est pas membre, proposez get_membership_plans avant de réserver.',
    } },
    { industry: 'education', requires: 'education', guidance: {
        es: 'Para una inscripción: get_courses → get_course_schedule del curso elegido → resuma curso, horario y precio → pida confirmación → enroll_student.',
        en: 'For an enrolment: get_courses → get_course_schedule for the selected course → summarize the course, schedule and price → ask for confirmation → enroll_student.',
        pt: 'Para uma matrícula: get_courses → get_course_schedule do curso escolhido → resuma o curso, o horário e o preço → peça confirmação → enroll_student.',
        fr: 'Pour une inscription : get_courses → get_course_schedule pour le cours choisi → résumez le cours, l’horaire et le prix → demandez confirmation → enroll_student.',
    } },
    { industry: 'seguros', requires: 'insurance', guidance: {
        es: 'Para cotizar: get_insurance_plans → pida solo los datos faltantes → calculate_quote. Para un reclamo, file_claim requiere verificar identidad con request_identity_code y verify_identity_code.',
        en: 'For a quote: get_insurance_plans → ask only for missing information → calculate_quote. For a claim, file_claim requires identity verification with request_identity_code and verify_identity_code.',
        pt: 'Para uma cotação: get_insurance_plans → peça somente os dados que faltam → calculate_quote. Para um sinistro, file_claim exige verificar a identidade com request_identity_code e verify_identity_code.',
        fr: 'Pour un devis : get_insurance_plans → demandez uniquement les informations manquantes → calculate_quote. Pour un sinistre, file_claim exige une vérification d’identité avec request_identity_code et verify_identity_code.',
    } },
    { industry: 'servicios_hogar', requires: 'homeServices', guidance: {
        es: 'Para una solicitud: entienda el problema y la dirección → resuma lo que registrará → create_service_request. Después del registro la conversación pasa a una persona del equipo.',
        en: 'For a service request: understand the problem and address → summarize what will be recorded → create_service_request. After registration, the conversation passes to a team member.',
        pt: 'Para uma solicitação: entenda o problema e o endereço → resuma o que será registrado → create_service_request. Depois do registro, a conversa passa para uma pessoa da equipe.',
        fr: 'Pour une demande : comprenez le problème et l’adresse → résumez ce qui sera enregistré → create_service_request. Après l’enregistrement, la conversation est transmise à un membre de l’équipe.',
    } },
    { industry: 'fotografia', requires: 'photography', guidance: {
        es: 'Para una sesión: list_photo_packages → send_portfolio si el cliente quiere ver trabajo previo → check_date_availability → request_photo_quote.',
        en: 'For a session: list_photo_packages → send_portfolio if the customer wants to see previous work → check_date_availability → request_photo_quote.',
        pt: 'Para uma sessão: list_photo_packages → send_portfolio se o cliente quiser ver trabalhos anteriores → check_date_availability → request_photo_quote.',
        fr: 'Pour une séance : list_photo_packages → send_portfolio si le client souhaite voir des réalisations précédentes → check_date_availability → request_photo_quote.',
    } },
    { industry: 'inmobiliaria', requires: 'realEstate', guidance: {
        es: 'Para una visita: search_listings → get_listing_details → send_listing_image si ayuda → agende la visita registrando siempre el inmueble.',
        en: 'For a viewing: search_listings → get_listing_details → send_listing_image when useful → schedule the viewing and always record the property.',
        pt: 'Para uma visita: search_listings → get_listing_details → send_listing_image se ajudar → agende a visita registrando sempre o imóvel.',
        fr: 'Pour une visite : search_listings → get_listing_details → send_listing_image si utile → planifiez la visite en enregistrant toujours le bien.',
    } },
    { industry: 'automotriz', requires: 'vehicles', guidance: {
        es: 'Prueba de manejo: search_vehicles → get_vehicle_details → list_services presencial de duración fija → check_availability con vehicleId → confirmar vehículo, asesor, horario y condiciones → schedule_test_drive con serviceId y staffId reales. Distingue pendiente de aprobación, pendiente de pago y confirmado. Usa el mismo appointment.id para consultar, reprogramar o cancelar. Explica requisitos faltantes y deriva al equipo si no puedes reservar.',
        en: 'Test drive: search_vehicles → get_vehicle_details → list_services for an in-person fixed-duration service → check_availability with vehicleId → confirm the vehicle, advisor, time and conditions → schedule_test_drive with real serviceId and staffId values. Distinguish pending approval, pending payment and confirmed. Use the same appointment.id to check, reschedule or cancel. Explain missing requirements and hand off to the team if you cannot book.',
        pt: 'Test drive: search_vehicles → get_vehicle_details → list_services para um serviço presencial de duração fixa → check_availability com vehicleId → confirme veículo, consultor, horário e condições → schedule_test_drive com serviceId e staffId reais. Diferencie pendente de aprovação, pendente de pagamento e confirmado. Use o mesmo appointment.id para consultar, reagendar ou cancelar. Explique requisitos ausentes e encaminhe para a equipe se não puder reservar.',
        fr: 'Essai routier : search_vehicles → get_vehicle_details → list_services pour un service en personne à durée fixe → check_availability avec vehicleId → confirmez le véhicule, le conseiller, l’horaire et les conditions → schedule_test_drive avec de vrais serviceId et staffId. Distinguez en attente d’approbation, en attente de paiement et confirmé. Utilisez le même appointment.id pour consulter, reprogrammer ou annuler. Expliquez les exigences manquantes et transmettez à l’équipe si vous ne pouvez pas réserver.',
    } },
    { industry: 'veterinaria', requires: 'pets', guidance: {
        es: 'Registre la mascota con register_pet antes de agendar; use list_pets_for_contact primero para no duplicarla. Ante señales de urgencia use triage_pet_emergency.',
        en: 'Register the pet with register_pet before booking; use list_pets_for_contact first to avoid duplicates. Use triage_pet_emergency when there are signs of urgency.',
        pt: 'Registre o animal com register_pet antes de agendar; use list_pets_for_contact primeiro para evitar duplicidade. Diante de sinais de urgência, use triage_pet_emergency.',
        fr: 'Enregistrez l’animal avec register_pet avant de planifier ; utilisez d’abord list_pets_for_contact pour éviter les doublons. En présence de signes d’urgence, utilisez triage_pet_emergency.',
    } },
    { industry: 'salud', requires: 'catalog', guidance: {
        es: 'Para una venta de mostrador: search_products → check_stock → confirme producto y cantidad → place_catalog_order. Los productos bajo fórmula médica se derivan a una persona; nunca sugiera medicamento, dosis ni reemplazo.',
        en: 'For an over-the-counter sale: search_products → check_stock → confirm the product and quantity → place_catalog_order. Refer prescription products to a person; never suggest a medicine, dose or substitute.',
        pt: 'Para uma venda no balcão: search_products → check_stock → confirme o produto e a quantidade → place_catalog_order. Produtos sujeitos a receita devem ser encaminhados a uma pessoa; nunca sugira medicamento, dose ou substituição.',
        fr: 'Pour une vente au comptoir : search_products → check_stock → confirmez le produit et la quantité → place_catalog_order. Transmettez les produits sur ordonnance à une personne ; ne suggérez jamais de médicament, de dose ni de substitution.',
    } },
    { industry: 'retail', requires: 'catalog', guidance: {
        es: 'Para una venta: search_products → get_product → check_stock → send_product_image si ayuda → confirme producto y cantidad → place_catalog_order. Los precios salen del catálogo.',
        en: 'For a sale: search_products → get_product → check_stock → send_product_image when useful → confirm the product and quantity → place_catalog_order. Prices come from the catalogue.',
        pt: 'Para uma venda: search_products → get_product → check_stock → send_product_image se ajudar → confirme o produto e a quantidade → place_catalog_order. Os preços vêm do catálogo.',
        fr: 'Pour une vente : search_products → get_product → check_stock → send_product_image si utile → confirmez le produit et la quantité → place_catalog_order. Les prix proviennent du catalogue.',
    } },
    { industry: 'otro', requires: 'catalog', guidance: {
        es: 'Para una venta: search_products → get_product → check_stock → confirme producto y cantidad → place_catalog_order. Nunca afirme que el pedido quedó registrado sin éxito de la herramienta.',
        en: 'For a sale: search_products → get_product → check_stock → confirm the product and quantity → place_catalog_order. Never claim that the order was recorded unless the tool succeeded.',
        pt: 'Para uma venda: search_products → get_product → check_stock → confirme o produto e a quantidade → place_catalog_order. Nunca diga que o pedido foi registrado sem a ferramenta ter concluído com sucesso.',
        fr: 'Pour une vente : search_products → get_product → check_stock → confirmez le produit et la quantité → place_catalog_order. Ne dites jamais que la commande a été enregistrée si l’outil n’a pas réussi.',
    } },
]);
