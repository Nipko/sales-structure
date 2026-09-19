import {
  isOwnerChangeRequest,
  parseQualityAssistantDetail,
  qualityAssistantTarget,
} from "./quality-assistant-contract";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const SIGNAL_ID = "22222222-2222-4222-8222-222222222222";

describe("quality assistant event boundary", () => {
  it("accepts a bounded quality target and safe internal href", () => {
    const detail = parseQualityAssistantDetail({
      agentId: AGENT_ID,
      signalId: SIGNAL_ID,
      agentName: "Ventas",
      code: "refresh_eval",
      severity: "high",
      href: `/admin/agent/quality?agent=${AGENT_ID}`,
    });
    expect(detail).not.toBeNull();
    expect(qualityAssistantTarget(detail!)).toEqual({
      kind: "agent_quality",
      agentId: AGENT_ID,
      signalId: SIGNAL_ID,
    });
  });

  it.each([
    null,
    {},
    { agentId: "not-a-uuid" },
    { agentId: AGENT_ID, signalId: "not-a-uuid" },
  ])("rejects invalid event detail %#", (value) => {
    expect(parseQualityAssistantDetail(value)).toBeNull();
  });

  it("drops external and traversal hrefs instead of forwarding them", () => {
    expect(parseQualityAssistantDetail({ agentId: AGENT_ID, href: "https://evil.test" })?.href).toBeUndefined();
    expect(parseQualityAssistantDetail({ agentId: AGENT_ID, href: "/administrator" })?.href).toBeUndefined();
    expect(parseQualityAssistantDetail({ agentId: AGENT_ID, href: "/admin/../secrets" })?.href).toBeUndefined();
  });

  it("tells the owner's own change request apart from a quality signal", () => {
    // "Dime qué cambiar" sends her words; nothing about it is a health signal.
    const request = parseQualityAssistantDetail({ agentId: AGENT_ID, prompt: "que salude más corto", send: true });
    expect(isOwnerChangeRequest(request!)).toBe(true);
    // A quality surface suggests a prompt but never sends it for her.
    const signal = parseQualityAssistantDetail({ agentId: AGENT_ID, signalId: SIGNAL_ID, severity: "high", prompt: "¿Qué falla?" });
    expect(isOwnerChangeRequest(signal!)).toBe(false);
    // Only a strict `true` counts, the same rule that decides whether it is sent.
    expect(isOwnerChangeRequest(parseQualityAssistantDetail({ agentId: AGENT_ID, prompt: "x", send: "true" })!)).toBe(false);
  });
});
