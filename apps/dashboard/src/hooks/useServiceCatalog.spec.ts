jest.mock("@/lib/api", () => ({ api: {} }));
jest.mock("@/components/payments/payment-policy-fields", () => ({ readPaymentPolicy: () => ({}) }));

import es from "../../messages/es.json";
import en from "../../messages/en.json";
import pt from "../../messages/pt.json";
import fr from "../../messages/fr.json";
import { serviceDetailsPayload, serviceListFromText, servicePriceStatusErrorMessage } from "./useServiceCatalog";

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

/**
 * ADR 0031, fricción 10: la ficha del servicio (descripción, incluye, no
 * incluye, preparación) viaja con el formulario. Las listas se escriben una
 * por línea y «no requiere preparación» es una declaración explícita.
 */
describe("the service details the editor sends", () => {
    const form = { description: "  Limpieza profunda  ", includesText: "Valoración\n\n Limpieza \nValoración", excludesText: "", preparation: " Ayuno ", noPreparation: false };

    it("splits the lists one item per line and trims the texts", () => {
        expect(serviceListFromText("a\r\n b \n\na")).toEqual(["a", "b"]);
        expect(serviceDetailsPayload(form)).toEqual({
            description: "Limpieza profunda", includes: ["Valoración", "Limpieza"], excludes: [],
            preparation: "Ayuno", preparationRequired: null,
        });
    });

    it("«no requiere preparación» sends false and drops the written instructions", () => {
        expect(serviceDetailsPayload({ ...form, noPreparation: true })).toMatchObject({ preparation: null, preparationRequired: false });
    });

    it("empty fields stay undeclared instead of becoming a value", () => {
        expect(serviceDetailsPayload({ description: " ", includesText: "", excludesText: "", preparation: "", noPreparation: false }))
            .toEqual({ description: null, includes: [], excludes: [], preparation: null, preparationRequired: null });
    });

    it("has the field labels in all four languages", () => {
        for (const locale of [es, en, pt, fr] as any[]) {
            for (const key of ["serviceDescription", "serviceIncludes", "serviceExcludes", "servicePreparation", "serviceNoPreparation", "serviceListHint"]) {
                expect(typeof locale.appointments[key]).toBe("string");
            }
        }
    });
});
