import * as fs from "fs";
import * as path from "path";
import { readDisconnectOutcome } from "./disconnect-outcome";

/**
 * La pantalla preguntaba por `providerOk`, un campo que la API nunca devolvió.
 * `undefined === false` es falso, así que CUALQUIER desconexión —incluida la
 * que dejó la app suscrita en Meta— salía con el aviso verde de éxito, y el
 * aviso parcial no se mostró nunca. Se prueba contra la respuesta real y contra
 * la fuente de los dos lados, porque un fixture habría estado de acuerdo con el
 * nombre equivocado.
 */
describe("readDisconnectOutcome", () => {
  it("is complete only when Meta unsubscribed and nothing else failed", () => {
    expect(readDisconnectOutcome({
      success: true,
      message: "WhatsApp desconectado de Meta y de la plataforma",
      metaUnsubscribed: true,
      metaError: null,
    })).toBe("complete");
  });

  it("warns when Meta could not be unsubscribed", () => {
    expect(readDisconnectOutcome({
      success: true,
      message: "WhatsApp marcado como desconectado en la plataforma. ATENCIÓN: la app sigue suscrita en Meta — revisar manualmente.",
      metaUnsubscribed: false,
      metaError: "Meta returned 400: {\"error\":{}}",
    })).toBe("provider_pending");
  });

  it("warns when Meta let go but the local channel could not be marked", () => {
    expect(readDisconnectOutcome({
      success: true,
      metaUnsubscribed: true,
      metaError: "local_channel_not_marked: connection terminated",
    })).toBe("local_incomplete");
  });

  it("does not call an unconfirmed disconnect a success", () => {
    // Sin la confirmación de Meta no se puede afirmar que dejó de enviar.
    expect(readDisconnectOutcome({ success: true })).toBe("provider_pending");
    expect(readDisconnectOutcome({ success: true, providerOk: true })).toBe("provider_pending");
    expect(readDisconnectOutcome(null)).toBe("provider_pending");
  });
});

describe("the disconnect button and the endpoint it calls", () => {
  const read = (file: string): string => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const DASHBOARD_SRC = path.join(__dirname, "..", "..", "..", "..");
  const controller = read(path.join(DASHBOARD_SRC, "..", "..", "api", "src", "modules", "whatsapp", "whatsapp.controller.ts"));
  const page = read(path.join(__dirname, "page.tsx"));

  it("reads the fields the endpoint actually returns", () => {
    const body = controller.slice(controller.indexOf("async disconnect("));
    const returned = body.slice(body.indexOf("return {"), body.indexOf("};", body.indexOf("return {")));
    expect(returned).toContain("metaUnsubscribed");
    expect(returned).toContain("metaError");
    expect(returned).not.toContain("providerOk");

    expect(page).toContain("readDisconnectOutcome(");
    expect(page).not.toContain("providerOk");
  });
});
