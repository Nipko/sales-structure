jest.mock("@/lib/api", () => ({ api: {} }));
jest.mock("@/components/payments/payment-policy-fields", () => ({ readPaymentPolicy: () => ({}) }));

import es from "../../messages/es.json";
import en from "../../messages/en.json";
import pt from "../../messages/pt.json";
import fr from "../../messages/fr.json";
import { servicePriceStatusErrorMessage } from "./useServiceCatalog";

/**
 * "Confirmar precio" on a service with no amount is refused with
 * `price_missing` and a message the server writes in Spanish. The card showed
 * that text as-is, so a panel in English, Portuguese or French read Spanish.
 * The code is translated, like the membership plans' `planPriceErrorKey`.
 */
describe("the refusal of a service price change", () => {
    const messages = { priceMissing: "translated: no price yet", updateError: "generic update error" };

    it("translates price_missing instead of showing the server's Spanish text", () => {
        expect(servicePriceStatusErrorMessage(
            { errorCode: "price_missing", error: "Este servicio todavía no tiene precio." },
            messages,
        )).toBe("translated: no price yet");
    });

    it("keeps any other refusal's text, and the generic line when there is none", () => {
        expect(servicePriceStatusErrorMessage({ errorCode: "price_not_confirmed", error: "server text" }, messages))
            .toBe("server text");
        expect(servicePriceStatusErrorMessage({ errorCode: "validation_failed" }, messages)).toBe("generic update error");
        expect(servicePriceStatusErrorMessage(null, messages)).toBe("generic update error");
    });

    it("has the copy in all four languages, each naming the quote option of its own screen", () => {
        for (const locale of [es, en, pt, fr] as any[]) {
            const text = locale.appointments.errors.servicePriceMissing;
            expect(typeof text).toBe("string");
            expect(text).toContain(locale.appointments.priceStatus.quoteAction);
        }
    });
});
