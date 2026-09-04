import {
  UNKNOWN_ONBOARDING_GUIDE,
  isOnboardingGuideKnown,
  resolveLoginRedirect,
  readSetupStatusFacts,
} from "./onboarding-guide";

/**
 * Dónde aterriza un login, del lado del panel.
 *
 * La regla es una sola: al asistente de configuración SOLO se va con
 * evidencia — una etapa que el servidor mandó de verdad. La versión anterior
 * derivaba `account_created` de un campo ausente y además afirmaba
 * `hasAnyChannel: false` sin saberlo, así que cada tenant_admin entraba al
 * asistente en cada login, para siempre.
 */
describe("resolveLoginRedirect", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";

  it("sin etapa recibida va al panel, nunca al asistente", () => {
    expect(resolveLoginRedirect({ role: "tenant_admin", tenantId })).toBe("/admin");
  });

  it.each([
    ["un valor desconocido", "listo"],
    ["un objeto", { stage: "account_created" }],
    ["null", null],
  ])("%s tampoco alcanza para mandar al asistente", (_label, onboardingStage) => {
    expect(resolveLoginRedirect({ role: "tenant_admin", tenantId, onboardingStage })).toBe("/admin");
  });

  it("con `account_created` recibido del servidor sí guía al asistente", () => {
    expect(resolveLoginRedirect({ role: "tenant_admin", tenantId, onboardingStage: "account_created" }))
      .toBe("/admin/setup-wizard");
  });

  it.each(["agent_reviewed", "channel_deferred", "channel_connected", "completed"])(
    "un tenant en %s entra directo al panel",
    (onboardingStage) => {
      expect(resolveLoginRedirect({ role: "tenant_admin", tenantId, onboardingStage })).toBe("/admin");
    },
  );

  it("un rol que no configura el agente nunca va al asistente", () => {
    expect(resolveLoginRedirect({ role: "tenant_agent", tenantId, onboardingStage: "account_created" }))
      .toBe("/admin");
  });

  it("super_admin va al panel de plataforma", () => {
    expect(resolveLoginRedirect({ role: "super_admin", onboardingStage: "account_created" })).toBe("/admin");
  });

  it("sin tenant manda a completar el alta, no al asistente", () => {
    expect(resolveLoginRedirect({ role: "tenant_admin", onboardingCompleted: false })).toBe("/onboarding");
  });
});

describe("readSetupStatusFacts", () => {
  it("una respuesta fallida no es un estado: devuelve null", () => {
    expect(readSetupStatusFacts({ success: false })).toBeNull();
    expect(readSetupStatusFacts(null)).toBeNull();
  });

  it("lee los canales conectados para no ofrecer conectar lo ya conectado", () => {
    const facts = readSetupStatusFacts({
      success: true,
      data: { hasAnyChannel: true, connectedChannelTypes: ["whatsapp", "whatsapp", "telegram"] },
    });

    expect(facts?.connectedChannelTypes).toEqual(["whatsapp", "telegram"]);
  });

  it("sin la lista de canales no inventa ninguna", () => {
    const facts = readSetupStatusFacts({ success: true, data: { hasAnyChannel: true } });

    expect(facts?.connectedChannelTypes).toEqual([]);
  });
});

describe("estado desconocido", () => {
  it("no es 'listo': ninguna superficie puede dibujarse con él", () => {
    expect(isOnboardingGuideKnown(UNKNOWN_ONBOARDING_GUIDE)).toBe(false);
    expect(UNKNOWN_ONBOARDING_GUIDE.redirect).toBeNull();
    expect(UNKNOWN_ONBOARDING_GUIDE.showResumeBanner).toBe(false);
  });
});
