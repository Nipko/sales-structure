import {
  UNKNOWN_ONBOARDING_GUIDE,
  demoLinkPause,
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

  describe("la respuesta a «¿Dónde vive hoy tu número?»", () => {
    const RECORDED = "2026-09-17T15:00:00.000Z";

    it("la lee tal cual la anotó la cuenta", () => {
      const facts = readSetupStatusFacts({
        success: true,
        data: { whatsappTriage: { answerId: "other_provider", recordedAt: RECORDED } },
      });

      expect(facts?.whatsappTriage).toEqual({ answerId: "other_provider", recordedAt: RECORDED });
    });

    it.each([
      ["un API viejo que no la manda", {}],
      ["null", { whatsappTriage: null }],
      // Una respuesta que la pantalla de WhatsApp ya no ofrece no es una razón
      // que Inicio pueda repetir: la misma regla que usa esa pantalla.
      ["una respuesta que la pantalla no ofrece", { whatsappTriage: { answerId: "maybe", recordedAt: RECORDED } }],
      ["sin respuesta", { whatsappTriage: { answerId: " ", recordedAt: RECORDED } }],
      ["sin fecha", { whatsappTriage: { answerId: "not_at_hand" } }],
      ["un texto suelto", { whatsappTriage: "not_at_hand" }],
    ])("%s no es una respuesta: null", (_label, data) => {
      expect(readSetupStatusFacts({ success: true, data })?.whatsappTriage).toBeNull();
    });
  });

  describe("el enlace público del agente", () => {
    it("lo lee tal cual lo manda el servidor", () => {
      const facts = readSetupStatusFacts({
        success: true,
        data: { demoLink: { widgetId: "wgt_abc", path: "/w/wgt_abc", agentName: "Ana" } },
      });

      expect(facts?.demoLink).toEqual({
        widgetId: "wgt_abc", path: "/w/wgt_abc", agentName: "Ana", usageMode: "trial", answers: true, unavailableReason: null,
      });
    });

    it("sin nombre del agente sigue siendo un enlace: el nombre lo pone la pantalla", () => {
      const facts = readSetupStatusFacts({
        success: true,
        data: { demoLink: { widgetId: "wgt_abc", path: "/w/wgt_abc" } },
      });

      expect(facts?.demoLink).toEqual({
        widgetId: "wgt_abc", path: "/w/wgt_abc", agentName: "", usageMode: "trial", answers: true, unavailableReason: null,
      });
    });

    describe("si hoy responde", () => {
      const read = (extra: Record<string, unknown>) => readSetupStatusFacts({
        success: true,
        data: { demoLink: { widgetId: "wgt_abc", path: "/w/wgt_abc", agentName: "Ana", ...extra } },
      })?.demoLink ?? null;

      it.each([
        ["la prueba apagada", "switched_off", "switchedOff"],
        ["las respuestas gratis ya usadas", "allowance_used", "allowanceUsed"],
      ] as const)("dice la pausa con su motivo: %s", (_label, unavailableReason, pause) => {
        const link = read({ answers: false, unavailableReason });
        expect(link).toMatchObject({ answers: false, unavailableReason });
        expect(demoLinkPause(link)).toBe(pause);
      });

      it("una pausa sin motivo conocido se dice como pausa, nunca como que responde", () => {
        const link = read({ answers: false, unavailableReason: "otra_cosa" });
        expect(link).toMatchObject({ answers: false, unavailableReason: null });
        expect(demoLinkPause(link)).toBe("switchedOff");
      });

      it.each([
        ["un API viejo que no manda el campo", {}],
        ["un enlace que responde", { answers: true, unavailableReason: null }],
        // Un motivo sin `answers: false` no pausa nada: manda el booleano.
        ["un motivo suelto", { unavailableReason: "allowance_used" }],
        ["un valor que no es booleano", { answers: "false" }],
      ])("%s: responde", (_label, extra) => {
        const link = read(extra);
        expect(link).toMatchObject({ answers: true, unavailableReason: null });
        expect(demoLinkPause(link)).toBeNull();
      });

      it("sin enlace no hay pausa que decir", () => {
        expect(demoLinkPause(null)).toBeNull();
      });
    });

    it.each([
      ["un API viejo que no lo manda", {}],
      ["null", { demoLink: null }],
      ["sin path", { demoLink: { widgetId: "wgt_abc" } }],
      ["sin widgetId", { demoLink: { path: "/w/wgt_abc" } }],
      // `${origin}${path}` tiene que quedarse en este origen: una URL completa o
      // una protocolo-relativa mandaría a la persona a otro sitio.
      ["una URL completa", { demoLink: { widgetId: "wgt_abc", path: "https://evil.test/w/x" } }],
      ["una ruta protocolo-relativa", { demoLink: { widgetId: "wgt_abc", path: "//evil.test/w/x" } }],
    ])("%s no es un enlace: null", (_label, data) => {
      expect(readSetupStatusFacts({ success: true, data })?.demoLink).toBeNull();
    });
  });
});

describe("estado desconocido", () => {
  it("no es 'listo': ninguna superficie puede dibujarse con él", () => {
    expect(isOnboardingGuideKnown(UNKNOWN_ONBOARDING_GUIDE)).toBe(false);
    expect(UNKNOWN_ONBOARDING_GUIDE.redirect).toBeNull();
    expect(UNKNOWN_ONBOARDING_GUIDE.showResumeBanner).toBe(false);
  });
});
