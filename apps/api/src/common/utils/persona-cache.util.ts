/**
 * Tipos de canal cuya persona se cachea por separado en Redis
 * (`persona:{tenantId}:channel:{type}` y su variante por-cuenta
 * `…:acct:{accountId}`).
 *
 * Vive acá y no en `@parallext/shared` porque ese paquete expone TypeScript
 * crudo: desde apps/api solo se pueden importar TIPOS, y esto es un VALOR en
 * runtime.
 *
 * Es la lista que hay que barrer para invalidar. La escriben/leen dos lugares
 * —`PersonaService.invalidatePersonaCaches` (edición de agente) y
 * `VerticalsService.invalidateRuntimeCaches` (bootstrap por vertical)—, así que
 * la constante es única para que no vuelvan a divergir: la lista de persona
 * omitía 'email' y 'web_widget' aunque `getPersonaForChannel` sí los recibe, y
 * esos dos canales se quedaban con la persona vieja hasta vencer el TTL.
 */
export const PERSONA_CACHE_CHANNELS = [
    'whatsapp',
    'instagram',
    'messenger',
    'telegram',
    'sms',
    'email',
    'web_widget',
] as const;
