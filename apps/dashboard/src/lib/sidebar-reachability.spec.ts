import * as fs from "fs";
import * as path from "path";
import { VERTICAL_DASHBOARD_ITEMS } from "./vertical-dashboard-resolver";

/**
 * Una pantalla que existe y a la que no se llega es lo mismo que no tenerla.
 *
 * `/admin/cases` se creó completa —endpoint, página, permisos, i18n, cuatro
 * registros de contrato— y **el menú no la listaba**. Las pruebas de contrato
 * que existían verificaban el registro de navegación, la clasificación de
 * superficie y el resolutor por capacidad: los tres pasaron, porque los tres
 * miran registros y ninguno mira el menú.
 *
 * Ésta mira el menú.
 */

const SIDEBAR = fs.readFileSync(
    path.resolve(__dirname, "../components/layout/AppSidebar.tsx"),
    "utf8",
);

/** Los `verticalItem: "x"` que el menú realmente lista. */
function sidebarVerticalItems(): Set<string> {
    return new Set([...SIDEBAR.matchAll(/verticalItem: "(\w+)"/g)].map(match => match[1]));
}

describe("todo ítem vertical llega al menú", () => {
    const listed = sidebarVerticalItems();

    it("el menú se pudo leer y lista ítems", () => {
        // Si el barrido deja de encontrarlos, la prueba de abajo pasaría sin
        // verificar nada.
        expect(listed.size).toBeGreaterThan(15);
    });

    it.each(VERTICAL_DASHBOARD_ITEMS.map(item => [item] as const))(
        "%s tiene entrada en el menú",
        (item) => {
            expect(listed.has(item)).toBe(true);
        },
    );

    it("el menú no lista un ítem que el resolutor no conoce", () => {
        // La dirección opuesta: una entrada con un `verticalItem` que nadie
        // resuelve queda visible para todos los rubros, incluidos los que no
        // tienen esa capacidad.
        const known = new Set<string>(VERTICAL_DASHBOARD_ITEMS);
        for (const item of listed) expect(known.has(item)).toBe(true);
    });
});

describe("las secciones agrupan por trabajo, no por parecido", () => {
    it("las personas y el embudo son secciones distintas", () => {
        // Estaban juntas bajo un ítem llamado "CRM": buscar el teléfono de un
        // cliente obligaba a entrar por una sección que habla de
        // negociaciones. Son dos trabajos y los hace gente distinta.
        expect(SIDEBAR).toContain('titleKey: "customers"');
        expect(SIDEBAR).toContain('titleKey: "commercial"');
    });

    it("lo esencial es lo que se abre primero, y nada más", () => {
        const essentials = SIDEBAR.slice(
            SIDEBAR.indexOf('titleKey: "essentials"'),
            SIDEBAR.indexOf('titleKey: "customers"'),
        );
        expect(essentials).toContain('href: "/admin/inbox"');
        // El embudo y los contactos ya no viven acá.
        expect(essentials).not.toContain('href: "/admin/pipeline"');
        expect(essentials).not.toContain('href: "/admin/contacts"');
    });

    it("las ofertas viven con el embudo, no con el catálogo", () => {
        // Una oferta es una palanca comercial, no una ficha de producto: quien
        // la crea está moviendo una negociación.
        const commercial = SIDEBAR.slice(
            SIDEBAR.indexOf('titleKey: "commercial"'),
            SIDEBAR.indexOf('titleKey: "dailyWork"'),
        );
        expect(commercial).toContain('href: "/admin/catalog/offers"');
    });
});
