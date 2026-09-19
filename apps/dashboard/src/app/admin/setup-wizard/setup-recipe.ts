export type SetupPurchaseMode = "appointment" | "class" | "table" | "order" | "quote" | "inform";

export interface SetupRecipeQuestion {
    question: string;
    answer: string;
    blanks: string[];
    complete: boolean;
}

export interface SetupRecipe {
    source: "registry" | "generated";
    mainInstructions: string;
    whenUnsure: string[];
    handoffReasons: string[];
    purchaseModes: SetupPurchaseMode[];
    questions: SetupRecipeQuestion[];
    testQuestions: string[];
    services: Array<{ name: string; durationMinutes: number; priceState: "example" | "quote" }>;
    businessHours: Record<string, string>;
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function localised(value: unknown, locale: string): string {
    const item = record(value);
    if (!item) return "";
    const language = locale.split("-")[0];
    const candidate = item[language] ?? item.es;
    return typeof candidate === "string" ? candidate.trim() : "";
}

function localisedList(value: unknown, locale: string): string[] {
    return Array.isArray(value) ? value.map((entry) => localised(entry, locale)).filter(Boolean) : [];
}

const PURCHASE_MODES = new Set<SetupPurchaseMode>(["appointment", "class", "table", "order", "quote", "inform"]);

export function readSetupRecipe(response: unknown, locale: string): SetupRecipe | null {
    const envelope = record(response);
    const data = record(envelope?.data ?? response);
    const recipe = record(data?.recipe);
    const setup = record(data?.setup);
    if (!data || !recipe || (data.source !== "registry" && data.source !== "generated")) return null;

    const questions = Array.isArray(recipe.canonicalQuestions) ? recipe.canonicalQuestions.flatMap((value) => {
        const item = record(value);
        if (!item) return [];
        const question = localised(item.question, locale);
        const answer = localised(item.answer, locale);
        if (!question || !answer) return [];
        const blanks = Array.from(answer.matchAll(/\[([^\]]+)\]/g), (match) => match[1]);
        return [{ question, answer, blanks, complete: blanks.length === 0 }];
    }) : [];

    const services = Array.isArray(setup?.services) ? setup.services.flatMap((value) => {
        const item = record(value);
        const name = typeof item?.name === "string" ? item.name.trim() : "";
        if (!name) return [];
        const duration = Number(item?.durationMinutes);
        return [{
            name,
            durationMinutes: Number.isFinite(duration) && duration >= 0 ? duration : 0,
            priceState: item?.priceState === "quote" ? "quote" as const : "example" as const,
        }];
    }) : [];

    return {
        source: data.source,
        mainInstructions: localised(recipe.mainInstructions, locale),
        whenUnsure: localisedList(recipe.whenUnsure, locale),
        handoffReasons: Array.isArray(recipe.handoffReasons)
            ? recipe.handoffReasons.map((value) => localised(record(value)?.text, locale)).filter(Boolean)
            : [],
        purchaseModes: Array.isArray(recipe.purchaseModes)
            ? recipe.purchaseModes.filter((value): value is SetupPurchaseMode => typeof value === "string" && PURCHASE_MODES.has(value as SetupPurchaseMode))
            : [],
        questions,
        testQuestions: localisedList(recipe.testQuestions, locale),
        services,
        businessHours: (record(setup?.businessHours) as Record<string, string> | null) ?? {},
    };
}
