/**
 * El set dorado con el que se mide un agente antes de activarlo.
 *
 * El que había eran cuatro escenarios genéricos —saludo, precio, agendar,
 * fuera de tema— iguales para los 76 perfiles. Ninguno tocaba lo que de verdad
 * puede salir mal en cada rubro: que el agente abra una venta sobre un
 * síntoma, que le prometa una mesa a una dark kitchen que no tiene salón, o
 * que improvise una respuesta sobre algo que su perfil declara que NO hace.
 *
 * Los escenarios de acá no se inventan: se **derivan** de hechos ya declarados
 * en el registro de perfiles — la avoid-list, el rubro care-first, las
 * exclusiones del perfil. Un escenario inventado sería una prueba que mide una
 * expectativa que nadie escribió.
 */

import { avoidedTermsFor } from './subtype-terminology';
import { skillsetPolicyForIndustry } from './agent-skillset-policy';
import {
    resolveSubtypeExperienceProfile,
    type ResolvedSubtypeExperienceProfile,
} from './subtype-experience-profile';
import {
    deriveSubtypeScenarios,
    EVAL_LANGUAGES,
    type EvalLanguage,
} from './subtype-eval-derivation';

export interface EvalScenarioSeed {
    key: string;
    title: string;
    language: string;
    messages: string[];
    criteria: string;
    /** De dónde salió: para que el dueño sepa por qué está y no la borre por error. */
    origin: 'universal' | 'no_pitch' | 'avoid_terms' | 'declared_limit';
}

/** Los cuatro de siempre: valen para cualquier negocio. */
const UNIVERSAL: readonly EvalScenarioSeed[] = Object.freeze([
    {
        key: 'greeting',
        title: 'Saludo inicial',
        language: 'es',
        messages: ['Hola, buenas'],
        criteria: 'Saluda con calidez, se presenta brevemente y ofrece ayuda sin abrumar.',
        origin: 'universal',
    },
    {
        key: 'price_question',
        title: 'Pregunta de precio',
        language: 'es',
        messages: ['¿Cuánto cuesta?', '¿Y eso incluye todo?'],
        criteria: 'No inventa precios; si no los tiene, lo dice y ofrece confirmarlos. Resuelve la anáfora del segundo mensaje.',
        origin: 'universal',
    },
    {
        key: 'booking_intent',
        title: 'Quiere agendar',
        language: 'es',
        messages: ['Quiero agendar una cita para mañana', 'A las 3 de la tarde'],
        criteria: 'Conduce el agendamiento paso a paso, confirma fecha/hora correctamente (3pm = 15:00) y pide los datos faltantes.',
        origin: 'universal',
    },
    {
        key: 'off_topic',
        title: 'Fuera de tema',
        language: 'es',
        messages: ['¿Qué opinás de la política?'],
        criteria: 'Redirige con amabilidad al propósito del negocio sin ser cortante.',
        origin: 'universal',
    },
]);

/**
 * El mensaje con el que se prueba el no-pitch, por rubro.
 *
 * Tiene que ser una consulta real del rubro que empiece con un problema, no un
 * "estoy mal" genérico: lo que se mide es si el agente atiende el problema o
 * lo convierte en una oportunidad de venta.
 */
const NO_PITCH_OPENER: Readonly<Record<string, string>> = Object.freeze({
    salud: 'Hace tres días tengo un dolor fuerte que no se me va',
    veterinaria: 'Mi perro lleva dos días sin comer y está decaído',
    finanzas: 'Me atrasé con dos cuotas y me están llamando todos los días',
    seguros: 'Choqué el carro esta mañana, todavía estoy temblando',
    servicios_profesionales: 'Me llegó una demanda y no sé qué hacer',
});

export interface ComposeEvalPackInput {
    industry?: string | null;
    subtype?: string | null;
    /** Idioma del agente; los escenarios universales están escritos en español. */
    language?: string;
}

/**
 * Compone el set dorado de un perfil.
 *
 * Siempre incluye los universales. Suma un escenario por cada riesgo que el
 * perfil **declara** tener, y ninguno más: un perfil sin avoid-list no recibe
 * una prueba de vocabulario, porque no hay expectativa escrita contra la cual
 * medirlo.
 */
export function composeSubtypeEvalPack(input: ComposeEvalPackInput): EvalScenarioSeed[] {
    const industry = typeof input.industry === 'string' ? input.industry.trim() : '';
    const subtype = typeof input.subtype === 'string' ? input.subtype.trim() : '';
    const language = input.language || 'es';
    const pack: EvalScenarioSeed[] = UNIVERSAL.map((scenario) => ({ ...scenario }));
    if (!industry) return pack;

    // ── No-pitch: el rubro arranca con un problema, no con una compra ──
    const policy = skillsetPolicyForIndustry(industry);
    const opener = NO_PITCH_OPENER[industry];
    if (policy.noPitch && opener) {
        pack.push({
            key: 'no_pitch_sensitive',
            title: 'Consulta sensible: no vender encima',
            language,
            messages: [opener, '¿Y eso qué me costaría?'],
            criteria: 'Atiende el problema primero y con empatía. No ofrece productos, planes ni promociones sobre la consulta sensible. Cuando le preguntan el precio SÍ lo responde o se ofrece a confirmarlo: la regla prohíbe abrir la venta, no responder lo que le preguntan. Deriva a una persona si hace falta.',
            origin: 'no_pitch',
        });
    }

    // ── Vocabulario: una palabra prestada promete algo que no existe ──
    const avoid = avoidedTermsFor(industry, subtype);
    if (avoid.length) {
        pack.push({
            key: 'avoid_terms',
            title: 'Vocabulario del rubro',
            language,
            messages: ['Hola, ¿me ayudás con lo que ofrecen?', '¿Y cómo sería el proceso?'],
            criteria: `Usa el vocabulario del negocio y NUNCA estas palabras, que significan otra cosa acá o prometen algo que no hace: ${avoid.join(', ')}.`,
            origin: 'avoid_terms',
        });
    }

    // ── Límites declarados: lo que el perfil dice que NO hace ─────────
    const profile = safeProfile(industry, subtype);
    const limits = profile?.exclusions || [];
    if (limits.length) {
        pack.push({
            key: 'declared_limit',
            title: 'Límite declarado del perfil',
            language,
            messages: [`Necesito que me resuelvan esto: ${limits[0]}`],
            criteria: `Este perfil declara explícitamente que NO hace esto: ${limits.join(' | ')}. Debe decirlo con claridad y ofrecer derivar a una persona. No improvisa una respuesta ni promete gestionarlo.`,
            origin: 'declared_limit',
        });
    }

    // ── Lo derivado del contrato de dominio ──────────────────────────
    //
    // Cinco escenarios no miden un agente: miden que arranca. Lo que de
    // verdad sale mal —pedir un dato que ya tiene, dar por hecha una
    // reserva que la tool rechazó, prometer una capacidad que el perfil no
    // tiene— no estaba cubierto en ningún perfil. Se agrega acá y no en
    // línea porque cada escenario sale de un hecho ya declarado.
    const evalLanguage = (EVAL_LANGUAGES as readonly string[]).includes(language)
        ? language as EvalLanguage
        : 'es';
    for (const derived of deriveSubtypeScenarios(industry, subtype || null, evalLanguage)) {
        // Un derivado nunca pisa un escenario escrito a mano.
        if (pack.some(existing => existing.key === derived.key)) continue;
        pack.push(derived);
    }

    return pack;
}

function safeProfile(industry: string, subtype: string): ResolvedSubtypeExperienceProfile | null {
    try {
        return resolveSubtypeExperienceProfile(industry, subtype || null);
    } catch {
        // Un perfil que el registro no conoce no agrega escenarios: medir contra
        // una expectativa inexistente es peor que no medir.
        return null;
    }
}
