/**
 * Where a membership plan's price stands, as the owner has to see it (D10).
 *
 * The API returns `price_status` on every plan row (`example` | `confirmed` |
 * `quote`) and the agent's `get_membership_plans` never states an amount that
 * is not `confirmed`. The screen used to print `Number(plan.price)` for every
 * row, so an owner looked at "150.000", believed the agent was quoting it, and
 * got an agent that kept saying "te lo confirman" with no explanation anywhere.
 *
 * `membership_plans.price` is NOT NULL. Outside the countries the recipe has
 * an example amount for, the seed writes `0` + `example`, and a plan created
 * as "se cotiza" stores `0` + `quote`. Neither 0 is a price: shown as "$0" it
 * reads as a free membership. These helpers mirror the API's own reading
 * (`decidablePriceAmount` in apps/api/src/modules/appointments/services.service.ts,
 * which `resolvePlanPriceStatus` applies to plans) so the screen and the server
 * agree on what "no price" means.
 *
 * FX1: a free plan is an EXPLICIT choice, "Es gratis" (`free: true`), exactly
 * like a free service. Before, a deliberate 0 was refused as `price_missing`
 * and there was no other way to say "this plan is free"; and a 0 typed under
 * "Precio confirmado" is still not a declaration.
 */

export type PlanPriceStatus = "example" | "confirmed" | "quote";

/** What the owner may send: `example` is provenance only the seed writes. */
export type OwnerPlanPriceStatus = Exclude<PlanPriceStatus, "example">;

/** What a card can press: confirm the example, declare the plan free, or quote it. */
export type PlanPriceChoice = OwnerPlanPriceStatus | "free";

/** The editor's price choice; `example` = no decision in this form yet. */
export type PlanPriceFormStatus = PlanPriceStatus | "free";

/** The body a card sends for a choice. "Es gratis" is explicit: `free: true`. */
export function planPriceChoicePayload(choice: PlanPriceChoice): { priceStatus: OwnerPlanPriceStatus; price?: number; free?: true } {
    if (choice === "free") return { priceStatus: "confirmed", price: 0, free: true };
    return { priceStatus: choice };
}

export interface MembershipPlan {
    id: string;
    name: string;
    description?: string;
    duration_days: number;
    price: number | string | null;
    /** Absent on an API older than D10: those rows were all typed by a person. */
    price_status?: PlanPriceStatus | null;
    currency: string | null;
    class_credits_per_period?: number;
    personal_training_credits: number;
    guest_passes: number;
    freeze_allowance_days: number;
    perks: string[];
    is_active: boolean;
}

/** Same rule as the API's `servicePriceStatus`: anything unknown is a person's price. */
export function readPlanPriceStatus(raw: unknown): PlanPriceStatus {
    return raw === "example" || raw === "quote" ? raw : "confirmed";
}

function readAmount(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const amount = Number(raw);
    return Number.isFinite(amount) ? amount : null;
}

export interface PlanPriceView {
    status: PlanPriceStatus;
    /** The number that exists, or `null` when there is none (a placeholder 0 included). */
    amount: number | null;
}

/** A 0 under `example` or `quote` is "no price yet"; only a confirmed 0 is free. */
export function planPriceView(plan: Pick<MembershipPlan, "price" | "price_status">): PlanPriceView {
    const status = readPlanPriceStatus(plan.price_status);
    const amount = readAmount(plan.price);
    return { status, amount: status !== "confirmed" && amount === 0 ? null : amount };
}

/**
 * What the card shows in the price slot.
 *
 * - `quote`     — "Se cotiza según el caso", never a number.
 * - `missing`   — "Sin precio": there is no amount the owner could confirm.
 * - `example`   — the recipe's amount, labelled as an example.
 * - `free`      — a confirmed 0: the owner said it is free.
 * - `confirmed` — the owner's amount.
 */
export type PlanPriceDisplay =
    | { kind: "quote" }
    | { kind: "missing" }
    | { kind: "free" }
    | { kind: "example"; amount: number }
    | { kind: "confirmed"; amount: number };

export function planPriceDisplay(plan: Pick<MembershipPlan, "price" | "price_status">): PlanPriceDisplay {
    const { status, amount } = planPriceView(plan);
    if (status === "quote") return { kind: "quote" };
    if (amount === null) return { kind: "missing" };
    if (status === "example") return { kind: "example", amount };
    return amount === 0 ? { kind: "free" } : { kind: "confirmed", amount };
}

/** The API's refusals about a plan price, mapped to the copy under `memberships.planPrice.errors`. */
export type PlanPriceErrorKey = "priceMissing" | "priceRequired" | "priceInvalid";

export function planPriceErrorKey(errorCode: string | null | undefined): PlanPriceErrorKey | null {
    if (errorCode === "price_missing") return "priceMissing";
    if (errorCode === "price_required") return "priceRequired";
    if (errorCode === "price_invalid") return "priceInvalid";
    return null;
}

/** The editor's price fields. `price` is the raw text of the input. */
export interface PlanPriceForm {
    price: string;
    /** The owner's explicit choice (`free` included), or `example` while they have not made one. */
    priceStatus: PlanPriceFormStatus;
}

/**
 * The editor's starting point: a placeholder 0 opens as an empty field, never
 * as "0", and a confirmed 0 opens as "Es gratis".
 */
export function initialPlanPriceForm(plan: Pick<MembershipPlan, "price" | "price_status"> | null): PlanPriceForm {
    if (!plan) return { price: "", priceStatus: "confirmed" };
    const { status, amount } = planPriceView(plan);
    if (status === "confirmed" && amount === 0) return { price: "", priceStatus: "free" };
    return { price: amount === null ? "" : String(amount), priceStatus: status };
}

/**
 * The status the form is actually asking for.
 *
 * Typing a different amount over an example is the owner's decision about it,
 * which is also how the API reads a changed price. Typing it back to what it
 * was is not a decision any more, so the example comes back — unless the owner
 * pressed "Precio confirmado", which is kept whatever the number does.
 */
export function effectivePlanPriceStatus(form: PlanPriceForm, initial: PlanPriceForm): PlanPriceFormStatus {
    if (form.priceStatus === "example" && form.price.trim() !== initial.price.trim()) return "confirmed";
    return form.priceStatus;
}

function parsedAmount(text: string): number | null {
    if (!text.trim()) return null;
    const amount = Number(text);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/**
 * Whether the price half of the form can be saved, and why not.
 *
 * A confirmed price needs a real number above 0: a 0 is "Es gratis", said as
 * such. "Se cotiza" and "Es gratis" need none. An untouched example needs none
 * either: saving the rest of the plan (its name, its credits) must not force
 * the owner to decide the price.
 */
export function planPriceFormProblem(form: PlanPriceForm, initial: PlanPriceForm): "amountRequired" | "amountInvalid" | null {
    const status = effectivePlanPriceStatus(form, initial);
    if (status === "quote" || status === "free") return null;
    if (!form.price.trim()) return status === "confirmed" ? "amountRequired" : null;
    const amount = parsedAmount(form.price);
    if (amount === null) return "amountInvalid";
    return status === "confirmed" && amount === 0 ? "amountRequired" : null;
}

/**
 * The price fields of the create/update body.
 *
 * - `quote` sends only the status: the API stores the placeholder 0 on create
 *   and keeps whatever number the row had on update (never shown again).
 * - `confirmed` sends the status with the amount, so "Precio confirmado" on an
 *   example confirms it even when the number was left as it was.
 * - `free` sends the 0 with `free: true`: the only way a 0 becomes a price.
 * - an untouched `example` sends nothing: "Usar así" never confirms a price.
 */
export function planPricePayload(form: PlanPriceForm, initial: PlanPriceForm): { price?: number; priceStatus?: OwnerPlanPriceStatus; free?: true } {
    const status = effectivePlanPriceStatus(form, initial);
    if (status === "free") return { price: 0, priceStatus: "confirmed", free: true };
    if (status === "quote") return { priceStatus: "quote" };
    if (status === "example") return {};
    const amount = parsedAmount(form.price);
    return amount === null ? { priceStatus: "confirmed" } : { price: amount, priceStatus: "confirmed" };
}
