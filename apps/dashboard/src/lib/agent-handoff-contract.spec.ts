import fs from "node:fs";
import path from "node:path";
import {
    AGENT_HANDOFF_RETURN_PARAM,
    AGENT_OPERATION_REGISTRY,
    buildAgentHandoff,
    listVerticalCapabilityConfigurations,
    routedAgentOperations,
} from "@parallext/shared";
import type { VerticalCapability } from "@parallext/shared";
import { NAVIGATION_ROUTES } from "./navigation-contract";
import {
    getVerticalDashboardItemForPath,
    resolveVerticalDashboard,
    type VerticalDashboardItem,
} from "./vertical-dashboard-resolver";

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

    /**
     * La pantalla existe. La pregunta que sigue —y que nadie hacía— es si la
     * persona a la que Assist la ofrece puede abrirla.
     *
     * El panel esconde una superficie vertical que las capacidades del tenant
     * no incluyen y redirige a quien la pida. Assist ofrecía `/admin/appointments`
     * a un restaurante y `/admin/catalog/campaigns` a cualquiera: el dueño
     * seguía el consejo y el panel lo devolvía al asistente de puesta en marcha.
     *
     * El mapa de abajo NO es una copia: se calcula preguntándole al propio
     * resolutor qué ítems enciende cada capacidad. Si mañana `courses` pasa a
     * depender de otra capacidad, esto se pone rojo solo.
     */
    describe("las capacidades que la pantalla destino exige", () => {
        const capabilities = [...new Set(
            listVerticalCapabilityConfigurations().flatMap((profile) => profile.capabilities),
        )] as VerticalCapability[];

        /** Capacidad → ítems que enciende, según el resolutor y nadie más. */
        const itemsOf = new Map<VerticalCapability, readonly VerticalDashboardItem[]>(
            capabilities.map((capability) => [
                capability,
                // Sin `manifestVersion` el resolutor no filtra por rutas del
                // subtipo, así que lo que vuelve es la proyección pura de la
                // capacidad — que es exactamente lo que se quiere comparar.
                resolveVerticalDashboard({ effectiveCapabilities: [capability] }).visibleItems,
            ]),
        );

        it("toda operación con pantalla vertical declara la capacidad que la enciende", () => {
            const wrong: string[] = [];
            for (const operation of AGENT_OPERATION_REGISTRY) {
                const item = getVerticalDashboardItemForPath(operation.route);
                const declared = operation.requiresCapability as VerticalCapability | undefined;
                if (!item) {
                    // Cross-vertical: exigir una capacidad acá escondería la
                    // pantalla de canales a media plataforma.
                    if (declared) wrong.push(`${operation.key}: ${operation.route} no es vertical y exige ${declared}`);
                    continue;
                }
                if (!declared) {
                    wrong.push(`${operation.key}: ${operation.route} es la superficie "${item}" y no exige capacidad`);
                    continue;
                }
                if (!(itemsOf.get(declared) || []).includes(item)) {
                    wrong.push(`${operation.key}: exige ${declared}, que no enciende "${item}"`);
                }
            }
            expect({ wrong }).toEqual({ wrong: [] });
        });

        it("un tenant sin la capacidad no ve la pantalla a la que se derivaría", () => {
            // El otro lado del mismo hecho, dicho como lo vive el restaurante:
            // con sus capacidades reales, la agenda y el catálogo de cursos no
            // están, y por eso Assist no puede ofrecerlas.
            const restaurant = resolveVerticalDashboard({
                industry: "restaurantes",
                effectiveCapabilities: ["restaurant_ordering", "faq_search"],
            });
            for (const route of ["/admin/appointments", "/admin/catalog/campaigns"]) {
                const item = getVerticalDashboardItemForPath(route);
                expect(item).not.toBeNull();
                expect(restaurant.visibleItems).not.toContain(item!);
            }
            // Y las transversales sí, o el arreglo habría roto lo que servía.
            for (const route of ["/admin/channels", "/admin/users", "/admin/agent",
                "/admin/settings/integrations/payments", "/admin/catalog/offers"]) {
                expect(getVerticalDashboardItemForPath(route)).toBeNull();
            }
        });
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
