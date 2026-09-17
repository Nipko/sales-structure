import * as fs from "fs";
import * as path from "path";
import {
  BILLING_READINESS_ENDPOINT,
  BILLING_TIME_ZONE_ENDPOINT,
  SUGGESTED_BILLING_TIME_ZONE,
  billingTimeZoneOptions,
  billingZoneAccess,
  billingZoneNumberLabel,
  billingZoneStateFor,
  buildBillingTimeZoneRequest,
  filterTimeZones,
  readBillingZoneReadiness,
  readBillingZoneSaveOutcome,
  timeZoneOffsetLabel,
} from "./billing-time-zone";

/**
 * ═══ SIN ZONA HORARIA DE FACTURACIÓN, EL NÚMERO NO RESPONDE ═══
 *
 * La admisión de gasto de WhatsApp lee `channel_accounts.waba_timezone` y nada
 * más: sin ese valor rechaza todo envío cobrable (`timezone_missing`), la cola
 * reintenta ~50 minutos y lo suprime. En producción ningún número activo lo
 * tenía, y el único escritor (`POST .../billing-timezone`) no tenía pantalla.
 *
 * Estas pruebas fijan tres cosas que la pantalla no puede decidir por su cuenta:
 *  - "configurada" es la zona que el NÚMERO guarda, no la que la lectura deduce
 *    de un hermano (`inherited`): el envío no lee la deducción;
 *  - una lectura que falló es "no sabemos", nunca "está bien";
 *  - la sugerencia (America/Bogota) es sólo un valor inicial: construir la
 *    petición exige que alguien elija una zona de la lista.
 */

const readiness = (numbers: unknown[], contradictions: unknown[] = []) => ({
  success: true,
  data: { numbers, contradictions, pending: 0, contradictory: contradictions.length },
});

const unmapped = {
  channelAccountId: "111",
  wabaId: "waba-1",
  timezoneId: null,
  zone: null,
  evidence: null,
  resolution: { kind: "unmapped", reason: "no_timezone_id" },
  guidance: "Meta did not report a time zone for this number.",
  metadata: { displayPhoneNumber: "+57 300 000 0001" },
};

describe("readBillingZoneReadiness", () => {
  it("reads every number with the zone the number itself holds", () => {
    const parsed = readBillingZoneReadiness(readiness([
      unmapped,
      { ...unmapped, channelAccountId: "222", zone: "America/Lima", resolution: { kind: "known", zone: "America/Lima" } },
    ]));

    expect(parsed?.numbers.map((n) => [n.phoneNumberId, n.zone, n.resolution])).toEqual([
      ["111", null, "unmapped"],
      ["222", "America/Lima", "known"],
    ]);
    expect(parsed?.numbers[0].displayPhoneNumber).toBe("+57 300 000 0001");
  });

  it("answers null — not an empty list — when the read failed or has another shape", () => {
    // `.catch(() => null)` en el cargador; un 403/404 como sobre de error; y el
    // cuerpo de otra ruta. Ninguno de los tres es "todos los números están bien".
    expect(readBillingZoneReadiness(null)).toBeNull();
    expect(readBillingZoneReadiness({ success: false, httpStatus: 403 })).toBeNull();
    expect(readBillingZoneReadiness({ success: true, data: { connected: true, accounts: [] } })).toBeNull();
  });

  it("skips entries without a phone number id instead of inventing one", () => {
    const parsed = readBillingZoneReadiness(readiness([{ zone: "America/Bogota" }, unmapped]));
    expect(parsed?.numbers.map((n) => n.phoneNumberId)).toEqual(["111"]);
  });

  it("keeps the zone a sibling would give and the zones two siblings disagree on", () => {
    const parsed = readBillingZoneReadiness(readiness([
      { ...unmapped, channelAccountId: "333", resolution: { kind: "inherited", zone: "America/Mexico_City" } },
      { ...unmapped, channelAccountId: "444", resolution: { kind: "contradictory", zones: ["America/Bogota", "America/Lima"] } },
    ], [{ wabaId: "waba-1", zones: ["America/Bogota", "America/Lima"], numbers: ["555", "666"] }]));

    expect(parsed?.numbers[0].resolvedZone).toBe("America/Mexico_City");
    expect(parsed?.numbers[1].candidateZones).toEqual(["America/Bogota", "America/Lima"]);
    expect(parsed?.contradictions).toEqual([{ wabaId: "waba-1", zones: ["America/Bogota", "America/Lima"], numbers: ["555", "666"] }]);
  });
});

describe("billingZoneStateFor", () => {
  it("is missing when the number has no zone, and suggests Bogota only as a starting value", () => {
    const state = billingZoneStateFor("111", readBillingZoneReadiness(readiness([unmapped])));
    expect(state).toEqual({
      kind: "missing",
      suggestion: SUGGESTED_BILLING_TIME_ZONE,
      suggestionSource: "common",
      conflictingZones: [],
    });
    expect(SUGGESTED_BILLING_TIME_ZONE).toBe("America/Bogota");
  });

  it("is still missing when the reading inherits a zone: sending reads the number's own column", () => {
    const state = billingZoneStateFor("333", readBillingZoneReadiness(readiness([
      { ...unmapped, channelAccountId: "333", resolution: { kind: "inherited", zone: "America/Mexico_City" } },
    ])));
    expect(state).toEqual({
      kind: "missing",
      suggestion: "America/Mexico_City",
      suggestionSource: "same_account",
      conflictingZones: [],
    });
  });

  it("suggests nothing when two numbers of the same account disagree", () => {
    const state = billingZoneStateFor("444", readBillingZoneReadiness(readiness([
      { ...unmapped, channelAccountId: "444", resolution: { kind: "contradictory", zones: ["America/Bogota", "America/Lima"] } },
    ])));
    expect(state).toEqual({
      kind: "missing",
      suggestion: null,
      suggestionSource: null,
      conflictingZones: ["America/Bogota", "America/Lima"],
    });
  });

  it("is set when the number holds a zone the reading recognises", () => {
    const state = billingZoneStateFor("222", readBillingZoneReadiness(readiness([
      { ...unmapped, channelAccountId: "222", zone: "America/Lima", resolution: { kind: "known", zone: "America/Lima" } },
    ])));
    expect(state).toEqual({ kind: "set", zone: "America/Lima", conflictingZones: [] });
  });

  it("is missing when the stored zone is one the server could not use", () => {
    // `resolveZone` sólo contesta `known` si el runtime puede formatear con la
    // zona; si guardaron basura por SQL, la admisión también la rechaza.
    const state = billingZoneStateFor("222", readBillingZoneReadiness(readiness([
      { ...unmapped, channelAccountId: "222", zone: "GMT-5:00", resolution: { kind: "unmapped", reason: "no_timezone_id" } },
    ])));
    expect(state.kind).toBe("missing");
  });

  it("carries the disagreement when a set number is part of a contradiction", () => {
    const state = billingZoneStateFor("555", readBillingZoneReadiness(readiness([
      { ...unmapped, channelAccountId: "555", zone: "America/Bogota", resolution: { kind: "known", zone: "America/Bogota" } },
    ], [{ wabaId: "waba-1", zones: ["America/Bogota", "America/Lima"], numbers: ["555", "666"] }])));
    expect(state).toEqual({ kind: "set", zone: "America/Bogota", conflictingZones: ["America/Bogota", "America/Lima"] });
  });

  it("is unknown, never set, when the reading failed or does not list the number", () => {
    expect(billingZoneStateFor("111", null)).toEqual({ kind: "unknown" });
    expect(billingZoneStateFor("999", readBillingZoneReadiness(readiness([unmapped])))).toEqual({ kind: "unknown" });
    expect(billingZoneStateFor("", readBillingZoneReadiness(readiness([unmapped])))).toEqual({ kind: "unknown" });
  });
});

describe("billingZoneAccess", () => {
  it("gives the form to the two roles the endpoint accepts", () => {
    expect(billingZoneAccess({ role: "tenant_admin", emailVerified: true })).toBe("form");
    expect(billingZoneAccess({ role: "super_admin" })).toBe("form");
    // Sesiones viejas no traen `emailVerified`: la ausencia no es "sin verificar".
    expect(billingZoneAccess({ role: "tenant_admin" })).toBe("form");
  });

  it("asks an unverified admin to verify first, instead of a button that refuses", () => {
    expect(billingZoneAccess({ role: "tenant_admin", emailVerified: false })).toBe("verify_email");
    // super_admin pasa el guard de correo siempre.
    expect(billingZoneAccess({ role: "super_admin", emailVerified: false })).toBe("form");
  });

  it("sends everybody else to an administrator", () => {
    for (const role of ["tenant_supervisor", "tenant_agent", "tenant_viewer", "", undefined]) {
      expect(billingZoneAccess({ role })).toBe("ask_admin");
    }
    expect(billingZoneAccess(null)).toBe("ask_admin");
  });
});

describe("buildBillingTimeZoneRequest", () => {
  const options = ["America/Bogota", "America/Lima"];

  it("builds exactly the body the endpoint reads", () => {
    expect(buildBillingTimeZoneRequest(" 111 ", " America/Lima ", options)).toEqual({
      ok: true,
      body: { phoneNumberId: "111", timeZone: "America/Lima" },
    });
  });

  it("refuses to send without a number or a zone", () => {
    expect(buildBillingTimeZoneRequest("", "America/Lima", options)).toEqual({ ok: false, reason: "number_missing" });
    expect(buildBillingTimeZoneRequest("111", "  ", options)).toEqual({ ok: false, reason: "zone_missing" });
  });

  it("refuses a zone that is not one of the offered choices", () => {
    // El id numérico de Meta y un desfase escrito a mano parecen zonas y no lo son.
    for (const zone of ["12", "GMT-5:00", "America/Bogotá", "America/Caracas"]) {
      expect(buildBillingTimeZoneRequest("111", zone, options)).toEqual({ ok: false, reason: "zone_not_in_list" });
    }
  });
});

describe("readBillingZoneSaveOutcome", () => {
  const request = { phoneNumberId: "111", timeZone: "America/Bogota" };

  it("reads the saved zone and the sibling numbers it was also applied to", () => {
    expect(readBillingZoneSaveOutcome({
      success: true,
      data: { phoneNumberId: "111", timeZone: "America/Bogota", alsoApplied: ["222", "", "333", "222", "111", 7] },
    }, request)).toEqual({ kind: "saved", timeZone: "America/Bogota", alsoApplied: ["222", "333"] });
  });

  it("still counts a success whose body is thin as saved, with nothing else applied", () => {
    expect(readBillingZoneSaveOutcome({ success: true }, request))
      .toEqual({ kind: "saved", timeZone: "America/Bogota", alsoApplied: [] });
  });

  it("maps a 400 to an invalid zone", () => {
    expect(readBillingZoneSaveOutcome({ success: false, httpStatus: 400, error: "\"12\" no es una zona horaria IANA" }, request))
      .toEqual({ kind: "invalid_zone" });
  });

  it("tells an unverified email apart from a role that may not do it", () => {
    expect(readBillingZoneSaveOutcome({ success: false, httpStatus: 403, errorCode: "email_not_verified" }, request))
      .toEqual({ kind: "verify_email" });
    expect(readBillingZoneSaveOutcome({ success: false, httpStatus: 403, errorCode: "Forbidden", error: "Forbidden resource" }, request))
      .toEqual({ kind: "not_allowed" });
  });

  it("maps a number that is no longer the tenant's, and everything else to a retryable failure", () => {
    expect(readBillingZoneSaveOutcome({ success: false, httpStatus: 404, errorCode: "connection_refused" }, request))
      .toEqual({ kind: "number_not_found" });
    expect(readBillingZoneSaveOutcome({ success: false, error: "Error de conexión" }, request)).toEqual({ kind: "failed" });
    expect(readBillingZoneSaveOutcome({ success: false, httpStatus: 500 }, request)).toEqual({ kind: "failed" });
    expect(readBillingZoneSaveOutcome(null, request)).toEqual({ kind: "failed" });
  });
});

describe("time zone choices", () => {
  it("offers the runtime's zones with the suggestion always present and American zones first", () => {
    const options = billingTimeZoneOptions(() => ["Europe/Madrid", "America/Lima", "Africa/Cairo", "America/Lima"]);
    expect(options[0].startsWith("America/")).toBe(true);
    expect(options).toContain(SUGGESTED_BILLING_TIME_ZONE);
    expect(options.filter((zone) => zone === "America/Lima")).toHaveLength(1);
    expect(options.indexOf("Africa/Cairo")).toBeGreaterThan(options.indexOf("America/Lima"));
  });

  it("falls back to a fixed list when the browser cannot enumerate zones", () => {
    const options = billingTimeZoneOptions(() => { throw new Error("unsupported"); });
    expect(options).toContain("America/Bogota");
    expect(options).toContain("America/Mexico_City");
    expect(options.length).toBeGreaterThan(10);
  });

  it("finds a zone by city with accents, spaces or country name, and keeps the chosen one", () => {
    const options = ["America/Bogota", "America/Mexico_City", "America/Sao_Paulo", "Europe/Madrid"];
    expect(filterTimeZones(options, "bogotá")).toEqual(["America/Bogota"]);
    expect(filterTimeZones(options, "mexico city")).toEqual(["America/Mexico_City"]);
    expect(filterTimeZones(options, "colombia")).toEqual(["America/Bogota"]);
    expect(filterTimeZones(options, "são paulo")).toEqual(["America/Sao_Paulo"]);
    expect(filterTimeZones(options, "")).toEqual(options);
    // Filtrar no puede dejar el selector sin el valor elegido.
    expect(filterTimeZones(options, "madrid", "America/Bogota")).toEqual(["America/Bogota", "Europe/Madrid"]);
  });

  it("labels a zone with its current offset, and never throws on a bad one", () => {
    const at = new Date("2026-09-17T12:00:00Z");
    expect(timeZoneOffsetLabel("America/Bogota", at)).toBe("UTC-05:00");
    expect(timeZoneOffsetLabel("not/a zone", at)).toBe("");
  });
});

describe("billingZoneNumberLabel", () => {
  it("names a number the way the page lists it, falling back to the reading and then the id", () => {
    const rows = [{ accountId: "111", metadata: { displayPhoneNumber: "+57 300 000 0001" } }];
    const parsed = readBillingZoneReadiness(readiness([
      { ...unmapped, channelAccountId: "222", metadata: { displayPhoneNumber: "+57 300 000 0002" } },
    ]));
    expect(billingZoneNumberLabel("111", rows, parsed)).toBe("+57 300 000 0001");
    expect(billingZoneNumberLabel("222", rows, parsed)).toBe("+57 300 000 0002");
    expect(billingZoneNumberLabel("333", rows, parsed)).toBe("333");
  });
});

/**
 * ═══ LAS DOS RUTAS LLEGAN AL CONTROLADOR QUE LAS ATIENDE ═══
 *
 * `GET /channels/whatsapp/status` y `/config` las contesta el controlador
 * GENÉRICO (`@Controller('channels')` + `:channelType/...`), que se registra
 * antes y le hace sombra al de WhatsApp. Si alguna ruta genérica pudiera
 * coincidir con estas dos, el formulario le pegaría a otro handler y nadie lo
 * notaría. El orden real del router se verificó contra el AppModule; esto fija,
 * sin arrancarlo, que ninguna ruta genérica del mismo método coincide.
 */
describe("the billing time zone routes are not shadowed by a generic channel route", () => {
  const API_SRC = path.join(__dirname, "..", "..", "..", "..", "..", "..", "api", "src", "modules");
  const read = (file: string) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

  function routesOf(file: string): Array<{ method: string; path: string }> {
    const source = read(file);
    const base = source.match(/@Controller\(\s*['"]([^'"]*)['"]\s*\)/)?.[1] ?? "";
    const out: Array<{ method: string; path: string }> = [];
    for (const match of source.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:['"]([^'"]*)['"])?\s*\)/g)) {
      out.push({ method: match[1].toUpperCase(), path: `/${[base, match[2] ?? ""].filter(Boolean).join("/")}` });
    }
    return out;
  }

  const matches = (url: string, declared: string) => {
    const a = url.split("/");
    const b = declared.split("/");
    return a.length === b.length && a.every((segment, i) => b[i].startsWith(":") || segment === b[i]);
  };

  const whatsapp = routesOf(path.join(API_SRC, "whatsapp", "whatsapp.controller.ts"));
  const generic = [
    ...routesOf(path.join(API_SRC, "channels", "channel-management.controller.ts")),
    ...routesOf(path.join(API_SRC, "channels", "channels.controller.ts")),
  ];

  it.each([
    ["POST", BILLING_TIME_ZONE_ENDPOINT],
    ["GET", BILLING_READINESS_ENDPOINT],
  ])("%s %s is declared by WhatsappController and by no generic channel controller", (method, url) => {
    expect(whatsapp).toContainEqual({ method, path: url });
    expect(generic.length).toBeGreaterThan(10);
    expect(generic.filter((route) => route.method === method && matches(url, route.path))).toEqual([]);
  });

  it("is what the screen actually calls: the page reads the readiness, the card posts through the client", () => {
    const here = (file: string) => read(path.join(__dirname, file));
    const client = read(path.join(__dirname, "..", "..", "..", "..", "lib", "api.ts"));
    expect(here("page.tsx")).toContain(`api.fetch("${BILLING_READINESS_ENDPOINT}")`);
    expect(here("page.tsx")).toContain("readBillingZoneReadiness(readinessRes)");
    expect(here("page.tsx")).toContain("billingZoneStateFor(pnid, billingZones)");
    expect(here("WhatsAppBillingTimeZone.tsx")).toContain("api.setWhatsappBillingTimeZone(");
    expect(client).toMatch(new RegExp(
      `setWhatsappBillingTimeZone:[^\\n]*\\n[^\\n]*apiPost(?:<[^\\n]*?>)?\\('${BILLING_TIME_ZONE_ENDPOINT}', \\{ phoneNumberId, timeZone \\}\\)`));
  });

  it("would notice the shadowing it guards against", () => {
    // Control: la ruta que sí está tapada tiene que aparecer como tapada.
    expect(generic.filter((route) => route.method === "GET" && matches("/channels/whatsapp/status", route.path)))
      .toEqual([{ method: "GET", path: "/channels/:channelType/status" }]);
  });
});
