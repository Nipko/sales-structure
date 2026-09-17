import { mapConnectFailure } from "./connect-failure";

/**
 * Lo que la pantalla le muestra a quien intenta conectar su WhatsApp depende de
 * DOS cosas del servicio: el estado HTTP y el `code` del cuerpo. En producción
 * el servicio tapaba un 409 de cobertura con un 400 genérico y la persona vio
 * seis veces la misma tarjeta de "no pudimos completar la conexión", con un
 * botón de reintentar que abría Meta de nuevo para fallar igual. Estos casos
 * fijan la forma en que el servicio contesta ahora.
 */
describe("mapConnectFailure", () => {
  it("maps a 409 coverage failure to the coverage card, without a retry that reopens Meta", () => {
    const failure = mapConnectFailure(409, {
      code: "WHATSAPP_TOKEN_MISSING_WABA_SCOPE",
      userMessage: "La credencial no tiene permiso sobre todas las cuentas de WhatsApp conectadas.",
      retryable: false,
      onboardingId: "onb-1",
      wabaId: "2065947547642747",
    });

    expect(failure).toEqual({
      key: "tokenCoverage",
      detail: "La credencial no tiene permiso sobre todas las cuentas de WhatsApp conectadas.",
      href: undefined,
      hrefLabelKey: undefined,
      retryable: false,
    });
  });

  it("never reads a 409 with a coverage code as an onboarding already in progress", () => {
    const failure = mapConnectFailure(409, {
      code: "WHATSAPP_TOKEN_COVERAGE_REQUIRED",
      userMessage: "El token permanente actual no cubre la nueva cuenta.",
    });

    expect(failure.key).toBe("tokenCoverage");
    // Sin `retryable` del servidor, la cobertura tampoco ofrece reabrir Meta.
    expect(failure.retryable).toBe(false);
    expect(failure.detail).toBe("El token permanente actual no cubre la nueva cuenta.");
  });

  it("maps a 409 on the number being connected to its own card, with the retry that reopens Meta", () => {
    // Cuando lo que falta es el número NUEVO, no hay nada viejo que desconectar:
    // la persona dejó ese número sin marcar en la ventana de Meta, y sólo otra
    // ventana lo arregla. Leído como cobertura, la tarjeta le pedía desconectar
    // un número que funciona y le escondía el único botón útil.
    const userMessage =
      "Meta no nos dio acceso al número que quieres conectar. Abre otra vez la ventana de Meta, elige la cuenta de negocio donde está ese número y márcalo. Si se repite, escríbenos a soporte.";
    const failure = mapConnectFailure(409, {
      code: "WHATSAPP_TOKEN_TARGET_NOT_GRANTED",
      userMessage,
      retryable: true,
      onboardingId: "onb-3",
      wabaId: "1111111111111111",
      targetWabaId: "1111111111111111",
    });

    expect(failure).toEqual({
      key: "tokenTargetNotGranted",
      detail: userMessage,
      href: undefined,
      hrefLabelKey: undefined,
      retryable: true,
    });
  });

  it("offers to reopen Meta for the number being connected even when the server omits retryable", () => {
    const failure = mapConnectFailure(409, { code: "WHATSAPP_TOKEN_TARGET_NOT_GRANTED" });

    expect(failure.key).toBe("tokenTargetNotGranted");
    expect(failure.retryable).toBe(true);
  });

  it("still reads the number-being-connected code wrapped under message", () => {
    const failure = mapConnectFailure(409, {
      statusCode: 409,
      message: { code: "WHATSAPP_TOKEN_TARGET_NOT_GRANTED", userMessage: "Falta el número." },
    });

    expect(failure.key).toBe("tokenTargetNotGranted");
    expect(failure.detail).toBe("Falta el número.");
    expect(failure.retryable).toBe(true);
  });

  it("maps a 503 entitlement outage to a retryable card", () => {
    const failure = mapConnectFailure(503, {
      code: "CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE",
      userMessage: "No pudimos verificar tu plan en este momento.",
      retryable: true,
    });

    expect(failure.key).toBe("entitlementUnavailable");
    expect(failure.retryable).toBe(true);
    expect(failure.detail).toBe("No pudimos verificar tu plan en este momento.");
  });

  it("maps a 400 used-or-expired authorization code to a retryable card", () => {
    const failure = mapConnectFailure(400, {
      code: "WA_ES_CODE_EXPIRED",
      userMessage: "El código de autorización de Meta ya se usó o venció. Abre de nuevo la ventana de Meta y complétala sin cerrarla.",
      retryable: true,
      onboardingId: "onb-2",
    });

    expect(failure.key).toBe("codeExpired");
    expect(failure.retryable).toBe(true);
    expect(failure.detail).toBe(
      "El código de autorización de Meta ya se usó o venció. Abre de nuevo la ventana de Meta y complétala sin cerrarla.",
    );
  });

  it("sends a plan limit to billing and does not offer to reopen Meta", () => {
    const failure = mapConnectFailure(400, {
      code: "PLAN_LIMIT_REACHED",
      userMessage: "Tu plan no permite otro número.",
      retryable: false,
    });

    expect(failure).toMatchObject({
      key: "planLimit",
      href: "/admin/settings/billing",
      hrefLabelKey: "goToBilling",
      retryable: false,
    });
  });

  it("keeps Nest's technical prose off the screen", () => {
    // El cuerpo exacto que salió en el incidente: `message` es la clase de la
    // excepción, en inglés, y no es algo que una persona pueda leer.
    const failure = mapConnectFailure(400, {
      statusCode: 400,
      code: "WA_ES_GRAPH_API_ERROR",
      message: "Bad Request Exception",
      retryable: true,
    });

    expect(failure.key).toBe("generic");
    expect(failure.detail).toBeUndefined();
  });

  it("still reads a code wrapped under message", () => {
    const failure = mapConnectFailure(409, {
      statusCode: 409,
      message: { code: "WHATSAPP_TOKEN_MISSING_WABA_SCOPE", userMessage: "Falta alcance." },
    });

    expect(failure.key).toBe("tokenCoverage");
    expect(failure.detail).toBe("Falta alcance.");
    expect(failure.retryable).toBe(false);
  });
});
