/**
 * Lo que se mide del día 0, y nada más.
 *
 * El diseño v2 separa tres resultados: una respuesta de ensayo, una atención
 * operativa y un resultado útil verificable. Los objetivos de tiempo son
 * hipótesis internas y nunca sustituyen exactitud o comprensión. Los hitos que ya tienen su columna
 * (el alta en `users.created_at`, el primer canal en
 * `tenants.first_channel_connected_at`, la activación en
 * `tenants.settings.firstReplyAt`) NO se copian acá: se leen de donde están.
 * Esta tabla guarda solo lo que no tenía dónde quedar.
 *
 * Dos orígenes, a propósito separados:
 * - `server`: lo escribe el API en el momento en que ocurre, una vez por cuenta
 *   (o por canal), con una clave de deduplicación. Es el dato confiable.
 * - `client`: lo que solo el navegador puede ver —un paso que se abrió y se
 *   dejó sin guardar nada, una ventana de Meta que se cerró sin terminar—. Se
 *   acepta con una lista cerrada de nombres y de valores, porque cualquiera con
 *   una sesión puede mandarlo.
 *
 * Nada de lo que se guarda identifica a una persona ni a un cliente final: no
 * hay texto libre, ni nombres, ni teléfonos, ni mensajes de error de Meta. Un
 * allowlist y no un denylist, por la misma razón que la telemetría de
 * navegación: el día que un denylist se atrasa es el día que se guarda un dato
 * personal en una tabla de analítica.
 */

/** Los que escribe el servidor. Cada uno, una vez por cuenta salvo que se diga. */
export const ONBOARDING_SERVER_EVENTS = [
    /** La cuenta terminó el alta y su espacio quedó creado. */
    'onboarding_completed',
    /** El agente contestó por primera vez en el chat de prueba del panel. `detail` = superficie. */
    'test_chat_first_reply',
    /** El agente contestó por primera vez en el enlace público de prueba. */
    'demo_link_first_reply',
    /** Un canal quedó conectado. Una vez por cuenta y tipo de canal. */
    'channel_connected',
    /** El PRIMER canal de la cuenta, de cualquier tipo. */
    'first_channel_connected',
    /** El servidor rechazó una conexión con un código tipado. `detail` = código. Se repite. */
    'channel_connect_failed',
    /** La dueña dejó la conexión para después en el asistente. */
    'channel_deferred',
    /** La dueña terminó el asistente. */
    'wizard_completed',
    /** Respondió dónde vive hoy su número. `detail` = respuesta. Una vez por respuesta. */
    'whatsapp_triage_answered',
    /** El agente entregó la primera respuesta operativa. `channel_type` = por dónde. */
    'first_operational_reply',
    /** Se guardó una corrección canónica nacida desde una respuesta de ensayo. `detail` = tipo de dato. */
    'test_correction_saved',
    /** Primer resultado de cliente con evidencia definida por tarea. `detail` = tipo de resultado. */
    'first_useful_result',
] as const;

export type OnboardingServerEvent = typeof ONBOARDING_SERVER_EVENTS[number];

/** Los que puede mandar el panel. Solo lo que el servidor no puede ver. */
export const ONBOARDING_CLIENT_EVENTS = [
    /** Un paso del asistente quedó a la vista. `step`. */
    'wizard_step_viewed',
    /**
     * Pasó de un paso al siguiente. `step` = el que dejó; `detail` = `as_is`
     * (sin tocar nada) o `edited`. Sin esto, aceptar el agente tal cual no
     * llega nunca al servidor: el asistente no guarda si no hubo cambios.
     */
    'wizard_step_advanced',
    /** Abrió la ventana de Meta o mandó el formulario de un canal. `channel_type`; `detail` = ruta. */
    'channel_connect_started',
    /**
     * La conexión se cortó del lado del navegador —ventana cerrada, bloqueada,
     * cancelada—, que el servidor nunca ve. `channel_type`; `detail` = motivo.
     */
    'channel_connect_abandoned',
    /** "Conectar después" sobre un canal concreto. `channel_type`. */
    'channel_connect_later',
] as const;

export type OnboardingClientEvent = typeof ONBOARDING_CLIENT_EVENTS[number];

export type OnboardingEventName = OnboardingServerEvent | OnboardingClientEvent;

export const ONBOARDING_EVENT_SOURCES = ['server', 'client', 'derived'] as const;
export type OnboardingEventSource = typeof ONBOARDING_EVENT_SOURCES[number];

/** Los pasos del asistente, con el nombre que les da el código (`setup-wizard/page.tsx`). */
export const ONBOARDING_WIZARD_STEPS = [
    // Recorrido actual, conservado mientras se migra sin romper telemetría.
    'agent', 'connect', 'done',
    // Mapa mental v2.
    'business', 'test', 'channel', 'first_conversations',
] as const;
export type OnboardingWizardStep = typeof ONBOARDING_WIZARD_STEPS[number];

/** Los canales que el día 0 ofrece. */
export const ONBOARDING_EVENT_CHANNELS = [
    'whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget',
] as const;
export type OnboardingEventChannel = typeof ONBOARDING_EVENT_CHANNELS[number];

/** Dónde ocurrió el chat de prueba. */
export const AGENT_TEST_SURFACES = ['setup_wizard', 'agent_editor'] as const;
export type AgentTestSurface = typeof AGENT_TEST_SURFACES[number];

/**
 * Las metas del diseño (§11), en segundos. Viven acá para que el panel y el
 * API digan lo mismo: una meta copiada a mano en dos lados se desalinea el día
 * que alguien la cambia en uno.
 */
export const ONBOARDING_HYPOTHESES = {
    /** Tiempo ACTIVO aspiracional hasta una primera respuesta de ensayo. */
    testReplyActiveSec: 3 * 60,
    /** Tiempo ACTIVO aspiracional de preparación dentro de Parallly. */
    setupActiveSec: 10 * 60,
} as const;

/**
 * Los hitos que el embudo mide, en orden. Cada uno se define UNA vez, en el
 * servicio del embudo; este listado es el contrato de claves entre API y panel.
 */
export const ONBOARDING_MILESTONES = [
    /** Creó su usuario (`users.created_at`). La base de todos los tiempos. */
    'signup',
    /** Terminó el alta y tiene cuenta. */
    'onboarded',
    /** Vio a su agente responder en el chat de prueba. Solo desde que existe esta tabla. */
    'test_reply',
    /** Conectó su primer canal. */
    'first_channel',
    /** Le escribió el primer cliente (mensaje entrante). */
    'first_inbound',
    /** Su agente entregó la primera respuesta por una superficie operativa. */
    'first_operational_reply',
    /** La tarea del negocio produjo su primer resultado con evidencia. */
    'first_useful_result',
    /** Paga hoy. */
    'paying',
] as const;
export type OnboardingMilestone = typeof ONBOARDING_MILESTONES[number];

/** Un evento del panel, ya saneado. */
export interface OnboardingClientEventRecord {
    event: OnboardingClientEvent;
    step?: OnboardingWizardStep;
    channelType?: OnboardingEventChannel;
    detail?: string;
}

/** Tope de un lote. Un panel que manda más está roto, no midiendo. */
export const ONBOARDING_CLIENT_EVENTS_MAX_BATCH = 10;

const CLIENT_EVENTS = new Set<string>(ONBOARDING_CLIENT_EVENTS);
const STEPS = new Set<string>(ONBOARDING_WIZARD_STEPS);
const CHANNELS = new Set<string>(ONBOARDING_EVENT_CHANNELS);
const ADVANCE_DETAILS = new Set<string>(['as_is', 'edited']);
/**
 * Un código, no un texto: empieza con letra, solo minúsculas, dígitos y guion
 * bajo. Deja pasar `meta_connect_window_cancelled` o `business_app` y no deja
 * pasar un teléfono (solo dígitos), un correo (`@`, `.`) ni una frase.
 */
const DETAIL_TOKEN_RE = /^[a-z][a-z0-9_]{0,47}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Qué campos lleva cada evento. Uno de más o uno de menos descarta el registro. */
const CLIENT_EVENT_SHAPE: Record<OnboardingClientEvent, { step: boolean; channel: boolean; detail: 'none' | 'optional' | 'required' }> = {
    wizard_step_viewed: { step: true, channel: false, detail: 'none' },
    wizard_step_advanced: { step: true, channel: false, detail: 'required' },
    channel_connect_started: { step: false, channel: true, detail: 'optional' },
    channel_connect_abandoned: { step: false, channel: true, detail: 'required' },
    channel_connect_later: { step: false, channel: true, detail: 'none' },
};

/**
 * Deja pasar solo lo que el contrato declara. Descarta el registro entero ante
 * cualquier campo desconocido o valor fuera de lista, en vez de limpiarlo: un
 * panel que manda de más está mal, y guardarle la mitad buena esconde el
 * problema.
 */
export function sanitizeOnboardingClientEvent(input: unknown): OnboardingClientEventRecord | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const raw = input as Record<string, unknown>;
    for (const key of Object.keys(raw)) {
        if (key !== 'event' && key !== 'step' && key !== 'channelType' && key !== 'detail') return null;
    }
    const event = raw.event;
    if (typeof event !== 'string' || !CLIENT_EVENTS.has(event)) return null;
    const shape = CLIENT_EVENT_SHAPE[event as OnboardingClientEvent];
    const record: OnboardingClientEventRecord = { event: event as OnboardingClientEvent };

    if (shape.step) {
        if (typeof raw.step !== 'string' || !STEPS.has(raw.step)) return null;
        record.step = raw.step as OnboardingWizardStep;
    } else if (raw.step !== undefined) {
        return null;
    }

    if (shape.channel) {
        if (typeof raw.channelType !== 'string' || !CHANNELS.has(raw.channelType)) return null;
        record.channelType = raw.channelType as OnboardingEventChannel;
    } else if (raw.channelType !== undefined) {
        return null;
    }

    if (shape.detail === 'none') {
        if (raw.detail !== undefined) return null;
    } else if (raw.detail === undefined) {
        if (shape.detail === 'required') return null;
    } else {
        if (typeof raw.detail !== 'string' || !DETAIL_TOKEN_RE.test(raw.detail)) return null;
        if (event === 'wizard_step_advanced' && !ADVANCE_DETAILS.has(raw.detail)) return null;
        record.detail = raw.detail;
    }
    return record;
}

/**
 * Un lote del panel. `sessionId` identifica una visita al asistente y existe
 * solo para no contar dos veces lo mismo; sin un uuid válido no se acepta nada.
 */
export function sanitizeOnboardingClientBatch(input: unknown): {
    sessionId: string;
    events: OnboardingClientEventRecord[];
} | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const raw = input as Record<string, unknown>;
    if (typeof raw.sessionId !== 'string' || !UUID_RE.test(raw.sessionId)) return null;
    if (!Array.isArray(raw.events)) return null;
    const events = raw.events
        .slice(0, ONBOARDING_CLIENT_EVENTS_MAX_BATCH)
        .map(sanitizeOnboardingClientEvent)
        .filter((record): record is OnboardingClientEventRecord => record !== null);
    return { sessionId: raw.sessionId.toLowerCase(), events };
}

/**
 * La clave que hace que un hito del servidor quede una sola vez. Mismo formato
 * en todos los escritores, para que dos caminos que registran "el primer canal"
 * choquen en el índice único en vez de sumar dos.
 */
export function onboardingOnceKey(
    event: OnboardingServerEvent,
    tenantId: string,
    qualifier?: string | null,
): string {
    return qualifier ? `${event}:${tenantId}:${qualifier}` : `${event}:${tenantId}`;
}

/** La clave de un evento del panel: el mismo evento en la misma visita cuenta una vez. */
export function onboardingClientKey(
    tenantId: string,
    sessionId: string,
    record: OnboardingClientEventRecord,
): string {
    return ['c', tenantId, sessionId, record.event, record.step ?? '', record.channelType ?? '', record.detail ?? ''].join(':');
}
