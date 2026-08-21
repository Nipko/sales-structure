"use client";

/**
 * Contar los callejones sin salida que el Gate 4 dice que no deben existir.
 *
 * Las pruebas verifican los mapas, los permisos y las rutas — pero la
 * estructura sólo cubre lo que alguien pensó en declarar. Un tenant con una
 * configuración rara, un enlace guardado hace meses o un rol que cambió a
 * mitad de sesión producen el mismo síntoma sin que ningún mapa esté mal.
 *
 * Se emite **fuera del camino del usuario**: nada bloquea, nada espera, y un
 * fallo del envío no se ve. Medir no puede empeorar lo que se mide.
 */

import {
    NAVIGATION_TELEMETRY_MAX_BATCH,
    sanitizeNavigationTelemetry,
    type NavigationTelemetryRecord,
} from "@parallext/shared";
import { api } from "./api";

/**
 * Cola en memoria con vaciado diferido.
 *
 * Un 403 suele venir acompañado de una redirección y otro render; agrupar
 * evita tres requests por un mismo tropiezo. La cola vive sólo en esta pestaña:
 * si el usuario la cierra se pierden los eventos pendientes, y está bien —
 * perder telemetría es infinitamente mejor que retrasar una navegación.
 */
const pending: NavigationTelemetryRecord[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** Evita contar diez veces el mismo tropiezo si React vuelve a renderizar. */
const seen = new Set<string>();

export function recordNavigationEvent(
    tenantId: string | null | undefined,
    input: unknown,
): void {
    if (!tenantId) return;
    const record = sanitizeNavigationTelemetry(input);
    // Un evento que el contrato no acepta no se manda: el saneo del servidor
    // lo descartaría igual, y mandarlo sólo gastaría una request.
    if (!record) return;

    const key = `${record.event}:${record.route}:${record.reason}`;
    if (seen.has(key)) return;
    seen.add(key);

    pending.push(record);
    if (pending.length >= NAVIGATION_TELEMETRY_MAX_BATCH) {
        flush(tenantId);
        return;
    }
    if (flushTimer) return;
    flushTimer = setTimeout(() => flush(tenantId), 3000);
}

function flush(tenantId: string): void {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (pending.length === 0) return;
    const events = pending.splice(0, NAVIGATION_TELEMETRY_MAX_BATCH);
    // Sin `await` y sin propagar: el usuario ya está navegando.
    void api.recordNavigationTelemetry(tenantId, events).catch(() => undefined);
}

/** Sólo para pruebas: la cola es de módulo y sobrevive entre casos. */
export function __resetNavigationTelemetry(): void {
    pending.length = 0;
    seen.clear();
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
}
