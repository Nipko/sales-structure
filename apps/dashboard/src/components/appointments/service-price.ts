import type { PriceStatus } from "./shared";

/**
 * Where a service's price stands, as the owner has to see it (D10 + FX1).
 *
 * It mirrors the API's reading (`decidablePriceAmount` in
 * apps/api/src/modules/appointments/services.service.ts) and the membership
 * plans' (`plan-price.ts`): a NULL price is no amount — D17 seeds services that
 * way outside the six countries with an example — and so is a 0 under
 * `example` or `quote`. The recipe writes 0 both for things that are free (a
 * trial class) and for things that are not ("Mensualidad de clases grupales"),
 * and a quoted service keeps a 0 that means "no number". Only a 0 the owner
 * confirmed is free, and the owner says it with "Es gratis" — never by leaving
 * the field empty, which the editor used to send as 0.
 */

/** What a card can press: confirm the example as it is, declare it free, or quote it. */
export type ServicePriceChoice = "confirmed" | "quote" | "free";

/**
 * The editor's price choice. `example` means "no decision in this form yet":
 * saving keeps whatever mark the row has.
 */
export type ServicePriceFormStatus = PriceStatus | "free";

/** Same rule as the API's `servicePriceStatus`: anything unknown is a person's price. */
export function readServicePriceStatus(raw: unknown): PriceStatus {
    return raw === "example" || raw === "quote" ? raw : "confirmed";
}

/** NULL, "" or a non-number is no amount — never 0. */
export function readServiceAmount(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const amount = Number(raw);
    return Number.isFinite(amount) ? amount : null;
}

/** The number that exists, or `null` when there is none (a placeholder 0 included). */
export function servicePriceAmount(svc: { price?: unknown; priceStatus?: unknown }): number | null {
    const status = readServicePriceStatus(svc.priceStatus);
    const amount = readServiceAmount(svc.price);
    return status !== "confirmed" && amount === 0 ? null : amount;
}

/**
 * What the card shows in the price slot.
 *
 * - `quote`     — "Se cotiza según el caso", never a number.
 * - `missing`   — "Sin precio": nothing to confirm. The way out is an amount,
 *                 "Es gratis" or "Se cotiza"; "Confirmar precio" would be refused.
 * - `free`      — the owner said it is free.
 * - `example`   — the recipe's amount, labelled as an example.
 * - `confirmed` — the owner's amount.
 */
export type ServicePriceDisplay =
    | { kind: "quote" }
    | { kind: "missing" }
    | { kind: "free" }
    | { kind: "example"; amount: number }
    | { kind: "confirmed"; amount: number };

export function servicePriceDisplay(svc: { price?: unknown; priceStatus?: unknown }): ServicePriceDisplay {
    const status = readServicePriceStatus(svc.priceStatus);
    if (status === "quote") return { kind: "quote" };
    const amount = servicePriceAmount(svc);
    if (amount === null) return { kind: "missing" };
    if (status === "example") return { kind: "example", amount };
    return amount === 0 ? { kind: "free" } : { kind: "confirmed", amount };
}

/** The body a card sends for a choice. "Es gratis" is explicit: `free: true`. */
export function servicePriceChoicePayload(choice: ServicePriceChoice): { priceStatus: "confirmed" | "quote"; price?: number; free?: true } {
    if (choice === "free") return { priceStatus: "confirmed", price: 0, free: true };
    return { priceStatus: choice };
}

export interface ServicePriceForm {
    price: number | null;
    priceStatus: ServicePriceFormStatus;
}

/** The editor's starting point: a placeholder opens as an empty field, never as a 0 to confirm. */
export function initialServicePriceForm(svc: { price?: unknown; priceStatus?: unknown } | null): ServicePriceForm {
    if (!svc) return { price: null, priceStatus: "confirmed" };
    const status = readServicePriceStatus(svc.priceStatus);
    const amount = servicePriceAmount(svc);
    if (status !== "confirmed") return { price: amount, priceStatus: status };
    if (amount === 0) return { price: null, priceStatus: "free" };
    // Confirmed with no amount (a service created without a price): nothing
    // was decided, and nothing is until the owner presses a choice.
    if (amount === null) return { price: null, priceStatus: "example" };
    return { price: amount, priceStatus: "confirmed" };
}

/**
 * Whether the price half of the editor can be saved. "Precio confirmado" needs
 * an amount above 0: a 0 is "Es gratis", said as such.
 */
export function servicePriceFormProblem(form: ServicePriceForm): "amountRequired" | null {
    if (form.priceStatus !== "confirmed") return null;
    return form.price !== null && form.price > 0 ? null : "amountRequired";
}

/**
 * The price fields of the create/update body.
 *
 * - `free` sends the 0 with `free: true`: the only way a 0 becomes a price.
 * - `quote` sends only the status; the row keeps its number, never shown.
 * - `confirmed` sends the status with the amount.
 * - an undecided form (`example`) sends the amount only if the owner changed
 *   it; the same amount (or the empty placeholder) coming back is no decision.
 */
export function servicePriceFormPayload(
    form: ServicePriceForm,
    initialAmount: number | null,
): { price?: number | null; priceStatus?: "confirmed" | "quote"; free?: true } {
    if (form.priceStatus === "free") return { price: 0, priceStatus: "confirmed", free: true };
    if (form.priceStatus === "quote") return { priceStatus: "quote" };
    if (form.priceStatus === "confirmed") return { price: form.price, priceStatus: "confirmed" };
    return form.price === initialAmount ? {} : { price: form.price };
}
