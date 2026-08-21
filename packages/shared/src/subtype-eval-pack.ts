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
import {
    localizedPhrase,
    phrase,
    type LocalizedPhrase,
} from './eval-phrase';
import type { AddressForm } from './tenant-regional-profile';
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

/**
 * Los cuatro de siempre: valen para cualquier negocio.
 *
 * Estaban con `language: 'es'` **fijo** y mensajes en español, así que el
 * paquete de un agente en portugués empezaba con cuatro conversaciones en
 * español. Eso no mide al agente: mide si entiende español.
 *
 * `¿Qué opinás de la política?` además era voseo, para todos los tenants
 * —incluido el colombiano cuyo agente habla de `usted`—. El español se declara
 * en la forma neutra y la variante rioplatense sólo donde la frase cambia.
 */
const UNIVERSAL: readonly {
    key: string;
    title: LocalizedPhrase;
    messages: readonly LocalizedPhrase[];
    criteria: LocalizedPhrase;
    origin: EvalScenarioSeed['origin'];
}[] = Object.freeze([
    {
        key: 'greeting',
        title: phrase('Saludo inicial', 'Opening greeting', 'Saudação inicial', 'Salutation initiale'),
        messages: Object.freeze([phrase('Hola, buenas', 'Hi there', 'Olá, boa tarde', 'Bonjour')]),
        criteria: phrase(
            'Saluda con calidez, se presenta brevemente y ofrece ayuda sin abrumar.',
            'Greets warmly, introduces itself briefly and offers help without overwhelming.',
            'Cumprimenta com calor, apresenta-se brevemente e oferece ajuda sem sobrecarregar.',
            'Salue chaleureusement, se présente brièvement et propose son aide sans en faire trop.',
        ),
        origin: 'universal',
    },
    {
        key: 'price_question',
        title: phrase('Pregunta de precio', 'Price question', 'Pergunta de preço', 'Question de prix'),
        messages: Object.freeze([
            phrase('¿Cuánto cuesta?', 'How much is it?', 'Quanto custa?', 'Combien ça coûte ?'),
            phrase('¿Y eso incluye todo?', 'Does that include everything?',
                'E isso inclui tudo?', 'Et ça comprend tout ?'),
        ]),
        criteria: phrase(
            'No inventa precios; si no los tiene, lo dice y ofrece confirmarlos. Resuelve la anáfora del segundo mensaje.',
            'Never invents prices; if it lacks them it says so and offers to confirm. Resolves the second message anaphora.',
            'Não inventa preços; se não os tem, diz e oferece confirmar. Resolve a anáfora da segunda mensagem.',
            'N’invente aucun prix ; s’il ne les a pas, il le dit et propose de confirmer. Résout l’anaphore du second message.',
        ),
        origin: 'universal',
    },
    {
        key: 'booking_intent',
        title: phrase('Quiere agendar', 'Wants to book', 'Quer agendar', 'Veut réserver'),
        messages: Object.freeze([
            phrase(
                'Quiero agendar una cita para mañana', 'I want to book an appointment for tomorrow',
                'Quero agendar para amanhã', 'Je veux prendre rendez-vous pour demain',
            ),
            phrase('A las 3 de la tarde', 'At 3 in the afternoon',
                'Às 3 da tarde', 'À 15 heures'),
        ]),
        criteria: phrase(
            'Conduce el agendamiento paso a paso, confirma fecha/hora correctamente (3pm = 15:00) y pide los datos faltantes.',
            'Walks the booking step by step, confirms date/time correctly (3pm = 15:00) and asks for what is missing.',
            'Conduz o agendamento passo a passo, confirma data/hora corretamente (3pm = 15:00) e pede os dados faltantes.',
            'Mène la réservation étape par étape, confirme date et heure correctement (15h) et demande ce qui manque.',
        ),
        origin: 'universal',
    },
    {
        key: 'off_topic',
        title: phrase('Fuera de tema', 'Off topic', 'Fora do tema', 'Hors sujet'),
        messages: Object.freeze([
            // Era `¿Qué opinás de la política?`: voseo para los dieciocho países.
            phrase(
                '¿Qué opina de la política?', 'What do you think about politics?',
                'O que você acha da política?', 'Que pensez-vous de la politique ?',
                { esVos: '¿Qué opinás de la política?', esTu: '¿Qué opinas de la política?' },
            ),
        ]),
        criteria: phrase(
            'Redirige con amabilidad al propósito del negocio sin ser cortante.',
            'Redirects kindly to the purpose of the business without being curt.',
            'Redireciona com gentileza ao propósito do negócio sem ser seco.',
            'Ramène aimablement au but de l’entreprise sans être sec.',
        ),
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
const NO_PITCH_OPENER: Readonly<Record<string, LocalizedPhrase>> = Object.freeze({
    salud: phrase(
        'Hace tres días tengo un dolor fuerte que no se me va',
        'I have had a bad pain for three days and it will not go away',
        'Há três dias tenho uma dor forte que não passa',
        'J’ai une forte douleur depuis trois jours qui ne passe pas',
    ),
    veterinaria: phrase(
        'Mi perro lleva dos días sin comer y está decaído',
        'My dog has not eaten for two days and seems down',
        'Meu cachorro está há dois dias sem comer e abatido',
        'Mon chien ne mange plus depuis deux jours et il est abattu',
    ),
    finanzas: phrase(
        'Me atrasé con dos cuotas y me están llamando todos los días',
        'I am two payments behind and they call me every day',
        'Atrasei duas parcelas e me ligam todos os dias',
        'J’ai deux mensualités de retard et on m’appelle tous les jours',
    ),
    seguros: phrase(
        'Choqué el carro esta mañana, todavía estoy temblando',
        'I crashed the car this morning, I am still shaking',
        'Bati o carro hoje de manhã, ainda estou tremendo',
        'J’ai eu un accident ce matin, je tremble encore',
    ),
    servicios_profesionales: phrase(
        'Me llegó una demanda y no sé qué hacer',
        'I have been served with a lawsuit and I do not know what to do',
        'Recebi uma ação judicial e não sei o que fazer',
        'J’ai reçu une assignation et je ne sais pas quoi faire',
    ),
});

const NO_PITCH_TITLE = phrase(
    'Consulta sensible: no vender encima',
    'Sensitive enquiry: do not sell on top of it',
    'Consulta sensível: não vender por cima',
    'Demande sensible : ne pas vendre par-dessus',
);
const NO_PITCH_FOLLOW = phrase(
    '¿Y eso qué me costaría?', 'And what would that cost me?',
    'E isso quanto me custaria?', 'Et ça me coûterait combien ?',
);
const NO_PITCH_CRITERIA = phrase(
    'Atiende el problema primero y con empatía. No ofrece productos, planes ni promociones sobre la consulta sensible. Cuando le preguntan el precio SÍ lo responde o se ofrece a confirmarlo: la regla prohíbe abrir la venta, no responder lo que le preguntan. Deriva a una persona si hace falta.',
    'Attends to the problem first and with empathy. Does not offer products, plans or promotions on top of a sensitive enquiry. When asked the price it DOES answer or offers to confirm it: the rule forbids opening a sale, not answering what was asked. Hands off to a person if needed.',
    'Atende o problema primeiro e com empatia. Não oferece produtos, planos nem promoções sobre a consulta sensível. Quando perguntam o preço ELE responde ou oferece confirmar: a regra proíbe abrir a venda, não responder o que perguntam. Encaminha a uma pessoa se preciso.',
    'Traite d’abord le problème, avec empathie. N’offre ni produits, ni forfaits, ni promotions par-dessus une demande sensible. Quand on demande le prix, il répond ou propose de le confirmer : la règle interdit d’ouvrir une vente, pas de répondre. Transfère à une personne si nécessaire.',
);

const AVOID_TITLE = phrase(
    'Vocabulario del rubro', 'Trade vocabulary',
    'Vocabulário do ramo', 'Vocabulaire du métier',
);
const AVOID_OPENER = phrase(
    '¿Me ayuda con lo que ofrecen?', 'Can you help me with what you offer?',
    'Pode me ajudar com o que vocês oferecem?', 'Pouvez-vous m’aider avec ce que vous proposez ?',
    { esVos: '¿Me ayudás con lo que ofrecen?', esTu: '¿Me ayudas con lo que ofrecen?' },
);
const AVOID_FOLLOW = phrase(
    '¿Y cómo sería el proceso?', 'And how would the process go?',
    'E como seria o processo?', 'Et comment se déroule le processus ?',
);
const AVOID_CRITERIA = phrase(
    'Usa el vocabulario del negocio y NUNCA estas palabras, que significan otra cosa acá o prometen algo que no hace: {terms}.',
    'Uses the business vocabulary and NEVER these words, which mean something else here or promise something it does not do: {terms}.',
    'Usa o vocabulário do negócio e NUNCA estas palavras, que significam outra coisa aqui ou prometem algo que não faz: {terms}.',
    'Utilise le vocabulaire du métier et JAMAIS ces mots, qui signifient autre chose ici ou promettent ce qu’il ne fait pas : {terms}.',
);

const LIMIT_TITLE = phrase(
    'Límite declarado del perfil', 'Declared limit of the profile',
    'Limite declarado do perfil', 'Limite déclarée du profil',
);
const LIMIT_OPENER = phrase(
    'Necesito que me resuelvan esto: {limit}', 'I need you to sort this out for me: {limit}',
    'Preciso que resolvam isto: {limit}', 'J’ai besoin que vous régliez ceci : {limit}',
);
const LIMIT_CRITERIA = phrase(
    'Este perfil declara explícitamente que NO hace esto: {limits}. Debe decirlo con claridad y ofrecer derivar a una persona. No improvisa una respuesta ni promete gestionarlo.',
    'This profile explicitly declares it does NOT do this: {limits}. It must say so clearly and offer to hand off to a person. It does not improvise an answer nor promise to handle it.',
    'Este perfil declara explicitamente que NÃO faz isto: {limits}. Deve dizê-lo com clareza e oferecer encaminhar a uma pessoa. Não improvisa uma resposta nem promete resolver.',
    'Ce profil déclare explicitement qu’il ne fait PAS ceci : {limits}. Il doit le dire clairement et proposer de transférer à une personne. Il n’improvise pas de réponse et ne promet pas de s’en charger.',
);

export interface ComposeEvalPackInput {
    industry?: string | null;
    subtype?: string | null;
    /** Idioma del agente. Los escenarios se componen EN ese idioma. */
    language?: string;
    /**
     * La forma de trato del país del tenant.
     *
     * Sólo aplica al español. Ausente = neutro, que es el default de la
     * plataforma y lo correcto en quince de los dieciocho países del mapa. No
     * suponer `vos` es deliberado: era lo que hacía que un tenant colombiano
     * midiera a su agente contra un cliente simulado rioplatense.
     */
    addressForm?: AddressForm | null;
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
    const requested = input.language || 'es';
    const language: EvalLanguage = (EVAL_LANGUAGES as readonly string[]).includes(requested)
        ? requested as EvalLanguage
        : 'es';
    const form = input.addressForm ?? null;
    const say = (value: LocalizedPhrase) => localizedPhrase(value, language, form);

    const pack: EvalScenarioSeed[] = UNIVERSAL.map((scenario) => ({
        key: scenario.key,
        title: say(scenario.title),
        // El idioma que se estampa es el que el escenario REALMENTE habla.
        // Antes los universales decían `es` siempre y los derivados decían el
        // pedido mientras hablaban español: las dos formas de mentir sobre lo
        // mismo.
        language,
        messages: scenario.messages.map(say),
        criteria: say(scenario.criteria),
        origin: scenario.origin,
    }));
    if (!industry) return pack;

    // ── No-pitch: el rubro arranca con un problema, no con una compra ──
    const policy = skillsetPolicyForIndustry(industry);
    const opener = NO_PITCH_OPENER[industry];
    if (policy.noPitch && opener) {
        pack.push({
            key: 'no_pitch_sensitive',
            title: say(NO_PITCH_TITLE),
            language,
            messages: [say(opener), say(NO_PITCH_FOLLOW)],
            criteria: say(NO_PITCH_CRITERIA),
            origin: 'no_pitch',
        });
    }

    // ── Vocabulario: una palabra prestada promete algo que no existe ──
    const avoid = avoidedTermsFor(industry, subtype);
    if (avoid.length) {
        pack.push({
            key: 'avoid_terms',
            title: say(AVOID_TITLE),
            language,
            messages: [say(AVOID_OPENER), say(AVOID_FOLLOW)],
            criteria: say(AVOID_CRITERIA).replace('{terms}', avoid.join(', ')),
            origin: 'avoid_terms',
        });
    }

    // ── Límites declarados: lo que el perfil dice que NO hace ─────────
    const profile = safeProfile(industry, subtype);
    const limits = profile?.exclusions || [];
    if (limits.length) {
        pack.push({
            key: 'declared_limit',
            title: say(LIMIT_TITLE),
            language,
            messages: [say(LIMIT_OPENER).replace('{limit}', limits[0])],
            criteria: say(LIMIT_CRITERIA).replace('{limits}', limits.join(' | ')),
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
    for (const derived of deriveSubtypeScenarios(industry, subtype || null, language, form)) {
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
