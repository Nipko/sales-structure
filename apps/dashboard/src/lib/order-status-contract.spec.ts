import { allowedOrderTransitions } from "./order-status-contract";

describe("order status navigation contract", () => {
  it("offers only valid forward transitions", () => {
    expect(allowedOrderTransitions("pending", true)).toEqual(["confirmed", "cancelled"]);
    expect(allowedOrderTransitions("confirmed", true)).toEqual(["paid", "cancelled"]);
  });

  it("does not offer cancellation to operational agents", () => {
    expect(allowedOrderTransitions("pending", false)).toEqual(["confirmed"]);
    expect(allowedOrderTransitions("confirmed", false)).toEqual(["paid"]);
  });

  it("keeps terminal states read-only", () => {
    expect(allowedOrderTransitions("paid", true)).toEqual([]);
    expect(allowedOrderTransitions("cancelled", true)).toEqual([]);
  });
});
