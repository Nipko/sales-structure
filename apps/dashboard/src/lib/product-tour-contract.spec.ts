import {
  PRODUCT_TOUR_TARGETS,
  canRunProductTourAtWidth,
  getProductTourSelector,
} from "./product-tour-contract";

describe("product tour navigation contract", () => {
  it("anchors the agent step to the AI agent destination, not Automation", () => {
    expect(getProductTourSelector(PRODUCT_TOUR_TARGETS.agent)).toBe("#tour-aiAgent");
    expect(getProductTourSelector(PRODUCT_TOUR_TARGETS.agent)).not.toBe("#tour-automation");
  });

  it("uses the same stable label keys as the canonical sidebar", () => {
    expect(Object.values(PRODUCT_TOUR_TARGETS)).toEqual([
      "aiAgent",
      "channels",
      "conversations",
      "analytics",
    ]);
  });

  it("defers the anchored tour on viewports without a persistent sidebar", () => {
    expect(canRunProductTourAtWidth(320)).toBe(false);
    expect(canRunProductTourAtWidth(767)).toBe(false);
    expect(canRunProductTourAtWidth(768)).toBe(true);
    expect(canRunProductTourAtWidth(1440)).toBe(true);
  });
});
