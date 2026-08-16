import { resolveWompiPaymentKinds } from "./wompi-payment-methods";

describe("Wompi runtime payment methods", () => {
    it("keeps an empty runtime list empty instead of falling back to card", () => {
        expect(resolveWompiPaymentKinds([])).toEqual([]);
    });

    it("maps only known flags, including recurring Bancolombia", () => {
        expect(resolveWompiPaymentKinds([
            "card",
            "nequi",
            "bancolombiaTransfer",
            "unknownFutureMethod",
        ])).toEqual(["card", "nequi", "bancolombia_transfer"]);
    });
});
