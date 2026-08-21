import {
    NAVIGATION_ELAPSED_BUCKETS,
    navigationElapsedBucket,
    sanitizeNavigationTelemetry,
} from "@parallext/shared";
import { isOperationalRoute } from "./navigation-surface-kind-routes";

/**
 * La telemetría que había contaba **tropiezos**: un 403, un callejón sin
 * salida, una opción bloqueada por plan. Eso dice si algo está roto y no dice
 * si encontrar las cosas cuesta — un menú donde todo funciona y nada se
 * encuentra produce **cero eventos** y usuarios que se van.
 *
 * Lo que se agrega mide esfuerzo sin volverse un registro de sesión: cubos en
 * vez de milisegundos, tope de profundidad, y un evento por episodio en lugar
 * de uno por vista.
 */

describe("el tiempo viaja en cubos, no en milisegundos", () => {
    it.each([
        [0, "instant"],
        [2_999, "instant"],
        [3_000, "fast"],
        [14_999, "fast"],
        [15_000, "slow"],
        [59_999, "slow"],
        [60_000, "lost"],
    ])("%sms → %s", (ms, expected) => {
        expect(navigationElapsedBucket(ms as number)).toBe(expected);
    });

    it("un valor imposible cae en `lost`, no en `instant`", () => {
        // `instant` diría que el usuario fue directo, que es lo contrario de lo
        // que sabemos cuando el dato no tiene sentido.
        expect(navigationElapsedBucket(-1)).toBe("lost");
        expect(navigationElapsedBucket(NaN)).toBe("lost");
    });

    it("son cuatro y ninguno es un número", () => {
        // Un milisegundo crudo permitiría reconstruir minuto a minuto lo que
        // hizo una persona, que es justo lo que esta tabla no debe poder hacer.
        expect(NAVIGATION_ELAPSED_BUCKETS).toEqual(["instant", "fast", "slow", "lost"]);
    });
});

describe("el saneo acepta el esfuerzo y rechaza el rastro", () => {
    const base = { route: "/admin/inbox", reason: "unknown_route" as const };

    it("acepta un episodio completo", () => {
        const record = sanitizeNavigationTelemetry({
            event: "navigation.task_reached", ...base,
            elapsedBucket: "fast", clickDepth: 3,
        });
        expect(record).toMatchObject({ elapsedBucket: "fast", clickDepth: 3 });
    });

    it("rechaza un tiempo crudo", () => {
        expect(sanitizeNavigationTelemetry({
            event: "navigation.task_reached", ...base, elapsedBucket: 4200,
        })).toBeNull();
        expect(sanitizeNavigationTelemetry({
            event: "navigation.task_reached", ...base, elapsedMs: 4200,
        } as any)).toBeNull();
    });

    it("rechaza una profundidad fuera de rango", () => {
        for (const depth of [0, 10, 1.5, -3, "3"]) {
            expect(sanitizeNavigationTelemetry({
                event: "navigation.task_reached", ...base, clickDepth: depth,
            })).toBeNull();
        }
    });

    it("los tres eventos nuevos son reconocidos", () => {
        for (const event of [
            "navigation.task_reached", "navigation.backtracked", "navigation.search_used",
        ]) {
            expect(sanitizeNavigationTelemetry({ event, ...base })).not.toBeNull();
        }
    });

    it("una ruta con un id sigue rechazándose", () => {
        // Lo nuevo no puede aflojar lo que ya se protegía: un uuid en la ruta
        // metería el identificador de un contacto en una tabla de analítica.
        expect(sanitizeNavigationTelemetry({
            event: "navigation.task_reached",
            route: "/admin/contacts/8f14e45f-ceea-467a-9f42-1a5f4b0a2c3d",
            reason: "unknown_route",
        })).toBeNull();
    });
});

describe("qué cierra un episodio", () => {
    it("una pantalla operativa lo cierra", () => {
        expect(isOperationalRoute("/admin/inbox")).toBe(true);
        expect(isOperationalRoute("/admin/appointments")).toBe(true);
        expect(isOperationalRoute("/admin/cases")).toBe(true);
    });

    it("una pantalla de catálogo NO lo cierra", () => {
        // Cerrar el episodio ahí mediría el paseo, no la tarea: pasar por el
        // catálogo suele ser parte del camino, no el destino.
        expect(isOperationalRoute("/admin/inventory")).toBe(false);
        expect(isOperationalRoute("/admin/tours")).toBe(false);
    });

    it("una ruta que no existe no cierra nada", () => {
        expect(isOperationalRoute("/admin/lo-que-sea")).toBe(false);
    });
});
