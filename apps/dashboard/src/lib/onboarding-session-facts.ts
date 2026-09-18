import { isOnboardingBeforeLive, isOnboardingStage } from "@parallext/shared";

/**
 * Lo que la sesión sabe del día 0 de la cuenta, tal como viaja en el usuario.
 *
 * La etapa sola dejó de alcanzar: es monótona y `completed` le gana a `live`,
 * así que el último botón del asistente levantaba el silencio del día 0 antes
 * de que el agente le contestara a nadie. Ahora el día 0 termina con la primera
 * respuesta real (`firstReplyAt`) o, como tope, a los pocos días del alta
 * (`tenantCreatedAt`). Los tres datos salen de la misma fila del tenant y
 * llegan juntos en el login, la renovación de token y `/auth/me`.
 */
export interface OnboardingSessionFacts {
    /** Quién es la sesión: los datos de OTRA persona no se mezclan (ver la mezcla). */
    id?: string;
    tenantId?: string;
    onboardingStage?: string;
    /** ISO de la primera respuesta real del agente; ausente o `null` = todavía ninguna. */
    firstReplyAt?: string | null;
    /** ISO del alta del tenant. */
    tenantCreatedAt?: string | null;
    /**
     * Si la cuenta tiene una conexión de canal activa: el mismo conteo del que
     * sale la etapa. Ausente = el servidor no pudo leerlo.
     */
    hasAnyChannel?: boolean;
    /**
     * Si la dueña ya confirmó su correo. Antes sólo lo escribían el login y
     * `/verify-email`: si confirmaba en otra pestaña o desde el celular, el
     * asistente le seguía negando Instagram, Messenger y Telegram hasta que
     * recargara. Ahora lo trae también `/auth/me` (y el `storage` de otra
     * pestaña), y la mezcla sólo lo sube a `true`.
     */
    emailVerified?: boolean;
}

function isIsoDate(value: unknown): value is string {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Suma a la sesión lo que trajo una respuesta del servidor, sin perder nada.
 *
 * - Una etapa desconocida o ausente no toca la que ya teníamos: "no vino"
 *   nunca puede degradar.
 * - La primera respuesta no se deshace: un `null` o un valor ilegible jamás
 *   borra una hora ya registrada. Si la borrara, una lectura fallida devolvería
 *   al dueño al silencio del día 0 con su agente ya contestando.
 * - Datos de OTRA cuenta no se mezclan con esta sesión (un cambio de tenant
 *   que todavía no terminó de aterrizar), ni los de OTRA persona de la misma
 *   cuenta (el `user` que otra pestaña dejó en el almacenamiento).
 * - El correo confirmado sólo sube: `true` del servidor reemplaza a `false`,
 *   pero un `false` o un dato ausente nunca vuelve a cerrar lo que ya estaba
 *   abierto. Si el correo dejó de estar confirmado (un cambio de correo), el
 *   servidor lo rechaza al conectar y la tarjeta de ese rechazo lo explica.
 *
 * Devuelve el MISMO objeto cuando no cambió nada, para que el llamador sepa si
 * tiene que guardar y redibujar.
 */
export function mergeOnboardingSessionFacts<T extends OnboardingSessionFacts>(current: T, payload: unknown): T {
    if (!isRecord(payload)) return current;
    if (typeof payload.tenantId === "string" && typeof current.tenantId === "string"
        && payload.tenantId !== current.tenantId) {
        return current;
    }
    if (typeof payload.id === "string" && typeof current.id === "string" && payload.id !== current.id) {
        return current;
    }

    const next: T = { ...current };
    let changed = false;
    if (isOnboardingStage(payload.onboardingStage) && payload.onboardingStage !== current.onboardingStage) {
        next.onboardingStage = payload.onboardingStage;
        changed = true;
    }
    if (isIsoDate(payload.firstReplyAt) && payload.firstReplyAt !== current.firstReplyAt) {
        next.firstReplyAt = payload.firstReplyAt;
        changed = true;
    }
    if (isIsoDate(payload.tenantCreatedAt) && payload.tenantCreatedAt !== current.tenantCreatedAt) {
        next.tenantCreatedAt = payload.tenantCreatedAt;
        changed = true;
    }
    // A diferencia de la primera respuesta, un canal SÍ puede irse: un `false`
    // leído reemplaza a un `true`. Lo que no es booleano —la lectura falló—
    // no toca nada.
    if (typeof payload.hasAnyChannel === "boolean" && payload.hasAnyChannel !== current.hasAnyChannel) {
        next.hasAnyChannel = payload.hasAnyChannel;
        changed = true;
    }
    if (payload.emailVerified === true && current.emailVerified !== true) {
        next.emailVerified = true;
        changed = true;
    }
    return changed ? next : current;
}

/**
 * True mientras la cuenta de esta sesión espera la primera respuesta real de
 * su agente — la misma pregunta que se hacen los cuatro avisos que se callan en
 * el día 0, con los mismos datos.
 */
export function isSessionInDayZero(user: OnboardingSessionFacts | null | undefined, now?: number): boolean {
    return isOnboardingBeforeLive(user?.onboardingStage, {
        firstReplyAt: user?.firstReplyAt,
        createdAt: user?.tenantCreatedAt,
        now,
    });
}
