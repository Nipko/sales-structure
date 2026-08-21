"use client";

/**
 * Cuánto cuesta llegar a lo que uno vino a hacer.
 *
 * La telemetría que había contaba **tropiezos**: un 403, un callejón sin
 * salida, una opción bloqueada por plan. Eso dice si algo está roto y no dice
 * si encontrar las cosas cuesta — un menú donde todo funciona y nada se
 * encuentra produce cero eventos y usuarios que se van.
 *
 * Tres episodios, y ninguno se emite por vista:
 *
 * - **Llegó**: alcanzó una pantalla operativa. Cuánto tardó y cuántos clics le
 *   llevó, en cubos.
 * - **Volvió sobre sus pasos**: se movió y volvió enseguida. Es la señal más
 *   honesta de que el menú lo mandó al lugar equivocado: no hay error, no hay
 *   403, y el camino no era.
 * - **Buscó**: usó el buscador en vez del menú. Un buscador muy usado no es un
 *   buscador exitoso, es un menú donde no se encuentra lo que se busca.
 *
 * Todo vive en memoria de la pestaña y nada bloquea: medir no puede empeorar
 * lo que se mide.
 */

import { navigationElapsedBucket } from "@parallext/shared";
import { recordNavigationEvent } from "./navigation-telemetry";

/** Dónde arrancó el episodio actual y cuántos saltos lleva. */
interface Journey {
    startedAt: number;
    clicks: number;
    /** La ruta anterior, para reconocer una vuelta atrás. */
    previousRoute: string | null;
    previousAt: number;
}

const journey: Journey = {
    startedAt: Date.now(),
    clicks: 0,
    previousRoute: null,
    previousAt: 0,
};

/**
 * Cuánto puede pasar entre ir y volver para que cuente como "se equivocó".
 *
 * Diez segundos: más que eso y volver es una decisión, no un error — el usuario
 * hizo lo que fue a hacer y regresó.
 */
const BACKTRACK_WINDOW_MS = 10_000;

/** Un episodio no dura para siempre: después de esto, empezó otra cosa. */
const JOURNEY_TIMEOUT_MS = 5 * 60_000;

/**
 * El usuario navegó. Devuelve `true` si fue una vuelta atrás.
 *
 * Se llama desde el layout, que ya observa la ruta: no hace falta instrumentar
 * cada enlace, y eso además evita contar dos veces cuando un componente
 * re-renderiza.
 */
export function trackNavigation(
    tenantId: string | null | undefined,
    route: string,
    options: { isOperationalSurface?: boolean } = {},
): void {
    const now = Date.now();

    if (now - journey.startedAt > JOURNEY_TIMEOUT_MS) {
        journey.startedAt = now;
        journey.clicks = 0;
    }
    journey.clicks += 1;

    const wentBack = journey.previousRoute !== null
        && route === journey.previousRoute
        && now - journey.previousAt <= BACKTRACK_WINDOW_MS;

    if (wentBack) {
        recordNavigationEvent(tenantId, {
            event: "navigation.backtracked",
            route,
            reason: "unknown_route",
        });
    }

    // Llegar a una pantalla operativa CIERRA el episodio: es lo que el usuario
    // vino a hacer. Cerrar en cualquier vista mediría el paseo, no la tarea.
    if (options.isOperationalSurface) {
        recordNavigationEvent(tenantId, {
            event: "navigation.task_reached",
            route,
            reason: "unknown_route",
            elapsedBucket: navigationElapsedBucket(now - journey.startedAt),
            clickDepth: Math.min(9, journey.clicks),
        });
        journey.startedAt = now;
        journey.clicks = 0;
    }

    journey.previousRoute = route;
    journey.previousAt = now;
}

/**
 * El usuario abrió el buscador y eligió algo.
 *
 * Se cuenta la elección y no la apertura: abrir el buscador y cerrarlo no dice
 * nada, y contarlo inflaría el número que se usa para decidir si el menú está
 * mal.
 */
export function trackSearchNavigation(
    tenantId: string | null | undefined,
    route: string,
): void {
    recordNavigationEvent(tenantId, {
        event: "navigation.search_used",
        route,
        reason: "unknown_route",
    });
    // Buscar reinicia el episodio: lo que importa después es cuánto costó
    // desde que decidió buscar.
    journey.startedAt = Date.now();
    journey.clicks = 0;
}

/** Sólo para pruebas: el estado vive en memoria de la pestaña. */
export function __resetNavigationEffort(): void {
    journey.startedAt = Date.now();
    journey.clicks = 0;
    journey.previousRoute = null;
    journey.previousAt = 0;
}
