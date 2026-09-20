import { resolveVerticalDashboard, type DashboardVerticalConfigLike, type VerticalDashboardItem } from "@/lib/vertical-dashboard-resolver";
import type { SetupRecipe } from "./setup-recipe";

const OFFER_PATHS: Readonly<Partial<Record<VerticalDashboardItem, string>>> = {
    serviceCatalog: "/admin/service-catalog",
    menu: "/admin/menu",
    inventory: "/admin/inventory",
    memberships: "/admin/memberships",
    courses: "/admin/courses",
    classes: "/admin/classes",
    properties: "/admin/properties",
    tours: "/admin/tours",
    listings: "/admin/listings",
    vehicles: "/admin/vehicles",
    resourceRentals: "/admin/resource-rentals",
    pets: "/admin/pets",
    insurance: "/admin/insurance",
    appointments: "/admin/appointments?tab=services",
};

const OFFER_PRIORITY: readonly VerticalDashboardItem[] = [
    "serviceCatalog", "menu", "inventory", "memberships", "courses", "classes",
    "properties", "tours", "listings", "vehicles", "resourceRentals", "pets",
    "insurance", "appointments",
];

export function recipeOfferHref(recipe: SetupRecipe, verticalConfig: DashboardVerticalConfigLike | null): string {
    const visible = resolveVerticalDashboard(verticalConfig).visibleItems;
    // The recipe's named services are persisted in the appointments service
    // catalog. A product-only vertical has no such catalog and must not land on
    // an empty calendar merely because the card has a generic label.
    if (recipe.services.length > 0 && visible.includes("appointments")) {
        return OFFER_PATHS.appointments!;
    }
    const item = OFFER_PRIORITY.find((candidate) => visible.includes(candidate));
    return item ? OFFER_PATHS[item]! : "/admin/settings/business-info";
}

export function recipePurchaseTool(recipe: SetupRecipe, verticalConfig: DashboardVerticalConfigLike | null): string | null {
    const industry = verticalConfig?.industry;
    if (industry === "restaurantes" || recipe.purchaseModes.includes("table")) return "restaurants";
    if (industry === "education" || recipe.purchaseModes.includes("class")) return "education";
    if (industry === "servicios_hogar") return "homeServices";
    if (industry === "retail") return "ecommerce";
    if (recipe.purchaseModes.includes("appointment")) return "appointments";
    return null;
}
