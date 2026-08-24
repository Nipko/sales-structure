/**
 * Qué hace el agente cuando nadie lo configuró, y qué no hace nunca.
 *
 * El renderer usaba `both` como default y, con él, inyectaba siempre una
 * instrucción de venta consultiva y otra de "conectá la consulta con una
 * recomendación". Así, una recepción médica, una consulta de psicología, un
 * estudio jurídico, una veterinaria y una financiera recibían **una orden de
 * vender** que nadie eligió — en conversaciones donde la persona del otro lado
 * puede estar en crisis, reclamando o esperando un resultado clínico.
 *
 * Dos decisiones separadas y deliberadamente distintas:
 *
 * 1. El **default** por industria. Es sólo un default: si el dueño elige
 *    explícitamente `sales`, se respeta — es su negocio.
 * 2. La regla **no-pitch**, que no es un default sino un invariante: en esos
 *    rubros el agente no abre una venta sobre una consulta sensible, elija lo
 *    que elija el dueño. Se puede vender cuando el cliente pregunta por
 *    precios; no se puede convertir un síntoma o un reclamo en una oportunidad.
 */

export type AgentSkillsetMode = 'sales' | 'support' | 'both';

/**
 * Rubros donde el trato por defecto es atender, no vender.
 *
 * El criterio no es "regulado": es que la conversación típica arranca con un
 * problema de la persona (un síntoma, una deuda, un siniestro, un juicio, una
 * mascota enferma) y no con una intención de compra.
 */
export const CARE_FIRST_INDUSTRIES: readonly string[] = Object.freeze([
    'salud',
    'veterinaria',
    'finanzas',
    'seguros',
    'servicios_profesionales',
]);

export interface SkillsetPolicy {
    /** Lo que se usa cuando el agente no tiene `skillset` configurado. */
    defaultMode: AgentSkillsetMode;
    /** Si el invariante de no-pitch se emite pase lo que pase. */
    noPitch: boolean;
}

export function skillsetPolicyForIndustry(industry: unknown): SkillsetPolicy {
    const key = typeof industry === 'string' ? industry.trim().toLowerCase() : '';
    return CARE_FIRST_INDUSTRIES.includes(key)
        ? { defaultMode: 'support', noPitch: true }
        : { defaultMode: 'both', noPitch: false };
}

/**
 * El modo efectivo. La configuración explícita del dueño gana sobre el default
 * del rubro; un valor desconocido no gana nada.
 */
export function resolveAgentSkillset(
    configured: unknown,
    industry: unknown,
): AgentSkillsetMode {
    if (configured === 'sales' || configured === 'support' || configured === 'both') {
        return configured;
    }
    return skillsetPolicyForIndustry(industry).defaultMode;
}

export interface SkillsetGuidance {
    sales: string;
    support: string;
    balance: string;
    noPitch: string;
    upsell: Record<'subtle' | 'moderate' | 'aggressive', string>;
}

/**
 * El texto que se le da al modelo, en el idioma del agente.
 *
 * Estaba escrito en inglés dentro de un bloque de persona cuyo resto —nombre,
 * rol, reglas, temas prohibidos— viene en el idioma del tenant. Un prompt
 * mezclado empuja al modelo a responder en el idioma equivocado, que es
 * exactamente el síntoma que la auditoría anotó como "guidance monolingüe".
 */
const GUIDANCE: Readonly<Record<string, SkillsetGuidance>> = Object.freeze({
    es: {
        // Neutro panregional. La forma de trato concreta (usted/tú/vos) viene
        // del country pack del turno; fijar voseo acá hacía que TODOS los
        // tenants hispanohablantes recibieran instrucciones rioplatenses.
        sales: 'Actúe como vendedor consultivo: identifique la necesidad real, recomiende solo productos presentes en el catálogo del turno o devueltos por una herramienta, explique los beneficios que apliquen y guíe hacia el siguiente paso. Nunca invente productos ni precios.',
        support: 'Actúe como agente de soporte experto: responda con precisión y empatía, use los pedidos recientes o el estado del pedido para hacer seguimiento y escale cuando corresponda.',
        balance: 'Equilibre venta y soporte: resuelva primero lo que la persona necesita y después conéctelo con una recomendación útil, solo si es natural. Nunca fuerce una venta cuando alguien solo necesita ayuda.',
        noPitch: 'No convierta una consulta sensible en una oportunidad de venta. Si la persona describe un síntoma, una urgencia, un reclamo, una deuda o un problema legal, atienda eso y nada más. Puede hablar de precios y planes cuando se lo preguntan.',
        upsell: {
            subtle: 'Sugiera complementos solo cuando encajen naturalmente, sin insistir.',
            moderate: 'Ofrezca de forma proactiva un complemento o mejora relevante por conversación, cuando agregue valor.',
            aggressive: 'Busque activamente oportunidades de venta cruzada relevantes, siempre con tacto.',
        },
    },
    en: {
        sales: 'Act as a consultative salesperson: identify the real need, recommend only products present in the turn catalog or returned by a tool, explain the benefits that apply, and guide toward the next step. Never invent products or prices.',
        support: 'Act as an expert support agent: answer accurately and empathetically, use recent orders or order status for follow-up, and escalate when appropriate.',
        balance: 'Balance sales and support: resolve what the person needs first, then connect it to a useful recommendation only when it is natural. Never force a sale when someone only needs help.',
        noPitch: 'Do not turn a sensitive enquiry into a sales opportunity. If the person describes a symptom, an emergency, a complaint, a debt or a legal problem, deal with that and nothing else. You may discuss prices and plans when asked.',
        upsell: {
            subtle: 'Suggest complementary items only when they fit naturally, without insisting.',
            moderate: 'Proactively offer one relevant complement or upgrade per conversation when it adds value.',
            aggressive: 'Actively look for relevant cross-sell opportunities while remaining tactful.',
        },
    },
    pt: {
        sales: 'Atue como vendedor consultivo: identifique a necessidade real, recomende apenas produtos presentes no catálogo do turno ou devolvidos por uma ferramenta, explique os benefícios aplicáveis e conduza ao próximo passo. Nunca invente produtos nem preços.',
        support: 'Atue como agente de suporte especialista: responda com precisão e empatia, use os pedidos recentes ou o status do pedido para acompanhamento e escale quando for o caso.',
        balance: 'Equilibre venda e suporte: resolva primeiro o que a pessoa precisa e só depois conecte a uma recomendação útil, se for natural. Nunca force uma venda quando alguém só precisa de ajuda.',
        noPitch: 'Não transforme uma consulta sensível em oportunidade de venda. Se a pessoa descrever um sintoma, uma urgência, uma reclamação, uma dívida ou um problema jurídico, cuide disso e de mais nada. Você pode falar de preços e planos quando perguntarem.',
        upsell: {
            subtle: 'Sugira complementos apenas quando encaixarem naturalmente, sem insistir.',
            moderate: 'Ofereça proativamente um complemento ou upgrade relevante por conversa, quando agregar valor.',
            aggressive: 'Busque ativamente oportunidades de venda cruzada relevantes, sempre com tato.',
        },
    },
    fr: {
        sales: 'Agissez en vendeur conseil : identifiez le besoin réel, ne recommandez que des produits présents dans le catalogue du tour ou renvoyés par un outil, expliquez les bénéfices pertinents et guidez vers l’étape suivante. N’inventez jamais de produits ni de prix.',
        support: 'Agissez en agent de support expert : répondez avec précision et empathie, utilisez les commandes récentes ou le statut de commande pour le suivi, et escaladez lorsque c’est justifié.',
        balance: 'Équilibrez vente et support : réglez d’abord le besoin de la personne, puis reliez-le à une recommandation utile seulement si c’est naturel. Ne forcez jamais une vente quand quelqu’un a seulement besoin d’aide.',
        noPitch: 'Ne transformez pas une demande sensible en occasion de vente. Si la personne décrit un symptôme, une urgence, une réclamation, une dette ou un problème juridique, traitez cela et rien d’autre. Vous pouvez parler des prix et des offres si on vous le demande.',
        upsell: {
            subtle: 'Ne suggérez des compléments que lorsqu’ils s’intègrent naturellement, sans insister.',
            moderate: 'Proposez de façon proactive un complément ou une montée en gamme pertinente par conversation, quand cela apporte de la valeur.',
            aggressive: 'Recherchez activement des opportunités de vente croisée pertinentes, avec tact.',
        },
    },
});

/** Idioma del agente → guía. Un idioma no soportado cae al español. */
export function skillsetGuidanceFor(language: unknown): SkillsetGuidance {
    const code = typeof language === 'string' ? language.trim().slice(0, 2).toLowerCase() : '';
    return GUIDANCE[code] || GUIDANCE.es;
}

export const SKILLSET_GUIDANCE_LANGUAGES: readonly string[] = Object.freeze(Object.keys(GUIDANCE));
