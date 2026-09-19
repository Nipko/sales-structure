/**
 * D13 (sep-2026) — el lint de recetas.
 *
 * Escribir las recetas de 18 industrias y 79 subtipos en cuatro idiomas es
 * unas mil piezas de texto. A esa escala nadie revisa a mano si una respuesta
 * se le escapó un precio inventado, si un motivo de pase a una persona tiene
 * el disparador que lo hace cierto, o si una pregunta canónica contiene justo
 * la palabra que hace escalar antes de contestar. El lint es lo que convierte
 * ese trabajo en algo que una persona puede hacer sin romper nada: escribe,
 * corre, arregla lo que señala.
 *
 * Es una función pura sobre el registro. No toca la base, no necesita Nest y
 * corre en la suite, así que una receta rota es una prueba roja y no un tenant
 * con un agente que miente.
 *
 * DOS SEVERIDADES, Y LA DIFERENCIA IMPORTA:
 *
 * - `error` — la receta dice algo que no puede decir (un precio inventado, una
 *   dirección, un motivo sin disparador, un idioma faltante). Falla la suite.
 * - `gap`   — la receta todavía no existe o le falta una parte. NO falla: son
 *   las industrias que aún no se escribieron, y tratarlas como errores haría
 *   que la única forma de tener la suite verde fuera escribirlas todas de una
 *   sentada. La cobertura se reporta y se ve crecer.
 */

import {
    PLATFORM_ESCALATION_WORDS,
    PURCHASE_MODES,
    RECIPE_BLANKS,
    RECIPE_FAMILIES,
    RECIPE_SHAPE,
    blanksIn,
    foldAccents,
    type LocalizedString,
    type RecipeFamily,
    type VerticalDefinition,
    type VerticalRecipeExtras,
} from '@parallext/shared';

/** Los cuatro idiomas que toda pieza de texto del producto tiene que tener. */
export const RECIPE_LOCALES = ['es', 'en', 'pt', 'fr'] as const;

/** Los canales que un `recommendedChannels` puede nombrar. */
export const RECIPE_CHANNELS = ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'] as const;

export type RecipeLintSeverity = 'error' | 'gap';

export interface RecipeLintFinding {
    severity: RecipeLintSeverity;
    /** `moda_belleza` o `moda_belleza/barberia`. */
    scope: string;
    rule: string;
    /** Qué está mal, en una frase, con el texto exacto cuando ayuda. */
    detail: string;
}

export interface RecipeLintReport {
    findings: RecipeLintFinding[];
    errors: RecipeLintFinding[];
    gaps: RecipeLintFinding[];
    /** Cuántos ámbitos tienen receta escrita, sobre el total. */
    coverage: { written: number; total: number; scopes: string[] };
}

/**
 * Un monto escrito a mano.
 *
 * Busca la forma en que una persona escribe plata, no cualquier número: un
 * símbolo pegado a dígitos, o dígitos seguidos de la palabra de una moneda.
 * "30 fotos editadas" y "2 horas de sesión" son datos del servicio y pasan;
 * "$180.000" y "120 soles" son una afirmación sobre el precio del negocio y no.
 */
const MONEY_PATTERN = new RegExp(
    // El símbolo, o el real brasileño escrito "R$". `R` va pegado al `$` a
    // propósito y esta rama NO lleva `i`: con la bandera, `[$€R]` también
    // aceptaba una `r` minúscula y "a table for 4", "une table pour 4" y "por
    // 3" se leían como un monto inventado. Un lint que castiga la prosa
    // correcta empuja a escribir peor para pasar.
    '(?:(?:[$€]|R\\$)\\s?\\d[\\d.,]*)'
    // O el número seguido del nombre de una moneda, eso sí sin distinguir
    // mayúsculas: "120 Soles" es tan afirmación de precio como "120 soles".
    + '|(?:\\d[\\d.,]*\\s?(?:[Pp]esos|[Ss]oles|[Rr]eales|[Rr]eais|[Dd][óo]lares|COP|MXN|ARS|CLP|PEN|BRL|USD)\\b)'
    // O un número con separador de miles y nada más: "180.000", "1.500.000",
    // "12,000". Es LA forma en que se escribe un precio en la región y el
    // patrón no la veía, así que una receta generada podía afirmar un monto y
    // pasar las tres compuertas. Un año ("2026") no lleva separador y un dato
    // del servicio ("30 fotos") tampoco, así que no entran.
    + '|(?:\\b\\d{1,3}(?:[.,]\\d{3})+\\b)',
);

/** Un teléfono escrito: siete o más dígitos seguidos, con o sin separadores. */
const PHONE_PATTERN = /(?:\+\d[\d\s().-]{7,})|(?:\b\d{3}[\s.-]?\d{3}[\s.-]?\d{3,4}\b)/;

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;

/** Una dirección concreta: la palabra de vía seguida de un número. */
const ADDRESS_PATTERN = /\b(?:calle|carrera|avenida|av\.|cra\.?|cl\.?|rua|rue|street|jir[óo]n)\s*\.?\s*\d/i;

/**
 * Jerga que el dueño no tiene por qué entender (Apéndice A del diseño).
 *
 * Solo las palabras que pueden aparecer de verdad en un texto de receta; la
 * lista completa la vigila el spec de paridad i18n del panel.
 */
const RECIPE_JARGON = ['borrador', 'candidato', 'publicar', 'webhook', 'token', 'chunk', 'lead scoring', 'upsell', 'cross-sell', 'prospecto'];

const BLANK_SET: ReadonlySet<string> = new Set<string>(RECIPE_BLANKS);
const CHANNEL_SET: ReadonlySet<string> = new Set<string>(RECIPE_CHANNELS);
const FAMILY_SET: ReadonlySet<string> = new Set<string>(RECIPE_FAMILIES);
const PURCHASE_SET: ReadonlySet<string> = new Set<string>(PURCHASE_MODES);

function localeValues(value: LocalizedString | undefined | null): string[] {
    if (!value) return [];
    return RECIPE_LOCALES.map((l) => value[l]).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function missingLocales(value: LocalizedString | undefined | null): string[] {
    if (!value) return [...RECIPE_LOCALES];
    return RECIPE_LOCALES.filter((l) => typeof value[l] !== 'string' || !value[l].trim());
}

/**
 * Un espacio conocido, aceptando la mayúscula de principio de frase.
 *
 * "[Servicio] cuesta [precio]" es la forma natural de empezar una respuesta, y
 * es como el propio diseño escribe sus ejemplos. Rechazarla obligaba a
 * reescribir la frase para complacer al lint, que es exactamente lo que un lint
 * no debe provocar.
 */
function knownBlank(blank: string): boolean {
    const name = blank.trim();
    if (BLANK_SET.has(name)) return true;
    return BLANK_SET.has(name.charAt(0).toLocaleLowerCase('es') + name.slice(1));
}

class Lint {
    readonly findings: RecipeLintFinding[] = [];

    constructor(private readonly scope: string) {}

    error(rule: string, detail: string): void {
        this.findings.push({ severity: 'error', scope: this.scope, rule, detail });
    }

    gap(rule: string, detail: string): void {
        this.findings.push({ severity: 'gap', scope: this.scope, rule, detail });
    }

    /** Las cuatro traducciones existen y ninguna está vacía. */
    locales(field: string, value: LocalizedString | undefined | null): void {
        const missing = missingLocales(value);
        if (missing.length) this.error('locale_missing', `${field}: faltan ${missing.join(', ')}`);
    }

    /** Ningún texto de la receta afirma un dato que el negocio no confirmó. */
    noInventedData(field: string, value: LocalizedString | undefined | null): void {
        for (const text of localeValues(value)) {
            if (MONEY_PATTERN.test(text)) this.error('invented_price', `${field}: dice un monto ("${text.trim().slice(0, 80)}"); va [precio]`);
            if (PHONE_PATTERN.test(text)) this.error('invented_contact', `${field}: parece un teléfono ("${text.trim().slice(0, 80)}")`);
            if (EMAIL_PATTERN.test(text)) this.error('invented_contact', `${field}: dice un correo ("${text.trim().slice(0, 80)}")`);
            if (ADDRESS_PATTERN.test(text)) this.error('invented_address', `${field}: dice una dirección ("${text.trim().slice(0, 80)}"); va [dirección]`);
            const jargon = RECIPE_JARGON.find((w) => foldAccents(text).includes(foldAccents(w)));
            if (jargon) this.error('jargon', `${field}: usa "${jargon}", que el dueño no tiene por qué entender`);
        }
    }

    /** Todo espacio en blanco tiene nombre conocido y una tarjeta que lo llena. */
    blanks(field: string, value: LocalizedString | undefined | null): void {
        for (const text of localeValues(value)) {
            for (const blank of blanksIn(text)) {
                if (!knownBlank(blank)) {
                    this.error('blank_unknown', `${field}: "[${blank}]" no está en la lista de espacios; ninguna pantalla sabe pedirlo`);
                }
            }
        }
    }
}

function lintRecipeExtras(lint: Lint, recipe: VerticalRecipeExtras, agent: VerticalDefinition['agent']): void {
    if (recipe.family && !FAMILY_SET.has(recipe.family)) {
        lint.error('family_unknown', `family "${recipe.family}" no existe`);
    }

    if (!recipe.purchaseModes?.length) {
        lint.gap('purchase_modes_missing', 'sin modo de compra: la tarjeta "¿Cómo te compran?" nace vacía');
    } else {
        for (const mode of recipe.purchaseModes) {
            if (!PURCHASE_SET.has(mode)) lint.error('purchase_mode_unknown', `modo de compra "${mode}" no existe`);
        }
    }

    if (!recipe.mainInstructions) {
        lint.gap('instructions_missing', 'sin instrucciones principales');
    } else {
        lint.locales('mainInstructions', recipe.mainInstructions);
        lint.noInventedData('mainInstructions', recipe.mainInstructions);
        lint.blanks('mainInstructions', recipe.mainInstructions);
    }

    checkList(lint, 'whenUnsure', recipe.whenUnsure, RECIPE_SHAPE.whenUnsure, RECIPE_SHAPE.whenUnsure);
    checkList(lint, 'testQuestions', recipe.testQuestions, RECIPE_SHAPE.testQuestions, RECIPE_SHAPE.testQuestions);

    // Un motivo visible sin disparador es una promesa que el motor no cumple:
    // la ficha dice "pide descuento → pasa a una persona" y el runtime nunca
    // pasa, porque nadie escribió "descuento" entre los disparadores.
    //
    // El vínculo va ESCRITO y no adivinado. La versión anterior emparejaba por
    // coincidencia de palabras y aceptaba fichas falsas: "Solicitud de cupo o
    // pago de la matrícula" pasaba por la palabra "solicitud" mientras el único
    // disparador real era la frase completa "solicitud de beca", así que un
    // cliente que escribía "quiero pagar la matrícula" no escalaba nunca.
    if (!recipe.handoffReasons?.length) {
        lint.gap('handoffReasons_missing', 'sin motivos visibles de pase a una persona');
    } else {
        if (recipe.handoffReasons.length < RECIPE_SHAPE.handoffReasonsMin
            || recipe.handoffReasons.length > RECIPE_SHAPE.handoffReasonsMax) {
            lint.error('handoffReasons_count', `${recipe.handoffReasons.length} motivos; se esperan entre ${RECIPE_SHAPE.handoffReasonsMin} y ${RECIPE_SHAPE.handoffReasonsMax}`);
        }
        const triggers = foldAccents(agent.handoffTriggers?.es ?? '')
            .split('|').map((t) => t.trim()).filter(Boolean);
        // El vínculo se declara contra la lista en ESPAÑOL, pero el motor
        // compara contra la del idioma del tenant, y las de en/pt/fr son más
        // cortas en casi todas las industrias. Un negocio brasileño puede tener
        // menos escaladas de las que su panel promete. No falla la suite —es
        // una deuda de traducción anterior a esta ola— pero queda contada, y
        // hay que saldarla antes de que D14 pinte las fichas.
        for (const locale of ['en', 'pt', 'fr'] as const) {
            const count = (agent.handoffTriggers?.[locale] ?? '')
                .split('|').map((t) => t.trim()).filter(Boolean).length;
            if (count < triggers.length) {
                lint.gap('handoff_triggers_untranslated', `handoffTriggers.${locale} tiene ${count} de los ${triggers.length} del español: ese tenant escala menos de lo que su panel dice`);
            }
        }
        recipe.handoffReasons.forEach((reason, i) => {
            lint.locales(`handoffReasons[${i}].text`, reason.text);
            lint.noInventedData(`handoffReasons[${i}].text`, reason.text);
            lint.blanks(`handoffReasons[${i}].text`, reason.text);
            const declared = foldAccents(reason.trigger ?? '').trim();
            if (!declared) {
                lint.error('handoff_reason_without_trigger', `motivo "${reason.text?.es}" no declara con qué disparador se cumple`);
            } else if (!triggers.includes(declared)) {
                lint.error('handoff_trigger_not_in_agent', `motivo "${reason.text?.es}" declara el disparador "${reason.trigger}", que no está en agent.handoffTriggers.es`);
            }
        });
    }

    if (!recipe.canonicalQuestions?.length) {
        lint.gap('questions_missing', 'sin las 5 preguntas que el negocio recibe todos los días');
    } else {
        if (recipe.canonicalQuestions.length !== RECIPE_SHAPE.canonicalQuestions) {
            lint.error('questions_count', `${recipe.canonicalQuestions.length} preguntas canónicas; el diseño fija ${RECIPE_SHAPE.canonicalQuestions}`);
        }
        recipe.canonicalQuestions.forEach((q, i) => {
            lint.locales(`canonicalQuestions[${i}].question`, q.question);
            lint.locales(`canonicalQuestions[${i}].answer`, q.answer);
            // La PREGUNTA también se revisa. Se le escapaba porque "la pregunta
            // la hace el cliente", pero este texto lo escribe la receta y se le
            // muestra al dueño como una de las tres para probar al agente: un
            // espacio sin llenar ahí sale tal cual al chat de prueba.
            lint.noInventedData(`canonicalQuestions[${i}].question`, q.question);
            lint.blanks(`canonicalQuestions[${i}].question`, q.question);
            lint.noInventedData(`canonicalQuestions[${i}].answer`, q.answer);
            lint.blanks(`canonicalQuestions[${i}].answer`, q.answer);
            // Una pregunta que contiene una palabra de escalado se escala antes
            // de contestarse: el dueño ve al agente pasando a una persona algo
            // que él mismo dejó escrito.
            const question = foldAccents(q.question.es ?? '');
            const word = PLATFORM_ESCALATION_WORDS.find((w) => question.includes(foldAccents(w)));
            if (word) {
                lint.error('question_escalates', `pregunta ${i + 1} contiene "${word}": el motor escala antes de responderla`);
            }
            for (const blank of q.fills ?? []) {
                if (!BLANK_SET.has(blank)) lint.error('blank_unknown', `canonicalQuestions[${i}].fills: "${blank}" no está en la lista`);
            }
        });
    }

    if (!recipe.recommendedChannels?.length) {
        lint.gap('channels_missing', 'sin canal recomendado: los cinco quedan en pie de igualdad');
    } else {
        if (recipe.recommendedChannels.length > RECIPE_SHAPE.recommendedChannelsMax) {
            lint.error('channels_count', `${recipe.recommendedChannels.length} canales recomendados; máximo ${RECIPE_SHAPE.recommendedChannelsMax}`);
        }
        recipe.recommendedChannels.forEach((c, i) => {
            if (!CHANNEL_SET.has(c.channel)) lint.error('channel_unknown', `recommendedChannels[${i}]: "${c.channel}" no es un canal`);
            lint.locales(`recommendedChannels[${i}].why`, c.why);
            lint.noInventedData(`recommendedChannels[${i}].why`, c.why);
        });
    }

    if (!recipe.conversationExamples?.length) {
        lint.gap('examples_missing', 'sin ejemplos de conversación');
    } else {
        if (recipe.conversationExamples.length !== RECIPE_SHAPE.conversationExamples) {
            lint.error('examples_count', `${recipe.conversationExamples.length} ejemplos; el diseño fija ${RECIPE_SHAPE.conversationExamples}`);
        }
        recipe.conversationExamples.forEach((e, i) => {
            lint.locales(`conversationExamples[${i}].customer`, e.customer);
            lint.locales(`conversationExamples[${i}].agent`, e.agent);
            // La línea del CLIENTE se muestra en pantalla igual que la del
            // agente, así que un "[precio]" ahí se ve como un error del producto.
            lint.blanks(`conversationExamples[${i}].customer`, e.customer);
            lint.noInventedData(`conversationExamples[${i}].agent`, e.agent);
            lint.blanks(`conversationExamples[${i}].agent`, e.agent);
        });
    }
}

function checkList(lint: Lint, field: string, list: LocalizedString[] | undefined, min: number, max: number): void {
    if (!list?.length) {
        lint.gap(`${field}_missing`, `sin ${field}`);
        return;
    }
    if (list.length < min || list.length > max) {
        lint.error(`${field}_count`, `${list.length} elementos en ${field}; se esperan entre ${min} y ${max}`);
    }
    list.forEach((value, i) => {
        lint.locales(`${field}[${i}]`, value);
        lint.noInventedData(`${field}[${i}]`, value);
        lint.blanks(`${field}[${i}]`, value);
    });
}

/**
 * Lo que la definición base tiene que cumplir aunque todavía no tenga receta.
 *
 * Son las reglas que ya estaban implícitas y que nadie verificaba: el agente
 * con nombre propio, los servicios con su referencia en la moneda de
 * referencia, y el cero que dice cuál de sus dos significados tiene.
 */
function lintDefinitionBase(lint: Lint, definition: VerticalDefinition): void {
    const name = definition.agent?.name?.es ?? '';
    if (!name.trim() || /^asistente$/i.test(name.trim())) {
        lint.error('agent_placeholder_name', `el agente se llama "${name}": el alta saluda con "Preparamos a ${name}", que se lee como "no preparamos nada"`);
    }

    for (const faq of definition.faqs ?? []) {
        lint.locales('faq.question', faq.question);
        lint.locales('faq.answer', faq.answer);
        lint.noInventedData('faq.answer', faq.answer);
    }

    (definition.services ?? []).forEach((svc, i) => {
        lint.locales(`services[${i}].name`, svc.name);
        if (svc.currency !== 'COP') {
            lint.error('service_reference_currency', `services[${i}] "${svc.name.es}": la referencia va en COP; la moneda del negocio se resuelve al sembrar`);
        }
        if (!svc.price && !svc.priceStatus) {
            lint.error('zero_price_undeclared', `services[${i}] "${svc.name.es}": precio 0 sin decir si es "se cotiza" o "falta confirmarlo"`);
        }
    });
}

export interface LintRecipesInput {
    registry: Readonly<Record<string, VerticalDefinition>>;
    /** `industria/subtipo` → la receta compuesta, tal como la ve el alta. */
    resolve: (industry: string, subType: string | null) => VerticalDefinition;
}

/**
 * Corre el lint sobre cada industria y cada subtipo, tal como los recibe un
 * tenant nuevo: la definición ya compuesta con su capa, no la base.
 */
export function lintRecipes({ registry, resolve }: LintRecipesInput): RecipeLintReport {
    const findings: RecipeLintFinding[] = [];
    const scopes: string[] = [];
    let written = 0;
    let total = 0;

    for (const industry of Object.keys(registry).sort()) {
        const base = registry[industry];
        const subTypes: Array<string | null> = [null, ...(base.subTypes ?? []).map((s) => s.key)];
        for (const subType of subTypes) {
            const scope = subType ? `${industry}/${subType}` : industry;
            const definition = resolve(industry, subType);
            const lint = new Lint(scope);
            total += 1;

            lintDefinitionBase(lint, definition);

            if (definition.recipe) {
                written += 1;
                scopes.push(scope);
                lintRecipeExtras(lint, definition.recipe, definition.agent);
            } else {
                lint.gap('recipe_missing', 'todavía sin receta: el día 0 muestra las tarjetas que salen de la definición base');
            }

            findings.push(...lint.findings);
        }
    }

    return {
        findings,
        errors: findings.filter((f) => f.severity === 'error'),
        gaps: findings.filter((f) => f.severity === 'gap'),
        coverage: { written, total, scopes },
    };
}

/** Una línea por hallazgo, para que un fallo de la suite se lea sin abrir nada. */
export function formatRecipeLint(findings: RecipeLintFinding[]): string {
    return findings.map((f) => `  [${f.severity}] ${f.scope} · ${f.rule}: ${f.detail}`).join('\n');
}
