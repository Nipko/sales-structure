/**
 * E2ag C19/C20: con gpt-6-luna como líder, «¿cuántas reservas tengo?» llama a `list_my_tour_bookings`, la lista vuelve vacía y
 * el agente contesta «No tiene reservas registradas». Las herramientas `list_my_*` leen solo los registros vinculados al contacto
 * de este chat: que no haya ninguno no prueba que el cliente no tenga reservas (pudo reservar con otro teléfono, otro nombre o
 * por otro canal). La respuesta vacía lo dice, y el agente pide el dato con el que reservó o ofrece una persona en vez de negar.
 */
const OWN_RECORDS_TOOL = /^(list_my_[a-z_]+|list_pets_for_contact|list_upcoming_sessions|get_treatment_plan)$/;

export const OWN_RECORDS_EMPTY_MESSAGE =
    'Solo se buscaron los registros vinculados a este chat y no hay ninguno. Eso no prueba que el cliente no tenga reservas, '
    + 'pedidos o citas: pudo hacerlos con otro teléfono, otro nombre o por otro canal. No afirmes que no tiene ninguno; '
    + 'dile que no los ves vinculados a este chat y pídele el nombre o el teléfono con el que los hizo, u ofrece pasarlo con una persona.';

/**
 * E2ag C13/P02-5: «get_promotions» vacía decía «No active promotions at this time.» y el agente contestaba «Por ahora no hay
 * promociones activas». Que no haya promociones cargadas no prueba que el negocio no tenga ninguna (D1j: una ausencia no
 * respalda una negación): se dice que no hay promociones publicadas.
 */
const PUBLISHED_OFFERS_TOOL = /^(get_promotions|list_active_offers)$/;

export const NO_PUBLISHED_OFFERS_MESSAGE =
    'No hay promociones ni ofertas publicadas en el sistema. Di que hoy no hay promociones publicadas; no afirmes que el negocio '
    + 'no tiene ninguna ni que no hay descuentos, y ofrece que una persona del equipo lo confirme si el cliente lo pide.';

function isEmptyRead(result: any): boolean {
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.error || result.errorCode) return false;
    const lists = Object.values(result).filter(Array.isArray) as unknown[][];
    if (!lists.length || lists.some(list => list.length > 0)) return false;
    return !(result.total !== undefined && Number(result.total) > 0);
}

/** El mismo resultado; si es una lectura vacía de registros propios o de promociones, con su alcance y la instrucción. */
export function scopeOwnRecordsResult(toolName: string, result: any): any {
    const name = String(toolName || '');
    if (OWN_RECORDS_TOOL.test(name) && isEmptyRead(result)) {
        return { ...result, status: 'empty', scope: 'this_chat_contact', message: OWN_RECORDS_EMPTY_MESSAGE };
    }
    if (PUBLISHED_OFFERS_TOOL.test(name) && isEmptyRead(result)) {
        return { ...result, status: 'empty', scope: 'published', message: NO_PUBLISHED_OFFERS_MESSAGE };
    }
    return result;
}
