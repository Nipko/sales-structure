import fs from "node:fs";
import path from "node:path";
import {
    AGENT_HANDOFF_RETURN_PARAM,
    buildAgentHandoff,
    routedAgentOperations,
} from "@parallext/shared";
import { NAVIGATION_ROUTES } from "./navigation-contract";

/**
 * El lado del panel del traspaso de Assist.
 *
 * La API decide QUÉ recopilar y a qué pantalla mandar. Acá se comprueba lo
 * único que la API no puede comprobar: que esa pantalla exista, y que el
 * parámetro que el enlace lleva lo lea alguien. Un parámetro que ninguna
 * pantalla honra es peor que ninguno —promete "preconfigurada" y entrega la
 * misma pantalla vacía—, y ese es exactamente el fallo que este archivo
 * convierte en rojo.
 */

const SRC = path.resolve(__dirname, "..");

function readPage(route: string): string {
    // `/admin/settings/integrations/payments` → `src/app/admin/.../page.tsx`.
    const file = path.join(SRC, "app", `${route.replace(/^\//, "")}`, "page.tsx");
    return fs.readFileSync(file, "utf8");
}

describe("traspaso de Assist a la pantalla que decide", () => {
    it("manda solamente a rutas que el panel tiene", () => {
        const known = new Set(NAVIGATION_ROUTES.map((route) => route.pattern));
        const unknown = routedAgentOperations()
            .map((operation) => operation.route)
            // `NAVIGATION_ROUTES` types its patterns as `/admin${string}`; the
            // operation's route is a plain string, and the whole point of the
            // check is to find the ones that are not in the set. The cast is
            // what lets the lookup happen at all.
            .filter((route) => !known.has(route as `/admin${string}`));
        expect({ unknown }).toEqual({ unknown: [] });
    });

    it("cada ruta destino es una página real", () => {
        for (const operation of routedAgentOperations()) {
            expect(() => readPage(operation.route)).not.toThrow();
        }
    });

    it("todo parámetro declarado lo lee la pantalla que lo recibe", () => {
        // La mitad honesta del contrato. Si mañana alguien declara `?role=`
        // para /admin/users sin que esa página lo lea, esto falla en vez de
        // dejar a la persona buscando a mano lo que Assist ya sabía.
        const unread: string[] = [];
        for (const operation of routedAgentOperations()) {
            const page = readPage(operation.route);
            for (const requirement of operation.requirements) {
                if (!requirement.param) continue;
                if (!page.includes(`searchParams.get("${requirement.param}")`)
                    && !page.includes(`searchParams.get('${requirement.param}')`)) {
                    unread.push(`${operation.key}: ${operation.route} no lee ?${requirement.param}`);
                }
            }
        }
        expect({ unread }).toEqual({ unread: [] });
    });

    it("la marca de vuelta la lee el asistente, no cada pantalla", () => {
        // Ocho pantallas leyendo la misma marca serían ocho lugares donde se
        // olvida. La lee el propio Assist, que es el que tiene la conversación
        // a la que hay que volver.
        const assistant = fs.readFileSync(path.join(SRC, "components", "HelpAssistant.tsx"), "utf8");
        expect(assistant).toContain("AGENT_HANDOFF_RETURN_PARAM");
        expect(assistant).toContain("searchParams.get(AGENT_HANDOFF_RETURN_PARAM)");
        // Y la borra al entrar: recargar la página, o compartir el enlace, no
        // puede reabrir el chat por un viaje que ya ocurrió.
        expect(assistant).toContain("next.delete(AGENT_HANDOFF_RETURN_PARAM)");
    });

    it("el enlace que se construye apunta a la pantalla que la tarjeta destaca", () => {
        const result = buildAgentHandoff("channels.account.connect", { channelType: "telegram" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.plan.href).toContain("/admin/channels?type=telegram");
        expect(result.plan.href).toContain(`${AGENT_HANDOFF_RETURN_PARAM}=channels.account.connect`);
        // Y la página marca esa tarjeta, que es lo que hace que "preconfigurada"
        // signifique algo para quien llega.
        const page = readPage("/admin/channels");
        expect(page).toContain("data-channel-focus");
        expect(page).toContain("focusedChannel");
    });
});
