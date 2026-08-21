import {
  ADMIN_CREATE_AVAILABILITY,
  SIGNUP_AVAILABILITY,
  offerableSubTypes,
  type VerticalCatalogSubType,
} from "./vertical-catalog";

/**
 * Cerrar un perfil a las altas nuevas no puede romper al tenant que ya está
 * adentro.
 *
 * El catálogo llega completo del API a propósito: si el subtipo del tenant
 * desapareciera del payload, su propia pantalla no sabría cómo llamarlo y el
 * primer guardado se lo cambiaría por otra cosa. El recorte es de la superficie
 * que OFRECE, y siempre conservando lo que el tenant ya tiene.
 */

const catalog: VerticalCatalogSubType[] = [
  { key: "comida_rapida", label: { es: "Comida rápida" }, availability: "selectable" },
  { key: "piloto", label: { es: "Piloto" }, availability: "pilot" },
  { key: "espera", label: { es: "En espera" }, availability: "waitlist" },
  { key: "aseguradora", label: { es: "Aseguradora" }, availability: "legacy_only" },
];

describe("offerableSubTypes", () => {
  it("un alta self-service solo ofrece lo elegible", () => {
    const offered = offerableSubTypes(catalog, SIGNUP_AVAILABILITY).map((s) => s.key);
    expect(offered).toEqual(["comida_rapida"]);
  });

  it("un super_admin además ve los pilotos, pero no lo cerrado", () => {
    const offered = offerableSubTypes(catalog, ADMIN_CREATE_AVAILABILITY).map((s) => s.key);
    expect(offered).toEqual(["comida_rapida", "piloto"]);
  });

  it("conserva el subtipo que el tenant ya tiene, aunque esté cerrado", () => {
    const offered = offerableSubTypes(catalog, SIGNUP_AVAILABILITY, "aseguradora");
    expect(offered.map((s) => s.key)).toEqual(["comida_rapida", "aseguradora"]);
  });

  it("sin el dato trata la opción como elegible", () => {
    // Un API anterior a este campo no puede dejar el selector vacío y bloquear
    // todas las altas. La puerta que cuenta está en el servidor.
    const legacy: VerticalCatalogSubType[] = [{ key: "viejo", label: { es: "Viejo" } }];
    expect(offerableSubTypes(legacy, SIGNUP_AVAILABILITY).map((s) => s.key)).toEqual(["viejo"]);
  });

  it("no muta el catálogo que recibe", () => {
    const before = catalog.length;
    offerableSubTypes(catalog, SIGNUP_AVAILABILITY);
    expect(catalog).toHaveLength(before);
  });
});
