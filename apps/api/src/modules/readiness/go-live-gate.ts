/**
 * Control de salida (C0 §1.2, rebanada R4, ADR 0010): la decisión pura de si la IA atiende a un cliente real.
 *
 * Es binaria (C0 §0.5): atiende o no atiende. «Limitado» es una etiqueta y un reconocimiento del dueño al publicar,
 * no una rama. La regla:
 * - publicado (`go_live_state = on`) → atiende, también si después cae a `no_listo` (C0: no se apaga en silencio; el
 *   panel lo avisa y el turno aplica `when_missing`, que el contrato ya trae);
 * - no publicado → no atiende (C0 §7.1: mensaje fijo y bandeja humana), salvo los contactos de prueba de la lista
 *   blanca temporal de C0 §7.2;
 * - Agent Test, el ensayo y la evaluación no pasan por aquí: nunca son un canal real.
 *
 * Modo sombra (C0 §5 R4): la decisión se calcula y se registra en cada mensaje entrante, pero no bloquea. Con la
 * bandera `readiness.goLiveGate` encendida para el tenant, la misma decisión se aplica.
 */
import type { Verdict } from '@parallext/business-spec';

export type GoLiveState = 'off' | 'on';
export type GoLiveMode = 'shadow' | 'enforce';
export type GoLiveReason =
    /** Publicado y con veredicto ≠ no_listo. */
    | 'published'
    /** Publicado, pero hoy el veredicto es no_listo: atiende y el panel avisa (regresión, C0 §1.2). */
    | 'published_regressed'
    /** No publicado y el veredicto permitiría publicar (limitado o listo): falta el acto del dueño. */
    | 'not_published'
    /** No publicado y no_listo: no se puede publicar todavía. */
    | 'no_listo'
    /** Contacto de la lista blanca de prueba (settings.goLive.testContacts). */
    | 'test_contact'
    /** No se pudo leer el estado: se atiende y se registra (no se apaga un tenant por un fallo de lectura). */
    | 'unavailable';

export interface GoLiveInput {
    state: GoLiveState;
    verdict: Verdict | null;
    /** El remitente está en la lista blanca de prueba. */
    testContact?: boolean;
}

export interface GoLiveDecision {
    serve: boolean;
    reason: GoLiveReason;
}

export function decideGoLive(input: GoLiveInput): GoLiveDecision {
    if (input.state === 'on') return { serve: true, reason: input.verdict === 'no_listo' ? 'published_regressed' : 'published' };
    if (input.testContact) return { serve: true, reason: 'test_contact' };
    return { serve: false, reason: input.verdict === 'no_listo' ? 'no_listo' : 'not_published' };
}

/** En sombra nunca se bloquea: la respuesta de la IA sigue igual y solo queda el registro. */
export const blocksTurn = (mode: GoLiveMode, decision: GoLiveDecision): boolean => mode === 'enforce' && !decision.serve;

/** Clave de comparación contra la lista blanca: un correo en minúsculas; cualquier otro identificador, solo sus dígitos. */
export const contactKey = (value: unknown): string => {
    const raw = String(value ?? '').trim().toLowerCase();
    return raw.includes('@') ? raw : raw.replace(/\D/g, '');
};

/** Mensaje fijo para el cliente de un tenant no publicado (C0 §7.1), en el idioma del turno. */
export const NOT_LIVE_NOTICE: Readonly<Record<'es' | 'en' | 'pt' | 'fr', string>> = Object.freeze({
    es: 'Gracias por escribirnos. Estamos preparando la atención automática; una persona del equipo te responde por aquí.',
    en: 'Thanks for your message. We are still setting up automatic replies; a person from our team will answer you here.',
    pt: 'Obrigado pela mensagem. Ainda estamos preparando o atendimento automático; uma pessoa da equipe vai responder por aqui.',
    fr: "Merci pour votre message. Nous préparons encore les réponses automatiques ; une personne de l'équipe vous répondra ici.",
});

export function notLiveNotice(language?: string | null): string {
    const code = String(language ?? 'es').slice(0, 2).toLowerCase();
    return NOT_LIVE_NOTICE[code as keyof typeof NOT_LIVE_NOTICE] ?? NOT_LIVE_NOTICE.es;
}
