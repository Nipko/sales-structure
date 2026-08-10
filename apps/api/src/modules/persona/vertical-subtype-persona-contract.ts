export const VERTICAL_SUBTYPE_PERSONA_CONTRACT_VERSION = 1 as const;

export const VERTICAL_PERSONA_LOCALES = ['es', 'en', 'pt', 'fr'] as const;
export type VerticalPersonaLocale = typeof VERTICAL_PERSONA_LOCALES[number];

export interface VerticalSubtypePersonaContract {
    version: typeof VERTICAL_SUBTYPE_PERSONA_CONTRACT_VERSION;
    industry: string;
    subType: string;
    /** Safe generic template. Native subtype rules are applied by vertical bootstrap. */
    onboardingTemplateId: 'tpl_sales';
    /** Templates emitted by resolver v1 plus the v2 onboarding template. */
    managedTemplateIds: readonly string[];
    /** Exact Spanish template rules that v1 persisted before localization/bootstrap. */
    legacyTemplateRules: Readonly<Record<string, readonly string[]>>;
    nativeRules: Readonly<Record<VerticalPersonaLocale, readonly string[]>>;
}

interface ReconcileVerticalSubtypePersonaRulesInput {
    industry: string;
    subType?: string | null;
    templateId?: string | null;
    language?: string | null;
    existingRules: readonly unknown[];
    /** Exact rules derived from all four translations of the old industry definition. */
    canonicalDefinitionRules?: readonly string[];
}

const PHARMACY_RULES: VerticalSubtypePersonaContract['nativeRules'] = {
    es: [
        'Consulta el catálogo y el stock real antes de confirmar medicamentos o productos.',
        'Registra la compra como pedido de farmacia con el contacto y los artículos confirmados.',
        'No diagnostiques, prescribas ni indiques dosis; deriva toda duda clínica a un profesional de salud.',
    ],
    en: [
        'Check the catalogue and live stock before confirming medicines or products.',
        'Record the purchase as a pharmacy order with the contact and confirmed items.',
        'Do not diagnose, prescribe, or provide dosages; refer every clinical question to a healthcare professional.',
    ],
    pt: [
        'Consulte o catálogo e o estoque real antes de confirmar medicamentos ou produtos.',
        'Registre a compra como pedido de farmácia com o contato e os itens confirmados.',
        'Não diagnostique, prescreva nem indique doses; encaminhe toda dúvida clínica a um profissional de saúde.',
    ],
    fr: [
        'Consultez le catalogue et le stock réel avant de confirmer des médicaments ou des produits.',
        'Enregistrez l’achat comme une commande de pharmacie avec le contact et les articles confirmés.',
        'Ne diagnostiquez pas, ne prescrivez pas et n’indiquez aucun dosage ; adressez toute question clinique à un professionnel de santé.',
    ],
};

const AUTO_PARTS_RULES: VerticalSubtypePersonaContract['nativeRules'] = {
    es: [
        'Pregunta marca, modelo, año y versión del vehículo antes de recomendar un repuesto.',
        'Consulta catálogo y stock real, confirma compatibilidad y registra la compra como pedido.',
        'No prometas compatibilidad, precio ni entrega sin verificarlos en el sistema.',
    ],
    en: [
        'Ask for the vehicle make, model, year, and trim before recommending a part.',
        'Check the catalogue and live stock, confirm compatibility, and record the purchase as an order.',
        'Do not promise compatibility, price, or delivery until they are verified in the system.',
    ],
    pt: [
        'Pergunte marca, modelo, ano e versão do veículo antes de recomendar uma peça.',
        'Consulte o catálogo e o estoque real, confirme a compatibilidade e registre a compra como pedido.',
        'Não prometa compatibilidade, preço nem entrega sem verificá-los no sistema.',
    ],
    fr: [
        'Demandez la marque, le modèle, l’année et la version du véhicule avant de recommander une pièce.',
        'Consultez le catalogue et le stock réel, confirmez la compatibilité et enregistrez l’achat comme une commande.',
        'Ne promettez ni compatibilité, ni prix, ni livraison sans vérification dans le système.',
    ],
};

const VEHICLE_RENTAL_RULES: VerticalSubtypePersonaContract['nativeRules'] = {
    es: [
        'Confirma el vehículo, la fecha de recogida y la fecha de devolución antes de avanzar.',
        'Trata la solicitud como un alquiler por rango de fechas y verifica disponibilidad antes de confirmarla.',
        'Si el canal no permite registrar el alquiler, conserva los datos y escala al equipo; no inventes una reserva.',
    ],
    en: [
        'Confirm the vehicle, pickup date, and return date before proceeding.',
        'Handle the request as a date-range rental and verify availability before confirming it.',
        'If the channel cannot record the rental, retain the details and escalate to the team; do not invent a reservation.',
    ],
    pt: [
        'Confirme o veículo, a data de retirada e a data de devolução antes de avançar.',
        'Trate a solicitação como um aluguel por intervalo de datas e verifique a disponibilidade antes de confirmá-la.',
        'Se o canal não puder registrar o aluguel, preserve os dados e encaminhe à equipe; não invente uma reserva.',
    ],
    fr: [
        'Confirmez le véhicule, la date de prise en charge et la date de retour avant de poursuivre.',
        'Traitez la demande comme une location sur une plage de dates et vérifiez la disponibilité avant de la confirmer.',
        'Si le canal ne permet pas d’enregistrer la location, conservez les informations et transmettez-les à l’équipe ; n’inventez pas de réservation.',
    ],
};

const HARDWARE_RULES: VerticalSubtypePersonaContract['nativeRules'] = {
    es: [
        'Pregunta el uso, las especificaciones y la compatibilidad requerida antes de recomendar equipos o componentes.',
        'Consulta catálogo y stock real y registra la compra confirmada como pedido de hardware.',
        'No prometas compatibilidad, precio ni fecha de entrega sin verificarlos en el sistema.',
    ],
    en: [
        'Ask about the use case, required specifications, and compatibility before recommending equipment or components.',
        'Check the catalogue and live stock and record the confirmed purchase as a hardware order.',
        'Do not promise compatibility, price, or delivery date until they are verified in the system.',
    ],
    pt: [
        'Pergunte o uso, as especificações e a compatibilidade necessária antes de recomendar equipamentos ou componentes.',
        'Consulte o catálogo e o estoque real e registre a compra confirmada como pedido de hardware.',
        'Não prometa compatibilidade, preço nem data de entrega sem verificá-los no sistema.',
    ],
    fr: [
        'Demandez l’usage, les spécifications et la compatibilité requise avant de recommander du matériel ou des composants.',
        'Consultez le catalogue et le stock réel puis enregistrez l’achat confirmé comme une commande de matériel.',
        'Ne promettez ni compatibilité, ni prix, ni date de livraison sans vérification dans le système.',
    ],
};

const PET_BOARDING_RULES: VerticalSubtypePersonaContract['nativeRules'] = {
    es: [
        'Confirma la mascota, su tutor y el estado de vacunas antes de aceptar una estadía.',
        'Confirma el servicio, la fecha de ingreso y la fecha de salida y verifica disponibilidad y capacidad.',
        'Si el canal no permite registrar el hospedaje, conserva los datos y escala al equipo; no inventes una reserva.',
    ],
    en: [
        'Confirm the pet, its owner, and vaccination status before accepting a stay.',
        'Confirm the service, check-in date, and check-out date and verify availability and capacity.',
        'If the channel cannot record the boarding stay, retain the details and escalate to the team; do not invent a reservation.',
    ],
    pt: [
        'Confirme o pet, seu tutor e a situação das vacinas antes de aceitar uma hospedagem.',
        'Confirme o serviço, a data de entrada e a data de saída e verifique disponibilidade e capacidade.',
        'Se o canal não puder registrar a hospedagem, preserve os dados e encaminhe à equipe; não invente uma reserva.',
    ],
    fr: [
        'Confirmez l’animal, son responsable et son statut vaccinal avant d’accepter un séjour.',
        'Confirmez le service, la date d’arrivée et la date de départ puis vérifiez la disponibilité et la capacité.',
        'Si le canal ne permet pas d’enregistrer le séjour, conservez les informations et transmettez-les à l’équipe ; n’inventez pas de réservation.',
    ],
};

const HEALTH_RECEPTION_RULES = [
    'Siempre ofrece agendar una cita cuando el paciente describe síntomas',
    'Nunca des diagnósticos ni recomiendes medicamentos',
    'Confirma datos del paciente antes de agendar',
    'Envía recordatorio 24h antes de la cita',
] as const;

const HEALTH_FOLLOW_UP_RULES = [
    'Realiza seguimiento post-consulta preguntando cómo se siente el paciente',
    'Recuerda las citas de control',
    'Envía encuestas de satisfacción después de las visitas',
] as const;

const AUTO_SALES_RULES = [
    'Califica al cliente: presupuesto, tipo de vehículo, financiación, retoma',
    'Ofrece agendar prueba de manejo',
    'Nunca garantices aprobación de crédito',
] as const;

const AUTO_SERVICE_RULES = [
    'Agenda citas de mantenimiento preventivo',
    'Informa sobre garantías vigentes',
    'Nunca hagas diagnóstico mecánico sin revisión física',
] as const;

const TECHNOLOGY_SALES_RULES = [
    'Califica BANT: Budget, Authority, Need, Timeline',
    'Pregunta tamaño de equipo, industria y caso de uso primario',
    'Identifica si el lead es decision-maker o needs introducer',
    'Agenda demo SOLO con leads calificados (empresa con > 10 empleados o caso de uso claro)',
    'Para precios enterprise, NUNCA des números — siempre "depende del setup, mejor agendar demo"',
    'Captura nombre, cargo, empresa, teléfono y email corporativo',
] as const;

const PET_ATTENTION_RULES = [
    'Llama "mascota" o "peludo/a" al animal y "tutor" o "papá/mamá perruno/a" al dueño',
    'Pregunta nombre, raza, tamaño y edad de la mascota al inicio',
    'Para peluquería: pregunta tipo de corte, si tiene nudos y último baño',
    'Para guardería: pregunta fechas, si la mascota está vacunada y si socializa bien con otros animales',
    'Para paseos: confirma dirección, horario preferido y si la mascota tira de la correa',
    'Siempre confirma vacunas al día antes de agendar guardería o paseos grupales',
    'Informa sobre requisitos (vacunas, desparasitación) si el tutor no los tiene',
] as const;

const PET_SHOP_RULES = [
    'Pregunta especie (perro, gato, otro), raza, edad y tamaño antes de recomendar',
    'Para alimento: pregunta si tiene alguna condición especial (alergias, dieta veterinaria)',
    'Consulta stock real antes de confirmar disponibilidad',
    'Para pedidos de alimento recurrente, sugiere suscripción o recordatorio mensual',
    'NO recomiendes medicamentos ni suplementos clínicos — eso lo indica el veterinario',
    'Si no hay stock, sugiere alternativas similares disponibles',
] as const;

function contract(
    industry: string,
    subType: string,
    managedTemplateIds: readonly string[],
    legacyTemplateRules: VerticalSubtypePersonaContract['legacyTemplateRules'],
    nativeRules: VerticalSubtypePersonaContract['nativeRules'],
): VerticalSubtypePersonaContract {
    return Object.freeze({
        version: VERTICAL_SUBTYPE_PERSONA_CONTRACT_VERSION,
        industry,
        subType,
        onboardingTemplateId: 'tpl_sales' as const,
        managedTemplateIds: Object.freeze([...managedTemplateIds, 'tpl_sales']),
        legacyTemplateRules: Object.freeze({ ...legacyTemplateRules }),
        nativeRules: Object.freeze({ ...nativeRules }),
    });
}

const HEALTH_LEGACY = {
    tpl_salud_recepcion: HEALTH_RECEPTION_RULES,
    tpl_salud_seguimiento: HEALTH_FOLLOW_UP_RULES,
};
const AUTO_LEGACY = {
    tpl_automotriz_ventas: AUTO_SALES_RULES,
    tpl_automotriz_servicio: AUTO_SERVICE_RULES,
};
const TECHNOLOGY_LEGACY = {
    tpl_technology_ventas: TECHNOLOGY_SALES_RULES,
    tpl_technology_soporte: [],
};
const PET_LEGACY = {
    tpl_pet_atencion: PET_ATTENTION_RULES,
    tpl_pet_tienda: PET_SHOP_RULES,
};

export const VERTICAL_SUBTYPE_PERSONA_CONTRACTS: readonly VerticalSubtypePersonaContract[] = Object.freeze([
    contract('salud', 'farmacia', Object.keys(HEALTH_LEGACY), HEALTH_LEGACY, PHARMACY_RULES),
    contract('automotriz', 'repuestos', Object.keys(AUTO_LEGACY), AUTO_LEGACY, AUTO_PARTS_RULES),
    contract('automotriz', 'alquiler', Object.keys(AUTO_LEGACY), AUTO_LEGACY, VEHICLE_RENTAL_RULES),
    contract('technology', 'hardware', Object.keys(TECHNOLOGY_LEGACY), TECHNOLOGY_LEGACY, HARDWARE_RULES),
    contract('pet_services', 'guarderia', Object.keys(PET_LEGACY), PET_LEGACY, PET_BOARDING_RULES),
    contract('pet_services', 'hotel', Object.keys(PET_LEGACY), PET_LEGACY, PET_BOARDING_RULES),
]);

function normalizeIdentifier(value: string | null | undefined): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeVerticalPersonaLocale(language?: string | null): VerticalPersonaLocale {
    const base = normalizeIdentifier(language).split('-')[0];
    return (VERTICAL_PERSONA_LOCALES as readonly string[]).includes(base)
        ? base as VerticalPersonaLocale
        : 'es';
}

export function resolveVerticalSubtypePersonaContract(
    industry?: string | null,
    subType?: string | null,
): VerticalSubtypePersonaContract | null {
    const normalizedIndustry = normalizeIdentifier(industry);
    const normalizedSubtype = normalizeIdentifier(subType);
    return VERTICAL_SUBTYPE_PERSONA_CONTRACTS.find((candidate) => (
        candidate.industry === normalizedIndustry && candidate.subType === normalizedSubtype
    )) || null;
}

/**
 * Remove only byte-for-byte canonical v1 rules for a template managed by this
 * subtype contract. Any owner edit, however small, is tenant data and remains.
 * Native rules are additive and localized to the current tenant language.
 */
export function reconcileVerticalSubtypePersonaRules(
    input: ReconcileVerticalSubtypePersonaRulesInput,
): string[] {
    const contract = resolveVerticalSubtypePersonaContract(input.industry, input.subType);
    const existing = input.existingRules.filter((rule): rule is string => typeof rule === 'string');
    if (!contract) return [...existing];

    const templateId = typeof input.templateId === 'string' ? input.templateId : '';
    const managedTemplate = !!templateId && contract.managedTemplateIds.includes(templateId);
    const exactRemovals = new Set<string>();
    if (managedTemplate) {
        for (const rule of input.canonicalDefinitionRules || []) exactRemovals.add(rule);
        for (const rule of contract.legacyTemplateRules[templateId] || []) exactRemovals.add(rule);
    }

    const reconciled = existing.filter((rule) => !exactRemovals.has(rule));
    const seen = new Set(reconciled.map((rule) => rule.trim().toLowerCase()));
    const locale = normalizeVerticalPersonaLocale(input.language);
    for (const nativeRule of contract.nativeRules[locale]) {
        const key = nativeRule.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        reconciled.push(nativeRule);
    }
    return reconciled;
}
