/**
 * E2aa C01 (dental, 2 de 3; 5 de 6 respuestas entre E2z y E2aa): «¿Qué es exactamente lo que hacen?» se contestaba «ofrecemos
 * consultas generales, consultas especializadas y controles o seguimientos», los tres servicios de la plantilla del alta
 * (content_status = seeded). El prompt los marca y trae SEEDED_SERVICES_NOTE (ADR 0025, adendas 1 y 2), pero el modelo los
 * listaba igual como oferta confirmada.
 *
 * Opción B del dueño: un ítem de plantilla se puede nombrar, nunca presentar como confirmado. Cuando la respuesta nombra dos o más
 * servicios de plantilla (una lista o una descripción del negocio, no una cita de un servicio) y ninguna de sus frases dice que
 * están por confirmar, se agrega que lo están.
 */
import { normalizeForIntent } from '@parallext/shared';

export interface MaybeSeededService {
    name: string;
    contentStatus?: 'seeded' | 'example' | string;
}

const isTemplate = (s: MaybeSeededService): boolean => s?.contentStatus === 'seeded' || s?.contentStatus === 'example';

/**
 * «Consulta general» → «consultas generales», «Control y seguimiento» → «controles o seguimientos»: cada palabra de 4 letras o más,
 * en orden, con hasta dos palabras entre ellas. Las palabras son solo letras y dígitos (no hace falta escaparlas).
 */
function namePattern(name: string): RegExp | null {
    const words = normalizeForIntent(name).split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 4);
    if (!words.length) return null;
    const between = String.raw`(?:\s+[\p{L}\p{N}]+){0,2}?\s+`;
    const body = words.map(word => word + String.raw`\p{L}{0,3}`).join(between);
    return new RegExp(String.raw`(?<![\p{L}\p{N}])` + body + String.raw`(?![\p{L}\p{N}])`, 'u');
}

const PENDING = /(?:por confirmar|sin confirmar|pendientes? de confirma|a confirmar|no (?:esta|estan) confirmad|aun no confirmad|todavia no confirmad|pending|unconfirmed|not (?:yet )?confirmed|a confirmer|non confirme|nao confirmad|ainda nao confirmad)/;

const TEXTS: Record<string, (names: string) => string> = {
    es: names => `Tenga en cuenta que ${names} aún están pendientes de confirmar por el negocio.`,
    pt: names => `Observe que ${names} ainda estão pendentes de confirmação pelo negócio.`,
    en: names => `Please note that ${names} are still pending confirmation by the business.`,
    fr: names => `Veuillez noter que ${names} doivent encore être confirmés par l’établissement.`,
};
const AND: Record<string, string> = { es: 'y', pt: 'e', en: 'and', fr: 'et' };

function list(names: string[], code: string): string {
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} ${AND[code] ?? AND.es} ${names[names.length - 1]}`;
}

/**
 * E2ab: los servicios de plantilla del turno salen de tres fuentes, no solo de `<available_services>`. Sin reserva autorizada
 * (dental, C16 «modo ausente») ese bloque queda vacío y el modelo los toma de `<catalogue_authority>` (`pending`) o de una lectura
 * `list_services` del turno.
 */
export function templateServicesOfTurn(
    context: { availableServices?: readonly MaybeSeededService[]; catalogueAuthority?: { pending?: readonly string[] } } | undefined,
    reads?: ReadonlyArray<{ name?: string; result?: any }>,
): MaybeSeededService[] {
    const out = new Map<string, MaybeSeededService>();
    const add = (service: MaybeSeededService) => { if (service?.name && isTemplate(service) && !out.has(service.name)) out.set(service.name, service); };
    for (const service of context?.availableServices ?? []) add(service);
    for (const name of context?.catalogueAuthority?.pending ?? []) add({ name, contentStatus: 'seeded' });
    for (const read of reads ?? []) {
        if (!/service/i.test(String(read?.name || '')) || !Array.isArray(read?.result?.services)) continue;
        for (const service of read.result.services) add({ name: String(service?.name || ''), contentStatus: service?.contentStatus });
    }
    return [...out.values()];
}

/** La respuesta con los servicios de plantilla marcados como pendientes; null si no hace falta. */
export function pendingServicesNote(reply: string, services: readonly MaybeSeededService[] | undefined, lang?: string): string | null {
    const text = String(reply || '').trim();
    if (!text) return null;
    // E2ae: «Ofrecemos los siguientes servicios, aunque están pendientes de confirmación:» seguido de una lista con viñetas ya lo
    // dice, aunque la frase que lo dice no nombre los servicios.
    if (PENDING.test(normalizeForIntent(text))) return null;
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(sentence => normalizeForIntent(sentence));
    const named: string[] = [];
    for (const service of (services ?? []).filter(isTemplate)) {
        const pattern = service?.name ? namePattern(service.name) : null;
        if (!pattern) continue;
        const said = sentences.filter(sentence => pattern.test(sentence));
        if (!said.length) continue;
        named.push(service.name);
    }
    if (named.length < 2) return null;
    const code = String(lang || 'es').slice(0, 2);
    const note = (TEXTS[code] ?? TEXTS.es)(list(named, code));
    const closing = text.match(/(?<=[.!]\s+)[^.!?]*\?\s*$/u);
    if (closing) return `${text.slice(0, closing.index!).trimEnd()} ${note} ${closing[0].trim()}`;
    return `${text} ${note}`;
}
