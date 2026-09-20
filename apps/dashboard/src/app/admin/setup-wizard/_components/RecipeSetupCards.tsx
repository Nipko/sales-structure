"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, Clock3, HelpCircle, Loader2, MapPin, ShoppingBag } from "lucide-react";
import type { SetupRecipe } from "../setup-recipe";

export default function RecipeSetupCards({ recipe, agentId, applied, applying, onApply }: {
    recipe: SetupRecipe;
    agentId: string | null;
    applied: boolean;
    applying: boolean;
    onApply: () => void;
}) {
    const t = useTranslations("setupWizard.recipeCards");
    const completeQuestions = recipe.questions.filter((question) => question.complete).length;
    const purchaseTool = recipe.purchaseModes.includes("table")
        ? "restaurants"
        : recipe.purchaseModes.includes("appointment") ? "appointments" : null;
    const purchaseHref = agentId
        ? `/admin/agent/${encodeURIComponent(agentId)}?tab=tools${purchaseTool ? `&tool=${purchaseTool}` : ""}`
        : "/admin/agent";
    const cards = [
        {
            key: "offers", Icon: ShoppingBag,
            title: t("offers.title"), why: t("offers.why"),
            body: recipe.services.length
                ? recipe.services.slice(0, 4).map((service) => `${service.name}${service.durationMinutes ? ` · ${service.durationMinutes} min` : ""}`).join(" · ")
                : t("offers.empty"),
            note: recipe.services.some((service) => service.priceState === "example") ? t("offers.examplePrices") : t("offers.quotePrices"),
            href: "/admin/appointments?tab=services", action: t("offers.change"),
        },
        {
            key: "place", Icon: MapPin,
            title: t("place.title"), why: t("place.why"),
            body: Object.keys(recipe.businessHours).length ? t("place.prepared") : t("place.pending"),
            note: t("place.note"), href: "/admin/settings/business-hours", action: t("place.change"),
        },
        {
            key: "purchase", Icon: Clock3,
            title: t("purchase.title"), why: t("purchase.why"),
            body: recipe.purchaseModes.length
                ? recipe.purchaseModes.map((mode) => t(`purchase.mode.${mode}`)).join(" · ")
                : t("purchase.empty"),
            note: t("purchase.note"),
            href: purchaseHref,
            action: t("purchase.change"),
        },
        {
            key: "questions", Icon: HelpCircle,
            title: t("questions.title"), why: t("questions.why"),
            body: t("questions.progress", { ready: completeQuestions, total: recipe.questions.length }),
            note: recipe.questions.some((question) => !question.complete)
                ? t("questions.pending", { count: recipe.questions.filter((question) => !question.complete).length })
                : t("questions.complete"),
            href: "/admin/knowledge?tab=faqs", action: t("questions.change"),
        },
    ];

    return (
        <section aria-labelledby="recipe-cards-title" className="mb-6">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 id="recipe-cards-title" className="text-base font-semibold text-foreground">{t("title")}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("subtitle")}</p>
                </div>
                <button type="button" onClick={onApply} disabled={applied || applying}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                    {applying ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
                    {applied ? t("applied") : t("useAsIs")}
                </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                {cards.map(({ key, Icon, title, why, body, note, href, action }) => (
                    <article key={key} className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="flex items-start gap-2.5">
                            <span className="mt-0.5 rounded-lg bg-indigo-100 p-2 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                                <Icon size={15} aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">{why}</p>
                            </div>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-foreground">{body}</p>
                        <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>
                        <Link href={href} className="mt-3 inline-flex text-xs font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300">
                            {action}
                        </Link>
                    </article>
                ))}
            </div>
        </section>
    );
}
