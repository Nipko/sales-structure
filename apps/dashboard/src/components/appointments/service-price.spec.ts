import {
    initialServicePriceForm,
    readServiceAmount,
    servicePriceAmount,
    servicePriceChoicePayload,
    servicePriceDisplay,
    servicePriceFormPayload,
    servicePriceFormProblem,
} from "./service-price";

/**
 * How the services screens read a price (D10 + FX1), pinned to the API's rule.
 *
 * Before FX1 the catalogue read every price with `parseFloat(s.price || 0)`: a
 * service seeded WITHOUT an amount (D17, outside the six example countries)
 * looked like one that costs 0, offered "Confirmar precio", and the confirmed
 * row reached the customer as a free service. The editor sent an empty field
 * as `price: 0`, so "Precio confirmado" on a quoted service made it free too.
 */

describe("reading a service price", () => {
    it("keeps a missing amount missing", () => {
        expect(readServiceAmount(null)).toBeNull();
        expect(readServiceAmount("")).toBeNull();
        expect(readServiceAmount(undefined)).toBeNull();
        expect(readServiceAmount("0")).toBe(0);
        expect(readServiceAmount("45000.00")).toBe(45000);
    });

    it("reads NULL and a placeholder 0 as no amount, and only a confirmed 0 as free", () => {
        expect(servicePriceAmount({ price: null, priceStatus: "example" })).toBeNull();
        expect(servicePriceAmount({ price: 0, priceStatus: "example" })).toBeNull();
        expect(servicePriceAmount({ price: 0, priceStatus: "quote" })).toBeNull();
        expect(servicePriceAmount({ price: 0, priceStatus: "confirmed" })).toBe(0);
        expect(servicePriceAmount({ price: null, priceStatus: "confirmed" })).toBeNull();
    });

    it("shows what the agent will do with it", () => {
        expect(servicePriceDisplay({ price: null, priceStatus: "example" })).toEqual({ kind: "missing" });
        // The recipe's 0 (the trial class, but also "Mensualidad de clases
        // grupales") is not a price either: nothing to confirm.
        expect(servicePriceDisplay({ price: 0, priceStatus: "example" })).toEqual({ kind: "missing" });
        expect(servicePriceDisplay({ price: null, priceStatus: "confirmed" })).toEqual({ kind: "missing" });
        expect(servicePriceDisplay({ price: 0, priceStatus: "confirmed" })).toEqual({ kind: "free" });
        expect(servicePriceDisplay({ price: 777777, priceStatus: "quote" })).toEqual({ kind: "quote" });
        expect(servicePriceDisplay({ price: 45000, priceStatus: "example" })).toEqual({ kind: "example", amount: 45000 });
        expect(servicePriceDisplay({ price: 45000, priceStatus: undefined })).toEqual({ kind: "confirmed", amount: 45000 });
    });

    it('"Es gratis" is sent as such, never as a bare 0', () => {
        expect(servicePriceChoicePayload("free")).toEqual({ priceStatus: "confirmed", price: 0, free: true });
        expect(servicePriceChoicePayload("confirmed")).toEqual({ priceStatus: "confirmed" });
        expect(servicePriceChoicePayload("quote")).toEqual({ priceStatus: "quote" });
    });
});

describe("the service editor's price", () => {
    it("opens a placeholder as an empty, undecided field and a free service as free", () => {
        expect(initialServicePriceForm({ price: null, priceStatus: "example" })).toEqual({ price: null, priceStatus: "example" });
        expect(initialServicePriceForm({ price: 0, priceStatus: "example" })).toEqual({ price: null, priceStatus: "example" });
        expect(initialServicePriceForm({ price: 0, priceStatus: "quote" })).toEqual({ price: null, priceStatus: "quote" });
        expect(initialServicePriceForm({ price: 0, priceStatus: "confirmed" })).toEqual({ price: null, priceStatus: "free" });
        expect(initialServicePriceForm({ price: null, priceStatus: "confirmed" })).toEqual({ price: null, priceStatus: "example" });
        expect(initialServicePriceForm({ price: 45000, priceStatus: "confirmed" })).toEqual({ price: 45000, priceStatus: "confirmed" });
        expect(initialServicePriceForm(null)).toEqual({ price: null, priceStatus: "confirmed" });
    });

    it('"Precio confirmado" needs an amount above 0; "Es gratis" and "Se cotiza" need none', () => {
        expect(servicePriceFormProblem({ price: null, priceStatus: "confirmed" })).toBe("amountRequired");
        expect(servicePriceFormProblem({ price: 0, priceStatus: "confirmed" })).toBe("amountRequired");
        expect(servicePriceFormProblem({ price: 90000, priceStatus: "confirmed" })).toBeNull();
        expect(servicePriceFormProblem({ price: null, priceStatus: "free" })).toBeNull();
        expect(servicePriceFormProblem({ price: null, priceStatus: "quote" })).toBeNull();
        expect(servicePriceFormProblem({ price: null, priceStatus: "example" })).toBeNull();
    });

    it("sends the owner's decision and nothing that was not one", () => {
        expect(servicePriceFormPayload({ price: null, priceStatus: "free" }, null)).toEqual({ price: 0, priceStatus: "confirmed", free: true });
        expect(servicePriceFormPayload({ price: 45000, priceStatus: "quote" }, 45000)).toEqual({ priceStatus: "quote" });
        expect(servicePriceFormPayload({ price: 90000, priceStatus: "confirmed" }, null)).toEqual({ price: 90000, priceStatus: "confirmed" });
        // An untouched example sends nothing about the price: renaming a
        // service is not a decision about what it costs.
        expect(servicePriceFormPayload({ price: null, priceStatus: "example" }, null)).toEqual({});
        expect(servicePriceFormPayload({ price: 45000, priceStatus: "example" }, 45000)).toEqual({});
        // Typing another amount over an example is the owner's number.
        expect(servicePriceFormPayload({ price: 50000, priceStatus: "example" }, 45000)).toEqual({ price: 50000 });
    });
});
