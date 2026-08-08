/**
 * Pure, versioned policy for choosing the INITIAL persona template.
 *
 * This resolver deliberately returns only a template id. It never merges or
 * patches an existing agent configuration; callers must keep the create-only
 * guard before invoking it. Version the policy instead of silently changing
 * the persona produced by an onboarding retry.
 */
export const ONBOARDING_PERSONA_RESOLVER_VERSION = 1 as const;

export const ONBOARDING_PERSONA_GOAL_PRIORITY = [
    // This is the pre-existing generic precedence from PersonaService. Keeping
    // it avoids inventing a new product decision when users select >1 goal.
    'appointments',
    'support',
    'faq',
    'lead_qualification',
    'sales',
    'reminders',
    'promotions',
    'response_time',
] as const;

export type OnboardingPersonaGoal = typeof ONBOARDING_PERSONA_GOAL_PRIORITY[number];
export type OnboardingPersonaDecisionGap =
    | 'goal_template_missing'
    | 'multiple_goal_templates'
    | 'subtype_goal_conflict';

export interface OnboardingPersonaResolution {
    version: typeof ONBOARDING_PERSONA_RESOLVER_VERSION;
    templateId: string;
    source: 'subtype' | 'goal' | 'vertical_default' | 'generic_goal' | 'generic_default';
    matchedGoal: OnboardingPersonaGoal | null;
    gaps: OnboardingPersonaDecisionGap[];
}

interface VerticalPersonaPolicy {
    defaultTemplateId: string;
    /** Existing subtype choices are compatibility constraints and win in v1. */
    subtypeTemplateIds?: Readonly<Record<string, string>>;
    /** Only mappings backed by an existing, semantically matching template. */
    goalTemplateIds?: Partial<Record<OnboardingPersonaGoal, string>>;
}

/**
 * The 18 canonical verticals. Missing goal entries are intentional: the
 * catalog has no dedicated template, or choosing one would be a product
 * decision (notably promotions/response-time in several verticals).
 */
export const ONBOARDING_VERTICAL_PERSONA_POLICIES: Readonly<Record<string, VerticalPersonaPolicy>> = {
    salud: {
        defaultTemplateId: 'tpl_salud_recepcion',
        subtypeTemplateIds: { dental: 'tpl_salud_dental' },
        goalTemplateIds: {
            appointments: 'tpl_salud_recepcion',
            faq: 'tpl_salud_recepcion',
            support: 'tpl_salud_seguimiento',
            reminders: 'tpl_salud_seguimiento',
        },
    },
    veterinaria: {
        defaultTemplateId: 'tpl_veterinaria_clinica',
        goalTemplateIds: {
            appointments: 'tpl_veterinaria_clinica',
            faq: 'tpl_veterinaria_clinica',
            support: 'tpl_veterinaria_clinica',
            reminders: 'tpl_veterinaria_clinica',
        },
    },
    gimnasios: {
        defaultTemplateId: 'tpl_gimnasio_ventas',
        subtypeTemplateIds: {
            crossfit: 'tpl_gimnasio_clases',
            yoga_pilates: 'tpl_gimnasio_clases',
            cycling: 'tpl_gimnasio_clases',
            martial_arts: 'tpl_gimnasio_clases',
        },
        goalTemplateIds: {
            appointments: 'tpl_gimnasio_clases',
            faq: 'tpl_gimnasio_ventas',
            sales: 'tpl_gimnasio_ventas',
        },
    },
    seguros: {
        defaultTemplateId: 'tpl_seguros_cotizador',
        subtypeTemplateIds: {
            broker: 'tpl_seguros_cotizador',
            aseguradora: 'tpl_seguros_cotizador',
        },
        goalTemplateIds: {
            sales: 'tpl_seguros_cotizador',
            lead_qualification: 'tpl_seguros_cotizador',
            faq: 'tpl_seguros_cotizador',
            support: 'tpl_seguros_postventa',
            reminders: 'tpl_seguros_postventa',
        },
    },
    moda_belleza: {
        defaultTemplateId: 'tpl_belleza_reservas',
        // Legacy subtype retained because the vertical identifier layer still
        // accepts old persisted tenants even though new catalog entries differ.
        subtypeTemplateIds: { boutique: 'tpl_belleza_productos' },
        goalTemplateIds: {
            appointments: 'tpl_belleza_reservas',
            faq: 'tpl_belleza_reservas',
            sales: 'tpl_belleza_productos',
        },
    },
    inmobiliaria: {
        defaultTemplateId: 'tpl_inmobiliaria_ventas',
        subtypeTemplateIds: {
            venta: 'tpl_inmobiliaria_listings',
            arriendo: 'tpl_inmobiliaria_listings',
            comercial: 'tpl_inmobiliaria_listings',
        },
        goalTemplateIds: {
            appointments: 'tpl_inmobiliaria_ventas',
            faq: 'tpl_inmobiliaria_ventas',
            lead_qualification: 'tpl_inmobiliaria_ventas',
            sales: 'tpl_inmobiliaria_ventas',
            support: 'tpl_inmobiliaria_soporte',
        },
    },
    restaurantes: {
        defaultTemplateId: 'tpl_restaurante_reservas',
        subtypeTemplateIds: {
            casual_dining: 'tpl_restaurante_reservas',
            comida_rapida: 'tpl_restaurante_delivery',
            dark_kitchen: 'tpl_restaurante_delivery',
            delivery: 'tpl_restaurante_delivery',
        },
        goalTemplateIds: {
            appointments: 'tpl_restaurante_reservas',
            faq: 'tpl_restaurante_reservas',
            sales: 'tpl_restaurante_delivery',
        },
    },
    automotriz: {
        defaultTemplateId: 'tpl_automotriz_ventas',
        subtypeTemplateIds: { taller: 'tpl_automotriz_servicio' },
        goalTemplateIds: {
            appointments: 'tpl_automotriz_ventas',
            faq: 'tpl_automotriz_ventas',
            lead_qualification: 'tpl_automotriz_ventas',
            sales: 'tpl_automotriz_ventas',
            support: 'tpl_automotriz_servicio',
        },
    },
    turismo: {
        defaultTemplateId: 'tpl_turismo_ventas',
        subtypeTemplateIds: {
            tours: 'tpl_turismo_tours',
            agencia_viajes: 'tpl_turismo_agencia',
        },
        goalTemplateIds: {
            appointments: 'tpl_turismo_ventas',
            faq: 'tpl_turismo_ventas',
            sales: 'tpl_turismo_ventas',
            support: 'tpl_turismo_soporte',
        },
    },
    education: {
        defaultTemplateId: 'tpl_educacion_inscripciones',
        goalTemplateIds: {
            appointments: 'tpl_educacion_inscripciones',
            faq: 'tpl_educacion_inscripciones',
            lead_qualification: 'tpl_educacion_inscripciones',
        },
    },
    finanzas: {
        defaultTemplateId: 'tpl_finanzas_calificador',
        goalTemplateIds: {
            appointments: 'tpl_finanzas_calificador',
            faq: 'tpl_finanzas_calificador',
            lead_qualification: 'tpl_finanzas_calificador',
            support: 'tpl_finanzas_renovaciones',
            reminders: 'tpl_finanzas_renovaciones',
        },
    },
    servicios_profesionales: {
        defaultTemplateId: 'tpl_legal_consulta',
        subtypeTemplateIds: { abogados: 'tpl_legal_consulta' },
        goalTemplateIds: {
            appointments: 'tpl_legal_consulta',
            faq: 'tpl_legal_consulta',
            lead_qualification: 'tpl_legal_consulta',
            support: 'tpl_legal_seguimiento',
        },
    },
    retail: {
        defaultTemplateId: 'tpl_retail_ventas',
        goalTemplateIds: {
            faq: 'tpl_retail_ventas',
            lead_qualification: 'tpl_retail_ventas',
            sales: 'tpl_retail_ventas',
            support: 'tpl_retail_postventa',
        },
    },
    technology: {
        defaultTemplateId: 'tpl_technology_ventas',
        goalTemplateIds: {
            appointments: 'tpl_technology_ventas',
            faq: 'tpl_technology_ventas',
            lead_qualification: 'tpl_technology_ventas',
            sales: 'tpl_technology_ventas',
            support: 'tpl_technology_soporte',
        },
    },
    pet_services: {
        defaultTemplateId: 'tpl_pet_atencion',
        subtypeTemplateIds: { tienda: 'tpl_pet_tienda' },
        goalTemplateIds: {
            appointments: 'tpl_pet_atencion',
            faq: 'tpl_pet_atencion',
            sales: 'tpl_pet_tienda',
        },
    },
    servicios_hogar: {
        defaultTemplateId: 'tpl_hogar_cotizador',
        goalTemplateIds: {
            appointments: 'tpl_hogar_cotizador',
            faq: 'tpl_hogar_cotizador',
            lead_qualification: 'tpl_hogar_cotizador',
            sales: 'tpl_hogar_cotizador',
            support: 'tpl_hogar_seguimiento',
        },
    },
    fotografia: {
        defaultTemplateId: 'tpl_foto_reservas',
        subtypeTemplateIds: { bodas: 'tpl_foto_reservas' },
        goalTemplateIds: {
            appointments: 'tpl_foto_reservas',
            faq: 'tpl_foto_reservas',
            sales: 'tpl_foto_reservas',
            support: 'tpl_foto_entrega',
        },
    },
    otro: {
        defaultTemplateId: 'tpl_otro_ventas',
        goalTemplateIds: {
            appointments: 'tpl_otro_ventas',
            faq: 'tpl_otro_ventas',
            lead_qualification: 'tpl_otro_ventas',
            sales: 'tpl_otro_ventas',
            support: 'tpl_otro_soporte',
        },
    },
};

const GENERIC_GOAL_TEMPLATE_IDS: Partial<Record<OnboardingPersonaGoal, string>> = {
    appointments: 'tpl_appointments',
    support: 'tpl_support',
    faq: 'tpl_faq',
    lead_qualification: 'tpl_lead_qualifier',
    sales: 'tpl_sales',
};

function normalizedGoalSet(goals: readonly unknown[]): Set<string> {
    return new Set(goals
        .filter((goal): goal is string => typeof goal === 'string')
        .map((goal) => goal.trim().toLowerCase())
        .filter(Boolean));
}

function pushGap(gaps: OnboardingPersonaDecisionGap[], gap: OnboardingPersonaDecisionGap): void {
    if (!gaps.includes(gap)) gaps.push(gap);
}

export function resolveOnboardingPersonaTemplate(input: {
    industry?: string | null;
    subType?: string | null;
    goals?: readonly unknown[] | null;
    availableVerticalTemplateIds?: readonly string[];
    availableBuiltinTemplateIds: readonly string[];
}): OnboardingPersonaResolution {
    const industry = typeof input.industry === 'string' ? input.industry.trim().toLowerCase() : '';
    const subType = typeof input.subType === 'string' ? input.subType.trim().toLowerCase() : '';
    const goals = normalizedGoalSet(input.goals || []);
    const selectedGoal = ONBOARDING_PERSONA_GOAL_PRIORITY.find((goal) => goals.has(goal)) || null;
    const gaps: OnboardingPersonaDecisionGap[] = [];
    const policy = industry ? ONBOARDING_VERTICAL_PERSONA_POLICIES[industry] : undefined;

    if (policy) {
        const available = new Set(input.availableVerticalTemplateIds || []);
        const subtypeTemplateId = subType ? policy.subtypeTemplateIds?.[subType] : undefined;
        const goalTemplateId = selectedGoal ? policy.goalTemplateIds?.[selectedGoal] : undefined;

        const distinctSelectedTemplates = new Set(
            ONBOARDING_PERSONA_GOAL_PRIORITY
                .filter((goal) => goals.has(goal))
                .map((goal) => policy.goalTemplateIds?.[goal])
                .filter((templateId): templateId is string => !!templateId),
        );
        if (distinctSelectedTemplates.size > 1) pushGap(gaps, 'multiple_goal_templates');
        if (selectedGoal && !goalTemplateId) pushGap(gaps, 'goal_template_missing');

        // Compatibility fence: v1 never changes a subtype result that was
        // already shipped. When it conflicts with a goal, surface that product
        // decision explicitly instead of silently choosing a winner.
        if (subtypeTemplateId) {
            if (!available.has(subtypeTemplateId)) {
                throw new Error(`Onboarding persona subtype template is unavailable: ${industry}/${subType}/${subtypeTemplateId}`);
            }
            if (goalTemplateId && goalTemplateId !== subtypeTemplateId) {
                pushGap(gaps, 'subtype_goal_conflict');
            }
            return {
                version: ONBOARDING_PERSONA_RESOLVER_VERSION,
                templateId: subtypeTemplateId,
                source: 'subtype',
                matchedGoal: selectedGoal,
                gaps,
            };
        }

        if (goalTemplateId) {
            if (!available.has(goalTemplateId)) {
                throw new Error(`Onboarding persona goal template is unavailable: ${industry}/${selectedGoal}/${goalTemplateId}`);
            }
            return {
                version: ONBOARDING_PERSONA_RESOLVER_VERSION,
                templateId: goalTemplateId,
                source: 'goal',
                matchedGoal: selectedGoal,
                gaps,
            };
        }

        if (!available.has(policy.defaultTemplateId)) {
            throw new Error(`Onboarding persona default template is unavailable: ${industry}/${policy.defaultTemplateId}`);
        }
        return {
            version: ONBOARDING_PERSONA_RESOLVER_VERSION,
            templateId: policy.defaultTemplateId,
            source: 'vertical_default',
            matchedGoal: selectedGoal,
            gaps,
        };
    }

    const builtins = new Set(input.availableBuiltinTemplateIds);
    const genericGoalTemplateId = selectedGoal ? GENERIC_GOAL_TEMPLATE_IDS[selectedGoal] : undefined;
    if (genericGoalTemplateId && builtins.has(genericGoalTemplateId)) {
        return {
            version: ONBOARDING_PERSONA_RESOLVER_VERSION,
            templateId: genericGoalTemplateId,
            source: 'generic_goal',
            matchedGoal: selectedGoal,
            gaps,
        };
    }
    if (selectedGoal && !genericGoalTemplateId) pushGap(gaps, 'goal_template_missing');
    if (!builtins.has('tpl_sales')) {
        throw new Error('Onboarding persona generic default template is unavailable: tpl_sales');
    }
    return {
        version: ONBOARDING_PERSONA_RESOLVER_VERSION,
        templateId: 'tpl_sales',
        source: 'generic_default',
        matchedGoal: selectedGoal,
        gaps,
    };
}
