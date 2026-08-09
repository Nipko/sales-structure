import {
  EMBEDDED_SIGNUP_FINISH_EVENTS,
  buildEmbeddedSignupLoginOptions,
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
});
