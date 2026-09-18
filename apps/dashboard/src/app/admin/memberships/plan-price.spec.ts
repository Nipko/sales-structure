import {
    effectivePlanPriceStatus,
    initialPlanPriceForm,
    planPriceDisplay,
    planPriceErrorKey,
    planPriceFormProblem,
    planPriceChoicePayload,
    planPricePayload,
    planPriceView,
    readPlanPriceStatus,
} from "./plan-price";

/**
 * How the memberships screen reads a plan price (D10).
 *
 * The API returns `price_status` on every plan row and the agent never states
 * an amount that is not confirmed. `membership_plans.price` is NOT NULL, so a
 * plan with no amount — the seed outside the six countries with an example
 * price, or a plan created as "se cotiza" — stores a 0 that is not a price.
 * These pin the screen to the API's reading: that 0 is "Sin precio", never
 * "$0" or "gratis", and nothing the owner did not decide becomes a confirmation.
 */

describe("reading a plan price", () => {
    it("treats a row without a status as a person's price, like the API does", () => {
        expect(readPlanPriceStatus(undefined)).toBe("confirmed");
        expect(readPlanPriceStatus(null)).toBe("confirmed");
        expect(readPlanPriceStatus("bogus")).toBe("confirmed");
        expect(readPlanPriceStatus("example")).toBe("example");
        expect(readPlanPriceStatus("quote")).toBe("quote");
    });

    it("reads a 0 under example or quote as no price, and a confirmed 0 as free", () => {
        expect(planPriceView({ price: "0.00", price_status: "example" })).toEqual({ status: "example", amount: null });
        expect(planPriceView({ price: 0, price_status: "quote" })).toEqual({ status: "quote", amount: null });
        expect(planPriceView({ price: "0.00", price_status: "confirmed" })).toEqual({ status: "confirmed", amount: 0 });
        expect(planPriceView({ price: "150000.00", price_status: "example" })).toEqual({ status: "example", amount: 150000 });
    });

    it("never shows a quoted plan's number, and shows a placeholder as missing", () => {
        expect(planPriceDisplay({ price: 777777, price_status: "quote" })).toEqual({ kind: "quote" });
        expect(planPriceDisplay({ price: "0.00", price_status: "example" })).toEqual({ kind: "missing" });
        expect(planPriceDisplay({ price: null, price_status: "example" })).toEqual({ kind: "missing" });
        expect(planPriceDisplay({ price: "150000.00", price_status: "example" })).toEqual({ kind: "example", amount: 150000 });
        expect(planPriceDisplay({ price: "120000", price_status: undefined })).toEqual({ kind: "confirmed", amount: 120000 });
        // A confirmed 0 is a plan the owner declared free: it reads as such.
        expect(planPriceDisplay({ price: 0, price_status: "confirmed" })).toEqual({ kind: "free" });
    });

    it("maps the API's price refusals to their copy and leaves anything else to the server text", () => {
        expect(planPriceErrorKey("price_missing")).toBe("priceMissing");
        expect(planPriceErrorKey("price_required")).toBe("priceRequired");
        expect(planPriceErrorKey("price_invalid")).toBe("priceInvalid");
        expect(planPriceErrorKey("validation_failed")).toBeNull();
        expect(planPriceErrorKey(undefined)).toBeNull();
    });
});

describe('"Es gratis" is an explicit choice (FX1)', () => {
    // Before FX1 the plan editor refused a deliberate 0 (`price_missing`) and
    // offered no other way to say "free", while the service editor confirmed
    // a quoted row's 0 as free. Both screens now say it the same way.
    it("a card sends free as such, never as a bare 0", () => {
        expect(planPriceChoicePayload("free")).toEqual({ priceStatus: "confirmed", price: 0, free: true });
        expect(planPriceChoicePayload("confirmed")).toEqual({ priceStatus: "confirmed" });
        expect(planPriceChoicePayload("quote")).toEqual({ priceStatus: "quote" });
    });

    it("the editor opens a free plan as free, and sends it with free: true", () => {
        const initial = initialPlanPriceForm({ price: "0.00", price_status: "confirmed" });
        expect(initial).toEqual({ price: "", priceStatus: "free" });
        expect(planPriceFormProblem(initial, initial)).toBeNull();
        expect(planPricePayload(initial, initial)).toEqual({ price: 0, priceStatus: "confirmed", free: true });

        const placeholder = initialPlanPriceForm({ price: "0.00", price_status: "example" });
        expect(planPricePayload({ ...placeholder, priceStatus: "free" }, placeholder)).toEqual({ price: 0, priceStatus: "confirmed", free: true });
    });

    it('"Precio confirmado" needs an amount above 0: a typed 0 is not "free"', () => {
        const placeholder = initialPlanPriceForm({ price: "0.00", price_status: "example" });
        const pressed = { ...placeholder, priceStatus: "confirmed" as const };
        expect(planPriceFormProblem({ ...pressed, price: "0" }, placeholder)).toBe("amountRequired");
        // Typing 0 over an example is a change, and still not a declaration.
        const example = initialPlanPriceForm({ price: "150000.00", price_status: "example" });
        expect(planPriceFormProblem({ ...example, price: "0" }, example)).toBe("amountRequired");
    });
});

describe("the plan editor's price", () => {
    const EXAMPLE = { price: "150000.00", price_status: "example" as const };
    const PLACEHOLDER = { price: "0.00", price_status: "example" as const };

    it("opens a placeholder as an empty field, never as a 0 to confirm", () => {
        expect(initialPlanPriceForm(PLACEHOLDER)).toEqual({ price: "", priceStatus: "example" });
        expect(initialPlanPriceForm(EXAMPLE)).toEqual({ price: "150000", priceStatus: "example" });
        expect(initialPlanPriceForm(null)).toEqual({ price: "", priceStatus: "confirmed" });
    });

    it("an untouched example sends nothing about the price: saving credits is not a confirmation", () => {
        const initial = initialPlanPriceForm(EXAMPLE);
        expect(effectivePlanPriceStatus(initial, initial)).toBe("example");
        expect(planPriceFormProblem(initial, initial)).toBeNull();
        expect(planPricePayload(initial, initial)).toEqual({});

        const placeholder = initialPlanPriceForm(PLACEHOLDER);
        expect(planPriceFormProblem(placeholder, placeholder)).toBeNull();
        expect(planPricePayload(placeholder, placeholder)).toEqual({});
    });

    it("typing another amount confirms it; typing it back is not a decision any more", () => {
        const initial = initialPlanPriceForm(EXAMPLE);
        const typed = { ...initial, price: "165000" };
        expect(effectivePlanPriceStatus(typed, initial)).toBe("confirmed");
        expect(planPricePayload(typed, initial)).toEqual({ price: 165000, priceStatus: "confirmed" });

        const reverted = { ...typed, price: "150000" };
        expect(effectivePlanPriceStatus(reverted, initial)).toBe("example");
        expect(planPricePayload(reverted, initial)).toEqual({});
    });

    it('"Precio confirmado" confirms the example as it is and stays pressed whatever the number does', () => {
        const initial = initialPlanPriceForm(EXAMPLE);
        const pressed = { ...initial, priceStatus: "confirmed" as const };
        expect(planPricePayload(pressed, initial)).toEqual({ price: 150000, priceStatus: "confirmed" });
        expect(effectivePlanPriceStatus({ ...pressed, price: "150000" }, initial)).toBe("confirmed");
    });

    it("a confirmed price needs a real, non-negative amount", () => {
        const placeholder = initialPlanPriceForm(PLACEHOLDER);
        const pressed = { ...placeholder, priceStatus: "confirmed" as const };
        expect(planPriceFormProblem(pressed, placeholder)).toBe("amountRequired");
        expect(planPriceFormProblem({ ...pressed, price: "-5" }, placeholder)).toBe("amountInvalid");
        expect(planPriceFormProblem({ ...pressed, price: "90000" }, placeholder)).toBeNull();

        const fresh = initialPlanPriceForm(null);
        expect(planPriceFormProblem(fresh, fresh)).toBe("amountRequired");
        expect(planPricePayload({ ...fresh, price: "80000" }, fresh)).toEqual({ price: 80000, priceStatus: "confirmed" });
    });

    it('"Se cotiza" needs no amount and never sends one', () => {
        const fresh = initialPlanPriceForm(null);
        const quoted = { price: "", priceStatus: "quote" as const };
        expect(planPriceFormProblem(quoted, fresh)).toBeNull();
        expect(planPricePayload(quoted, fresh)).toEqual({ priceStatus: "quote" });

        const initial = initialPlanPriceForm(EXAMPLE);
        expect(planPricePayload({ ...initial, priceStatus: "quote" }, initial)).toEqual({ priceStatus: "quote" });
    });
});
