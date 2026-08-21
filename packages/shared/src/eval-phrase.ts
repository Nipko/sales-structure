import type { AddressForm } from './tenant-regional-profile';

/**
 * ═══ EL SET DORADO ESTABA EN ESPAÑOL EN LOS CUATRO IDIOMAS ═══
 *
 * `composeSubtypeEvalPack` acepta un idioma y devolvía, para todos:
 *
 * - Los cuatro escenarios universales con `language: 'es'` **fijo**: mensajes y
 *   criterio en español, en cualquier paquete.
 * - Los escenarios de no-pitch, vocabulario y límite declarado **estampados**
 *   con el idioma pedido y escritos en español. Peor que los universales: dicen
 *   estar en inglés y no lo están.
 *
 * Medir un agente en portugués con un cliente simulado que escribe en español y
 * un criterio en español no mide al agente: mide si entiende español. Y el
 * punto 16 —"correr los golden evals reales en ES/EN/PT/FR"— no se puede
 * cumplir mientras el paquete sea el mismo en los cuatro.
 *
 * ═══ Y EL ESPAÑOL ERA UNO SOLO, EN VOSEO ═══
 *
 * `¿Qué opinás de la política?`, `¿me ayudás con lo que ofrecen?`, `resolvelo
 * vos`, `Che, ¿ustedes hacen X?`. Rioplatense para todos los tenants, incluido
 * el colombiano cuyo agente habla de `usted` — la plataforma **ya sabe** la
 * forma de trato de cada país (`ADDRESS_FORM_BY_COUNTRY`) y el set dorado no la
 * miraba.
 *
 * Un cliente simulado que trata de `vos` a un agente configurado en `usted`
 * mide la conversación equivocada: el agente parece frío o parece que copia el
 * registro, y ninguna de las dos cosas es lo que se quiso probar.
 *
 * Por eso el español se declara en la forma **neutra/usted** —que es el default
 * de la plataforma y lo correcto en 15 de los 18 países del mapa— y sólo se
 * escribe la variante `vos` donde la frase efectivamente se conjuga distinto.
 * No se transforma texto arbitrario: conjugar automáticamente produciría
 * español inventado, que es peor que el español de otro país.
 */

export type EvalLanguageCode = 'es' | 'en' | 'pt' | 'fr';

export interface LocalizedPhrase {
    es: string;
    en: string;
    pt: string;
    fr: string;
    /**
     * El español rioplatense, cuando la frase se conjuga distinto.
     *
     * Ausente significa que la frase no cambia: `¿Cuánto cuesta?` es igual en
     * los dos registros y duplicarla sólo agrega un lugar donde desincronizar.
     */
    esVos?: string;
    /** El español con `tú`, para los países donde el tuteo es la norma. */
    esTu?: string;
}

export function phrase(
    es: string,
    en: string,
    pt: string,
    fr: string,
    variants: { esVos?: string; esTu?: string } = {},
): LocalizedPhrase {
    return Object.freeze({ es, en, pt, fr, ...variants });
}

/**
 * El texto en el idioma pedido, y en el registro del país cuando es español.
 *
 * Sin forma de trato conocida usa el neutro. No suponer `vos` es deliberado: es
 * la forma más marcada de las tres y usarla por defecto suena a otro país en
 * quince de los dieciocho.
 */
export function localizedPhrase(
    value: LocalizedPhrase,
    language: EvalLanguageCode,
    addressForm?: AddressForm | null,
): string {
    if (language !== 'es') return value[language];
    if (addressForm === 'vos' && value.esVos) return value.esVos;
    if (addressForm === 'tu' && value.esTu) return value.esTu;
    return value.es;
}

/**
 * Las marcas que delatan español rioplatense en un texto.
 *
 * Existe como lista para que una prueba pueda barrer todo lo que el set dorado
 * genera: el defecto no fue escribir voseo sino que nadie lo estuviera mirando.
 * Deliberadamente estrecha —formas verbales y una interjección, no palabras que
 * también existen en otros registros— porque un detector que marca de más
 * termina desactivado.
 */
export const RIOPLATENSE_MARKERS: readonly string[] = Object.freeze([
    'podés', 'querés', 'tenés', 'necesitás', 'sabés', 'hacés', 'venís',
    'decime', 'contame', 'mandame', 'fijate', 'mirá', 'dale que',
    'resolvelo', 'ayudás', 'opinás', 'pedíselo', 'revisá', 'che,', 'che ',
]);

/** Las marcas encontradas en un texto, en minúsculas. Vacío = limpio. */
export function rioplatenseMarkersIn(text: unknown): string[] {
    if (typeof text !== 'string') return [];
    const normalized = text.toLowerCase();
    return RIOPLATENSE_MARKERS.filter(marker => normalized.includes(marker));
}
