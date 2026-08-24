import {
    decideToolAuthority,
    type EffectiveCapabilityContract,
    type ToolExecutionAuthority,
} from '@parallext/shared';

/**
 * Cómo se arma la autoridad de un turno, en un solo lugar.
 *
 * Vivía dentro de `generateResponse`, que tiene mil setecientas líneas y
 * treinta y nueve dependencias: probarlo exigía construir el orquestador
 * entero, así que en la práctica **no se probaba** — y lo que un E2E podía
 * hacer era *replicar* el armado, que es la forma más silenciosa de que la
 * prueba y el código dejen de decir lo mismo.
 *
 * Acá es una función pura de tres entradas. Lo que la prueba ejercita es
 * exactamente lo que corre en producción.
 */

/** Cuando el contrato no se pudo resolver, la autoridad nace vieja. */
const UNRESOLVED_AT = new Date(0).toISOString();

export interface TurnAuthorityInput {
    /** El contrato de este turno. Ausente = el resolutor no resolvió. */
    contract: EffectiveCapabilityContract | undefined | null;
    /** Motivo por el que el negocio no puede comprometerse, o `null`. */
    commitmentBlocked: { reason: string } | null;
    /** Lo que el dueño apagó a mano en la pantalla del agente. */
    deniedTools: readonly string[];
    /** El perfil del subtipo con el que se resolvió, para la traza. */
    subtypeProfileId?: string;
}

/**
 * La autoridad del turno, con la lista de tools que se le pase.
 *
 * `resolvedAt` sale del contrato y **no** de `now()`. La diferencia importa: si
 * el contrato no se pudo resolver, la autoridad nace vieja y el ejecutor la
 * rechaza por `authority_stale`, en vez de dejar pasar una lista vacía como si
 * fuera una decisión que alguien tomó.
 */
export function buildTurnAuthority(
    input: TurnAuthorityInput,
    allowedTools: readonly string[],
): ToolExecutionAuthority {
    return {
        source: 'turn_contract',
        allowedTools,
        commitmentBlocked: input.commitmentBlocked,
        deniedTools: input.deniedTools,
        resolvedAt: input.contract?.resolvedAt ?? UNRESOLVED_AT,
        subtypeProfileId: input.subtypeProfileId ?? input.contract?.subtypeProfileId,
    };
}

/**
 * Lo que los motores deterministas pueden invocar.
 *
 * Sale del contrato y no de la lista final de tools del turno: el motor de
 * reservas y Procedures corren ANTES de que esa lista se arme, y atarlos a ella
 * los ataría a un orden de ejecución que no controlan.
 */
export function engineAuthorityFor(input: TurnAuthorityInput): ToolExecutionAuthority {
    return buildTurnAuthority(input, input.contract?.publishedTools ?? []);
}

export const BOOKING_ENGINE_REQUIRED_TOOLS = Object.freeze([
    'list_services',
    'check_availability',
    'create_appointment',
] as const);

/**
 * Booking is a three-tool transaction, not merely `create_appointment`.
 * Starting it without the catalogue or availability read creates a flow that
 * can collect personal data but can never finish. Every entry is checked with
 * the same central authority decision used by the executor.
 */
export function bookingEngineAuthorityDecision(authority: ToolExecutionAuthority | null | undefined): {
    allowed: boolean;
    deniedTool?: string;
    reason?: string;
} {
    for (const toolName of BOOKING_ENGINE_REQUIRED_TOOLS) {
        const decision = decideToolAuthority(authority, toolName, {
            isNonCommittal: toolName !== 'create_appointment',
        });
        if (!decision.allowed) {
            return { allowed: false, deniedTool: toolName, reason: decision.reason };
        }
    }
    return { allowed: true };
}

/**
 * Conservative, deterministic detection for a request that would commit the
 * business while the effective contract is STOP/blocked.
 *
 * Nouns used in informational questions are deliberately absent: “¿cuál es la
 * política de cancelación?” and “¿qué reservas manejan?” remain ordinary reads.
 * We only match action verbs or explicit transactional phrases, so greetings
 * and FAQs never create a handoff.
 */
export function deniedOperationalIntent(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/^[¿?¡!.,;:\s]+/, '')
        .trim();
    if (!text) return null;

    if (/^(hola|hi|hello|hey|buenos? dias|buenas? (tardes|noches)|oi|ola|bonjour|salut)[!., ]*$/.test(text)) {
        return null;
    }
    if (/^(gracias|thanks?|thank you|obrigad[oa]|merci|chao|adios|bye)[!., ]*$/.test(text)) {
        return null;
    }
    // A how/where/can-I question asks for information, even when it contains
    // an operational verb. The customer can still make the actual request in
    // the next message; escalating every “¿cómo puedo pagar?” would recreate
    // the STOP-profile FAQ queue flood this detector exists to prevent.
    if (/^(como|de que manera|donde|cuando|cuanto|cual(es)?|que (metodos|formas)|aceptan|se puede|puedo)\b/.test(text)) {
        return null;
    }

    const patterns: Array<[string, RegExp]> = [
        ['booking', /\b(agendar|reservar|programar|sacar (una )?cita|pedir (una )?cita|book|schedule|make an appointment|marcar|reservar|agendar|prendre rendez-vous|reserver)\b/],
        ['purchase', /\b(comprar|lo compro|me lo llevo|hacer (el )?pedido|pedir (esto|eso|uno|una|el|la|un|una|mi|pedido|producto|plato|servicio)\b|ordenar|contratar|buy|purchase|place (an )?order|i('ll| will) take it|fazer (o )?pedido|commander|acheter)\b/],
        ['payment', /\b(pagar|generar (un )?enlace de pago|cobrar|pay|payment link|checkout|pagar|link de pagamento|payer|lien de paiement)\b/],
        ['enrollment', /\b(inscribir(me)?|matricular(me)?|registrar(me)? (en|al)|enroll|sign me up|register me|inscrever|matricular|m'inscrire|inscrire)\b/],
        ['rental', /\b(alquilar|arrendar|rentar|rent|hire|alugar|louer)\b/],
        ['quote', /\b(cotizar|quiero (una )?cotizacion|hacer(me)? (una )?cotizacion|quote me|request (a )?quote|orcamento|fazer (um )?orcamento|devis|faire (un )?devis)\b/],
        ['change', /\b(cancelar|reprogramar|cambiar (la|mi) (cita|reserva|pedido)|devolver|reembolsar|cancel|reschedule|refund|return|cancelar|reagendar|remarcar|reembolsar|annuler|reprogrammer|rembourser)\b/],
        ['request', /\b(solicitar|crear|abrir|registrar|file|submit|create|solicitar|criar|ouvrir|deposer)\s+(un |una |el |la |a |an |the |um |uma |le |la )?(siniestro|reclamo|servicio|reparacion|visita|claim|service request|repair|inspection|sinistro|servico|reparation|demande)\b/],
    ];
    for (const [category, pattern] of patterns) {
        if (pattern.test(text)) return category;
    }
    return null;
}
