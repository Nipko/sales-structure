import * as fs from "fs";
import * as path from "path";
import {
  EMBEDDED_SIGNUP_FINISH_EVENTS,
  admitAuthorizationCode,
  buildEmbeddedSignupLoginOptions,
  decideAuthorizationCode,
  extractEmbeddedSignupSessionData,
  getEmbeddedSignupErrorDetails,
  parseEmbeddedSignupEvent,
} from "./embedded-signup-events";

describe("embedded signup events", () => {
  describe("login options", () => {
    it("builds the standard flow without a preselected customer business", () => {
      const options = buildEmbeddedSignupLoginOptions("config-1", "solution-1", "standard");

      expect(options).toEqual({
        config_id: "config-1",
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: { solutionID: "solution-1" },
          version: "v4",
        },
      });
      expect(JSON.stringify(options)).not.toContain("business_id");
    });

    it("keeps an empty setup when there is no solution and enables coexistence", () => {
      const options = buildEmbeddedSignupLoginOptions("config-2", "", "coexistence");

      expect(options.extras).toEqual({
        setup: {},
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
        version: "v4",
      });
      expect(JSON.stringify(options)).not.toContain("business_id");
    });
  });

  it.each([
    "FINISH",
    "FINISH_ONLY_WABA",
    "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  ])("recognizes the %s completion event", (event) => {
    expect(EMBEDDED_SIGNUP_FINISH_EVENTS.has(event)).toBe(true);
  });

  it("parses string messages and captures all customer account identifiers", () => {
    const result = parseEmbeddedSignupEvent(JSON.stringify({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      data: {
        business_id: "123456",
        waba_id: "234567",
        phone_number_id: "345678",
      },
    }));

    expect(result).toMatchObject({
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      session: {
        business_id: "123456",
        waba_id: "234567",
        phone_number_id: "345678",
      },
    });
  });

  it("normalizes numeric IDs and ignores unrelated or malformed messages", () => {
    expect(extractEmbeddedSignupSessionData({ business_id: 123, waba_id: 456 })).toEqual({
      business_id: "123",
      waba_id: "456",
      phone_number_id: undefined,
    });
    expect(parseEmbeddedSignupEvent("not-json")).toBeNull();
    expect(parseEmbeddedSignupEvent({ type: "OTHER", event: "FINISH" })).toBeNull();
  });

  it("extracts a useful message from nested Meta errors", () => {
    expect(getEmbeddedSignupErrorDetails({ error: { message: "Invalid business portfolio" } }))
      .toBe("Invalid business portfolio");
    expect(getEmbeddedSignupErrorDetails({ error_id: "1690130" })).toBeNull();
  });

  it("preserves an error attached to a CANCEL event", () => {
    const result = parseEmbeddedSignupEvent({
      type: "WA_EMBEDDED_SIGNUP",
      event: "CANCEL",
      data: { error_message: "The selected business is not valid" },
    });

    expect(result?.event).toBe("CANCEL");
    expect(getEmbeddedSignupErrorDetails(result?.data)).toBe("The selected business is not valid");
  });

  /**
   * El SDK de Facebook guarda en memoria el último `authResponse.code` y se lo
   * entrega a un `FB.login` posterior cuando la ventana se cierra sin terminar.
   * En producción eso mandó al servidor un código ya canjeado ("This
   * authorization code has been used") y la persona vio un error de conexión
   * cuando en realidad sólo había cerrado la ventana. Un código de Meta sirve
   * una sola vez: la pantalla no lo ofrece dos veces.
   */
  describe("authorization code reuse", () => {
    const fresh = { terminalEvent: null, finishSeen: false } as const;

    it("submits the first code it sees", () => {
      expect(decideAuthorizationCode("code-1", { ...fresh, handledCodes: new Set() }))
        .toEqual({ action: "submit", code: "code-1" });
    });

    it("does not submit a code it already offered to the server", () => {
      const handledCodes = new Set(["code-1"]);

      expect(decideAuthorizationCode("code-1", { ...fresh, handledCodes }))
        .toEqual({ action: "already_submitted", code: "code-1" });
    });

    it("submits a different code after an earlier one was used", () => {
      const handledCodes = new Set(["code-1"]);

      expect(decideAuthorizationCode("code-2", { ...fresh, handledCodes }))
        .toEqual({ action: "submit", code: "code-2" });
    });

    it.each(["cancel", "error"] as const)(
      "does not submit a code that arrives after a %s for the current launch without a FINISH",
      (terminalEvent) => {
        expect(decideAuthorizationCode("code-9", { handledCodes: new Set(), terminalEvent, finishSeen: false }))
          .toEqual({ action: "after_terminal_event", code: "code-9" });
      },
    );

    it("submits when Meta finished the launch even if it posted a cancel first", () => {
      // Volver atrás dentro de la ventana y terminar igual: el FINISH manda.
      expect(decideAuthorizationCode("code-3", { handledCodes: new Set(), terminalEvent: "cancel", finishSeen: true }))
        .toEqual({ action: "submit", code: "code-3" });
    });

    it("still refuses a used code when Meta says the launch finished", () => {
      expect(decideAuthorizationCode("code-1", { handledCodes: new Set(["code-1"]), terminalEvent: null, finishSeen: true }))
        .toEqual({ action: "already_submitted", code: "code-1" });
    });

    it.each([undefined, null, "", "   ", 42])("treats %p as no code at all", (code) => {
      expect(decideAuthorizationCode(code, { ...fresh, handledCodes: new Set() }))
        .toEqual({ action: "no_code" });
    });

    it("never mutates the memory it is given", () => {
      const handledCodes = new Set<string>();
      decideAuthorizationCode("code-1", { ...fresh, handledCodes });
      expect(handledCodes.size).toBe(0);
    });
  });

  /**
   * Decidir bien no alcanza si la pantalla se olvida de anotar el código: la
   * segunda entrega del mismo `authResponse.code` volvería a salir hacia
   * `/onboarding/start`. `admitAuthorizationCode` decide Y anota en un solo
   * paso, y el componente la llama antes de cualquier `fetch`.
   */
  describe("admitting an authorization code", () => {
    const fresh = { terminalEvent: null, finishSeen: false } as const;

    it("records a code it submits", () => {
      const memory = new Set<string>();

      expect(admitAuthorizationCode("code-1", memory, fresh)).toEqual({ action: "submit", code: "code-1" });
      expect([...memory]).toEqual(["code-1"]);
    });

    it("answers already_submitted the second time the same code arrives", () => {
      const memory = new Set<string>();

      admitAuthorizationCode("code-1", memory, fresh);
      // Meta finishing the second launch does not make a spent code new.
      expect(admitAuthorizationCode("code-1", memory, { terminalEvent: null, finishSeen: true }))
        .toEqual({ action: "already_submitted", code: "code-1" });
      expect([...memory]).toEqual(["code-1"]);
    });

    it("keeps a code it had already recorded", () => {
      const memory = new Set(["code-1"]);

      expect(admitAuthorizationCode("code-1", memory, fresh)).toEqual({ action: "already_submitted", code: "code-1" });
      expect(memory.has("code-1")).toBe(true);
    });

    it("records a code refused after a cancel, so it is never sent later either", () => {
      const memory = new Set<string>();

      expect(admitAuthorizationCode("code-9", memory, { terminalEvent: "cancel", finishSeen: false }))
        .toEqual({ action: "after_terminal_event", code: "code-9" });
      expect(memory.has("code-9")).toBe(true);
      // The same leftover handed over on the next, clean launch stays refused.
      expect(admitAuthorizationCode("code-9", memory, fresh))
        .toEqual({ action: "already_submitted", code: "code-9" });
    });

    it.each([undefined, null, "", "   "])("records nothing when there is no code (%p)", (code) => {
      const memory = new Set<string>();

      expect(admitAuthorizationCode(code, memory, fresh)).toEqual({ action: "no_code" });
      expect(memory.size).toBe(0);
    });
  });

  describe("WhatsAppEmbeddedSignup wiring", () => {
    // `core.autocrlf` deja el árbol en CRLF y el blob en LF.
    const source = fs.readFileSync(path.join(__dirname, "WhatsAppEmbeddedSignup.tsx"), "utf8").replace(/\r\n/g, "\n");

    /** The body of `handleFBResponse`, up to its dependency list. */
    function handleFBResponseBody(): string {
      const start = source.indexOf("const handleFBResponse = useCallback(");
      expect(start).toBeGreaterThan(-1);
      const end = source.indexOf("processResponse();", start);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    }

    it("admits the code into the page-wide memory before any request leaves", () => {
      const body = handleFBResponseBody();

      const admit = body.search(/admitAuthorizationCode\(\s*response\.authResponse\?\.code\s*,\s*handledAuthorizationCodes\s*,/);
      const firstFetch = body.search(/\bfetch\(/);
      const onboardingStart = body.search(/fetch\(\s*`\$\{WA_SERVICE_URL\}\/onboarding\/start`/);

      expect(admit).toBeGreaterThan(-1);
      expect(onboardingStart).toBeGreaterThan(-1);
      expect(firstFetch).toBeGreaterThan(admit);
      expect(onboardingStart).toBeGreaterThan(admit);
    });

    it("never decides or records a code by hand", () => {
      const body = handleFBResponseBody();

      // Deciding without recording is the gap this closes; recording by hand
      // is how the two drift apart again.
      expect(body).not.toMatch(/decideAuthorizationCode\(/);
      expect(body).not.toMatch(/handledAuthorizationCodes\.add\(/);
      expect(source.match(/admitAuthorizationCode\(/g)).toHaveLength(1);
    });

    it("keeps that memory at module scope, shared by every mounted instance", () => {
      expect(source).toMatch(/^const handledAuthorizationCodes = new Set<string>\(\);$/m);
    });
  });
});
