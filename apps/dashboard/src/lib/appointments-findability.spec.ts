import * as fs from "fs";
import * as path from "path";
import {
  getNavigationRoute,
  navigationRouteMatchesQuery,
  resolveNavigationDisplayLabel,
} from "./navigation-contract";
import { pipelinePageTitle } from "./pipeline-title";

/**
 * Review of 2026-10-08: a salon owner could not find the appointments screen.
 * The menu called it "turnos" (lowercase), the search answered only to "turno",
 * and the sales pipeline page was titled "Citas".
 */
describe("the appointments screen is found by the words owners use", () => {
  const route = getNavigationRoute("appointments")!;

  it.each(["citas", "cita", "agenda", "turnos", "turno", "reservas", "reserva", "servicios", "Agénda", "CITAS"])(
    "search %s finds it even when the menu label is another word",
    (word) => {
      expect(navigationRouteMatchesQuery(route, "Citas", word)).toBe(true);
      // The label is irrelevant to the synonyms: a vertical may rename the entry.
      expect(navigationRouteMatchesQuery(route, "Itinerarios", word)).toBe(true);
    },
  );

  it("does not find it for an unrelated word", () => {
    expect(navigationRouteMatchesQuery(route, "Citas", "facturacion")).toBe(false);
  });

  it("finds it by the English, Portuguese and French words too", () => {
    for (const word of ["appointments", "booking", "agendamento", "rendez-vous"]) {
      expect(navigationRouteMatchesQuery(route, "Citas", word)).toBe(true);
    }
  });

  it("an empty query matches everything", () => {
    expect(navigationRouteMatchesQuery(route, "Citas", "  ")).toBe(true);
  });
});

describe("menu labels coming from vertical terminology", () => {
  it("capitalises a common noun so the entry reads like its neighbours", () => {
    const overrides = { appointments: { es: "citas", en: "appointments" } };
    expect(resolveNavigationDisplayLabel("appointments", "Citas", "es", overrides)).toBe("Citas");
    expect(resolveNavigationDisplayLabel("appointments", "Appointments", "en-US", overrides)).toBe("Appointments");
  });

  it("leaves labels that are already capitalised, and the translated fallback, alone", () => {
    expect(resolveNavigationDisplayLabel("crm", "CRM", "es", { crm: { es: "Pacientes" } })).toBe("Pacientes");
    expect(resolveNavigationDisplayLabel("pipeline", "Embudo de ventas", "es", {})).toBe("Embudo de ventas");
    expect(resolveNavigationDisplayLabel("appointments", "Citas", "fr", { appointments: { es: "citas" } })).toBe("Citas");
  });
});

describe("the sales pipeline page is never titled like the appointments screen", () => {
  it("takes the title from the menu label", () => {
    const overrides = { pipeline: { es: "Oportunidades" } };
    expect(pipelinePageTitle("citas", "es", overrides)).toBe("Oportunidades");
  });

  it("falls back to the capitalised noun when the menu has no entry", () => {
    expect(pipelinePageTitle("seguimiento", "es", null)).toBe("Seguimiento");
  });
});

describe("the menu body stays scrollable on short screens", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "components", "layout", "AppSidebar.tsx"), "utf8");

  it("keeps help, news and settings inside the scrolling list, pinned only when there is height", () => {
    const scroll = source.indexOf("flex-1 overflow-y-auto px-2 pt-3 custom-scrollbar");
    const footer = source.indexOf("[@media(min-height:700px)]:sticky");
    const navEnd = source.indexOf("</nav>", scroll);
    expect(scroll).toBeGreaterThan(-1);
    expect(footer).toBeGreaterThan(scroll);
    expect(footer).toBeLessThan(navEnd);
    // The old layout: a fixed block that never scrolls.
    expect(source).not.toContain('<div className="shrink-0 space-y-1 border-t border-border/40 p-2">');
  });
});
